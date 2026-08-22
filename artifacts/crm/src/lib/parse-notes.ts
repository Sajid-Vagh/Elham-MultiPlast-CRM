// Shared utility to safely render activity notes.

// Notes may be stored as a JSON stringified array of
// { text, date, time, userName, userId } entries (edit history) OR as plain
// text. This helper returns ONLY the clean human-readable `text` values —
// the raw brackets, timestamps and usernames are hidden from the UI.
// If parsing fails, the string is returned as-is so the app never crashes.
export function parseNotesText(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const trimmed = notes.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{") && !trimmed.startsWith("\"")) {
    return notes;
  }
  try {
    const parsed = JSON.parse(trimmed);
    // Double-stringified JSON ('"[{\"text\":...}]"') parses to a string — recurse once more.
    if (typeof parsed === "string") {
      return parseNotesText(parsed);
    }
    if (Array.isArray(parsed)) {
      const texts = parsed
        .map((item: any) => {
          if (item == null) return "";
          if (typeof item === "string") return item;
          return item.text ?? item.note ?? item.content ?? "";
        })
        .filter(Boolean);
      return texts.join("\n");
    }
    if (parsed && typeof parsed === "object") {
      const t = parsed.text ?? parsed.note ?? parsed.content;
      if (t != null) return String(t);
    }
    return notes;
  } catch {
    return notes;
  }
}

// Alias for callers that want a descriptive name for the activity/comments feed
// formatting helper. Returns clean text only; never the raw JSON string.
export const formatActivityNotes = parseNotesText;

// Prefer the raw notes (clean text only) and fall back to the backend-formatted
// display string (which may include timestamps/usernames) only when raw notes
// are absent.
export function parseNotesDisplay(notes: string | null | undefined, notesDisplay: string | null | undefined): string | null {
  return parseNotesText(notes) ?? parseNotesText(notesDisplay) ?? null;
}

// Extract ONLY the clean text entries from a notes field. Plain text returns as
// a single-entry array; stringified JSON arrays of { text, date, time, userName,
// userId } entries are parsed (handles double-encoded JSON too) and each
// history entry's `text` is returned in stored order.
export function parseNotesEntries(notes: string | null | undefined): string[] {
  if (!notes) return [];
  let value: unknown = notes;
  for (let pass = 0; pass < 2 && typeof value === "string"; pass++) {
    const t = value.trim();
    if (!t.startsWith("[") && !t.startsWith("{") && !t.startsWith("\"")) break;
    try {
      value = JSON.parse(t);
    } catch {
      break;
    }
  }
  const out: string[] = [];
  const collect = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s) out.push(s);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(collect);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      collect(o.text ?? o.note ?? o.content ?? null);
    }
  };
  collect(value);
  return out;
}

// Deal/follow-up note rendering with sequential numbering: every entry parsed
// from a JSON-array notes field is prefixed with its position ("Note 1: ...",
// "Note 2: ..."), so a deal's progression reads in order and a brand-new deal's
// first note starts from 1. Plain-text notes are returned unchanged.
export function formatDealNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const trimmed = notes.trim();
  const looksLikeJson = trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.startsWith("\"");
  if (!looksLikeJson) {
    return parseNotesText(notes);
  }
  const entries = parseNotesEntries(notes);
  if (entries.length === 0) {
    return parseNotesText(notes);
  }
  return entries.map((text, index) => `Note ${index + 1}: ${text}`).join("\n");
}

// Strict ID-based uniqueness filter — guarantees each item is rendered exactly
// once, regardless of React StrictMode double-effects or duplicated payloads.
export function dedupeById<T extends { id?: number | string | null }>(items: T[]): T[] {
  const seen = new Set<number | string>();
  const out: T[] = [];
  for (const item of items) {
    if (item == null) continue;
    if (item.id == null) {
      out.push(item);
      continue;
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
