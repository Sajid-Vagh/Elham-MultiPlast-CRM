import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useGetMe, useLogout, useListContacts, getListContactsQueryKey, useListActivities, getListActivitiesQueryKey, useUpdateActivity } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { playNotificationSound, showBrowserNotification } from "@/lib/notification-sound";
import { useNotificationStream } from "@/lib/use-notification-stream";
import { NotificationPopup } from "./notification-popup";
import {
  LayoutDashboard, Users, Briefcase,
  Package, BarChart, Download, Copy, Settings, LogOut, Bell, X, Clock, Phone, FolderTree, FileText, CheckCheck
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

const ACT_TYPE_ICONS: Record<string, { bg: string; emoji: string }> = {
  Call: { bg: "#dcfce7", emoji: "📞" },
  WhatsApp: { bg: "#ccfbf1", emoji: "💬" },
  Email: { bg: "#dbeafe", emoji: "✉️" },
  Note: { bg: "#fef9c3", emoji: "📝" },
  FollowUp: { bg: "#ffedd5", emoji: "🔔" },
};

function useFollowUpNotifications(userId: number | undefined) {
  const { data: dueContacts } = useListContacts(
    { followUpDue: true },
    { query: { enabled: !!userId, staleTime: 5 * 60 * 1000, queryKey: getListContactsQueryKey({ followUpDue: true }) } }
  );
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (!userId || !dueContacts?.length || notifiedRef.current) return;
    const fire = () => {
      notifiedRef.current = true;
      const count = dueContacts.length;
      const first = dueContacts[0]!;
      playNotificationSound();
      new Notification(`${count} follow-up${count > 1 ? "s" : ""} due today`, {
        body: `${first.name}${count > 1 ? ` and ${count - 1} more` : ""} — open CRM to review`,
        icon: "/favicon.ico",
        tag: "crm-followup",
      });
    };
    if (Notification.permission === "granted") fire();
    else if (Notification.permission === "default") {
      Notification.requestPermission().then(p => { if (p === "granted") fire(); });
    }
  }, [userId, dueContacts]);
}

