import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Send, ExternalLink, MessageSquare, User, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useNotifications } from "@/lib/notification-context";
import { useActiveUnits } from "@/lib/use-active-units";
import { parseNotesText } from "@/lib/parse-notes";
import { useGetMe } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";
import { DoubleTick } from "@/components/double-tick";

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("crm_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

const CATEGORY_OPTIONS = ["Regular Follow up", "Category A", "Category B", "Category C", "My Client"];

function formatTime(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enquiry panel — editable preview of the linked lead (no navigation)
// ─────────────────────────────────────────────────────────────────────────────
function EnquiryPanel({ notification, onClose }: { notification: any; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const { markAsRead } = useNotifications();
  const contactId = notification.relatedId;
  const { units } = useActiveUnits();

  const { data: contact, isLoading, isError } = useQuery({
    queryKey: ["notification-contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load enquiry");
      return res.json();
    },
    enabled: !!contactId,
    staleTime: 30_000,
  });

  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!contact) return;
    setForm({
      name: contact.name || "",
      mobile: contact.mobile || "",
      email: contact.email || "",
      companyName: contact.companyName || "",
      category: contact.category || "Regular Follow up",
      unit: contact.unit || "",
      city: contact.city || "",
      address: contact.address || "",
      customerComments: parseNotesText(contact.customerComments) || "",
    });
  }, [contact]);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => toast({ title: "Enquiry updated" }),
    onError: (err: any) => toast({ title: err?.message || "Failed to save", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError || !contact) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">Could not load this enquiry.</p>
        {notification.link && (
          <Button size="sm" onClick={() => setLocation(notification.link)}>
            Open Lead <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        )}
      </div>
    );
  }

  const openProfile = () => {
    markAsRead(notification.id);
    onClose();
    setLocation(`/leads/${contactId}`);
  };

  return (
    <div className="h-full flex flex-col">
      <SheetHeader className="px-5 pt-5 pb-3 border-b">
        <SheetTitle className="flex items-center gap-2 text-base">
          <User className="h-4 w-4 text-blue-600" /> {contact.name}
        </SheetTitle>
        <SheetDescription>
          {contact.companyName || "Enquiry"} · #{contactId}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Full Name</Label>
            <Input value={form.name || ""} onChange={set("name")} />
          </div>
          <div>
            <Label>Mobile</Label>
            <Input value={form.mobile || ""} onChange={set("mobile")} />
          </div>
          <div>
            <Label>Company</Label>
            <Input value={form.companyName || ""} onChange={set("companyName")} />
          </div>
          <div className="col-span-2">
            <Label>Email</Label>
            <Input value={form.email || ""} onChange={set("email")} />
          </div>
          <div>
            <Label>Category</Label>
            <select
              value={form.category || ""}
              onChange={set("category") as any}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <Label>Unit</Label>
            <select
              value={form.unit || ""}
              onChange={set("unit") as any}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Not Sure</option>
              {units.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <Label>City</Label>
            <Input value={form.city || ""} onChange={set("city")} />
          </div>
          <div>
            <Label>Address</Label>
            <Input value={form.address || ""} onChange={set("address")} />
          </div>
          <div className="col-span-2">
            <Label>Comments</Label>
            <Textarea rows={3} value={form.customerComments || ""} onChange={set("customerComments")} />
          </div>
        </div>
      </div>

      <div className="border-t p-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={openProfile}
        >
          Open Full Profile <ExternalLink className="h-3.5 w-3.5 ml-1" />
        </Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat panel — reply to a production/support conversation without navigating
// ─────────────────────────────────────────────────────────────────────────────
function ChatPanel({ notification, onClose }: { notification: any; onClose: () => void }) {
  const { data: user } = useGetMe();
  const [messageText, setMessageText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevCountRef = useRef(0);
  const initialScrollDoneRef = useRef(false);

  // The conversation lives on the production order. The notification link is
  // role-aware: production/support users get /production/orders/:productionOrderId,
  // sales users get /orders/:salesOrderId. Resolve the production order id from
  // either link so the messages fetch always targets the right order.
  const { data: productionOrderId } = useQuery({
    queryKey: ["chat-production-order", notification.link],
    queryFn: async () => {
      if (!notification.link) return null;
      const parts = notification.link.split("/").filter(Boolean);
      const last = Number(parts[parts.length - 1]);
      if (!last) return null;
      if (parts[0] === "production") return last;
      if (parts[0] === "orders") {
        const orderRes = await fetch(`/api/orders/${last}`, { headers: authHeaders() });
        if (!orderRes.ok) return null;
        const order = await orderRes.json();
        if (!order?.proformaInvoiceId) return null;
        const poRes = await fetch(`/api/production/by-invoice/${order.proformaInvoiceId}`, { headers: authHeaders() });
        if (!poRes.ok) return null;
        const po = await poRes.json();
        return po?.id ?? null;
      }
      return last;
    },
    enabled: !!notification.link,
    staleTime: 60_000,
  });

  const { data: chatData, refetch } = useQuery<{
    orderId: number;
    orderNumber: string | null;
    companyName: string | null;
    customerName: string | null;
    messages: any[];
  }>({
    queryKey: ["notification-chat-messages", productionOrderId],
    queryFn: async () => {
      const res = await fetch(`/api/production/orders/${productionOrderId}/messages`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load conversation");
      return res.json();
    },
    enabled: !!productionOrderId,
    refetchInterval: 5_000,
    staleTime: 3_000,
  });

  const messages = chatData?.messages;

  const sortedMessages = useMemo(() => {
    if (!messages) return [];
    return [...messages].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id);
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      const res = await fetch(`/api/production/orders/${productionOrderId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ message: msg }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
    onSuccess: () => {
      setMessageText("");
      refetch();
    },
    onError: (err: any) => toast({ title: err?.message || "Failed to send message", variant: "destructive" }),
  });

  // Mark chat messages as read when conversation opens
  const markReadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/orders/${productionOrderId}/messages/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      return res.json();
    },
    onSuccess: () => refetch(),
  });

  useEffect(() => {
    if (sortedMessages && sortedMessages.length > 0 && productionOrderId && !markReadMutation.isPending) {
      markReadMutation.mutate();
    }
  }, [sortedMessages?.length, productionOrderId]);

  useEffect(() => {
    const container = chatEndRef.current?.parentElement;
    if (!container || !sortedMessages) return;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    if (isAtBottom) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      setUnreadCount(0);
    } else if (sortedMessages.length > prevCountRef.current) {
      setUnreadCount((c) => c + (sortedMessages.length - prevCountRef.current));
    }
    prevCountRef.current = sortedMessages.length;
  }, [sortedMessages]);

  // Scroll to bottom on initial load only
  useEffect(() => {
    if (!sortedMessages || sortedMessages.length === 0 || initialScrollDoneRef.current) return;
    requestAnimationFrame(() => {
      const container = chatEndRef.current?.parentElement;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
        initialScrollDoneRef.current = true;
      }
    });
  }, [sortedMessages]);

  const handleSend = () => {
    if (!messageText.trim() || sendMutation.isPending || !productionOrderId) return;
    sendMutation.mutate(messageText.trim());
  };

  if (!productionOrderId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Conversation is not linked to a production order.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <SheetHeader className="px-5 pt-5 pb-3 border-b">
        <SheetTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-violet-600" /> Order Conversation
          <span className="inline-flex items-center gap-1 text-[10px] text-green-600 font-medium bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Realtime
          </span>
        </SheetTitle>
        <SheetDescription>
          {chatData?.companyName || notification.title}
          {chatData?.orderNumber ? ` · ${chatData.orderNumber}` : ` · Order #${productionOrderId}`}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 relative overflow-hidden bg-[#fafafa]">
        <div className="h-full overflow-y-auto px-4 py-4 space-y-3">
          {!messages ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : sortedMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-10">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3"><MessageSquare className="h-5 w-5 text-muted-foreground/50" /></div>
              <p className="text-sm font-medium text-muted-foreground">No conversation yet. Say hello!</p>
            </div>
          ) : (
            <>
              {sortedMessages.map((msg: any, idx: number) => {
                const isMe = user && msg.senderId === user.id;
                const showAvatar = idx === 0 || sortedMessages[idx - 1].senderId !== msg.senderId;
                const isLastInGroup = idx === sortedMessages.length - 1 || sortedMessages[idx + 1].senderId !== msg.senderId;
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                    {showAvatar && !isMe && (
                      <div className="flex items-center gap-1.5 mb-1 ml-1">
                        <span className="text-[11px] font-semibold text-foreground">{msg.senderName}</span>
                        <span className="text-[9px] font-medium text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-px leading-none">{msg.senderRole}</span>
                      </div>
                    )}
                    <div className={`max-w-[80%] px-3 py-2 text-[12.5px] leading-relaxed ${isMe ? "bg-violet-600 text-white rounded-2xl rounded-br-md shadow-sm" : "bg-white text-foreground border border-gray-200 rounded-2xl rounded-bl-md shadow-sm"}`}>
                      <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                    </div>
                    {isLastInGroup && <span className={`text-[9px] text-muted-foreground/60 mt-1 flex items-center gap-1 ${isMe ? "mr-1 flex-row-reverse" : "ml-1"}`}>{formatTime(msg.createdAt)}{isMe && <DoubleTick isRead={Array.isArray(msg.readBy) && msg.readBy.length > 0} className="ml-0.5" />}</span>}
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => { chatEndRef.current?.parentElement?.scrollTo({ top: chatEndRef.current.parentElement.scrollHeight, behavior: "smooth" }); setUnreadCount(0); }}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 bg-violet-600 text-white text-[11px] font-medium rounded-full px-3 py-1.5 shadow-lg hover:bg-violet-700 transition-colors cursor-pointer"
          >
            {unreadCount} new message{unreadCount !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      <div className="border-t p-3 flex items-end gap-2">
        <div className="flex-1">
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type a reply..."
            rows={1}
            className="w-full min-h-[40px] max-h-24 text-[13px] resize-none rounded-xl border-gray-200 bg-white px-3 py-2 focus-visible:ring-violet-500 focus-visible:border-violet-400 placeholder:text-muted-foreground/50"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!messageText.trim() || sendMutation.isPending}
          className="shrink-0 w-10 h-10 rounded-full bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic panel — fallback for any other notification type
// ─────────────────────────────────────────────────────────────────────────────
function GenericPanel({ notification, onClose }: { notification: any; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const { markAsRead } = useNotifications();

  const open = () => {
    markAsRead(notification.id);
    onClose();
    if (notification.link) setLocation(notification.link);
  };

  return (
    <div className="h-full flex flex-col">
      <SheetHeader className="px-5 pt-5 pb-3 border-b">
        <SheetTitle className="text-base">{notification.title}</SheetTitle>
        <SheetDescription>{notification.module || "General"} notification</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-5">
        <p className="text-sm text-muted-foreground whitespace-pre-line">{notification.message}</p>
        <p className="text-[10px] text-muted-foreground mt-3">{formatTime(notification.createdAt)}</p>
      </div>
      <div className="border-t p-4">
        {notification.link && (
          <Button size="sm" className="w-full" onClick={open}>
            Open <ExternalLink className="h-3.5 w-3.5 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root side panel — slides in from the right half of the screen
// ─────────────────────────────────────────────────────────────────────────────
export function NotificationSidePanel() {
  const { panelNotification, closeNotificationPanel } = useNotifications();
  const open = !!panelNotification;
  const notification = panelNotification;

  const isEnquiry = notification
    ? notification.relatedType === "contact" ||
      notification.type === "repeat_enquiry" ||
      notification.type.startsWith("enquiry_") ||
      notification.type.startsWith("lead_")
    : false;

  const isChat = notification?.type === "production_message";

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) closeNotificationPanel(); }}>
      <SheetContent side="right" className="w-full sm:w-1/2 sm:max-w-xl p-0">
        {notification && isChat && <ChatPanel notification={notification} onClose={closeNotificationPanel} />}
        {notification && isEnquiry && !isChat && <EnquiryPanel notification={notification} onClose={closeNotificationPanel} />}
        {notification && !isChat && !isEnquiry && <GenericPanel notification={notification} onClose={closeNotificationPanel} />}
      </SheetContent>
    </Sheet>
  );
}

export default NotificationSidePanel;
