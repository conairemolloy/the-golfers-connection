import path from "node:path";
import { defineConfig } from "vitest/config";

// RLS tests in tests/rls/, ledger tests in tests/ledger/, request tests
// in tests/requests/, and offer tests in tests/offers/ share one
// Supabase/Postgres database (permanent plus per-run ephemeral fixtures
// — see each suite's harness.ts). Running files concurrently, or across
// more than one worker, would let two runs race on the same rows — the
// ledger suite's concurrency test deliberately races two connections
// against each other, but only within itself, not against some other
// file's fixtures. maxWorkers: 1 plus fileParallelism: false forces
// every test file onto a single fork, one at a time
// (poolOptions.forks.singleFork was removed in Vitest 4's pool rework in
// favour of these top-level options). None of tests/ledger,
// tests/requests or tests/offers has a globalSetup of its own — none
// signs in via supabase-js, so there's no cross-process session handoff
// to arrange; each file just calls its own ensure*Fixtures() itself.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: [
      "tests/rls/**/*.test.ts",
      "tests/ledger/**/*.test.ts",
      "tests/requests/**/*.test.ts",
      "tests/offers/**/*.test.ts",
    ],
    globalSetup: ["./tests/rls/setup.global.ts"],
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    // Node 20 has no global WebSocket; supabase-js's realtime client needs
    // one to construct, even though these tests never use realtime.
    // Forked workers don't reliably inherit the parent's execArgv, so it's
    // set explicitly here too.
    execArgv: ["--experimental-websocket"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
