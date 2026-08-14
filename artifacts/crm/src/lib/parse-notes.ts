// Shared utility to safely render activity notes.

// Notes may be stored as a JSON stringified array of
// { text, date, time, userName, userId } entries (edit history) OR as plain
// text. This helper returns ONLY the clean human-readable `text` values —
// the raw brackets, timestamps and usernames are hidden from the UI.
// If parsing fails, the string is returned as-is so the app never crashes.
export function parseNotesText(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const trimmed = notes.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return notes;
  }
  try {
    const parsed = JSON.parse(trimmed);
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
