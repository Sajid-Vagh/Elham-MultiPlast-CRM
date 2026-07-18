import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PiSentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId?: number | null;
}

export function PiSentDialog({ open, onOpenChange, contactId }: PiSentDialogProps) {
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
            window.location.href = `/proforma-invoices${contactId ? `?contactId=${contactId}` : ""}`;
          }}>Create Proforma</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
