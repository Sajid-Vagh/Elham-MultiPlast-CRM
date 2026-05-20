import { useGetMe, useLogout } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, Users, UserPlus, Briefcase, 
  Package, BarChart, Download, Copy, Settings, LogOut
} from "lucide-react";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useGetMe();
  const [location, setLocation] = useLocation();
  const logout = useLogout();

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
