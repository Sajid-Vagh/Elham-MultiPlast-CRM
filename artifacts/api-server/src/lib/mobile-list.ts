import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { contactsTable } from "@workspace/db";

// Normalize a mobile number to its canonical last-10-digit form so comparisons
// are robust against formatting differences: "+91 98765 43210", "98765-43210",
// "09876543210" and "9876543210" all collapse consistently. Same convention as
// GET /deals/by-mobile.
export function normalizeMobileLast10(input: string): string {
  const digits = (input || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// SQL predicate for duplicate detection against contacts.mobile.
//
// The mobile column may store MULTIPLE comma-separated numbers
// ("1234567890, 0987654321"), so a plain equality match misses duplicates when
// the caller enters only ONE of the stored numbers. This predicate matches when
// ANY number entered by the caller equals ANY comma-separated entry of the
// stored value:
//   1. Both the input and the stored string are split on commas.
//   2. Each entry is trimmed and reduced to its last 10 digits before comparing,
//      so "+91 98765 43210" inside the list still matches input "9876543210".
//   3. Entries containing letters or with fewer than 10 digits are skipped — a
//      short entry can never equal a full 10-digit number anyway, and skipping
//      them prevents generated placeholder rows ("no-mobile-<n>-<timestamp>")
//      from colliding with real customers via their trailing timestamp digits.
//
// Non-phone inputs ("No Contact Number", "no-mobile-…", empty) fall back to the
// legacy exact equality so import placeholders behave exactly as before and can
// never false-match a real customer number.
//
// Note: this is deliberately NOT a naive `mobile ILIKE '%input%'` — substring
// matching produces boundary false positives (input "8765432109" matching a
// stored "198765432109").
export function contactMobileListMatches(rawInput: string): SQL {
  const raw = (rawInput || "").trim();
  const looksLikePhoneList = /^[\d+()\-\s.,]+$/.test(raw);
  const inputNumbers = looksLikePhoneList
    ? [...new Set(
        raw.split(",")
          .map(p => normalizeMobileLast10(p))
          .filter(n => n.length === 10),
      )]
    : [];

  if (inputNumbers.length === 0) {
    return sql`${contactsTable.mobile} = ${raw}`;
  }

  const comparisons = inputNumbers.map(
    n => sql`(right(regexp_replace(btrim(ml.part), '[^0-9]', '', 'g'), 10) = ${n})`,
  );

  return sql`EXISTS (
    SELECT 1
    FROM unnest(string_to_array(COALESCE(${contactsTable.mobile}, ''), ',')) AS ml(part)
    WHERE btrim(ml.part) !~ '[A-Za-z]'
      AND length(regexp_replace(btrim(ml.part), '[^0-9]', '', 'g')) >= 10
      AND (${sql.join(comparisons, sql` OR `)})
  )`;
}
