import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, useLogout, useListActivities, getListActivitiesQueryKey, useUpdateActivity } from "@workspace/api-client-react";
import { onActivityChange } from "@/lib/query-invalidation";
import { Link, useLocation } from "wouter";
import { NotificationProvider, useNotifications, groupConversations } from "@/lib/notification-context";
import { dedupeById, parseNotesText } from "@/lib/parse-notes";
import { showBrowserNotification } from "@/lib/notification-sound";
import { ActivityCountProvider, useActivityCount } from "@/lib/activity-count-context";
import { useActivityReminders } from "@/lib/use-activity-reminder";
import { NotificationPopup } from "./notification-popup";
import { NotificationSidePanel } from "./notification-side-panel";
import {
  LayoutDashboard, Users, Briefcase,
  Package, BarChart, Download, Settings, LogOut, Bell, X, Clock, Phone, FolderTree, FileText, CheckCheck,
  Factory, ClipboardList, Truck, AlertTriangle, Layers, MapPin, ShoppingCart
} from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { useWorkspace, getWorkspaceLabel, getHomeRoute, type Workspace } from "@/lib/use-workspace";

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
    <ActivityCountProvider>
      <NotificationProvider userId={user.id}>
        <LayoutMain user={user}>{children}</LayoutMain>
        <NotificationSidePanel />
      </NotificationProvider>
    </ActivityCountProvider>
  );
}

