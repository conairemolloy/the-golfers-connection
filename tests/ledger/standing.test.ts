// Unit tests for standing()/memberBalance() — the state boundaries
// around the -1/-2 grace band and the -3 closed threshold.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { standing } from "@/lib/ledger";
import { closeDb, ensureLedgerFixtures, type LedgerFixtures, withTransaction } from "./harness";

describe("standing", () => {
  let fixtures: LedgerFixtures;

  beforeAll(async () => {
    fixtures = await ensureLedgerFixtures();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  const cases: {
    key: keyof LedgerFixtures;
    balance: number;
    state: "good" | "owing" | "closed";
    canRequest: boolean;
  }[] = [
    { key: "standingBalancePositive1", balance: 1, state: "good", canRequest: true },
    { key: "standingBalanceZero", balance: 0, state: "good", canRequest: true },
    { key: "standingBalanceNeg1", balance: -1, state: "owing", canRequest: true },
    { key: "standingBalanceNeg2", balance: -2, state: "owing", canRequest: true },
    { key: "standingBalanceNeg3", balance: -3, state: "closed", canRequest: false },
    { key: "standingBalanceNeg5", balance: -5, state: "closed", canRequest: false },
  ];

  for (const { key, balance, state, canRequest } of cases) {
    it(`balance ${balance} -> state "${state}", canRequest ${canRequest}`, async () => {
      const result = await withTransaction((tx) => standing(tx, fixtures[key]));
      expect(result.balance).toBe(balance);
      expect(result.state).toBe(state);
      expect(result.canRequest).toBe(canRequest);
    });
  }
});
