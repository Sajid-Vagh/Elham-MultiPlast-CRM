import React, { createContext, useContext, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket, disconnectSocket, type CRMSocket } from "@/lib/socket";
import {
  onContactChange,
  onDealChange,
  onActivityChange,
  onProductionChange,
  onPIChange,
} from "@/lib/query-invalidation";
import { toast } from "@/hooks/use-toast";

interface SocketContextValue {
  socket: CRMSocket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
});

export function useSocketContext(): SocketContextValue {
  return useContext(SocketContext);
}

/**
 * Socket.IO provider that manages a single connection and integrates
 * with TanStack React Query for real-time cache invalidation.
 *
 * Mount this inside the QueryClientProvider and NotificationProvider.
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const socketRef = useRef<CRMSocket | null>(null);
  const connectedRef = useRef(false);
  const [, forceUpdate] = React.useState(0);

  // Refs for stable access in event handlers without re-registering
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const handleReconnect = useCallback(() => {
    const q = queryClientRef.current;
    // After reconnect, refetch critical datasets to catch any missed events
    q.invalidateQueries({ queryKey: ["unread-lead-count"] });
    q.invalidateQueries({ queryKey: ["unread-production-count"] });
    q.invalidateQueries({ queryKey: ["activity-badge-count"] });
    q.invalidateQueries({ queryKey: ["category-counts"] });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("crm_token");
    if (!token) return;

    const s = getSocket();
    if (!s) return;

    socketRef.current = s;

    s.on("connect", () => {
      connectedRef.current = true;
      forceUpdate((n) => n + 1);
      handleReconnect();
    });

    s.on("disconnect", () => {
      connectedRef.current = false;
      forceUpdate((n) => n + 1);
    });

    s.on("connect_error", () => {
      connectedRef.current = false;
    });

    // ─── Contact / Enquiry events ──────────────────────────
    s.on("enquiry:created", (data) => {
      onContactChange(queryClientRef.current, data.contactId);
    });

    s.on("enquiry:updated", (data) => {
      onContactChange(queryClientRef.current, data.contactId);
    });

    s.on("enquiry:assigned", (data) => {
      onContactChange(queryClientRef.current, data.contactId);
    });

    s.on("enquiry:deleted", (data) => {
      onContactChange(queryClientRef.current, data.contactId);
    });

    // ─── Deal events ───────────────────────────────────────
    s.on("deal:created", (data) => {
      onDealChange(queryClientRef.current, data.dealId, data.contactId);
    });

    s.on("deal:updated", (data) => {
      onDealChange(queryClientRef.current, data.dealId, data.contactId);
    });

    // ─── Activity / Follow-up events ───────────────────────
    s.on("followup:created", (data) => {
      onActivityChange(queryClientRef.current, data.dealId, data.contactId);
    });

    s.on("followup:updated", (data) => {
      onActivityChange(queryClientRef.current, data.dealId, data.contactId);
    });

    s.on("activity:created", (data) => {
      onActivityChange(queryClientRef.current, data.dealId, data.contactId);
    });

    // ─── Notification events ───────────────────────────────
    s.on("notification:new", (_data) => {
      // Notifications are handled by the existing SSE system (notification-context).
      // The socket event serves as a backup trigger for React Query invalidation.
      queryClientRef.current.invalidateQueries({ queryKey: ["unread-lead-count"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["unread-production-count"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["activity-badge-count"] });
    });

    // ─── Order events ──────────────────────────────────────
    s.on("order:created", (_data) => {
      queryClientRef.current.invalidateQueries({ queryKey: ["orders-global"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["dashboard-kpi"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["support-dashboard-kpi"] });
    });

    s.on("order:updated", (_data) => {
      queryClientRef.current.invalidateQueries({ queryKey: ["orders-global"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["dashboard-kpi"] });
      queryClientRef.current.invalidateQueries({ queryKey: ["support-dashboard-kpi"] });
    });

    // ─── Production events ─────────────────────────────────
    s.on("production:created", (data) => {
      onProductionChange(queryClientRef.current, String(data.orderId));
    });

    s.on("production:updated", (data) => {
      onProductionChange(queryClientRef.current, String(data.orderId));
    });

    s.on("production:status_changed", (data) => {
      onProductionChange(queryClientRef.current, String(data.orderId));
    });

    s.on("production:chat", (data) => {
      onProductionChange(queryClientRef.current, String(data.orderId));
      // Invalidate order surfaces too since chat shows on sales order pages
      queryClientRef.current.invalidateQueries({ queryKey: ["orders-global"] });
    });

    // ─── Proforma Invoice events ───────────────────────────
    s.on("proforma:updated", (data) => {
      onPIChange(queryClientRef.current, data.dealId ?? undefined, data.contactId ?? undefined);
    });

    return () => {
      s.removeAllListeners();
      disconnectSocket();
      socketRef.current = null;
      connectedRef.current = false;
    };
  }, [handleReconnect]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected: connectedRef.current }}>
      {children}
    </SocketContext.Provider>
  );
}
