import { useState, useMemo, type ReactNode } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable, closestCenter } from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { useListDeals, useListUsers, useGetMe, useUpdateDeal } from "@workspace/api-client-react";
import type { Deal, DealStage } from "@workspace/api-client-react";
import { useSearch, useLocation } from "wouter";

// Extended deal type with backend-enriched fields
interface DealWithExtras extends Deal {
  dealProducts?: { dealId: number; productId: number; quantity: string; productName: string }[];
  piSummary?: { dealId: number; count: number; maxVersion: number; latestStatus: string } | null;
}
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { X, GripVertical, Loader2 } from "lucide-react";
import { CategoryBadge } from "@/components/category-badge";
import { useToast } from "@/hooks/use-toast";
import { DEAL_STAGES } from "@/lib/deal-stages";
import DealDetailDrawer from "@/components/deal-detail-drawer";
import { MarkLostDialog } from "@/components/mark-lost-dialog";
import { DealWonCelebration } from "@/components/deal-won-celebration";
import { onDealChange, onProductionChange } from "@/lib/query-invalidation";
import { ExportDropdown } from "@/components/export-dropdown";
import { PiSentDialog } from "@/components/pi-sent-dialog";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { useActiveUnits } from "@/lib/use-active-units";
import { PENDING_UNIT_ASSIGNMENT, isPendingUnit } from "@/lib/unit-constants";
import { VoiceRecorder } from "@/components/voice-recorder";
import { Mic } from "lucide-react";

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

