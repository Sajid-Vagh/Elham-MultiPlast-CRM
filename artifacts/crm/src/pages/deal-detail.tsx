import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Trash2, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const STAGES = ["New", "CL Sent", "Price Given", "Samples Sent", "Samples Received", "PI Sent", "Won", "Lost"];
const STAGE_PROBS: Record<string, number> = { "New": 10, "CL Sent": 40, "Price Given": 50, "Samples Sent": 60, "Samples Received": 60, "PI Sent": 90, "Won": 100, "Lost": 0 };
const STAGE_COLORS: Record<string, string> = {
  "New": "bg-slate-100 text-slate-700", "CL Sent": "bg-blue-100 text-blue-700",
  "Price Given": "bg-yellow-100 text-yellow-700", "Samples Sent": "bg-orange-100 text-orange-700",
  "Samples Received": "bg-purple-100 text-purple-700", "PI Sent": "bg-indigo-100 text-indigo-700",
  "Won": "bg-green-100 text-green-700", "Lost": "bg-red-100 text-red-700",
};
const LOST_REASONS = ["Price High","Need Different Shape","No Requirement Now","Quality Problem","Transport Concern","Need in Future","Other"];

export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const dealId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: deal, isLoading } = useGetDeal(dealId, { query: { enabled: !!dealId, queryKey: getGetDealQueryKey(dealId) } });
  const { data: dealProducts } = useListDealProducts(dealId, { query: { enabled: !!dealId, queryKey: getListDealProductsQueryKey(dealId) } });
  const { data: activities } = useListActivities({ dealId }, { query: { queryKey: getListActivitiesQueryKey({ dealId }) } });
  const { data: allProducts } = useListProducts();
  const { data: users } = useListUsers();

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

  const [stageChanging, setStageChanging] = useState(false);
  const [lostReason, setLostReason] = useState("");

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!deal) return <div className="p-8">Deal not found.</div>;

  const handleStageChange = (newStage: string) => {
    if (newStage === "Lost" && !lostReason) {
      setStageChanging(true);
      return;
    }
    updateDeal.mutate({ id: dealId, data: { stage: newStage as any, lostReason: newStage === "Lost" ? (lostReason || null) : null } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
        toast({ title: `Deal moved to ${newStage}` });
        setStageChanging(false);
        setLostReason("");
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
        setProdDialogOpen(false);
        setProdId(""); setProdQty("1"); setProdPrice("");
      },
      onError: () => toast({ title: "Error adding product", variant: "destructive" }),
    });
  };

  const handleRemoveProduct = (dpId: number) => {
    removeProduct.mutate({ id: dealId, productId: dpId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDealProductsQueryKey(dealId) });
        toast({ title: "Product removed" });
      },
    });
  };

  const handleLogActivity = () => {
    createActivity.mutate({ data: { dealId, type: actType as any, notes: actNotes || null, followUpDate: actFollowUp || null, followUpType: actFollowType || null } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey({ dealId }) });
        queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
        toast({ title: "Activity logged" });
        setActDialogOpen(false);
        setActNotes(""); setActFollowUp("");
      },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  const contact = deal.contact;
  const owner = deal.salesOwner;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/deals"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button></Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {owner && <div className="w-4 h-4 rounded-full" style={{ backgroundColor: owner.colorCode }} />}
            <h1 className="text-2xl font-bold">{deal.title || `Deal #${deal.id}`}</h1>
            <span className={`text-sm px-2.5 py-1 rounded-full font-medium ${STAGE_COLORS[deal.stage] || "bg-gray-100"}`}>{deal.stage}</span>
          </div>
          {contact && <p className="text-muted-foreground text-sm">{contact.name} {contact.companyName ? `— ${contact.companyName}` : ""}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Stage & Value</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Current Stage</Label>
                <Select value={deal.stage} onValueChange={handleStageChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{s} ({STAGE_PROBS[s]}%)</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {stageChanging && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Lost Reason</Label>
                  <Select value={lostReason} onValueChange={setLostReason}>
                    <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>{LOST_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" className="w-full" onClick={() => handleStageChange("Lost")} disabled={!lostReason}>Confirm Lost</Button>
                </div>
              )}
              {deal.lostReason && <div className="text-sm"><span className="text-muted-foreground">Reason: </span>{deal.lostReason}</div>}
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Total Value (₹)</Label>
                <Input
                  type="number"
                  defaultValue={deal.totalValue ? String(deal.totalValue) : ""}
                  placeholder="0"
                  onBlur={(e) => handleValueUpdate(e.target.value)}
                />
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
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Products</h2>
              <Dialog open={prodDialogOpen} onOpenChange={setProdDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Product</Button>
                </DialogTrigger>
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
            <div className="border rounded-md bg-card overflow-hidden">
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

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Activities</h2>
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
            <div className="space-y-2">
              {activities?.length === 0 && <p className="text-sm text-muted-foreground text-center py-4 border rounded-md bg-card">No activities yet.</p>}
              {activities?.slice().reverse().map(act => (
                <div key={act.id} className="flex gap-3 p-3 border rounded-md bg-card text-sm">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{act.type}</span>
                      <span className="text-xs text-muted-foreground">{new Date(act.createdAt).toLocaleDateString()}</span>
                    </div>
                    {act.notes && <p className="text-muted-foreground mt-1">{act.notes}</p>}
                    {act.followUpDate && <p className="text-xs text-primary mt-1">Follow-up: {act.followUpDate} via {act.followUpType}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
