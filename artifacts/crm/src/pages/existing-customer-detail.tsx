import { useState } from "react";

import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Phone, Mail, MapPin, Building, Calendar, Package, ShoppingCart, Repeat, MessageSquare, StickyNote, Clock, Truck, ClipboardList, User, Mic, TrendingUp, BarChart3, Star, History } from "lucide-react";
import { VoiceNoteSection } from "@/components/voice-note-player";
import { VoiceNoteUploader } from "@/components/voice-note-uploader";
import { useToast } from "@/hooks/use-toast";
import { FlexibleTimeInput } from "@/components/flexible-time-input";
import { parseNotesText } from "@/lib/parse-notes";

const STATUS_COLORS: Record<string, string> = {
  "Active": "bg-green-100 text-green-700",
  "Production Running": "bg-purple-100 text-purple-700",
  "Dispatch Pending": "bg-cyan-100 text-cyan-700",
  "Repeat Order Due": "bg-amber-100 text-amber-700",
  "Inactive": "bg-gray-100 text-gray-500",
};

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

const PROD_STATUS_COLORS: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-600",
  "Production On Going": "bg-purple-100 text-purple-800",
  "Ready To Dispatch": "bg-blue-100 text-blue-800",
  "Accepted": "bg-blue-100 text-blue-700",
  "Planning": "bg-indigo-100 text-indigo-700",
  "In Production": "bg-orange-100 text-orange-700",
  "Packing": "bg-yellow-100 text-yellow-700",
  "Ready For Dispatch": "bg-green-100 text-green-700",
  "In Transport": "bg-purple-100 text-purple-700",
  "Completed": "bg-emerald-100 text-emerald-700",
  "Cancelled": "bg-red-100 text-red-600",
};