function useTimeBasedReminders(activities: { id: number; followUpDate?: string | null; followUpTime?: string | null; contact?: { name?: string } | null; deal?: { contact?: { name?: string } | null } | null }[] | undefined, notifiedRef: React.MutableRefObject<Set<string>>) {
  useEffect(() => {
    if (!activities?.length) return;
    const check = () => {
      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTotal = currentHours * 60 + currentMinutes;
      const today = now.toISOString().split("T")[0]!;

      for (const a of activities) {
        if (a.followUpDate !== today || !a.followUpTime) continue;
        const [h, m] = a.followUpTime.split(":").map(Number);
        if (isNaN(h) || isNaN(m)) continue;
        const followUpTotal = h * 60 + m;
        const diff = followUpTotal - currentTotal;
        if (diff >= 0 && diff <= 15) {
          const key = `${a.id}-15min`;
          if (!notifiedRef.current.has(key) && Notification.permission === "granted") {
            notifiedRef.current = new Set(notifiedRef.current).add(key);
            const name = a.contact?.name || a.deal?.contact?.name || "Unknown";
            const timeStr = `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
            playNotificationSound();
            new Notification(`Reminder: Call ${name} at ${timeStr}`, {
              body: `Follow-up scheduled in ${diff} minute${diff !== 1 ? "s" : ""}`,
              icon: "/favicon.ico",
              tag: `crm-reminder-${a.id}`,
            });
          }
        }
      }
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [activities, notifiedRef]);
}

function useAssignmentNotifications(
  userId: number | undefined,
  isAdmin: boolean
): Array<{ id: number; title: string; message: string; link: string | null }> {
  const sinceRef = useRef<string | null>(null);
  const initialLoadRef = useRef(true);
  const [assignmentPopups, setAssignmentPopups] = useState<Array<{ id: number; title: string; message: string; link: string | null }>>([]);
  const seenRef = useRef<Set<number>>(new Set());

  // Proactively request notification permission on mount
  useEffect(() => {
    if (!userId || isAdmin) return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [userId, isAdmin]);

  if (!sinceRef.current) {
    const stored = sessionStorage.getItem("crm_notif_since");
    sinceRef.current = stored || new Date().toISOString();
    if (!stored) sessionStorage.setItem("crm_notif_since", sinceRef.current);
  }

  const { data: myContacts } = useListContacts(
    { salesOwnerId: userId },
    {
      query: {
        enabled: !!userId && !isAdmin,
        refetchInterval: 10_000,
        staleTime: 5_000,
        queryKey: getListContactsQueryKey({ salesOwnerId: userId }),
      }
    }
  );

  useEffect(() => {
    if (!myContacts || !userId || isAdmin) return;
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }
    const since = sinceRef.current!;
    const newOnes = myContacts.filter(c => c.createdAt > since);
    for (const c of newOnes) {
      if (seenRef.current.has(c.id)) continue;
      seenRef.current = new Set(seenRef.current).add(c.id);
      const popup = {
        id: -c.id,
        title: `New enquiry assigned to you`,
        message: `${c.name}${c.city ? ` from ${c.city}` : ""}`,
        link: `/leads/${c.id}`,
      };
      setAssignmentPopups(prev => [...prev, popup].slice(-5));
      playNotificationSound();
      if (Notification.permission === "granted") {
        new Notification(`New enquiry assigned to you`, {
          body: `${c.name}${c.city ? ` from ${c.city}` : ""} — tap to view`,
          icon: "/favicon.ico",
          tag: `crm-assign-${c.id}`,
        });
      } else if (Notification.permission === "default") {
        Notification.requestPermission().then(p => {
          if (p === "granted") {
            new Notification(`New enquiry assigned to you`, {
              body: `${c.name}${c.city ? ` from ${c.city}` : ""} — tap to view`,
              icon: "/favicon.ico",
              tag: `crm-assign-${c.id}`,
            });
          }
        });
      }
    }
    const now = new Date().toISOString();
    sinceRef.current = now;
    sessionStorage.setItem("crm_notif_since", now);
  }, [myContacts, userId, isAdmin]);

  return assignmentPopups;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();
  const [location, setLocation] = useLocation();
  const logout = useLogout();
  const [bellOpen, setBellOpen] = useState(false);
  const [dismissedToday, setDismissedToday] = useState<Set<number>>(new Set());
  const [showLoginPopup, setShowLoginPopup] = useState(false);
  const [bellRect, setBellRect] = useState<DOMRect | null>(null);
  const reminderNotifiedRef = useRef<Set<string>>(new Set());
  const loginPopupShownRef = useRef(sessionStorage.getItem("crm_login_popup_shown") === "true");
  const bellRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useFollowUpNotifications(user?.id);
  const assignmentPopups = useAssignmentNotifications(user?.id, user?.role === "admin");

  const { unreadCount: sseUnreadCount, notifications: sseNotifications, latestNotification, markAsRead, markAllAsRead } = useNotificationStream(user?.id);

  const [activePopups, setActivePopups] = useState<Set<number>>(new Set());
  const [dismissedAssignmentPopups, setDismissedAssignmentPopups] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!latestNotification || activePopups.has(latestNotification.id)) return;
    setActivePopups((prev) => new Set(prev).add(latestNotification.id));
    showBrowserNotification(latestNotification.title, latestNotification.message);
  }, [latestNotification, activePopups]);

  const dismissPopup = useCallback((id: number) => {
    setActivePopups((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const dismissAssignmentPopup = useCallback((id: number) => {
    setDismissedAssignmentPopups((prev) => { const next = new Set(prev); next.add(id); return next; });
  }, []);

  const { data: upcomingActivities } = useListActivities(
    { upcoming: true },
    { query: { enabled: !!user, staleTime: 5 * 60 * 1000, queryKey: getListActivitiesQueryKey({ upcoming: true }) } }
  );
  const followUpCount = upcomingActivities?.length ?? 0;

  const today = new Date().toISOString().split("T")[0]!;
  const todayActivities = useMemo(() => {
    if (!upcomingActivities) return [];
    return upcomingActivities.filter(a => a.followUpDate === today && !dismissedToday.has(a.id));
  }, [upcomingActivities, today, dismissedToday]);

  const unreadCount = todayActivities.length + sseUnreadCount;

  const updateActivity = useUpdateActivity();

  useTimeBasedReminders(upcomingActivities, reminderNotifiedRef);

  useEffect(() => {
    if (!isLoading && !user) setLocation("/login");
  }, [isLoading, user, setLocation]);

  useEffect(() => {
    if (!bellOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        bellRef.current && !bellRef.current.contains(e.target as Node)
      ) {
        setBellOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [bellOpen]);

  useEffect(() => {
    if (!bellOpen) return;
    const handleScroll = () => {
      if (bellRef.current) {
        setBellRect(bellRef.current.getBoundingClientRect());
      }
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [bellOpen]);

  useEffect(() => {
    if (user && !isLoading && !loginPopupShownRef.current) {
      loginPopupShownRef.current = true;
      sessionStorage.setItem("crm_login_popup_shown", "true");
      if (todayActivities.length > 0) {
        const timer = setTimeout(() => setShowLoginPopup(true), 500);
        return () => clearTimeout(timer);
      }
    }
    return;
  }, [user, isLoading, todayActivities.length]);

  const handleDismissReminder = useCallback((activityId: number) => {
    setDismissedToday(prev => new Set(prev).add(activityId));
  }, []);

  const handleMarkCompleted = useCallback((activityId: number) => {
    updateActivity.mutate(
      { id: activityId, data: { callStatus: "Completed" } },
      { onSuccess: () => setDismissedToday(prev => new Set(prev).add(activityId)) }
    );
  }, [updateActivity]);

  if (isLoading) return <div>Loading...</div>;
  if (!user) return null;

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", color: "#a78bfa" },
    { icon: Users, label: "Leads", href: "/leads", color: "#60a5fa" },
    { icon: Briefcase, label: "Deals", href: "/deals", color: "#34d399" },
    { icon: Bell, label: "Follow-ups", href: "/follow-ups", color: "#f59e0b" },
    { icon: FolderTree, label: "Categories", href: "/categories", color: "#f97316" },
    { icon: FileText, label: "Proforma Invoices", href: "/proforma-invoices", color: "#06b6d4" },
    { icon: Package, label: "Products", href: "/products", color: "#fb923c" },
    { icon: BarChart, label: "Reports", href: "/reports", color: "#f472b6" },
    { icon: Download, label: "Import", href: "/import", color: "#fbbf24" },
    { icon: Copy, label: "Duplicates", href: "/duplicates", color: "#f87171" },
    { icon: Settings, label: "Settings", href: "/settings", color: "#94a3b8" },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="crm-sidebar w-64 flex flex-col">
        <div className="p-5 border-b border-[hsl(250_22%_88%)]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold tracking-tight" style={{ color: "hsl(258 78% 45%)" }}>
                Elham MultiPlast LLP
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "hsl(248 16% 55%)" }}>CRM System</p>
            </div>
            <div className="relative">
              <Button
                ref={bellRef}
                variant="ghost"
                size="icon"
                className="h-8 w-8 relative"
                onClick={() => {
                  if (bellRef.current) {
                    setBellRect(bellRef.current.getBoundingClientRect());
                  }
                  setBellOpen(prev => !prev);
                }}
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href}>
                <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all cursor-pointer ${
                  isActive
                    ? "text-white shadow-sm"
                    : "text-[hsl(245_30%_35%)] hover:bg-white/60"
                }`}
                  style={isActive ? { backgroundColor: item.color } : {}}
                >
                  <item.icon className="h-4 w-4 flex-shrink-0" style={!isActive ? { color: item.color } : {}} />
                  <span className="text-sm font-medium flex-1">{item.label}</span>
                  {item.href === "/follow-ups" && followUpCount > 0 && (
                    <Badge className="text-[10px] h-5 min-w-5 px-1.5 flex items-center justify-center bg-orange-500 text-white border-0">
                      {followUpCount}
                    </Badge>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[hsl(250_22%_88%)] bg-white/40">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm"
              style={{ backgroundColor: user.colorCode || '#888' }}
            >
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-semibold truncate text-[hsl(245_30%_20%)]">{user.name}</p>
              <p className="text-xs truncate text-[hsl(248_16%_55%)]">{user.unit || user.role}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-[hsl(248_16%_50%)] border-[hsl(250_22%_88%)] bg-white/60 hover:bg-white"
            onClick={() => {
              logout.mutate(undefined, {
                onSuccess: () => {
                  localStorage.removeItem("crm_token");
                  sessionStorage.removeItem("crm_notif_since");
                  setLocation("/login");
                }
              });
            }}
          >
            <LogOut className="h-3.5 w-3.5 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        {children}
      </main>

      <Dialog open={showLoginPopup} onOpenChange={setShowLoginPopup}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-amber-500" />
              Today's Follow-ups
            </DialogTitle>
            <DialogDescription>
              You have <strong>{todayActivities.length}</strong> follow-up{todayActivities.length !== 1 ? "s" : ""} scheduled today.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {todayActivities.map(a => {
              const name = a.contact?.name || a.deal?.contact?.name || "Unknown";
              const time = a.followUpTime
                ? (() => {
                    const [h, m] = a.followUpTime.split(":");
                    const hour = parseInt(h, 10);
                    return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
                  })()
                : "Anytime";
              return (
                <div key={a.id} className="flex items-center gap-2 p-2 bg-muted/30 rounded-md">
                  <Clock className="h-4 w-4 text-amber-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate">{a.notes || "Follow-up call"}</p>
                  </div>
                  <span className="text-xs font-medium text-amber-600 flex-shrink-0">{time}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowLoginPopup(false)}>
              Dismiss
            </Button>
            <Link href="/follow-ups">
              <Button size="sm" onClick={() => setShowLoginPopup(false)}>
                View All
              </Button>
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      {/* Notification dropdown - fixed top-right of viewport */}
      {bellOpen && (
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: '60px',
            right: '20px',
            width: 'min(350px, calc(100vw - 40px))',
            maxHeight: '420px',
            zIndex: 9999,
          }}
          className="bg-white border rounded-xl shadow-2xl overflow-y-auto"
        >
          <div className="p-3 border-b sticky top-0 bg-white z-10 flex items-center justify-between rounded-t-xl">
            <h3 className="text-sm font-semibold">Notifications</h3>
            <div className="flex items-center gap-1">
              {sseUnreadCount > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => { markAllAsRead(); }}>
                  <CheckCheck className="h-3 w-3" />
                  Mark all read
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setBellOpen(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {sseNotifications.filter(n => !n.readAt).length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/20">
                New
              </div>
              <div className="divide-y">
                {sseNotifications.filter(n => !n.readAt).slice(0, 10).map(n => (
                  <div key={n.id} className="p-3 hover:bg-muted/30 cursor-pointer" onClick={() => { markAsRead(n.id); setBellOpen(false); if (n.link) setLocation(n.link); }}>
                    <p className="text-sm font-medium truncate">{n.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">{n.message}</p>
                  </div>
                ))}
              </div>
            </>
          )}
          {todayActivities.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/20 border-t">
                Follow-ups Today
              </div>
              <div className="divide-y">
                {todayActivities.map(a => {
                  const name = a.contact?.name || a.deal?.contact?.name || "Unknown";
                  const time = a.followUpTime
                    ? (() => {
                        const [h, m] = a.followUpTime.split(":");
                        const hour = parseInt(h, 10);
                        return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
                      })()
                    : "Anytime";
                  return (
                    <div key={a.id} className="p-3 hover:bg-muted/30">
                      <div className="flex items-start gap-2">
                        <Clock className="h-4 w-4 mt-0.5 text-amber-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{name}</p>
                          <p className="text-xs text-muted-foreground">{a.notes || "Follow-up call"}</p>
                          <p className="text-xs text-amber-600 font-medium mt-0.5">{time}</p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-green-600"
                            onClick={() => handleMarkCompleted(a.id)}
                            title="Mark completed"
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            onClick={() => handleDismissReminder(a.id)}
                            title="Dismiss"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {sseNotifications.filter(n => !n.readAt).length === 0 && todayActivities.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">No notifications</div>
          )}
        </div>
      )}

      {/* Notification popups */}
      {assignmentPopups.filter(p => !dismissedAssignmentPopups.has(p.id)).slice(0, 3).map(p => (
        <NotificationPopup
          key={p.id}
          id={p.id}
          title={p.title}
          message={p.message}
          link={p.link}
          onDismiss={dismissAssignmentPopup}
        />
      ))}
      {sseNotifications.filter(n => activePopups.has(n.id)).slice(0, 3).map(n => (
        <NotificationPopup
          key={n.id}
          id={n.id}
          title={n.title}
          message={n.message}
          link={n.link}
          onDismiss={dismissPopup}
        />
      ))}
    </div>
  );
}
