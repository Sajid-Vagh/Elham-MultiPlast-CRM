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
import { ArrowLeft, Plus, Clock, User, Send, MessageSquare, Truck, Upload, CheckCircle, ArrowRightLeft, Play, XCircle, Calendar, AlertTriangle, Eye } from "lucide-react";
import { useActiveUnits } from "@/lib/use-active-units";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { VoiceNoteList } from "@/components/voice-note-player";

const STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-700 border-gray-300",
  "Accepted": "bg-blue-100 text-blue-700 border-blue-300",
  "Planning": "bg-indigo-100 text-indigo-700 border-indigo-300",
  "Machine Running": "bg-orange-100 text-orange-700 border-orange-300",
  "Quality Check": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "Ready For Dispatch": "bg-green-100 text-green-700 border-green-300",
  "Completed": "bg-emerald-100 text-emerald-700 border-emerald-300",
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
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferUnit, setTransferUnit] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [planningDialogOpen, setPlanningDialogOpen] = useState(false);
  const [planningMachine, setPlanningMachine] = useState("");
  const [planningExpectedStart, setPlanningExpectedStart] = useState("");
  const [planningExpectedCompletion, setPlanningExpectedCompletion] = useState("");
  const [planningNotes, setPlanningNotes] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [noteType, setNoteType] = useState("general");
  const { units: activeUnits } = useActiveUnits();

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
    mutationFn: (data: { note: string; noteType?: string }) =>
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

  const transferOrder = useMutation({
    mutationFn: (data: { targetUnit: string; reason?: string }) =>
      customFetch<any>(`/production/orders/${id}/transfer`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      onProductionChange(queryClient, id);
      setTransferDialogOpen(false);
      setTransferUnit("");
      setTransferReason("");
      toast({ title: "Production order transferred successfully" });
    },
    onError: () => toast({ title: "Failed to transfer order", variant: "destructive" }),
  });

  const acceptOrder = useMutation({
    mutationFn: () =>
      customFetch<any>(`/production/orders/${id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      onProductionChange(queryClient, id);
      toast({ title: "Order accepted" });
    },
    onError: () => toast({ title: "Failed to accept order", variant: "destructive" }),
  });

  const startProduction = useMutation({
    mutationFn: () =>
      customFetch<any>(`/production/orders/${id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      onProductionChange(queryClient, id);
      toast({ title: "Production started! Machine is now frozen." });
    },
    onError: () => toast({ title: "Failed to start production", variant: "destructive" }),
  });

  const updatePlanning = useMutation({
    mutationFn: (data: any) =>
      customFetch<any>(`/production/orders/${id}/planning`, {
        method: "PATCH",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      onProductionChange(queryClient, id);
      setPlanningDialogOpen(false);
      toast({ title: "Planning updated" });
    },
    onError: () => toast({ title: "Failed to update planning", variant: "destructive" }),
  });

  const cancelOrder = useMutation({
    mutationFn: (data: { reason: string }) =>
      customFetch<any>(`/production/orders/${id}/cancel`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      onProductionChange(queryClient, id);
      setCancelDialogOpen(false);
      setCancelReason("");
      toast({ title: "Order cancelled" });
    },
    onError: () => toast({ title: "Failed to cancel order", variant: "destructive" }),
  });

  const approveModification = useMutation({
    mutationFn: (data: { approve: boolean }) =>
      customFetch<any>(`/production/orders/${id}/approve-modification`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      onProductionChange(queryClient, id);
      toast({ title: "Modification decision recorded" });
    },
    onError: () => toast({ title: "Failed to process modification", variant: "destructive" }),
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

  const isProductionUser = user?.role === "production" || user?.role === "production_and_support" || user?.role === "admin";
  const isSupportUser = user?.role === "production_and_support" || user?.role === "admin";
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
                  <div className="font-medium mt-1 flex items-center gap-1">
                    {order.createdByName || "-"}
                    {order.createdByRole && (
                      <Badge variant="outline" className={`text-[10px] py-0 ${order.createdByRole === "production_and_support" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                        {order.createdByRole === "production_and_support" ? "SUPPORT" : "SALES"}
                      </Badge>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Assigned Manager</span>
                  <p className="font-medium mt-1">{order.assignedManager?.name || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Requested Unit</span>
                  <div className="font-medium mt-1">
                    {order.requestedUnit ? (
                      <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">{order.requestedUnit}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Current Unit</span>
                  <div className="font-medium mt-1">
                    {order.productionUnit ? (
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">{order.productionUnit}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Unassigned</span>
                    )}
                  </div>
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

          {/* Voice Note from Sales */}
          {(order.dealId || order.id) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Voice Note from Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <VoiceNoteList
                  dealId={order.dealId}
                  productionOrderId={order.id}
                  currentUserId={user?.id || 0}
                  userRole={user?.role || ""}
                />
              </CardContent>
            </Card>
          )}

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
                {order?.status === "Pending" && (
                  <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => acceptOrder.mutate()} disabled={acceptOrder.isPending}>
                    <CheckCircle className="h-4 w-4 mr-2" /> Accept Order
                  </Button>
                )}
                {(order?.status === "Pending" || order?.status === "Accepted" || order?.status === "Planning") && (
                  <Button className="w-full" variant="outline" onClick={() => setPlanningDialogOpen(true)}>
                    <Calendar className="h-4 w-4 mr-2" /> Planning
                  </Button>
                )}
                {order?.status === "Planning" && (
                  <Button className="w-full bg-orange-600 hover:bg-orange-700" onClick={() => startProduction.mutate()} disabled={startProduction.isPending}>
                    <Play className="h-4 w-4 mr-2" /> Start Production
                  </Button>
                )}
                {order?.validNextStatuses && order.validNextStatuses.length > 0 && (
                <Button className="w-full" onClick={() => setStatusDialogOpen(true)}>
                  Update Status
                </Button>
                )}
                {(user?.role === "admin" || user?.role === "production" || user?.role === "production_and_support") && (
                  <Button className="w-full" variant="outline" onClick={() => setTransferDialogOpen(true)}>
                    <ArrowRightLeft className="h-4 w-4 mr-2" /> Transfer Unit
                  </Button>
                )}
                {order?.status !== "Completed" && order?.status !== "Cancelled" && (
                  <Button className="w-full" variant="destructive" onClick={() => setCancelDialogOpen(true)}>
                    <XCircle className="h-4 w-4 mr-2" /> Cancel Order
                  </Button>
                )}
                {order?.isFrozen && order?.status !== "Completed" && (
                  <div className="p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700">
                    <AlertTriangle className="h-3 w-3 inline mr-1" />
                    Machine Running — PI modifications require approval
                  </div>
                )}
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
                  {(order.validNextStatuses || []).map((s: string) => (
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
          <div>
            <label className="text-sm font-medium">Note Type</label>
            <Select value={noteType} onValueChange={setNoteType}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="delay">Delay</SelectItem>
                <SelectItem value="issue">Issue</SelectItem>
                <SelectItem value="machine_problem">Machine Problem</SelectItem>
                <SelectItem value="material_shortage">Material Shortage</SelectItem>
                <SelectItem value="power_failure">Power Failure</SelectItem>
                <SelectItem value="quality_issue">Quality Issue</SelectItem>
                <SelectItem value="operator_remark">Operator Remark</SelectItem>
                <SelectItem value="planning">Planning</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
              onClick={() => addNote.mutate({ note: newNote.trim(), noteType })}
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

      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" /> Transfer to Another Unit
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Current Unit</label>
              <p className="text-sm text-muted-foreground mt-1">
                {order.productionUnit || "Unassigned"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium">Target Unit *</label>
              <Select value={transferUnit} onValueChange={setTransferUnit}>
                <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                <SelectContent>
                  {activeUnits.filter(u => u !== order.productionUnit && u !== PENDING_UNIT_ASSIGNMENT).map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Reason *</label>
              <Textarea
                placeholder="Reason for transfer (required)..."
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!transferUnit || !transferReason.trim() || transferOrder.isPending}
              onClick={() => transferOrder.mutate({ targetUnit: transferUnit, reason: transferReason })}
            >
              {transferOrder.isPending ? "Transferring..." : "Transfer Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planningDialogOpen} onOpenChange={setPlanningDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" /> Production Planning
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Machine</label>
              <input
                type="text"
                className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                placeholder="e.g. Machine 1, Injection Moulding..."
                value={planningMachine}
                onChange={(e) => setPlanningMachine(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Expected Start</label>
                <input
                  type="date"
                  className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                  value={planningExpectedStart}
                  onChange={(e) => setPlanningExpectedStart(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Expected Completion</label>
                <input
                  type="date"
                  className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                  value={planningExpectedCompletion}
                  onChange={(e) => setPlanningExpectedCompletion(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Planning Notes</label>
              <Textarea
                placeholder="Planning remarks..."
                value={planningNotes}
                onChange={(e) => setPlanningNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanningDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={updatePlanning.isPending}
              onClick={() => updatePlanning.mutate({
                machine: planningMachine || undefined,
                expectedStartDate: planningExpectedStart || undefined,
                expectedCompletionDate: planningExpectedCompletion || undefined,
                notes: planningNotes || undefined,
              })}
            >
              {updatePlanning.isPending ? "Saving..." : "Save Planning"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" /> Cancel Production Order
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to cancel this order? This action cannot be undone.
            </p>
            <div>
              <label className="text-sm font-medium">Reason *</label>
              <Textarea
                placeholder="Cancellation reason (required)..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Keep Order</Button>
            <Button
              variant="destructive"
              disabled={!cancelReason.trim() || cancelOrder.isPending}
              onClick={() => cancelOrder.mutate({ reason: cancelReason })}
            >
              {cancelOrder.isPending ? "Cancelling..." : "Cancel Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
