import { useState, useMemo } from "react";
import { useParams, Link } from "wouter";
import {
  useGetDeal, useUpdateDeal, useListDealProducts, useAddDealProduct, useRemoveDealProduct,
  useListActivities, useCreateActivity, useListProducts, useListUsers,
  getGetDealQueryKey, getListDealProductsQueryKey, getListActivitiesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const STAGES = ["New", "CL Sent", "Price Given", "Samples Sent", "Samples Received", "PI Sent", "Won", "Lost"];
const STAGE_PROBS: Record<string, number> = { "New": 10, "CL Sent": 40, "Price Given": 50, "Samples Sent": 60, "Samples Received": 60, "PI Sent": 90, "Won": 100, "Lost": 0 };
const STAGE_COLORS: Record<string, string> = {
  "New": "bg-slate-100 text-slate-700", "CL Sent": "bg-blue-100 text-blue-700",
  "Price Given": "bg-yellow-100 text-yellow-700", "Samples Sent": "bg-orange-100 text-orange-700",
  "Samples Received": "bg-purple-100 text-purple-700", "PI Sent": "bg-indigo-100 text-indigo-700",
  "Won": "bg-green-100 text-green-700", "Lost": "bg-red-100 text-red-700",
};

const LOST_REASONS = [
  "Price Too High",
  "Transportation / Logistics Issue",
  "Wants Local / Nearby Supplier",
  "Design Issue",
  "Timeline Issue",
  "Low Quantity",
  "No Requirement Now",
  "Other",
];

const ACT_STYLE: Record<string, { bg: string; fg: string; icon: string }> = {
  "Call":     { bg: "#dcfce7", fg: "#15803d", icon: "📞" },
  "WhatsApp": { bg: "#ccfbf1", fg: "#0f766e", icon: "💬" },
  "Email":    { bg: "#dbeafe", fg: "#1d4ed8", icon: "✉️" },
  "Note":     { bg: "#fef9c3", fg: "#a16207", icon: "📝" },
  "FollowUp": { bg: "#ffedd5", fg: "#c2410c", icon: "🔔" },
};

function todayStr() { return new Date().toISOString().split("T")[0]!; }
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0]!;
}
function monthStartStr() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().split("T")[0]!;
}

