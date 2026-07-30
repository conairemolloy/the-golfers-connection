import path from "node:path";
import { defineConfig } from "vitest/config";

// RLS tests in tests/rls/ share one Supabase/Postgres database (a fixed
// set of permanent fixtures plus per-run ephemeral ones — see
// tests/rls/harness.ts). Running files concurrently, or across more than
// one worker, would let two runs race on the same rows. maxWorkers: 1
// plus fileParallelism: false forces every test file onto a single fork,
// one at a time (poolOptions.forks.singleFork was removed in Vitest 4's
// pool rework in favour of these top-level options).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["tests/rls/**/*.test.ts"],
    globalSetup: ["./tests/rls/setup.global.ts"],
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // Node 20 has no global WebSocket; supabase-js's realtime client needs
    // one to construct, even though these tests never use realtime.
    // Forked workers don't reliably inherit the parent's execArgv, so it's
    // set explicitly here too.
    execArgv: ["--experimental-websocket"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
