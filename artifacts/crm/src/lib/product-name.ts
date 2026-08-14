// Strip the appended "(weight, colour)" spec suffix from a stored product name
// for display. Legacy rows (and some sync paths) embed the variant details in
// the product name, e.g. "1L Elham shape (82g, Milky)" — the clean base name is
// "1L Elham shape", with weight/colour shown in their own columns instead.
export function cleanProductName(name: string | null | undefined): string {
  const raw = String(name || "").trim();
  if (!raw) return raw;

  let cleaned = raw
    // "(82g, Milky)", "(82g)", "(500ml, HDPE)" — a number followed by a
    // weight/capacity unit, optionally followed by a comma-separated suffix.
    .replace(/\(\s*\d+(?:\.\d+)?\s*(?:g|kg|ml|l|lt|ltrs?|lit(?:er|re)s?)\s*(?:,\s*[^)]*)?\)/gi, "")
    .trim();

  // Tidy up leftover whitespace / punctuation.
  cleaned = cleaned
    .replace(/\(\s*\)/g, "")
    .replace(/\([,\s]+/g, "(")
    .replace(/[,\s]+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;:]+$/g, "")
    .trim();

  return cleaned || raw;
}
