import { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, resolveApiUrl } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MailCheck, CircleCheck, CircleX } from "lucide-react";
import { getHomeRoute, readWorkspace } from "@/lib/use-workspace";
import { reconnectSocket } from "@/lib/socket";

type VerifyState = "working" | "success" | "activated" | "error";

/**
 * Email verification landing page.
 *
 * The first-admin setup (and legacy verify-email flow) emails a link to
 * /verify-email?token=... Opening it verifies the mailbox. For the bootstrap
 * Admin account this ALSO activates it and returns a session — the user is
 * logged in immediately via the "Continue" button.
 */
export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [state, setState] = useState<VerifyState>("working");
  const [error, setError] = useState("");
  const firedRef = useRef(false);

  useEffect(() => {
    // The token is single-use — never re-POST on remount/re-render
    if (firedRef.current) return;
    firedRef.current = true;

    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("This verification link is missing its token. Please request a new verification email.");
      setState("error");
      return;
    }

    fetch(resolveApiUrl("/api/auth/verify-email"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async res => ({ ok: res.ok, data: await res.json().catch(() => ({}) as any) }))
      .then(({ ok, data }) => {
        if (!ok) {
          setError(data.error || "Invalid or expired verification link.");
          setState("error");
          return;
        }

        if (data.token && data.user) {
          // Bootstrap admin activation — establish the session immediately
          localStorage.setItem("crm_token", data.token);
          localStorage.setItem("crm_user_role", data.user.role);
          localStorage.setItem("crm_user_unit", data.user.unit || "All");
          queryClient.setQueryData(getGetMeQueryKey(), data.user);
          reconnectSocket();
          setState("activated");
        } else {
          setState("success");
        }
      })
      .catch(() => {
        setError("Could not connect to server. Please try again.");
        setState("error");
      });
  }, [queryClient]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-xl border-primary/10">
        <CardHeader className="space-y-4 text-center pb-4 pt-7">
          <div className="mx-auto">
            {state === "working" || state === "success" ? (
              <MailCheck className="h-12 w-12 text-primary" />
            ) : state === "activated" ? (
              <CircleCheck className="h-12 w-12 text-green-500" />
            ) : (
              <CircleX className="h-12 w-12 text-red-500" />
            )}
          </div>
          {state === "working" && (
            <>
              <CardTitle className="text-xl">Verifying your email…</CardTitle>
              <CardDescription>Hang on while we confirm this link.</CardDescription>
            </>
          )}
          {state === "success" && (
            <>
              <CardTitle className="text-xl">Email verified</CardTitle>
              <CardDescription>Your email address has been confirmed.</CardDescription>
            </>
          )}
          {state === "activated" && (
            <>
              <CardTitle className="text-xl">Admin account activated</CardTitle>
              <CardDescription>
                Your email is verified and your first Admin account is now active.
              </CardDescription>
            </>
          )}
          {state === "error" && (
            <>
              <CardTitle className="text-xl">Verification failed</CardTitle>
              <CardDescription>{error}</CardDescription>
            </>
          )}
        </CardHeader>
        {(state === "success" || state === "activated" || state === "error") && (
          <CardContent className="flex flex-col gap-2">
            {state === "activated" ? (
              <Button
                className="w-full"
                onClick={() => setLocation(getHomeRoute(readWorkspace("admin")))}
              >
                Continue to CRM
              </Button>
            ) : (
              <Button asChild variant={state === "error" ? "default" : "outline"} className="w-full">
                <Link href="/login">{state === "error" ? "Go to Login" : "Go to Login"}</Link>
              </Button>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
