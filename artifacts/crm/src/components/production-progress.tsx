import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, User, CheckCircle2, Circle, Loader2, MessageSquare, FileText } from "lucide-react";

const PRODUCTION_STEPS = [
  "Pending",
  "Material Ready",
  "Production Started",
  "In Process",
  "Quality Check",
  "Packing",
  "Ready For Dispatch",
  "Completed",
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  "Pending": { label: "Pending", className: "bg-gray-100 text-gray-700 border-gray-300" },
  "Material Ready": { label: "Material Ready", className: "bg-blue-100 text-blue-700 border-blue-300" },
  "Production Started": { label: "Production Started", className: "bg-orange-100 text-orange-700 border-orange-300" },
  "In Process": { label: "In Process", className: "bg-purple-100 text-purple-700 border-purple-300" },
  "Quality Check": { label: "Quality Check", className: "bg-yellow-100 text-yellow-700 border-yellow-300" },
  "Packing": { label: "Packing", className: "bg-cyan-100 text-cyan-700 border-cyan-300" },
  "Ready For Dispatch": { label: "Ready For Dispatch", className: "bg-green-100 text-green-700 border-green-300" },
  "Completed": { label: "Completed", className: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  "On Hold": { label: "On Hold", className: "bg-red-100 text-red-700 border-red-300" },
  "Cancelled": { label: "Cancelled", className: "bg-red-100 text-red-700 border-red-300" },
};

function getProgressPercent(status: string): number {
  const idx = PRODUCTION_STEPS.indexOf(status);
  if (idx === -1) return 0;
  return Math.round((idx / (PRODUCTION_STEPS.length - 1)) * 100);
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(d: string | null | undefined): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

export function ProductionProgressSection({ invoiceId }: { invoiceId: number }) {
  const token = localStorage.getItem("crm_token");

  const { data: prod, isLoading } = useQuery({
    queryKey: ["production-progress", invoiceId],
    queryFn: async () => {
      const res = await fetch(`/api/proforma-invoices/${invoiceId}/production-progress`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!token,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Production Progress</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-48 w-full" /></CardContent>
      </Card>
    );
  }

  if (!prod) return null;

  const pct = getProgressPercent(prod.status);
  const statusInfo = STATUS_BADGE[prod.status] || { label: prod.status, className: "bg-gray-100 text-gray-700 border-gray-300" };
  const completedSet = new Set(
    (prod.timeline || []).map((t: any) => t.status)
  );

  return (
    <Card className="border-l-4 border-l-purple-500">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">Production Progress</span>
          <Badge className={`text-xs ${statusInfo.className} border`} variant="outline">
            {statusInfo.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Progress</span>
            <span>{pct}%</span>
          </div>
          <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: pct === 100
                  ? "linear-gradient(90deg, #10b981, #059669)"
                  : "linear-gradient(90deg, #8b5cf6, #6366f1)",
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {prod.assignedProductionManager && (
            <div>
              <span className="text-xs text-muted-foreground">Assigned Production Manager</span>
              <p className="font-medium flex items-center gap-1">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {prod.assignedProductionManager.name}
              </p>
            </div>
          )}
          {prod.productionUnit && (
            <div>
              <span className="text-xs text-muted-foreground">Production Unit</span>
              <p className="font-medium">{prod.productionUnit}</p>
            </div>
          )}
          <div>
            <span className="text-xs text-muted-foreground">Expected Dispatch</span>
            <p className="font-medium">{formatDate(prod.expectedDispatchDate)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Last Updated</span>
            <p className="font-medium flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {formatDateTime(prod.updatedAt)}
            </p>
          </div>
          {prod.lastUpdatedBy && (
            <div>
              <span className="text-xs text-muted-foreground">Updated By</span>
              <p className="font-medium flex items-center gap-1">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {prod.lastUpdatedBy.name}
              </p>
            </div>
          )}
          {prod.productionRemarks && (
            <div className="col-span-2">
              <span className="text-xs text-muted-foreground">Production Remarks</span>
              <p className="font-medium text-sm bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5 mt-1">{prod.productionRemarks}</p>
            </div>
          )}
        </div>

        <div>
          <span className="text-xs text-muted-foreground font-medium">Timeline</span>
          <div className="mt-2 space-y-1">
            {PRODUCTION_STEPS.map((step) => {
              const isCurrent = step === prod.status;
              const isPast = PRODUCTION_STEPS.indexOf(step) < PRODUCTION_STEPS.indexOf(prod.status);
              const stepCompleted = isPast || (isCurrent && prod.status === "Completed");

              let icon: React.ReactNode;
              let textClass = "text-muted-foreground";
              if (step === "Completed" && prod.status === "Completed") {
                icon = <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
                textClass = "text-emerald-600 font-medium";
              } else if (stepCompleted) {
                icon = <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />;
                textClass = "text-green-600";
              } else if (isCurrent) {
                icon = <Loader2 className="h-4 w-4 text-purple-500 flex-shrink-0 animate-spin" />;
                textClass = "text-purple-600 font-medium";
              } else {
                icon = <Circle className="h-4 w-4 text-gray-300 flex-shrink-0" />;
                textClass = "text-gray-400";
              }

              const timelineEntry = (prod.timeline || []).find((t: any) => t.status === step);

              return (
                <div key={step} className="flex items-center gap-2 py-0.5">
                  {icon}
                  <span className={`text-xs ${textClass}`}>{step}</span>
                  {timelineEntry && (
                    <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(timelineEntry.createdAt)}
                      {timelineEntry.createdByName && (
                        <>by {timelineEntry.createdByName}</>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {prod.notes && prod.notes.length > 0 && (
          <div>
            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" />
              Production Notes ({prod.notes.length})
            </span>
            <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
              {prod.notes.map((note: any) => (
                <div key={note.id} className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                  <p className="text-xs text-blue-900">{note.note}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-blue-600">
                    <Clock className="h-3 w-3" />
                    {formatDateTime(note.createdAt)}
                    {note.createdByName && (
                      <span className="flex items-center gap-0.5">
                        <User className="h-3 w-3" />
                        {note.createdByName}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {prod.timeline && prod.timeline.length > 0 && (
          <div>
            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              Activity Log ({prod.timeline.length})
            </span>
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {prod.timeline.map((entry: any) => (
                <div key={entry.id} className="flex items-start gap-2 text-[11px] py-0.5">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                    {entry.status}
                  </Badge>
                  <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                  {entry.createdByName && (
                    <span className="text-muted-foreground">by {entry.createdByName}</span>
                  )}
                  {entry.notes && (
                    <span className="text-muted-foreground italic ml-1">— {entry.notes}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
