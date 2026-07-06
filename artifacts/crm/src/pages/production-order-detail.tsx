import { useState } from "react";
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
import { ArrowLeft, Plus, Clock, User } from "lucide-react";

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
      queryClient.invalidateQueries({ queryKey: PRODUCTION_ORDER_QUERY_KEY(id) });
      queryClient.invalidateQueries({ queryKey: ["production-orders"] });
      queryClient.invalidateQueries({ queryKey: ["production-dashboard"] });
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
      queryClient.invalidateQueries({ queryKey: PRODUCTION_ORDER_QUERY_KEY(id) });
      setNoteDialogOpen(false);
      setNewNote("");
      toast({ title: "Note added" });
    },
    onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
  });

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
                  <span className="text-muted-foreground">Assigned Manager</span>
                  <p className="font-medium mt-1">{order.assignedManager?.name || "-"}</p>
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
    </div>
  );
}
