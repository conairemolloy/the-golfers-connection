// vitest globalSetup: runs once, before any test file, in a process
// separate from the forked worker that runs them. Builds all fixtures
// (see harness.ts for the permanent-vs-ephemeral split) and hands their
// ids to test files via a tmp file, since a returned teardown closure and
// a forked worker cannot share memory directly.
import { buildFixtures, closeDb, teardownFixtures, writeFixturesToDisk } from "./harness";

export default async function setup() {
  const fixtures = await buildFixtures();
  writeFixturesToDisk(fixtures);

  return async function teardown() {
    await teardownFixtures(fixtures);
    await closeDb();
  };
}
