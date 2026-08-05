import path from "node:path";
import { defineConfig } from "vitest/config";

// RLS tests in tests/rls/, ledger tests in tests/ledger/, request tests
// in tests/requests/, offer tests in tests/offers/, availability tests in
// tests/availability/, and auth tests in tests/auth/ share one Supabase/
// Postgres database (permanent plus per-run ephemeral fixtures — see each
// suite's harness.ts). Running files concurrently, or across more than one
// worker, would let two runs race on the same rows — the ledger suite's
// concurrency test deliberately races two connections against each
// other, but only within itself, not against some other file's
// fixtures. maxWorkers: 1 plus fileParallelism: false forces every test
// file onto a single fork, one at a time (poolOptions.forks.singleFork
// was removed in Vitest 4's pool rework in favour of these top-level
// options). None of tests/ledger, tests/requests, tests/offers,
// tests/availability or tests/auth has a globalSetup of its own — none
// signs in via supabase-js at module-load time, so there's no cross-
// process session handoff to arrange; each file just calls its own
// ensure*Fixtures() itself (tests/auth's harness.ts signs in per-test, via
// its own signInAs). tests/meta touches no database at all — it's a
// repo-hygiene check (currently: that every tests/ subdirectory with a
// *.test.ts is actually in this include list) — but it's cheap enough to
// just run in the same pass rather than carve out a second vitest
// invocation for it. tests/format is the same story: pure date-formatting
// logic, no database, included here rather than split out.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only`'s own package.json resolves to a throwing index.js
      // by default and only swaps in a no-op (empty.js) under webpack's
      // "react-server" export condition — a condition Vite/vitest never
      // sets. Outside Next's own bundler it throws unconditionally,
      // failing every test file that imports src/lib/auth.ts or
      // src/lib/supabase/admin.ts (both `import "server-only"`) even
      // though nothing here runs in a browser. Alias straight to the
      // package's own empty.js, the same target Next's bundler picks.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: [
      "tests/rls/**/*.test.ts",
      "tests/ledger/**/*.test.ts",
      "tests/requests/**/*.test.ts",
      "tests/offers/**/*.test.ts",
      "tests/availability/**/*.test.ts",
      "tests/auth/**/*.test.ts",
      "tests/meta/**/*.test.ts",
      "tests/format/**/*.test.ts",
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
