import { useState, useRef, useEffect, useMemo } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { useNotifications } from "@/lib/notification-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Package, User, Truck, Calendar, Circle, AlertTriangle,
  MessageSquare, Send, XCircle, Mic } from "lucide-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { ProductionProgressSection } from "@/components/production-progress";
import { CancelOrderModal } from "@/components/cancel-order-modal";
import { useVoiceNotes, type VoiceNoteData } from "@/lib/use-voice-notes";
import { VoiceNotePlayer } from "@/components/voice-note-player";
import { VoiceNoteUploader } from "@/components/voice-note-uploader";
import { toast } from "@/hooks/use-toast";
import { DoubleTick } from "@/components/double-tick";

// ── Merged Voice Notes: combines notes from the production order + linked deal ──
function MergedVoiceNotes({ productionOrderId, dealId }: { productionOrderId?: number; dealId?: number | null }) {
  const { data: prodNotes = [], isLoading: prodLoading } = useVoiceNotes("production", productionOrderId || null);
  const { data: dealNotes = [], isLoading: dealLoading } = useVoiceNotes("deal", dealId || null);

  const isLoading = prodLoading || (dealId ? dealLoading : false);

  const mergedNotes: VoiceNoteData[] = useMemo(() => {
    const all = [...prodNotes, ...dealNotes];
    const seen = new Set<number>();
    return all.filter(n => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [prodNotes, dealNotes]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading voice notes...</p>;
  if (mergedNotes.length === 0) return <p className="text-sm text-muted-foreground">No voice notes yet</p>;

  return (
    <div className="space-y-2">
      {mergedNotes.map((note) => (
        <VoiceNotePlayer key={note.id} note={note} canDelete={false} compact />
      ))}
    </div>
  );
}

const ORDER_STATUS_COLORS: Record<string, string> = {
  "Draft": "bg-gray-100 text-gray-600",
  "Pending Verification": "bg-yellow-100 text-yellow-700",
  "Confirmed": "bg-blue-100 text-blue-700",
  "Production Pending": "bg-orange-100 text-orange-700",
  "Production Started": "bg-purple-100 text-purple-700",
  "Production Running": "bg-purple-100 text-purple-700",
  "Quality Check": "bg-indigo-100 text-indigo-700",
  "Ready for Dispatch": "bg-cyan-100 text-cyan-700",
  "Partially Dispatched": "bg-teal-100 text-teal-700",
  "Dispatched": "bg-blue-100 text-blue-700",
  "Delivered": "bg-green-100 text-green-700",
  "Completed": "bg-emerald-100 text-emerald-700",
  "Cancelled": "bg-red-100 text-red-600",
};

export default function OrderDetailGlobal() {
  const [, params] = useRoute("/orders/:id");
  const [, setLocation] = useLocation();
  const { data: user } = useGetMe();
  const id = Number(params?.id);
  const queryClient = useQueryClient();
  const { notifications, markAsRead } = useNotifications();

  const [cancelDialog, setCancelDialog] = useState(false);

  // ── Order Conversation (Sales workspace) ──
  const [messageText, setMessageText] = useState("");
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMsgCountRef = useRef(0);
  const initialScrollDoneRef = useRef(false);

  const { data: order, isLoading } = useQuery<any>({
    queryKey: ["order", id],
    queryFn: () => customFetch(`/orders/${id}`),
    enabled: !!id,
  });

  // The chat lives on the production order — resolve it from this sales order's
  // linked production order. `enrichOrder` already returns `productionOrder.id`,
  // so use that directly; the by-invoice lookup is a fallback for payloads that
  // predate the field.
  const { data: productionOrder } = useQuery<any>({
    queryKey: ["production-by-invoice", order?.proformaInvoiceId],
    queryFn: () => customFetch(`/production/by-invoice/${order?.proformaInvoiceId}`),
    enabled: !!order?.proformaInvoiceId,
  });
  const productionOrderId = order?.productionOrder?.id || productionOrder?.id;

  // Voice notes are recorded against the production order (or the linked deal
  // when no production order exists yet). The backend cross-links deal ↔
  // production, so both sides always see the merged list.
  const voiceUploadTarget = productionOrderId
    ? { entityType: "production" as const, entityId: productionOrderId }
    : order?.dealId
      ? { entityType: "deal" as const, entityId: order.dealId }
      : null;

  const { data: productionChat, refetch: refetchMessages } = useQuery<any>({
    queryKey: ["production-messages", productionOrderId],
    queryFn: () => customFetch(`/production/orders/${productionOrderId}/messages`),
    enabled: !!productionOrderId, staleTime: 3_000, refetchInterval: productionOrderId ? 5_000 : false,
  });
  const productionMessages = productionChat?.messages;

  const sortedMessages = useMemo(() => {
    if (!productionMessages) return [];
    return [...productionMessages].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id);
  }, [productionMessages]);

  const sendMessage = useMutation({
    mutationFn: (msg: string) =>
      customFetch<any>(`/production/orders/${productionOrderId}/messages`, {
        method: "POST", body: JSON.stringify({ message: msg }), headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => { setMessageText(""); refetchMessages(); },
    onError: () => toast({ title: "Failed to send message", variant: "destructive" }),
  });

  // Mark chat messages as read when conversation is open
  const markMessagesRead = useMutation({
    mutationFn: () => customFetch(`/production/orders/${productionOrderId}/messages/read`, {
      method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => refetchMessages(),
  });

  useEffect(() => {
    if (sortedMessages && sortedMessages.length > 0 && productionOrderId && !markMessagesRead.isPending) {
      markMessagesRead.mutate();
    }
  }, [sortedMessages?.length, productionOrderId]);

  const handleSendMessage = () => {
    if (!messageText.trim() || sendMessage.isPending || !productionOrderId) return;
    sendMessage.mutate(messageText.trim());
  };

  useEffect(() => {
    if (!sortedMessages) return;
    const container = chatScrollRef.current;
    const isAtBottom = container ? container.scrollHeight - container.scrollTop - container.clientHeight < 80 : true;
    if (isAtBottom) { container?.scrollTo({ top: container.scrollHeight, behavior: "smooth" }); setUnreadCount(0); }
    else if (sortedMessages.length > prevMsgCountRef.current) { setUnreadCount(c => c + (sortedMessages.length - prevMsgCountRef.current)); }
    prevMsgCountRef.current = sortedMessages.length;
  }, [sortedMessages]);

  // Scroll to bottom on initial load only — subsequent scrolls are handled by the smart effect above.
  useEffect(() => {
    if (!sortedMessages || sortedMessages.length === 0 || initialScrollDoneRef.current) return;
    requestAnimationFrame(() => {
      chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "instant" });
      initialScrollDoneRef.current = true;
    });
  }, [sortedMessages]);

  // While the chat is open, mark this order's chat notifications as read so the
  // green unread icons in the orders list and the unread dots in the bell
  // dropdown clear immediately (and after every new message arrives via SSE).
  useEffect(() => {
    if (!id) return;
    const chatLinks = new Set<string>([`/orders/${id}`]);
    if (productionOrderId) chatLinks.add(`/production/orders/${productionOrderId}`);
    const pending = notifications.filter((n) =>
      !n.readAt &&
      (n.type === "production_message" || n.type === "voice_note") &&
      !!n.link && chatLinks.has(n.link)
    );
    if (pending.length === 0) return;
    pending.forEach((n) => { markAsRead(n.id); });
    queryClient.invalidateQueries({ queryKey: ["orders-global"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["unread-count"] });
  }, [id, productionOrderId, notifications, markAsRead, queryClient]);

  if (!id || isNaN(id)) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Invalid order ID.</p>
        <Button variant="link" onClick={() => setLocation("/orders")}>Back to Orders</Button>
      </div>
    );
  }

  if (isLoading) return <div className="p-6 space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-48 w-full" /></div>;
  if (!order) return <div className="p-6 text-center">Order not found</div>;

  const role = user?.role;
  const canViewProduction = role === "admin" || role === "production_and_support" || role === "production" || role === "sales";
  const canUpdateProduction = role === "admin" || role === "production" || role === "production_and_support";

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{order.orderNumber}</h1>
            <Badge className={`${ORDER_STATUS_COLORS[order.status] || "bg-gray-100"}`}>{order.status}</Badge>
            {order.isRepeatOrder && <Badge className="bg-amber-100 text-amber-700">Repeat Order</Badge>}
            {order.dealId && <Badge variant="outline" className="font-mono text-xs">Linked Deal: #{order.dealId}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{(() => { const n = order.companyName || order.customerName || "-"; const cc = order.customerCode; return cc && !n.includes(cc) ? `${n} (${cc})` : n; })()}</p>
        </div>
        {order.status !== "Cancelled" && order.status !== "Completed" && (
          <Button variant="destructive" size="sm" onClick={() => setCancelDialog(true)}>
            <XCircle className="h-4 w-4 mr-1.5" /> Cancel Order
          </Button>
        )}
      </div>

      {/* Order Info Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Order Date</p>
          <p className="font-medium text-sm">{new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Grand Total</p>
          <p className="font-bold text-sm">₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Sales Owner</p>
          <p className="font-medium text-sm">{order.salesOwner?.name || "-"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Support Owner</p>
          <p className="font-medium text-sm">{order.supportOwner?.name || "-"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Unit</p>
          <p className="font-medium text-sm">{order.productionUnit || "-"}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Products</p>
          <p className="font-medium text-sm">{order.items?.length || 0} items</p>
        </Card>
      </div>

      {/* Delivery & Payment Info */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Delivery & Payment</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          {order.paymentTerms && <div><span className="text-muted-foreground">Payment Terms:</span> <span className="font-medium">{order.paymentTerms}</span></div>}
          {order.deliveryTerms && <div><span className="text-muted-foreground">Delivery Terms:</span> <span className="font-medium">{order.deliveryTerms}</span></div>}
          {order.freight && <div><span className="text-muted-foreground">Freight:</span> <span className="font-medium">₹{Number(order.freight).toLocaleString("en-IN")}</span></div>}
          {order.transportCompany && <div><span className="text-muted-foreground">Transport:</span> <span className="font-medium">{order.transportCompany}</span></div>}
          {order.productionOrder?.transportName && <div><span className="text-muted-foreground">Loaded Vehicle:</span> <span className="font-medium">{order.productionOrder.transportName}</span></div>}
          {order.productionOrder?.transportDetails && <div><span className="text-muted-foreground">LR / Transport Details:</span> <span className="font-medium">{order.productionOrder.transportDetails}</span></div>}
          {order.dispatchAddress && <div className="col-span-2"><span className="text-muted-foreground">Dispatch Address:</span> <span className="font-medium">{order.dispatchAddress}</span></div>}
          {order.remarks && <div className="col-span-2"><span className="text-muted-foreground">Remarks:</span> <span className="font-medium">{order.remarks}</span></div>}
        </CardContent>
      </Card>

      {/* Products Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Products ({order.items?.length || 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {order.items && order.items.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">#</TableHead>
                    <TableHead className="text-xs">Product Name</TableHead>
                    <TableHead className="text-xs">Bottle Weight</TableHead>
                    <TableHead className="text-xs">Color</TableHead>
                    <TableHead className="text-xs">Cap Color</TableHead>
                    <TableHead className="text-xs">Machine</TableHead>
                    <TableHead className="text-xs">HSN</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">Rate</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((item: any, idx: number) => (
                    <TableRow key={item.id || idx}>
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium text-xs">{item.productName}</TableCell>
                      <TableCell className="text-xs">{item.bottleWeight || "-"}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1">
                          {item.colour && <span className="w-2.5 h-2.5 rounded-full border shrink-0" style={{ backgroundColor: item.colour?.toLowerCase() }} />}
                          {item.colour || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{item.capColour || "-"}</TableCell>
                      <TableCell className="text-xs">{item.machineType || "-"}</TableCell>
                      <TableCell className="text-xs">{item.hsnCode || "-"}</TableCell>
                      <TableCell className="text-xs text-right">{Number(item.quantity || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-right">₹{Number(item.rate || 0).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-xs text-right font-medium">₹{Number(item.amount || 0).toLocaleString("en-IN")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-center py-8 text-muted-foreground text-sm">No items</p>
          )}
        </CardContent>
      </Card>

      {/* Order Conversation (Sales workspace — reply to Production directly) */}
      {(order.dealId || order.proformaInvoiceId) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> Order Conversation{productionChat?.companyName ? <span className="text-[11px] font-normal text-muted-foreground">· {productionChat.companyName}{productionChat.orderNumber ? ` (${productionChat.orderNumber})` : ""}</span> : null}</CardTitle>
                <span className="inline-flex items-center gap-1 text-[10px] text-green-600 font-medium bg-green-50 border border-green-200 rounded-full px-2 py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Realtime</span>
              </div>
                {sortedMessages && sortedMessages.length > 0 && <span className="text-[10px] text-muted-foreground">{sortedMessages.length} message{sortedMessages.length !== 1 ? "s" : ""}</span>}
            </div>
          </CardHeader>
          <CardContent>
              <div ref={chatContainerRef} className="relative rounded-xl border bg-[#fafafa] overflow-hidden" style={{ height: 300 }}>
              <div ref={chatScrollRef} className="h-full overflow-y-auto px-3 py-3 space-y-3">
                {!productionOrderId ? (
                  <div className="flex items-center justify-center h-full text-center">
                    <div className="flex flex-col items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground max-w-xs">No production order yet — the conversation opens once this order reaches production.</p>
                    </div>
                  </div>
                ) : !sortedMessages || sortedMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3"><MessageSquare className="h-5 w-5 text-muted-foreground/50" /></div>
                    <p className="text-sm font-medium text-muted-foreground">No conversation yet.</p>
                  </div>
                ) : (
                  <>
                    {sortedMessages.map((msg: any, idx: number) => {
                      const isMe = user && msg.senderId === user.id;
                      const showAvatar = idx === 0 || sortedMessages[idx - 1].senderId !== msg.senderId;
                      const isLastInGroup = idx === sortedMessages.length - 1 || sortedMessages[idx + 1].senderId !== msg.senderId;
                      const timeStr = new Date(msg.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) === new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                        ? new Date(msg.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                        : new Date(msg.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " · " + new Date(msg.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                      return (
                        <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                          {showAvatar && !isMe && <div className="flex items-center gap-1.5 mb-1 ml-1"><span className="text-[11px] font-semibold text-foreground">{msg.senderName}</span><span className="text-[9px] font-medium text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-px leading-none">{msg.senderRole}</span></div>}
                          <div className={`max-w-[75%] px-3 py-2 text-[12.5px] leading-relaxed ${isMe ? "bg-violet-600 text-white rounded-2xl rounded-br-md shadow-sm" : "bg-white text-foreground border border-gray-200 rounded-2xl rounded-bl-md shadow-sm"}`}>
                            <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                          </div>
                          {isLastInGroup && <span className={`text-[9px] text-muted-foreground/60 mt-1 flex items-center gap-1 ${isMe ? "mr-1 flex-row-reverse" : "ml-1"}`}>{timeStr}{isMe && <DoubleTick isRead={Array.isArray(msg.readBy) && msg.readBy.length > 0} className="ml-0.5" />}</span>}
                        </div>
                      );
                    })}
                    <div ref={chatEndRef} />
                    <div ref={bottomRef} />
                  </>
                )}
              </div>
              {unreadCount > 0 && (
                <button onClick={() => { chatContainerRef.current?.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: "smooth" }); setUnreadCount(0); }}
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 bg-violet-600 text-white text-[11px] font-medium rounded-full px-3 py-1.5 shadow-lg hover:bg-violet-700 transition-colors cursor-pointer">
                  {unreadCount} new message{unreadCount !== 1 ? "s" : ""}
                </button>
              )}
            </div>
            <div className="flex items-end gap-2 mt-2">
              <div className="flex-1">
                <textarea value={messageText} onChange={e => setMessageText(e.target.value)} placeholder="Type your message..." rows={1}
                  className="w-full min-h-[40px] max-h-24 text-[13px] resize-none rounded-xl border-gray-200 bg-white px-3 py-2 focus-visible:ring-violet-500 focus-visible:border-violet-400 placeholder:text-muted-foreground/50"
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
              </div>
              <button onClick={handleSendMessage} disabled={!messageText.trim() || sendMessage.isPending}
                className="shrink-0 w-10 h-10 rounded-full bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Voice Notes — merged from the production order + linked deal */}
      {(productionOrderId || order.dealId) && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Mic className="h-4 w-4" /> Voice Notes</CardTitle>
            {voiceUploadTarget && (
              <VoiceNoteUploader entityType={voiceUploadTarget.entityType} entityId={voiceUploadTarget.entityId} label="Record" />
            )}
          </CardHeader>
          <CardContent>
            <MergedVoiceNotes productionOrderId={productionOrderId} dealId={order.dealId} />
          </CardContent>
        </Card>
      )}

      {/* Production Progress (for Sales users - read only) */}
      {canViewProduction && order.dealId && (
        <ProductionProgressSection dealId={order.dealId} />
      )}

      {/* Cancel Order Modal */}
      <CancelOrderModal
        open={cancelDialog}
        onOpenChange={setCancelDialog}
        orderId={id}
        orderNumber={order.orderNumber}
        customerName={order.customerName}
        contactId={order.contactId}
        dealId={order.dealId}
      />
    </div>
  );
}
