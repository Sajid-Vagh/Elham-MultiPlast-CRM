import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardFooter } from "@/components/ui/card";
import { Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getHomeRoute } from "@/lib/use-workspace";
import { resolveApiUrl } from "@workspace/api-client-react";

export default function AdminSetup() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adminExists, setAdminExists] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(resolveApiUrl("/api/auth/setup-status"))
      .then(r => r.json())
      .then((data: { adminExists: boolean }) => {
        setAdminExists(data.adminExists);
        if (data.adminExists) {
          setLocation("/login");
        }
      })
      .catch(() => setAdminExists(false));
  }, [setLocation]);

  if (adminExists === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (adminExists) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({ title: "Error", description: "Passwords do not match", variant: "destructive" });
      return;
    }

    if (password.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(resolveApiUrl("/api/auth/admin/setup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({ title: "Setup Failed", description: data.error || "Failed to create admin account", variant: "destructive" });
        return;
      }

      localStorage.setItem("crm_token", data.token);
      localStorage.setItem("crm_user_role", data.user.role);
      localStorage.setItem("crm_user_unit", data.user.unit || "All");
      queryClient.setQueryData(getGetMeQueryKey(), data.user);

      toast({ title: "Admin Account Created", description: "Welcome to Elham MultiPlast CRM!" });
      setLocation(getHomeRoute("sales"));
    } catch {
      toast({ title: "Setup Failed", description: "Could not connect to server", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = (pwd: string): { label: string; color: string } => {
    if (pwd.length === 0) return { label: "", color: "" };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;
    if (score <= 2) return { label: "Weak", color: "text-red-500" };
    if (score <= 3) return { label: "Fair", color: "text-yellow-500" };
    if (score <= 4) return { label: "Good", color: "text-blue-500" };
    return { label: "Strong", color: "text-green-500" };
  };

  const strength = passwordStrength(password);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-xl border-primary/10">
        <CardHeader className="space-y-4 text-center pb-4 pt-7">
          <div className="mx-auto">
            <img src="/images/logo1.png" alt="Elham MultiPlast LLP" className="max-w-[200px] w-full h-auto mx-auto" />
          </div>
          <CardDescription>Create your first Admin account to get started</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md text-sm text-blue-700 dark:text-blue-300">
              This is a fresh CRM installation. Create the first Admin account to begin.
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="John Doe"
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="admin@elham.com"
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="bg-background pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {strength.label && (
                <p className={`text-xs ${strength.color}`}>Password strength: {strength.label}</p>
              )}
              <p className="text-xs text-muted-foreground">Min 8 chars, upper, lower, number, special character</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                className="bg-background"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Creating Account..." : "Create Admin Account"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
