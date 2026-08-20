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
          // Every order-related chat / voice notification counts toward the
          // "Orders" sidebar badge.  The server-side `hasUnreadMessages` flag
          // on each order row checks BOTH `/orders/:id` AND
          // `/production/orders/:id` link patterns, so the sidebar badge must
          // count them the same way — otherwise admin/support users (whose
          // notifications carry `/production/orders/…` links) never see a
          // badge on the "Orders" nav item.
          counts.orders++;
          // Also increment the "production-orders" badge when the link points
          // to a production order (shown on the Production workspace sidebar).
          const link = n.link || "";
          if (link.startsWith("/production/orders")) {
            counts["production-orders"]++;
          }
          break;
        }
      }
    }
    return counts;
  }, [visibleNotifications, unreadLeadCount]);
}
