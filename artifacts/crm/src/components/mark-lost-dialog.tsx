import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { LOST_REASONS } from "@/lib/deal-stages";

export interface LostDialogData {
  lostReason: string;
  otherReason: string;
  lostNotes: string;
}

interface MarkLostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: LostDialogData) => void;
  saving?: boolean;
  title?: string;
  description?: string;
}

export function MarkLostDialog({
  open,
  onOpenChange,
  onSave,
  saving,
  title = "Mark as Lost",
  description = "Select the reason for marking this as Lost.",
}: MarkLostDialogProps) {
  const { toast } = useToast();
  const [lostReason, setLostReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [lostNotes, setLostNotes] = useState("");

  useEffect(() => {
    if (open) {
      setLostReason("");
      setOtherReason("");
      setLostNotes("");
    }
  }, [open]);

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleSave = () => {
    if (!lostReason) {
      toast({ title: "Validation Error", description: "Please select a Lost Reason", variant: "destructive" });
      return;
    }
    if (lostReason === "Other" && !otherReason.trim()) {
      toast({ title: "Validation Error", description: "Please specify the other reason", variant: "destructive" });
      return;
    }
    onSave({ lostReason, otherReason: otherReason.trim(), lostNotes: lostNotes.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1 sm:space-y-4 sm:py-2">
          <div>
            <Label className="text-xs sm:text-sm">Lost Reason <span className="text-destructive">*</span></Label>
            <Select value={lostReason} onValueChange={(v) => { setLostReason(v); if (v !== "Other") setOtherReason(""); }}>
              <SelectTrigger className="mt-1 text-xs sm:text-sm"><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent className="max-h-48">{LOST_REASONS.map(r => <SelectItem key={r} value={r} className="text-xs sm:text-sm">{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {lostReason === "Other" && (
            <div>
              <Label className="text-xs sm:text-sm">Specify Other Reason <span className="text-destructive">*</span></Label>
              <Textarea className="mt-1 text-xs sm:text-sm" placeholder="Please specify the reason..." value={otherReason} onChange={e => setOtherReason(e.target.value)} rows={3} />
            </div>
          )}
          <div>
            <Label className="text-xs sm:text-sm">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea className="mt-1 text-xs sm:text-sm" placeholder="Additional notes..." value={lostNotes} onChange={e => setLostNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter className="gap-2 flex-col-reverse sm:flex-row">
          <Button variant="outline" onClick={handleCancel} disabled={saving} className="w-full sm:w-auto text-xs sm:text-sm">Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !lostReason || (lostReason === "Other" && !otherReason.trim())} className="w-full sm:w-auto text-xs sm:text-sm">
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
