import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle } from "lucide-react";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { toast } from "@/hooks/use-toast";
import { onProductionChange, onDealChange, onContactChange, onPIChange } from "@/lib/query-invalidation";

const CANCELLATION_REASONS = [
  "Customer Cancelled",
  "Price Issue",
  "Quality Concern",
  "Duplicate Order",
  "Wrong Product",
  "Production Delay",
  "Payment Issue",
  "Other",
];

interface CancelOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  orderNumber?: string | null;
  customerName?: string | null;
  contactId?: number | null;
  dealId?: number | null;
}

export function CancelOrderModal({ open, onOpenChange, orderId, orderNumber, customerName, contactId, dealId }: CancelOrderModalProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setReason("");
    setOtherReason("");
    setNote("");
  };

  const handleClose = (next: boolean) => {
    if (!submitting) {
      reset();
      onOpenChange(next);
    }
  };

  const handleSubmit = async () => {
    if (!reason) return;
    if (reason === "Other" && !otherReason.trim()) return;
    setSubmitting(true);
    try {
      await customFetch(`/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          otherReason: reason === "Other" ? otherReason.trim() : undefined,
          note: note.trim() || undefined,
        }),
      });
      toast({ title: "Order cancelled", description: orderNumber ? `Order ${orderNumber} has been cancelled.` : "Order cancelled successfully." });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      queryClient.invalidateQueries({ queryKey: ["order-timeline", orderId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-kpi"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-recent-activities"] });
      queryClient.invalidateQueries({ queryKey: ["global-search"] });
      queryClient.invalidateQueries({ queryKey: ["existing-customers"] });
      onPIChange(queryClient, dealId ?? undefined, contactId ?? undefined);
      onProductionChange(queryClient);
      onDealChange(queryClient, dealId ?? undefined, contactId ?? undefined);
      if (contactId) onContactChange(queryClient, contactId);
      reset();
      onOpenChange(false);
    } catch (err: any) {
      const message = err?.data?.error || err?.message || "Failed to cancel order";
      toast({ title: "Cancel failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!reason && (reason !== "Other" || !!otherReason.trim());

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Cancel Order</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {orderNumber && (
            <p className="text-sm text-muted-foreground">
              Order <span className="font-medium text-foreground">{orderNumber}</span>{customerName ? ` — ${customerName}` : ""}
            </p>
          )}

          <div className="space-y-1">
            <Label>Reason *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>
                {CANCELLATION_REASONS.map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {reason === "Other" && (
            <div className="space-y-1">
              <Label>Details *</Label>
              <Textarea value={otherReason} onChange={e => setOtherReason(e.target.value)} rows={2} placeholder="Describe the cancellation reason..." />
            </div>
          )}

          <div className="space-y-1">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Additional remarks..." />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              The linked deal will move to Lost and any associated production order will be cancelled.
              If this is the customer's first/only order, they will be reverted to their previous category
              and removed from My Client / Existing Customers. This action cannot be undone.
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>Keep Order</Button>
          <Button variant="destructive" disabled={!canSubmit || submitting} onClick={handleSubmit}>
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Cancelling...</> : "Cancel Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
