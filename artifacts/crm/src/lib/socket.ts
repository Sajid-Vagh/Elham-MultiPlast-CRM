import { io, type Socket } from "socket.io-client";
import { resolveApiUrl } from "@workspace/api-client-react";

// ─── Event types (mirrors backend socket.ts) ───────────────
// Duplicated here because the frontend build cannot import from the backend.

export interface ServerToClientEvents {
  "enquiry:created": (data: { contactId: number }) => void;
  "enquiry:updated": (data: { contactId: number }) => void;
  "enquiry:assigned": (data: { contactId: number; assignedTo: number }) => void;
  "enquiry:deleted": (data: { contactId: number }) => void;
  "deal:created": (data: { dealId: number; contactId: number }) => void;
  "deal:updated": (data: { dealId: number; contactId: number }) => void;
  "followup:created": (data: { activityId: number; contactId?: number; dealId?: number }) => void;
  "followup:updated": (data: { activityId: number; contactId?: number; dealId?: number }) => void;
  "activity:created": (data: { activityId: number; contactId?: number; dealId?: number }) => void;
  "notification:new": (data: { notificationId: number; userId: number }) => void;
  "order:created": (data: { orderId: number }) => void;
  "order:updated": (data: { orderId: number }) => void;
  "production:created": (data: { orderId: number }) => void;
  "production:updated": (data: { orderId: number }) => void;
  "production:status_changed": (data: { orderId: number; status: string }) => void;
  "production:chat": (data: { orderId: number; senderId: number; senderName: string; senderRole: string }) => void;
  "proforma:updated": (data: { invoiceId: number; dealId?: number | null; contactId?: number | null }) => void;
}

export interface ClientToServerEvents {
  "join:order": (orderId: number) => void;
  "leave:order": (orderId: number) => void;
}

export type CRMSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ─── Singleton ─────────────────────────────────────────────
let socket: CRMSocket | null = null;

function getSocketUrl(): string {
  const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (isDev) {
    return window.location.origin;
  }
  const resolved = resolveApiUrl("/");
  return resolved.endsWith("/") ? resolved.slice(0, -1) : resolved;
}

/**
 * Get or create the singleton Socket.IO client.
 * Returns null if no auth token is present in localStorage.
 */
export function getSocket(): CRMSocket | null {
  if (socket?.connected) return socket;
  if (socket) return socket;

  const token = localStorage.getItem("crm_token");
  if (!token) return null;

  if (!socket) {
    socket = io(getSocketUrl(), {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
      autoConnect: false,
    });
  }

  socket.auth = { token };

  if (!socket.connected && !socket.active) {
    socket.connect();
  }

  return socket;
}

/**
 * Disconnect the socket and clean up all listeners.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * Reconnect the socket with a fresh token (e.g., after login).
 */
export function reconnectSocket(): void {
  disconnectSocket();
  setTimeout(() => {
    getSocket();
  }, 100);
}

/**
 * Check if the socket is currently connected.
 */
export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
