const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

/**
 * "11–15 MAY 2027" within a month, "28 APR – 3 MAY 2027" across months
 * (same year), "3 MAY 2027" for a single day, "30 DEC 2026 – 2 JAN 2027"
 * across a year boundary. En dash throughout, never a hyphen. Takes plain
 * YYYY-MM-DD strings (requests.dateFrom/dateTo's drizzle `date` columns) —
 * parsed by splitting rather than `new Date`, so there's no local-timezone
 * round-trip to get wrong.
 */
export function formatDateRange(from: string, to: string): string {
  const f = parseIsoDate(from);
  const t = parseIsoDate(to);

  if (f.year === t.year && f.month === t.month && f.day === t.day) {
    return `${f.day} ${MONTHS[f.month - 1]} ${f.year}`;
  }
  if (f.year === t.year && f.month === t.month) {
    return `${f.day}–${t.day} ${MONTHS[f.month - 1]} ${f.year}`;
  }
  if (f.year === t.year) {
    return `${f.day} ${MONTHS[f.month - 1]} – ${t.day} ${MONTHS[t.month - 1]} ${f.year}`;
  }
  return `${f.day} ${MONTHS[f.month - 1]} ${f.year} – ${t.day} ${MONTHS[t.month - 1]} ${t.year}`;
}
