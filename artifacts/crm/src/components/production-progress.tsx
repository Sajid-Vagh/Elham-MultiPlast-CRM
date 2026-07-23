import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Circle, Loader2, Clock, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

const PRODUCTION_STEPS = [
  "Pending",
  "Production On Going",
  "Packaging",
  "Ready To Dispatch",
  "Completed",
];

const STATUS_BADGE: Record<string, string> = {
  "Pending": "bg-gray-100 text-gray-700 border-gray-300",
  "Production On Going": "bg-orange-100 text-orange-700 border-orange-300",
  "Packaging": "bg-yellow-100 text-yellow-700 border-yellow-300",
  "Ready To Dispatch": "bg-green-100 text-green-700 border-green-300",
  "Completed": "bg-emerald-100 text-emerald-700 border-emerald-300",
  "Cancelled": "bg-red-100 text-red-700 border-red-300",
};

interface Props {
  dealId: number;
}

export function ProductionProgressSection({ invoiceId }: { invoiceId: number }) {
  const { data: productionOrder } = useQuery({
    queryKey: ["production-by-invoice", invoiceId],
    queryFn: () => customFetch<any>(`/production/by-invoice/${invoiceId}`),
    enabled: !!invoiceId,
  });

  if (!productionOrder) return null;

  return <ProductionProgress dealId={productionOrder.dealId} />;
}

export default function ProductionProgress({ dealId }: Props) {
  const { data: progress, isLoading } = useQuery({
    queryKey: ["production-progress", dealId],
    queryFn: () => customFetch<any>(`/production/progress-by-deal/${dealId}`),
    enabled: !!dealId,
  });

  const currentStepIndex = useMemo(() => {
    if (!progress?.status) return 0;
    const idx = PRODUCTION_STEPS.indexOf(progress.status);
    return idx >= 0 ? idx : 0;
  }, [progress]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Production Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (!progress) return null;

  const isCancelled = progress.status === "Cancelled";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Production Progress</CardTitle>
          <Badge variant="outline" className={`text-xs ${STATUS_BADGE[progress.status] || "bg-gray-100"} border`}>
            {progress.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress Steps */}
        <div className="flex items-center gap-1">
          {PRODUCTION_STEPS.map((step, idx) => {
            const isCompleted = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;
            const isFuture = idx > currentStepIndex;

            let icon;
            if (isCompleted) icon = <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
            else if (isCurrent && !isCancelled) icon = <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />;
            else icon = <Circle className={`h-4 w-4 ${isFuture ? "text-gray-300" : isCancelled ? "text-red-300" : "text-gray-400"}`} />;

            return (
              <div key={step} className="flex items-center gap-1 flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  {icon}
                  <span className={`text-[8px] mt-0.5 whitespace-nowrap ${isCurrent ? "font-semibold text-foreground" : isCompleted ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {step === "Production On Going" ? "In Prod" : step === "Ready To Dispatch" ? "Ready" : step}
                  </span>
                </div>
                {idx < PRODUCTION_STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded ${isCompleted ? "bg-emerald-400" : isCurrent ? "bg-purple-400" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {progress.assignedProductionManager && (
            <div>
              <span className="text-xs text-muted-foreground">Production Manager</span>
              <p className="font-medium">{progress.assignedProductionManager.name}</p>
            </div>
          )}
          {progress.productionUnit && (
            <div>
              <span className="text-xs text-muted-foreground">Production Unit</span>
              <p className="font-medium">{progress.productionUnit}</p>
            </div>
          )}
          {progress.expectedDispatchDate && (
            <div>
              <span className="text-xs text-muted-foreground">Expected Dispatch</span>
              <p className="font-medium">{new Date(progress.expectedDispatchDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
            </div>
          )}
          {progress.lastUpdatedBy && (
            <div>
              <span className="text-xs text-muted-foreground">Last Updated By</span>
              <p className="font-medium">{progress.lastUpdatedBy.name}</p>
            </div>
          )}
          {progress.plannedMachine && (
            <div>
              <span className="text-xs text-muted-foreground">Planned Machine</span>
              <p className="font-medium">{progress.plannedMachine}</p>
            </div>
          )}
          {progress.productionMachine && (
            <div>
              <span className="text-xs text-muted-foreground">Production Machine</span>
              <p className="font-medium">{progress.productionMachine}</p>
            </div>
          )}
          {progress.expectedStartDate && (
            <div>
              <span className="text-xs text-muted-foreground">Expected Start</span>
              <p className="font-medium">{new Date(progress.expectedStartDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
            </div>
          )}
          {progress.expectedCompletionDate && (
            <div>
              <span className="text-xs text-muted-foreground">Expected Completion</span>
              <p className="font-medium">{new Date(progress.expectedCompletionDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
            </div>
          )}
          {progress.packingType && (
            <div>
              <span className="text-xs text-muted-foreground">Packing Type</span>
              <p className="font-medium">{progress.packingType}</p>
            </div>
          )}
          {progress.transportName && (
            <div>
              <span className="text-xs text-muted-foreground">Transport</span>
              <p className="font-medium">{progress.transportName}</p>
            </div>
          )}
          {progress.transportDetails && (
            <div>
              <span className="text-xs text-muted-foreground">Booking No.</span>
              <p className="font-medium">{progress.transportDetails}</p>
            </div>
          )}
        </div>

        {/* Timeline */}
        {progress.timeline && progress.timeline.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Activity Log</p>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {progress.timeline.slice(0, 10).map((entry: any) => (
                <div key={entry.id} className="flex items-start gap-2 text-xs">
                  <Badge variant="outline" className={`text-[9px] py-0 px-1.5 ${STATUS_BADGE[entry.status] || "bg-gray-100"} border`}>
                    {entry.status}
                  </Badge>
                  <span className="text-muted-foreground flex-1">{entry.notes}</span>
                  <span className="text-muted-foreground/60 whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
