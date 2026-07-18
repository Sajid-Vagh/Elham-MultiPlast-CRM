import { useState, useMemo, type ReactNode } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable, closestCenter } from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { useListDeals, useListUsers, useGetMe, useUpdateDeal } from "@workspace/api-client-react";
import type { Deal, DealStage } from "@workspace/api-client-react";
import { useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { X, GripVertical, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { CategoryBadge } from "@/components/category-badge";
import { useToast } from "@/hooks/use-toast";
import { DEAL_STAGES } from "@/lib/deal-stages";
import DealDetailDrawer from "@/components/deal-detail-drawer";
import { MarkLostDialog } from "@/components/mark-lost-dialog";
import { DealWonCelebration } from "@/components/deal-won-celebration";
import { onDealChange, onProductionChange } from "@/lib/query-invalidation";
import { UserAvatar } from "@/components/user-avatar";
import { ExportDropdown } from "@/components/export-dropdown";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { useActiveUnits } from "@/lib/use-active-units";
import { PENDING_UNIT_ASSIGNMENT, isPendingUnit } from "@/lib/unit-constants";

const PI_STATUS_COLORS: Record<string, string> = {
  "No PI": "bg-gray-100 text-gray-500 border-gray-200",
  "Draft": "bg-slate-100 text-slate-600 border-slate-200",
  "Sent": "bg-blue-100 text-blue-600 border-blue-200",
  "Viewed": "bg-cyan-100 text-cyan-600 border-cyan-200",
  "Approved": "bg-green-100 text-green-600 border-green-200",
  "Rejected": "bg-red-100 text-red-600 border-red-200",
  "Expired": "bg-yellow-100 text-yellow-600 border-yellow-200",
  "Converted to Order": "bg-purple-100 text-purple-600 border-purple-200",
  "Converted to Production": "bg-purple-100 text-purple-600 border-purple-200",
};

function DraggableCard({ deal, children }: { deal: Deal; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `deal-${deal.id}`,
    data: { deal },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div ref={setNodeRef} style={style} className={`relative ${isDragging ? 'opacity-50' : ''}`}>
      <div {...listeners} {...attributes} className="absolute top-1 right-1 z-10 p-1 rounded cursor-grab active:cursor-grabbing hover:bg-muted transition-colors">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      {children}
    </div>
  );
}

function DroppableColumn({ stage, children }: { stage: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `stage-${stage}`,
    data: { stage },
  });
  return (
    <div
      ref={setNodeRef}
      className={`w-80 flex flex-col bg-muted/50 rounded-lg p-3 transition-all duration-200 ${
        isOver ? 'ring-2 ring-primary/40 bg-primary/5' : ''
      }`}
    >
      {children}
    </div>
  );
}

function CompletionBadge({ deal, visibility }: { deal: Deal; visibility: string }) {
  if (deal.stage !== "Won" && deal.stage !== "Lost") return null;
  if (!deal.completedAt) return null;

  const completedDate = new Date(deal.completedAt);
  const now = new Date();
  const diffMs = now.getTime() - completedDate.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let label: string;
  let variant: "default" | "secondary" | "outline" = "secondary";

  if (visibility === "forever") {
    label = deal.stage === "Won" ? "Won • Archived" : "Lost • Archived";
    variant = "outline";
  } else if (diffHours < 1) {
    label = deal.stage === "Won" ? "Won • Just now" : "Lost • Just now";
  } else if (diffHours < 24) {
    if (visibility !== "hide") {
      const maxHours = visibility === "3d" ? 72 : 24;
      const remaining = maxHours - diffHours;
      if (remaining > 0 && remaining <= 24) {
        label = deal.stage === "Won" ? `Won • Expires in ${remaining}h` : `Lost • Expires in ${remaining}h`;
      } else {
        label = deal.stage === "Won" ? `Won • ${diffHours}h ago` : `Lost • ${diffHours}h ago`;
      }
    } else {
      label = deal.stage === "Won" ? `Won • ${diffHours}h ago` : `Lost • ${diffHours}h ago`;
    }
  } else if (diffDays === 1) {
    label = deal.stage === "Won" ? "Won • Yesterday" : "Lost • Yesterday";
  } else {
    label = deal.stage === "Won" ? `Won • ${diffDays}d ago` : `Lost • ${diffDays}d ago`;
  }

  return (
    <Badge variant={variant} className={`text-[10px] px-1.5 py-0 ${deal.stage === "Won" ? "text-emerald-600 border-emerald-300" : "text-red-500 border-red-300"}`}>
      {deal.stage === "Won" ? <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> : <XCircle className="h-2.5 w-2.5 mr-0.5" />}
      {label}
    </Badge>
  );
}

export default function Deals() {
  const searchStr = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(searchStr);
  const stageFilter = params.get("stage") || "";
  const ownerFilter = params.get("owner") || "";
  const unitFilter = params.get("unit") || "";

  const { data: me } = useGetMe();
  const isAdmin = me?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { units: activeUnits } = useActiveUnits();

  // Completed deal visibility preference (from localStorage)
  const completedDealVisibility = (() => {
    const oldVal = localStorage.getItem("crm_showCompletedFor24Hours");
    if (oldVal === "on") {
      localStorage.setItem("crm_completedDealVisibility", "24h");
      localStorage.removeItem("crm_showCompletedFor24Hours");
    }
    return localStorage.getItem("crm_completedDealVisibility") || "24h";
  })();

  const { data: deals, isLoading } = useListDeals({
    unit: unitFilter || undefined,
    completedDealVisibility: completedDealVisibility as "hide" | "24h" | "3d" | "forever" | undefined,
  });
  const { data: users } = useListUsers();

  const updateDeal = useUpdateDeal();

  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [optimisticStages, setOptimisticStages] = useState<Record<number, string>>({});

  const [drawerDealId, setDrawerDealId] = useState<number | null>(null);

  // MARK WON dialog (single comprehensive dialog)
  const [markWonDeal, setMarkWonDeal] = useState<{ deal: Deal; oldStage: string } | null>(null);
  const [wonAmount, setWonAmount] = useState("");
  const [wonProductionUnit, setWonProductionUnit] = useState("");
  const [wonProductionNotes, setWonProductionNotes] = useState("");
  const [wonSalesNotes, setWonSalesNotes] = useState("");
  const [wonUnitReason, setWonUnitReason] = useState("");
  const [wonSubmitting, setWonSubmitting] = useState(false);
  const [wonDealForCelebration, setWonDealForCelebration] = useState<Deal | null>(null);
  const [wonTodayCount, setWonTodayCount] = useState(1);

  // Lost reason flow
  const [lostDeal, setLostDeal] = useState<Deal | null>(null);
  const [lostSubmitting, setLostSubmitting] = useState(false);

  // PI Sent flow
  const [piSentDeal, setPiSentDeal] = useState<Deal | null>(null);
  const [piSentLoading, setPiSentLoading] = useState(false);
  const [piSentExistingPi, setPiSentExistingPi] = useState(false);

  const WON_UNITS = useMemo(() => activeUnits.filter(u => u !== "Not Sure"), [activeUnits]);

  if (isLoading) return <div className="p-8">Loading...</div>;

  const ownerName = ownerFilter ? users?.find(u => u.id === Number(ownerFilter))?.name : null;
  const visibleStages = stageFilter ? DEAL_STAGES.filter(s => s === stageFilter) : DEAL_STAGES;

  const filteredDeals = (() => {
    let d = deals || [];
    if (ownerFilter) d = d.filter(d => d.salesOwnerId === Number(ownerFilter));
    d = d.map(deal => ({
      ...deal,
      stage: (optimisticStages[deal.id] ?? deal.stage) as DealStage,
    }));
    return d;
  })();

  const clearFilters = () => navigate("/deals");

  const handleMarkWonCancel = () => {
    if (markWonDeal) {
      setOptimisticStages(prev => { const n = { ...prev }; delete n[markWonDeal.deal.id]; return n; });
    }
    setMarkWonDeal(null);
    setWonAmount("");
    setWonProductionUnit("");
    setWonProductionNotes("");
    setWonSalesNotes("");
    setWonUnitReason("");
  };

  const handleMarkWonSubmit = async () => {
    if (!markWonDeal) return;
    const amount = Number(wonAmount);
    if (!wonAmount || isNaN(amount) || amount <= 0) {
      toast({ title: "Validation Error", description: "Won Amount must be greater than 0", variant: "destructive" });
      return;
    }
    if (!wonProductionUnit) {
      toast({ title: "Validation Error", description: "Production Unit is required", variant: "destructive" });
      return;
    }
    setWonSubmitting(true);
    try {
      const result = await customFetch<any>(`/deals/${markWonDeal.deal.id}/mark-won`, {
        method: "POST",
        body: JSON.stringify({
          wonAmount: amount,
          productionUnit: wonProductionUnit,
          productionNotes: wonProductionNotes || null,
          salesNotes: wonSalesNotes || null,
          unitChangeReason: wonUnitReason || null,
        }),
      });
      setWonSubmitting(false);
      setMarkWonDeal(null);
      setWonAmount("");
      setWonProductionUnit("");
      setWonProductionNotes("");
      setWonSalesNotes("");
      setWonUnitReason("");
      setOptimisticStages(prev => { const n = { ...prev }; delete n[markWonDeal.deal.id]; return n; });
      onDealChange(queryClient, markWonDeal.deal.id, markWonDeal.deal.contactId);
      onProductionChange(queryClient);
      toast({
        title: "Deal Won!",
        description: `Order ${result.orderNumber} created automatically. Production team notified.`,
      });

      // Trigger celebration
      const celebKey = `deal_won_celebrated_${markWonDeal.deal.id}`;
      if (!sessionStorage.getItem(celebKey) && localStorage.getItem("crm_dealWonCelebration") !== "off") {
        sessionStorage.setItem(celebKey, "true");
        setWonTodayCount(result.todayWonCount ?? 1);
        setWonDealForCelebration(markWonDeal.deal);
      }
    } catch (err: any) {
      setWonSubmitting(false);
      toast({ title: "Error", description: err?.message || "Failed to mark deal as Won", variant: "destructive" });
    }
  };

  const handleLostCancel = () => {
    if (lostDeal) {
      setOptimisticStages(prev => { const n = { ...prev }; delete n[lostDeal.id]; return n; });
    }
    setLostDeal(null);
  };

  const handleLostSave = (data: { lostReason: string; otherReason: string; lostNotes: string; lostCategory?: string }) => {
    if (!lostDeal) return;
    setLostSubmitting(true);
    updateDeal.mutate(
      { id: lostDeal.id, data: { stage: "Lost" as DealStage, lostReason: data.lostReason, otherReason: data.otherReason, lostNotes: data.lostNotes, ...(data.lostCategory ? { lostCategory: data.lostCategory } : {}) } as any },
      {
        onSuccess: () => {
          setLostSubmitting(false);
          setLostDeal(null);
          setOptimisticStages(prev => { const n = { ...prev }; delete n[lostDeal!.id]; return n; });
          onDealChange(queryClient, lostDeal!.id, lostDeal!.contactId);
          toast({ title: "Deal moved to Lost" });
        },
        onError: (err: any) => {
          setLostSubmitting(false);
          console.error("Lost save error:", err);
          toast({ title: "Error", description: err?.data?.error || err?.message || "Failed to mark deal as Lost", variant: "destructive" });
        },
      },
    );
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDeal(event.active.data.current?.deal as Deal ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDeal(null);
    if (!over) return;

    const dealId = Number((active.id as string).replace('deal-', ''));
    const newStage = over.data.current?.stage as string | undefined;
    const deal = active.data.current?.deal as Deal | undefined;
    const oldStage = deal?.stage as string | undefined;
    if (!newStage || !deal || !oldStage || oldStage === newStage) return;

    // Intercept WON drops — check for Proforma Invoice first (hard block if missing)
    if (newStage === "Won") {
      setOptimisticStages(prev => ({ ...prev, [dealId]: "Won" }));
      const token = localStorage.getItem("crm_token");
      fetch(`/api/proforma-invoices`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => res.ok ? res.json() : [])
        .then((allPIs: any[]) => {
          const hasPI = Array.isArray(allPIs) && allPIs.some((pi: any) => pi.dealId === dealId);
          if (!hasPI) {
            setOptimisticStages(prev => { const n = { ...prev }; delete n[dealId]; return n; });
            toast({ title: "Action Denied", description: "Please create a Proforma Invoice before marking this deal as Won.", variant: "destructive" });
            return;
          }
          setMarkWonDeal({ deal, oldStage });
          setWonAmount(deal.totalValue ? String(deal.totalValue) : "");
          setWonProductionUnit("");
          setWonProductionNotes("");
          setWonSalesNotes("");
        })
        .catch(() => {
          setOptimisticStages(prev => { const n = { ...prev }; delete n[dealId]; return n; });
          toast({ title: "Error", description: "Could not verify Proforma Invoice.", variant: "destructive" });
        });
      return;
    }

    // Intercept LOST drops — show reason dialog first
    if (newStage === "Lost") {
      setOptimisticStages(prev => ({ ...prev, [dealId]: "Lost" }));
      setLostDeal(deal);
      return;
    }

    // Intercept PI Sent drops — check for active Proforma Invoice
    if (newStage === "PI Sent") {
      setOptimisticStages(prev => ({ ...prev, [dealId]: "PI Sent" }));
      const hasActivePI = !!(deal as any).activeProformaInvoice;
      if (hasActivePI) {
        // Active PI exists → move deal directly, no popup
        updateDeal.mutate(
          { id: dealId, data: { stage: "PI Sent" as DealStage } },
          {
            onSuccess: () => {
              setOptimisticStages(prev => { const n = { ...prev }; delete n[dealId]; return n; });
              onDealChange(queryClient, dealId, deal?.contactId);
              toast({ title: "Deal moved to PI Sent" });
            },
            onError: (err: any) => {
              setOptimisticStages(prev => { const n = { ...prev }; delete n[dealId]; return n; });
              toast({ title: err?.data?.error || "Failed to move deal", variant: "destructive" });
            },
          },
        );
      } else {
        // No active PI → show Create PI popup
        setPiSentDeal(deal);
        setPiSentExistingPi(false);
        setPiSentLoading(false);
      }
      return;
    }

    setOptimisticStages(prev => ({ ...prev, [dealId]: newStage }));

    updateDeal.mutate(
      { id: dealId, data: { stage: newStage as DealStage } },
      {
        onSuccess: () => {
          setOptimisticStages(prev => { const n = { ...prev }; delete n[dealId]; return n; });
          onDealChange(queryClient, dealId, deal?.contactId);
          toast({ title: `Deal moved to ${newStage}` });
        },
        onError: () => {
          setOptimisticStages(prev => { const n = { ...prev }; delete n[dealId]; return n; });
          toast({ title: "Failed to move deal", variant: "destructive" });
        },
      },
    );
  };

  const dealName = markWonDeal?.deal.contact?.name || markWonDeal?.deal.title || "";

  return (
    <div className="p-8 h-full flex flex-col space-y-4">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-muted-foreground mt-1">Manage deals across stages.</p>
        </div>
        <ExportDropdown exportUrl="/api/exports/deals" filename="Pipeline_Deals" />
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {isAdmin && (
          <Select value={ownerFilter || "all"} onValueChange={(v) => {
            const sp = new URLSearchParams(searchStr);
            if (v === "all") sp.delete("owner");
            else sp.set("owner", v);
            navigate(`/deals?${sp.toString()}`);
          }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Owners</SelectItem>
              {users?.map(u => (
                <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={unitFilter || "all"} onValueChange={(v) => {
          const sp = new URLSearchParams(searchStr);
          if (v === "all") sp.delete("unit");
          else sp.set("unit", v);
          navigate(`/deals?${sp.toString()}`);
        }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Units" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Units</SelectItem>
            <SelectItem value={PENDING_UNIT_ASSIGNMENT}>Pending Unit</SelectItem>
            {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {(stageFilter || (isAdmin && ownerFilter) || unitFilter) && (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 px-4 py-2 rounded-lg shrink-0">
          <span className="text-sm font-medium text-muted-foreground">Showing:</span>
          {stageFilter && <Badge variant="secondary" className="text-xs">Stage: {stageFilter}</Badge>}
          {isAdmin && ownerFilter && ownerName && <Badge variant="secondary" className="text-xs">Owner: {ownerName}</Badge>}
          {unitFilter && <Badge variant="secondary" className="text-xs">Unit: {unitFilter}</Badge>}
          <Button variant="ghost" size="sm" onClick={clearFilters} className="ml-auto h-7 gap-1 text-muted-foreground">
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-x-auto">
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd} collisionDetection={closestCenter}>
          <div className="flex gap-4 h-full min-w-max pb-4">
            {visibleStages.map(stage => {
              const stageDeals = filteredDeals?.filter(d => d.stage === stage) || [];
              return (
                <DroppableColumn key={stage} stage={stage}>
                  <div className="flex justify-between items-center mb-3 px-1">
                    <h3 className="font-semibold text-sm">{stage}</h3>
                    <Badge variant="secondary" className="text-xs">{stageDeals.length}</Badge>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3">
                    {stageDeals.map(deal => (
                      <DraggableCard key={deal.id} deal={deal}>
                        <div
                          className="bg-card p-3 rounded shadow-sm border cursor-pointer hover:border-primary transition-colors"
                          onClick={() => setDrawerDealId(deal.id)}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <span className="font-medium text-sm line-clamp-1">{deal.contact?.name || deal.title || 'Unnamed'}</span>
                            {deal.salesOwner && (
                              <UserAvatar profilePhoto={deal.salesOwner.profilePhoto} name={deal.salesOwner.name} className="w-2.5 h-2.5 shrink-0" />
                            )}
                          </div>
                          {deal.contact?.companyName && (
                            <div className="text-xs text-muted-foreground mb-1">{deal.contact.companyName}</div>
                          )}
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <CategoryBadge category={deal.contact?.category} />
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{deal.contact?.unit || PENDING_UNIT_ASSIGNMENT}</Badge>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${PI_STATUS_COLORS[(deal as any).activeProformaInvoice?.status || "No PI"] || PI_STATUS_COLORS["No PI"]}`}>
                              {(deal as any).activeProformaInvoice?.status || "No PI"}
                              {(deal as any).activeProformaInvoice?.version > 1 ? ` v${(deal as any).activeProformaInvoice.version}` : ""}
                            </Badge>
                            <CompletionBadge deal={deal} visibility={completedDealVisibility} />
                          </div>
                          {deal.contact?.customerComments && (
                            <div className="mt-1 text-xs text-muted-foreground line-clamp-1" title={deal.contact.customerComments}>
                              {deal.contact.customerComments.length > 80
                                ? `${deal.contact.customerComments.slice(0, 80)}...`
                                : deal.contact.customerComments}
                            </div>
                          )}
                          {deal.totalValue != null && (
                            <div className="mt-2 text-xs font-semibold text-primary">
                              ₹{Number(deal.totalValue).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </DraggableCard>
                    ))}
                    {stageDeals.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">No deals</p>
                    )}
                  </div>
                </DroppableColumn>
              );
            })}
          </div>
          <DragOverlay>
            {activeDeal ? (
              <div className="bg-card p-3 rounded shadow-sm border opacity-80 rotate-[2deg] shadow-xl">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-medium text-sm line-clamp-1">{activeDeal.contact?.name || activeDeal.title || 'Unnamed'}</span>
                  {activeDeal.salesOwner && (
                    <UserAvatar profilePhoto={activeDeal.salesOwner.profilePhoto} name={activeDeal.salesOwner.name} className="w-2.5 h-2.5 shrink-0" />
                  )}
                </div>
                {activeDeal.contact?.companyName && (
                  <div className="text-xs text-muted-foreground mb-1">{activeDeal.contact.companyName}</div>
                )}
                <div className="mt-1 flex items-center gap-2">
                  <CategoryBadge category={activeDeal.contact?.category} />
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{activeDeal.contact?.unit || PENDING_UNIT_ASSIGNMENT}</Badge>
                </div>
                {activeDeal.contact?.customerComments && (
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-1">{activeDeal.contact.customerComments}</div>
                )}
                {activeDeal.totalValue != null && (
                  <div className="mt-2 text-xs font-semibold text-primary">₹{Number(activeDeal.totalValue).toLocaleString()}</div>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Mark Deal as Won Dialog — comprehensive single dialog */}
      <Dialog open={!!markWonDeal} onOpenChange={(open) => { if (!open) handleMarkWonCancel(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-green-700">Mark Deal as Won</DialogTitle>
            <DialogDescription>
              Create an Order and Production Order for <strong>{dealName}</strong>
              {markWonDeal?.deal.contact?.companyName && <> — {markWonDeal.deal.contact.companyName}</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
                Auto-filled from deal value. Edit if needed.
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">
                Production Unit <span className="text-destructive">*</span>
              </Label>
              <Select value={wonProductionUnit} onValueChange={setWonProductionUnit}>
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
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleMarkWonCancel} disabled={wonSubmitting}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={handleMarkWonSubmit}
              disabled={wonSubmitting || !wonAmount || Number(wonAmount) <= 0 || !wonProductionUnit}
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
        open={!!lostDeal}
        onOpenChange={(open) => { if (!open) handleLostCancel(); }}
        onSave={handleLostSave}
        saving={lostSubmitting}
        hideCategory={lostDeal?.contact?.category === "My Client"}
      />
      <DealDetailDrawer
        dealId={drawerDealId}
        open={drawerDealId !== null}
        onClose={() => setDrawerDealId(null)}
      />
      {wonDealForCelebration && (
        <DealWonCelebration
          deal={wonDealForCelebration}
          open
          todayWonCount={wonTodayCount}
          onClose={() => setWonDealForCelebration(null)}
          onViewOrder={() => { navigate(`/deals/${wonDealForCelebration.id}`); setWonDealForCelebration(null); }}
          onGoToProduction={() => { navigate("/production/orders"); setWonDealForCelebration(null); }}
        />
      )}

      {/* PI Sent Dialog — only shown when no active PI exists */}
      <Dialog open={!!piSentDeal} onOpenChange={(o) => { if (!o) { setPiSentDeal(null); setOptimisticStages(prev => { const n = { ...prev }; if (piSentDeal) delete n[piSentDeal.id]; return n; }); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proforma Invoice Required</DialogTitle>
            <DialogDescription>
              No active Proforma Invoice has been created for this Deal. Create one before moving to PI Sent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPiSentDeal(null); setOptimisticStages(prev => { const n = { ...prev }; if (piSentDeal) delete n[piSentDeal.id]; return n; }); }}>Cancel</Button>
            <Button onClick={() => {
              if (!piSentDeal) return;
              const contactId = piSentDeal.contactId || piSentDeal.contact?.id;
              setPiSentDeal(null);
              navigate(`/proforma-invoices${contactId ? `?contactId=${contactId}` : ""}`);
            }}>Create Proforma</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
