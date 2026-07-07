import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { LOST_REASONS } from "@/lib/deal-stages";

const CATEGORY_OPTIONS = [
  { value: "A", label: "Category A - High Potential" },
  { value: "B", label: "Category B - Medium Potential" },
  { value: "C", label: "Category C - No/Low Potential" },
];

interface MarkLostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { lostReason: string; lostCategory?: string }) => void;
  saving?: boolean;
  hideCategory?: boolean;
}

export function MarkLostDialog({ open, onOpenChange, onSave, saving, hideCategory }: MarkLostDialogProps) {
  const { toast } = useToast();
  const [lostReason, setLostReason] = useState("");
  const [lostOtherRemarks, setLostOtherRemarks] = useState("");
  const [lostCategory, setLostCategory] = useState("");

  const resetState = () => {
    setLostReason("");
    setLostOtherRemarks("");
    setLostCategory("");
  };

  const handleCancel = () => {
    resetState();
    onOpenChange(false);
  };

  const handleSave = () => {
    if (!lostReason) {
      toast({ title: "Validation Error", description: "Please select a Lost Reason", variant: "destructive" });
      return;
    }
    if (lostReason === "Other" && !lostOtherRemarks.trim()) {
      toast({ title: "Validation Error", description: "Please enter remarks for 'Other' reason", variant: "destructive" });
      return;
    }
    if (!hideCategory && !lostCategory) {
      toast({ title: "Validation Error", description: "Please select a category to move to", variant: "destructive" });
      return;
    }
    const finalReason = lostReason === "Other" ? `Other - ${lostOtherRemarks.trim()}` : lostReason;
    resetState();
    onSave({ lostReason: finalReason, ...(hideCategory ? {} : { lostCategory }) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{hideCategory ? "Mark Deal as Lost" : "Mark Inquiry as Lost"}</DialogTitle>
          <DialogDescription>{hideCategory ? "Select the reason for losing this deal. Your customer remains in My Clients." : "Select the reason and category for this lost inquiry."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Lost Reason <span className="text-destructive">*</span></Label>
            <Select value={lostReason} onValueChange={(v) => { setLostReason(v); if (v !== "Other") setLostOtherRemarks(""); }}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>{LOST_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {lostReason === "Other" && (
            <div>
              <Label>Remarks <span className="text-destructive">*</span></Label>
              <Textarea className="mt-1" placeholder="Please specify the reason..." value={lostOtherRemarks} onChange={e => setLostOtherRemarks(e.target.value)} />
            </div>
          )}
          {!hideCategory && (
            <div>
              <Label>Move To Category <span className="text-destructive">*</span></Label>
              <Select value={lostCategory} onValueChange={setLostCategory}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{CATEGORY_OPTIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !lostReason || (!hideCategory && !lostCategory) || (lostReason === "Other" && !lostOtherRemarks.trim())}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}