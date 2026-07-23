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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { onProductionChange } from "@/lib/query-invalidation";
import { ArrowLeft, Plus, Clock, User, Send, MessageSquare, Truck, Calendar, Factory, ClipboardList, CheckCircle2, AlertTriangle, Package, CircleDot } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-700 border-gray-300",
  "Production On Going": "bg-orange-100 text-orange-700 border-orange-300",
  "Packaging": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "Ready To Dispatch": "bg-green-100 text-green-700 border-green-300",
  "Completed": "bg-emerald-100 text-emerald-700 border-emerald-300",
  "Cancelled": "bg-red-100 text-red-700 border-red-300",
};

const DISPATCH_STATUS_COLORS: Record<string, string> = {
  "Pending Dispatch": "bg-gray-100 text-gray-700 border-gray-300",
  "Load Vehicle": "bg-blue-100 text-blue-700 border-blue-300",
  "Dispatch": "bg-purple-100 text-purple-700 border-purple-300",
  "Delivered": "bg-emerald-100 text-emerald-700 border-emerald-300",
};

const PRODUCTION_ORDER_QUERY_KEY = (id: string) => ["production-order", id];

export default function ProductionOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: user } = useGetMe();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [noteType, setNoteType] = useState("general");

  const [loadVehicleDialog, setLoadVehicleDialog] = useState(false);
  const [transportName, setTransportName] = useState("");
  const [lrNumber, setLrNumber] = useState("");
  const [builtyFile, setBuiltyFile] = useState<File | null>(null);
  const [dispatchRemarks, setDispatchRemarks] = useState("");

  const [messageText, setMessageText] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const { data: order, isLoading } = useQuery({
    queryKey: PRODUCTION_ORDER_QUERY_KEY(id),
    queryFn: () => customFetch<any>(`/production/orders/${id}`),
    enabled: !!id && !!user,
  });

  const isProductionUser = user?.role === "production" || user?.role === "production_and_support" || user?.role === "admin";
  const isSupportUser = user?.role === "production_and_support" || user?.role === "admin";
  const isAdmin = user?.role === "admin";

  // ── Production Mutations ──
  const startProductionOnGoing = useMutation({
    mutationFn: () => customFetch<any>(`/production/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Production On Going" }),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => { onProductionChange(queryClient, id); toast({ title: "Production On Going" }); },
    onError: (err: any) => toast({ title: err?.message || "Failed", variant: "destructive" }),
  });

  const moveToPackaging = useMutation({
    mutationFn: () => customFetch<any>(`/production/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Packaging" }),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => { onProductionChange(queryClient, id); toast({ title: "Moved to Packaging" }); },
    onError: (err: any) => toast({ title: err?.message || "Failed", variant: "destructive" }),
  });

  const markReadyForDispatch = useMutation({
    mutationFn: () => customFetch<any>(`/production/orders/${id}/ready-for-dispatch`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => { onProductionChange(queryClient, id); toast({ title: "Ready To Dispatch — Support team notified" }); },
    onError: (err: any) => toast({ title: err?.message || "Failed", variant: "destructive" }),
  });

  // ── Dispatch Mutations ──
  const loadVehicleMutation = useMutation({
    mutationFn: async (data: { transportName: string; lrNumber: string; dispatchRemarks?: string }) => {
      const res = await fetch(`/api/production/orders/${id}/load-vehicle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Failed"); }
      return res.json();
    },
    onSuccess: () => { onProductionChange(queryClient, id); setLoadVehicleDialog(false); setTransportName(""); setLrNumber(""); setBuiltyFile(null); setDispatchRemarks(""); toast({ title: "Vehicle loaded" }); },
    onError: (err: any) => toast({ title: err?.message || "Failed", variant: "destructive" }),
  });

  const dispatchMutation = useMutation({
    mutationFn: () => customFetch<any>(`/production/orders/${id}/dispatch`, {
      method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => { onProductionChange(queryClient, id); toast({ title: "Order dispatched" }); },
    onError: (err: any) => toast({ title: err?.message || "Failed", variant: "destructive" }),
  });

  const deliverMutation = useMutation({
    mutationFn: () => customFetch<any>(`/production/orders/${id}/deliver`, {
      method: "POST", body: JSON.stringify({}), headers: { "Content-Type": "application/json" },
    }),
    onSuccess: () => { onProductionChange(queryClient, id); toast({ title: "Order delivered — Completed" }); },
    onError: (err: any) => toast({ title: err?.message || "Failed", variant: "destructive" }),
  });

  const addNote = useMutation({
    mutationFn: (data: { note: string; noteType?: string }) =>
      customFetch<any>(`/production/orders/${id}/notes`, {
        method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => { onProductionChange(queryClient, id); setNoteDialogOpen(false); setNewNote(""); toast({ title: "Note added" }); },
    onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
  });

  // ── Order Conversation ──
  const { data: productionMessages, refetch: refetchMessages } = useQuery({
    queryKey: ["production-messages", id],
    queryFn: () => customFetch<any[]>(`/production/orders/${id}/messages`),
    enabled: !!id, staleTime: 3_000, refetchInterval: id ? 5_000 : false,
  });

  const sendMessage = useMutation({
    mutationFn: (msg: string) =>
      customFetch<any>(`/production/orders/${id}/messages`, {
        method: "POST", body: JSON.stringify({ message: msg }), headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => { setMessageText(""); refetchMessages(); },
    onError: () => toast({ title: "Failed to send message", variant: "destructive" }),
  });

  const handleSendMessage = () => {
    if (!messageText.trim() || sendMessage.isPending) return;
    sendMessage.mutate(messageText.trim());
  };

  useEffect(() => {
    if (!productionMessages) return;
    const container = chatContainerRef.current;
    const isAtBottom = container ? container.scrollHeight - container.scrollTop - container.clientHeight < 80 : true;
    if (isAtBottom) { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); setUnreadCount(0); }
    else if (productionMessages.length > prevMsgCountRef.current) { setUnreadCount(c => c + (productionMessages.length - prevMsgCountRef.current)); }
    prevMsgCountRef.current = productionMessages.length;
  }, [productionMessages]);

  if (!id || isNaN(Number(id))) {
    return <div className="p-6 text-center"><p className="text-muted-foreground">Invalid order ID.</p><Button variant="link" onClick={() => setLocation("/production/orders")}>Back to Orders</Button></div>;
  }

  if (isLoading) return <div className="p-6 space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /><Skeleton className="h-60 w-full" /></div>;

  if (!order) return <div className="p-6"><Button variant="ghost" onClick={() => setLocation("/production/orders")}><ArrowLeft className="h-4 w-4 mr-2" /> Back</Button><div className="py-12 text-center text-muted-foreground">Order not found</div></div>;

  const isTerminal = order.status === "Completed" || order.status === "Cancelled";
  const isReadyToDispatch = order.status === "Ready To Dispatch";
  const ds = order.dispatchStatus;
  const isOutsourced = order.items?.some((item: any) => item.materialType === "PET");

  const handleLoadVehicle = () => {
    if (!transportName.trim()) { toast({ title: "Transport name is required", variant: "destructive" }); return; }
    if (!lrNumber.trim()) { toast({ title: "LR / Builty number is required", variant: "destructive" }); return; }
    loadVehicleMutation.mutate({ transportName: transportName.trim(), lrNumber: lrNumber.trim(), dispatchRemarks: dispatchRemarks.trim() || undefined });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setLocation("/production/orders")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Production Order #{order.id}</h1>
            <p className="text-sm text-muted-foreground">Invoice: {order.invoice?.invoiceNumber || "N/A"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {order.createdByRole && (
            <Badge variant="outline" className={`text-xs ${order.createdByRole === "production_and_support" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
              {order.createdByRole === "production_and_support" ? "SUPPORT" : "SALES"}
            </Badge>
          )}
          <Badge className={`text-sm px-3 py-1 ${STATUS_COLORS[order.status] || "bg-gray-100"} border`} variant="outline">
            {order.status}
          </Badge>
          {ds && (
            <Badge className={`text-sm px-3 py-1 ${DISPATCH_STATUS_COLORS[ds] || "bg-gray-100"} border`} variant="outline">
              {ds}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Order Details */}
          <Card>
            <CardHeader><CardTitle>Order Details</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div><span className="text-muted-foreground">Company</span><p className="font-medium mt-1">{order.invoice?.companyName || order.invoice?.customerName || "-"}</p></div>
                <div><span className="text-muted-foreground">Customer</span><p className="font-medium mt-1">{order.invoice?.customerName || "-"}</p></div>
                <div><span className="text-muted-foreground">Mobile</span><p className="font-medium mt-1">{order.invoice?.mobile || "-"}</p></div>
                <div><span className="text-muted-foreground">Priority</span><p className="font-medium mt-1">{order.priority}</p></div>
                <div><span className="text-muted-foreground">Order Date</span><p className="font-medium mt-1">{order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</p></div>
                <div><span className="text-muted-foreground">Expected Dispatch</span><p className="font-medium mt-1">{order.expectedDispatchDate ? new Date(order.expectedDispatchDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</p></div>
                <div><span className="text-muted-foreground">Created By</span><div className="font-medium mt-1 flex items-center gap-1">{order.createdByName || "-"}{order.createdByRole && <Badge variant="outline" className={`text-[10px] py-0 ${order.createdByRole === "production_and_support" ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>{order.createdByRole === "production_and_support" ? "SUPPORT" : "SALES"}</Badge>}</div></div>
                <div><span className="text-muted-foreground">Assigned Manager</span><p className="font-medium mt-1">{order.assignedManager?.name || "-"}</p></div>
                <div><span className="text-muted-foreground">Unit</span><div className="font-medium mt-1">{order.productionUnit ? <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">{order.productionUnit}</Badge> : <span className="text-muted-foreground">Unassigned</span>}</div></div>
              </div>
            </CardContent>
          </Card>

          {/* ═══ PRODUCTION WORKFLOW ═══ */}
          {isProductionUser && !isTerminal && (
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-700">
                  <Factory className="h-4 w-4" /> Production Workflow
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Status Progress Bar */}
                <div className="flex items-center gap-1 text-xs">
                  {["Pending", "Production On Going", "Packaging", "Ready To Dispatch"].map((s, i) => {
                    const isCurrent = order.status === s;
                    const isPast = ["Pending", "Production On Going", "Packaging", "Ready To Dispatch"].indexOf(order.status) > i;
                    return (
                      <div key={s} className="flex items-center gap-1 flex-1">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${isPast ? "bg-green-500 text-white" : isCurrent ? "bg-blue-600 text-white ring-2 ring-blue-200" : "bg-gray-200 text-gray-500"}`}>
                          {isPast ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                        </div>
                        <span className={`truncate ${isCurrent ? "font-semibold text-blue-700" : isPast ? "text-green-600" : "text-muted-foreground"}`}>{s}</span>
                        {i < 3 && <div className={`h-0.5 flex-1 mx-1 ${isPast ? "bg-green-400" : "bg-gray-200"}`} />}
                      </div>
                    );
                  })}
                </div>

                {/* Action Button */}
                <div className="border-t pt-4">
                  {order.status === "Pending" && (
                    <Button className="bg-orange-600 hover:bg-orange-700 w-full" size="lg" disabled={startProductionOnGoing.isPending}
                      onClick={() => startProductionOnGoing.mutate()}>
                      <Factory className="h-4 w-4 mr-2" /> Start Production On Going
                    </Button>
                  )}
                  {order.status === "Production On Going" && (
                    <Button className="bg-yellow-600 hover:bg-yellow-700 w-full" size="lg" disabled={moveToPackaging.isPending}
                      onClick={() => moveToPackaging.mutate()}>
                      <ClipboardList className="h-4 w-4 mr-2" /> Move to Packaging
                    </Button>
                  )}
                  {order.status === "Packaging" && (
                    <Button className="bg-green-600 hover:bg-green-700 w-full" size="lg" disabled={markReadyForDispatch.isPending}
                      onClick={() => markReadyForDispatch.mutate()}>
                      <Truck className="h-4 w-4 mr-2" /> Mark Ready To Dispatch
                    </Button>
                  )}
                  {isReadyToDispatch && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                      <Truck className="h-6 w-6 text-green-600 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-green-800">Waiting for Dispatch Team</p>
                      <p className="text-xs text-green-600 mt-1">This order has been handed over to the Support/Dispatch team.</p>
                    </div>
                  )}
                </div>

                {order.isFrozen && !isReadyToDispatch && (
                  <div className="p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700">
                    Production is ongoing — PI modifications require approval.
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ═══ DISPATCH WORKFLOW ═══ */}
          {isSupportUser && isReadyToDispatch && !isTerminal && (
            <Card className="border-indigo-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-indigo-700">
                  <Truck className="h-4 w-4" /> Dispatch Workflow
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Dispatch Status Progress */}
                <div className="flex items-center gap-1 text-xs">
                  {["Pending Dispatch", "Load Vehicle", "Dispatch", "Delivered"].map((s, i) => {
                    const dispatchStatuses = ["Pending Dispatch", "Load Vehicle", "Dispatch", "Delivered"];
                    const currentIdx = ds ? dispatchStatuses.indexOf(ds) : -1;
                    const isCurrent = ds === s;
                    const isPast = currentIdx > i;
                    return (
                      <div key={s} className="flex items-center gap-1 flex-1">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${isPast ? "bg-green-500 text-white" : isCurrent ? "bg-indigo-600 text-white ring-2 ring-indigo-200" : "bg-gray-200 text-gray-500"}`}>
                          {isPast ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                        </div>
                        <span className={`truncate ${isCurrent ? "font-semibold text-indigo-700" : isPast ? "text-green-600" : "text-muted-foreground"}`}>{s}</span>
                        {i < 3 && <div className={`h-0.5 flex-1 mx-1 ${isPast ? "bg-green-400" : "bg-gray-200"}`} />}
                      </div>
                    );
                  })}
                </div>

                {/* Dispatch Action */}
                <div className="border-t pt-4">
                  {(!ds || ds === "Pending Dispatch") && (
                    <Button className="bg-blue-600 hover:bg-blue-700 w-full" size="lg"
                      onClick={() => setLoadVehicleDialog(true)}>
                      <Truck className="h-4 w-4 mr-2" /> Load Vehicle
                    </Button>
                  )}
                  {ds === "Load Vehicle" && (
                    <Button className="bg-purple-600 hover:bg-purple-700 w-full" size="lg" disabled={dispatchMutation.isPending}
                      onClick={() => dispatchMutation.mutate()}>
                      <Package className="h-4 w-4 mr-2" /> Dispatch
                    </Button>
                  )}
                  {ds === "Dispatch" && (
                    <Button className="bg-emerald-600 hover:bg-emerald-700 w-full" size="lg" disabled={deliverMutation.isPending}
                      onClick={() => deliverMutation.mutate()}>
                      <CheckCircle2 className="h-4 w-4 mr-2" /> Mark Delivered
                    </Button>
                  )}
                  {ds === "Delivered" && (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-emerald-800">Order Delivered & Completed</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Planning Details (read-only) */}
          {(order.plannedMachine || order.expectedStartDate || order.expectedCompletionDate || isOutsourced) && (
            <Card className="border-purple-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-purple-700">
                  <Calendar className="h-4 w-4" /> Planning Details
                  {isOutsourced && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs ml-2">Outsourced (PET)</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  {order.plannedMachine && <div><span className="text-muted-foreground">Planned Machine</span><p className="font-medium mt-1">{order.plannedMachine}</p></div>}
                  {order.expectedStartDate && <div><span className="text-muted-foreground">Expected Start</span><p className="font-medium mt-1">{new Date(order.expectedStartDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p></div>}
                  {order.expectedCompletionDate && <div><span className="text-muted-foreground">Expected Completion</span><p className="font-medium mt-1">{new Date(order.expectedCompletionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p></div>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Production Details (read-only) */}
          {(order.status === "Production On Going" || order.productionMachine) && !isOutsourced && (
            <Card className="border-orange-200">
              <CardHeader><CardTitle className="flex items-center gap-2 text-orange-700"><Factory className="h-4 w-4" /> Production Details</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  {order.productionMachine && <div><span className="text-muted-foreground">Machine</span><p className="font-medium mt-1">{order.productionMachine}</p></div>}
                  {order.operatorName && <div><span className="text-muted-foreground">Operator</span><p className="font-medium mt-1">{order.operatorName}</p></div>}
                  {order.startedBy && <div><span className="text-muted-foreground">Started By</span><p className="font-medium mt-1">{order.startedBy.name}</p></div>}
                  {order.startedAt && <div><span className="text-muted-foreground">Started At</span><p className="font-medium mt-1">{new Date(order.startedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p></div>}
                  {order.inProductionNotes && <div className="col-span-full"><span className="text-muted-foreground">Production Notes</span><p className="font-medium mt-1 whitespace-pre-wrap">{order.inProductionNotes}</p></div>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Packing Details (read-only) */}
          {(order.packingType || order.packingCompletedAt) && (
            <Card className="border-yellow-200">
              <CardHeader><CardTitle className="flex items-center gap-2 text-yellow-700"><ClipboardList className="h-4 w-4" /> Packing Details</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  {order.packingType && <div><span className="text-muted-foreground">Packing Type</span><p className="font-medium mt-1">{order.packingType}</p></div>}
                  {order.packingCompletedBy && <div><span className="text-muted-foreground">Completed By</span><p className="font-medium mt-1">{order.packingCompletedBy.name}</p></div>}
                  {order.packingCompletedAt && <div><span className="text-muted-foreground">Packing Time</span><p className="font-medium mt-1">{new Date(order.packingCompletedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p></div>}
                  {order.packingNotes && <div className="col-span-full"><span className="text-muted-foreground">Packing Notes</span><p className="font-medium mt-1">{order.packingNotes}</p></div>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ═══ DISPATCH DETAILS ═══ */}
          {(order.dispatchStatus || order.transportName || order.lrNumber) && (
            <Card className="border-indigo-200">
              <CardHeader><CardTitle className="flex items-center gap-2 text-indigo-700"><Truck className="h-4 w-4" /> Dispatch Details</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  {order.transportName && <div><span className="text-muted-foreground">Transport Name</span><p className="font-medium mt-1">{order.transportName}</p></div>}
                  {order.lrNumber && <div><span className="text-muted-foreground">LR / Builty Number</span><p className="font-medium mt-1">{order.lrNumber}</p></div>}
                  {order.builtyUrl && <div><span className="text-muted-foreground">Builty</span><p className="font-medium mt-1"><a href={order.builtyUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">View Builty</a></p></div>}
                  {order.dispatchRemarks && <div><span className="text-muted-foreground">Dispatch Remarks</span><p className="font-medium mt-1">{order.dispatchRemarks}</p></div>}
                  {order.dispatchedAt && <div><span className="text-muted-foreground">Dispatch Date</span><p className="font-medium mt-1">{new Date(order.dispatchedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p></div>}
                  {order.dispatchedBy && <div><span className="text-muted-foreground">Dispatched By</span><p className="font-medium mt-1">{order.dispatchedBy.name}</p></div>}
                  {order.deliveryDate && <div><span className="text-muted-foreground">Delivery Date</span><p className="font-medium mt-1">{order.deliveryDate}</p></div>}
                  {order.deliveredBy && <div><span className="text-muted-foreground">Delivered By</span><p className="font-medium mt-1">{order.deliveredBy.name}</p></div>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Voice Notes */}
          {(order.dealId || order.id) && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Voice Notes</CardTitle>
                {user?.role !== "sales" && (
                  <span className="text-xs text-muted-foreground">Voice note upload available</span>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {order.dealId && <p className="text-xs text-muted-foreground">Voice notes attached to this deal.</p>}
                {(!order.dealId && !order.id) && <p className="text-xs text-muted-foreground">No voice notes available.</p>}
              </CardContent>
            </Card>
          )}

          {/* Product Details */}
          {order.items && order.items.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Product Details</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b"><th className="text-left py-2 px-2">Product</th><th className="text-left py-2 px-2">HSN</th><th className="text-right py-2 px-2">Qty</th><th className="text-right py-2 px-2">Rate</th><th className="text-right py-2 px-2">Amount</th><th className="text-left py-2 px-2">Manufacturing</th></tr></thead>
                    <tbody>
                      {order.items.map((item: any, idx: number) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="py-2 px-2">{item.productName}{item.bottleType && <span className="text-muted-foreground ml-1">({item.bottleType})</span>}{item.capacity && <span className="text-muted-foreground ml-1">{item.capacity}</span>}</td>
                          <td className="py-2 px-2 text-muted-foreground">{item.hsnCode || "-"}</td>
                          <td className="py-2 px-2 text-right">{Number(item.quantity).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right">{Number(item.rate).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right">{Number(item.amount).toFixed(2)}</td>
                          <td className="py-2 px-2">{item.materialType === "PET" ? <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">Outsourced</Badge> : <span className="text-sm text-muted-foreground">{item.machineType || "-"}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Timeline</CardTitle></CardHeader>
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
                          <Badge className={`${STATUS_COLORS[entry.status] || DISPATCH_STATUS_COLORS[entry.status] || "bg-gray-100"} border text-xs`} variant="outline">{entry.status}</Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(entry.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}</span>
                        </div>
                        {entry.notes && <p className="text-sm mt-1 text-muted-foreground whitespace-pre-wrap">{entry.notes}</p>}
                        {entry.createdByUser && <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><User className="h-3 w-3" /> by {entry.createdByUser.name}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No timeline entries yet</p>}
            </CardContent>
          </Card>

          {/* Production Notes */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Production Notes</CardTitle>
              {isProductionUser && <Button size="sm" variant="outline" onClick={() => setNoteDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add Note</Button>}
            </CardHeader>
            <CardContent>
              {order.notes && order.notes.length > 0 ? (
                <div className="space-y-3">
                  {order.notes.map((note: any) => (
                    <div key={note.id} className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-sm">{note.note}</p>
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground"><User className="h-3 w-3" /><span>{note.createdByUser?.name || "Unknown"}</span><span>·</span><Clock className="h-3 w-3" /><span>{new Date(note.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No notes yet</p>}
            </CardContent>
          </Card>

          {/* Order Conversation */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-1.5"><MessageSquare className="h-4 w-4" /> Order Conversation</CardTitle>
                  <span className="inline-flex items-center gap-1 text-[10px] text-green-600 font-medium bg-green-50 border border-green-200 rounded-full px-2 py-0.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />Realtime</span>
                </div>
                {productionMessages && productionMessages.length > 0 && <span className="text-[10px] text-muted-foreground">{productionMessages.length} message{productionMessages.length !== 1 ? "s" : ""}</span>}
              </div>
            </CardHeader>
            <CardContent>
              <div ref={chatContainerRef} className="relative rounded-xl border bg-[#fafafa] overflow-hidden" style={{ height: 300 }}>
                <div className="h-full overflow-y-auto px-3 py-3 space-y-3">
                  {!productionMessages || productionMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3"><MessageSquare className="h-5 w-5 text-muted-foreground/50" /></div>
                      <p className="text-sm font-medium text-muted-foreground">No conversation yet.</p>
                    </div>
                  ) : (
                    <>
                      {productionMessages.map((msg: any, idx: number) => {
                        const isMe = user && msg.senderId === user.id;
                        const showAvatar = idx === 0 || productionMessages[idx - 1].senderId !== msg.senderId;
                        const isLastInGroup = idx === productionMessages.length - 1 || productionMessages[idx + 1].senderId !== msg.senderId;
                        const timeStr = new Date(msg.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) === new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                          ? new Date(msg.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                          : new Date(msg.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " · " + new Date(msg.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                        return (
                          <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                            {showAvatar && !isMe && <div className="flex items-center gap-1.5 mb-1 ml-1"><span className="text-[11px] font-semibold text-foreground">{msg.senderName}</span><span className="text-[9px] font-medium text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-px leading-none">{msg.senderRole}</span></div>}
                            <div className={`max-w-[75%] px-3 py-2 text-[12.5px] leading-relaxed ${isMe ? "bg-violet-600 text-white rounded-2xl rounded-br-md shadow-sm" : "bg-white text-foreground border border-gray-200 rounded-2xl rounded-bl-md shadow-sm"}`}>
                              <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                            </div>
                            {isLastInGroup && <span className={`text-[9px] text-muted-foreground/60 mt-1 ${isMe ? "mr-1" : "ml-1"}`}>{timeStr}</span>}
                          </div>
                        );
                      })}
                      <div ref={chatEndRef} />
                    </>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button onClick={() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); setUnreadCount(0); }}
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
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Status Info</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><Badge className={`${STATUS_COLORS[order.status]} border text-xs`} variant="outline">{order.status}</Badge></div>
              {ds && <div className="flex items-center justify-between"><span className="text-muted-foreground">Dispatch</span><Badge className={`${DISPATCH_STATUS_COLORS[ds]} border text-xs`} variant="outline">{ds}</Badge></div>}
              {order.expectedCompletionDate && <div className="flex items-center justify-between"><span className="text-muted-foreground">Expected Completion</span><span className="font-medium">{new Date(order.expectedCompletionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div>}
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Priority</span><span className="font-medium">{order.priority}</span></div>
              {order.assignedManager && <div className="flex items-center justify-between"><span className="text-muted-foreground">Manager</span><span className="font-medium">{order.assignedManager.name}</span></div>}
              {order.lastUpdatedBy && <div className="flex items-center justify-between"><span className="text-muted-foreground">Updated By</span><span className="font-medium">{order.lastUpdatedBy.name}</span></div>}
              {order.updatedAt && <div className="flex items-center justify-between"><span className="text-muted-foreground">Last Updated</span><span className="font-medium">{new Date(order.updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>}
              {order.productionRemarks && <div className="pt-2 border-t"><span className="text-muted-foreground text-xs">Remarks</span><p className="font-medium mt-1">{order.productionRemarks}</p></div>}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Production Note</DialogTitle></DialogHeader>
          <div>
            <label className="text-sm font-medium">Note Type</label>
            <select value={noteType} onChange={e => setNoteType(e.target.value)} className="w-full mt-1 px-3 py-2 border rounded-md text-sm">
              <option value="general">General</option><option value="delay">Delay</option><option value="issue">Issue</option><option value="machine_problem">Machine Problem</option><option value="material_shortage">Material Shortage</option><option value="power_failure">Power Failure</option><option value="quality_issue">Quality Issue</option><option value="operator_remark">Operator Remark</option><option value="planning">Planning</option>
            </select>
          </div>
          <textarea placeholder="Enter your note..." value={newNote} onChange={e => setNewNote(e.target.value)} rows={4} className="w-full px-3 py-2 border rounded-md text-sm" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>Cancel</Button>
            <Button disabled={!newNote.trim() || addNote.isPending} onClick={() => addNote.mutate({ note: newNote.trim(), noteType })}>{addNote.isPending ? "Adding..." : "Add Note"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Vehicle Dialog */}
      <Dialog open={loadVehicleDialog} onOpenChange={setLoadVehicleDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Load Vehicle — Order #{order.id}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Transport Name *</Label>
              <Input value={transportName} onChange={e => setTransportName(e.target.value)} placeholder="Enter transport company name" className="mt-1" />
            </div>
            <div>
              <Label>LR / Builty Number *</Label>
              <Input value={lrNumber} onChange={e => setLrNumber(e.target.value)} placeholder="Enter LR or Builty number" className="mt-1" />
            </div>
            <div>
              <Label>Upload LR / Builty (Optional)</Label>
              <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => setBuiltyFile(e.target.files?.[0] || null)} className="mt-1" />
            </div>
            <div>
              <Label>Dispatch Remarks (Optional)</Label>
              <textarea value={dispatchRemarks} onChange={e => setDispatchRemarks(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded-md text-sm" placeholder="Any additional remarks..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadVehicleDialog(false)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" disabled={!transportName.trim() || !lrNumber.trim() || loadVehicleMutation.isPending}
              onClick={handleLoadVehicle}>
              {loadVehicleMutation.isPending ? "Loading..." : "Load Vehicle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
