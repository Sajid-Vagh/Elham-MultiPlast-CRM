/**
 * Parse an end-date string (yyyy-MM-dd) into an end-of-day Date (23:59:59.999).
 * Without this, `new Date("2026-07-27")` creates midnight UTC,
 * causing lte(createdAt, new Date("2026-07-27")) to exclude records
 * created during the entire business day.
 */
export function parseEndDate(endDate: string): Date {
  const d = new Date(endDate);
  d.setHours(23, 59, 59, 999);
  return d;
}
