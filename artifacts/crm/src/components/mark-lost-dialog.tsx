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
    if (lostReason === "Other") {
      const trimmed = lostOtherRemarks.trim();
      if (trimmed.length < 5) {
        toast({ title: "Validation Error", description: "Remarks must be at least 5 characters", variant: "destructive" });
        return;
      }
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{hideCategory ? "Mark Deal as Lost" : "Mark Inquiry as Lost"}</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">{hideCategory ? "Select the reason for losing this deal. Your customer remains in My Clients." : "Select the reason and category for this lost inquiry."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1 sm:space-y-4 sm:py-2">
          <div>
            <Label className="text-xs sm:text-sm">Lost Reason <span className="text-destructive">*</span></Label>
            <Select value={lostReason} onValueChange={(v) => { setLostReason(v); if (v !== "Other") setLostOtherRemarks(""); }}>
              <SelectTrigger className="mt-1 text-xs sm:text-sm"><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent className="max-h-48">{LOST_REASONS.map(r => <SelectItem key={r} value={r} className="text-xs sm:text-sm">{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {lostReason === "Other" && (
            <div>
              <Label className="text-xs sm:text-sm">Remarks <span className="text-destructive">*</span></Label>
              <Textarea className="mt-1 text-xs sm:text-sm" placeholder="Please specify the reason..." value={lostOtherRemarks} onChange={e => setLostOtherRemarks(e.target.value)} rows={3} />
            </div>
          )}
          {!hideCategory && (
            <div>
              <Label className="text-xs sm:text-sm">Move To Category <span className="text-destructive">*</span></Label>
              <Select value={lostCategory} onValueChange={setLostCategory}>
                <SelectTrigger className="mt-1 text-xs sm:text-sm"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent className="max-h-48">{CATEGORY_OPTIONS.map(c => <SelectItem key={c.value} value={c.value} className="text-xs sm:text-sm">{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 flex-col-reverse sm:flex-row">
          <Button variant="outline" onClick={handleCancel} disabled={saving} className="w-full sm:w-auto text-xs sm:text-sm">Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !lostReason || (!hideCategory && !lostCategory) || (lostReason === "Other" && lostOtherRemarks.trim().length < 5)} className="w-full sm:w-auto text-xs sm:text-sm">
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}