import type { Deal } from "@workspace/api-client-react";
import { CategoryBadge } from "@/components/category-badge";
import { Badge } from "@/components/ui/badge";

interface DealCardProps {
  deal: Deal;
}

export function DealCard({ deal }: DealCardProps) {
  return (
    <div className="bg-card p-3 rounded shadow-sm border transition-colors">
      <div className="flex justify-between items-start mb-2">
        <span className="font-medium text-sm line-clamp-1">
          {deal.title || deal.contact?.name || 'Unnamed Deal'}
        </span>
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
      {deal.totalValue != null && (
        <div className="mt-2 text-xs font-semibold text-primary">
          ₹{Number(deal.totalValue).toLocaleString()}
        </div>
      )}
    </div>
  );
}