export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const dealId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: deal, isLoading } = useGetDeal(dealId, { query: { enabled: !!dealId, queryKey: getGetDealQueryKey(dealId) } });
  const { data: dealProducts } = useListDealProducts(dealId, { query: { enabled: !!dealId, queryKey: getListDealProductsQueryKey(dealId) } });
  const { data: activities } = useListActivities({ dealId }, { query: { queryKey: getListActivitiesQueryKey({ dealId }) } });
  const { data: allProducts } = useListProducts();

  const updateDeal = useUpdateDeal();
  const addProduct = useAddDealProduct();
  const removeProduct = useRemoveDealProduct();
  const createActivity = useCreateActivity();

  const [prodId, setProdId] = useState("");
  const [prodQty, setProdQty] = useState("1");
  const [prodPrice, setProdPrice] = useState("");
  const [prodDialogOpen, setProdDialogOpen] = useState(false);

  const [actType, setActType] = useState("Call");
  const [actNotes, setActNotes] = useState("");
  const [actFollowUp, setActFollowUp] = useState("");
  const [actFollowType, setActFollowType] = useState("Call");
  const [actDialogOpen, setActDialogOpen] = useState(false);

  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [wonConfirmOpen, setWonConfirmOpen] = useState(false);
  const [lostReasonOpen, setLostReasonOpen] = useState(false);

  // Activity date filter
  const [actQuick, setActQuick] = useState<string>("all");
  const [actFromDate, setActFromDate] = useState("");
  const [actToDate, setActToDate] = useState("");

  const applyQuick = (key: string) => {
    setActQuick(key);
    if (key === "today")   { setActFromDate(todayStr()); setActToDate(todayStr()); }
    else if (key === "yesterday") { setActFromDate(daysAgoStr(1)); setActToDate(daysAgoStr(1)); }
    else if (key === "week")  { setActFromDate(daysAgoStr(6)); setActToDate(todayStr()); }
    else if (key === "month") { setActFromDate(monthStartStr()); setActToDate(todayStr()); }
    else { setActFromDate(""); setActToDate(""); }
  };

  const filteredActivities = useMemo(() => {
    if (!activities) return [];
    let list = [...activities].reverse();
    if (actFromDate) list = list.filter(a => a.createdAt.slice(0, 10) >= actFromDate);
    if (actToDate)   list = list.filter(a => a.createdAt.slice(0, 10) <= actToDate);
    return list;
  }, [activities, actFromDate, actToDate]);

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!deal) return <div className="p-8">Deal not found.</div>;

  const handleStageSelect = (newStage: string) => {
    if (newStage === deal.stage) return;
    if (newStage === "Won") { setPendingStage("Won"); setWonConfirmOpen(true); return; }
    if (newStage === "Lost") { setPendingStage("Lost"); setLostReason(""); setLostReasonOpen(true); return; }
    doStageUpdate(newStage, null);
  };

  const doStageUpdate = (stage: string, reason: string | null) => {
    updateDeal.mutate({ id: dealId, data: { stage: stage as any, lostReason: reason } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
        toast({ title: `Deal moved to ${stage}` });
        setWonConfirmOpen(false); setLostReasonOpen(false); setPendingStage(null); setLostReason("");
      },
      onError: () => toast({ title: "Error updating stage", variant: "destructive" }),
    });
  };

  const handleValueUpdate = (val: string) => {
    updateDeal.mutate({ id: dealId, data: { totalValue: val ? Number(val) : null } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) }),
    });
  };

  const handleAddProduct = () => {
    if (!prodId) return;
    addProduct.mutate({ id: dealId, data: { productId: Number(prodId), quantity: Number(prodQty), unitPrice: prodPrice ? Number(prodPrice) : null } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDealProductsQueryKey(dealId) });
        toast({ title: "Product added" });
        setProdDialogOpen(false); setProdId(""); setProdQty("1"); setProdPrice("");
      },
      onError: () => toast({ title: "Error adding product", variant: "destructive" }),
    });
  };

  const handleRemoveProduct = (dpId: number) => {
    removeProduct.mutate({ id: dealId, productId: dpId }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListDealProductsQueryKey(dealId) }); toast({ title: "Product removed" }); },
    });
  };

  const handleLogActivity = () => {
    createActivity.mutate({ data: { dealId, type: actType as any, notes: actNotes || null, followUpDate: actFollowUp || null, followUpType: actFollowType || null } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ dealId }) });
        queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
        toast({ title: "Activity logged" });
        setActDialogOpen(false); setActNotes(""); setActFollowUp("");
      },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  const contact = deal.contact;
  const owner = deal.salesOwner;

  const quickBtns = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "week", label: "Last 7 Days" },
    { key: "month", label: "This Month" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/deals"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {owner && <div className="w-4 h-4 rounded-full shadow-sm" style={{ backgroundColor: owner.colorCode }} />}
            <h1 className="text-2xl font-bold">{deal.title || `Deal #${deal.id}`}</h1>
            <span className={`text-sm px-2.5 py-1 rounded-full font-medium ${STAGE_COLORS[deal.stage] || "bg-gray-100"}`}>{deal.stage}</span>
          </div>
          {contact && <p className="text-muted-foreground text-sm">{contact.name}{contact.companyName ? ` — ${contact.companyName}` : ""}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Stage & Value</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Change Stage</Label>
                <Select value={deal.stage} onValueChange={handleStageSelect}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{s} ({STAGE_PROBS[s]}%)</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {deal.lostReason && (
                <div className="text-sm p-2 bg-red-50 border border-red-200 rounded-lg">
                  <span className="text-xs text-red-500">Lost reason: </span>
                  <span className="font-medium text-red-700">{deal.lostReason}</span>
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Total Value (₹)</Label>
                <Input type="number" defaultValue={deal.totalValue ? String(deal.totalValue) : ""} placeholder="0" onBlur={e => handleValueUpdate(e.target.value)} />
              </div>
              <div className="text-xs text-muted-foreground">Probability: {STAGE_PROBS[deal.stage] ?? deal.probability}%</div>
            </CardContent>
          </Card>

          {contact && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Contact</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <Link href={`/leads/${contact.id}`} className="font-medium hover:underline text-primary">{contact.name}</Link>
                {contact.companyName && <p className="text-muted-foreground">{contact.companyName}</p>}
                <p>{contact.mobile}</p>
                {contact.city && <p className="text-muted-foreground">{contact.city}</p>}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          {/* Products */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Products</h2>
              <Dialog open={prodDialogOpen} onOpenChange={setProdDialogOpen}>
                <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Product</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Product</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div><Label>Product</Label>
                      <Select value={prodId} onValueChange={setProdId}>
                        <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                        <SelectContent>{allProducts?.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name} ({p.productCode})</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Quantity</Label><Input type="number" min="1" value={prodQty} onChange={e => setProdQty(e.target.value)} /></div>
                    <div><Label>Unit Price (₹)</Label><Input type="number" value={prodPrice} onChange={e => setProdPrice(e.target.value)} placeholder="Optional" /></div>
                    <Button onClick={handleAddProduct} disabled={addProduct.isPending || !prodId} className="w-full">Add</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="border rounded-lg bg-card overflow-hidden">
              {dealProducts?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No products added.</p>}
              {dealProducts?.map(dp => (
                <div key={dp.id} className="flex items-center justify-between px-4 py-3 border-b last:border-0">
                  <div>
                    <p className="font-medium text-sm">{dp.product?.name}</p>
                    <p className="text-xs text-muted-foreground">{dp.product?.productCode} · Qty: {dp.quantity}{dp.unitPrice ? ` · ₹${Number(dp.unitPrice).toLocaleString()}` : ""}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRemoveProduct(dp.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Activities */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Activities</h2>
                {actQuick !== "all" && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {filteredActivities.length} shown
                  </span>
                )}
              </div>
              <Dialog open={actDialogOpen} onOpenChange={setActDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" /> Log Activity</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Log Activity</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div><Label>Type</Label>
                      <Select value={actType} onValueChange={setActType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["Call","WhatsApp","Email","Note","FollowUp"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Notes</Label><Textarea value={actNotes} onChange={e => setActNotes(e.target.value)} placeholder="Notes from this interaction..." /></div>
                    <div><Label>Next Follow-up Date</Label><Input type="date" value={actFollowUp} onChange={e => setActFollowUp(e.target.value)} /></div>
                    <div><Label>Follow-up Type</Label>
                      <Select value={actFollowType} onValueChange={setActFollowType}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["Call","WhatsApp","Email"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Button onClick={handleLogActivity} disabled={createActivity.isPending} className="w-full">Log</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {/* Quick date filter row */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {quickBtns.map(b => (
                <button key={b.key} className={`date-quick-btn ${actQuick === b.key ? "active" : ""}`} onClick={() => applyQuick(b.key)}>
                  {b.label}
                </button>
              ))}
              <span className="text-muted-foreground text-xs ml-1">|</span>
              <Input type="date" value={actFromDate} onChange={e => { setActFromDate(e.target.value); setActQuick("custom"); }} className="h-7 w-36 text-xs" />
              <span className="text-xs text-muted-foreground">–</span>
              <Input type="date" value={actToDate} onChange={e => { setActToDate(e.target.value); setActQuick("custom"); }} className="h-7 w-36 text-xs" />
            </div>

            <div className="space-y-2">
              {filteredActivities.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6 border rounded-lg bg-card">
                  {actQuick !== "all" ? "No activities in this date range." : "No activities yet."}
                </p>
              )}
              {filteredActivities.map(act => {
                const style = ACT_STYLE[act.type] || { bg: "#f3f4f6", fg: "#374151", icon: "•" };
                return (
                  <div key={act.id} className="flex gap-3 p-3 border rounded-lg bg-card text-sm">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base" style={{ backgroundColor: style.bg }}>
                      {style.icon}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: style.bg, color: style.fg }}>{act.type}</span>
                        <span className="text-xs text-muted-foreground">{new Date(act.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                      </div>
                      {act.notes && <p className="text-muted-foreground mt-1.5">{act.notes}</p>}
                      {act.followUpDate && <p className="text-xs text-primary mt-1">Follow-up: {act.followUpDate} via {act.followUpType}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Won confirmation */}
      <AlertDialog open={wonConfirmOpen} onOpenChange={setWonConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-green-700">🎉 Confirm — Deal Won?</AlertDialogTitle>
            <AlertDialogDescription>
              You are marking <strong>{deal.title || `Deal #${deal.id}`}</strong>
              {contact ? ` with ${contact.name}` : ""} as <strong>Won</strong>.
              {deal.totalValue ? ` Deal value: ₹${Number(deal.totalValue).toLocaleString()}.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingStage(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-green-600 text-white hover:bg-green-700" onClick={() => doStageUpdate("Won", null)}>
              Yes, Mark as Won
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lost reason */}
      <AlertDialog open={lostReasonOpen} onOpenChange={setLostReasonOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-700">Mark as Lost — Select Reason</AlertDialogTitle>
            <AlertDialogDescription>Please select why this deal was lost. This helps improve the reports.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <Select value={lostReason} onValueChange={setLostReason}>
              <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>{LOST_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingStage(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!lostReason}
              onClick={() => { if (lostReason) doStageUpdate("Lost", lostReason); }}
            >
              Confirm Lost
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
