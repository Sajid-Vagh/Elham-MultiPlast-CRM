import { useState, useMemo } from "react";
import { Bell, CheckCheck, Loader2, ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useNotifications } from "@/lib/notification-context";

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

export default function NotificationsPage() {
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const limit = 50;

  const { notifications, total, unreadCount, loading, error, markAsRead, markAllAsRead, deleteNotification, refetch } = useNotifications();

  const filtered = useMemo(() => {
    let list = [...notifications];
    if (filter === "unread") {
      list = list.filter((n) => !n.readAt);
    } else if (filter === "today") {
      list = list.filter((n) => isToday(new Date(n.createdAt)));
    } else if (filter === "this_week") {
      list = list.filter((n) => isThisWeek(new Date(n.createdAt)));
    } else if (filter === "older") {
      list = list.filter((n) => !isThisWeek(new Date(n.createdAt)));
    }
    const offset = page * limit;
    return { items: list.slice(offset, offset + limit), total: list.length };
  }, [notifications, filter, page]);

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
          <p className="text-xs text-muted-foreground">{total} notification{total !== 1 ? "s" : ""}</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={markAllAsRead}>
            <CheckCheck className="h-3.5 w-3.5" /> Mark All Read
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
        <div className="text-center py-12 text-sm text-muted-foreground">No notifications found.</div>
      ) : (
        <div className="space-y-1">
          {filtered.items.map((n) => {
            const isUnread = !n.readAt;
            const icon = TYPE_ICONS[n.type] || "🔔";
            const createdDate = new Date(n.createdAt);
            const dateStr = createdDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
            const timeStr = createdDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${isUnread ? "bg-blue-50 border border-blue-100" : "hover:bg-muted/30"}`}
              >
                <span className="text-lg mt-0.5">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm truncate ${isUnread ? "font-semibold" : ""}`}>{n.title}</p>
                    {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-pre-line mt-0.5">{n.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{dateStr} at {timeStr}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0 mt-0.5">
                  {n.link && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => setLocation(n.link!)}>
                      <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                    </Button>
                  )}
                  {isUnread && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600" title="Mark as read" onClick={() => markAsRead(n.id)}>
                      <CheckCheck className="h-3.5 w-3.5" />
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
