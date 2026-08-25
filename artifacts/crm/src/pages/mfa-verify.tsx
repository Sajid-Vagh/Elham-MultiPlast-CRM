import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, resolveApiUrl } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, ArrowLeft, Loader2, Key } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getHomeRoute, readWorkspace } from "@/lib/use-workspace";
import { reconnectSocket } from "@/lib/socket";

/**
 * MFA Verification page — shown during login when MFA is enabled.
 * User enters their 6-digit authenticator code (or recovery code).
 */
export default function MfaVerify() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Read mfaToken from URL params
  const mfaToken = new URLSearchParams(window.location.search).get("token") || "";

  const handleVerify = async () => {
    if (!mfaToken) {
      toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
      setLocation("/login");
      return;
    }

    if (!code) return;
    setLoading(true);
    setError("");

    try {
      const body: Record<string, string> = { mfaToken };
      if (mode === "totp") {
        body.code = code;
      } else {
        body.recoveryCode = code;
      }

      const res = await fetch(resolveApiUrl("/api/auth/mfa/verify-login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Invalid code");
        setCode("");
        setLoading(false);
        return;
      }

      // Login successful
      localStorage.setItem("crm_token", data.token);
      localStorage.setItem("crm_user_role", data.user.role);
      localStorage.setItem("crm_user_unit", data.user.unit || "All");
      queryClient.clear();
      queryClient.setQueryData(getGetMeQueryKey(), data.user);
      reconnectSocket();

      const ws = readWorkspace(data.user.role);
      setLocation(getHomeRoute(ws));
    } catch {
      setError("Could not connect to server");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm shadow-xl border-primary/10">
        <CardHeader className="space-y-4 text-center pb-4 pt-7">
          <div className="mx-auto">
            <Shield className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-xl">Two-Factor Authentication</CardTitle>
          <CardDescription>
            {mode === "totp"
              ? "Enter the 6-digit code from your authenticator app."
              : "Enter one of your recovery codes."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {mode === "totp" ? (
            <div className="space-y-3">
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  setError("");
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" && code.length === 6) handleVerify();
                }}
                placeholder="000000"
                className="text-center text-lg font-mono tracking-widest bg-background"
                autoFocus
                disabled={loading}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <Input
                type="text"
                value={code}
                onChange={e => { setCode(e.target.value); setError(""); }}
                onKeyDown={e => {
                  if (e.key === "Enter" && code) handleVerify();
                }}
                placeholder="XXXX-XXXX-XXXX"
                className="text-center font-mono tracking-wider bg-background"
                autoFocus
                disabled={loading}
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <Button
            className="w-full"
            onClick={handleVerify}
            disabled={!code || loading}
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying...</>
            ) : mode === "totp" ? (
              "Verify Code"
            ) : (
              "Use Recovery Code"
            )}
          </Button>

          <div className="text-center">
            {mode === "totp" ? (
              <button
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => { setMode("recovery"); setCode(""); setError(""); }}
              >
                <Key className="h-3.5 w-3.5 inline mr-1" />
                Use a recovery code instead
              </button>
            ) : (
              <button
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => { setMode("totp"); setCode(""); setError(""); }}
              >
                Use authenticator code instead
              </button>
            )}
          </div>

          <div className="text-center pt-2 border-t">
            <Link href="/login" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Back to Login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
