import { useState, useEffect, useCallback } from "react";
import { useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Shield, Key, Smartphone, Monitor, Lock, AlertTriangle, CheckCircle, Trash2, RefreshCw, Eye, EyeOff, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { resolveApiUrl } from "@workspace/api-client-react";

type MfaStatus = { mfaEnabled: boolean; mfaVerifiedAt: string | null; email: string };
type Session = { id: number; ipAddress: string; userAgent: string; device: string; isCurrent: boolean; createdAt: string; expiresAt: string; lastUsedAt: string | null };
type AuditEvent = { id: number; entityType: string; entityId: number; action: string; newValue: any; ipAddress: string; createdAt: string };

function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem("crm_token");
  return fetch(resolveApiUrl(url), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
}

export default function Security() {
  const { data: me } = useGetMe();
  const { toast } = useToast();

  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  // Change password state
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwMfaCode, setPwMfaCode] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwShowMfa, setPwShowMfa] = useState(false);

  // Disable MFA state
  const [disablePw, setDisablePw] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);

  // Recovery codes
  const [recoveryCount, setRecoveryCount] = useState<number | null>(null);
  const [newRecoveryCodes, setNewRecoveryCodes] = useState<string[]>([]);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenPw, setRegenPw] = useState("");

  // Sessions
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const fetchMfaStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/mfa/status");
      if (res.ok) setMfaStatus(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await authFetch("/api/auth/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions);
      }
    } catch { /* ignore */ }
    setSessionsLoading(false);
  }, []);

  const fetchRecoveryCount = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/mfa/recovery-codes");
      if (res.ok) {
        const data = await res.json();
        setRecoveryCount(data.remaining);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchAuditLog = useCallback(async () => {
    try {
      const res = await authFetch("/api/security/activity");
      if (res.ok) {
        const data = await res.json();
        setAuditEvents(data.events || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchMfaStatus();
    fetchSessions();
    fetchRecoveryCount();
    fetchAuditLog();
  }, [fetchMfaStatus, fetchSessions, fetchRecoveryCount, fetchAuditLog]);

  const handleChangePassword = async () => {
    if (!pwCurrent || !pwNew || !pwConfirm) return;
    if (pwNew !== pwConfirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setPwLoading(true);
    try {
      const body: Record<string, string> = {
        currentPassword: pwCurrent,
        newPassword: pwNew,
        confirmPassword: pwConfirm,
      };
      if (pwMfaCode) body.mfaCode = pwMfaCode;

      const res = await authFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.mfaRequired) {
          setPwShowMfa(true);
          toast({ title: "MFA code required", description: "Enter your authenticator code to change password.", variant: "destructive" });
        } else {
          toast({ title: data.error || "Failed", variant: "destructive" });
        }
        return;
      }

      toast({ title: "Password changed", description: "Other sessions have been logged out." });
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
      setPwMfaCode("");
      setPwShowMfa(false);
      fetchSessions();
    } catch {
      toast({ title: "Could not connect to server", variant: "destructive" });
    }
    setPwLoading(false);
  };

  const handleDisableMfa = async () => {
    if (!disablePw || !disableCode) return;
    setDisableLoading(true);
    try {
      const res = await authFetch("/api/auth/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ password: disablePw, code: disableCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed", variant: "destructive" });
        return;
      }
      toast({ title: "MFA disabled" });
      setMfaStatus(prev => prev ? { ...prev, mfaEnabled: false } : null);
      setDisablePw("");
      setDisableCode("");
      fetchAuditLog();
    } catch {
      toast({ title: "Could not connect to server", variant: "destructive" });
    }
    setDisableLoading(false);
  };

  const handleRegenRecoveryCodes = async () => {
    if (!regenPw) return;
    setRegenLoading(true);
    try {
      const res = await authFetch("/api/auth/mfa/recovery-codes/regenerate", {
        method: "POST",
        body: JSON.stringify({ password: regenPw }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed", variant: "destructive" });
        return;
      }
      setNewRecoveryCodes(data.recoveryCodes || []);
      setRecoveryCount(data.recoveryCodes?.length || 0);
      setRegenPw("");
      fetchAuditLog();
    } catch {
      toast({ title: "Could not connect to server", variant: "destructive" });
    }
    setRegenLoading(false);
  };

  const handleRevokeSession = async (sessionId: number) => {
    try {
      const res = await authFetch(`/api/auth/sessions/${sessionId}`, { method: "DELETE" });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        toast({ title: "Session revoked" });
      }
    } catch {
      toast({ title: "Failed to revoke session", variant: "destructive" });
    }
  };

  const handleRevokeAll = async () => {
    try {
      const res = await authFetch("/api/auth/sessions/revoke-others", { method: "POST" });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.isCurrent));
        toast({ title: "All other sessions revoked" });
      }
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    }
  };

  const formatAction = (action: string) => {
    const map: Record<string, string> = {
      password_changed: "Password changed",
      mfa_enabled: "MFA enabled",
      mfa_disabled: "MFA disabled",
      login_mfa_verified: "Login MFA verified",
      mfa_login_verification_failed: "Login MFA failed",
      mfa_setup_verification_failed: "MFA setup failed",
      otp_verification_success: "OTP verified",
      otp_verification_failed: "OTP failed",
      first_admin_activated: "First admin activated",
      recovery_code_used: "Recovery code used",
      recovery_codes_regenerated: "Recovery codes regenerated",
      session_revoked: "Session revoked",
      all_other_sessions_revoked: "All sessions revoked",
    };
    return map[action] || action;
  };

  const strength = (pw: string) => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    return score;
  };

  const pwScore = strength(pwNew);
  const pwLabels = ["Very Weak", "Weak", "Fair", "Good", "Strong", "Excellent"];
  const pwColors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-lime-500", "bg-green-500", "bg-emerald-600"];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Security</h1>
        <p className="text-muted-foreground mt-1">Manage your password, two-factor authentication, and sessions</p>
      </div>

      {/* MFA Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-primary" />
            Two-Factor Authentication
          </CardTitle>
          <CardDescription>Add an extra layer of security to your account with an authenticator app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mfaStatus === null ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : mfaStatus.mfaEnabled ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 border border-green-200 dark:bg-green-950 dark:border-green-800">
                <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-800 dark:text-green-200">MFA is enabled</p>
                  <p className="text-xs text-green-700 dark:text-green-300">
                    Enabled {mfaStatus.mfaVerifiedAt ? new Date(mfaStatus.mfaVerifiedAt).toLocaleDateString() : ""}
                  </p>
                </div>
              </div>

              {/* Recovery Codes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Recovery Codes</p>
                    <p className="text-xs text-muted-foreground">
                      {recoveryCount !== null ? `${recoveryCount} codes remaining` : "Loading..."}
                    </p>
                  </div>
                  {mfaStatus.mfaEnabled && (
                    <Button variant="outline" size="sm" onClick={() => {
                      const el = document.getElementById("regen-codes-section");
                      el?.scrollIntoView({ behavior: "smooth" });
                    }}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" /> Regenerate
                    </Button>
                  )}
                </div>

                {newRecoveryCodes.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-amber-800 mb-2">New Recovery Codes</p>
                    <p className="text-xs text-amber-700 mb-3">Save these somewhere safe. They won't be shown again.</p>
                    <div className="bg-white rounded border p-3 font-mono text-sm space-y-1 mb-3">
                      {newRecoveryCodes.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-muted-foreground w-6 text-right">{i + 1}.</span>
                          <span className="font-bold">{c}</span>
                        </div>
                      ))}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => {
                      navigator.clipboard.writeText(newRecoveryCodes.join("\n"));
                      toast({ title: "Copied to clipboard" });
                    }}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy Codes
                    </Button>
                  </div>
                )}

                <div id="regen-codes-section" className="space-y-2">
                  <Label className="text-sm">Enter password to regenerate codes</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={regenPw}
                      onChange={e => setRegenPw(e.target.value)}
                      placeholder="Your password"
                      className="max-w-xs"
                    />
                    <Button variant="outline" onClick={handleRegenRecoveryCodes} disabled={!regenPw || regenLoading}>
                      {regenLoading ? "Generating..." : "Regenerate"}
                    </Button>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Disable MFA */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-destructive">Disable MFA</p>
                <p className="text-xs text-muted-foreground">This will remove two-factor authentication from your account. Not recommended.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input type="password" value={disablePw} onChange={e => setDisablePw(e.target.value)} placeholder="Password" />
                  <Input value={disableCode} onChange={e => setDisableCode(e.target.value)} placeholder="MFA code" maxLength={6} />
                </div>
                <Button variant="destructive" onClick={handleDisableMfa} disabled={!disablePw || !disableCode || disableLoading}>
                  {disableLoading ? "Disabling..." : "Disable MFA"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <p className="text-sm">MFA is not enabled on your account.</p>
                <p className="text-xs text-muted-foreground mt-1">Enable it from the Setup MFA page to protect your account with an authenticator app.</p>
              </div>
              <Button onClick={() => window.location.href = "/setup-mfa"}>
                <Smartphone className="h-4 w-4 mr-1" /> Enable MFA
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-primary" />
            Change Password
          </CardTitle>
          <CardDescription>Update your password regularly to keep your account secure.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Current Password</Label>
            <Input type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} placeholder="Enter current password" className="max-w-md" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">New Password</Label>
            <Input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Enter new password" className="max-w-md" />
            {pwNew && (
              <div className="space-y-1 max-w-md">
                <div className="flex gap-1 h-1.5">
                  {[0, 1, 2, 3, 4].map(i => (
                    <div key={i} className={`flex-1 rounded-full transition-colors ${i < pwScore ? pwColors[pwScore] : "bg-muted"}`} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{pwLabels[pwScore]}</p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Confirm New Password</Label>
            <Input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="Confirm new password" className="max-w-md" />
          </div>
          {pwShowMfa && (
            <div className="space-y-2">
              <Label className="text-sm">MFA Code</Label>
              <Input value={pwMfaCode} onChange={e => setPwMfaCode(e.target.value)} placeholder="6-digit code" maxLength={6} className="max-w-xs" />
            </div>
          )}
          {pwConfirm && pwNew !== pwConfirm && (
            <p className="text-xs text-destructive">Passwords do not match</p>
          )}
          <Button onClick={handleChangePassword} disabled={!pwCurrent || !pwNew || !pwConfirm || pwNew !== pwConfirm || pwLoading}>
            {pwLoading ? "Changing..." : "Change Password"}
          </Button>
        </CardContent>
      </Card>

      {/* Active Sessions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Monitor className="h-4 w-4 text-primary" />
            Active Sessions
          </CardTitle>
          <CardDescription>Sessions are where you're currently logged in. Revoke any you don't recognise.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            <>
              <div className="space-y-3">
                {sessions.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                        {s.device.includes("Mobile") ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {s.device}
                          {s.isCurrent && <Badge variant="outline" className="ml-2 text-[10px]">Current</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.ipAddress} &middot; {new Date(s.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {!s.isCurrent && (
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleRevokeSession(s.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {sessions.length > 1 && (
                <Button variant="outline" onClick={handleRevokeAll}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" /> Revoke All Other Sessions
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Security Activity Log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-primary" />
            Security Activity
          </CardTitle>
          <CardDescription>Recent security events on your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {auditEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent security activity.</p>
          ) : (
            <div className="space-y-2">
              {auditEvents.map(e => (
                <div key={e.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      e.action.includes("failed") ? "bg-red-500" :
                      e.action.includes("disabled") ? "bg-amber-500" :
                      "bg-green-500"
                    }`} />
                    <span className="text-sm">{formatAction(e.action)}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</p>
                    {e.ipAddress && <p className="text-xs text-muted-foreground/60">{e.ipAddress}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
