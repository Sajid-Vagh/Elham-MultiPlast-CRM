import { FilterX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGlobalFilters } from "@/lib/global-filters";

interface ClearFiltersButtonProps {
  onClear?: () => void;
  className?: string;
}

export function ClearFiltersButton({ onClear, className }: ClearFiltersButtonProps) {
  const { clearAllFilters, hasActiveFilters } = useGlobalFilters();

  if (!hasActiveFilters && !onClear) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-8 gap-1.5 text-xs font-medium ${className ?? ""}`}
      onClick={() => {
        clearAllFilters();
        onClear?.();
      }}
      title="Reset all global filters"
    >
      <FilterX className="h-3.5 w-3.5" />
      Clear Filters
    </Button>
  );
}
