import { describe, expect, it } from "vitest";
import { formatDateRange } from "@/lib/format";

describe("formatDateRange", () => {
  it("formats a range within one month", () => {
    expect(formatDateRange("2027-05-11", "2027-05-15")).toBe("11–15 MAY 2027");
  });

  it("formats a range across months", () => {
    expect(formatDateRange("2027-04-28", "2027-05-03")).toBe("28 APR – 3 MAY 2027");
  });

  it("formats a single day", () => {
    expect(formatDateRange("2027-05-03", "2027-05-03")).toBe("3 MAY 2027");
  });

  it("formats a range across a year boundary", () => {
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("30 DEC 2026 – 2 JAN 2027");
  });
});
