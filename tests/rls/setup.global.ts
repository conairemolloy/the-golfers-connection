// vitest globalSetup: runs once, before any test file, in a process
// separate from the forked worker that runs them. Builds all fixtures
// (see harness.ts for the permanent-vs-ephemeral split) and hands their
// ids to test files via a tmp file, since a returned teardown closure and
// a forked worker cannot share memory directly.
//
// setup() and teardown() here are outside vitest's timeout coverage —
// neither testTimeout nor hookTimeout wraps a globalSetup file, only
// beforeAll/afterAll/it. Anything long-lived opened in this file (the db
// connection included) must be idle-safe, or a dead connection at
// teardown hangs on the OS TCP timeout instead of failing fast. See
// ROADMAP.md, Things That Will Bite You.
import { buildFixtures, closeDb, teardownFixtures, writeFixturesToDisk } from "./harness";

export default async function setup() {
  const fixtures = await buildFixtures();
  writeFixturesToDisk(fixtures);

  return async function teardown() {
    await teardownFixtures(fixtures);
    await closeDb();
  };
}
