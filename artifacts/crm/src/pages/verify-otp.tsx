import { useState, useRef, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, ArrowLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { resolveApiUrl } from "@workspace/api-client-react";

type OtpState = "input" | "loading" | "success" | "error";

/**
 * OTP Verification page — used for first-admin email verification.
 * User enters the 6-digit code sent to their email.
 */
export default function VerifyOtp() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [state, setState] = useState<OtpState>("input");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Read email from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get("email");
    if (e) setEmail(e);
  }, []);

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (newCode.every(d => d !== "") && value) {
      handleVerify(newCode.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const newCode = pasted.split("");
      setCode(newCode);
      handleVerify(pasted);
    }
  };

  const handleVerify = async (otpCode: string) => {
    if (!email) {
      toast({ title: "Email not found", description: "Please go back to the setup page.", variant: "destructive" });
      return;
    }

    setState("loading");
    try {
      const res = await fetch(resolveApiUrl("/api/auth/otp/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otpCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Invalid code");
        setState("error");
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }

      setState("success");

      if (data.mfaSetupRequired && data.mfaSetupToken) {
        // First-admin: redirect to MFA setup
        setTimeout(() => {
          setLocation(`/setup-mfa?token=${data.mfaSetupToken}`);
        }, 1500);
      } else {
        // Regular verification: go to login
        setTimeout(() => setLocation("/login"), 2000);
      }
    } catch {
      setError("Could not connect to server");
      setState("error");
    }
  };

  const handleResend = async () => {
    if (!email) return;
    try {
      await fetch(resolveApiUrl("/api/auth/otp/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      toast({ title: "New code sent", description: "Check your email for a new 6-digit code." });
      setCode(["", "", "", "", "", ""]);
      setState("input");
      inputRefs.current[0]?.focus();
    } catch {
      toast({ title: "Failed to resend", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-xl border-primary/10">
        <CardHeader className="space-y-4 text-center pb-4 pt-7">
          <div className="mx-auto">
            {state === "success" ? (
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <ShieldCheck className="h-6 w-6 text-green-600" />
              </div>
            ) : (
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
            )}
          </div>
          <CardTitle className="text-xl">
            {state === "success" ? "Email Verified" : "Enter Verification Code"}
          </CardTitle>
          <CardDescription>
            {state === "success"
              ? "Your email has been verified successfully."
              : `We sent a 6-digit code to ${email || "your email"}. Enter it below.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {state !== "success" && (
            <>
              <div className="flex justify-center gap-2">
                {code.map((digit, i) => (
                  <Input
                    key={i}
                    ref={el => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleCodeChange(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    onPaste={handlePaste}
                    className="w-12 h-12 text-center text-lg font-mono bg-background"
                    autoFocus={i === 0}
                    disabled={state === "loading"}
                  />
                ))}
              </div>

              {state === "loading" && (
                <div className="flex items-center justify-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Verifying...</span>
                </div>
              )}

              {state === "error" && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  onClick={() => handleVerify(code.join(""))}
                  disabled={code.some(d => d === "") || state === "loading"}
                >
                  Verify Code
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-sm"
                  onClick={handleResend}
                  disabled={state === "loading"}
                >
                  Resend Code
                </Button>
              </div>
            </>
          )}

          <div className="text-center">
            <Link href="/login" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Back to Login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
