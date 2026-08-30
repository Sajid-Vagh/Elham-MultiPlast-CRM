import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogin, getGetMeQueryKey, resolveApiUrl } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardFooter } from "@/components/ui/card";
import { Eye, EyeOff, MailCheck, Shield, QrCode, Key, Copy, CheckCircle, Download, ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getHomeRoute, readWorkspace } from "@/lib/use-workspace";
import { reconnectSocket } from "@/lib/socket";

// ═══════════════════════════════════════════════════════════════
// AUTH STATE MACHINE
// Exactly ONE screen renders at any time.
// Server is the source of truth for which screen.
// ═══════════════════════════════════════════════════════════════
type AuthMode =
  | "LOADING"
  | "FIRST_ADMIN_SETUP"
  | "FIRST_ADMIN_VERIFICATION"
  | "FIRST_ADMIN_OTP"
  | "FIRST_ADMIN_MFA_SETUP"
  | "FIRST_ADMIN_MFA_VERIFY"
  | "FIRST_ADMIN_RECOVERY_CODES"
  | "LOGIN"
  | "MFA_CHALLENGE"
  | "ERROR";

// ═══════════════════════════════════════════════════════════════
// USER-FRIENDLY ERROR MAPPING (never expose raw backend errors)
// ═══════════════════════════════════════════════════════════════
function friendlyError(status: number, raw: string): string {
  if (status === 0) return "Unable to connect to the CRM server. Please check your connection and try again.";
  if (status === 401) return "Invalid email/username or password.";
  if (status === 403) return "You don't have permission to perform this action.";
  if (status === 409) return "This account setup has already been started. Please continue verification.";
  if (status === 429) return "Too many attempts. Please wait a few minutes and try again.";
  if (status === 423) return "Account is temporarily locked due to too many failed attempts. Please try again later.";
  if (status === 500) return "Something went wrong. Please try again later.";
  if (status === 400) {
    // Pass through some specific 400 messages that are already user-friendly
    if (raw && raw.length < 120 && !raw.toLowerCase().includes("error")) return raw;
    return "Please check your input and try again.";
  }
  return raw || "Something went wrong. Please try again.";
}

export default function Login() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const login = useLogin();
  const { toast } = useToast();

  const [mode, setMode] = useState<AuthMode>("LOADING");
  const [bootstrapError, setBootstrapError] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingName, setPendingName] = useState("");
  const [pendingMfaToken, setPendingMfaToken] = useState("");
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<string[]>([]);

  // ── Bootstrap: fetch server state on mount ──
  useEffect(() => {
    const token = localStorage.getItem("crm_token");
    fetch(resolveApiUrl("/api/auth/bootstrap-state"), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { mode: string; setupAvailable: boolean; pendingEmail?: string; pendingName?: string }) => {
        setPendingEmail(data.pendingEmail || "");
        setPendingName(data.pendingName || "");
        switch (data.mode) {
          case "FIRST_ADMIN_SETUP": setMode("FIRST_ADMIN_SETUP"); break;
          case "FIRST_ADMIN_VERIFICATION": setMode("FIRST_ADMIN_VERIFICATION"); break;
          case "FIRST_ADMIN_MFA_SETUP": setMode("FIRST_ADMIN_MFA_SETUP"); break;
          default: setMode("LOGIN"); break;
        }
      })
      .catch(() => {
        // Network error or server down: default to login (most common case)
        setMode("LOGIN");
      });
  }, []);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (mode === "LOADING") return;
    const token = localStorage.getItem("crm_token");
    const role = localStorage.getItem("crm_user_role");
    if (token && role && mode === "LOGIN") {
      setLocation(getHomeRoute(readWorkspace(role)));
    }
  }, [mode, setLocation]);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-start sm:justify-center bg-muted/30 p-4 py-4 sm:py-8 overflow-y-auto">
      <div className="w-full max-w-md my-auto py-2">
        {mode === "LOADING" && <LoadingScreen />}
        {mode === "ERROR" && <ErrorScreen error={bootstrapError} onRetry={() => setMode("LOADING")} />}
        {mode === "FIRST_ADMIN_SETUP" && <FirstAdminSetup onSuccess={(email) => { setPendingEmail(email); setMode("FIRST_ADMIN_OTP"); }} />}
        {mode === "FIRST_ADMIN_VERIFICATION" && <PendingVerification pendingEmail={pendingEmail} pendingName={pendingName} onResend={() => setMode("FIRST_ADMIN_OTP")} />}
        {mode === "FIRST_ADMIN_OTP" && <OtpVerification email={pendingEmail} onSuccess={(mfaToken) => { setPendingMfaToken(mfaToken); setMode("FIRST_ADMIN_MFA_SETUP"); }} />}
        {mode === "FIRST_ADMIN_MFA_SETUP" && <MfaSetup email={pendingEmail} mfaSetupToken={pendingMfaToken} onSuccess={(recoveryCodes) => { setPendingRecoveryCodes(recoveryCodes); setMode("FIRST_ADMIN_RECOVERY_CODES"); }} />}
        {mode === "FIRST_ADMIN_MFA_VERIFY" && <MfaSetupVerify email={pendingEmail} onSuccess={(recoveryCodes) => { setPendingRecoveryCodes(recoveryCodes); setMode("FIRST_ADMIN_RECOVERY_CODES"); }} />}
        {mode === "FIRST_ADMIN_RECOVERY_CODES" && <RecoveryCodes codes={pendingRecoveryCodes} />}
        {mode === "LOGIN" && <LoginForm onError={(msg) => { setBootstrapError(msg); setMode("ERROR"); }} />}
        {mode === "MFA_CHALLENGE" && <MfaChallenge />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════

function Logo() {
  return <img src="/images/logo1.png" alt="Elham MultiPlast LLP" className="max-w-[140px] sm:max-w-[160px] w-full h-auto mx-auto" />;
}

function LoadingScreen() {
  return (
    <Card className="shadow-xl border-primary/10">
      <CardHeader className="space-y-4 text-center pb-4 pt-6">
        <div className="mx-auto"><Logo /></div>
        <div className="flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </CardHeader>
    </Card>
  );
}

function ErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Card className="shadow-xl border-primary/10">
      <CardHeader className="space-y-4 text-center pb-4 pt-6">
        <div className="mx-auto"><AlertTriangle className="h-10 w-10 text-amber-500" /></div>
        <CardDescription className="text-foreground">{error}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button variant="outline" className="w-full" onClick={onRetry}>Try Again</Button>
      </CardFooter>
    </Card>
  );
}

