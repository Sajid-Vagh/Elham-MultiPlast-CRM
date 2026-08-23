// Shared date+time status derivation for follow-up activities.
//
// A follow-up's display status depends on BOTH the scheduled date and the
// scheduled time (follow_up_time is stored as canonical 24h "HH:MM" by
// FlexibleTimeInput, but legacy rows may hold "6:31 PM" style strings — the
// parser below accepts both):
//   - Overdue:  scheduled date strictly in the past (yesterday or older)
//   - Pending:  scheduled today AND the scheduled time has already passed
//   - Today:    scheduled today AND the scheduled time has NOT passed yet
//   - Upcoming: scheduled strictly in the future (tomorrow or later, or no date)
//
// Terminal call statuses (Completed / Cancelled / No Response) always win.

export type FollowUpDerivedStatus =
  | "Overdue"
  | "Pending"
  | "Today"
  | "Upcoming"
  | "Completed"
  | "Cancelled"
  | "No Response";

// Parse a stored time string into minutes since midnight. Accepts:
//   "18:31" / "6:31 PM" / "06:31 pm" / "1831". Returns null when absent,
//   empty, or unparseable (callers treat null as "no usable time").
export function parseFollowUpTimeToMinutes(time?: string | null): number | null {
  if (!time) return null;
  let s = String(time).trim().toLowerCase();
  if (!s) return null;

  let isPm: boolean | null = null;
  const mer = s.match(/(am|pm)\.?$/);
  if (mer) {
    isPm = mer[0].startsWith("p");
    s = s.slice(0, -mer[0].length).trim();
  }
  if (!s) return null;

  let hours: number;
  let minutes: number;
  const colon = s.match(/^(\d{1,2}):(\d{1,2})$/);
  const compact = s.match(/^(\d{1,2})(\d{2})$/);
  if (colon) {
    hours = parseInt(colon[1], 10);
    minutes = parseInt(colon[2], 10);
  } else if (compact) {
    hours = parseInt(compact[1], 10);
    minutes = parseInt(compact[2], 10);
  } else {
    return null;
  }

  if (isNaN(hours) || isNaN(minutes) || minutes < 0 || minutes > 59) return null;
  if (isPm !== null) {
    if (hours < 1 || hours > 12) return null;
    if (isPm && hours < 12) hours += 12;
    if (!isPm && hours === 12) hours = 0;
  } else if (hours < 0 || hours > 23) {
    return null;
  }
  return hours * 60 + minutes;
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function deriveFollowUpStatus(
  callStatus?: string | null,
  followUpDate?: string | null,
  followUpTime?: string | null,
  now: Date = new Date(),
): FollowUpDerivedStatus {
  const terminal = callStatus ?? "";
  if (terminal === "Completed") return "Completed";
  if (terminal === "Cancelled") return "Cancelled";
  if (terminal === "No Response") return "No Response";

  const today = localDateStr(now);
  if (!followUpDate || followUpDate > today) return "Upcoming";
  if (followUpDate < today) return "Overdue";

  // Scheduled today — split "Today" vs "Pending" on the wall-clock time.
  // Missing/unparseable time keeps the legacy date-only behavior (stays Today).
  const schedMinutes = parseFollowUpTimeToMinutes(followUpTime);
  if (schedMinutes === null) return "Today";
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return schedMinutes <= nowMinutes ? "Pending" : "Today";
}
