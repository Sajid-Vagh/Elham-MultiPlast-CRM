const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function convertBelowThousand(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ones[n] + " ";
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "") + " ";
  return ones[Math.floor(n / 100)] + " Hundred " + convertBelowThousand(n % 100);
}

function convertCroresLakhs(n: number): string {
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000));
  let result = "";
  if (crore) result += convertBelowThousand(crore) + "Crore ";
  if (lakh) result += convertBelowThousand(lakh) + "Lakh ";
  if (thousand) result += convertBelowThousand(thousand) + "Thousand ";
  if (hundred) result += convertBelowThousand(hundred);
  return result.trim();
}

export function amountToWords(amount: number): string {
  if (amount === 0) return "Zero Rupees Only";
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let words = "Rupees " + (rupees ? convertCroresLakhs(rupees) : "Zero") + " Only";
  return words;
}