function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="shadow-xl border-primary/10">
      <CardHeader className="space-y-4 text-center pb-4 pt-6">
        <div className="mx-auto"><Logo /></div>
        {children}
      </CardHeader>
    </Card>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-3">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FIRST ADMIN SETUP
// ═══════════════════════════════════════════════════════════════
function FirstAdminSetup({ onSuccess }: { onSuccess: (email: string) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("crm_token");
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
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
        setError(friendlyError(res.status, data.error || "Failed to create admin account"));
        return;
      }
      if (data.verificationRequired) {
        onSuccess(email.trim().toLowerCase());
      }
    } catch {
      setError(friendlyError(0, ""));
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
    <Card className="shadow-xl border-primary/10">
      <CardHeader className="space-y-1 text-center pb-2 pt-4">
        <div className="mx-auto"><Logo /></div>
        <CardDescription className="text-sm font-semibold">Set up your CRM</CardDescription>
        <p className="text-[11px] text-muted-foreground">Create the first Administrator account to get started.</p>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-2 pt-1">
          <div className="p-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md text-[11px] text-blue-700 dark:text-blue-300">
            This is a fresh CRM installation. Create the first Admin account to begin.
          </div>
          {error && (
            <div className="p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md text-[11px] text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <div className="space-y-0.5">
            <Label htmlFor="admin-name" className="text-xs font-medium">Full Name</Label>
            <Input id="admin-name" value={name} onChange={e => setName(e.target.value)} required placeholder="Admin" className="bg-background h-8 text-sm" autoFocus />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="admin-email" className="text-xs font-medium">Email Address</Label>
            <Input id="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="admin@elham.com" className="bg-background h-8 text-sm" />
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="admin-password" className="text-xs font-medium">Password</Label>
            <div className="relative">
              <Input id="admin-password" type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} className="bg-background h-8 text-sm pr-10" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1}>
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Min 8 chars (upper, lower, num, spec)</span>
              {strength.label && <span className={`font-medium ${strength.color}`}>Strength: {strength.label}</span>}
            </div>
          </div>
          <div className="space-y-0.5">
            <Label htmlFor="admin-confirm" className="text-xs font-medium">Confirm Password</Label>
            <Input id="admin-confirm" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required className="bg-background h-8 text-sm" />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-1.5 pt-2 pb-4">
          <Button type="submit" className="w-full h-9 text-sm font-medium" disabled={loading}>
            {loading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating Account...</>
            ) : "Create Admin Account"}
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            A verification code will be sent to this email. The account activates only after verification.
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// PENDING VERIFICATION (admin exists but email not verified)
// ═══════════════════════════════════════════════════════════════
function PendingVerification({ pendingEmail, pendingName, onResend }: { pendingEmail: string; pendingName: string; onResend: () => void }) {
  const [resendLoading, setResendLoading] = useState(false);
  const [resent, setResent] = useState(false);

  const handleResend = async () => {
    setResendLoading(true);
    try {
      await fetch(resolveApiUrl("/api/auth/otp/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pendingEmail }),
      });
      setResent(true);
      setTimeout(() => onResend(), 1200);
    } catch {
      // Silently handle — user can try again
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <Card className="shadow-xl border-primary/10">
      <CardHeader className="space-y-3 text-center pb-4 pt-10">
        <div className="mx-auto">
          <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto">
            <MailCheck className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
        </div>
        <CardDescription className="text-lg text-foreground font-medium">Complete your Administrator setup</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">
          {pendingName ? `Hi ${pendingName},` : "Hi,"} your email <span className="font-medium text-foreground">{pendingEmail}</span> has not been verified yet.
        </p>
        <p className="text-sm text-muted-foreground">
          We need to verify your email before you can sign in.
        </p>
        {resent && (
          <div className="p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md text-sm text-green-700 dark:text-green-300">
            A new verification code has been sent. Redirecting...
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <Button className="w-full" onClick={handleResend} disabled={resendLoading}>
          {resendLoading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending verification code...</>
          ) : "Continue Verification"}
        </Button>
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
          Back to Sign In
        </Link>
      </CardFooter>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// OTP VERIFICATION (6-digit code for email verification)
// ═══════════════════════════════════════════════════════════════
function OtpVerification({ email, onSuccess }: { email: string; onSuccess: (mfaToken: string) => void }) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const autoSubmitRef = useRef(false);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown(c => c - 1), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6 && !autoSubmitRef.current) {
      autoSubmitRef.current = true;
      verifyCode(code);
    }
  }, [code]);

  const verifyCode = async (otp: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(resolveApiUrl("/api/auth/otp/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(friendlyError(res.status, data.error || "Invalid code"));
        setCode("");
        autoSubmitRef.current = false;
        return;
      }
      onSuccess(data.mfaSetupToken || "");
    } catch {
      setError(friendlyError(0, ""));
      autoSubmitRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendCooldown(60);
    try {
      await fetch(resolveApiUrl("/api/auth/otp/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      toast({ title: "Verification code sent" });
    } catch {
      // Silently handle
    }
  };

  return (
    <Card className="shadow-xl border-primary/10">
      <CardHeader className="space-y-3 text-center pb-4 pt-10">
        <div className="mx-auto">
          <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto">
            <MailCheck className="h-7 w-7 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        <CardDescription className="text-lg text-foreground font-medium">Verify your email</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Enter the 6-digit code sent to <span className="font-medium text-foreground">{email}</span>
        </p>
        <Input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={e => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            setError("");
            autoSubmitRef.current = false;
          }}
          onKeyDown={e => { if (e.key === "Enter" && code.length === 6 && !loading) { autoSubmitRef.current = true; verifyCode(code); } }}
          placeholder="000000"
          className="text-center text-lg font-mono tracking-widest bg-background"
          autoFocus
          disabled={loading}
        />
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <Button className="w-full" onClick={() => { autoSubmitRef.current = true; verifyCode(code); }} disabled={code.length !== 6 || loading}>
          {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying...</> : "Verify Code"}
        </Button>
        <div className="text-center">
          <button
            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={handleResend}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend verification code"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// MFA SETUP (QR code + manual key + verify)
// ═══════════════════════════════════════════════════════════════
function MfaSetup({ email, mfaSetupToken, onSuccess }: { email: string; mfaSetupToken: string; onSuccess: (recoveryCodes: string[]) => void }) {
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "scan" | "verifying" | "error">("loading");
  const [qrCode, setQrCode] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (mfaSetupToken) {
      fetchQrCode(mfaSetupToken);
    } else {
      setState("error");
      setError("No MFA setup session found. Please complete email verification first.");
    }
  }, [mfaSetupToken]);

  const fetchQrCode = async (token: string) => {
    try {
      const res = await fetch(resolveApiUrl("/api/auth/mfa/setup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaSetupToken: token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(friendlyError(res.status, data.error || "Failed to initialize MFA setup"));
        setState("error");
        return;
      }
      setQrCode(data.qrCode);
      setManualKey(data.manualKey);
      setState("scan");
    } catch {
      setError(friendlyError(0, ""));
      setState("error");
    }
  };

  const handleVerify = async () => {
    if (!code || code.length !== 6) return;
    setState("verifying");
    setError("");

    try {
      const res = await fetch(resolveApiUrl("/api/auth/mfa/verify-setup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaSetupToken, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(friendlyError(res.status, data.error || "Invalid code. Please try again."));
        setState("scan");
        setCode("");
        return;
      }

      // Store session
      if (data.token && data.user) {
        localStorage.setItem("crm_token", data.token);
        localStorage.setItem("crm_user_role", data.user.role);
        localStorage.setItem("crm_user_unit", data.user.unit || "All");
      }

      // Pass recovery codes to next screen
      if (data.recoveryCodes) {
        onSuccess(data.recoveryCodes);
      } else {
        onSuccess([]);
      }
    } catch {
      setError(friendlyError(0, ""));
      setState("scan");
    }
  };

  return (
    <Card className="shadow-xl border-primary/10">
      <CardHeader className="space-y-3 text-center pb-4 pt-10">
        <div className="mx-auto">
          <div className="w-14 h-14 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mx-auto">
            <Shield className="h-7 w-7 text-purple-600 dark:text-purple-400" />
          </div>
        </div>
        <CardDescription className="text-lg text-foreground font-medium">Secure your account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {state === "loading" && <Spinner text="Generating QR code..." />}

        {state === "error" && (
          <div className="text-center space-y-3">
            <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
            <Link href="/login" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Back to Login
            </Link>
          </div>
        )}

        {state === "scan" && (
          <>
            <p className="text-sm text-muted-foreground text-center">
              Set up two-factor authentication using an authenticator app.
            </p>

            {/* QR Code */}
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <QrCode className="h-4 w-4" /> Scan QR code
              </p>
              <div className="flex justify-center">
                <div className="bg-white p-3 rounded-xl border shadow-sm">
                  <img src={qrCode} alt="MFA QR Code" className="w-44 h-44" />
                </div>
              </div>
            </div>

            {/* Manual Key */}
            <div className="space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Key className="h-4 w-4" /> Or enter this key manually
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono break-all select-all">
                  {manualKey}
                </code>
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(manualKey); toast({ title: "Key copied" }); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Code Input */}
            <div className="space-y-2 pt-2 border-t">
              <Label className="text-sm font-medium">Enter the 6-digit code from your app</Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
                onKeyDown={e => { if (e.key === "Enter" && code.length === 6) handleVerify(); }}
                placeholder="000000"
                className="text-center text-lg font-mono tracking-widest bg-background"
                autoFocus
              />
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              <Button className="w-full" onClick={handleVerify} disabled={code.length !== 6}>
                Verify & Enable Two-Factor Authentication
              </Button>
            </div>
          </>
        )}

        {state === "verifying" && <Spinner text="Verifying..." />}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// MFA SETUP VERIFY (after scanning QR, verifies code + shows recovery)
// ═══════════════════════════════════════════════════════════════
function MfaSetupVerify({ email, onSuccess }: { email: string; onSuccess: (recoveryCodes: string[]) => void }) {
  return <Spinner text="Activating your account..." />;
}

// ═══════════════════════════════════════════════════════════════
// RECOVERY CODES (shown once after MFA setup)
// ═══════════════════════════════════════════════════════════════
function RecoveryCodes({ codes }: { codes: string[] }) {
  const [, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);

  const copyCodes = () => {
    navigator.clipboard.writeText(codes.join("\n"));
    setCopied(true);
  };

  const downloadCodes = () => {
    const blob = new Blob([codes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "elham-crm-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  // If no codes (e.g., page refreshed), skip to dashboard
  useEffect(() => {
    if (codes.length === 0) {
      const role = localStorage.getItem("crm_user_role") || "admin";
      setLocation(getHomeRoute(readWorkspace(role)));
    }
  }, [codes, setLocation]);

  if (codes.length === 0) return null;

  return (
    <Card className="shadow-xl border-primary/10">
      <CardHeader className="space-y-3 text-center pb-4 pt-10">
        <div className="mx-auto">
          <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            <CheckCircle className="h-7 w-7 text-green-600 dark:text-green-400" />
          </div>
        </div>
        <CardDescription className="text-lg text-foreground font-medium">Save your recovery codes</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
            These codes can be used if you lose access to your authenticator.
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Each code can only be used once. Store them somewhere safe.
          </p>
        </div>
        <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-1">
          {codes.map((code, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-muted-foreground w-6 text-right">{i + 1}.</span>
              <span className="font-bold">{code}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={copyCodes}>
            {copied ? <><CheckCircle className="h-4 w-4 mr-1" /> Copied!</> : <><Copy className="h-4 w-4 mr-1" /> Copy codes</>}
          </Button>
          <Button variant="outline" className="flex-1" onClick={downloadCodes}>
            <Download className="h-4 w-4 mr-1" /> Download
          </Button>
        </div>
      </CardContent>
      <CardFooter>
        <Button className="w-full" onClick={() => {
          const role = localStorage.getItem("crm_user_role") || "admin";
          setLocation(getHomeRoute(readWorkspace(role)));
        }}>
          Continue to CRM
        </Button>
      </CardFooter>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// LOGIN FORM
// ═══════════════════════════════════════════════════════════════
function LoginForm({ onError }: { onError: (msg: string) => void }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const login = useLogin();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Load Google Identity Services
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
    if (!clientId) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredentialResponse });
      }
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);

  const handleGoogleCredentialResponse = async (response: { credential: string }) => {
    setGoogleLoading(true);
    try {
      const res = await fetch(resolveApiUrl("/api/auth/google"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: response.credential }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Google Login Failed", description: friendlyError(res.status, data.error || "Account not authorized"), variant: "destructive" });
        return;
      }
      localStorage.setItem("crm_token", data.token);
      localStorage.setItem("crm_user_role", data.user.role);
      localStorage.setItem("crm_user_unit", data.user.unit || "All");
      queryClient.clear();
      queryClient.setQueryData(getGetMeQueryKey(), data.user);
      reconnectSocket();
      setLocation(getHomeRoute(readWorkspace(data.user.role)));
    } catch {
      toast({ title: "Google Login Failed", description: friendlyError(0, ""), variant: "destructive" });
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ data: { username: email, password } as any }, {
      onSuccess: (data: any) => {
        if (data.mfaRequired && data.mfaToken) {
          setLocation(`/mfa-verify?token=${data.mfaToken}`);
          return;
        }
        localStorage.setItem("crm_token", data.token);
        localStorage.setItem("crm_user_role", data.user.role);
        localStorage.setItem("crm_user_unit", data.user.unit || "All");
        queryClient.clear();
        queryClient.setQueryData(getGetMeQueryKey(), data.user);
        reconnectSocket();
        const ws = readWorkspace(data.user.role);
        setLocation(getHomeRoute(ws));
      },
      onError: (err: any) => {
        const status = err?.status || err?.statusCode || 0;
        const rawMsg = err?.message || err?.error || "";
        // For network errors or generic errors, show friendly message
        if (status === 0 || !status) {
          toast({ title: "Login Failed", description: friendlyError(0, ""), variant: "destructive" });
        } else {
          toast({ title: "Login Failed", description: friendlyError(status, rawMsg), variant: "destructive" });
        }
      },
    });
  };

  const handleGoogleLogin = () => {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
    } else {
      toast({ title: "Google Login", description: "Google Sign-In is not available. Please use email and password.", variant: "destructive" });
    }
  };

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

  return (
    <Card className="shadow-xl border-primary/10">
      <CardHeader className="space-y-3 text-center pb-4 pt-10">
        <div className="mx-auto"><Logo /></div>
        <CardDescription className="text-base">Welcome back</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login-email">Email or Username</Label>
            <Input
              id="login-email"
              type="text"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="username"
              placeholder="you@example.com or username"
              className="bg-background"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password">Password</Label>
              <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                Forgot Password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="bg-background pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Signing in...</>
            ) : "Sign In"}
          </Button>
          {googleClientId && (
            <>
              <div className="relative w-full">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={handleGoogleLogin} disabled={googleLoading}>
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {googleLoading ? "Connecting..." : "Continue with Google"}
              </Button>
            </>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// MFA CHALLENGE (during login when MFA is enabled)
// ═══════════════════════════════════════════════════════════════
function MfaChallenge() {
  // This is handled by the existing mfa-verify.tsx page
  // This state is here for completeness — the login form redirects there
  return <Spinner text="Redirecting to MFA verification..." />;
}

// ═══════════════════════════════════════════════════════════════
// GLOBAL TYPES
// ═══════════════════════════════════════════════════════════════
declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          prompt: () => void;
        };
      };
    };
  }
}