function getDealTitle(deal: Deal, dealProducts?: { productName: string }[]): string {
  if (deal.title?.trim()) return deal.title.trim();
  if (dealProducts?.[0]?.productName) return dealProducts[0].productName;
  return "Untitled Deal";
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

  // Voice note state
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [voiceNoteBlob, setVoiceNoteBlob] = useState<Blob | null>(null);
  const [voiceNoteTranscript, setVoiceNoteTranscript] = useState("");
  const [voiceNoteDurationMs, setVoiceNoteDurationMs] = useState(0);
  const [voiceNoteId, setVoiceNoteId] = useState<number | null>(null);
  const [voiceNoteUploading, setVoiceNoteUploading] = useState(false);

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
    setShowVoiceRecorder(false);
    setVoiceNoteBlob(null);
    setVoiceNoteTranscript("");
    setVoiceNoteDurationMs(0);
    setVoiceNoteId(null);
  };

  const handleMarkWonSubmit = async () => {
    if (!markWonDeal) return;
    const amount = Number(wonAmount);
    if (!wonAmount || isNaN(amount) || amount <= 0) {
      toast({ title: "Validation Error", description: "Won Amount must be greater than 0", variant: "destructive" });
      return;
    }
    if (!wonProductionUnit && !markWonDeal?.deal.productionUnit) {
      toast({ title: "Validation Error", description: "Please select a Production Unit", variant: "destructive" });
      return;
    }
    setWonSubmitting(true);
    try {
      // Upload voice note first if recorded
      let finalVoiceNoteId = voiceNoteId;
      if (voiceNoteBlob && !voiceNoteId) {
        setVoiceNoteUploading(true);
        const formData = new FormData();
        formData.append("file", voiceNoteBlob, `voice-note-${Date.now()}.webm`);
        formData.append("dealId", String(markWonDeal.deal.id));
        if (voiceNoteTranscript) formData.append("transcript", voiceNoteTranscript);
        if (voiceNoteDurationMs) formData.append("durationMs", String(voiceNoteDurationMs));

        const token = localStorage.getItem("crm_token");
        const uploadRes = await fetch("/api/voice-notes", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!uploadRes.ok) throw new Error("Voice note upload failed");
        const uploadData = await uploadRes.json();
        finalVoiceNoteId = uploadData.id;
        setVoiceNoteId(uploadData.id);
        setVoiceNoteUploading(false);
      }

      const result = await customFetch<any>(`/deals/${markWonDeal.deal.id}/mark-won`, {
        method: "POST",
        body: JSON.stringify({
          wonAmount: amount,
          productionUnit: wonProductionUnit || markWonDeal.deal.productionUnit,
          productionNotes: wonProductionNotes || null,
          salesNotes: wonSalesNotes || null,
          unitChangeReason: wonUnitReason || null,
          voiceNoteId: finalVoiceNoteId || null,
        }),
      });
      setWonSubmitting(false);
      setMarkWonDeal(null);
      setWonAmount("");
      setWonProductionUnit("");
      setWonProductionNotes("");
      setWonSalesNotes("");
      setWonUnitReason("");
      setShowVoiceRecorder(false);
      setVoiceNoteBlob(null);
      setVoiceNoteTranscript("");
      setVoiceNoteDurationMs(0);
      setVoiceNoteId(null);
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
      setVoiceNoteUploading(false);
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

    // Intercept WON drops — validate Active Sent/Approved PI directly from backend
    if (newStage === "Won") {
      setOptimisticStages(prev => ({ ...prev, [dealId]: "Won" }));
      const token = localStorage.getItem("crm_token");
      fetch(`/api/deals/${dealId}/validate-won`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => res.json())
        .then((result: any) => {
          if (!result.valid) {
            setOptimisticStages(prev => { const n = { ...prev }; delete n[dealId]; return n; });
            toast({ title: "Action Denied", description: result.error || "This Deal requires an Active Sent/Approved Proforma Invoice before it can be marked Won.", variant: "destructive" });
            return;
          }
          setMarkWonDeal({ deal, oldStage });
          const piTaxable = result.pi?.taxableAmount;
          setWonAmount(piTaxable ? String(piTaxable) : deal.totalValue ? String(deal.totalValue) : "");
          setWonProductionUnit(deal.productionUnit || "");
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
                    {stageDeals.map(d => {
                      const deal = d as DealWithExtras;
                      const dealTitle = getDealTitle(deal, deal.dealProducts);
                      return (
                      <DraggableCard key={deal.id} deal={deal}>
                        <div
                          className="bg-card p-3 rounded shadow-sm border cursor-pointer hover:border-primary transition-colors"
                          onClick={() => setDrawerDealId(deal.id)}
                        >
                          <div className="font-semibold text-sm line-clamp-1 mb-1" title={dealTitle}>
                            {dealTitle}
                          </div>
                          <div className="text-xs text-muted-foreground line-clamp-1 mb-0.5" title={deal.contact?.name || ''}>
                            {deal.contact?.name || 'Unknown Customer'}
                          </div>
                          {deal.contact?.companyName && (
                            <div className="text-xs text-muted-foreground line-clamp-1 mb-1.5" title={deal.contact.companyName}>
                              {deal.contact.companyName}
                            </div>
                          )}
                          {!deal.contact?.companyName && <div className="mb-1.5" />}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <CategoryBadge category={deal.contact?.category} />
                            {(deal.productionUnit || deal.contact?.unit) && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {deal.productionUnit || deal.contact?.unit}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </DraggableCard>
                      );
                    })}
                    {stageDeals.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">No deals</p>
                    )}
                  </div>
                </DroppableColumn>
              );
            })}
          </div>
          <DragOverlay>
            {activeDeal ? (() => {
              const ad = activeDeal as DealWithExtras;
              const adTitle = getDealTitle(ad, ad.dealProducts);
              return (
              <div className="bg-card p-3 rounded shadow-sm border opacity-80 rotate-[2deg] shadow-xl">
                <div className="font-semibold text-sm line-clamp-1 mb-1" title={adTitle}>
                  {adTitle}
                </div>
                <div className="text-xs text-muted-foreground line-clamp-1 mb-0.5" title={ad.contact?.name || ''}>
                  {ad.contact?.name || 'Unknown Customer'}
                </div>
                {ad.contact?.companyName && (
                  <div className="text-xs text-muted-foreground line-clamp-1 mb-1.5" title={ad.contact.companyName}>
                    {ad.contact.companyName}
                  </div>
                )}
                {!ad.contact?.companyName && <div className="mb-1.5" />}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <CategoryBadge category={ad.contact?.category} />
                  {(ad.productionUnit || ad.contact?.unit) && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {ad.productionUnit || ad.contact?.unit}
                    </Badge>
                  )}
                </div>
              </div>
              );
            })() : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Mark Deal as Won Dialog — comprehensive single dialog */}
      <Dialog open={!!markWonDeal} onOpenChange={(open) => { if (!open) handleMarkWonCancel(); }}>
        <DialogContent className="sm:max-w-lg max-h-[calc(100vh-32px)] overflow-hidden grid-rows-[auto_1fr_auto] p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-green-700">Mark Deal as Won</DialogTitle>
            <DialogDescription>
              Create an Order and Production Order for <strong>{dealName}</strong>
              {markWonDeal?.deal.contact?.companyName && <> — {markWonDeal.deal.contact.companyName}</>}
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
                Auto-filled from Proforma Invoice subtotal (GST/freight excluded). Edit if needed.
              </p>
            </div>
            <div>
              <Label className="text-sm font-medium">
                Production Unit <span className="text-destructive">*</span>
              </Label>
              {markWonDeal?.deal.productionUnit ? (
                <p className="text-xs text-muted-foreground mt-1 mb-1">
                  Pre-filled from Deal. You may change if needed.
                </p>
              ) : null}
              <Select
                value={wonProductionUnit || markWonDeal?.deal.productionUnit || ""}
                onValueChange={setWonProductionUnit}
                required={!markWonDeal?.deal.productionUnit}
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
            <div className="border rounded-lg p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Mic className="h-3.5 w-3.5" /> Voice Note (Optional)
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Record a message for the Production team
                  </p>
                </div>
                {!showVoiceRecorder && !voiceNoteBlob && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowVoiceRecorder(true)}
                    className="text-xs gap-1"
                  >
                    <Mic className="h-3 w-3" /> Record
                  </Button>
                )}
                {voiceNoteBlob && !showVoiceRecorder && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-600 font-medium">✓ Voice note recorded</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setVoiceNoteBlob(null);
                        setVoiceNoteTranscript("");
                        setVoiceNoteDurationMs(0);
                      }}
                      className="text-xs text-destructive h-7"
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
              {showVoiceRecorder && (
                <div className="mt-2">
                  <VoiceRecorder
                    onRecordingComplete={(blob, transcript, durationMs) => {
                      setVoiceNoteBlob(blob);
                      setVoiceNoteTranscript(transcript);
                      setVoiceNoteDurationMs(durationMs);
                      setShowVoiceRecorder(false);
                    }}
                    onCancel={() => setShowVoiceRecorder(false)}
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 px-6 py-4 border-t bg-background sticky bottom-0">
            <Button variant="outline" onClick={handleMarkWonCancel} disabled={wonSubmitting}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={handleMarkWonSubmit}
              disabled={wonSubmitting || voiceNoteUploading || !wonAmount || Number(wonAmount) <= 0 || (!wonProductionUnit && !markWonDeal?.deal.productionUnit)}
            >
              {wonSubmitting || voiceNoteUploading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> {voiceNoteUploading ? "Uploading voice note..." : "Processing..."}</>
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
      <PiSentDialog
        open={!!piSentDeal}
        onOpenChange={(o) => { if (!o) { setPiSentDeal(null); setOptimisticStages(prev => { const n = { ...prev }; if (piSentDeal) delete n[piSentDeal.id]; return n; }); } }}
        contactId={piSentDeal?.contactId || piSentDeal?.contact?.id}
        dealId={piSentDeal?.id}
      />
    </div>
  );
}
