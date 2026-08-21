const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return inrFormatter.format(Number.isFinite(n) ? n : 0);
}
