import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { resolveApiUrl } from "@workspace/api-client-react";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch(resolveApiUrl("/api/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // Always show success — never reveal whether email exists
      setSent(true);
    } catch {
      toast({ title: "Error", description: "Could not connect to server", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-sm shadow-xl border-primary/10">
          <CardHeader className="text-center pt-7">
            <div className="mx-auto mb-4">
              <img src="/images/logo1.png" alt="Elham MultiPlast LLP" className="max-w-[200px] w-full h-auto mx-auto" />
            </div>
            <CardDescription>Check your email</CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              If an account exists with <strong>{email}</strong>, a password reset link has been sent.
            </p>
            <p className="text-xs text-muted-foreground">
              Check your inbox and click the reset link. The link expires in 1 hour.
            </p>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button variant="outline" className="w-full" onClick={() => setLocation("/login")}>
              Back to Login
            </Button>
            <Button variant="ghost" className="w-full text-xs" onClick={() => { setSent(false); setEmail(""); }}>
              Try another email
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm shadow-xl border-primary/10">
        <CardHeader className="text-center pt-7">
          <div className="mx-auto mb-4">
            <img src="/images/logo1.png" alt="Elham MultiPlast LLP" className="max-w-[200px] w-full h-auto mx-auto" />
          </div>
          <CardDescription>Reset your password</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Enter your email address and we'll send you a link to reset your password.
            </p>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="bg-background"
                autoFocus
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending..." : "Send Reset Link"}
            </Button>
            <Link href="/login" className="text-sm text-primary hover:underline">
              Back to Login
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
