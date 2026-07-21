import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, ExternalLink, ArrowLeftRight, X, Phone, Mail, MapPin, Calendar, Tag, TrendingUp, Clock, Shield, CheckCircle } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";

export interface DuplicateLeadInfo {
  duplicate: boolean;
  leadId: number;
  customerName: string;
  companyName?: string | null;
  mobile: string;
  email?: string | null;
  ownerId: number;
  ownerName: string;
  ownerRole: string;
  ownerProfilePhoto?: string | null;
  unit?: string | null;
  category: string;
  dealStage?: string | null;
  status: string;
  lastFollowUp?: string | null;
  createdAt?: string | null;
  viewUrl?: string | null;
}

interface DuplicateWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DuplicateLeadInfo | null;
  userRole?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Regular Follow up": "bg-blue-100 text-blue-800 border-blue-200",
  "Category A": "bg-amber-100 text-amber-800 border-amber-200",
  "Category B": "bg-orange-100 text-orange-800 border-orange-200",
  "Category C": "bg-red-100 text-red-800 border-red-200",
  "My Client": "bg-green-100 text-green-800 border-green-200",
};

const STAGE_COLORS: Record<string, string> = {
  "New": "bg-slate-100 text-slate-700",
  "CL Sent": "bg-blue-100 text-blue-700",
  "Price Given": "bg-indigo-100 text-indigo-700",
  "Samples Sent": "bg-purple-100 text-purple-700",
  "Samples Received": "bg-violet-100 text-violet-700",
  "PI Sent": "bg-cyan-100 text-cyan-700",
  "Won": "bg-green-100 text-green-700",
  "Lost": "bg-red-100 text-red-700",
};

const STATUS_COLORS: Record<string, string> = {
  "Active": "bg-green-100 text-green-800",
  "Inactive": "bg-gray-100 text-gray-600",
  "Won": "bg-emerald-100 text-emerald-800",
  "Lost": "bg-red-100 text-red-800",
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "-";
  }
}

export function DuplicateWarningDialog({
  open,
  onOpenChange,
  data,
  userRole = "sales",
}: DuplicateWarningDialogProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [transferRequested, setTransferRequested] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);

  if (!data) return null;

  const handleRequestTransfer = async () => {
    setTransferLoading(true);
    try {
      const res = await fetch(`/api/contacts/${data.leadId}/request-transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        setTransferRequested(true);
        toast({
          title: "Transfer Requested",
          description: `Notification sent to ${data.ownerName} and admins.`,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        toast({
          title: "Failed",
          description: err.error || "Could not send transfer request",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Failed", description: "Network error", variant: "destructive" });
    } finally {
      setTransferLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setTransferRequested(false); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-center gap-2 text-amber-800 text-lg">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-100">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              Customer Already Exists
            </DialogTitle>
            <DialogDescription className="text-amber-700 text-sm">
              This customer is already assigned to another sales team member.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Details */}
          <div className="space-y-0 bg-muted/40 rounded-lg border divide-y">
            <DetailRow icon={<span className="text-sm">👤</span>} label="Customer" value={data.customerName} />
            <DetailRow icon={<Phone className="h-3.5 w-3.5" />} label="Mobile" value={data.mobile} />
            {data.email && (
              <DetailRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={data.email} />
            )}
            <DetailRow
              icon={<span className="text-sm">👤</span>}
              label="Current Owner"
              value={
                <span className="flex items-center gap-1.5">
                  <UserAvatar profilePhoto={data.ownerProfilePhoto} name={data.ownerName} className="w-4 h-4" />
                  {data.ownerName}
                </span>
              }
            />
            <DetailRow icon={<Shield className="h-3.5 w-3.5" />} label="Role" value={<span className="capitalize">{data.ownerRole}</span>} />
            {data.unit && (
              <DetailRow icon={<MapPin className="h-3.5 w-3.5" />} label="Unit" value={data.unit} />
            )}
            <DetailRow
              icon={<Tag className="h-3.5 w-3.5" />}
              label="Category"
              value={
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${CATEGORY_COLORS[data.category] || "bg-gray-100 text-gray-700 border-gray-200"}`}>
                  {data.category}
                </span>
              }
            />
            {data.dealStage && (
              <DetailRow
                icon={<TrendingUp className="h-3.5 w-3.5" />}
                label="Deal Stage"
                value={
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[data.dealStage] || "bg-gray-100 text-gray-700"}`}>
                    {data.dealStage}
                  </span>
                }
              />
            )}
            <DetailRow
              icon={<Shield className="h-3.5 w-3.5" />}
              label="Status"
              value={
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[data.status] || "bg-gray-100 text-gray-700"}`}>
                  {data.status}
                </span>
              }
            />
            {data.createdAt && (
              <DetailRow icon={<Calendar className="h-3.5 w-3.5" />} label="Created" value={formatDate(data.createdAt)} />
            )}
            {data.lastFollowUp && (
              <DetailRow icon={<Clock className="h-3.5 w-3.5" />} label="Last Follow-up" value={formatDate(data.lastFollowUp)} />
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t bg-muted/20 px-6 py-3 flex flex-wrap gap-2 justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setTransferRequested(false); onOpenChange(false); }}
          >
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          {!transferRequested ? (
            <Button
              variant="outline"
              size="sm"
              disabled={transferLoading}
              onClick={handleRequestTransfer}
            >
              <ArrowLeftRight className="h-4 w-4 mr-1" />
              {transferLoading ? "Sending..." : "Request Transfer"}
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-green-700 px-2">
              <CheckCircle className="h-4 w-4" />
              Transfer requested
            </div>
          )}
          <Button
            size="sm"
            onClick={() => {
              setTransferRequested(false);
              onOpenChange(false);
              setLocation(data.viewUrl || `/leads/${data.leadId}`);
            }}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            View Lead
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="text-muted-foreground shrink-0 w-5 flex justify-center">{icon}</span>
      <span className="text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="font-medium text-foreground min-w-0">{value}</span>
    </div>
  );
}
