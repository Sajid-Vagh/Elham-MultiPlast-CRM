import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay, useDraggable, useDroppable, closestCenter } from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { useListDeals, useListUsers, useGetMe, useUpdateDeal, getListDealsQueryKey } from "@workspace/api-client-react";
import type { Deal, DealStage } from "@workspace/api-client-react";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { CategoryBadge } from "@/components/category-badge";
import { useToast } from "@/hooks/use-toast";

const STAGES = ['New', 'CL Sent', 'Price Given', 'Samples Sent', 'Samples Received', 'PI Sent', 'Won', 'Lost'];

function DraggableCard({ deal, children }: { deal: Deal; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `deal-${deal.id}`,
    data: { deal },
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={style} className={isDragging ? 'opacity-50' : ''}>
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

  const { data: deals, isLoading } = useListDeals({
    unit: unitFilter || undefined,
  });
  const { data: users } = useListUsers();

  const updateDeal = useUpdateDeal();

  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [optimisticStages, setOptimisticStages] = useState<Record<number, string>>({});

  if (isLoading) return <div className="p-8">Loading...</div>;

  const ownerName = ownerFilter ? users?.find(u => u.id === Number(ownerFilter))?.name : null;
  const visibleStages = stageFilter ? STAGES.filter(s => s === stageFilter) : STAGES;

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

    setOptimisticStages(prev => ({ ...prev, [dealId]: newStage }));

    updateDeal.mutate(
      { id: dealId, data: { stage: newStage as DealStage } },
      {
        onSuccess: () => {
          setOptimisticStages(prev => { const n = { ...prev }; delete n[dealId]; return n; });
          queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() as any });
          toast({ title: `Deal moved to ${newStage}` });
        },
        onError: () => {
          setOptimisticStages(prev => { const n = { ...prev }; delete n[dealId]; return n; });
          toast({ title: "Failed to move deal", variant: "destructive" });
        },
      },
    );
  };

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
                        <Link href={`/deals/${deal.id}`}>
                          <div className="bg-card p-3 rounded shadow-sm border cursor-pointer hover:border-primary transition-colors">
                            <div className="flex justify-between items-start mb-2">
                              <span className="font-medium text-sm line-clamp-1">{deal.title || deal.contact?.name || 'Unnamed Deal'}</span>
                              {deal.salesOwner && (
                                <div
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: deal.salesOwner.colorCode || '#ccc' }}
                                  title={deal.salesOwner.name}
                                />
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {deal.contact?.companyName || deal.contact?.name}
                            </div>
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
                        </Link>
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
                  <span className="font-medium text-sm line-clamp-1">{activeDeal.title || activeDeal.contact?.name || 'Unnamed Deal'}</span>
                  {activeDeal.salesOwner && (
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: activeDeal.salesOwner.colorCode || '#ccc' }} />
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{activeDeal.contact?.companyName || activeDeal.contact?.name}</div>
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
    </div>
  );
}
