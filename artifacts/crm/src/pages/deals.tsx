import { useState } from "react";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { useQueryClient } from "@tanstack/react-query";
import { useListDeals, useListUsers, useGetMe, useUpdateDeal, useCreateActivity, getListDealsQueryKey } from "@workspace/api-client-react";
import type { Deal, DealStage } from "@workspace/api-client-react";
import { useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DroppableStageColumn } from "@/components/kanban/droppable-stage-column";
import { DraggableDealCard } from "@/components/kanban/draggable-deal-card";
import { DealCard } from "@/components/kanban/deal-card";

const STAGES = ['New', 'CL Sent', 'Price Given', 'Samples Sent', 'Samples Received', 'PI Sent', 'Won', 'Lost'];

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
  const createActivity = useCreateActivity();

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
          setOptimisticStages(prev => {
            const next = { ...prev };
            delete next[dealId];
            return next;
          });
          queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() as any });
          toast({ title: `Deal moved to ${newStage}` });

          createActivity.mutate({
            data: {
              dealId,
              contactId: deal.contactId,
              type: "Note",
              notes: `${me?.name ?? 'Someone'} moved deal from ${oldStage} to ${newStage}`,
            },
          });
        },
        onError: () => {
          setOptimisticStages(prev => {
            const next = { ...prev };
            delete next[dealId];
            return next;
          });
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
                <DroppableStageColumn key={stage} stage={stage}>
                  <div className="flex justify-between items-center mb-3 px-1">
                    <h3 className="font-semibold text-sm">{stage}</h3>
                    <Badge variant="secondary" className="text-xs">{stageDeals.length}</Badge>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-3">
                    {stageDeals.map(deal => (
                      <DraggableDealCard
                        key={deal.id}
                        deal={deal}
                        onClick={() => navigate(`/deals/${deal.id}`)}
                      />
                    ))}
                    {stageDeals.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">No deals</p>
                    )}
                  </div>
                </DroppableStageColumn>
              );
            })}
          </div>
          <DragOverlay>
            {activeDeal ? (
              <div className="opacity-80 rotate-[2deg] shadow-xl">
                <DealCard deal={activeDeal} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