function LayoutMain({ user, children }: { user: any; children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const [bellOpen, setBellOpen] = useState(false);
  const [dismissedToday, setDismissedToday] = useState<Set<number>>(new Set());
  const [showLoginPopup, setShowLoginPopup] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const loginPopupShownRef = useRef(sessionStorage.getItem("crm_login_popup_shown") === "true");
  const bellRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { unreadCount: sseUnreadCount, visibleNotifications, latestNotification, markAsRead, markAllAsRead, markAsSeenByRelated, openNotificationPanel } = useNotifications();

  // Collapse production_message notifications into per-order conversation
  // threads for the bell dropdown "New" section (same grouping as History).
  const groupedUnread = useMemo(() => {
    const unread = visibleNotifications.filter(n => !n.readAt);
    const { notifications } = groupConversations(unread);
    return notifications;
  }, [visibleNotifications]);

  const [activePopups, setActivePopups] = useState<Set<number>>(new Set());
  const popupShownRef = useRef<Set<number>>(new Set());
  const popupAutoDismissTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!latestNotification || popupShownRef.current.has(latestNotification.id)) return;
    popupShownRef.current.add(latestNotification.id);
    setActivePopups((prev) => new Set(prev).add(latestNotification.id));
    showBrowserNotification(latestNotification.title, latestNotification.message, `crm-notif-${latestNotification.id}`);
  }, [latestNotification]);

  const closePopup = useCallback((id: number) => {
    const timer = popupAutoDismissTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      popupAutoDismissTimersRef.current.delete(id);
    }
    setActivePopups((prev) => { const next = new Set(prev); next.delete(id); return next; });
    // UI-ONLY close: dismissing the toast must NOT mark as read or delete the
    // notification. The entry stays unread and remains visible in the bell
    // dropdown and Notification History until the user manually reads/deletes it.
  }, []);

  // Auto-dismiss each popup 5 seconds after it appears. Timers are tracked
  // per-notification so rapid arrivals during bulk imports never reset each
  // other. The 5s timer ONLY closes the UI toast — it must not touch the
  // persistent notification state (no mark-as-read, no delete).
  useEffect(() => {
    activePopups.forEach((id) => {
      if (popupAutoDismissTimersRef.current.has(id)) return;
      const timer = setTimeout(() => {
        popupAutoDismissTimersRef.current.delete(id);
        closePopup(id);
      }, 5000);
      popupAutoDismissTimersRef.current.set(id, timer);
    });
  }, [activePopups, closePopup]);

  useEffect(() => {
    return () => {
      popupAutoDismissTimersRef.current.forEach((t) => clearTimeout(t));
      popupAutoDismissTimersRef.current.clear();
    };
  }, []);

  const { data: upcomingActivities } = useListActivities(
    { upcoming: true },
    { query: { enabled: !!user, staleTime: 30 * 1000, queryKey: getListActivitiesQueryKey({ upcoming: true }) } }
  );
  const followUpCount = useMemo(() => {
    if (!upcomingActivities) return 0;
    return upcomingActivities.filter(a => a.callStatus === "Pending").length;
  }, [upcomingActivities]);

  // The Activity list page publishes its filtered row count here. When the page
  // is mounted, the sidebar badge matches exactly what is visible in the table;
  // otherwise it falls back to the global pending count.
  const publishedActivityCount = useActivityCount();
  const activityBadgeCount = publishedActivityCount ?? followUpCount;

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayActivities = useMemo(() => {
    if (!upcomingActivities) return [];
    return dedupeById(upcomingActivities).filter(a => a.followUpDate === today && !dismissedToday.has(a.id) && a.callStatus === "Pending");
  }, [upcomingActivities, today, dismissedToday]);

  const unreadCount = sseUnreadCount;

  const updateActivity = useUpdateActivity();

  // Global Real-time Activity / Call-Due Reminder service (mounted on every page).
  const { reminders: activityReminders, dismiss: dismissActivityReminder } = useActivityReminders();

  // Activity / Call-Due reminder popups intentionally have NO auto-dismiss.
  // They persist on screen until the user manually clicks the X (onDismiss) or
  // opens the linked lead/follow-up (onOpen). Timers must NOT be added here —
  // stepping away from the desk must never silently drop a scheduled reminder.

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
      {
        onSuccess: () => {
          setDismissedToday(prev => new Set(prev).add(activityId));
          queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["follow-up-activities"] });
          queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          onActivityChange(queryClient);
        }
      }
    );
  }, [updateActivity, markAsSeenByRelated, queryClient]);

  const isProductionOnly = user.role === "production";
  const isSupport = user.role === "production_and_support";
  const isAdmin = user.role === "admin";
  const isInventory = user.role === "inventory";

  const [workspace, setWorkspace, availableWorkspaces] = useWorkspace(user.role);

  const salesNavItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", color: "#a78bfa" },
    { icon: Download, label: "Import", href: "/import", color: "#fbbf24" },
    { icon: Users, label: "Leads", href: "/leads", color: "#60a5fa" },
    { icon: Briefcase, label: "Deals", href: "/deals", color: "#34d399" },
    { icon: Bell, label: "Activity", href: "/follow-ups", color: "#f59e0b" },
    { icon: FolderTree, label: "Categories", href: "/categories", color: "#f97316" },
    { icon: ShoppingCart, label: "Orders", href: "/orders", color: "#0ea5e9" },
    { icon: FileText, label: "Proforma Invoices", href: "/proforma-invoices", color: "#06b6d4" },
    { icon: Package, label: "Products", href: "/products", color: "#fb923c" },
    { icon: MapPin, label: "Freight Lookup", href: "/transport-logistics/lookup", color: "#14b8a6" },
    { icon: BarChart, label: "Reports", href: "/reports", color: "#f472b6" },
    { icon: Package, label: "Inventory", href: "/inventory", color: "#0ea5e9" },
    { icon: Settings, label: "Settings", href: "/settings", color: "#94a3b8" },
  ];

  const supportNavItems = [
    { icon: LayoutDashboard, label: "Support Dashboard", href: "/support-dashboard", color: "#6366f1" },
    { icon: Truck, label: "Dispatch", href: "/dispatch", color: "#f43f5e" },
    { icon: Bell, label: "Activity", href: "/follow-ups", color: "#f59e0b" },
    { icon: Users, label: "Customers", href: "/existing-customers", color: "#6366f1" },
    { icon: ShoppingCart, label: "Orders", href: "/orders", color: "#0ea5e9" },
    { icon: Package, label: "Products", href: "/products", color: "#fb923c" },
    { icon: FileText, label: "Proforma Invoices", href: "/proforma-invoices", color: "#06b6d4" },
    { icon: Settings, label: "Settings", href: "/settings", color: "#94a3b8" },
  ];

  const productionNavItems = [
    { icon: Factory, label: "Production Dashboard", href: "/production/dashboard", color: "#7c3aed" },
    { icon: ClipboardList, label: "Production Orders", href: "/production/orders", color: "#7c3aed" },
    { icon: ShoppingCart, label: "Orders", href: "/orders", color: "#0ea5e9" },
    { icon: Package, label: "Products", href: "/products", color: "#fb923c" },
    { icon: Truck, label: "Dispatch", href: "/dispatch", color: "#f43f5e" },
    { icon: Users, label: "Customers", href: "/existing-customers", color: "#6366f1" },
    { icon: BarChart, label: "Machine Report", href: "/production/machine-report", color: "#7c3aed" },
    { icon: Settings, label: "Settings", href: "/settings", color: "#94a3b8" },
  ];

  const inventoryNavItems = [
    { icon: Package, label: "Inventory", href: "/inventory", color: "#0ea5e9" },
    { icon: Settings, label: "Settings", href: "/settings", color: "#94a3b8" },
  ];

  let navItems: typeof salesNavItems;
  if (isAdmin || isSupport || isProductionOnly) {
    // Multi-workspace roles: filter by active workspace
    switch (workspace) {
      case "production":
        navItems = productionNavItems;
        break;
      case "support":
        navItems = supportNavItems;
        break;
      default:
        navItems = salesNavItems;
    }
  } else if (isInventory) {
    navItems = inventoryNavItems;
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
                style={{ objectFit: 'contain', imageRendering: '-webkit-optimize-contrast' }}
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

        {availableWorkspaces.length > 1 && (
          <div className="px-3 py-2 border-b border-[hsl(250_22%_88%)]">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">Workspace</p>
            <div className="flex gap-1 p-0.5 bg-muted/50 rounded-lg">
              {availableWorkspaces.map(w => (
                <button
                  key={w}
                  className={`flex-1 text-xs py-1.5 px-2 rounded-md transition-all font-medium ${
                    workspace === w
                      ? "bg-white text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => {
                    setWorkspace(w);
                    setLocation(getHomeRoute(w));
                  }}
                >
                  {getWorkspaceLabel(w)}
                </button>
              ))}
            </div>
          </div>
        )}

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
                  {item.href === "/follow-ups" && activityBadgeCount > 0 && (
                    <Badge className="text-[10px] h-5 min-w-5 px-1.5 flex items-center justify-center bg-orange-500 text-white border-0">
                      {activityBadgeCount}
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

      <main className="flex-1 min-w-0 h-full overflow-y-auto" data-scroll-region>
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
                    <p className="text-xs text-muted-foreground truncate">{parseNotesText(a.notes) || "Follow-up call"}</p>
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
          {groupedUnread.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/20">
                New
              </div>
              <div className="divide-y">
                {groupedUnread.slice(0, 10).map(n => (
                  <div key={n.id} className="flex items-start gap-1.5 group">
                    <div
                      className="flex-1 min-w-0 p-3 hover:bg-muted/30 cursor-pointer"
                      onClick={() => { markAsRead(n.id); setBellOpen(false); if (n.link) setLocation(n.link); else openNotificationPanel(n); }}
                    >
                      <p className="text-sm font-medium truncate flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${n.type === "repeat_enquiry" ? "bg-yellow-500" : "bg-blue-500"}`}
                          title={n.type === "repeat_enquiry" ? "Repeat enquiry" : "New lead"}
                        />
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line ml-3.5">{n.message}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 mt-2 mr-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                      title="Dismiss (mark as read)"
                      onClick={() => { markAsRead(n.id); }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
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
                          <p className="text-xs text-muted-foreground">{parseNotesText(a.notes) || "Follow-up call"}</p>
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
          {groupedUnread.length === 0 && todayActivities.length === 0 && (
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
      {visibleNotifications.filter(n => activePopups.has(n.id)).slice(0, 3).map(n => (
        <NotificationPopup
          key={n.id}
          id={n.id}
          title={n.title}
          message={n.message}
          link={n.link}
          type={n.type}
          onDismiss={closePopup}
          onOpen={() => { closePopup(n.id); markAsRead(n.id); if (n.link) setLocation(n.link); else openNotificationPanel(n); }}
        />
      ))}

      {/* Real-time Activity / Call-Due reminder popups */}
      {activityReminders.slice(0, 3).map(r => (
        <NotificationPopup
          key={r.key}
          id={-1}
          title="Call Reminder"
          message={`It's time to call ${r.name}!${r.phone ? `\nPhone: ${r.phone}` : ""}\nNote: ${r.note}`}
          link={r.contactId ? `/leads/${r.contactId}` : "/follow-ups"}
          type="follow_up"
          position="top-right"
          onDismiss={() => dismissActivityReminder(r.key)}
          onOpen={() => {
            dismissActivityReminder(r.key);
            setLocation(r.contactId ? `/leads/${r.contactId}` : "/follow-ups");
          }}
        />
      ))}
    </div>
  );
}
