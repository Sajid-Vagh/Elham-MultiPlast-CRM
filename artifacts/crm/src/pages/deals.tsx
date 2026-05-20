import { useListDeals, useListUsers } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const STAGES = ['New', 'CL Sent', 'Price Given', 'Samples Sent', 'Samples Received', 'PI Sent', 'Won', 'Lost'];

export default function Deals() {
  const { data: deals, isLoading } = useListDeals();
  const { data: users } = useListUsers();

  if (isLoading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 h-full flex flex-col space-y-6">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-muted-foreground mt-1">Manage deals across stages.</p>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-4 h-full min-w-max pb-4">
          {STAGES.map(stage => {
            const stageDeals = deals?.filter(d => d.stage === stage) || [];
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
                            ₹{deal.totalValue.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Temporary Badge mockup for this file scope
function Badge({ children, className, variant }: any) {
  return <span className={`px-2 py-0.5 rounded-full bg-gray-200 text-gray-800 ${className}`}>{children}</span>;
}
