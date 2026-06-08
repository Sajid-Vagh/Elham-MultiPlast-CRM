import { useEffect, useRef } from "react";
import { useGetMe, useLogout, useListContacts, getListContactsQueryKey } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Briefcase,
  Package, BarChart, Download, Copy, Settings, LogOut
} from "lucide-react";
import { Button } from "./ui/button";

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

function useAssignmentNotifications(userId: number | undefined, isAdmin: boolean) {
  const sinceRef = useRef<string | null>(null);
  const initialLoadRef = useRef(true);

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
        refetchInterval: 60_000,
        staleTime: 30_000,
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
    if (newOnes.length > 0 && Notification.permission === "granted") {
      const first = newOnes[0]!;
      new Notification(`New enquiry assigned to you`, {
        body: `${first.name}${first.city ? ` from ${first.city}` : ""} — tap to view`,
        icon: "/favicon.ico",
        tag: `crm-assign-${first.id}`,
      });
    }
    const now = new Date().toISOString();
    sinceRef.current = now;
    sessionStorage.setItem("crm_notif_since", now);
  }, [myContacts, userId, isAdmin]);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();
  const [location, setLocation] = useLocation();
  const logout = useLogout();

  useFollowUpNotifications(user?.id);
  useAssignmentNotifications(user?.id, user?.role === "admin");

  useEffect(() => {
    if (!isLoading && !user) setLocation("/login");
  }, [isLoading, user, setLocation]);

  if (isLoading) return <div>Loading...</div>;
  if (!user) return null;

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard", color: "#a78bfa" },
    { icon: Users, label: "Leads", href: "/leads", color: "#60a5fa" },
    { icon: Briefcase, label: "Deals", href: "/deals", color: "#34d399" },
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
          <h1 className="text-lg font-bold tracking-tight" style={{ color: "hsl(258 78% 45%)" }}>
            Elham MultiPlast LLP
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "hsl(248 16% 55%)" }}>CRM System</p>
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
                  <span className="text-sm font-medium">{item.label}</span>
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
    </div>
  );
}
