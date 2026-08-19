import { useMemo } from "react";
import { useNotifications } from "@/lib/notification-context";
import { useUnreadLeadCount } from "@/lib/use-unread-lead-count";

// Derives per-module badge counts for the sidebar nav items.
//
// Leads badge: uses the dedicated /contacts/unread-count endpoint which applies
// the SAME role-based logic (isReadByAdmin / isReadByAssignee) as the leads
// table — so the sidebar count always matches the visible unread dots.
//
// Orders / Production-Orders badges: still derived from unread notifications
// (production_message, voice_note types) since those are notification-driven.

export type ModuleBadgeKey = "leads" | "orders" | "production-orders";

export function useModuleBadgeCounts(): Record<ModuleBadgeKey, number> {
  const { visibleNotifications } = useNotifications();
  const unreadLeadCount = useUnreadLeadCount();

  return useMemo(() => {
    const counts: Record<ModuleBadgeKey, number> = { leads: unreadLeadCount, orders: 0, "production-orders": 0 };

    for (const n of visibleNotifications) {
      if (n.readAt) continue; // only unread
      switch (n.type) {
        case "production_message":
        case "voice_note": {
          // Workspace-aware: sales users get /orders/:id, production/support get /production/orders/:id
          const link = n.link || "";
          if (link.startsWith("/production/orders")) {
            counts["production-orders"]++;
          } else if (link.startsWith("/orders")) {
            counts.orders++;
          } else {
            // No link or unknown pattern — count as orders (fallback)
            counts.orders++;
          }
          break;
        }
      }
    }
    return counts;
  }, [visibleNotifications, unreadLeadCount]);
}
