import { useDraggable } from "@dnd-kit/core";
import type { Deal } from "@workspace/api-client-react";
import { DealCard } from "./deal-card";

interface DraggableDealCardProps {
  deal: Deal;
  onClick: () => void;
}

export function DraggableDealCard({ deal, onClick }: DraggableDealCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `deal-${deal.id}`,
    data: { deal },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      style={style}
      className={`${isDragging ? 'opacity-50' : ''} cursor-grab active:cursor-grabbing hover:border-primary transition-colors`}
    >
      <DealCard deal={deal} />
    </div>
  );
}
