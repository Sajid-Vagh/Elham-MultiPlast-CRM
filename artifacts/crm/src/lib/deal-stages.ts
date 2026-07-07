export const DEAL_STAGES = ["New", "CL Sent", "Price Given", "Samples Sent", "Samples Received", "PI Sent", "Won", "Lost"] as const;

export type DealStageName = typeof DEAL_STAGES[number];

export const STAGE_PROBS: Record<string, number> = {
  "New": 10, "CL Sent": 40, "Price Given": 50, "Samples Sent": 60,
  "Samples Received": 60, "PI Sent": 90, "Won": 100, "Lost": 0,
};

export const STAGE_BADGE_COLORS: Record<string, string> = {
  "New": "bg-slate-100 text-slate-700", "CL Sent": "bg-blue-100 text-blue-700",
  "Price Given": "bg-yellow-100 text-yellow-700", "Samples Sent": "bg-orange-100 text-orange-700",
  "Samples Received": "bg-purple-100 text-purple-700", "PI Sent": "bg-indigo-100 text-indigo-700",
  "Won": "bg-green-100 text-green-700", "Lost": "bg-red-100 text-red-700",
};

export const STAGE_CHART_COLORS: Record<string, string> = {
  "New": "#94a3b8", "CL Sent": "#60a5fa", "Price Given": "#fbbf24",
  "Samples Sent": "#fb923c", "Samples Received": "#a78bfa", "PI Sent": "#818cf8",
  "Won": "#4ade80", "Lost": "#f87171",
};

export const LOST_REASONS = [
  "Product Not Manufactured",
  "Out of Business Scope",
  "Transportation Issue",
  "Price Issue",
  "Competitor Selected",
  "No Response",
  "Budget Issue",
  "Quality Issue",
  "Duplicate Inquiry",
  "Customer Not Interested",
  "Invalid / Incorrect Mobile Number",
  "Other",
] as const;
