import { useMemo } from "react";
import { useNotifications } from "@/lib/notification-context";

// Derives per-module badge counts from the global unread notifications state.
// Each nav item can declare a badgeKey; this hook maps keys to unread counts
// so the sidebar renders red badges next to "Leads", "Orders", etc.
//
// Notification type → module mapping:
//   enquiry_assigned, repeat_enquiry, lead_transfer_requested, lead_deleted → leads
//   production_message, voice_note → orders (workspace-aware via link prefix)
//   production_message, voice_note → production-dashboard / production-orders

export type ModuleBadgeKey = "leads" | "orders" | "production-orders";

export function useModuleBadgeCounts(): Record<ModuleBadgeKey, number> {
  const { visibleNotifications } = useNotifications();

  return useMemo(() => {
    const counts: Record<ModuleBadgeKey, number> = { leads: 0, orders: 0, "production-orders": 0 };

    for (const n of visibleNotifications) {
      if (n.readAt) continue; // only unread
      switch (n.type) {
        case "enquiry_assigned":
        case "repeat_enquiry":
        case "lead_transfer_requested":
        case "lead_deleted":
          counts.leads++;
          break;
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
  }, [visibleNotifications]);
}
