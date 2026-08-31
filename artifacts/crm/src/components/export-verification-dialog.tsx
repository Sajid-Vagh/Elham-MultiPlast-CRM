import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { ShieldCheck, Mail, Loader2, RotateCcw, AlertCircle, Clock } from "lucide-react";
import { resolveApiUrl } from "@workspace/api-client-react";

interface ExportVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: (exportToken: string) => Promise<void> | void;
  title?: string;
  description?: string;
  exportLabel?: string;
}

export function ExportVerificationDialog({
  open,
  onOpenChange,
  onVerified,
  title = "Verify Excel Export",
  description = "For security, verify your identity before downloading CRM data.",
  exportLabel,
}: ExportVerificationDialogProps) {
  const [otp, setOtp] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expirySeconds, setExpirySeconds] = useState(300);
  const [resendCooldown, setResendCooldown] = useState(60);

  const expiryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const resendTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearTimers = () => {
    if (expiryTimerRef.current) clearInterval(expiryTimerRef.current);
    if (resendTimerRef.current) clearInterval(resendTimerRef.current);
  };

  const startTimers = useCallback((initialExpiry = 300) => {
    clearTimers();
    setExpirySeconds(initialExpiry);
    setResendCooldown(60);

    expiryTimerRef.current = setInterval(() => {
      setExpirySeconds((prev) => {
        if (prev <= 1) {
          if (expiryTimerRef.current) clearInterval(expiryTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    resendTimerRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (resendTimerRef.current) clearInterval(resendTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const sendOtp = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      const token = localStorage.getItem("crm_token");
      const url = resolveApiUrl("/api/exports/auth/send-otp");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send verification code");
      }

      setMaskedEmail(data.emailMasked || "registered email");
      startTimers(data.expiresInSeconds || 300);
      setOtp("");
    } catch (err: any) {
      setError(err.message || "Could not send verification code");
    } finally {
      setSending(false);
    }
  }, [startTimers]);

  useEffect(() => {
    if (open) {
      setOtp("");
      setError(null);
      sendOtp();
    } else {
      clearTimers();
    }
    return () => {
      clearTimers();
    };
  }, [open, sendOtp]);

  const handleVerify = async () => {
    if (otp.length !== 6) return;
    setVerifying(true);
    setError(null);

    try {
      const token = localStorage.getItem("crm_token");
      const url = resolveApiUrl("/api/exports/auth/verify-otp");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: otp }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid verification code");
      }

      const exportToken = data.exportToken;
      if (!exportToken) {
        throw new Error("No authorization token received from server");
      }

      // Close dialog first
      onOpenChange(false);

      // Trigger the export with the acquired short-lived token
      await onVerified(exportToken);
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && otp.length === 6 && !verifying && !sending && expirySeconds > 0) {
      e.preventDefault();
      handleVerify();
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const isExpired = expirySeconds <= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader className="text-center sm:text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-1">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground max-w-xs mx-auto">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Email Banner */}
          <div className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-muted/60 text-xs text-muted-foreground border">
            <Mail className="w-4 h-4 text-primary shrink-0" />
            <span>
              Code sent to:{" "}
              <strong className="font-medium text-foreground">
                {maskedEmail || "your email"}
              </strong>
            </span>
          </div>

          {exportLabel && (
            <div className="text-center text-xs text-muted-foreground font-medium">
              Exporting: <span className="text-primary font-semibold">{exportLabel}</span>
            </div>
          )}

          {/* OTP Input */}
          <div className="flex flex-col items-center justify-center gap-2 pt-2">
            <InputOTP
              maxLength={6}
              value={otp}
              onChange={(val) => {
                setOtp(val);
                if (error) setError(null);
              }}
              disabled={sending || verifying || isExpired}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} className="w-11 h-12 text-lg font-semibold" />
                <InputOTPSlot index={1} className="w-11 h-12 text-lg font-semibold" />
                <InputOTPSlot index={2} className="w-11 h-12 text-lg font-semibold" />
                <InputOTPSlot index={3} className="w-11 h-12 text-lg font-semibold" />
                <InputOTPSlot index={4} className="w-11 h-12 text-lg font-semibold" />
                <InputOTPSlot index={5} className="w-11 h-12 text-lg font-semibold" />
              </InputOTPGroup>
            </InputOTP>

            {/* Expiry Timer */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
              <Clock className="w-3.5 h-3.5" />
              {isExpired ? (
                <span className="text-destructive font-medium">Code expired</span>
              ) : (
                <span>
                  Code expires in:{" "}
                  <span className="font-mono font-medium text-foreground">
                    {formatTime(expirySeconds)}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-md bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2 sm:justify-between items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={sendOtp}
            disabled={resendCooldown > 0 || sending || verifying}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className={`w-3.5 h-3.5 mr-1.5 ${sending ? "animate-spin" : ""}`} />
            {sending
              ? "Sending..."
              : resendCooldown > 0
              ? `Resend code (${resendCooldown}s)`
              : "Resend Code"}
          </Button>

          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={verifying}
              className="flex-1 sm:flex-initial"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleVerify}
              disabled={otp.length !== 6 || verifying || sending || isExpired}
              className="flex-1 sm:flex-initial"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify & Download"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
