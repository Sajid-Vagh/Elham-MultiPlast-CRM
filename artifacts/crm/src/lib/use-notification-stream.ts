import { useEffect, useRef, useState, useCallback } from "react";
import { playEnquirySound, playFollowUpSound } from "./notification-sound";

interface Notification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  relatedId: number | null;
  relatedType: string | null;
  readAt: string | null;
  createdAt: string;
  notificationSeen: boolean;
  notificationSeenAt: string | null;
  soundPlayed: boolean;
  reminderShown: boolean;
  reminderSoundPlayed: boolean;
}

const SOUND_PLAYED_SS_KEY = "crm_sound_played_ids";
const REMINDER_SOUND_SS_KEY = "crm_reminder_sound_played_ids";

function getSoundPlayedSet(): Set<number> {
  try {
    const raw = sessionStorage.getItem(SOUND_PLAYED_SS_KEY);
    return new Set<number>(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function addSoundPlayedId(id: number) {
  const set = getSoundPlayedSet();
  set.add(id);
  sessionStorage.setItem(SOUND_PLAYED_SS_KEY, JSON.stringify([...set]));
}

function getReminderSoundPlayedSet(): Set<number> {
  try {
    const raw = sessionStorage.getItem(REMINDER_SOUND_SS_KEY);
    return new Set<number>(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function addReminderSoundPlayedId(id: number) {
  const set = getReminderSoundPlayedSet();
  set.add(id);
  sessionStorage.setItem(REMINDER_SOUND_SS_KEY, JSON.stringify([...set]));
}

export function useNotificationStream(userId: number | undefined) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestNotification, setLatestNotification] = useState<Notification | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);

  const fetchUnread = useCallback(async () => {
    try {
      const token = localStorage.getItem("crm_token");
      const res = await fetch("/api/notifications/unread-count", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.unread ?? 0);
      } else {
        setUnreadCount(0);
      }
    } catch {
      setUnreadCount(0);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!userId) return;

    fetchUnread();

    const token = localStorage.getItem("crm_token");
    const url = token
      ? `/api/notifications/stream?token=${encodeURIComponent(token)}`
      : "/api/notifications/stream";

    function connect() {
      if (!mountedRef.current) return;
      esRef.current?.close();

      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const n: Notification = JSON.parse(event.data);
          setNotifications((prev) => [n, ...prev].slice(0, 200));
          setUnreadCount((prev) => prev + 1);
          setLatestNotification(n);

          // Play appropriate sound with dedup via sessionStorage
          if (n.type === "enquiry_assigned") {
            if (!getSoundPlayedSet().has(n.id)) {
              playEnquirySound();
              addSoundPlayedId(n.id);
              fetch(`/api/notifications/${n.id}/mark-sound-played`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${token}` },
              }).catch(() => {});
            }
          } else if (n.type === "follow_up") {
            if (!getReminderSoundPlayedSet().has(n.id)) {
              playFollowUpSound();
              addReminderSoundPlayedId(n.id);
              fetch(`/api/notifications/${n.id}/mark-reminder`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${token}` },
              }).catch(() => {});
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        es.close();
        if (mountedRef.current) {
          reconnectTimeoutRef.current = setTimeout(connect, 5000);
        }
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      esRef.current?.close();
    };
  }, [userId, fetchUnread]);

  const markAsRead = useCallback(async (id: number) => {
    try {
      const token = localStorage.getItem("crm_token");
      await fetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    } catch {
      // ignore
    }
  }, []);

  const markAsSeen = useCallback(async (id: number) => {
    try {
      const token = localStorage.getItem("crm_token");
      await fetch(`/api/notifications/${id}/seen`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}` },
      });
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch {
      // ignore
    }
  }, []);

  const markAsSeenByRelated = useCallback(async (relatedId: number, relatedType: string) => {
    try {
      const token = localStorage.getItem("crm_token");
      const res = await fetch("/api/notifications/seen-by-related", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ relatedId, relatedType }),
      });
      const data = await res.json();
      if (data.notification) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
        setNotifications((prev) => prev.filter((n) => n.id !== data.notification.id));
      }
    } catch {
      // ignore
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      const token = localStorage.getItem("crm_token");
      await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    } catch {
      // ignore
    }
  }, []);

  return { notifications, unreadCount, latestNotification, markAsRead, markAllAsRead, markAsSeen, markAsSeenByRelated, fetchUnread };
}
