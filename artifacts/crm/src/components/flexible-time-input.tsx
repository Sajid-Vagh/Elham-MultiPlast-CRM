import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ParsedTime {
  hours: number;
  minutes: number;
}

interface FlexibleTimeInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  error?: boolean;
}

function parseTime(input: string): ParsedTime | null {
  let s = (input || "").trim().toLowerCase();
  if (!s) return null;

  let isPM: boolean | null = null;
  const mer = s.match(/(am|pm)$/);
  if (mer) {
    isPM = mer[0] === "pm";
    s = s.slice(0, -mer[0].length).trim();
  }
  if (!s) return null;

  let hours: number;
  let minutes: number;
  const parts = s.split(":");
  if (parts.length === 2) {
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
  } else {
    const m = s.match(/^(\d{1,2})(\d{2})$/);
    if (!m) return null;
    hours = parseInt(m[1], 10);
    minutes = parseInt(m[2], 10);
  }

  if (isNaN(hours) || isNaN(minutes) || minutes < 0 || minutes > 59) return null;

  if (isPM !== null) {
    if (isPM && hours < 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  } else {
    if (hours > 23) return null;
  }

  if (hours < 0 || hours > 23) return null;
  return { hours, minutes };
}

function toHHMM(t: ParsedTime): string {
  return `${String(t.hours).padStart(2, "0")}:${String(t.minutes).padStart(2, "0")}`;
}

function toDisplay(t: ParsedTime): string {
  const h12 = t.hours % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(t.minutes).padStart(2, "0")} ${t.hours >= 12 ? "PM" : "AM"}`;
}

function toDisplayFromValue(value: string): string {
  const parsed = parseTime(value);
  return parsed ? toDisplay(parsed) : "";
}

export function FlexibleTimeInput({ value, onChange, className, placeholder, error }: FlexibleTimeInputProps) {
  const [text, setText] = useState(() => toDisplayFromValue(value));
  const focusedRef = useRef(false);
  const nativeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focusedRef.current) setText(toDisplayFromValue(value));
  }, [value]);

  const handleChange = (raw: string) => {
    setText(raw);
    const parsed = parseTime(raw);
    onChange(parsed ? toHHMM(parsed) : "");
  };

  const handleBlur = () => {
    focusedRef.current = false;
    const parsed = parseTime(text);
    setText(parsed ? toDisplay(parsed) : text);
  };

  const handleNativeChange = (v: string) => {
    setText(toDisplayFromValue(v));
    onChange(v);
  };

  return (
    <div className="relative">
      <Input
        value={text}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={handleBlur}
        placeholder={placeholder || "e.g. 05:05 PM or 17:05"}
        className={cn("pr-9", className, error && "border-destructive")}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => {
          if (nativeRef.current?.showPicker) {
            try { nativeRef.current.showPicker(); return; } catch { /* fall through */ }
          }
          nativeRef.current?.focus();
        }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 focus-visible:outline-none"
        title="Pick time"
        aria-label="Pick time"
      >
        <Clock className="h-4 w-4" />
      </button>
      <input
        ref={nativeRef}
        type="time"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        value={parseTime(value) ? value : ""}
        onChange={e => handleNativeChange(e.target.value)}
      />
    </div>
  );
}
