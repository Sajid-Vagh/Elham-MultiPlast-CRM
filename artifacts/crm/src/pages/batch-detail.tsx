import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, CheckCircle, XCircle, Play, Pause, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  "Planned": "bg-gray-100 text-gray-700", "Material Issued": "bg-yellow-100 text-yellow-700",
  "Running": "bg-blue-100 text-blue-700", "Paused": "bg-orange-100 text-orange-700",
  "Completed": "bg-green-100 text-green-700", "QC Pending": "bg-indigo-100 text-indigo-700",
  "QC Passed": "bg-green-100 text-green-700", "QC Failed": "bg-red-100 text-red-700",
  "Ready For Dispatch": "bg-teal-100 text-teal-700", "Closed": "bg-gray-100 text-gray-500",
};

const STATUS_FLOW = ["Planned", "Material Issued", "Running", "Paused", "Completed", "QC Pending", "QC Passed", "QC Failed", "Ready For Dispatch", "Closed"];

export default function BatchDetail() {
  const [, params] = useRoute("/production/batches/:id");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const batchId = Number(params?.id);

  const [showQcDialog, setShowQcDialog] = useState(false);
  const [qcForm, setQcForm] = useState({ bottleWeight: "", colorCheck: "Pass", leakTest: "Pass", capFitting: "Pass", visualInspection: "Pass", overallResult: "Pass", remarks: "" });

  const { data: batch, isLoading } = useQuery({
    queryKey: ["batch", batchId],
    queryFn: async () => {
      const res = await fetch(`/api/batches/${batchId}`, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } });
      return res.json();
    },
    enabled: !!batchId,
  });

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const res = await fetch(`/api/batches/${batchId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["batch", batchId] }); toast({ title: "Status updated" }); },
  });

  const submitQc = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/batches/${batchId}/qc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
        body: JSON.stringify(qcForm),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["batch", batchId] }); setShowQcDialog(false); toast({ title: "QC submitted" }); },
  });

  if (isLoading) return <div className="p-6 text-center">Loading...</div>;
  if (!batch) return <div className="p-6 text-center">Batch not found</div>;

  const currentIdx = STATUS_FLOW.indexOf(batch.status);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/production/batches")}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{batch.batchNumber}</h1>
          <p className="text-sm text-muted-foreground">{batch.productName}</p>
        </div>
        <Badge className={STATUS_COLORS[batch.status] || ""}>{batch.status}</Badge>
      </div>

      {/* Progress */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium">Progress</span>
              <span className="text-sm text-muted-foreground">{batch.progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3"><div className="bg-blue-500 h-3 rounded-full transition-all" style={{ width: `${batch.progress}%` }} /></div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Quantity</p>
            <p className="text-lg font-bold">{batch.completedQuantity} / {batch.totalQuantity}</p>
          </div>
        </div>
      </Card>

      {/* Status Actions */}
      <div className="flex gap-2 flex-wrap">
        {currentIdx < STATUS_FLOW.length - 1 && batch.status !== "Paused" && (
          <Button onClick={() => updateStatus.mutate(STATUS_FLOW[currentIdx + 1])}>
            Move to: {STATUS_FLOW[currentIdx + 1]}
          </Button>
        )}
        {batch.status === "Running" && <Button variant="outline" onClick={() => updateStatus.mutate("Paused")}><Pause className="h-4 w-4 mr-1" />Pause</Button>}
        {batch.status === "Paused" && <Button onClick={() => updateStatus.mutate("Running")}><Play className="h-4 w-4 mr-1" />Resume</Button>}
        {batch.status === "Completed" && <Button onClick={() => setShowQcDialog(true)}><CheckCircle className="h-4 w-4 mr-1" />Submit QC</Button>}
      </div>

      {/* Batch Details */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle className="text-base">Production</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Machine:</span> {batch.machine || "-"}</p>
          <p><span className="text-muted-foreground">Operator:</span> {batch.operator || "-"}</p>
          <p><span className="text-muted-foreground">Shift:</span> {batch.shift || "-"}</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Created:</span> {new Date(batch.createdAt).toLocaleDateString("en-IN")}</p>
          <p><span className="text-muted-foreground">Expected Completion:</span> {batch.expectedCompletionDate || "-"}</p>
          <p><span className="text-muted-foreground">Priority:</span> {batch.priority}</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Quantity</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
          <p><span className="text-muted-foreground">Total:</span> {batch.totalQuantity}</p>
          <p><span className="text-muted-foreground">Completed:</span> {batch.completedQuantity}</p>
          <p><span className="text-muted-foreground">Rejected:</span> {batch.rejectedQuantity}</p>
        </CardContent></Card>
      </div>

      {/* Latest QC */}
      {batch.latestQc && (
        <Card>
          <CardHeader><CardTitle className="text-base">Latest QC Report</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-3 text-sm">
              <div><span className="text-muted-foreground">Result:</span> <Badge className={batch.latestQc.overallResult === "Pass" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>{batch.latestQc.overallResult}</Badge></div>
              <div><span className="text-muted-foreground">Weight:</span> {batch.latestQc.bottleWeight || "-"}</div>
              <div><span className="text-muted-foreground">Color:</span> {batch.latestQc.colorCheck || "-"}</div>
              <div><span className="text-muted-foreground">Leak Test:</span> {batch.latestQc.leakTest || "-"}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Batch Items */}
      {batch.items?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Batch Items</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Completed</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {batch.items.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.productName}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{item.completedQuantity}</TableCell>
                    <TableCell><Badge className={STATUS_COLORS[item.status] || "bg-gray-100"}>{item.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* QC Dialog */}
      <Dialog open={showQcDialog} onOpenChange={setShowQcDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submit QC Report</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Bottle Weight</Label><Input value={qcForm.bottleWeight} onChange={e => setQcForm(f => ({ ...f, bottleWeight: e.target.value }))} /></div>
            {(["colorCheck", "leakTest", "capFitting", "visualInspection"] as const).map(field => (
              <div key={field}><Label>{field.replace(/([A-Z])/g, " $1").trim()}</Label>
                <Select value={qcForm[field]} onValueChange={v => setQcForm(f => ({ ...f, [field]: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Pass">Pass</SelectItem><SelectItem value="Fail">Fail</SelectItem></SelectContent>
                </Select>
              </div>
            ))}
            <div><Label>Overall Result</Label><Select value={qcForm.overallResult} onValueChange={v => setQcForm(f => ({ ...f, overallResult: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Pass">Pass</SelectItem><SelectItem value="Fail">Fail</SelectItem></SelectContent></Select></div>
            <div><Label>Remarks</Label><Textarea value={qcForm.remarks} onChange={e => setQcForm(f => ({ ...f, remarks: e.target.value }))} /></div>
            <Button onClick={() => submitQc.mutate()} disabled={submitQc.isPending} className="w-full">Submit QC</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
