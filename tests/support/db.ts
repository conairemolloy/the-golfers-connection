// Shared Postgres/drizzle connection module for every test suite under
// tests/ (rls, ledger, requests, offers, availability). Each vitest test
// file gets a fresh module registry (isolate: true, the default), so
// every file that touches `db` needs something to close it, or vitest
// hangs on exit waiting for the socket — see closeDb below. The client
// is created lazily so files that never touch `db` don't open a
// connection at all.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { expect } from "vitest";
import * as schema from "@/db/schema";
import type { Tx } from "@/lib/ledger";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const DATABASE_URL = process.env.DATABASE_URL!;

/**
 * Throws the suite's own "run via `pnpm test`" message if any required
 * env var is missing. `suiteDir` names the calling suite (e.g.
 * "tests/offers") so the error points at the right place; only tests/rls
 * signs in via supabase-js and needs the anon key, so `opts.anonKey` is
 * opt-in rather than always checked.
 */
export function assertTestEnv(suiteDir: string, opts: { anonKey?: boolean } = {}): void {
  const needsAnon = opts.anonKey ?? false;
  const ok = Boolean(SUPABASE_URL) && Boolean(SERVICE_ROLE_KEY) && Boolean(DATABASE_URL) && (!needsAnon || Boolean(ANON_KEY));
  if (ok) return;
  const anonClause = needsAnon ? ", NEXT_PUBLIC_SUPABASE_ANON_KEY" : "";
  throw new Error(
    `${suiteDir} requires DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL${anonClause} and SUPABASE_SERVICE_ROLE_KEY — ` +
      "run via `pnpm test`, which loads .env.local.",
  );
}

let pgClient: postgres.Sql | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getDb() {
  if (!dbInstance) {
    // Supabase's pooler drops idle connections; a single-worker run
    // (vitest.config.ts: maxWorkers 1, fileParallelism false) leaves
    // connections idle between files, and postgres-js won't notice a
    // connection died server-side until it tries to use it again — at
    // which point, with none of these set, it hangs on the OS's own TCP
    // retransmission timeout rather than failing fast. idle_timeout
    // closes connections client-side before the pooler can drop them
    // out from under us; max_lifetime bounds how long any one
    // connection is trusted; connect_timeout bounds how long a fresh
    // connection attempt is allowed to hang.
    pgClient = postgres(DATABASE_URL, { idle_timeout: 20, max_lifetime: 60 * 30, connect_timeout: 10 });
    dbInstance = drizzle(pgClient, { schema });
  }
  return dbInstance;
}

// Proxy so every existing `db.select()/.insert()/...` call site works
// unchanged, while the underlying connection is still lazy.
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export async function closeDb(): Promise<void> {
  if (pgClient) {
    await pgClient.end({ timeout: 5 });
    pgClient = undefined;
    dbInstance = undefined;
  }
}

// Runs against the real drizzle instance directly, not through the `db`
// Proxy above — .transaction() is stateful in a way the plain query
// builder methods aren't, and this sidesteps any doubt about the
// Proxy's `receiver` substitution affecting it.
//
// The cast narrows PgDatabase['transaction']'s callback from the base
// PgTransaction type to ledger.ts's Tx (a PostgresJsTransaction, its
// subtype) — the real runtime value postgres-js hands the callback is
// already a PostgresJsTransaction, so this only corrects the type, not
// the behaviour.
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const database = getDb() as unknown as { transaction: (fn: (tx: Tx) => Promise<T>) => Promise<T> };
  return database.transaction(fn);
}

// Codes seen when the connection died out from under us — a dropped
// pooler connection or a genuine network hiccup — as opposed to a
// TransactionRollbackError, which means the transaction ran fine and
// rolled back exactly as asked.
const CONNECTION_ERROR_CODES = new Set(["CONNECTION_CLOSED", "ECONNRESET", "ETIMEDOUT"]);

function connectionErrorCode(err: unknown): string | undefined {
  const code = err && typeof err === "object" && "code" in err ? (err as { code: unknown }).code : undefined;
  return typeof code === "string" && CONNECTION_ERROR_CODES.has(code) ? code : undefined;
}

/**
 * Runs `fn` inside a transaction, then forces a ROLLBACK — the standard
 * shape for a test that needs to assert on DB state it wrote, without
 * any of it surviving. `fn` does its own assertions using the `tx` it's
 * given; this just guarantees cleanup. Tests that expect `fn` itself to
 * throw (a RequestError) don't need this — an uncaught throw inside the
 * transaction callback rolls back on its own, and the rejection the
 * test should assert on is that error, not TransactionRollbackError.
 */
export async function runAndRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const outcome = withTransaction(async (tx) => {
    await fn(tx);
    tx.rollback();
  });
  const { TransactionRollbackError } = await import("drizzle-orm");
  try {
    await outcome;
  } catch (err) {
    const code = connectionErrorCode(err);
    if (code) {
      throw new Error(
        `runAndRollback: lost the database connection (${code}) partway through — this is a network failure ` +
          "talking to the database, not a test failure. The assertions inside this test were never reached.",
        { cause: err },
      );
    }
    expect(err).toBeInstanceOf(TransactionRollbackError);
    return;
  }
  expect.fail("runAndRollback: transaction resolved instead of rolling back");
}
