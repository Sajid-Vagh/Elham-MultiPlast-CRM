import { CATEGORY_COLORS, CATEGORIES } from "@/lib/categories";
import { Badge } from "./ui/badge";

interface CategoryBadgeProps {
  category?: string | null;
  className?: string;
}

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  if (!category || !CATEGORIES.includes(category as any)) return null;
  return (
    <Badge
      className={`text-xs font-medium border-0 ${className || ""}`}
      style={{
        backgroundColor: `${CATEGORY_COLORS[category]}20`,
        color: CATEGORY_COLORS[category],
      }}
    >
      {category}
    </Badge>
  );
}
