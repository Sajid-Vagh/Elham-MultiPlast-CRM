export const CATEGORIES = ["Regular Follow up", "Category A", "Category B", "Category C", "My Client", "Existing Client"] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  "Regular Follow up": "#6b7280",
  "Category A": "#60a5fa",
  "Category B": "#f59e0b",
  "Category C": "#a78bfa",
  "My Client": "#34d399",
  "Existing Client": "#0ea5e9",
};

export const CATEGORY_ICONS: Record<string, string> = {
  "Regular Follow up": "📋",
  "Category A": "📁",
  "Category B": "📁",
  "Category C": "📁",
  "My Client": "⭐",
  "Existing Client": "👥",
};
