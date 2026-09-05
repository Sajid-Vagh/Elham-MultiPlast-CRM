import { cn } from "@/lib/utils";
import { parseNotesText, parseNotesEntries } from "@/lib/parse-notes";

// Renders follow-up notes as individually numbered, visually separated blocks.
//
// - Stringified JSON arrays (single- or double-encoded) of { text, ... } entries
//   are parsed; EACH entry renders in its own dedicated block with sequential
//   "Note 1:", "Note 2:", ... numbering — never joined into one string.
// - Plain-text notes keep the legacy muted paragraph (whitespace preserved).
export function NoteList({ notes, className }: { notes?: any; className?: string }) {
  if (!notes) return null;
  const entries = parseNotesEntries(notes);

  if (entries.length > 1) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        {entries.map((entry, i) => (
          <div
            key={i}
            className="bg-orange-50 border-l-2 border-orange-300 rounded-r-md pl-2 pr-1.5 py-1"
          >
            <span className="font-semibold text-orange-700">Note {i + 1}:</span>{" "}
            <span className="font-medium text-foreground whitespace-pre-wrap">{entry}</span>
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 1) {
    return (
      <div className={cn("bg-orange-50 border-l-2 border-orange-300 rounded-r-md pl-2 pr-1.5 py-1", className)}>
        <span className="font-semibold text-orange-700">Note 1:</span>{" "}
        <span className="font-medium text-foreground whitespace-pre-wrap">{entries[0]}</span>
      </div>
    );
  }

  const cleanText = parseNotesText(notes);
  if (!cleanText) return null;
  return <p className={cn("text-muted-foreground whitespace-pre-wrap", className)}>{cleanText}</p>;
}
