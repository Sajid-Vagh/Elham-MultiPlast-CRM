import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardFooter, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { resolveApiUrl } from "@workspace/api-client-react";

/**
 * First-Admin bootstrap form.
 *
 * This is NOT public registration: the CRM has no signup. This card exists
 * ONLY while no Admin account exists yet AND the server reports that the
 * secure bootstrap conditions are satisfiable (setup-status
 * `bootstrapAvailable`). Submission stores the admin INACTIVE and emails a
 * verification link — the account is activated only after that link is
 * opened. All other users are created/invited by an Admin from inside the CRM.
 */
export function AdminSetupForm() {
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(null);

  // Send the current session token (if any) so an authenticated user of any
  // role can bootstrap the first Admin when no Admin exists yet.
  const authHeaders = (): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

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
        headers: authHeaders(),
        body: JSON.stringify({ name, email, password, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast({ title: "Setup Failed", description: data.error || "Failed to create admin account", variant: "destructive" });
        return;
      }

      if (data.verificationRequired) {
        setVerificationSentTo(email);
        return;
      }
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

  if (verificationSentTo !== null) {
    return (
      <Card className="w-full max-w-md shadow-xl border-primary/10">
        <CardHeader className="space-y-4 text-center pb-4 pt-7">
          <div className="mx-auto">
            <MailCheck className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-xl">Verify your email</CardTitle>
          <CardDescription>
            We sent a verification link to <span className="font-medium text-foreground">{verificationSentTo}</span>.
            Open it to activate the first Admin account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md text-sm text-blue-700 dark:text-blue-300">
            The account stays inactive until the emailed link is opened. The link expires in 24 hours.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md shadow-xl border-primary/10">
      <CardHeader className="space-y-1 text-center pb-2 pt-4">
        <div className="mx-auto">
          <img src="/images/logo1.png" alt="Elham MultiPlast LLP" className="max-w-[140px] sm:max-w-[160px] w-full h-auto mx-auto" />
        </div>
        <CardDescription className="text-sm font-semibold">Create your first Admin account to get started</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-2 pt-1">
          <div className="p-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md text-[11px] text-blue-700 dark:text-blue-300">
            This is a fresh CRM installation. Create the first Admin account to begin.
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="setup-name" className="text-xs font-medium">Full Name</Label>
            <Input
              id="setup-name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="John Doe"
              className="bg-background h-8 text-sm"
            />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="setup-email" className="text-xs font-medium">Email Address</Label>
            <Input
              id="setup-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="admin@elham.com"
              className="bg-background h-8 text-sm"
            />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="setup-password" className="text-xs font-medium">Password</Label>
            <div className="relative">
              <Input
                id="setup-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                className="bg-background h-8 text-sm pr-10"
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
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Min 8 chars (upper, lower, num, spec)</span>
              {strength.label && (
                <span className={`font-medium ${strength.color}`}>Strength: {strength.label}</span>
              )}
            </div>
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="setup-confirm-password" className="text-xs font-medium">Confirm Password</Label>
            <Input
              id="setup-confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              className="bg-background h-8 text-sm"
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-1.5 pt-2 pb-4">
          <Button type="submit" className="w-full h-9 text-sm font-medium" disabled={loading}>
            {loading ? "Creating Account..." : "Create Admin Account"}
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            A verification link will be sent to this email. The account activates only after verification.
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
