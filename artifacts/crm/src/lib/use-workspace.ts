import { useState, useCallback } from "react";

export type Workspace = "sales" | "production" | "support";

const WORKSPACE_LABELS: Record<Workspace, string> = {
  sales: "Sales",
  production: "Production",
  support: "Support",
};

export function getWorkspaceLabel(w: Workspace): string {
  return WORKSPACE_LABELS[w];
}

export function getHomeRoute(workspace: Workspace | string): string {
  switch (workspace) {
    case "production": return "/production/dashboard";
    case "support": return "/support-dashboard";
    case "inventory": return "/inventory";
    default: return "/dashboard";
  }
}

export function getAvailableWorkspaces(role: string): Workspace[] {
  switch (role) {
    case "admin": return ["sales", "production", "support"];
    case "production_and_support": return ["support", "production", "sales"];
    case "production": return ["production", "sales"];
    default: return [];
  }
}

export function getDefaultWorkspace(role: string): Workspace {
  switch (role) {
    case "production": return "production";
    case "production_and_support": return "support";
    case "inventory": return "inventory" as any;
    default: return "sales";
  }
}

function storageKey(role: string): string {
  return `crm_workspace_${role}`;
}

export function readWorkspace(role: string): Workspace {
  const available = getAvailableWorkspaces(role);
  if (available.length === 0) return getDefaultWorkspace(role);
  const stored = localStorage.getItem(storageKey(role)) as Workspace | null;
  if (stored && available.includes(stored)) return stored;
  return getDefaultWorkspace(role);
}

export function saveWorkspace(role: string, w: Workspace) {
  localStorage.setItem(storageKey(role), w);
}

/**
 * Workspace hook with per-role localStorage persistence.
 * Each role remembers its own last-selected workspace independently.
 * On login, reads the stored preference for the current role; falls back to default.
 */
export function useWorkspace(role: string): [Workspace, (w: Workspace) => void, Workspace[]] {
  const available = getAvailableWorkspaces(role);
  const [workspace, setWorkspaceState] = useState<Workspace>(() => readWorkspace(role));

  const setWorkspace = useCallback((w: Workspace) => {
    setWorkspaceState(w);
    saveWorkspace(role, w);
  }, [role]);

  return [workspace, setWorkspace, available];
}
