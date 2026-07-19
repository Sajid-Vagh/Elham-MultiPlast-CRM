import { useState, useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetDeal, useUpdateDeal, useDeleteDeal, useListDealProducts, useAddDealProduct, useRemoveDealProduct,
  useListActivities, useCreateActivity, useUpdateActivity, useDeleteActivity, useListProducts,
  useGetMe,
  getGetDealQueryKey,   getListDealProductsQueryKey, getListActivitiesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { onDealChange, onActivityChange, onProductionChange } from "@/lib/query-invalidation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, Trash2, FolderTree, Pencil, Check, X, Loader2 } from "lucide-react";
import { MarkLostDialog } from "@/components/mark-lost-dialog";
import { DealWonCelebration } from "@/components/deal-won-celebration";
import { PiSentDialog } from "@/components/pi-sent-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CategoryBadge } from "@/components/category-badge";
import { MoveCategoryDialog } from "@/components/move-category-dialog";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { DEAL_STAGES, STAGE_PROBS, STAGE_BADGE_COLORS } from "@/lib/deal-stages";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { useActiveUnits } from "@/lib/use-active-units";
import { Link as LinkIcon } from "lucide-react";

const PI_STATUS_COLORS: Record<string, string> = {
  "No PI": "bg-gray-100 text-gray-500",
  "Draft": "bg-slate-100 text-slate-600",
  "Sent": "bg-blue-100 text-blue-600",
  "Viewed": "bg-cyan-100 text-cyan-600",
  "Approved": "bg-green-100 text-green-600",
  "Rejected": "bg-red-100 text-red-600",
  "Expired": "bg-yellow-100 text-yellow-600",
  "Converted to Order": "bg-purple-100 text-purple-600",
  "Converted to Production": "bg-purple-100 text-purple-600",
};

const ACT_STYLE: Record<string, { bg: string; fg: string; icon: string }> = {
  "Call":     { bg: "#dcfce7", fg: "#15803d", icon: "\u{1F4DE}" },
  "WhatsApp": { bg: "#ccfbf1", fg: "#0f766e", icon: "\u{1F4AC}" },
  "Email":    { bg: "#dbeafe", fg: "#1d4ed8", icon: "\u2709\uFE0F" },
  "Note":     { bg: "#fef9c3", fg: "#a16207", icon: "\u{1F4DD}" },
  "FollowUp": { bg: "#ffedd5", fg: "#c2410c", icon: "\u{1F514}" },
  "Meeting":  { bg: "#ede9fe", fg: "#6d28d9", icon: "\u{1F91D}" },
};

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() { return localDateStr(new Date()); }
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return localDateStr(d);
}
function monthStartStr() {
  const d = new Date(); d.setDate(1);
  return localDateStr(d);
}

