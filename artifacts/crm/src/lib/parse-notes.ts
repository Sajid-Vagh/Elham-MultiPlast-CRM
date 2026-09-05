// Shared utility to safely parse and render activity & follow-up notes.
//
// Notes may be stored as a JSON stringified array of { text, date, time, userName, userId }
// entries (edit history), as a JSON object, or as plain text.
// These helpers extract ONLY the clean human-readable text values — hiding raw JSON syntax,
// brackets, timestamps, and usernames from raw dumps.

function cleanExtract(item: unknown): string {
  if (item == null) return "";
  if (typeof item === "string") {
    const trimmed = item.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.startsWith("\"")) {
      try {
        const parsed = JSON.parse(trimmed);
        return cleanExtract(parsed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(item)) {
    return item.map(cleanExtract).filter(Boolean).join("\n");
  }
  if (typeof item === "object") {
    const o = item as Record<string, unknown>;
    const val = o.text ?? o.note ?? o.content ?? o.message ?? o.notes ?? o.description ?? o.comment ?? o.msg;
    if (val != null) {
      return cleanExtract(val);
    }
  }
  return String(item);
}

export function parseNotesText(notes: unknown): string | null {
  if (notes == null) return null;
  const result = cleanExtract(notes);
  return result.trim() ? result.trim() : null;
}

export const formatActivityNotes = parseNotesText;

export function parseNotesDisplay(notes: unknown, notesDisplay: unknown): string | null {
  return parseNotesText(notes) ?? parseNotesText(notesDisplay) ?? null;
}

export function parseNotesEntries(notes: unknown): string[] {
  if (notes == null) return [];
  let value: unknown = notes;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    for (let pass = 0; pass < 3 && typeof value === "string"; pass++) {
      const t = (value as string).trim();
      if (!t.startsWith("[") && !t.startsWith("{") && !t.startsWith("\"")) break;
      try {
        value = JSON.parse(t);
      } catch {
        break;
      }
    }
  }

  const out: string[] = [];
  const collect = (v: unknown) => {
    if (v == null) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s) {
        if (s.startsWith("[") || s.startsWith("{") || s.startsWith("\"")) {
          try {
            const parsed = JSON.parse(s);
            collect(parsed);
            return;
          } catch {}
        }
        out.push(s);
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(collect);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      const t = o.text ?? o.note ?? o.content ?? o.message ?? o.notes ?? o.description ?? o.comment ?? o.msg;
      if (t != null) {
        collect(t);
      }
    }
  };

  collect(value);
  return out;
}

export function formatDealNotes(notes: unknown): string | null {
  if (notes == null) return null;
  const entries = parseNotesEntries(notes);
  if (entries.length === 0) {
    return parseNotesText(notes);
  }
  if (entries.length === 1) {
    return entries[0]!;
  }
  return entries.map((text, index) => `Note ${index + 1}: ${text}`).join("\n");
}

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
