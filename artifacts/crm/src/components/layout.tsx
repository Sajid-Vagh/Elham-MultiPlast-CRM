import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useGetMe, useLogout, useListActivities, getListActivitiesQueryKey, useUpdateActivity } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { playFollowUpSound, showBrowserNotification } from "@/lib/notification-sound";
import { NotificationProvider, useNotifications } from "@/lib/notification-context";
import { NotificationPopup } from "./notification-popup";
import {
  LayoutDashboard, Users, Briefcase,
  Package, BarChart, Download, Copy, Settings, LogOut, Bell, X, Clock, Phone, FolderTree, FileText, CheckCheck,
  Factory, ClipboardList, Truck, AlertTriangle, Layers, MapPin, Database
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { UserAvatar } from "@/components/user-avatar";

const REMINDER_SOUND_SS_KEY = "crm_reminder_sound_played_ids";

function getReminderSoundSet(): Set<string> {
  try {
    const raw = sessionStorage.getItem(REMINDER_SOUND_SS_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function addReminderSoundId(key: string) {
  const set = getReminderSoundSet();
  set.add(key);
  sessionStorage.setItem(REMINDER_SOUND_SS_KEY, JSON.stringify([...set]));
}

function useTimeBasedReminders(activities: { id: number; followUpDate?: string | null; followUpTime?: string | null; contact?: { name?: string } | null; deal?: { contact?: { name?: string } | null } | null }[] | undefined) {
  useEffect(() => {
    if (!activities?.length) return;
    const check = () => {
      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTotal = currentHours * 60 + currentMinutes;
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      for (const a of activities) {
        if (a.followUpDate !== today || !a.followUpTime) continue;
        const [h, m] = a.followUpTime.split(":").map(Number);
        if (isNaN(h) || isNaN(m)) continue;
        const followUpTotal = h * 60 + m;
        const diff = followUpTotal - currentTotal;
        if (diff >= 0 && diff <= 15) {
          const key = `${a.id}-15min`;
          if (!getReminderSoundSet().has(key) && Notification.permission === "granted") {
            addReminderSoundId(key);
            const name = a.contact?.name || a.deal?.contact?.name || "Unknown";
            const timeStr = `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
            playFollowUpSound();
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
  }, [activities]);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) setLocation("/login");
  }, [isLoading, user, setLocation]);

  if (isLoading) return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <img src="/images/logo1.png" alt="Elham MultiPlast LLP" className="max-w-[180px] w-full h-auto mx-auto mb-6" />
        <div className="flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    </div>
  );
  if (!user) return null;

  return (
    <NotificationProvider userId={user.id}>
      <LayoutMain user={user}>{children}</LayoutMain>
    </NotificationProvider>
  );
}

function LayoutMain({ user, children }: { user: any; children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const logout = useLogout();
  const [bellOpen, setBellOpen] = useState(false);
  const [dismissedToday, setDismissedToday] = useState<Set<number>>(new Set());
  const [showLoginPopup, setShowLoginPopup] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const loginPopupShownRef = useRef(sessionStorage.getItem("crm_login_popup_shown") === "true");
  const bellRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { unreadCount: sseUnreadCount, notifications: sseNotifications, latestNotification, markAsRead, markAllAsRead, markAsSeen, markAsSeenByRelated } = useNotifications();

  const [activePopups, setActivePopups] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!latestNotification || activePopups.has(latestNotification.id)) return;
    setActivePopups((prev) => new Set(prev).add(latestNotification.id));
    showBrowserNotification(latestNotification.title, latestNotification.message, `crm-notif-${latestNotification.id}`);
  }, [latestNotification, activePopups]);

  const dismissPopup = useCallback((id: number) => {
    setActivePopups((prev) => { const next = new Set(prev); next.delete(id); return next; });
    markAsSeen(id);
  }, [markAsSeen]);

  const { data: upcomingActivities } = useListActivities(
    { upcoming: true },
    { query: { enabled: !!user, staleTime: 30 * 1000, queryKey: getListActivitiesQueryKey({ upcoming: true }) } }
  );
  const followUpCount = useMemo(() => {
    if (!upcomingActivities) return 0;
    return upcomingActivities.filter(a => a.callStatus === "Pending").length;
  }, [upcomingActivities]);

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayActivities = useMemo(() => {
    if (!upcomingActivities) return [];
    return upcomingActivities.filter(a => a.followUpDate === today && !dismissedToday.has(a.id) && a.callStatus === "Pending");
  }, [upcomingActivities, today, dismissedToday]);

  const unreadCount = sseUnreadCount;

  const updateActivity = useUpdateActivity();

  useTimeBasedReminders(upcomingActivities);

  useEffect(() => {
    if (user) {
      localStorage.setItem("crm_user_role", user.role);
      localStorage.setItem("crm_user_unit", user.unit || "All");
    }
  }, [user]);

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
    if (user && !loginPopupShownRef.current) {
      loginPopupShownRef.current = true;
      sessionStorage.setItem("crm_login_popup_shown", "true");
      if (todayActivities.length > 0) {
        const timer = setTimeout(() => setShowLoginPopup(true), 500);
        return () => clearTimeout(timer);
      }
    }
    return;
  }, [user, todayActivities.length]);

  const handleDismissReminder = useCallback((activityId: number) => {
    setDismissedToday(prev => new Set(prev).add(activityId));
  }, []);

  const handleMarkCompleted = useCallback((activityId: number) => {
    markAsSeenByRelated(activityId, "activity");
    updateActivity.mutate(
      { id: activityId, data: { callStatus: "Completed" } },
      { onSuccess: () => setDismissedToday(prev => new Set(prev).add(activityId)) }
    );
  }, [updateActivity, markAsSeenByRelated]);

  const isProductionOnly = user.role === "production";
  const isSupport = user.role === "production_and_support";
  const isAdmin = user.role === "admin";
  const isInventory = user.role === "inventory";

  const salesNavItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", color: "#a78bfa" },
    { icon: Users, label: "Leads", href: "/leads", color: "#60a5fa" },
    { icon: Briefcase, label: "Deals", href: "/deals", color: "#34d399" },
    { icon: Bell, label: "Activity", href: "/follow-ups", color: "#f59e0b" },
    { icon: FolderTree, label: "Categories", href: "/categories", color: "#f97316" },
    { icon: Truck, label: "Dispatch", href: "/dispatch", color: "#f43f5e" },
    { icon: AlertTriangle, label: "Complaints", href: "/complaints", color: "#ef4444" },
    { icon: FileText, label: "Proforma Invoices", href: "/proforma-invoices", color: "#06b6d4" },
    { icon: Package, label: "Products", href: "/products", color: "#fb923c" },
    { icon: MapPin, label: "Freight Lookup", href: "/transport-logistics/lookup", color: "#14b8a6" },
    { icon: BarChart, label: "Reports", href: "/reports", color: "#f472b6" },
    { icon: Package, label: "Inventory", href: "/inventory", color: "#0ea5e9" },
    { icon: Download, label: "Import", href: "/import", color: "#fbbf24" },
    { icon: Copy, label: "Duplicates", href: "/duplicates", color: "#f87171" },
    { icon: Settings, label: "Settings", href: "/settings", color: "#94a3b8" },
  ];

  const supportNavItems = [
    { icon: Truck, label: "Dispatch", href: "/dispatch", color: "#f43f5e" },
    { icon: AlertTriangle, label: "Complaints", href: "/complaints", color: "#ef4444" },
    { icon: Bell, label: "Activity", href: "/follow-ups", color: "#f59e0b" },
    { icon: Users, label: "Customers", href: "/existing-customers", color: "#6366f1" },
    { icon: Package, label: "Products", href: "/products", color: "#fb923c" },
    { icon: FileText, label: "Proforma Invoices", href: "/proforma-invoices", color: "#06b6d4" },
    { icon: Database, label: "Masters", href: "/masters", color: "#14b8a6" },
    { icon: Settings, label: "Settings", href: "/settings", color: "#94a3b8" },
  ];

  const productionNavItems = [
    { icon: Factory, label: "Production Dashboard", href: "/production/dashboard", color: "#7c3aed" },
    { icon: ClipboardList, label: "Production Orders", href: "/production/orders", color: "#7c3aed" },
    { icon: Layers, label: "Batches", href: "/production/batches", color: "#7c3aed" },
    { icon: Package, label: "Products", href: "/products", color: "#fb923c" },
    { icon: BarChart, label: "Machine Report", href: "/production/machine-report", color: "#7c3aed" },
  ];

  const inventoryNavItems = [
    { icon: Package, label: "Inventory", href: "/inventory", color: "#0ea5e9" },
    { icon: Database, label: "Masters", href: "/masters", color: "#14b8a6" },
    { icon: Settings, label: "Settings", href: "/settings", color: "#94a3b8" },
  ];

  let navItems: typeof salesNavItems;
  if (isAdmin) {
    navItems = [...salesNavItems, ...productionNavItems, { icon: Users, label: "Customers", href: "/existing-customers", color: "#6366f1" }, { icon: Database, label: "Masters", href: "/masters", color: "#14b8a6" }];
  } else if (isInventory) {
    navItems = inventoryNavItems;
  } else if (isProductionOnly) {
    navItems = productionNavItems;
  } else if (isSupport) {
    const seen = new Set<string>();
    navItems = [...productionNavItems, ...supportNavItems].filter(item => {
      if (seen.has(item.href)) return false;
      seen.add(item.href);
      return true;
    });
  } else {
    navItems = salesNavItems;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="crm-sidebar w-64 flex flex-col">
        <div className="px-5 py-4 border-b border-[hsl(250_22%_88%)]">
          <div className="flex items-center justify-between">
            <div className="flex-1 flex justify-center">
              <img
                src="/images/logo1.png"
                alt="Elham MultiPlast LLP"
                className="max-w-[160px] w-full h-auto"
              />
            </div>
            <div className="relative flex-shrink-0">
              <Button
                ref={bellRef}
                variant="ghost"
                size="icon"
                className="h-7 w-7 relative"
                onClick={() => setBellOpen(prev => !prev)}
              >
                <Bell className="h-3.5 w-3.5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
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
            <UserAvatar profilePhoto={user.profilePhoto} name={user.name} className="w-8 h-8 shadow-sm" />
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-semibold truncate text-[hsl(245_30%_20%)]">{user.name}</p>
              <p className="text-xs truncate text-[hsl(248_16%_55%)]">{user.unit || (user.role === "production" ? "Production" : user.role === "production_and_support" ? "Production & Support" : user.role === "inventory" ? "Inventory" : user.role)}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-[hsl(248_16%_50%)] border-[hsl(250_22%_88%)] bg-white/60 hover:bg-white"
            onClick={() => setShowLogoutConfirm(true)}
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
              Today's Activities
            </DialogTitle>
            <DialogDescription>
              You have <strong>{todayActivities.length}</strong> {todayActivities.length === 1 ? "activity" : "activities"} scheduled today.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {todayActivities.map(a => {
              const name = (a as any).contact?.name || (a as any).deal?.contact?.name || "Unknown";
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
                Activities Today
              </div>
              <div className="divide-y">
                {todayActivities.map(a => {
                  const name = (a as any).contact?.name || (a as any).deal?.contact?.name || "Unknown";
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
          <div className="border-t">
            <Link href="/notifications">
              <div className="p-2.5 text-center text-xs text-blue-600 hover:bg-blue-50 cursor-pointer font-medium" onClick={() => setBellOpen(false)}>
                View All Notifications
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* Logout Confirmation */}
      <AlertDialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to logout from your account?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={logout.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={logout.isPending}
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                logout.mutate(undefined, {
                  onSuccess: () => {
                    localStorage.removeItem("crm_token");
                    localStorage.removeItem("crm_user_role");
                    localStorage.removeItem("crm_user_unit");
                    sessionStorage.removeItem("crm_notif_since");
                    setShowLogoutConfirm(false);
                    setLocation("/login");
                  },
                  onSettled: () => {
                    setShowLogoutConfirm(false);
                  }
                });
              }}
            >
              {logout.isPending ? "Logging out…" : "Logout"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Notification popups */}
      {sseNotifications.filter(n => activePopups.has(n.id)).slice(0, 3).map(n => (
        <NotificationPopup
          key={n.id}
          id={n.id}
          title={n.title}
          message={n.message}
          link={n.link}
          type={n.type}
          onDismiss={dismissPopup}
        />
      ))}
    </div>
  );
}
