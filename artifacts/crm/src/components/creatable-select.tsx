import { useState, useEffect, useRef, useMemo } from "react";
import { Check, Plus } from "lucide-react";

interface CreatableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function CreatableSelect({ value, onChange, options, placeholder, className, disabled }: CreatableSelectProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter(o => o.toLowerCase().includes(q)) : options;
    return [...new Set(list)];
  }, [query, options]);

  const exactMatch = filtered.some(o => o.toLowerCase() === query.trim().toLowerCase());
  const isCustom = query.trim() !== "" && !exactMatch;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => () => {
    if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
  }, []);

  const selectValue = (val: string) => {
    onChange(val);
    setQuery(val);
    setOpen(false);
    setActiveIdx(-1);
  };

  const listLength = filtered.length + (isCustom ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); setActiveIdx(isCustom ? filtered.length : 0); return; }
      setActiveIdx(i => (i + 1) % Math.max(listLength, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); setActiveIdx(-1); return; }
      setActiveIdx(i => (i - 1 + Math.max(listLength, 1)) % Math.max(listLength, 1));
    } else if (e.key === "Enter") {
      if (open && activeIdx >= 0) {
        e.preventDefault();
        if (activeIdx < filtered.length) {
          const opt = filtered[activeIdx];
          if (opt) selectValue(opt);
        } else if (isCustom) {
          selectValue(query.trim());
        }
      } else if (query.trim()) {
        selectValue(query.trim());
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          const val = e.target.value;
          setQuery(val);
          setOpen(true);
          setActiveIdx(-1);
          onChange(val);
        }}
        onFocus={() => { setOpen(true); setActiveIdx(-1); }}
        onBlur={() => {
          blurTimerRef.current = window.setTimeout(() => {
            setOpen(false);
            setActiveIdx(-1);
          }, 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className || "flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground"}
      />
      {open && !disabled && (
        <div ref={dropdownRef} className="absolute z-50 mt-1 w-full max-h-40 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {filtered.length === 0 && !isCustom && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No options</div>
          )}
          {filtered.slice(0, 40).map((o, i) => (
            <button
              key={o}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectValue(o); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex items-center justify-between w-full px-3 py-1.5 text-sm text-left ${i === activeIdx ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
            >
              <span className="truncate">{o}</span>
              {value.toLowerCase() === o.toLowerCase() && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
          {isCustom && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectValue(query.trim()); }}
              onMouseEnter={() => setActiveIdx(filtered.length)}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left border-t ${activeIdx === filtered.length ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Use &quot;{query.trim()}&quot;</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
