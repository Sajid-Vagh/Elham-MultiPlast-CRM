import { useState, useEffect } from "react";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getLabel, type DateFilterState } from "@/lib/use-date-filter";

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this-week", label: "This Week" },
  { key: "last-week", label: "Last Week" },
  { key: "this-month", label: "This Month" },
  { key: "last-month", label: "Last Month" },
  { key: "this-year", label: "This Year" },
  { key: "last-year", label: "Last Year" },
  { key: "custom", label: "Custom Range" },
  { key: "all", label: "All Time" },
];

interface DateRangeFilterProps {
  value: DateFilterState;
  onChange: (preset: string, customStart?: string | null, customEnd?: string | null) => void;
  className?: string;
}

export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(value.startDate || "");
  const [customEnd, setCustomEnd] = useState(value.endDate || "");

  useEffect(() => {
    setCustomStart(value.startDate || "");
    setCustomEnd(value.endDate || "");
  }, [value.startDate, value.endDate]);

  const isActive = value.preset !== "all";
  const formatRangeLabel = (d: string) => {
    const date = new Date(`${d}T00:00:00`);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };
  const label =
    value.preset === "custom" && value.startDate && value.endDate
      ? `${formatRangeLabel(value.startDate)} → ${formatRangeLabel(value.endDate)}`
      : getLabel(value.preset);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isActive ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 gap-1.5 text-xs font-medium",
            isActive && "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20",
            className,
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          <span>{label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                variant={value.preset === p.key ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => {
                  if (p.key === "custom") {
                    onChange("custom", value.startDate || null, value.endDate || null);
                    setOpen(true);
                  } else {
                    onChange(p.key);
                    setOpen(false);
                  }
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="border-t pt-2.5">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">Custom Range</div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-7 text-xs flex-1"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-7 text-xs flex-1"
              />
              <Button
                size="sm"
                className="h-7 text-xs px-2.5"
                disabled={!customStart || !customEnd}
                onClick={() => {
                  onChange("custom", customStart, customEnd);
                  setOpen(false);
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
