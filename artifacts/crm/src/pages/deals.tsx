import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable, closestCenter } from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { useListDeals, useListUsers, useGetMe, useUpdateDeal } from "@workspace/api-client-react";
import type { Deal, DealStage } from "@workspace/api-client-react";
import { useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { X, GripVertical } from "lucide-react";
import { CategoryBadge } from "@/components/category-badge";
import { useToast } from "@/hooks/use-toast";
import { DEAL_STAGES } from "@/lib/deal-stages";
import DealDetailDrawer from "@/components/deal-detail-drawer";
import { MarkLostDialog } from "@/components/mark-lost-dialog";
import { onDealChange } from "@/lib/query-invalidation";
import { UserAvatar } from "@/components/user-avatar";

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

  // Show completed deals for 24 hours setting (from localStorage)
  const showCompletedFor24Hours = localStorage.getItem("crm_showCompletedFor24Hours") === "on";

  const { data: deals, isLoading } = useListDeals({
    unit: unitFilter || undefined,
    showCompletedFor24Hours: showCompletedFor24Hours ? "true" : undefined,
  });
  const { data: users } = useListUsers();

  const updateDeal = useUpdateDeal();

  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [optimisticStages, setOptimisticStages] = useState<Record<number, string>>({});

  const [drawerDealId, setDrawerDealId] = useState<number | null>(null);

  // WON confirmation + amount flow
  const [confirmWonDeal, setConfirmWonDeal] = useState<{ deal: Deal; oldStage: string } | null>(null);
  const [wonDealRef, setWonDealRef] = useState<{ deal: Deal; oldStage: string } | null>(null);
  const [wonAmountOpen, setWonAmountOpen] = useState(false);
  const [wonAmount, setWonAmount] = useState("");
  const [wonNotes, setWonNotes] = useState("");
  const [wonSubmitting, setWonSubmitting] = useState(false);

  // Lost reason flow
  const [lostDeal, setLostDeal] = useState<Deal | null>(null);
  const [lostSubmitting, setLostSubmitting] = useState(false);

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

  const handleConfirmWonYes = () => {
    setWonDealRef(confirmWonDeal);
    setConfirmWonDeal(null);
    setWonAmount("");
    setWonNotes("");
    setWonAmountOpen(true);
  };

  const handleConfirmWonNo = () => {
    if (confirmWonDeal) {
      setOptimisticStages(prev => { const n = { ...prev }; delete n[confirmWonDeal.deal.id]; return n; });
    }
    setConfirmWonDeal(null);
  };

  const handleWonAmountSave = () => {
    if (!wonDealRef) return;
    const amount = Number(wonAmount);
    if (!wonAmount || isNaN(amount) || amount <= 0) {
      toast({ title: "Validation Error", description: "Won Amount must be greater than 0", variant: "destructive" });
      return;
    }
    setWonSubmitting(true);
    updateDeal.mutate(
      {
        id: wonDealRef.deal.id,
        data: {
          stage: "Won" as DealStage,
          wonAmount: amount,
          notes: wonNotes || null,
        },
      },
      {
        onSuccess: () => {
          setWonSubmitting(false);
          setWonAmountOpen(false);
          setWonDealRef(null);
          setConfirmWonDeal(null);
          setOptimisticStages(prev => { const n = { ...prev }; delete n[wonDealRef!.deal.id]; return n; });
          onDealChange(queryClient, wonDealRef!.deal.id, wonDealRef!.deal.contactId);
          toast({ title: "Deal moved to Won" });
        },
        onError: (err: any) => {
          setWonSubmitting(false);
          console.error("Won Amount save error:", err);
          toast({ title: "Error", description: err?.data?.error || err?.message || "Failed to mark deal as Won", variant: "destructive" });
        },
      },
    );
  };

  const handleWonAmountCancel = () => {
    if (wonDealRef) {
      setOptimisticStages(prev => { const n = { ...prev }; delete n[wonDealRef.deal.id]; return n; });
    }
    setWonAmountOpen(false);
    setWonDealRef(null);
    setConfirmWonDeal(null);
  };

  const handleLostCancel = () => {
    if (lostDeal) {
      setOptimisticStages(prev => { const n = { ...prev }; delete n[lostDeal.id]; return n; });
    }
    setLostDeal(null);
  };

  const handleLostSave = ({ lostReason, lostCategory }: { lostReason: string; lostCategory?: string }) => {
    if (!lostDeal) return;
    setLostSubmitting(true);
    updateDeal.mutate(
      { id: lostDeal.id, data: { stage: "Lost" as DealStage, lostReason, ...(lostCategory ? { lostCategory } : {}) } },
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

    // Intercept WON drops — show confirmation first
    if (newStage === "Won") {
      setOptimisticStages(prev => ({ ...prev, [dealId]: "Won" }));
      setConfirmWonDeal({ deal, oldStage });
      return;
    }

    // Intercept LOST drops — show reason dialog first
    if (newStage === "Lost") {
      setOptimisticStages(prev => ({ ...prev, [dealId]: "Lost" }));
      setLostDeal(deal);
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

  const dealName = wonDealRef?.deal.contact?.name || wonDealRef?.deal.title || confirmWonDeal?.deal.contact?.name || confirmWonDeal?.deal.title || "";

  return (
    <div className="p-8 h-full flex flex-col space-y-4">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-muted-foreground mt-1">Manage deals across stages.</p>
        </div>
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
            <SelectItem value="Himatnagar">Himatnagar</SelectItem>
            <SelectItem value="Rajkot">Rajkot</SelectItem>
            <SelectItem value="Surat">Surat</SelectItem>
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
                          <div className="mt-1 flex items-center gap-2">
                            <CategoryBadge category={deal.contact?.category} />
                            {deal.contact?.unit && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{deal.contact.unit}</Badge>
                            )}
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
                  {activeDeal.contact?.unit && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{activeDeal.contact.unit}</Badge>
                  )}
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

      {/* Confirm Deal Won Dialog */}
      <Dialog open={!!confirmWonDeal} onOpenChange={(open) => { if (!open) handleConfirmWonNo(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deal Won</DialogTitle>
            <DialogDescription>
              Are you sure you want to mark this deal as WON? This action will move the deal to My Clients and include it in revenue reports.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={handleConfirmWonNo}>No</Button>
            <Button onClick={handleConfirmWonYes}>Yes</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Won Amount Dialog */}
      <Dialog open={wonAmountOpen} onOpenChange={(open) => { if (!open) handleWonAmountCancel(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Won Amount</DialogTitle>
            <DialogDescription>
              Enter the deal amount for <strong>{dealName}</strong>
              {(wonDealRef?.deal.contact?.companyName) && <> — {wonDealRef.deal.contact.companyName}</>}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">
                Won Amount <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Enter amount"
                value={wonAmount}
                onChange={(e) => setWonAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <Input
                placeholder="Additional notes"
                value={wonNotes}
                onChange={(e) => setWonNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleWonAmountCancel} disabled={wonSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleWonAmountSave} disabled={wonSubmitting}>
              {wonSubmitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MarkLostDialog
        open={!!lostDeal}
        onOpenChange={(open) => { if (!open) handleLostCancel(); }}
        onSave={handleLostSave}
        saving={lostSubmitting}
        hideCategory={lostDeal?.contact?.isMyClient}
      />
      <DealDetailDrawer
        dealId={drawerDealId}
        open={drawerDealId !== null}
        onClose={() => setDrawerDealId(null)}
      />
    </div>
  );
}
