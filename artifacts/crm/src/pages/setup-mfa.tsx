import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, resolveApiUrl } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, QrCode, Key, Copy, CheckCircle, AlertTriangle, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getHomeRoute, readWorkspace } from "@/lib/use-workspace";
import { reconnectSocket } from "@/lib/socket";

type SetupState = "loading" | "scan" | "verify" | "success" | "error";

/**
 * MFA Setup page — shows QR code + manual key for TOTP setup.
 * Used during first-admin activation and when enabling MFA from security settings.
 */
export default function SetupMfa() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [state, setState] = useState<SetupState>("loading");
  const [qrCode, setQrCode] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesCopied, setCodesCopied] = useState(false);

  // First-admin flow: token from URL
  const isFirstAdminFlow = new URLSearchParams(window.location.search).get("token") !== null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      // First-admin flow — use the mfaSetupToken
      setSetupToken(token);
      fetchQrCode(token);
    } else {
      // Existing user enabling MFA from security settings
      enableMfaForExistingUser();
    }
  }, []);

  const fetchQrCode = async (token: string) => {
    try {
      const res = await fetch(resolveApiUrl("/api/auth/mfa/setup"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaSetupToken: token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to initialize MFA setup");
        setState("error");
        return;
      }
      setQrCode(data.qrCode);
      setManualKey(data.manualKey);
      setState("scan");
    } catch {
      setError("Could not connect to server");
      setState("error");
    }
  };

  const enableMfaForExistingUser = async () => {
    try {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(resolveApiUrl("/api/auth/mfa/enable"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to initialize MFA setup");
        setState("error");
        return;
      }
      setQrCode(data.qrCode);
      setManualKey(data.manualKey);
      setSetupToken(data.setupToken);
      setState("scan");
    } catch {
      setError("Could not connect to server");
      setState("error");
    }
  };

  const handleVerify = async () => {
    if (!code || code.length !== 6) return;
    setState("loading" as any);

    try {
      const token = localStorage.getItem("crm_token");
      const endpoint = isFirstAdminFlow
        ? "/api/auth/mfa/verify-setup"
        : "/api/auth/mfa/enable-verify";

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(resolveApiUrl(endpoint), {
        method: "POST",
        headers,
        body: JSON.stringify({
          mfaSetupToken: isFirstAdminFlow ? setupToken : undefined,
          setupToken: !isFirstAdminFlow ? setupToken : undefined,
          code,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Invalid code");
        setState("scan");
        setCode("");
        return;
      }

      setRecoveryCodes(data.recoveryCodes || []);
      setState("success");

      if (data.token && data.user) {
        // First-admin activation: store session
        localStorage.setItem("crm_token", data.token);
        localStorage.setItem("crm_user_role", data.user.role);
        localStorage.setItem("crm_user_unit", data.user.unit || "All");
        queryClient.clear();
        queryClient.setQueryData(getGetMeQueryKey(), data.user);
        reconnectSocket();
      }
    } catch {
      setError("Could not connect to server");
      setState("scan");
    }
  };

  const copyRecoveryCodes = () => {
    navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCodesCopied(true);
    toast({ title: "Recovery codes copied to clipboard" });
  };

  const downloadRecoveryCodes = () => {
    const blob = new Blob([recoveryCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "elham-crm-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg shadow-xl border-primary/10">
        <CardHeader className="space-y-4 text-center pb-4 pt-7">
          <div className="mx-auto">
            <Shield className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-xl">
            {state === "success" ? "MFA Enabled" : "Secure Your Account"}
          </CardTitle>
          <CardDescription>
            {state === "success"
              ? "Two-factor authentication has been enabled for your account."
              : "Set up two-factor authentication using an authenticator app."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {state === "error" && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive mx-auto mb-2" />
              <p className="text-sm text-destructive">{error}</p>
              <Link href="/login" className="text-sm text-primary hover:underline mt-2 inline-block">
                Back to Login
              </Link>
            </div>
          )}

          {(state === "loading" || state === "scan") && !qrCode && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          )}

          {state === "scan" && qrCode && (
            <>
              {/* Step 1: Scan QR */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <QrCode className="h-4 w-4" />
                  Step 1: Scan QR Code
                </div>
                <div className="flex justify-center">
                  <div className="bg-white p-4 rounded-xl border shadow-sm">
                    <img src={qrCode} alt="MFA QR Code" className="w-48 h-48" />
                  </div>
                </div>
              </div>

              {/* Step 2: Manual key */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Key className="h-4 w-4" />
                  Or enter this key manually:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono break-all">
                    {manualKey}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(manualKey);
                      toast({ title: "Key copied" });
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Step 3: Enter code */}
              <div className="space-y-3 pt-2 border-t">
                <Label className="text-sm font-semibold">
                  Step 2: Enter the 6-digit code from your app
                </Label>
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
                  placeholder="000000"
                  className="text-center text-lg font-mono tracking-widest bg-background"
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button
                  className="w-full"
                  onClick={handleVerify}
                  disabled={code.length !== 6}
                >
                  Verify & Enable MFA
                </Button>
              </div>
            </>
          )}

          {state === "success" && (
            <>
              <div className="flex items-center justify-center">
                <CheckCircle className="h-16 w-16 text-green-500" />
              </div>

              {/* Recovery Codes */}
              {recoveryCodes.length > 0 && (
                <div className="space-y-3">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-amber-800 mb-2">
                      Save Your Recovery Codes
                    </p>
                    <p className="text-xs text-amber-700 mb-3">
                      Store these codes somewhere safe. Each code can only be used once
                      if you lose access to your authenticator app.
                    </p>
                    <div className="bg-white rounded border p-3 font-mono text-sm space-y-1">
                      {recoveryCodes.map((code, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-muted-foreground w-6 text-right">{i + 1}.</span>
                          <span className="font-bold">{code}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={copyRecoveryCodes}>
                      {codesCopied ? <CheckCircle className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                      {codesCopied ? "Copied!" : "Copy Codes"}
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={downloadRecoveryCodes}>
                      <Download className="h-4 w-4 mr-1" /> Download
                    </Button>
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                onClick={() => {
                  if (isFirstAdminFlow) {
                    setLocation(getHomeRoute(readWorkspace("admin")));
                  } else {
                    setLocation("/settings");
                  }
                }}
              >
                {isFirstAdminFlow ? "Continue to CRM" : "Done"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
