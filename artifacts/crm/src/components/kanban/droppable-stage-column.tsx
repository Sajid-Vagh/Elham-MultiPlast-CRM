import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";

interface DroppableStageColumnProps {
  stage: string;
  children: ReactNode;
}

export function DroppableStageColumn({ stage, children }: DroppableStageColumnProps) {
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
