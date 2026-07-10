import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Truck, AlertTriangle, Clock, Edit, MessageSquare, History, CheckCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  "Draft": "bg-gray-100 text-gray-700", "Pending Verification": "bg-yellow-100 text-yellow-700",
  "Confirmed": "bg-blue-100 text-blue-700", "Production Pending": "bg-orange-100 text-orange-700",
  "Production Started": "bg-purple-100 text-purple-700", "Production Running": "bg-purple-100 text-purple-700",
  "Quality Check": "bg-indigo-100 text-indigo-700", "Ready for Dispatch": "bg-teal-100 text-teal-700",
  "Partially Dispatched": "bg-cyan-100 text-cyan-700", "Dispatched": "bg-green-100 text-green-700",
  "Delivered": "bg-green-100 text-green-700", "Completed": "bg-green-100 text-green-700",
  "Cancelled": "bg-red-100 text-red-700",
};

const STATUSES = ["Draft", "Pending Verification", "Confirmed", "Production Pending", "Production Started", "Production Running", "Quality Check", "Ready for Dispatch", "Partially Dispatched", "Dispatched", "Delivered", "Completed", "Cancelled"];

export default function OrderDetail() {
  const [, params] = useRoute("/orders/:id");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const orderId = Number(params?.id);

  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [showRevisionDialog, setShowRevisionDialog] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [showCommsDialog, setShowCommsDialog] = useState(false);
  const [commsForm, setCommsForm] = useState({ type: "Phone Call", notes: "", nextAction: "" });

  const { data: order, isLoading } = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
    enabled: !!orderId,
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ["order-timeline", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/timeline`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
    enabled: !!orderId,
  });

  const { data: revisions = [] } = useQuery({
    queryKey: ["order-revisions", orderId],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/revisions`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
    enabled: !!orderId,
  });

  const { data: comms = [] } = useQuery({
    queryKey: ["communications", order?.contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${order.contactId}/communications`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
    enabled: !!order?.contactId,
  });

  const updateStatus = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["order-timeline", orderId] });
      setShowStatusDialog(false);
      toast({ title: "Status updated" });
    },
  });

  const createRevision = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/orders/${orderId}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ reason: revisionReason, changes: { status: order?.status }, department: "Sales" }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-revisions", orderId] });
      queryClient.invalidateQueries({ queryKey: ["order-timeline", orderId] });
      setShowRevisionDialog(false);
      setRevisionReason("");
      toast({ title: "Revision created" });
    },
  });

  const addCommunication = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/contacts/${order.contactId}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ ...commsForm, orderId }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["communications", order?.contactId] });
      setShowCommsDialog(false);
      setCommsForm({ type: "Phone Call", notes: "", nextAction: "" });
      toast({ title: "Communication logged" });
    },
  });

  if (isLoading) return <div className="p-6 text-center">Loading...</div>;
  if (!order) return <div className="p-6 text-center">Order not found</div>;

  const isBlocked = ["Dispatched", "Delivered", "Completed"].includes(order.status);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/orders")}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">{order.customerName}{order.companyName ? ` - ${order.companyName}` : ""}</p>
        </div>
        <Badge className={STATUS_COLORS[order.status] || ""}>{order.status}</Badge>
        <Button variant="outline" onClick={() => { setNewStatus(order.status); setShowStatusDialog(true); }}><Edit className="h-4 w-4 mr-2" />Update Status</Button>
        {!isBlocked && <Button variant="outline" onClick={() => setShowRevisionDialog(true)}>Request Revision</Button>}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-3">
        <Card className="p-3"><p className="text-xs text-muted-foreground">Grand Total</p><p className="text-lg font-bold">₹{Number(order.grandTotal || 0).toLocaleString("en-IN")}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Items</p><p className="text-lg font-bold">{order.items?.length || 0}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Source</p><p className="text-sm font-medium">{order.source}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Sales Owner</p><p className="text-sm font-medium">{order.salesOwner?.name || "-"}</p></Card>
        <Card className="p-3"><p className="text-xs text-muted-foreground">Support Owner</p><p className="text-sm font-medium">{order.supportOwner?.name || "-"}</p></Card>
      </div>

      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items">Order Items</TabsTrigger>
          <TabsTrigger value="timeline">Timeline ({timeline.length})</TabsTrigger>
          <TabsTrigger value="revisions">Revisions ({revisions.length})</TabsTrigger>
          <TabsTrigger value="communication">Communication ({comms.length})</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="items">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Rate</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Ready</TableHead><TableHead>Dispatched</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {order.items?.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.productName}{item.productCode ? ` (${item.productCode})` : ""}</TableCell>
                    <TableCell>{item.quantity} {item.unit}</TableCell>
                    <TableCell>₹{Number(item.rate).toLocaleString("en-IN")}</TableCell>
                    <TableCell>₹{Number(item.amount).toLocaleString("en-IN")}</TableCell>
                    <TableCell><Badge className={STATUS_COLORS[item.status] || "bg-gray-100"}>{item.status}</Badge></TableCell>
                    <TableCell>{item.readyQuantity}</TableCell>
                    <TableCell>{item.dispatchedQuantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card><CardContent className="space-y-3 py-4">
            {timeline.length === 0 && <p className="text-center text-muted-foreground py-4">No timeline events</p>}
            {timeline.map((event: any) => (
              <div key={event.id} className="flex gap-3 items-start">
                <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{event.description}</p>
                  <p className="text-xs text-muted-foreground">{event.createdBy || "System"} - {new Date(event.createdAt).toLocaleString("en-IN")}</p>
                </div>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="revisions">
          <Card><CardContent className="space-y-3 py-4">
            {revisions.length === 0 && <p className="text-center text-muted-foreground py-4">No revisions</p>}
            {revisions.map((rev: any) => (
              <div key={rev.id} className="p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Version {rev.version}: {rev.reason}</p>
                  <Badge className={rev.status === "Approved" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}>{rev.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">By {rev.changedBy} - {new Date(rev.createdAt).toLocaleString("en-IN")}</p>
              </div>
            ))}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="communication">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="text-base">Customer Communication</CardTitle>
              <Button size="sm" onClick={() => setShowCommsDialog(true)}><MessageSquare className="h-3.5 w-3.5 mr-1" />Log Communication</Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {comms.length === 0 && <p className="text-center text-muted-foreground py-4">No communications logged</p>}
              {comms.map((c: any) => (
                <div key={c.id} className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{c.type}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString("en-IN")}</span>
                  </div>
                  <p className="text-sm mt-1">{c.notes}</p>
                  {c.nextAction && <p className="text-xs text-blue-600 mt-1">Next: {c.nextAction}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="details">
          <div className="grid grid-cols-2 gap-4">
            <Card><CardHeader><CardTitle className="text-base">Customer Details</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Mobile:</span> {order.mobile}</p>
              <p><span className="text-muted-foreground">Email:</span> {order.email || "-"}</p>
              <p><span className="text-muted-foreground">GST:</span> {order.gstNumber || "-"}</p>
              <p><span className="text-muted-foreground">City:</span> {order.city || "-"}</p>
              <p><span className="text-muted-foreground">State:</span> {order.state || "-"}</p>
              <p><span className="text-muted-foreground">Address:</span> {order.address || "-"}</p>
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Order Details</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Payment Terms:</span> {order.paymentTerms || "-"}</p>
              <p><span className="text-muted-foreground">Delivery Terms:</span> {order.deliveryTerms || "-"}</p>
              <p><span className="text-muted-foreground">Expected Delivery:</span> {order.expectedDeliveryDate || "-"}</p>
              <p><span className="text-muted-foreground">Transport:</span> {order.transportDetails || "-"}</p>
              <p><span className="text-muted-foreground">Remarks:</span> {order.remarks || "-"}</p>
            </CardContent></Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Status Update Dialog */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Update Order Status</DialogTitle></DialogHeader>
          <Select value={newStatus} onValueChange={setNewStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={() => updateStatus.mutate()} disabled={updateStatus.isPending}>Update</Button>
        </DialogContent>
      </Dialog>

      {/* Revision Dialog */}
      <Dialog open={showRevisionDialog} onOpenChange={setShowRevisionDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Order Revision</DialogTitle></DialogHeader>
          <Label>Reason *</Label>
          <Textarea value={revisionReason} onChange={e => setRevisionReason(e.target.value)} placeholder="Enter reason for revision..." />
          <Button onClick={() => createRevision.mutate()} disabled={!revisionReason || createRevision.isPending}>Submit Revision</Button>
        </DialogContent>
      </Dialog>

      {/* Communication Dialog */}
      <Dialog open={showCommsDialog} onOpenChange={setShowCommsDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Communication</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Type</Label>
              <Select value={commsForm.type} onValueChange={v => setCommsForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Phone Call", "WhatsApp", "Email", "Meeting", "Factory Visit", "Video Call"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notes *</Label><Textarea value={commsForm.notes} onChange={e => setCommsForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <div><Label>Next Action</Label><Input value={commsForm.nextAction} onChange={e => setCommsForm(f => ({ ...f, nextAction: e.target.value }))} /></div>
            <Button onClick={() => addCommunication.mutate()} disabled={!commsForm.notes || addCommunication.isPending}>Log</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
