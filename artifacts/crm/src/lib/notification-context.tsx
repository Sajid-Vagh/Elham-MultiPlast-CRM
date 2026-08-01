import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { playNotificationSoundForType, showBrowserNotification } from "./notification-sound";
import { toast } from "@/hooks/use-toast";

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
  customerName?: string | null;
  customerCompany?: string | null;
}

interface NotificationContextValue {
  notifications: Notification[];
  total: number;
  unreadCount: number;
  latestNotification: Notification | null;
  loading: boolean;
  error: string | null;
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  markAsSeen: (id: number) => Promise<void>;
  markAsSeenByRelated: (relatedId: number, relatedType: string) => Promise<void>;
  deleteNotification: (id: number) => Promise<void>;
  refetch: () => Promise<void>;
  panelNotification: Notification | null;
  openNotificationPanel: (notification: Notification) => void;
  closeNotificationPanel: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const SOUND_PLAYED_SS_KEY = "crm_sound_played_ids";

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

const MAX_NOTIFICATIONS = 500;

export function NotificationProvider({ userId, children }: { userId: number | undefined; children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestNotification, setLatestNotification] = useState<Notification | null>(null);
  const [panelNotification, setPanelNotification] = useState<Notification | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const lastKnownMaxIdRef = useRef<number | null>(null);

  const getHeaders = useCallback((): Record<string, string> => {
    const t = localStorage.getItem("crm_token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  }, []);

  const fetchAll = useCallback(async () => {
    if (!userId) return;
    const isInitial = lastKnownMaxIdRef.current === null;
    if (isInitial) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications/history?filter=all&limit=250&offset=0", { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        const fetched: Notification[] = data.notifications || [];
        setNotifications(fetched);
        setTotal(data.total || 0);
        const maxId = fetched.length ? Math.max(...fetched.map(n => n.id)) : null;
        if (maxId !== null) {
          // Only surface a NEW unread + unseen notification via popup/browser.
          // Seen/read items must never re-trigger popups (prevents the glitch where
          // dismissed notifications fired repeatedly on every poll/refetch).
          if (!isInitial && maxId > (lastKnownMaxIdRef.current ?? 0)) {
            const newest = fetched.find(n => n.id === maxId);
            if (newest && !newest.readAt && !newest.notificationSeen) setLatestNotification(newest);
          }
          lastKnownMaxIdRef.current = maxId;
        }
      } else {
        const text = await res.text().catch(() => "Unknown error");
        setError(`API error ${res.status}: ${text}`);
      }
    } catch (err: any) {
      setError(err?.message || "Network error fetching notifications");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [userId]);

  // Fetch on mount
  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    return () => { mountedRef.current = false; };
  }, [fetchAll]);

  // SSE stream for real-time
  useEffect(() => {
    if (!userId) return;

    const t = localStorage.getItem("crm_token");
    const url = t
      ? `/api/notifications/stream?token=${encodeURIComponent(t)}`
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
          setNotifications((prev) => {
            if (prev.some(p => p.id === n.id)) return prev;
            return [n, ...prev].slice(0, MAX_NOTIFICATIONS);
          });
          setTotal((prev) => prev + 1);
          setLatestNotification(n);
          lastKnownMaxIdRef.current = Math.max(lastKnownMaxIdRef.current ?? 0, n.id);

          // Play sound with dedup via sessionStorage
          const playedSet = getSoundPlayedSet();
          if (!playedSet.has(n.id)) {
            playNotificationSoundForType(n.type);
            addSoundPlayedId(n.id);
            fetch(`/api/notifications/${n.id}/mark-sound-played`, {
              method: "PATCH", headers: getHeaders(),
            }).catch(() => {});
          }
        } catch { /* ignore parse errors */ }
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
  }, [userId]);

  // Polling fallback — guarantees new notifications surface (popups + dropdown) even if SSE drops
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(fetchAll, 60_000);
    return () => clearInterval(interval);
  }, [userId, fetchAll]);

  const unreadCount = notifications.filter(n => !n.readAt).length;

  const markAsRead = useCallback(async (id: number) => {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "PATCH", headers: getHeaders() });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    } catch { /* ignore */ }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/read-all", { method: "POST", headers: getHeaders() });
      setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    } catch { /* ignore */ }
  }, []);

  const markAsSeen = useCallback(async (id: number) => {
    // Mark as seen (acknowledged) but KEEP in the notifications list so the
    // Notification History page never loses entries. Dismissing a popup should
    // not delete history.
    try {
      await fetch(`/api/notifications/${id}/seen`, { method: "PATCH", headers: getHeaders() });
      setNotifications((prev) => prev.map((n) =>
        n.id === id ? { ...n, notificationSeen: true, notificationSeenAt: new Date().toISOString() } : n
      ));
    } catch { /* ignore */ }
  }, [getHeaders]);

  const markAsSeenByRelated = useCallback(async (relatedId: number, relatedType: string) => {
    // Mark as READ by related entity (activity / chat) — keeps the entry in
    // history but stops it counting as unread.
    try {
      await fetch("/api/notifications/read-by-related", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getHeaders() },
        body: JSON.stringify({ relatedId, relatedType }),
      });
      setNotifications((prev) => prev.map((n) =>
        (n.relatedId === relatedId && n.relatedType === relatedType && !n.readAt)
          ? { ...n, readAt: new Date().toISOString() }
          : n
      ));
    } catch { /* ignore */ }
  }, [getHeaders]);

  const deleteNotification = useCallback(async (id: number) => {
    // Optimistically remove from local state immediately
    let removed: Notification | undefined;
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id);
      if (target) removed = target;
      return prev.filter((n) => n.id !== id);
    });
    setTotal((prev) => Math.max(0, prev - 1));

    try {
      const res = await fetch(`/api/notifications/${id}`, { method: "DELETE", headers: getHeaders() });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      toast({ title: "Notification deleted" });
    } catch (err: any) {
      // Roll back on failure
      setNotifications((prev) => {
        if (!removed) return prev;
        return prev.some((n) => n.id === id) ? prev : [removed, ...prev];
      });
      setTotal((prev) => prev + 1);
      toast({ title: err?.message || "Failed to delete notification", variant: "destructive" });
    }
  }, [getHeaders]);

  const openNotificationPanel = useCallback((notification: Notification) => {
    setPanelNotification(notification);
  }, []);

  const closeNotificationPanel = useCallback(() => {
    setPanelNotification(null);
  }, []);

  const value: NotificationContextValue = {
    notifications, total, unreadCount, latestNotification,
    loading, error,
    markAsRead, markAllAsRead, markAsSeen, markAsSeenByRelated,
    deleteNotification, refetch: fetchAll,
    panelNotification, openNotificationPanel, closeNotificationPanel,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
