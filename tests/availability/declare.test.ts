import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { hostAvailability } from "@/db/schema";
import { AvailabilityError, deactivateAvailability, declareAvailability, updateAvailability } from "@/lib/availability";
import { closeDb, createClub, createCourse, ensureAvailabilityFixtures, futureDate, runAndRollback, setMembership } from "./harness";

describe("declareAvailability", () => {
  afterAll(closeDb);

  it("succeeds at a club where the host holds a club_confirmed membership", async () => {
    await runAndRollback(async (tx) => {
      const { hostA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");

      const result = await declareAvailability(tx, hostA, { clubId, weekday: 2, capacity: 2 });

      expect(result.availabilityId).toBeTruthy();
    });
  });

  it("fails without a confirmed membership at the club", async () => {
    await runAndRollback(async (tx) => {
      const { hostA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });

      await expect(declareAvailability(tx, hostA, { clubId, weekday: 2, capacity: 1 })).rejects.toMatchObject({
        code: "NO_CONFIRMED_MEMBERSHIP",
      });
    });
  });

  it("fails for a course belonging to another club", async () => {
    await runAndRollback(async (tx) => {
      const { hostA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      const otherClubId = await createClub(tx, { tier: 2 });
      const foreignCourseId = await createCourse(tx, otherClubId);
      await setMembership(tx, hostA, clubId, "club_confirmed");

      await expect(
        declareAvailability(tx, hostA, { clubId, courseId: foreignCourseId, weekday: 2, capacity: 1 }),
      ).rejects.toMatchObject({ code: "COURSE_CLUB_MISMATCH" });
    });
  });

  it("fails when neither weekday nor a bounded range is given, with a readable Zod error", async () => {
    await runAndRollback(async (tx) => {
      const { hostA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");

      const outcome = declareAvailability(tx, hostA, { clubId, capacity: 1 });
      await expect(outcome).rejects.toBeInstanceOf(AvailabilityError);
      await expect(outcome).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(outcome).rejects.toThrow(/weekday or a bounded date range/);
    });
  });

  it("accepts a bounded range with no weekday", async () => {
    await runAndRollback(async (tx) => {
      const { hostA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");

      const result = await declareAvailability(tx, hostA, {
        clubId,
        dateFrom: futureDate(10),
        dateTo: futureDate(20),
        capacity: 1,
      });

      expect(result.availabilityId).toBeTruthy();
    });
  });
});

describe("updateAvailability / deactivateAvailability", () => {
  afterAll(closeDb);

  it("update is owner-only", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, hostB } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");
      const { availabilityId } = await declareAvailability(tx, hostA, { clubId, weekday: 3, capacity: 1 });

      await expect(updateAvailability(tx, hostB, availabilityId, { capacity: 4 })).rejects.toMatchObject({
        code: "NOT_OWNER",
      });
    });
  });

  it("update is idempotent — repeat calls with the same patch converge on the same state", async () => {
    await runAndRollback(async (tx) => {
      const { hostA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");
      const { availabilityId } = await declareAvailability(tx, hostA, { clubId, weekday: 3, capacity: 1, note: "first" });

      await updateAvailability(tx, hostA, availabilityId, { capacity: 3, note: "updated" });
      await updateAvailability(tx, hostA, availabilityId, { capacity: 3, note: "updated" });

      const [row] = await tx.select().from(hostAvailability).where(eq(hostAvailability.id, availabilityId));
      expect(row.capacity).toBe(3);
      expect(row.note).toBe("updated");
    });
  });

  it("deactivate is owner-only", async () => {
    await runAndRollback(async (tx) => {
      const { hostA, hostB } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");
      const { availabilityId } = await declareAvailability(tx, hostA, { clubId, weekday: 3, capacity: 1 });

      await expect(deactivateAvailability(tx, hostB, availabilityId)).rejects.toMatchObject({ code: "NOT_OWNER" });
    });
  });

  it("deactivate is idempotent — calling it twice is not an error", async () => {
    await runAndRollback(async (tx) => {
      const { hostA } = await ensureAvailabilityFixtures();
      const clubId = await createClub(tx, { tier: 2 });
      await setMembership(tx, hostA, clubId, "club_confirmed");
      const { availabilityId } = await declareAvailability(tx, hostA, { clubId, weekday: 3, capacity: 1 });

      await deactivateAvailability(tx, hostA, availabilityId);
      await expect(deactivateAvailability(tx, hostA, availabilityId)).resolves.toBeUndefined();

      const [row] = await tx.select().from(hostAvailability).where(eq(hostAvailability.id, availabilityId));
      expect(row.active).toBe(false);
    });
  });
});
