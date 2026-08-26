import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Legacy /admin-setup route — now redirects to the unified auth page.
 * The first-admin setup is handled inside the login state machine.
 */
export default function AdminSetup() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/login"); }, [setLocation]);
  return null;
}
