/**
 * Date-boundary helpers resolved against the business timezone
 * (Asia/Kolkata, IST) so that a query for e.g. "Aug 4" strictly returns
 * records created on Aug 4, regardless of the API server's own timezone.
 *
 * Why this is needed: `orders.created_at` (and friends) are stored as
 * `timestamptz` (UTC). `new Date("2026-08-04")` parses a date-only string as
 * UTC midnight, and `.setHours()` mutates in the *server's* local timezone.
 * On a server running in UTC (e.g. Render), the end-of-day boundary becomes
 * 2026-08-04T23:59:59Z, which equals Aug 5 05:29 IST — so the "Aug 4" filter
 * leaked every Aug 5 morning order. All boundaries below are converted to
 * explicit UTC instants via the business timezone, independent of server TZ.
 */

export const BUSINESS_TZ = "Asia/Kolkata";

function timeZoneOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  tz: string,
): Date {
  const probe = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  return new Date(probe - timeZoneOffsetMs(probe, tz));
}

export function datePartsInBusinessTz(now: Date): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(now)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

/** UTC instant of 00:00:00.000 of "today" in the business timezone. */
export function startOfTodayInBusinessTz(now: Date): Date {
  const { year, month, day } = datePartsInBusinessTz(now);
  return zonedDateTimeToUtc(year, month, day, 0, 0, 0, 0, BUSINESS_TZ);
}

/** UTC instant of 00:00:00.000 of "now ± offsetDays" in the business timezone. */
export function shiftDaysInBusinessTz(now: Date, offsetDays: number): Date {
  const { year, month, day } = datePartsInBusinessTz(now);
  const cal = new Date(Date.UTC(year, month - 1, day));
  cal.setUTCDate(cal.getUTCDate() + offsetDays);
  return zonedDateTimeToUtc(
    cal.getUTCFullYear(),
    cal.getUTCMonth() + 1,
    cal.getUTCDate(),
    0,
    0,
    0,
    0,
    BUSINESS_TZ,
  );
}

/** UTC instant of 00:00:00.000 of the 1st of a given month (1-12) in the business timezone. */
export function zonedMonthStart(year: number, month: number): Date {
  return zonedDateTimeToUtc(year, month, 1, 0, 0, 0, 0, BUSINESS_TZ);
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a query value into the start-of-day boundary (00:00:00.000 IST).
 * Accepts either a `yyyy-MM-dd` date or a full ISO timestamp (passed straight
 * through to `new Date`, e.g. an ISO string built by the browser in local TZ).
 */
export function parseStartDate(value: string): Date {
  const m = DATE_ONLY_RE.exec(value);
  if (!m) return new Date(value);
  return zonedDateTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0, 0, 0, BUSINESS_TZ);
}

/**
 * Parse a query value into the end-of-day boundary (23:59:59.999 IST).
 * Same input handling as `parseStartDate`.
 */
export function parseEndDate(value: string): Date {
  const m = DATE_ONLY_RE.exec(value);
  if (!m) return new Date(value);
  return zonedDateTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 23, 59, 59, 999, BUSINESS_TZ);
}
