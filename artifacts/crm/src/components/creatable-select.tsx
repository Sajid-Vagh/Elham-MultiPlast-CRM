import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const blurTimerRef = useRef<number | null>(null);

  // Sync the typed query with the incoming `value` (e.g. when an existing
  // invoice loads into the form) BEFORE paint so the saved colour is never
  // rendered as blank for a frame.
  useLayoutEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter(o => o.toLowerCase().includes(q)) : options;
    return [...new Set(list)];
  }, [query, options]);

  const exactMatch = filtered.some(o => o.toLowerCase() === query.trim().toLowerCase());
  const isCustom = query.trim() !== "" && !exactMatch;

  const menuHeight = Math.min(Math.max(filtered.length + (isCustom ? 1 : 0), 1) * 32 + 10, 176);

  // Position the menu at fixed viewport coordinates so it escapes any ancestor
  // with overflow:hidden/auto and flips upward when there isn't room below.
  const reposition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    const top = spaceBelow < menuHeight
      ? Math.max(4, rect.top - 4 - menuHeight)
      : rect.bottom + 4;
    setMenuPos({ top, left: rect.left, width: rect.width });
  }, [menuHeight]);

  useEffect(() => {
    if (!open) { setMenuPos(null); return; }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

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
      {open && !disabled && menuPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width, zIndex: 9999 }}
          className="max-h-44 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
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
        </div>,
        document.body
      )}
    </div>
  );
}
