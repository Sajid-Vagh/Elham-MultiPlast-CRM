import { useEffect, useRef } from "react";
import { useGetMe, useLogout, useListContacts, getListContactsQueryKey } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Briefcase,
  Package, BarChart, Download, Copy, Settings, LogOut, Bell
} from "lucide-react";
import { Button } from "./ui/button";

function useFollowUpNotifications(enabled: boolean) {
  const { data: dueContacts } = useListContacts(
    { followUpDue: true },
    { query: { enabled, staleTime: 5 * 60 * 1000, queryKey: getListContactsQueryKey({ followUpDue: true }) } }
  );
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !dueContacts?.length || notifiedRef.current) return;

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

    if (Notification.permission === "granted") {
      fire();
    } else if (Notification.permission === "default") {
      Notification.requestPermission().then(p => { if (p === "granted") fire(); });
    }
  }, [enabled, dueContacts]);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();
  const [location, setLocation] = useLocation();
  const logout = useLogout();

  useFollowUpNotifications(!!user);

  if (isLoading) return <div>Loading...</div>;

  if (!user) {
    setLocation("/login");
    return null;
  }

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: Users, label: "Leads", href: "/leads" },
    { icon: Briefcase, label: "Deals", href: "/deals" },
    { icon: Package, label: "Products", href: "/products" },
    { icon: BarChart, label: "Reports", href: "/reports" },
    { icon: Download, label: "Import", href: "/import" },
    { icon: Copy, label: "Duplicates", href: "/duplicates" },
    ...(user.role === 'admin' ? [{ icon: Settings, label: "Settings", href: "/settings" }] : []),
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-xl font-bold tracking-tight text-primary">Elham Multiplast</h1>
          <p className="text-xs text-muted-foreground mt-1">CRM System</p>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} href={item.href}>
                <div className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${isActive ? 'bg-primary text-primary-foreground font-medium' : 'text-foreground hover:bg-accent'}`}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: user.colorCode || '#888' }}
            >
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.unit}</p>
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start text-muted-foreground"
            onClick={() => {
              logout.mutate(undefined, {
                onSuccess: () => {
                  localStorage.removeItem("crm_token");
                  setLocation("/login");
                }
              });
            }}
          >
            <LogOut className="h-4 w-4 mr-2" />
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
