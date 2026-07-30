// Ledger service. Server-side only — every function here takes a
// transaction handle so callers compose writes atomically, and every
// write goes through the `postgres` role, bypassing RLS entirely (see
// CLAUDE.md's THREAT MODEL note in 0007_rls_policies.sql). Correctness
// rests on these functions plus the database constraints, not on RLS.
import { eq, sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PostgresJsTransaction } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { domainEvents, ledgerEntries, roundParticipants, rounds } from "@/db/schema";

export type Tx = PostgresJsTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>;

export type LedgerErrorCode =
  | "ROUND_NOT_FOUND"
  | "ROUND_NOT_CONFIRMED"
  | "ROUND_REVERSED"
  | "ROUND_NOT_SETTLED";

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
type LedgerEntryInsert = typeof ledgerEntries.$inferInsert;
type RoundRow = typeof rounds.$inferSelect;

export type SettleRoundResult =
  | { status: "settled"; entries: LedgerEntryRow[] }
  | { status: "already_settled" };

export type ReverseRoundResult =
  | { status: "reversed"; entries: LedgerEntryRow[] }
  | { status: "already_reversed" };

export interface Standing {
  balance: number;
  state: "good" | "owing" | "closed";
  canRequest: boolean;
}

// Row-locked: a concurrent settleRound/reverseRound call on the same round
// blocks here until the first transaction commits, then reads the
// post-commit state — this is what makes the confirm race resolve to
// exactly one settlement rather than two.
async function getRoundForUpdate(tx: Tx, roundId: string): Promise<RoundRow> {
  const [round] = await tx.select().from(rounds).where(eq(rounds.id, roundId)).for("update");
  if (!round) {
    throw new LedgerError("ROUND_NOT_FOUND", `round ${roundId} does not exist`);
  }
  return round;
}

/**
 * Writes the ledger entries for a confirmed round and marks it settled.
 *
 * Host is credited once per guest who played, member or plus-one alike.
 * Each guest member is debited 1 for himself plus 1 for every plus-one
 * attributed to him via round_participants.invited_by — plus-one rows
 * generate no entry of their own, they are already counted in their
 * inviter's debit. Credits and debits therefore always sum to the same
 * total per round.
 *
 * Idempotent: calling this again on an already-settled (and not reversed)
 * round is a no-op, not an error — this is what the "settled_at is null"
 * precondition resolves to in practice, both for a plain repeat call and
 * for the loser of a confirm race, which sees settled_at already set once
 * the row lock above releases.
 */
export async function settleRound(tx: Tx, roundId: string): Promise<SettleRoundResult> {
  const round = await getRoundForUpdate(tx, roundId);

  if (round.reversedAt) {
    throw new LedgerError(
      "ROUND_REVERSED",
      `round ${roundId} has been reversed and cannot be settled again`,
    );
  }
  if (round.settledAt) {
    return { status: "already_settled" };
  }
  if (!round.hostConfirmedAt || !round.guestConfirmedAt) {
    throw new LedgerError(
      "ROUND_NOT_CONFIRMED",
      `round ${roundId} is missing host or guest confirmation`,
    );
  }

  const participants = await tx
    .select()
    .from(roundParticipants)
    .where(eq(roundParticipants.roundId, roundId));

  const host = participants.find((p) => p.role === "host");
  if (!host || !host.userId) {
    throw new LedgerError("ROUND_NOT_FOUND", `round ${roundId} has no host participant`);
  }
  const guests = participants.filter((p) => p.role === "guest");

  const hostCredit = guests.length;

  const debitsByUser = new Map<string, number>();
  for (const guest of guests) {
    if (guest.isMember && guest.userId) {
      debitsByUser.set(guest.userId, (debitsByUser.get(guest.userId) ?? 0) + 1);
    }
  }
  for (const guest of guests) {
    if (!guest.isMember && guest.invitedBy) {
      debitsByUser.set(guest.invitedBy, (debitsByUser.get(guest.invitedBy) ?? 0) + 1);
    }
  }

  const entriesToInsert: LedgerEntryInsert[] = [
    {
      userId: host.userId,
      roundId,
      direction: "credit",
      amount: hostCredit,
      reason: "round settled",
      idempotencyKey: `settle:${roundId}:${host.userId}:credit`,
    },
    ...Array.from(debitsByUser.entries()).map(
      ([userId, amount]): LedgerEntryInsert => ({
        userId,
        roundId,
        direction: "debit",
        amount,
        reason: "round settled",
        idempotencyKey: `settle:${roundId}:${userId}:debit`,
      }),
    ),
  ];

  const entries = await tx
    .insert(ledgerEntries)
    .values(entriesToInsert)
    .onConflictDoNothing()
    .returning();

  await tx.update(rounds).set({ settledAt: new Date() }).where(eq(rounds.id, roundId));

  await tx.insert(domainEvents).values({
    kind: "round.settled",
    entity: "round",
    entityId: roundId,
    payload: { roundId, hostCredit, debits: Object.fromEntries(debitsByUser) },
  });

  return { status: "settled", entries };
}

/**
 * Writes a compensating entry for every existing ledger entry on a
 * settled round, in the opposite direction, and marks the round
 * reversed. A reversed round is terminal per the decision log: settled_at
 * is left as-is (reversed_at is the new, separate marker), and the round
 * is never re-settled — if the round happens after all, it's a new round.
 *
 * Idempotent the same way settleRound is: calling this again on an
 * already-reversed round is a no-op, not an error.
 */
export async function reverseRound(
  tx: Tx,
  roundId: string,
  reason: string,
): Promise<ReverseRoundResult> {
  const round = await getRoundForUpdate(tx, roundId);

  if (!round.settledAt) {
    throw new LedgerError(
      "ROUND_NOT_SETTLED",
      `round ${roundId} has not been settled and cannot be reversed`,
    );
  }
  if (round.reversedAt) {
    return { status: "already_reversed" };
  }

  const existing = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.roundId, roundId));

  const compensating: LedgerEntryInsert[] = existing.map((entry) => {
    const direction = entry.direction === "credit" ? "debit" : "credit";
    return {
      userId: entry.userId,
      roundId,
      direction,
      amount: entry.amount,
      reason: `REVERSAL: ${reason}`,
      idempotencyKey: `reverse:${roundId}:${entry.userId}:${direction}`,
    };
  });

  const entries =
    compensating.length > 0
      ? await tx.insert(ledgerEntries).values(compensating).onConflictDoNothing().returning()
      : [];

  await tx.update(rounds).set({ reversedAt: new Date() }).where(eq(rounds.id, roundId));

  await tx.insert(domainEvents).values({
    kind: "round.reversed",
    entity: "round",
    entityId: roundId,
    payload: { roundId, reason },
  });

  return { status: "reversed", entries };
}

/**
 * Calls the SQL member_balance function rather than reimplementing the
 * sum here — one source of truth (see CLAUDE.md domain rules).
 */
export async function memberBalance(tx: Tx, userId: string): Promise<number> {
  const rows = await tx.execute<{ balance: number }>(sql`select member_balance(${userId}) as balance`);
  return Number(rows[0].balance);
}

/**
 * The -1/-2 grace band exists so a new member hosted once isn't
 * immediately locked out of requesting. Standing is ledger-derived only
 * today; it will incorporate released feedback at M7.
 */
export async function standing(tx: Tx, userId: string): Promise<Standing> {
  const balance = await memberBalance(tx, userId);
  const state: Standing["state"] = balance >= 0 ? "good" : balance >= -2 ? "owing" : "closed";
  return { balance, state, canRequest: state !== "closed" };
}
