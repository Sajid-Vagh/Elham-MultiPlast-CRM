import { useState, useMemo } from "react";
import { Bell, CheckCheck, Loader2, ArrowLeft, Trash2, X, Volume2, VolumeX, Users } from "lucide-react";
import { isNotificationSoundMuted, setNotificationSoundMuted } from "@/lib/notification-sound";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useNotifications } from "@/lib/notification-context";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAllUsers } from "@/lib/use-all-users";

type Filter = "all" | "unread" | "today" | "this_week" | "older";

const FILTER_OPTIONS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "older", label: "Older" },
];

const TYPE_ICONS: Record<string, string> = {
  enquiry_assigned: "📌",
  repeat_enquiry: "🔄",
  follow_up: "🔔",
  deal_won: "🎉",
  deal_lost: "💔",
  assignment: "📋",
  production_status: "🏭",
  invoice_created: "📄",
  invoice_updated: "📝",
  invoice_deleted: "🗑️",
  deal_created: "💼",
  deal_stage_changed: "🔄",
  deal_reopened: "🔁",
  user_created: "👤",
  product_added: "📦",
  production_message: "💬",
  lead_transfer_requested: "🔁",
};

function isToday(d: Date) {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isThisWeek(d: Date) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);
  return d >= startOfWeek;
}

// Parse a backend timestamp safely as UTC. Backend stores created_at in UTC
// (ISO with trailing Z). If a legacy naive value (no timezone) slips through,
// treat it as UTC so the local-time display is always correct.
function parseUtcDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s.endsWith(" ") ? `${s}Z` : `${s}Z`);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const limit = 50;
  const [soundMuted, setSoundMuted] = useState<boolean>(() => isNotificationSoundMuted());

  const { total, unreadCount, loading, error, markAsRead, markAllAsRead, deleteNotification, clearAllNotifications, refetch, openNotificationPanel, ownerFilter, setOwnerFilter, visibleNotifications } = useNotifications();

  const { data: allUsers } = useAllUsers();

  const ownerOptions = useMemo(() => {
    const users = [...(allUsers || [])];
    users.sort((a, b) => {
      const ra = a.role === "admin" ? 0 : 1;
      const rb = b.role === "admin" ? 0 : 1;
      return ra - rb || a.name.localeCompare(b.name);
    });
    return [{ id: "ALL", name: "All" }, ...users.map((u) => ({ id: String(u.id), name: u.name }))];
  }, [allUsers]);

  const handleClearAll = () => {
    if (total === 0) return;
    if (!window.confirm(`Delete all ${total} notification${total !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    clearAllNotifications();
  };

  const toggleSound = () => {
    setSoundMuted((prev) => {
      const next = !prev;
      setNotificationSoundMuted(next);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let list = [...visibleNotifications];
    if (filter === "unread") {
      list = list.filter((n) => !n.readAt);
    } else if (filter === "today") {
      list = list.filter((n) => {
        const d = parseUtcDate(n.createdAt);
        return d ? isToday(d) : false;
      });
    } else if (filter === "this_week") {
      list = list.filter((n) => {
        const d = parseUtcDate(n.createdAt);
        return d ? isThisWeek(d) : false;
      });
    } else if (filter === "older") {
      list = list.filter((n) => {
        const d = parseUtcDate(n.createdAt);
        return d ? !isThisWeek(d) : false;
      });
    }
    const offset = page * limit;
    return { items: list.slice(offset, offset + limit), total: list.length };
  }, [visibleNotifications, filter, page]);

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bell className="h-5 w-5" /> Notification History
          </h1>
          <p className="text-xs text-muted-foreground">{visibleNotifications.length} notification{visibleNotifications.length !== 1 ? "s" : ""}</p>
        </div>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="h-8 w-[170px] text-xs gap-1" title="Filter notifications by owner">
            <Users className="h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ownerOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={soundMuted ? "outline" : "default"}
          size="sm"
          className="h-8 text-xs gap-1"
          onClick={toggleSound}
          title={soundMuted ? "Unmute notification sound" : "Mute notification sound"}
        >
          {soundMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          {soundMuted ? "Unmute Sound" : "Mute Sound"}
        </Button>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={markAllAsRead}>
            <CheckCheck className="h-3.5 w-3.5" /> Mark All Read
          </Button>
        )}
        {total > 0 && (
          <Button variant="destructive" size="sm" className="h-8 text-xs gap-1" onClick={handleClearAll}>
            <Trash2 className="h-3.5 w-3.5" /> Clear All
          </Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="relative">
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={filter === opt.value ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => { setFilter(opt.value); setPage(0); }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium mb-1">Failed to load notifications</p>
          <p className="text-red-600">{error}</p>
          <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={refetch}>Retry</Button>
        </div>
      )}

      {/* Notification list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.items.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {ownerFilter !== "ALL" ? "No notifications from this owner." : "No notifications found."}
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.items.map((n) => {
            const isUnread = !n.readAt;
            const icon = TYPE_ICONS[n.type] || "🔔";
            const createdDate = parseUtcDate(n.createdAt);
            const dateStr = createdDate?.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) ?? "—";
            const timeStr = createdDate?.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) ?? "";

            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-3 rounded-lg transition-colors cursor-pointer ${isUnread ? "bg-blue-50 border border-blue-100" : "hover:bg-muted/30"}`}
                onClick={() => { markAsRead(n.id); openNotificationPanel(n); }}
              >
                <span className="text-lg mt-0.5">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm truncate ${isUnread ? "font-semibold" : ""}`}>{n.title}</p>
                    {isUnread && (
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${n.type === "repeat_enquiry" ? "bg-yellow-500" : "bg-blue-500"}`}
                        title={n.type === "repeat_enquiry" ? "Repeat enquiry" : "New lead"}
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-pre-line mt-0.5">{n.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{dateStr} at {timeStr}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
                  {isUnread && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600" title="Dismiss (mark as read)" onClick={() => markAsRead(n.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" title="Delete" onClick={() => deleteNotification(n.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {filtered.total > limit && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page + 1} of {Math.ceil(filtered.total / limit)}</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * limit >= filtered.total} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