export default function ExistingCustomerDetail() {
  const [, params] = useRoute("/existing-customers/:id");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const id = Number(params?.id);

  const [commDialog, setCommDialog] = useState(false);
  const [noteDialog, setNoteDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [followUpDialog, setFollowUpDialog] = useState(false);
  const [repeatOrderDialog, setRepeatOrderDialog] = useState(false);
  const [commForm, setCommForm] = useState({ type: "Call", direction: "Outbound", notes: "", nextAction: "", nextActionDate: "" });
  const [noteForm, setNoteForm] = useState({ note: "", isPinned: false });
  const [editForm, setEditForm] = useState({ supportOwnerId: "", status: "", repeatOrderDueDate: "", isActive: true });
  const [followUpForm, setFollowUpForm] = useState({ type: "FollowUp", notes: "", followUpDate: "", followUpTime: "", followUpType: "General Customer Follow-up", priority: "Medium", assignedTo: "" });
  const [repeatOrderRemarks, setRepeatOrderRemarks] = useState("");

  const { data: customer, isLoading } = useQuery({
    queryKey: ["existing-customer", id],
    queryFn: async () => {
      const res = await fetch(`/api/existing-customers/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["existing-customer-orders", id],
    queryFn: async () => {
      const res = await fetch(`/api/existing-customers/${id}/orders`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: purchaseSummary } = useQuery({
    queryKey: ["existing-customer-purchase-summary", id],
    queryFn: async () => {
      const res = await fetch(`/api/existing-customers/${id}/purchase-summary`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: communications = [] } = useQuery({
    queryKey: ["existing-customer-communications", id],
    queryFn: async () => {
      const res = await fetch(`/api/existing-customers/${id}/communications`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: notes = [] } = useQuery({
    queryKey: ["existing-customer-notes", id],
    queryFn: async () => {
      const res = await fetch(`/api/existing-customers/${id}/notes`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: repeatOrders = [] } = useQuery({
    queryKey: ["existing-customer-repeat-orders", id],
    queryFn: async () => {
      const res = await fetch(`/api/existing-customers/${id}/repeat-orders`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ["existing-customer-timeline", id],
    queryFn: async () => {
      const res = await fetch(`/api/existing-customers/${id}/timeline`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!id,
  });

  const commMutation = useMutation({
    mutationFn: async (data: typeof commForm) => {
      const res = await fetch(`/api/existing-customers/${id}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create communication");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["existing-customer-communications", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer-timeline", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer", id] });
      setCommDialog(false);
      setCommForm({ type: "Call", direction: "Outbound", notes: "", nextAction: "", nextActionDate: "" });
      toast({ title: "Communication logged" });
    },
    onError: () => toast({ title: "Failed to log communication", variant: "destructive" }),
  });

  const noteMutation = useMutation({
    mutationFn: async (data: typeof noteForm) => {
      const res = await fetch(`/api/existing-customers/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create note");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["existing-customer-notes", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer-timeline", id] });
      setNoteDialog(false);
      setNoteForm({ note: "", isPinned: false });
      toast({ title: "Note added" });
    },
    onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/existing-customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["existing-customer", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer-timeline", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customers"] });
      setEditDialog(false);
      toast({ title: "Customer updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const followUpMutation = useMutation({
    mutationFn: async (data: typeof followUpForm) => {
      const res = await fetch(`/api/existing-customers/${id}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ ...data, assignedTo: data.assignedTo ? Number(data.assignedTo) : undefined }),
      });
      if (!res.ok) throw new Error("Failed to create follow-up");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["existing-customer-timeline", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer-orders", id] });
      setFollowUpDialog(false);
      setFollowUpForm({ type: "FollowUp", notes: "", followUpDate: "", followUpTime: "", followUpType: "General Customer Follow-up", priority: "Medium", assignedTo: "" });
      toast({ title: "Follow-up created" });
    },
    onError: () => toast({ title: "Failed to create follow-up", variant: "destructive" }),
  });

  const repeatOrderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/existing-customers/${id}/repeat-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ remarks: repeatOrderRemarks }),
      });
      if (!res.ok) throw new Error("Failed to create repeat order");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["existing-customer-orders", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer-repeat-orders", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer-purchase-summary", id] });
      queryClient.invalidateQueries({ queryKey: ["existing-customer-timeline", id] });
      setRepeatOrderDialog(false);
      setRepeatOrderRemarks("");
      toast({ title: "Repeat order created" });
    },
    onError: () => toast({ title: "Failed to create repeat order", variant: "destructive" }),
  });

  if (!id || isNaN(id)) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Invalid customer ID.</p>
        <Button variant="link" onClick={() => setLocation("/existing-customers")}>
          Back to Customers
        </Button>
      </div>
    );
  }

  if (isLoading) return <div className="p-6 text-center">Loading...</div>;
  if (!customer) return <div className="p-6 text-center">Customer not found</div>;

  const c = customer;
  const contact = c.contact || {};
  const ps = purchaseSummary;
  const lastOrd = ps?.lastOrder;
  const oh = ps?.orderHistory;
  const recentOrders = ps?.recentOrders || [];
  const insights = ps?.insights;

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/existing-customers")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold">{contact.name || "Unknown"}</h1>
            <Badge className={STATUS_COLORS[c.status] || ""}>{c.status}</Badge>
            {!c.isActive && <Badge variant="outline" className="border-red-300 text-red-600">Inactive</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{contact.companyName || "No company"}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => {
            setEditForm({
              supportOwnerId: String(c.supportOwnerId || ""),
              status: c.status,
              repeatOrderDueDate: c.repeatOrderDueDate || "",
              isActive: c.isActive,
            });
            setEditDialog(true);
          }}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCommDialog(true)}>
            <MessageSquare className="h-4 w-4 mr-1" />Log Comm
          </Button>
          <Button variant="outline" size="sm" onClick={() => setNoteDialog(true)}>
            <StickyNote className="h-4 w-4 mr-1" />Note
          </Button>
          <Button variant="outline" size="sm" onClick={() => setFollowUpDialog(true)}>
            <Clock className="h-4 w-4 mr-1" />Follow-up
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRepeatOrderDialog(true)} disabled={!c.lastOrderId && !c.firstOrderId}>
            <Repeat className="h-4 w-4 mr-1" />Repeat Order
          </Button>
        </div>
      </div>

      {/* Contact Info Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Phone className="h-3 w-3" />Mobile</div>
          <p className="font-medium">{contact.mobile || "-"}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Mail className="h-3 w-3" />Email</div>
          <p className="font-medium truncate">{contact.email || "-"}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Building className="h-3 w-3" />Company</div>
          <p className="font-medium truncate">{contact.companyName || "-"}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><MapPin className="h-3 w-3" />City</div>
          <p className="font-medium">{contact.city || "-"}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Calendar className="h-3 w-3" />Customer Since</div>
          <p className="font-medium">{c.firstOrderDate || "-"}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><ClipboardList className="h-3 w-3" />GST</div>
          <p className="font-medium">{contact.gstNumber || "-"}</p>
        </Card>
      </div>

      {/* Order History Summary */}
      {oh && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Order History Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              <div className="text-center p-2 bg-muted/30 rounded-lg">
                <p className="text-xl font-bold">{oh.totalOrders}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Total Orders</p>
              </div>
              <div className="text-center p-2 bg-green-50 rounded-lg">
                <p className="text-xl font-bold text-green-700">{oh.completedOrders}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Completed</p>
              </div>
              <div className="text-center p-2 bg-orange-50 rounded-lg">
                <p className="text-xl font-bold text-orange-700">{oh.pendingOrders}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Pending</p>
              </div>
              <div className="text-center p-2 bg-red-50 rounded-lg">
                <p className="text-xl font-bold text-red-600">{oh.cancelledOrders}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Cancelled</p>
              </div>
              <div className="text-center p-2 bg-amber-50 rounded-lg">
                <p className="text-xl font-bold text-amber-700">{oh.repeatOrders}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Repeat</p>
              </div>
              <div className="text-center p-2 bg-blue-50 rounded-lg">
                <p className="text-xl font-bold text-blue-700">₹{Number(oh.totalRevenue || 0).toLocaleString("en-IN")}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Revenue</p>
              </div>
              <div className="text-center p-2 bg-purple-50 rounded-lg">
                <p className="text-xl font-bold text-purple-700">₹{Number(oh.avgOrderValue || 0).toLocaleString("en-IN")}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Avg Value</p>
              </div>
              <div className="text-center p-2 bg-cyan-50 rounded-lg">
                <p className="text-sm font-bold text-cyan-700">{oh.firstOrderDate ? new Date(oh.firstOrderDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</p>
                <p className="text-[10px] text-muted-foreground uppercase">First Order</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Last Order Summary with Products */}
      {lastOrd && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Last Order Summary</CardTitle>
              <div className="flex items-center gap-2">
                {lastOrd.productionStatus && (
                  <Badge className={`text-xs ${PROD_STATUS_COLORS[lastOrd.productionStatus] || "bg-gray-100"}`}>{lastOrd.productionStatus}</Badge>
                )}
                {lastOrd.dispatchStatus && (
                  <Badge className={`text-xs bg-cyan-100 text-cyan-700`}>{lastOrd.dispatchStatus}</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-muted-foreground">Order #:</span> <span className="font-medium">{lastOrd.orderNumber}</span></div>
              <div><span className="text-muted-foreground">Date:</span> <span className="font-medium">{new Date(lastOrd.createdAt).toLocaleDateString("en-IN")}</span></div>
              <div><span className="text-muted-foreground">Amount:</span> <span className="font-bold">₹{Number(lastOrd.grandTotal || 0).toLocaleString("en-IN")}</span></div>
              <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className={`ml-1 ${ORDER_STATUS_COLORS[lastOrd.status] || ""}`}>{lastOrd.status}</Badge></div>
              {lastOrd.salesOwner && <div><span className="text-muted-foreground">Sales Owner:</span> <span className="font-medium">{lastOrd.salesOwner.name}</span></div>}
              {lastOrd.freight && <div><span className="text-muted-foreground">Freight:</span> <span className="font-medium">₹{Number(lastOrd.freight).toLocaleString("en-IN")}</span></div>}
              {lastOrd.paymentTerms && <div><span className="text-muted-foreground">Payment:</span> <span className="font-medium">{lastOrd.paymentTerms}</span></div>}
              {lastOrd.deliveryTerms && <div><span className="text-muted-foreground">Delivery:</span> <span className="font-medium">{lastOrd.deliveryTerms}</span></div>}
              {lastOrd.dispatchAddress && <div className="col-span-2"><span className="text-muted-foreground">Dispatch Address:</span> <span className="font-medium">{lastOrd.dispatchAddress}</span></div>}
            </div>

            {/* Products from last order */}
            {lastOrd.products && lastOrd.products.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Products ({lastOrd.products.length})</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Product Name</TableHead>
                        <TableHead className="text-xs">Material</TableHead>
                        <TableHead className="text-xs">Bottle Weight</TableHead>
                        <TableHead className="text-xs">Bottle Color</TableHead>
                        <TableHead className="text-xs">Cap Color</TableHead>
                        <TableHead className="text-xs">Neck Size</TableHead>
                        <TableHead className="text-xs">Machine</TableHead>
                        <TableHead className="text-xs">HSN</TableHead>
                        <TableHead className="text-xs text-right">Qty</TableHead>
                        <TableHead className="text-xs text-right">Rate</TableHead>
                        <TableHead className="text-xs text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lastOrd.products.map((p: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium text-xs">{p.productName || "-"}</TableCell>
                          <TableCell className="text-xs">{p.materialType || "-"}</TableCell>
                          <TableCell className="text-xs">{p.bottleWeight || "-"}</TableCell>
                          <TableCell className="text-xs">
                            <div className="flex items-center gap-1">
                              {p.bottleColour && <span className="w-2.5 h-2.5 rounded-full border shrink-0" style={{ backgroundColor: p.bottleColour?.toLowerCase() }} />}
                              {p.bottleColour || "-"}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{p.capColour || "-"}</TableCell>
                          <TableCell className="text-xs">{p.neckSize || "-"}</TableCell>
                          <TableCell className="text-xs">{p.machineType || "-"}</TableCell>
                          <TableCell className="text-xs">{p.hsnCode || "-"}</TableCell>
                          <TableCell className="text-xs text-right">{Number(p.quantity || 0).toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-right">₹{Number(p.rate || 0).toLocaleString("en-IN")}</TableCell>
                          <TableCell className="text-xs text-right font-medium">₹{Number(p.amount || 0).toLocaleString("en-IN")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick Customer Insights */}
      {insights && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Quick Customer Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {insights.mostOrderedProduct && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-[10px] text-blue-600 font-semibold uppercase">Most Ordered Product</p>
                  <p className="font-bold text-sm text-blue-800 mt-0.5">{insights.mostOrderedProduct}</p>
                </div>
              )}
              {insights.mostOrderedMaterial && (
                <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                  <p className="text-[10px] text-purple-600 font-semibold uppercase">Most Ordered Material</p>
                  <p className="font-bold text-sm text-purple-800 mt-0.5">{insights.mostOrderedMaterial}</p>
                </div>
              )}
              {insights.mostUsedBottleColor && (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <p className="text-[10px] text-amber-600 font-semibold uppercase">Most Used Bottle Color</p>
                  <p className="font-bold text-sm text-amber-800 mt-0.5">{insights.mostUsedBottleColor}</p>
                </div>
              )}
              {insights.mostUsedMachine && (
                <div className="p-3 bg-orange-50 rounded-lg border border-orange-100">
                  <p className="text-[10px] text-orange-600 font-semibold uppercase">Most Used Machine</p>
                  <p className="font-bold text-sm text-orange-800 mt-0.5">{insights.mostUsedMachine}</p>
                </div>
              )}
              {insights.averageBottleWeight && (
                <div className="p-3 bg-teal-50 rounded-lg border border-teal-100">
                  <p className="text-[10px] text-teal-600 font-semibold uppercase">Avg Bottle Weight</p>
                  <p className="font-bold text-sm text-teal-800 mt-0.5">{insights.averageBottleWeight}</p>
                </div>
              )}
              {insights.totalPurchasedQuantity > 0 && (
                <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                  <p className="text-[10px] text-indigo-600 font-semibold uppercase">Total Purchased Qty</p>
                  <p className="font-bold text-sm text-indigo-800 mt-0.5">{insights.totalPurchasedQuantity.toLocaleString()} PCS</p>
                </div>
              )}
              {insights.lastPurchasedProduct && (
                <div className="p-3 bg-cyan-50 rounded-lg border border-cyan-100">
                  <p className="text-[10px] text-cyan-600 font-semibold uppercase">Last Purchased Product</p>
                  <p className="font-bold text-sm text-cyan-800 mt-0.5">{insights.lastPurchasedProduct}</p>
                </div>
              )}
              {insights.repeatCustomerSince && (
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-100">
                  <p className="text-[10px] text-rose-600 font-semibold uppercase">Repeat Customer Since</p>
                  <p className="font-bold text-sm text-rose-800 mt-0.5">{new Date(insights.repeatCustomerSince).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {c.currentProductionStatus && (
          <Card className="p-3 border-l-4 border-l-purple-500">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium">Production</span>
              <Badge className="bg-purple-100 text-purple-700 ml-auto">{c.currentProductionStatus}</Badge>
            </div>
          </Card>
        )}
        {c.currentDispatchStatus && (
          <Card className="p-3 border-l-4 border-l-cyan-500">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-cyan-600" />
              <span className="text-sm font-medium">Dispatch</span>
              <Badge className="bg-cyan-100 text-cyan-700 ml-auto">{c.currentDispatchStatus}</Badge>
            </div>
          </Card>
        )}
      </div>

      {/* Assigned Team */}
      <Card>
        <CardHeader><CardTitle className="text-base">Assigned Team</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-muted-foreground">Sales Owner:</span> <span className="font-medium">{c.salesOwner?.name || "-"}</span></div>
          <div><span className="text-muted-foreground">Support Owner:</span> <span className="font-medium">{c.supportOwner?.name || "-"}</span></div>
          <div><span className="text-muted-foreground">Last Product:</span> <span className="font-medium">{c.lastProductName || "-"}</span></div>
          <div><span className="text-muted-foreground">Repeat Orders:</span> <span className="font-medium">{c.repeatOrderCount || 0}</span></div>
        </CardContent>
      </Card>

      {/* Recent Orders (last 5) */}
      {recentOrders.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Recent Orders</CardTitle>
              {orders.length > 5 && <Button variant="link" size="sm" className="text-xs" onClick={() => {}}>View All ({orders.length})</Button>}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Order No</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Amount</TableHead>
                  <TableHead className="text-xs">Production</TableHead>
                  <TableHead className="text-xs">Dispatch</TableHead>
                  <TableHead className="text-xs">Sales Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((order: any) => (
                  <TableRow key={order.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setLocation(`/orders/${order.id}`)}>
                    <TableCell className="font-medium text-sm">{order.orderNumber}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-xs ${ORDER_STATUS_COLORS[order.status] || ""}`}>{order.status}</Badge></TableCell>
                    <TableCell className="font-medium text-sm">₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}</TableCell>
                    <TableCell>{order.productionStatus && <Badge className={`text-xs ${PROD_STATUS_COLORS[order.productionStatus] || "bg-gray-100"}`}>{order.productionStatus}</Badge>}</TableCell>
                    <TableCell>{order.dispatchStatus && <Badge className="text-xs bg-cyan-100 text-cyan-700">{order.dispatchStatus}</Badge>}</TableCell>
                    <TableCell className="text-sm">{order.salesOwner?.name || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="orders">
        <TabsList className="flex-wrap">
          <TabsTrigger value="orders">Orders ({orders.length})</TabsTrigger>
          <TabsTrigger value="repeat-orders">Repeat ({repeatOrders.length})</TabsTrigger>
          <TabsTrigger value="communications">Communications ({communications.length})</TabsTrigger>
          <TabsTrigger value="timeline">Timeline ({timeline.length})</TabsTrigger>
          <TabsTrigger value="notes">Notes ({notes.length})</TabsTrigger>
          <TabsTrigger value="voice-notes"><Mic className="h-3.5 w-3.5" /> Voice</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card>
            <CardContent className="p-0">
              {orders.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No orders yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Grand Total</TableHead>
                      <TableHead>Repeat</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Sales Owner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order: any) => (
                      <TableRow key={order.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setLocation(`/orders/${order.id}`)}>
                        <TableCell className="font-medium">{order.orderNumber}</TableCell>
                        <TableCell><Badge variant="outline">{order.status}</Badge></TableCell>
                        <TableCell>{order.items?.length || 0}</TableCell>
                        <TableCell className="font-medium">₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell>{order.isRepeatOrder ? <Badge className="bg-amber-100 text-amber-700">Yes</Badge> : "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleDateString("en-IN")}</TableCell>
                        <TableCell className="text-sm">{order.salesOwner?.name || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="repeat-orders">
          <Card>
            <CardContent className="p-0">
              {repeatOrders.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No repeat orders yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Grand Total</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Sales Owner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {repeatOrders.map((order: any) => (
                      <TableRow key={order.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setLocation(`/orders/${order.id}`)}>
                        <TableCell className="font-medium">{order.orderNumber}</TableCell>
                        <TableCell><Badge variant="outline">{order.status}</Badge></TableCell>
                        <TableCell>{order.items?.length || 0}</TableCell>
                        <TableCell className="font-medium">₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(order.createdAt).toLocaleDateString("en-IN")}</TableCell>
                        <TableCell className="text-sm">{order.salesOwner?.name || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications">
          <Card>
            <CardContent className="space-y-3 py-4">
              {communications.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No communications logged</p>
              ) : (
                communications.map((comm: any) => (
                  <div key={comm.id} className="p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">{comm.type}</Badge>
                      <Badge className={comm.direction === "Inbound" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
                        {comm.direction}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{new Date(comm.createdAt).toLocaleString("en-IN")}</span>
                      <span className="text-xs text-muted-foreground ml-auto">by {comm.createdBy || "System"}</span>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{parseNotesText(comm.notes)}</p>
                    {comm.nextAction && (
                      <p className="text-xs text-amber-600 mt-1">
                        Next Action: {comm.nextAction}{comm.nextActionDate ? ` (${new Date(comm.nextActionDate).toLocaleDateString("en-IN")})` : ""}
                      </p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="space-y-0 py-4">
              {timeline.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No timeline events</p>
              ) : (
                <div className="relative">
                  <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-border" />
                  {timeline.slice(0, 50).map((event: any, i: number) => {
                    const t = event.type as string;
                    const dotColors: Record<string, string> = {
                      lead_created: "bg-blue-500",
                      customer_promoted: "bg-green-500",
                      order_created: "bg-purple-500",
                      order_event: "bg-indigo-400",
                      communication: "bg-amber-500",
                      follow_up: "bg-cyan-500",
                    };
                    const dotColor = dotColors[t] || "bg-gray-400";
                    const iconMap: Record<string, any> = {
                      lead_created: <User className="h-3 w-3" />,
                      customer_promoted: <ShoppingCart className="h-3 w-3" />,
                      order_created: <Package className="h-3 w-3" />,
                      order_event: <Clock className="h-3 w-3" />,
                      communication: <MessageSquare className="h-3 w-3" />,
                      follow_up: <Clock className="h-3 w-3" />,
                    };
                    const icon = iconMap[t] || <Clock className="h-3 w-3" />;
                    return (
                      <div key={`${event.id || i}-${i}`} className="flex gap-4 pb-6 relative">
                        <div className={`w-8 h-8 rounded-full ${dotColor} flex items-center justify-center text-white z-10 flex-shrink-0`}>
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0 pt-1">
                          <p className="text-sm font-medium">{parseNotesText(event.description)}</p>
                          <p className="text-xs text-muted-foreground">{event.user} - {new Date(event.createdAt).toLocaleString("en-IN")}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardContent className="space-y-3 py-4">
              {notes.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No notes</p>
              ) : (
                notes.map((n: any) => (
                  <div key={n.id} className={`p-3 rounded-lg ${n.isPinned ? "bg-amber-50 border border-amber-200" : "bg-muted/30"}`}>
                    <div className="flex items-center gap-2">
                      {n.isPinned && <span className="text-[10px] text-amber-600 font-medium">Pinned</span>}
                      <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString("en-IN")}</span>
                      <span className="text-xs text-muted-foreground ml-auto">by {n.createdBy || "System"}</span>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{parseNotesText(n.note)}</p>
                    <div className="flex gap-2 mt-2">
                      {n.department && <Badge variant="outline" className="text-[10px]">{n.department}</Badge>}
                      {n.isResolved && <Badge className="bg-green-100 text-green-700 text-[10px]">Resolved</Badge>}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Voice Notes */}
        <TabsContent value="voice-notes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mic className="h-3.5 w-3.5" /> Voice Notes
              </CardTitle>
              <VoiceNoteUploader entityType="customer" entityId={id} label="Record" />
            </CardHeader>
            <CardContent>
              <VoiceNoteSection entityType="customer" entityId={id} canDelete={false} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Log Communication Dialog */}
      <Dialog open={commDialog} onOpenChange={setCommDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Communication</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={commForm.type} onValueChange={v => setCommForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Call">Call</SelectItem>
                    <SelectItem value="Email">Email</SelectItem>
                    <SelectItem value="Meeting">Meeting</SelectItem>
                    <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Direction</Label>
                <Select value={commForm.direction} onValueChange={v => setCommForm(f => ({ ...f, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Inbound">Inbound</SelectItem>
                    <SelectItem value="Outbound">Outbound</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={commForm.notes} onChange={e => setCommForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Next Action</Label>
                <Input value={commForm.nextAction} onChange={e => setCommForm(f => ({ ...f, nextAction: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Next Action Date</Label>
                <Input type="date" value={commForm.nextActionDate} onChange={e => setCommForm(f => ({ ...f, nextActionDate: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommDialog(false)}>Cancel</Button>
            <Button onClick={() => commMutation.mutate(commForm)} disabled={!commForm.notes || commMutation.isPending}>
              {commMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Note Dialog */}
      <Dialog open={noteDialog} onOpenChange={setNoteDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Internal Note</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Note</Label>
              <Textarea value={noteForm.note} onChange={e => setNoteForm(f => ({ ...f, note: e.target.value }))} rows={4} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={noteForm.isPinned} onChange={e => setNoteForm(f => ({ ...f, isPinned: e.target.checked }))} />
              Pin this note
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialog(false)}>Cancel</Button>
            <Button onClick={() => noteMutation.mutate(noteForm)} disabled={!noteForm.note || noteMutation.isPending}>
              {noteMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Active", "Production Running", "Dispatch Pending", "Repeat Order Due", "Inactive"].map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Support Owner ID</Label>
              <Input type="number" value={editForm.supportOwnerId} onChange={e => setEditForm(f => ({ ...f, supportOwnerId: e.target.value }))} placeholder="User ID" />
            </div>
            <div className="space-y-1">
              <Label>Repeat Order Due Date</Label>
              <Input type="date" value={editForm.repeatOrderDueDate} onChange={e => setEditForm(f => ({ ...f, repeatOrderDueDate: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editForm.isActive} onChange={e => setEditForm(f => ({ ...f, isActive: e.target.checked }))} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(false)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate(editForm)} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Follow-up Dialog */}
      <Dialog open={followUpDialog} onOpenChange={setFollowUpDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Follow-up</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={followUpForm.followUpType} onValueChange={v => setFollowUpForm(f => ({ ...f, followUpType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="General Customer Follow-up">General Customer Follow-up</SelectItem>
                  <SelectItem value="Order Follow-up">Order Follow-up</SelectItem>
                  <SelectItem value="General Customer Follow-up">General Customer Follow-up</SelectItem>
                  <SelectItem value="Payment Follow-up">Payment Follow-up</SelectItem>
                  <SelectItem value="Delivery Follow-up">Delivery Follow-up</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={followUpForm.notes} onChange={e => setFollowUpForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Date</Label>
                <Input type="date" value={followUpForm.followUpDate} onChange={e => setFollowUpForm(f => ({ ...f, followUpDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Time</Label>
                <FlexibleTimeInput value={followUpForm.followUpTime} onChange={v => setFollowUpForm(f => ({ ...f, followUpTime: v }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Priority</Label>
                <Select value={followUpForm.priority} onValueChange={v => setFollowUpForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Assigned User ID</Label>
                <Input type="number" value={followUpForm.assignedTo} onChange={e => setFollowUpForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="User ID" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpDialog(false)}>Cancel</Button>
            <Button onClick={() => followUpMutation.mutate(followUpForm)} disabled={!followUpForm.notes || !followUpForm.followUpDate || followUpMutation.isPending}>
              {followUpMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Repeat Order Dialog */}
      <Dialog open={repeatOrderDialog} onOpenChange={setRepeatOrderDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Repeat Order</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">A new order will be created based on the last order. You can modify quantities and details in the order form.</p>
          <div className="space-y-1">
            <Label>Remarks (optional)</Label>
            <Textarea value={repeatOrderRemarks} onChange={e => setRepeatOrderRemarks(e.target.value)} rows={2} placeholder="Reason for repeat order..." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepeatOrderDialog(false)}>Cancel</Button>
            <Button onClick={() => repeatOrderMutation.mutate()} disabled={repeatOrderMutation.isPending}>
              {repeatOrderMutation.isPending ? "Creating..." : "Create Repeat Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
