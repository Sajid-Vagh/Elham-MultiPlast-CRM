import { useState, useEffect } from "react";
import { Link } from "wouter";
import { resolveApiUrl } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { AdminSetupForm } from "@/components/admin-setup-form";

/**
 * Standalone First-Admin Setup page.
 *
 * The CRM has no public registration. This page renders the setup form ONLY
 * while no Admin exists AND the server reports bootstrap is available
 * (setup-status `bootstrapAvailable`: virgin install, or caller holds a valid
 * ACTIVE session of any role). Once an Admin exists it shows a notice instead
 * — all further users are created/invited by an Admin from inside the CRM.
 */
export default function AdminSetup() {
  const [status, setStatus] = useState<"loading" | "available" | "unavailable">("loading");

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;
    fetch(resolveApiUrl("/api/auth/setup-status"), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(r => r.json())
      .then((data: { adminExists: boolean; bootstrapAvailable?: boolean }) => {
        setStatus(data.bootstrapAvailable === true ? "available" : "unavailable");
      })
      .catch(() => setStatus("unavailable"));
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md shadow-xl border-primary/10">
          <CardHeader className="space-y-4 text-center pb-4 pt-7">
            <div className="mx-auto">
              <ShieldAlert className="h-12 w-12 text-amber-500" />
            </div>
            <p className="text-lg font-semibold">First-admin setup is not available</p>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              An Admin account already exists, or this installation does not permit
              first-admin setup for your session. Please sign in instead — additional
              users are created by an Admin from Settings.
            </p>
            <Button asChild className="w-full">
              <Link href="/login">Go to Login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <AdminSetupForm />
    </div>
  );
}