export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const dealId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { units: activeUnits } = useActiveUnits();

  const { data: deal, isLoading } = useGetDeal(dealId, { query: { enabled: !!dealId, queryKey: getGetDealQueryKey(dealId) } });
  const { data: dealProducts } = useListDealProducts(dealId, { query: { enabled: !!dealId, queryKey: getListDealProductsQueryKey(dealId) } });
  const { data: activities } = useListActivities({ dealId }, { query: { queryKey: getListActivitiesQueryKey({ dealId }) } });
  const { data: allProducts } = useListProducts();
  const { data: productionProgress } = useQuery({
    queryKey: ["production-progress-by-deal", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/production/progress-by-deal/${dealId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!dealId,
    refetchInterval: 30000,
  });

  const updateDeal = useUpdateDeal();
  const addProduct = useAddDealProduct();
  const removeProduct = useRemoveDealProduct();
  const createActivity = useCreateActivity();
  const updateActivity = useUpdateActivity();
  const deleteActivity = useDeleteActivity();
  const { data: currentUser } = useGetMe();

  const [prodId, setProdId] = useState("");
  const [prodQty, setProdQty] = useState("1");
  const [prodPrice, setProdPrice] = useState("");
  const [prodDialogOpen, setProdDialogOpen] = useState(false);

  const [actType, setActType] = useState("Call");
  const [actNotes, setActNotes] = useState("");
  const [actFollowUp, setActFollowUp] = useState("");
  const [actFollowUpTime, setActFollowUpTime] = useState("");
  const [actFollowType, setActFollowType] = useState("Call");
  const [actDialogOpen, setActDialogOpen] = useState(false);

  const [fuDialogOpen, setFuDialogOpen] = useState(false);
  const [fuNotes, setFuNotes] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [fuTime, setFuTime] = useState("");
  const [fuType, setFuType] = useState("Call");

  const [editActivity, setEditActivity] = useState<any>(null);
  const [editActType, setEditActType] = useState("Call");
  const [editActNotes, setEditActNotes] = useState("");
  const [editActFollowUp, setEditActFollowUp] = useState("");
  const [editActFollowUpTime, setEditActFollowUpTime] = useState("");
  const [editActFollowType, setEditActFollowType] = useState("Call");
  const [editActStatus, setEditActStatus] = useState("Pending");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteActId, setDeleteActId] = useState<number | null>(null);

  // Mark Won dialog state
  const [markWonOpen, setMarkWonOpen] = useState(false);
  const [wonAmount, setWonAmount] = useState("");
  const [wonProductionUnit, setWonProductionUnit] = useState("");
  const [wonProductionNotes, setWonProductionNotes] = useState("");
  const [wonSalesNotes, setWonSalesNotes] = useState("");
  const [wonUnitReason, setWonUnitReason] = useState("");
  const [wonSubmitting, setWonSubmitting] = useState(false);
  const [wonDealForCelebration, setWonDealForCelebration] = useState<any>(null);
  const [wonTodayCount, setWonTodayCount] = useState(1);

  const [lostOpen, setLostOpen] = useState(false);
  const [lostSubmitting, setLostSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [showMoveCategory, setShowMoveCategory] = useState(false);
  const [piSentDialogOpen, setPiSentDialogOpen] = useState(false);

  // Change Production Unit dialog
  const [changeUnitOpen, setChangeUnitOpen] = useState(false);
  const [changeUnitValue, setChangeUnitValue] = useState("");
  const [changeUnitReason, setChangeUnitReason] = useState("");
  const [changeUnitSubmitting, setChangeUnitSubmitting] = useState(false);

  const deleteDeal = useDeleteDeal();

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

  const WON_UNITS = useMemo(() => activeUnits.filter(u => u !== "Not Sure"), [activeUnits]);

  const handleStageSelect = (newStage: string) => {
    if (newStage === deal.stage) return;
    if (newStage === "Won") {
      const activePI = (deal as any).activeProformaInvoice;
      const piSubtotal = activePI?.taxableAmount ?? activePI?.subtotal;
      setWonAmount(piSubtotal ? String(piSubtotal) : deal.totalValue ? String(deal.totalValue) : "");
      setWonProductionUnit(deal.productionUnit || "");
      setWonProductionNotes("");
      setWonSalesNotes("");
      setMarkWonOpen(true);
      return;
    }
    if (newStage === "Lost") { setLostOpen(true); return; }
    if (newStage === "PI Sent") {
      const hasActivePI = !!(deal as any).activeProformaInvoice;
      if (!hasActivePI) {
        setPiSentDialogOpen(true);
        return;
      }
      doStageUpdate("PI Sent", null, null);
      return;
    }
    doStageUpdate(newStage, null, null);
  };

  const handleMarkWonCancel = () => {
    setMarkWonOpen(false);
    setWonAmount("");
    setWonProductionUnit("");
    setWonProductionNotes("");
    setWonSalesNotes("");
    setWonUnitReason("");
  };

  const handleMarkWonSubmit = async () => {
    const amount = Number(wonAmount);
    if (!wonAmount || isNaN(amount) || amount <= 0) {
      toast({ title: "Validation Error", description: "Won Amount must be greater than 0", variant: "destructive" });
      return;
    }
    if (!wonProductionUnit && !deal.productionUnit) {
      toast({ title: "Validation Error", description: "Production Unit is required", variant: "destructive" });
      return;
    }
    setWonSubmitting(true);
    try {
      const result = await customFetch<any>(`/deals/${dealId}/mark-won`, {
        method: "POST",
        body: JSON.stringify({
          wonAmount: amount,
          productionUnit: wonProductionUnit || deal.productionUnit,
          productionNotes: wonProductionNotes || null,
          salesNotes: wonSalesNotes || null,
          unitChangeReason: wonUnitReason || null,
        }),
      });
      setWonSubmitting(false);
      setMarkWonOpen(false);
      onDealChange(queryClient, dealId, contact?.id);
      onProductionChange(queryClient);
      toast({
        title: "Deal Won!",
        description: `Order ${result.orderNumber} created automatically. Production team notified.`,
      });

      // Trigger celebration
      const celebKey = `deal_won_celebrated_${dealId}`;
      if (!sessionStorage.getItem(celebKey) && localStorage.getItem("crm_dealWonCelebration") !== "off") {
        sessionStorage.setItem(celebKey, "true");
        setWonTodayCount(result.todayWonCount ?? 1);
        const dealData = { ...deal, id: dealId, contact, salesOwner: deal.salesOwner };
        setWonDealForCelebration(dealData);
      }
    } catch (err: any) {
      setWonSubmitting(false);
      toast({ title: "Error", description: err?.message || "Failed to mark deal as Won", variant: "destructive" });
    }
  };

  const doStageUpdate = (stage: string, reason: string | null, category: string | null) => {
    const data: any = { stage: stage as any, lostReason: reason };
    if (category) data.lostCategory = category;
    updateDeal.mutate({ id: dealId, data }, {
      onSuccess: () => {
        onDealChange(queryClient, dealId, contact?.id);
        toast({ title: `Deal moved to ${stage}` });
      },
      onError: (err: any) => {
        toast({ title: "Error updating stage", description: err?.data?.error || err?.message || "An error occurred", variant: "destructive" });
      },
    });
  };

  const handleLostSave = (data: { lostReason: string; otherReason: string; lostNotes: string; lostCategory?: string }) => {
    setLostSubmitting(true);
    updateDeal.mutate({ id: dealId, data: { stage: "Lost" as any, lostReason: data.lostReason, otherReason: data.otherReason, lostNotes: data.lostNotes, ...(data.lostCategory ? { lostCategory: data.lostCategory } : {}) } as any }, {
      onSuccess: () => {
        setLostSubmitting(false); setLostOpen(false);
        onDealChange(queryClient, dealId, contact?.id);
        toast({ title: "Deal marked as Lost" });
      },
      onError: (err: any) => {
        setLostSubmitting(false);
        toast({ title: "Error", description: err?.data?.error || err?.message || "Failed", variant: "destructive" });
      },
    });
  };

  const handleValueUpdate = (val: string) => {
    updateDeal.mutate({ id: dealId, data: { totalValue: val ? Number(val) : null } }, {
      onSuccess: () => onDealChange(queryClient, dealId, contact?.id),
    });
  };

  const handleChangeProductionUnit = async () => {
    if (!changeUnitValue) {
      toast({ title: "Error", description: "Select a production unit", variant: "destructive" });
      return;
    }
    setChangeUnitSubmitting(true);
    try {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/deals/${dealId}/change-production-unit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productionUnit: changeUnitValue, reason: changeUnitReason || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change unit");
      toast({ title: "Production Unit changed", description: `Changed to ${changeUnitValue}` });
      setChangeUnitOpen(false);
      setChangeUnitValue("");
      setChangeUnitReason("");
      onDealChange(queryClient, dealId, contact?.id);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to change unit", variant: "destructive" });
    } finally {
      setChangeUnitSubmitting(false);
    }
  };

  const handleAddProduct = () => {
    if (!prodId) return;
    addProduct.mutate({ id: dealId, data: { productId: Number(prodId), quantity: Number(prodQty), unitPrice: prodPrice ? Number(prodPrice) : null } }, {
      onSuccess: () => {
        onDealChange(queryClient, dealId, contact?.id);
        toast({ title: "Product added" });
        setProdDialogOpen(false); setProdId(""); setProdQty("1"); setProdPrice("");
      },
      onError: () => toast({ title: "Error adding product", variant: "destructive" }),
    });
  };

  const handleRemoveProduct = (dpId: number) => {
    removeProduct.mutate({ id: dealId, productId: dpId }, {
      onSuccess: () => { onDealChange(queryClient, dealId, contact?.id); toast({ title: "Product removed" }); },
    });
  };

  const handleEditActivity = () => {
    if (!editActivity) return;
    const payload: any = {};
    if (editActType !== editActivity.type) payload.type = editActType;
    if (editActNotes !== (editActivity.notes || "")) payload.notes = editActNotes || null;
    if (editActFollowUp !== (editActivity.followUpDate || "")) payload.followUpDate = editActFollowUp || null;
    if (editActFollowUpTime !== (editActivity.followUpTime || "")) payload.followUpTime = editActFollowUpTime || null;
    if (editActFollowType !== (editActivity.followUpType || "")) payload.followUpType = editActFollowType || null;
    if (editActStatus !== (editActivity.callStatus || "Pending")) payload.callStatus = editActStatus;
    if (Object.keys(payload).length === 0) { setEditDialogOpen(false); return; }
    updateActivity.mutate({ id: editActivity.id, data: payload }, {
      onSuccess: () => {
        onActivityChange(queryClient, dealId, contact?.id);
        toast({ title: "Activity updated" });
        setEditDialogOpen(false);
        setEditActivity(null);
      },
      onError: () => toast({ title: "Error updating activity", variant: "destructive" }),
    });
  };

  const handleDeleteActivity = () => {
    if (!deleteActId) return;
    deleteActivity.mutate({ id: deleteActId }, {
      onSuccess: () => {
        onActivityChange(queryClient, dealId, contact?.id);
        toast({ title: "Activity deleted" });
        setDeleteActId(null);
      },
      onError: () => toast({ title: "Error deleting activity", variant: "destructive" }),
    });
  };

  const handleCompleteActivity = (act: any) => {
    updateActivity.mutate({ id: act.id, data: { callStatus: "Completed" } }, {
      onSuccess: () => {
        onActivityChange(queryClient, dealId, contact?.id);
        toast({ title: "Activity marked as completed" });
      },
      onError: () => toast({ title: "Error completing activity", variant: "destructive" }),
    });
  };

  const openEditDialog = (act: any) => {
    setEditActivity(act);
    setEditActType(act.type);
    setEditActNotes(act.notes || "");
    setEditActFollowUp(act.followUpDate || "");
    setEditActFollowUpTime(act.followUpTime || "");
    setEditActFollowType(act.followUpType || "Call");
    setEditActStatus(act.callStatus || "Pending");
    setEditDialogOpen(true);
  };

  const canEditActivity = (act: any) => {
    if (!currentUser) return false;
    if (currentUser.role === "admin") return true;
    return currentUser.id === act.createdBy;
  };

  const handleFollowUpSave = () => {
    if (!fuNotes.trim()) { toast({ title: "Validation Error", description: "Follow-up notes are required", variant: "destructive" }); return; }
    if (!fuDate) { toast({ title: "Validation Error", description: "Follow-up date is required", variant: "destructive" }); return; }
    createActivity.mutate(
      { data: { dealId, type: "FollowUp" as any, notes: fuNotes.trim(), followUpDate: fuDate, followUpTime: fuTime || null, followUpType: fuType } },
      {
        onSuccess: () => {
          onActivityChange(queryClient, dealId, contact?.id);
          toast({ title: "Follow-up scheduled" });
          setFuDialogOpen(false); setFuNotes(""); setFuDate(""); setFuTime(""); setFuType("Call");
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      },
    );
  };

  const handleLogActivity = () => {
    const payload = { dealId, type: actType as any, notes: actNotes || null, followUpDate: actFollowUp || null, followUpTime: actFollowUpTime || null };
    createActivity.mutate({ data: payload }, {
      onSuccess: () => {
        onActivityChange(queryClient, dealId, contact?.id);
        toast({ title: "Activity logged" });
        setActDialogOpen(false); setActNotes(""); setActFollowUp(""); setActFollowUpTime("");
      },
      onError: () => {
        toast({ title: "Error", variant: "destructive" });
      },
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
        {contact && contact.category !== "My Client" && !contact.isMyClient && (
          <Button variant="outline" size="sm" onClick={() => setShowMoveCategory(true)}>
            <FolderTree className="h-4 w-4 mr-1" /> Move
          </Button>
        )}
        <Button
          variant="outline" size="sm"
          className="text-destructive border-destructive/40 hover:bg-destructive/10"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4 mr-1" /> Delete
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            {owner && <UserAvatar profilePhoto={owner.profilePhoto} name={owner.name} className="w-4 h-4 shadow-sm" />}
            <h1 className="text-2xl font-bold">{deal.title || `Deal #${deal.id}`}</h1>
            <CategoryBadge category={contact?.category} />
            <span className={`text-sm px-2.5 py-1 rounded-full font-medium ${STAGE_BADGE_COLORS[deal.stage] || "bg-gray-100"}`}>{deal.stage}</span>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${PI_STATUS_COLORS[(deal as any).activeProformaInvoice?.status || "No PI"] || PI_STATUS_COLORS["No PI"]}`}>
              PI: {(deal as any).activeProformaInvoice?.status || "No PI"}
              {(deal as any).activeProformaInvoice?.version > 1 ? ` v${(deal as any).activeProformaInvoice.version}` : ""}
            </span>
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
                  <SelectContent>{DEAL_STAGES.map(s => <SelectItem key={s} value={s}>{s} ({STAGE_PROBS[s]}%)</SelectItem>)}</SelectContent>
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
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Production Unit</Label>
                <div className="flex items-center gap-2">
                  <Badge variant={deal.productionUnit ? "secondary" : "outline"} className="text-xs">
                    {deal.productionUnit || PENDING_UNIT_ASSIGNMENT}
                  </Badge>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setChangeUnitValue(deal.productionUnit || ""); setChangeUnitReason(""); setChangeUnitOpen(true); }}>
                    Change
                  </Button>
                </div>
              </div>
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

          {/* Active Proforma Invoice */}
          {(deal as any).activeProformaInvoice && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Proforma Invoice</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Invoice</span>
                  <span className="font-medium font-mono">{(deal as any).activeProformaInvoice.invoiceNumber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PI_STATUS_COLORS[(deal as any).activeProformaInvoice.status] || "bg-gray-100 text-gray-600"}`}>
                    {(deal as any).activeProformaInvoice.status}
                  </span>
                </div>
                {(deal as any).activeProformaInvoice.version > 1 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Version</span>
                    <span className="font-medium">v{(deal as any).activeProformaInvoice.version}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium">₹{Number((deal as any).activeProformaInvoice.grandTotal).toLocaleString()}</span>
                </div>
                <Link href={`/proforma-invoices/${(deal as any).activeProformaInvoice.id}`}>
                  <Button size="sm" variant="outline" className="w-full mt-2">
                    <LinkIcon className="h-3.5 w-3.5 mr-1" /> View Invoice
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
          {!(deal as any).activeProformaInvoice && (
            <Card className="border-dashed border-gray-300">
              <CardContent className="py-4 text-center">
                <p className="text-xs text-muted-foreground">No active Proforma Invoice</p>
                <Link href={`/proforma-invoices${contact?.id ? `?contactId=${contact.id}` : ""}`}>
                  <Button size="sm" variant="ghost" className="mt-1 text-primary h-7 text-xs">
                    <Plus className="h-3 w-3 mr-1" /> Create
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {productionProgress && (
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  Production Status
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    productionProgress.status === "Completed" ? "bg-green-100 text-green-700" :
                    productionProgress.status === "Ready For Dispatch" ? "bg-blue-100 text-blue-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{productionProgress.status}</span>
                </div>
                {productionProgress.productionUnit && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Unit</span>
                    <span className="font-medium">{productionProgress.productionUnit}</span>
                  </div>
                )}
                {productionProgress.assignedProductionManager && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Manager</span>
                    <span className="font-medium">{productionProgress.assignedProductionManager.name}</span>
                  </div>
                )}
                {productionProgress.lastUpdatedBy && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Updated by</span>
                    <span className="text-xs">{productionProgress.lastUpdatedBy.name}</span>
                  </div>
                )}
                {productionProgress.notes?.length > 0 && (
                  <div className="pt-2 border-t border-blue-200">
                    <p className="text-xs text-muted-foreground mb-1">Latest Note:</p>
                    <p className="text-xs bg-white/60 p-2 rounded">{productionProgress.notes[0].note}</p>
                  </div>
                )}
                {productionProgress.invoiceNumber && (
                  <div className="flex items-center justify-between pt-2 border-t border-blue-200">
                    <span className="text-muted-foreground">Invoice</span>
                    <span className="text-xs font-mono">{productionProgress.invoiceNumber}</span>
                  </div>
                )}
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
              <Button size="sm" variant="outline" onClick={() => { setFuNotes(""); setFuDate(""); setFuTime(""); setFuType("Call"); setFuDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Follow-up
              </Button>
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
                        <SelectContent>{["WhatsApp","Call","Email"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Notes</Label><Textarea value={actNotes} onChange={e => setActNotes(e.target.value)} placeholder="Notes from this interaction..." /></div>
                    <div><Label>Next Follow-up Date</Label><Input type="date" value={actFollowUp} onChange={e => setActFollowUp(e.target.value)} /></div>
                    {actFollowUp && <div><Label>Follow-up Time</Label><Input type="time" value={actFollowUpTime} onChange={e => setActFollowUpTime(e.target.value)} /></div>}
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
                const style = ACT_STYLE[act.type] || { bg: "#f3f4f6", fg: "#374151", icon: "\u2022" };
                const isCompleted = act.callStatus === "Completed";
                return (
                  <div key={act.id} className={`flex gap-3 p-3 border rounded-lg bg-card text-sm ${isCompleted ? "border-green-200 bg-green-50/30" : ""}`}>
                    <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base" style={{ backgroundColor: style.bg }}>
                      {style.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: style.bg, color: style.fg }}>{act.type}</span>
                          {isCompleted && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Completed</span>
                          )}
                          {act.isEdited && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Edited</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(act.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                          {canEditActivity(act) && (
                            <>
                              <button
                                onClick={() => openEditDialog(act)}
                                className="h-6 w-6 rounded hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
                                title="Edit"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setDeleteActId(act.id)}
                                className="h-6 w-6 rounded hover:bg-red-50 flex items-center justify-center text-muted-foreground hover:text-red-600"
                                title="Delete"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {act.notes && <p className="text-muted-foreground mt-1.5">{act.notes}</p>}
                      {act.followUpDate && (
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-primary">Follow-up: {act.followUpDate}{act.followUpTime ? ` ${act.followUpTime}` : ""} via {act.followUpType}</p>
                          {!isCompleted && canEditActivity(act) && (
                            <button
                              onClick={() => handleCompleteActivity(act)}
                              className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200 font-medium"
                            >
                              <Check className="h-3 w-3 inline mr-0.5" />Complete
                            </button>
                          )}
                        </div>
                      )}
                      {act.updatedAt && (
                        <p className="text-xs text-muted-foreground mt-0.5">Last updated: {new Date(act.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                      )}
                      {act.user && (
                        <p className="text-xs text-muted-foreground mt-0.5">by {act.user.name}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deal.title || `Deal #${deal.id}`}"?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this deal and all its products and activity history. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              deleteDeal.mutate({ id: dealId }, {
                onSuccess: () => {
                  onDealChange(queryClient, dealId, contact?.id);
                  toast({ title: "Deal deleted" });
                  setLocation("/deals");
                },
                onError: () => toast({ title: "Failed to delete deal", variant: "destructive" }),
              });
            }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete Deal</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MoveCategoryDialog
        open={showMoveCategory}
        onOpenChange={setShowMoveCategory}
        contactIds={contact ? [contact.id] : []}
        currentCategory={contact?.category}
        onSuccess={() => onDealChange(queryClient, dealId, contact?.id)}
      />

      {/* Edit Activity Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Activity</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><Label>Type</Label>
              <Select value={editActType} onValueChange={setEditActType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Call","WhatsApp","Email","Note","FollowUp","Meeting"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={editActNotes} onChange={e => setEditActNotes(e.target.value)} placeholder="Notes from this interaction..." /></div>
            <div><Label>Follow-up Date</Label><Input type="date" value={editActFollowUp} onChange={e => setEditActFollowUp(e.target.value)} /></div>
            {editActFollowUp && <div><Label>Follow-up Time</Label><Input type="time" value={editActFollowUpTime} onChange={e => setEditActFollowUpTime(e.target.value)} /></div>}
            <div><Label>Follow-up Type</Label>
              <Select value={editActFollowType} onValueChange={setEditActFollowType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["Call","WhatsApp","Email"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Status</Label>
              <Select value={editActStatus} onValueChange={setEditActStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Pending","Completed","Cancelled"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleEditActivity} disabled={updateActivity.isPending} className="w-full">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Activity Confirmation */}
      <AlertDialog open={deleteActId !== null} onOpenChange={(open) => { if (!open) setDeleteActId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this activity?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteActId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteActivity} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mark Deal as Won Dialog */}
      <Dialog open={markWonOpen} onOpenChange={(open) => { if (!open) handleMarkWonCancel(); }}>
        <DialogContent className="sm:max-w-lg max-h-[calc(100vh-32px)] overflow-hidden grid-rows-[auto_1fr_auto] p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-green-700">Mark Deal as Won</DialogTitle>
            <DialogDescription>
              Create an Order and Production Order for <strong>{deal.title || `Deal #${deal.id}`}</strong>
              {contact ? ` — ${contact.name}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 overflow-y-auto min-h-0">
            <div>
              <Label className="text-sm font-medium">
                Won Value (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Enter won amount"
                value={wonAmount}
                onChange={(e) => setWonAmount(e.target.value)}
                autoFocus
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Auto-filled from Proforma Invoice subtotal (GST/freight excluded).
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">
                Production Unit <span className="text-destructive">*</span>
              </Label>
              {deal.productionUnit ? (
                <p className="text-xs text-muted-foreground mt-1 mb-1">
                  Pre-filled from Deal. You may change if needed.
                </p>
              ) : null}
              <Select
                value={wonProductionUnit || deal.productionUnit || ""}
                onValueChange={setWonProductionUnit}
                required={!deal.productionUnit}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select production unit" />
                </SelectTrigger>
                <SelectContent>
                  {WON_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Unit Assignment Reason (Optional)</Label>
              <Input
                value={wonUnitReason}
                onChange={(e) => setWonUnitReason(e.target.value)}
                placeholder="e.g. Customer requested Surat factory"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Logged in unit change history for audit trail
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Production Notes (Optional)</Label>
              <Textarea
                value={wonProductionNotes}
                onChange={(e) => setWonProductionNotes(e.target.value)}
                placeholder="Special production instructions (visible to Production Team & Admin only)"
                rows={3}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Examples: Blue Cap, Customer Logo, Urgent Production, Transparent Bottle, Special Packing
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">Sales Notes (Optional)</Label>
              <Textarea
                value={wonSalesNotes}
                onChange={(e) => setWonSalesNotes(e.target.value)}
                placeholder="Internal sales notes (visible to Sales Team & Admin only)"
                rows={2}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 px-6 py-4 border-t bg-background sticky bottom-0">
            <Button variant="outline" onClick={handleMarkWonCancel} disabled={wonSubmitting}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={handleMarkWonSubmit}
              disabled={wonSubmitting || !wonAmount || Number(wonAmount) <= 0 || (!wonProductionUnit && !deal.productionUnit)}
            >
              {wonSubmitting ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing...</>
              ) : (
                "Confirm — Mark as Won"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MarkLostDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        onSave={handleLostSave}
        saving={lostSubmitting}
        hideCategory={contact?.category === "My Client"}
      />

      {/* Regular Follow-up Dialog */}
      <Dialog open={fuDialogOpen} onOpenChange={setFuDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Regular Follow-up</DialogTitle><DialogDescription>Schedule a follow-up for this deal.</DialogDescription></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Follow-up Notes <span className="text-destructive">*</span></Label>
              <Textarea className="mt-1" placeholder="e.g. Waiting for client reply, Client asked to call next week..." value={fuNotes} onChange={e => setFuNotes(e.target.value)} />
            </div>
            <div>
              <Label>Next Follow-up Date <span className="text-destructive">*</span></Label>
              <Input type="date" className="mt-1" value={fuDate} onChange={e => setFuDate(e.target.value)} />
            </div>
            <div>
              <Label>Follow-up Time</Label>
              <Input type="time" className="mt-1" value={fuTime} onChange={e => setFuTime(e.target.value)} />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={fuType} onValueChange={setFuType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{["Call", "WhatsApp", "Email"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFuDialogOpen(false)} disabled={createActivity.isPending}>Cancel</Button>
            <Button onClick={handleFollowUpSave} disabled={createActivity.isPending || !fuNotes.trim() || !fuDate}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {wonDealForCelebration && (
        <DealWonCelebration
          deal={wonDealForCelebration}
          open
          todayWonCount={wonTodayCount}
          onClose={() => setWonDealForCelebration(null)}
          onViewOrder={() => { setLocation(`/deals/${wonDealForCelebration.id}`); setWonDealForCelebration(null); }}
          onGoToProduction={() => { setLocation("/production/orders"); setWonDealForCelebration(null); }}
        />
      )}

      <PiSentDialog
        open={piSentDialogOpen}
        onOpenChange={setPiSentDialogOpen}
        contactId={deal.contactId}
        dealId={deal.id}
      />

      {/* Change Production Unit Dialog */}
      <Dialog open={changeUnitOpen} onOpenChange={setChangeUnitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change Production Unit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-sm font-medium">Current Unit: <Badge variant="secondary">{deal.productionUnit || PENDING_UNIT_ASSIGNMENT}</Badge></Label>
            </div>
            <div>
              <Label className="text-sm font-medium">New Production Unit <span className="text-destructive">*</span></Label>
              <Select value={changeUnitValue} onValueChange={setChangeUnitValue}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select unit" />
                </SelectTrigger>
                <SelectContent>
                  {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT && u !== "Not Sure").map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium">Reason (Optional)</Label>
              <Input value={changeUnitReason} onChange={e => setChangeUnitReason(e.target.value)} placeholder="e.g. Customer requested different factory" className="mt-1" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setChangeUnitOpen(false)} disabled={changeUnitSubmitting}>Cancel</Button>
              <Button onClick={handleChangeProductionUnit} disabled={changeUnitSubmitting || !changeUnitValue}>
                {changeUnitSubmitting ? "Saving..." : "Change Unit"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
