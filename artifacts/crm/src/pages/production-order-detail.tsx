import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { onProductionChange } from "@/lib/query-invalidation";
import { ArrowLeft, Plus, Clock, User, Send, MessageSquare, Truck, Upload, CheckCircle } from "lucide-react";

const STATUSES = [
  "Pending", "Material Ready", "Production Started", "In Process",
  "Quality Check", "Packing", "Ready For Dispatch", "Completed", "On Hold", "Cancelled",
] as const;

const STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-700 border-gray-300",
  "Material Ready": "bg-blue-100 text-blue-700 border-blue-300",
  "Production Started": "bg-orange-100 text-orange-700 border-orange-300",
  "In Process": "bg-purple-100 text-purple-700 border-purple-300",
  "Quality Check": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "Packing": "bg-cyan-100 text-cyan-700 border-cyan-300",
  "Ready For Dispatch": "bg-green-100 text-green-700 border-green-300",
  "Completed": "bg-emerald-100 text-emerald-700 border-emerald-300",
  "On Hold": "bg-gray-100 text-gray-500 border-gray-300",
  "Cancelled": "bg-red-100 text-red-700 border-red-300",
};

const PRODUCTION_ORDER_QUERY_KEY = (id: string) => ["production-order", id];

export default function ProductionOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: user } = useGetMe();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusNotes, setStatusNotes] = useState("");
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false);
  const [transportName, setTransportName] = useState("");
  const [transportDetails, setTransportDetails] = useState("");
  const [builtyFile, setBuiltyFile] = useState<File | null>(null);
  const [builtyPreview, setBuiltyPreview] = useState<string | null>(null);

  const { data: order, isLoading } = useQuery({
    queryKey: PRODUCTION_ORDER_QUERY_KEY(id),
    queryFn: () => customFetch<any>(`/production/orders/${id}`),
    enabled: !!id && !!user,
  });

  const updateStatus = useMutation({
    mutationFn: (data: { status: string; notes?: string }) =>
      customFetch<any>(`/production/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      onProductionChange(queryClient, id);
      setStatusDialogOpen(false);
      setNewStatus("");
      setStatusNotes("");
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const addNote = useMutation({
    mutationFn: (data: { note: string }) =>
      customFetch<any>(`/production/orders/${id}/notes`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      onProductionChange(queryClient, id);
      setNoteDialogOpen(false);
      setNewNote("");
      toast({ title: "Note added" });
    },
    onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
  });

  const completeDispatch = useMutation({
    mutationFn: async (data: { transportName: string; transportDetails: string; builtyUrl?: string }) => {
      return customFetch<any>(`/production/orders/${id}/dispatch`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: () => {
      onProductionChange(queryClient, id);
      setDispatchDialogOpen(false);
      setTransportName("");
      setTransportDetails("");
      setBuiltyFile(null);
      setBuiltyPreview(null);
      toast({ title: "Dispatch completed! Sales team notified." });
    },
    onError: () => toast({ title: "Failed to complete dispatch", variant: "destructive" }),
  });

  const uploadBuilty = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return customFetch<{ url: string }>(`/production/orders/${id}/builty`, {
        method: "POST",
        body: formData,
      });
    },
  });

  // Order Conversation
  const [messageText, setMessageText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const { data: productionMessages, refetch: refetchMessages } = useQuery({
    queryKey: ["production-messages", id],
    queryFn: () => customFetch<any[]>(`/production/orders/${id}/messages`),
    enabled: !!id,
    staleTime: 3_000,
    refetchInterval: id ? 5_000 : false,
  });

  const sendMessage = useMutation({
    mutationFn: (msg: string) =>
      customFetch<any>(`/production/orders/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: msg }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      setMessageText("");
      refetchMessages();
    },
    onError: () => toast({ title: "Failed to send message", variant: "destructive" }),
  });

  const handleSendMessage = () => {
    if (!messageText.trim() || sendMessage.isPending) return;
    sendMessage.mutate(messageText.trim());
  };

  const handleDispatchSubmit = async () => {
    if (!transportName.trim()) {
      toast({ title: "Transport name is required", variant: "destructive" });
      return;
    }
    let builtyUrl: string | undefined;
    if (builtyFile) {
      const result = await uploadBuilty.mutateAsync(builtyFile);
      builtyUrl = result.url;
    }
    completeDispatch.mutate({ transportName: transportName.trim(), transportDetails: transportDetails.trim(), builtyUrl });
  };

  useEffect(() => {
    if (!productionMessages) return;
    const container = chatContainerRef.current;
    const isAtBottom = container ? container.scrollHeight - container.scrollTop - container.clientHeight < 80 : true;
    if (isAtBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnreadCount(0);
    } else if (productionMessages.length > prevMsgCountRef.current) {
      setUnreadCount(c => c + (productionMessages.length - prevMsgCountRef.current));
    }
    prevMsgCountRef.current = productionMessages.length;
  }, [productionMessages]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    setUnreadCount(0);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => setLocation("/production/orders")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Orders
        </Button>
        <div className="py-12 text-center text-muted-foreground">Order not found</div>
      </div>
    );
  }

  const isProductionUser = user?.role === "production_manager" || user?.role === "admin";
  const isSupportUser = user?.role === "support" || user?.role === "admin";
  const isReadyForDispatch = order.status === "Ready For Dispatch";
  const hasDispatch = order.transportName || order.builtyUrl;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setLocation("/production/orders")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Production Order #{order.id}
            </h1>
            <p className="text-sm text-muted-foreground">
              Invoice: {order.invoice?.invoiceNumber || "N/A"}
            </p>
          </div>
        </div>
        <Badge className={`text-sm px-3 py-1 ${STATUS_COLORS[order.status] || "bg-gray-100"} border`} variant="outline">
          {order.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Order Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Company Name</span>
                  <p className="font-medium mt-1">{order.invoice?.companyName || order.invoice?.customerName || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Customer Name</span>
                  <p className="font-medium mt-1">{order.invoice?.customerName || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Mobile</span>
                  <p className="font-medium mt-1">{order.invoice?.mobile || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Priority</span>
                  <p className="font-medium mt-1">{order.priority}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Order Date</span>
                  <p className="font-medium mt-1">
                    {order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Expected Dispatch</span>
                  <p className="font-medium mt-1">
                    {order.expectedDispatchDate ? new Date(order.expectedDispatchDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Created By</span>
                  <p className="font-medium mt-1">
                    {order.createdByName || "-"}
                    {order.createdByRole && (
                      <Badge variant="outline" className="ml-2 text-[10px] py-0">
                        {order.createdByRole === "support" ? "Support" : "Sales"}
                      </Badge>
                    )}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Assigned Manager</span>
                  <p className="font-medium mt-1">{order.assignedManager?.name || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Production Unit</span>
                  <p className="font-medium mt-1">
                    {order.productionUnit ? (
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">{order.productionUnit}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </p>
                </div>
                <div className="col-span-2 md:col-span-3">
                  <span className="text-muted-foreground">Production Remarks</span>
                  <p className="font-medium mt-1">
                    {order.productionRemarks || <span className="text-muted-foreground">No remarks</span>}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Last Updated</span>
                  <p className="font-medium mt-1">
                    {order.updatedAt ? new Date(order.updatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {order.items && order.items.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Product Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Product</th>
                        <th className="text-left py-2 px-2">HSN</th>
                        <th className="text-right py-2 px-2">Qty</th>
                        <th className="text-right py-2 px-2">Rate</th>
                        <th className="text-right py-2 px-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item: any, idx: number) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="py-2 px-2">
                            {item.productName}
                            {item.bottleType && <span className="text-muted-foreground ml-1">({item.bottleType})</span>}
                            {item.capacity && <span className="text-muted-foreground ml-1">{item.capacity}</span>}
                          </td>
                          <td className="py-2 px-2 text-muted-foreground">{item.hsnCode || "-"}</td>
                          <td className="py-2 px-2 text-right">{Number(item.quantity).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right">{Number(item.rate).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right">{Number(item.amount).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {order.timeline && order.timeline.length > 0 ? (
                <div className="space-y-4">
                  {order.timeline.map((entry: any) => (
                    <div key={entry.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-primary mt-1.5" />
                        <div className="w-0.5 flex-1 bg-border min-h-[24px]" />
                      </div>
                      <div className="flex-1 pb-2">
                        <div className="flex items-center gap-2">
                          <Badge className={`${STATUS_COLORS[entry.status] || "bg-gray-100"} border text-xs`} variant="outline">
                            {entry.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(entry.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                          </span>
                        </div>
                        {entry.notes && (
                          <p className="text-sm mt-1 text-muted-foreground">{entry.notes}</p>
                        )}
                        {entry.createdByUser && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <User className="h-3 w-3" /> by {entry.createdByUser.name}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No timeline entries yet</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Production Notes</CardTitle>
              {isProductionUser && (
                <Button size="sm" variant="outline" onClick={() => setNoteDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Add Note
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {order.notes && order.notes.length > 0 ? (
                <div className="space-y-3">
                  {order.notes.map((note: any) => (
                    <div key={note.id} className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-sm">{note.note}</p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        <span>{note.createdByUser?.name || "Unknown"}</span>
                        <span>·</span>
                        <Clock className="h-3 w-3" />
                        <span>{new Date(note.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No notes yet</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    💬 Order Conversation
                  </CardTitle>
                  <span className="inline-flex items-center gap-1 text-[10px] text-green-600 font-medium bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Realtime
                  </span>
                </div>
                {productionMessages && productionMessages.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{productionMessages.length} message{productionMessages.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">Communicate with the team regarding this order.</p>
            </CardHeader>
            <CardContent>
              <div
                ref={chatContainerRef}
                className="relative rounded-xl border bg-[#fafafa] overflow-hidden"
                style={{ height: 300 }}
              >
                <div className="h-full overflow-y-auto px-3 py-3 space-y-3">
                  {!productionMessages || productionMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                        <MessageSquare className="h-5 w-5 text-muted-foreground/50" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">No conversation yet.</p>
                      <p className="text-[11px] text-muted-foreground/70 mt-1">Start a conversation with the team.</p>
                    </div>
                  ) : (
                    <>
                      {productionMessages.map((msg: any, idx: number) => {
                        const isMe = user && msg.senderId === user.id;
                        const showAvatar = idx === 0 || productionMessages[idx - 1].senderId !== msg.senderId;
                        const isLastInGroup = idx === productionMessages.length - 1 || productionMessages[idx + 1].senderId !== msg.senderId;
                        const timeStr = new Date(msg.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) === new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                          ? new Date(msg.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                          : new Date(msg.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " • " + new Date(msg.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                        return (
                          <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} animate-[fadeSlideIn_0.2s_ease-out]`}>
                            {showAvatar && !isMe && (
                              <div className="flex items-center gap-1.5 mb-1 ml-1">
                                <span className="text-[11px] font-semibold text-foreground">{msg.senderName}</span>
                                <span className="text-[9px] font-medium text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-px leading-none">{msg.senderRole}</span>
                              </div>
                            )}
                            {showAvatar && isMe && (
                              <div className="flex items-center gap-1.5 mb-1 mr-1">
                                <span className="text-[11px] font-semibold text-muted-foreground">You</span>
                              </div>
                            )}
                            <div className={`max-w-[75%] px-3 py-2 text-[12.5px] leading-relaxed ${
                              isMe
                                ? "bg-violet-600 text-white rounded-2xl rounded-br-md shadow-sm"
                                : "bg-white text-foreground border border-gray-200 rounded-2xl rounded-bl-md shadow-sm"
                            }`}>
                              <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                            </div>
                            {isLastInGroup && (
                              <span className={`text-[9px] text-muted-foreground/60 mt-1 ${isMe ? "mr-1" : "ml-1"}`}>
                                {timeStr}
                              </span>
                            )}
                          </div>
                        );
                      })}
                      <div ref={chatEndRef} />
                    </>
                  )}
                </div>

                {unreadCount > 0 && (
                  <button
                    onClick={scrollToBottom}
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 bg-violet-600 text-white text-[11px] font-medium rounded-full px-3 py-1.5 shadow-lg hover:bg-violet-700 transition-colors cursor-pointer"
                  >
                    <span className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[6px] border-t-white" />
                    {unreadCount} new message{unreadCount !== 1 ? "s" : ""}
                  </button>
                )}
              </div>

              <div className="flex items-end gap-2 mt-2">
                <div className="flex-1 relative">
                  <Textarea
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    placeholder="Type your message..."
                    rows={1}
                    className="min-h-[40px] max-h-24 text-[13px] resize-none rounded-xl border-gray-200 bg-white pr-10 focus-visible:ring-violet-500 focus-visible:border-violet-400 placeholder:text-muted-foreground/50"
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  />
                </div>
                <button
                  onClick={handleSendMessage}
                  disabled={!messageText.trim() || sendMessage.isPending}
                  className="shrink-0 w-10 h-10 rounded-full bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md active:scale-95"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {isProductionUser && (
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" onClick={() => setStatusDialogOpen(true)}>
                  Update Status
                </Button>
              </CardContent>
            </Card>
          )}

          {isSupportUser && isReadyForDispatch && (
            <Card className="border-green-200 bg-green-50/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-700">
                  <Truck className="h-5 w-5" /> Dispatch Action
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-green-600">This order is ready for dispatch. Fill transport details and mark as complete.</p>
                <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => setDispatchDialogOpen(true)}>
                  <Truck className="h-4 w-4 mr-2" /> Complete Dispatch
                </Button>
              </CardContent>
            </Card>
          )}

          {hasDispatch && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-700">
                  <CheckCircle className="h-5 w-5" /> Dispatch Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {order.transportName && (
                  <div><span className="text-muted-foreground">Transport</span><p className="font-medium">{order.transportName}</p></div>
                )}
                {order.transportDetails && (
                  <div><span className="text-muted-foreground">Details</span><p className="font-medium">{order.transportDetails}</p></div>
                )}
                {order.builtyUrl && (
                  <div>
                    <span className="text-muted-foreground">Builty</span>
                    <p className="mt-1">
                      <a href={order.builtyUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">
                        View Builty Document
                      </a>
                    </p>
                  </div>
                )}
                {order.dispatchCompletedAt && (
                  <div><span className="text-muted-foreground">Completed</span><p className="font-medium">{new Date(order.dispatchCompletedAt).toLocaleString("en-IN")}</p></div>
                )}
                {order.dispatchCompletedByUser && (
                  <div><span className="text-muted-foreground">Dispatched By</span><p className="font-medium">{order.dispatchCompletedByUser.name}</p></div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Status Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current</span>
                <Badge className={`${STATUS_COLORS[order.status] || "bg-gray-100"} border`} variant="outline">
                  {order.status}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Priority</span>
                <span className="font-medium">{order.priority}</span>
              </div>
              {order.assignedManager && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Manager</span>
                  <span className="font-medium">{order.assignedManager.name}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Production Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">New Status</label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                placeholder="Any additional notes..."
                value={statusNotes}
                onChange={(e) => setStatusNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!newStatus || updateStatus.isPending}
              onClick={() => updateStatus.mutate({ status: newStatus, notes: statusNotes })}
            >
              {updateStatus.isPending ? "Updating..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Production Note</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Enter your note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!newNote.trim() || addNote.isPending}
              onClick={() => addNote.mutate({ note: newNote.trim() })}
            >
              {addNote.isPending ? "Adding..." : "Add Note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dispatchDialogOpen} onOpenChange={setDispatchDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-green-600" /> Complete Dispatch
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Transport Name *</label>
              <input
                type="text"
                className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                placeholder="e.g. Rajdhani Transport, Self Delivery..."
                value={transportName}
                onChange={(e) => setTransportName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Transport Details</label>
              <Textarea
                placeholder="Vehicle number, driver name, LR number, etc."
                value={transportDetails}
                onChange={(e) => setTransportDetails(e.target.value)}
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Builty (Transport Receipt)</label>
              <div className="mt-1 flex items-center gap-3">
                <label className="flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer hover:bg-muted/50 text-sm">
                  <Upload className="h-4 w-4" />
                  {builtyFile ? builtyFile.name : "Choose file (PDF, JPG, PNG)"}
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setBuiltyFile(file);
                        if (file.type.startsWith("image/")) {
                          const reader = new FileReader();
                          reader.onload = (ev) => setBuiltyPreview(ev.target?.result as string);
                          reader.readAsDataURL(file);
                        } else {
                          setBuiltyPreview(null);
                        }
                      }
                    }}
                  />
                </label>
                {builtyFile && (
                  <Button variant="ghost" size="sm" onClick={() => { setBuiltyFile(null); setBuiltyPreview(null); }}>
                    Remove
                  </Button>
                )}
              </div>
              {builtyPreview && (
                <img src={builtyPreview} alt="Builty preview" className="mt-2 h-24 rounded border" />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDispatchDialogOpen(false); setBuiltyFile(null); setBuiltyPreview(null); }}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={!transportName.trim() || completeDispatch.isPending || uploadBuilty.isPending}
              onClick={handleDispatchSubmit}
            >
              {completeDispatch.isPending || uploadBuilty.isPending ? "Processing..." : "Complete Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
