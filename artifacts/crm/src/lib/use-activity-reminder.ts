// Global Real-time Activity / Call-Due Reminder service.
//
// Mounted once at the root layout so it runs on EVERY page. It:
//   1. Polls the logged-in user's pending activities (`?upcoming=true`) every
//      30 seconds so newly scheduled follow-ups are picked up without a reload.
//   2. Every 15 seconds compares each activity's scheduled date+time against
//      the client clock (`new Date()`), supporting BOTH 12-hour ("06:20 PM")
//      and 24-hour ("18:20") formats.
//   3. Fires a high-priority popup when the due minute is reached (or the
//      activity is overdue but still today). Each activity fires exactly ONCE
//      per scheduled date+time via a session-persistent fired-key tracker.
//   4. Plays the follow-up sound and also sends a 15-min-advance browser
//      notification (only when Notification permission is granted).

import { useCallback, useEffect, useRef, useState } from "react";
import { playFollowUpSound, showBrowserNotification } from "@/lib/notification-sound";
import { parseNotesText } from "@/lib/parse-notes";

export interface ActivityReminder {
  key: string;
  activityId: number;
  name: string;
  phone: string;
  note: string;
  time: string;
  date: string;
  contactId?: number | null;
}

interface ReminderActivity {
  id: number;
  type?: string;
  notes?: string | null;
  followUpDate?: string | null;
  followUpTime?: string | null;
  callStatus?: string | null;
  contactId?: number | null;
  contact?: { id?: number; name?: string; mobile?: string; companyName?: string } | null;
  deal?: { contact?: { id?: number; name?: string; mobile?: string; companyName?: string } | null } | null;
}

const POPUP_FIRED_SS_KEY = "crm_activity_reminder_popup_fired_keys";
const BROWSER_FIRED_SS_KEY = "crm_activity_reminder_browser_fired_keys";

const FETCH_INTERVAL_MS = 30_000;
const CHECK_INTERVAL_MS = 15_000;
const MAX_REMINDERS = 6;

function getFiredKeys(key: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(key);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveFiredKeys(key: string, keys: Set<string>) {
  try {
    sessionStorage.setItem(key, JSON.stringify([...keys]));
  } catch {
    /* sessionStorage unavailable — ignore */
  }
}

function todayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Robust time parser supporting "06:20 PM", "18:20", "6:20 PM" and "0620".
 * Returns 24-hour hours/minutes, or null when the input is invalid.
 */
export function parseActivityTime(time: string | null | undefined): { hours: number; minutes: number } | null {
  if (!time) return null;
  let s = time.trim().toLowerCase();
  if (!s) return null;

  let isPM: boolean | null = null;
  const mer = s.match(/(am|pm)$/);
  if (mer) {
    isPM = mer[0] === "pm";
    s = s.slice(0, -mer[0].length).trim();
  }
  if (!s) return null;

  let hours: number;
  let minutes: number;
  const parts = s.split(":");
  if (parts.length === 2) {
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
  } else {
    const m = s.match(/^(\d{1,2})(\d{2})$/);
    if (!m) return null;
    hours = parseInt(m[1], 10);
    minutes = parseInt(m[2], 10);
  }

  if (isNaN(hours) || isNaN(minutes) || minutes < 0 || minutes > 59) return null;

  if (isPM !== null) {
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  if (hours < 0 || hours > 23) return null;
  return { hours, minutes };
}

function displayTime(t: { hours: number; minutes: number }): string {
  const h12 = t.hours % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(t.minutes).padStart(2, "0")} ${t.hours >= 12 ? "PM" : "AM"}`;
}

export function useActivityReminders(): { reminders: ActivityReminder[]; dismiss: (key: string) => void } {
  const [reminders, setReminders] = useState<ActivityReminder[]>([]);
  const activitiesRef = useRef<ReminderActivity[]>([]);
  const popupFiredRef = useRef<Set<string>>(getFiredKeys(POPUP_FIRED_SS_KEY));
  const browserFiredRef = useRef<Set<string>>(getFiredKeys(BROWSER_FIRED_SS_KEY));

  const check = useCallback(() => {
    const now = new Date();
    const today = todayStr(now);
    const currentTotal = now.getHours() * 60 + now.getMinutes();
    const newlyDue: ActivityReminder[] = [];

    for (const a of activitiesRef.current) {
      if (a.callStatus !== "Pending") continue;
      if (!a.followUpDate || a.followUpDate !== today) continue;
      const parsed = parseActivityTime(a.followUpTime);
      if (!parsed) continue;

      const dueTotal = parsed.hours * 60 + parsed.minutes;
      const diff = dueTotal - currentTotal;
      const contact = a.contact || (a.deal ? a.deal.contact : null);
      const name = contact?.name || "Customer";
      const phone = contact?.mobile || "";
      const note = parseNotesText(a.notes) || "Follow-up call";

      // 15-min advance browser notification (once per activity).
      if (diff >= 0 && diff <= 15) {
        const browserKey = `${a.id}-15min`;
        if (!browserFiredRef.current.has(browserKey)) {
          browserFiredRef.current.add(browserKey);
          saveFiredKeys(BROWSER_FIRED_SS_KEY, browserFiredRef.current);
          if (Notification.permission === "granted") {
            showBrowserNotification(
              `Reminder: Call ${name} at ${displayTime(parsed)}`,
              `Follow-up scheduled in ${diff} minute${diff !== 1 ? "s" : ""}`,
              `crm-reminder-${a.id}`,
            );
          }
        }
      }

      // Exact due time reached, or overdue within today.
      if (diff > 0) continue;
      const popupKey = `${a.id}:${a.followUpDate}:${a.followUpTime}`;
      if (popupFiredRef.current.has(popupKey)) continue;
      popupFiredRef.current.add(popupKey);
      saveFiredKeys(POPUP_FIRED_SS_KEY, popupFiredRef.current);

      newlyDue.push({
        key: popupKey,
        activityId: a.id,
        name,
        phone,
        note,
        time: displayTime(parsed),
        date: a.followUpDate,
        contactId: a.contactId ?? contact?.id ?? null,
      });
    }

    if (newlyDue.length > 0) {
      playFollowUpSound();
      setReminders((prev) => [...newlyDue, ...prev].slice(0, MAX_REMINDERS));
    }
  }, []);

  // Background poller — refresh the pending-activities list every 30s.
  useEffect(() => {
    let active = true;
    const fetchActivities = async () => {
      try {
        const token = localStorage.getItem("crm_token");
        const res = await fetch("/api/activities?upcoming=true", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data)) activitiesRef.current = data;
      } catch {
        // Transient network errors are ignored — the next poll retries.
      }
    };
    fetchActivities().then(check);
    const iv = setInterval(fetchActivities, FETCH_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [check]);

  // Due check — every 15 seconds.
  useEffect(() => {
    check();
    const iv = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [check]);

  const dismiss = useCallback((key: string) => {
    setReminders((prev) => prev.filter((r) => r.key !== key));
  }, []);

  return { reminders, dismiss };
}
