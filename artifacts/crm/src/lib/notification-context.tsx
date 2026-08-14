import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { playNotificationSoundForType, showBrowserNotification } from "./notification-sound";
import { toast } from "@/hooks/use-toast";

interface Notification {
  id: number;
  userId: number;
  createdById?: number | null;
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
  ownerFilter: string;
  setOwnerFilter: (ownerId: string) => void;
  visibleNotifications: Notification[];
  markAsRead: (id: number) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  markAsSeen: (id: number) => Promise<void>;
  markAsSeenByRelated: (relatedId: number, relatedType: string) => Promise<void>;
  deleteNotification: (id: number) => Promise<void>;
  clearAllNotifications: () => Promise<void>;
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

// Persistent global "Owners" filter for the Admin. Acts as a master gatekeeper
// across ALL notification surfaces (toasts, bell dropdown, history). Survives
// page reloads, logouts and browser restarts via localStorage.
const OWNER_FILTER_KEY = "admin_notification_filter";
const OWNER_FILTER_ALL = "ALL";

function matchesOwnerFilter(n: Notification, filter: string): boolean {
  if (!filter || filter === OWNER_FILTER_ALL) return true;
  return String(n.createdById ?? "") === String(filter);
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation grouping — production_message notifications all belong to an
// order conversation. Instead of spamming the Notification History with one
// row per message, we collapse them into a single thread per order and show the
// NEWEST message of that conversation as the representative. The group key is
// derived from the notification's role-aware link (/production/orders/:poId for
// production/support, /orders/:salesOrderId for sales) so each workspace groups
// by its own order id while staying independent of any DB schema change.
// ─────────────────────────────────────────────────────────────────────────────
function getConversationKey(n: Notification): string | null {
  if (n.type !== "production_message" || !n.link) return null;
  const parts = n.link.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const last = Number(parts[parts.length - 1]);
  if (!Number.isFinite(last) || last <= 0) return null;
  return `${parts[0]}:${last}`;
}

/**
 * Collapse production_message notifications into per-conversation threads.
 * Returns the flattened list (representative = newest message of each thread,
 * sorted newest-first) plus a per-key message count so UIs can show "3 messages".
 */
export function groupConversations(list: Notification[]): {
  notifications: Notification[];
  countByKey: Record<string, number>;
} {
  const representatives = new Map<string, Notification>();
  const countByKey: Record<string, number> = {};

  for (const n of list) {
    const key = getConversationKey(n);
    if (!key) {
      // Skip the empty default key so non-conversation notifications pass through untouched.
      continue;
    }
    countByKey[key] = (countByKey[key] || 0) + 1;
    const prev = representatives.get(key);
    if (!prev || new Date(n.createdAt).getTime() > new Date(prev.createdAt).getTime()) {
      representatives.set(key, n);
    }
  }

  if (representatives.size === 0) {
    return { notifications: list, countByKey: {} };
  }

  const conversationItems = [...representatives.values()];
  const others = list.filter((n) => !getConversationKey(n));
  const merged = [...conversationItems, ...others].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return { notifications: merged, countByKey };
}

export function conversationMessageCount(list: Notification[], representative: Notification): number {
  const key = getConversationKey(representative);
  if (!key) return 0;
  let count = 0;
  for (const n of list) {
    if (getConversationKey(n) === key) count += 1;
  }
  return count;
}

function loadOwnerFilter(): string {
  try {
    return localStorage.getItem(OWNER_FILTER_KEY) || OWNER_FILTER_ALL;
  } catch {
    return OWNER_FILTER_ALL;
  }
}

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
  const [ownerFilter, setOwnerFilterState] = useState<string>(loadOwnerFilter);
  const ownerFilterRef = useRef(ownerFilter);
  const queryClient = useQueryClient();

  // New chat messages / voice notes should surface immediately on the Sales and
  // Production order lists (green unread-message icon), so refresh those two
  // list caches whenever a chat notification arrives.
  const invalidateChatLists = useCallback((n: Notification) => {
    if (n.type !== "production_message" && n.type !== "voice_note") return;
    queryClient.invalidateQueries({ queryKey: ["orders-global"] });
    queryClient.invalidateQueries({ queryKey: ["production-orders"] });
  }, [queryClient]);

  // Keep a ref in sync so the SSE handler + polling callbacks (both stable)
  // always read the latest filter without being re-created on every change.
  useEffect(() => {
    ownerFilterRef.current = ownerFilter;
  }, [ownerFilter]);

  const setOwnerFilter = useCallback((ownerId: string) => {
    setOwnerFilterState(ownerId);
    try {
      localStorage.setItem(OWNER_FILTER_KEY, ownerId);
    } catch {
      /* localStorage unavailable — ignore */
    }
  }, []);

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
          // The persistent "Owners" filter also blocks toasts for actors that do
          // not match the selected owner — the raw list still stores them so they
          // appear in History when the filter is changed back to All.
          if (!isInitial && maxId > (lastKnownMaxIdRef.current ?? 0)) {
            const newest = fetched.find(n => n.id === maxId);
            if (newest && !newest.readAt && !newest.notificationSeen && matchesOwnerFilter(newest, ownerFilterRef.current)) setLatestNotification(newest);
            if (newest) invalidateChatLists(newest);
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
  }, [userId, invalidateChatLists]);

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
            setTotal((t) => t + 1);
            return [n, ...prev].slice(0, MAX_NOTIFICATIONS);
          });
          lastKnownMaxIdRef.current = Math.max(lastKnownMaxIdRef.current ?? 0, n.id);
          invalidateChatLists(n);

          // Global "Owners" gatekeeper: when a specific owner is selected, skip
          // the toast (popup + sound) for notifications caused by anyone else.
          // The notification is still stored so it is visible under "All".
          if (!matchesOwnerFilter(n, ownerFilterRef.current)) return;

          setLatestNotification(n);

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

  // The persistent "Owners" filter applies to everything the user SEES: the
  // bell dropdown, the bell badge count and the History page all consume this
  // derived array so the gatekeeper stays in sync everywhere.
  const visibleNotifications = useMemo(
    () => (ownerFilter === OWNER_FILTER_ALL ? notifications : notifications.filter((n) => matchesOwnerFilter(n, ownerFilter))),
    [notifications, ownerFilter]
  );

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

  const clearAllNotifications = useCallback(async () => {
    // Optimistically clear local state so the Bell dropdown + History page
    // update immediately, then persist the deletion server-side.
    const prev = notifications;
    setNotifications([]);
    setTotal(0);

    try {
      const res = await fetch("/api/notifications/clear-all", { method: "DELETE", headers: getHeaders() });
      if (!res.ok) throw new Error(`Clear failed (${res.status})`);
      toast({ title: "All notifications cleared" });
    } catch (err: any) {
      // Roll back on failure so no notifications appear lost
      setNotifications(prev);
      setTotal(prev.length);
      toast({ title: err?.message || "Failed to clear notifications", variant: "destructive" });
    }
  }, [getHeaders, notifications]);

  const value: NotificationContextValue = {
    notifications, total, unreadCount, latestNotification,
    loading, error,
    ownerFilter, setOwnerFilter, visibleNotifications,
    markAsRead, markAllAsRead, markAsSeen, markAsSeenByRelated,
    deleteNotification, clearAllNotifications, refetch: fetchAll,
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
