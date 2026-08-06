export function customerLabel(name?: string | null, code?: string | null): string {
  const n = name || "-";
  if (code && !n.includes(code)) return `${n} (${code})`;
  return n;
}
