import { useState, useRef, useEffect } from "react";
import { CATEGORIES, CATEGORY_COLORS } from "@/lib/categories";
import { MOVE_REASONS } from "@/lib/deal-stages";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { onContactChange } from "@/lib/query-invalidation";

interface MoveCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds: number[];
  currentCategory?: string | null;
  onSuccess?: () => void;
}

function isValidReason(val: string) {
  return val.trim().length >= 5;
}

export function MoveCategoryDialog({
  open,
  onOpenChange,
  contactIds,
  currentCategory,
  onSuccess,
}: MoveCategoryDialogProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [loading, setLoading] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) {
      setSelectedCategory("");
      setReason("");
      setOtherReason("");
      setReasonError("");
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (reasonError && reasonRef.current) {
      reasonRef.current.focus();
    }
  }, [reasonError]);

  const finalReason = reason === "Other" ? otherReason.trim() : reason;

  const handleMove = async () => {
    if (!selectedCategory) return;

    const trimmed = finalReason;
    if (!isValidReason(trimmed)) {
      setReasonError("Reason is required.");
      if (reason === "Other" && reasonRef.current) reasonRef.current.focus();
      return;
    }
    setReasonError("");

    setLoading(true);
    try {
      const res = await fetch("/api/categories/move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("crm_token")}`,
        },
        body: JSON.stringify({
          contactIds,
          newCategory: selectedCategory,
          reason: trimmed,
        }),
      });
      if (!res.ok) throw new Error("Failed to move");
      const data = await res.json();
      toast({
        title: "Category Updated",
        description: `${data.moved} record(s) moved to ${selectedCategory}`,
      });
      onContactChange(queryClient);
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Error", description: "Failed to move records", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to Category</DialogTitle>
          <DialogDescription>
            {contactIds.length === 1
              ? `Move this record from ${currentCategory || "current"} category`
              : `Move ${contactIds.length} records from ${currentCategory || "current"} category`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {CATEGORIES.filter(c => c !== currentCategory && c !== "My Client").map((cat) => (
            <button
              key={cat}
              type="button"
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                selectedCategory === cat
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
              onClick={() => setSelectedCategory(cat)}
            >
              <span className="text-lg">{cat === "My Client" ? "⭐" : cat === "Regular Follow up" ? "📋" : "📁"}</span>
              <span
                className="text-sm font-medium px-2 py-0.5 rounded"
                style={{
                  backgroundColor: `${CATEGORY_COLORS[cat]}20`,
                  color: CATEGORY_COLORS[cat],
                }}
              >
                {cat}
              </span>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </button>
          ))}
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Reason <span className="text-destructive">*</span>
            </label>
            <Select
              value={reason}
              onValueChange={(val) => {
                setReason(val);
                if (reasonError) setReasonError("");
              }}
            >
              <SelectTrigger className={`mt-1 ${reasonError ? "border-red-500 focus-visible:ring-red-500" : ""}`}>
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {MOVE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reason === "Other" && (
              <Textarea
                ref={reasonRef}
                value={otherReason}
                onChange={(e) => {
                  setOtherReason(e.target.value);
                  if (reasonError) setReasonError("");
                }}
                placeholder="Please specify the reason..."
                className={`mt-2 ${reasonError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                rows={3}
              />
            )}
            {reasonError && (
              <p className="text-xs text-red-500 mt-1">{reasonError}</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleMove} disabled={!selectedCategory || !reason || loading}>
            {loading ? "Moving..." : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
