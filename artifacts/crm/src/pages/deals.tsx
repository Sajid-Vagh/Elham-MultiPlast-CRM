import { useListDeals, useListUsers } from "@workspace/api-client-react";
import { Link, useSearch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

const STAGES = ['New', 'CL Sent', 'Price Given', 'Samples Sent', 'Samples Received', 'PI Sent', 'Won', 'Lost'];

export default function Deals() {
  const searchStr = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(searchStr);
  const stageFilter = params.get("stage") || "";
  const ownerFilter = params.get("owner") || "";

  const { data: deals, isLoading } = useListDeals();
  const { data: users } = useListUsers();

  if (isLoading) return <div className="p-8">Loading...</div>;

  const ownerName = ownerFilter ? users?.find(u => u.id === Number(ownerFilter))?.name : null;
  const visibleStages = stageFilter ? STAGES.filter(s => s === stageFilter) : STAGES;

  const filteredDeals = ownerFilter
    ? deals?.filter(d => d.salesOwnerId === Number(ownerFilter))
    : deals;

  const clearFilters = () => navigate("/deals");

  return (
    <div className="p-8 h-full flex flex-col space-y-4">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-muted-foreground mt-1">Manage deals across stages.</p>
        </div>
      </div>

      {(stageFilter || ownerFilter) && (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 px-4 py-2 rounded-lg shrink-0">
          <span className="text-sm font-medium text-muted-foreground">Showing:</span>
          {stageFilter && <Badge variant="secondary" className="text-xs">Stage: {stageFilter}</Badge>}
          {ownerFilter && ownerName && <Badge variant="secondary" className="text-xs">Owner: {ownerName}</Badge>}
          <Button variant="ghost" size="sm" onClick={clearFilters} className="ml-auto h-7 gap-1 text-muted-foreground">
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-4 h-full min-w-max pb-4">
          {visibleStages.map(stage => {
            const stageDeals = filteredDeals?.filter(d => d.stage === stage) || [];
            return (
              <div key={stage} className="w-80 flex flex-col bg-muted/50 rounded-lg p-3">
                <div className="flex justify-between items-center mb-3 px-1">
                  <h3 className="font-semibold text-sm">{stage}</h3>
                  <Badge variant="secondary" className="text-xs">{stageDeals.length}</Badge>
                </div>
                <div className="flex-1 overflow-y-auto space-y-3">
                  {stageDeals.map(deal => (
                    <Link key={deal.id} href={`/deals/${deal.id}`}>
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
                        {deal.totalValue != null && (
                          <div className="mt-2 text-xs font-semibold text-primary">
                            ₹{Number(deal.totalValue).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                  {stageDeals.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No deals</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
