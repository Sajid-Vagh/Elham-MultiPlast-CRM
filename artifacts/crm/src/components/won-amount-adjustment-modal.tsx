import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";

interface WonAmountAdjustmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalTotal: number;
  newTotal: number;
  onConfirm: (wonAmountAdjustment: number) => void;
}

function formatAmount(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function WonAmountAdjustmentModal({ open, onOpenChange, originalTotal, newTotal, onConfirm }: WonAmountAdjustmentModalProps) {
  const difference = Math.round((newTotal - originalTotal) * 100) / 100;
  const [value, setValue] = useState<string>(String(difference));

  const handleConfirm = () => {
    const parsed = Number(value);
    onConfirm(Number.isFinite(parsed) ? parsed : 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Confirm Won Amount Adjustment</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              The invoice amount has changed by <strong>₹{difference >= 0 ? "+" : ""}{formatAmount(difference)}</strong>.
              Please confirm the amount to <strong>add / deduct</strong> from the Dashboard Won Value.
            </span>
          </div>

          <div className="space-y-1">
            <Label>Won Amount Adjustment (₹)</Label>
            <Input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              step="any"
              placeholder="Enter the amount to add / deduct"
            />
            <p className="text-xs text-muted-foreground">
              You can change this value (e.g. use 0 to keep the Won Value unchanged).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleConfirm}>Confirm &amp; Update</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
