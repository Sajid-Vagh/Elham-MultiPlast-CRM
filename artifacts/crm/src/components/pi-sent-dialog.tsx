import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface PiSentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId?: number | null;
  dealId?: number | null;
}

export function PiSentDialog({ open, onOpenChange, contactId, dealId }: PiSentDialogProps) {
  const [, navigate] = useLocation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Proforma Invoice Required</DialogTitle>
          <DialogDescription>
            No active Proforma Invoice has been created for this Deal. Create one before moving to PI Sent.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => {
            onOpenChange(false);
            const params = new URLSearchParams();
            if (contactId) params.set("contactId", String(contactId));
            if (dealId) params.set("dealId", String(dealId));
            navigate(`/proforma-invoices${params.toString() ? `?${params.toString()}` : ""}`);
          }}>Create Proforma</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
