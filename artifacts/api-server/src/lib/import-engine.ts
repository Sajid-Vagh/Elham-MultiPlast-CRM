/**
 * Enterprise Import Engine — Multi-Layer Parser Pipeline
 *
 * Flow: Raw Text → Parser V1 → Parser V2 → Normalizer → Confidence → Preview
 * Each layer fills gaps left by the previous. Never crashes. Never loses data.
 */

import { db, contactsTable, productsTable, importSessionsTable, importCorrectionsTable, usersTable } from "@workspace/db";
import { eq, or, and, ilike, sql, desc } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedLead {
  clientName: string;
  clientMobile: string;
  email: string;
  city: string;
  state: string;
  companyName: string;
  requirement: string;
  quantity: string;
  address: string;
  gstNumber: string;
  bottleType: string;
  material: string;
  capacity: string;
  colour: string;
  weight: string;
  capType: string;
  design: string;
  industry: string;
  probableOrderValue: string;
  memberSince: string;
  buyerSearchNotes: string;
}

export type FieldConfidence = Record<string, number>;

export interface ImportPreview {
  parsedData: Partial<ParsedLead>;
  editedData: Partial<ParsedLead>;
  finalData: Partial<ParsedLead>;
  confidence: FieldConfidence;
  overallConfidence: number;
  parserVersion: string;
  duplicate: DuplicateInfo | null;
  suggestedCategory: string;
  suggestedProducts: ProductMatch[];
  rawText: string;
}

export interface DuplicateInfo {
  exists: boolean;
  contactId: number | null;
  customerName: string | null;
  companyName: string | null;
  mobile: string | null;
  email: string | null;
  ownerId: number | null;
  ownerName: string | null;
  unit: string | null;
  category: string | null;
  dealStage: string | null;
  status: string | null;
  lastFollowUp: string | null;
  createdAt: Date | null;
  matchType: string;
}

export interface ProductMatch {
  productId: number;
  name: string;
  category: string | null;
  materialType: string | null;
  matchScore: number;
  matchReason: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATE_ABBR_MAP: Record<string, string> = {
  "AP": "Andhra Pradesh", "AR": "Arunachal Pradesh", "AS": "Assam", "BR": "Bihar",
  "CG": "Chhattisgarh", "GA": "Goa", "GJ": "Gujarat", "HR": "Haryana",
  "HP": "Himachal Pradesh", "JH": "Jharkhand", "KA": "Karnataka", "KL": "Kerala",
  "MP": "Madhya Pradesh", "MH": "Maharashtra", "MN": "Manipur", "ML": "Meghalaya",
  "MZ": "Mizoram", "NL": "Nagaland", "OD": "Odisha", "OR": "Odisha",
  "PB": "Punjab", "RJ": "Rajasthan", "SK": "Sikkim", "TN": "Tamil Nadu",
  "TS": "Telangana", "TR": "Tripura", "UP": "Uttar Pradesh", "UK": "Uttarakhand",
  "UA": "Uttarakhand", "WB": "West Bengal", "AN": "Andaman & Nicobar",
  "CH": "Chandigarh", "DN": "Dadra & Nagar Haveli", "DD": "Daman & Diu",
  "DL": "Delhi", "LD": "Lakshadweep", "PY": "Puducherry",
};

const KNOWN_CITY_STATE_MAP: Record<string, string> = {
  "surat": "Gujarat", "ahmedabad": "Gujarat", "vadodara": "Gujarat", "baroda": "Gujarat",
  "rajkot": "Gujarat", "bhavnagar": "Gujarat", "jamnagar": "Gujarat", "anand": "Gujarat",
  "navsari": "Gujarat", "valsad": "Gujarat", "mehsana": "Gujarat", "gandhinagar": "Gujarat",
  "mumbai": "Maharashtra", "bombay": "Maharashtra", "pune": "Maharashtra",
  "nagpur": "Maharashtra", "thane": "Maharashtra", "nashik": "Maharashtra",
  "delhi": "Delhi", "new delhi": "Delhi",
  "jaipur": "Rajasthan", "jodhpur": "Rajasthan", "udaipur": "Rajasthan", "kota": "Rajasthan",
  "ajmer": "Rajasthan", "bikaner": "Rajasthan",
  "indore": "Madhya Pradesh", "bhopal": "Madhya Pradesh",
  "bangalore": "Karnataka", "bengaluru": "Karnataka",
  "chennai": "Tamil Nadu", "coimbatore": "Tamil Nadu",
  "kolkata": "West Bengal",
  "hyderabad": "Telangana",
  "lucknow": "Uttar Pradesh", "kanpur": "Uttar Pradesh", "noida": "Uttar Pradesh",
  "gurgaon": "Haryana", "gurugram": "Haryana", "faridabad": "Haryana",
  "amritsar": "Punjab", "ludhiana": "Punjab",
  "patna": "Bihar", "ranchi": "Jharkhand",
  "bhubaneswar": "Odisha",
  "guwahati": "Assam", "dehradun": "Uttarakhand", "shimla": "Himachal Pradesh",
  "panaji": "Goa",
};

const STATE_NAMES = new Set(Object.values(KNOWN_CITY_STATE_MAP).map(s => s.toLowerCase()));

const MATERIAL_KEYWORDS = /\b(hdpe|pp|pet|ldpe|lldpe|polycarbonate|pc|abs|pvc|ps|san|acrylic|nylon)\b/i;
const CAPACITY_KEYWORDS = /\b(\d+(?:\.\d+)?)\s*(ml|ltr|litre|liter|l|kg|g|gram|gm|ton|mt|oz|cl|dl)\b/i;
const BOTTLE_KEYWORDS = /\b(bottle|jar|can|drum|container|pail|crate|preform|cap|closure|lid|fitment|jerry\s*can|carboy|tank|pipe|fitting|tube|profile|film|sheet|rod|cable)\b/i;
const COLOUR_KEYWORDS = /\b(white|black|red|blue|green|yellow|orange|purple|pink|brown|grey|gray|silver|golden|transparent|natural|ivory|cream|navy|maroon|teal|cyan|magenta|olive|beige|peach|lavender|turquoise|indigo|violet|charcoal|copper|bronze|tan|rust|olive\s*green|sky\s*blue|sea\s*green|rose|wine|chocolate|coffee|sand|stone|pearl|matte|glossy|metallic|chromium|chrome|golden\s*yellow|light\s*blue|dark\s*blue|light\s*green|dark\s*green|light\s*grey|dark\s*grey|baby\s*pink|hot\s*pink)\b/i;
const WEIGHT_KEYWORDS = /\b(\d+(?:\.\d+)?)\s*(?:gram|gm|g|kg|kgs|mt|ton|oz)\b/i;
const DESIGN_KEYWORDS = /\b(square|round|oval|rectangle|rectangular|hexagonal|hexagonal|trapezoidal|cylindrical|conical|tapered|ribbed|smooth|textured|embossed|printed|labeled|matte|glossy|frosted|opaque|translucent|clear|crystal)\b/i;
const GST_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b/;

// ─── Parser V1 — Original Stable Parser ─────────────────────────────────────
// This is the exact same logic as the frontend parseIndiaMartMessage.
// DO NOT MODIFY — it's the proven baseline.

export function parserV1(raw: string): Partial<ParsedLead> {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const fullText = lines.join("\n");
  const result: Partial<ParsedLead> = {};

  // ── Mobile ──
  const mobilePatterns = [
    /click\s*to\s*call[:\s]*\+?91[-\s]?(\d{5})[-\s]?(\d{5})/i,
    /\+91[-\s]?(\d{5})[-\s]?(\d{5})/,
    /\+91(\d{10})/,
    /\b91([6-9]\d{9})\b/,
    /\b([6-9]\d{9})\b/,
  ];

  let mobileLineIdx = -1;
  for (let li = 0; li < lines.length; li++) {
    for (const pat of mobilePatterns) {
      const m = lines[li]!.match(pat);
      if (m) {
        let digits = m[0].replace(/[^\d]/g, "");
        if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
        if (digits.length === 10) {
          result.clientMobile = digits;
          mobileLineIdx = li;
          break;
        }
      }
    }
    if (mobileLineIdx >= 0) break;
  }

  if (mobileLineIdx >= 0) {
    const extraNums = lines[mobileLineIdx]!.match(/\b[6-9]\d{9}\b/g);
    if (extraNums) {
      const extras = extraNums
        .map(n => n.replace(/[^\d]/g, ""))
        .filter(n => n.length === 10 && n !== result.clientMobile);
      if (extras.length > 0) {
        result.clientMobile = [result.clientMobile!, ...extras].join(", ");
      }
    }
  }

  // ── Email ──
  const emailMatch = fullText.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) result.email = emailMatch[1]!.toLowerCase();

  // ── Name (4 strategies) ──
  let regardsIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^regards[,.]?\s*$/i.test(lines[i]!) || /^regards[,.:]\s+\S/i.test(lines[i]!)) {
      regardsIdx = i;
      break;
    }
  }
  if (regardsIdx >= 0) {
    const sameLineMatch = lines[regardsIdx]!.match(/^regards[,.:]\s+(.+)$/i);
    if (sameLineMatch) {
      const candidate = sameLineMatch[1]!.trim();
      if (!/click|call|email|@|\d{7,}/i.test(candidate)) result.clientName = candidate;
    } else {
      for (let i = regardsIdx + 1; i < Math.min(regardsIdx + 4, lines.length); i++) {
        let nameLine = lines[i]!.replace(/^tickicon\s*/i, "").trim();
        if (!nameLine || /click\s*to\s*call|email[:\s]|@|\+?91|\d{8,}|http/i.test(nameLine)) continue;
        if (/^[A-Za-z][A-Za-z\s.']{2,60}$/.test(nameLine)) {
          result.clientName = nameLine;
          break;
        }
      }
    }
  }

  if (!result.clientName) {
    for (const line of lines) {
      const m = line.match(/^(?:name|contact\s*person|buyer\s*name)[:\s]+(.+)$/i);
      if (m) {
        const candidate = m[1]!.trim();
        if (/^[A-Za-z][A-Za-z\s.']{2,60}$/.test(candidate)) {
          result.clientName = candidate;
          break;
        }
      }
    }
  }

  if (!result.clientName && mobileLineIdx >= 0) {
    for (let i = mobileLineIdx + 1; i < Math.min(mobileLineIdx + 3, lines.length); i++) {
      const candidate = lines[i]!.trim();
      if (candidate && /^[A-Za-z][A-Za-z\s.']{1,50}$/.test(candidate) &&
          !/click|call|email|@|http|india|gujarat|rajasthan|maharashtra|member|enquiry|buylead|details/i.test(candidate)) {
        result.clientName = candidate;
        break;
      }
    }
  }

  if (!result.clientName) {
    const nameSkipKw = /^(?:hi|dear|hello|regards|chat|enquiry|buylead|details|member|buyer|requirement|material|design|capacity|quantity|probable|click|email|mobile|phone|hdpe|pp|pet|ldpe|bottle|can|jar|drum|ltr|litr|piece|pcs)/i;
    for (let i = 0; i < Math.min(4, lines.length); i++) {
      const line = lines[i]!;
      if (/\d/.test(line) || /@/.test(line)) continue;
      if (/^[A-Za-z][A-Za-z\s.']{1,50}$/.test(line) && !nameSkipKw.test(line) && line.split(/\s+/).length <= 5) {
        result.clientName = line;
        break;
      }
    }
  }

  // Strategy 5: "Hi [Name]" / "Dear [Name]" / "Hello [Name]" format
  if (!result.clientName) {
    for (const line of lines) {
      const m = line.match(/^(?:hi|dear|hello|hey)\s+([A-Za-z][A-Za-z\s.']{1,50})$/i);
      if (m) {
        const candidate = m[1]!.trim();
        if (/^[A-Za-z][A-Za-z\s.']{2,50}$/.test(candidate) &&
            !/click|call|email|@|\d{7,}/i.test(candidate)) {
          result.clientName = candidate;
          break;
        }
      }
    }
  }

  // Strategy 6: Missed Call / Campaign enquiry
  if (!result.clientName) {
    for (let i = 0; i < lines.length; i++) {
      if (/^(?:missed\s+call|campaign|bulk\s+enquiry)/i.test(lines[i]!)) {
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const candidate = lines[j]!.trim();
          if (candidate && /^[A-Za-z][A-Za-z\s.']{2,50}$/.test(candidate) &&
              !/click|call|email|@|\d{7,}|http|mobile|phone/i.test(candidate)) {
            result.clientName = candidate;
            break;
          }
        }
        if (result.clientName) break;
      }
    }
  }

  // ── City & State (10+ patterns) ──
  const citySkip = /^(?:regards|email|mobile|phone|call|click|http|name|company|contact|please|dear|hi\b|i am|i'm|looking|kindly|india|gujarat|rajasthan|maharashtra|member)/i;
  const clean = (s: string) => s.trim().replace(/[.,;]+$/, "").trim();
  const knownStates = new Set(
    Object.keys(STATE_ABBR_MAP).map(k => k.toLowerCase()).concat(
    Object.values(STATE_ABBR_MAP).map(v => v.toLowerCase()))
  );

  for (const line of lines) {
    let m: RegExpMatchArray | null;
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?)\s*[-–]\s*\d{6}/);
    if (m && !citySkip.test(m[1]!.trim()) && !m[1]!.includes(",") && m[1]!.trim().split(" ").length <= 4) {
      result.city = clean(m[1]!);
      const st = line.match(/\d{6}\s*,\s*([A-Za-z\s]{2,30}?)(?:\s*,\s*India)?\s*$/i);
      if (st) result.state = expandState(clean(st[1]!));
      break;
    }
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?),\s*([A-Za-z\s]{2,30}),\s*India[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 3) {
      result.city = clean(m[1]!); result.state = expandState(clean(m[2]!)); break;
    }
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?),\s*([A-Za-z\s]{2,30})\s*[-–]\s*\d{6}/i);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 3) {
      result.city = clean(m[1]!); result.state = expandState(clean(m[2]!)); break;
    }
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?),\s*([A-Za-z\s]{2,30})[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && !citySkip.test(m[2]!.trim()) &&
        m[1]!.trim().split(" ").length <= 3 && m[2]!.trim().split(" ").length <= 3 && !/\d/.test(m[2]!)) {
      result.city = clean(m[1]!); result.state = expandState(clean(m[2]!)); break;
    }
    m = line.match(/^(?:location|city|place)[:\s]+([A-Za-z][A-Za-z\s]{1,25}?)[.,]?\s*$/i);
    if (m) { result.city = clean(m[1]!); break; }
    m = line.match(/.*,\s*([A-Za-z][A-Za-z\s]{1,30}),\s*([A-Za-z\s]{2,30}),\s*India[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && !/\d/.test(m[1]!) && !/\d/.test(m[2]!) &&
        m[1]!.trim().split(" ").length <= 4 && !result.city && !result.state) {
      result.city = clean(m[1]!); result.state = expandState(clean(m[2]!)); break;
    }
    m = line.match(/.*,\s*([A-Za-z][A-Za-z\s]{1,25}?)\s*[-–]\s*\d{6}\s*,\s*([A-Za-z\s]{2,30})(?:,\s*India)?[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 4 && !result.city && !result.state) {
      result.city = clean(m[1]!); result.state = expandState(clean(m[2]!)); break;
    }
    m = line.match(/(?:^|,\s*)city[:\s]+([A-Za-z][A-Za-z\s]{1,25}?)\s*[,;]\s*state[:\s]+([A-Za-z\s]{2,30})/i);
    if (m && !citySkip.test(m[1]!.trim()) && !result.city && !result.state) {
      result.city = clean(m[1]!); result.state = expandState(clean(m[2]!)); break;
    }
    m = line.match(/^(\d{6})\s*[-–]\s*([A-Za-z][A-Za-z\s]{1,25}?),\s*([A-Za-z\s]{2,30})[.,]?\s*$/);
    if (m && !citySkip.test(m[2]!.trim()) && m[2]!.trim().split(" ").length <= 3 && !result.city && !result.state) {
      result.city = clean(m[2]!); result.state = expandState(clean(m[3]!)); break;
    }
    m = line.match(/.*,\s*([A-Za-z][A-Za-z\s]{1,30}),\s*([A-Za-z\s]{2,30})[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && !/\d/.test(m[1]!) && !/\d/.test(m[2]!) &&
        m[1]!.trim().split(" ").length <= 4 && m[2]!.trim().split(" ").length <= 3 &&
        !result.city && !result.state && knownStates.has(m[2]!.trim().toLowerCase())) {
      result.city = clean(m[1]!); result.state = expandState(clean(m[2]!)); break;
    }
  }

  if (!result.city || !result.state) {
    for (const line of lines) {
      const cm = line.match(/^(?:city|location)[:\s]+([A-Za-z][A-Za-z\s]{1,25}?)$/i);
      if (cm && !result.city) result.city = clean(cm[1]!);
      const sm = line.match(/^(?:state|province)[:\s]+(.+)$/i);
      if (sm && !result.state) result.state = expandState(clean(sm[1]!));
      if (result.city && result.state) break;
    }
  }

  // ── Requirement (4 strategies) ──
  for (const line of lines) {
    let m = line.match(/i(?:'m|\s+am)\s+looking\s+for\s+(.+?)\.?\s*$/i);
    if (m) { result.requirement = m[1]!.trim(); break; }
    m = line.match(/i(?:\s+(?:want|need|require))\s+(?:to\s+purchase\s+|to\s+buy\s+)?(.+?)\.?\s*$/i);
    if (m) { result.requirement = m[1]!.trim(); break; }
    m = line.match(/we\s+(?:are\s+)?(?:looking\s+for|need|require)\s+(.+?)\.?\s*$/i);
    if (m) { result.requirement = m[1]!.trim(); break; }
  }

  if (!result.requirement) {
    let buyLeadIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^buylead\s+details\s*[:\-]?\s*$/i.test(lines[i]!)) { buyLeadIdx = i; break; }
    }
    if (buyLeadIdx >= 0) {
      const parts: string[] = [];
      for (let i = buyLeadIdx + 1; i < Math.min(buyLeadIdx + 5, lines.length); i++) {
        const l = lines[i]!;
        if (/^[A-Za-z][A-Za-z\s\/\(\)\-]{1,40}?[\s\t]*[:\t]/.test(l)) break;
        if (l && !/^buyer\s+searched/i.test(l)) parts.push(l);
      }
      if (parts.length > 0) result.requirement = parts.join(", ");
    }
  }

  if (!result.requirement) {
    for (const line of lines) {
      const m = line.match(/buyer\s+searched\s+for\s+(.+?)\.?\s*$/i);
      if (m) { result.requirement = m[1]!.trim(); break; }
    }
  }

  if (!result.requirement) {
    const contactSkip = /click|call|email|@|\+?91|\d{7,}|regards|member|since|buylead|details|india|http|pincode|probable|quantity|material|design/i;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!;
      if (l.length > 3 && l.length < 120 && !contactSkip.test(l) && !/^\d/.test(l)) {
        if (l !== result.city && l !== result.clientName) {
          result.requirement = l;
          break;
        }
      }
    }
  }

  // ── Table rows (Key : Value pairs) ──
  const skipTableKeys = /^(?:email|mobile|phone|call|regards|india|pincode|country|state|website|location|city|place|name|contact|buyer|address|verified|member|since)/i;
  const tableRows: string[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z\s\/\(\)\-]{1,40}?)\s*[:\t]+\s*(.{1,200})$/);
    if (m) {
      const key = m[1]!.trim();
      const val = m[2]!.trim();
      if (!skipTableKeys.test(key) && val.length > 0 && val.length < 200) {
        if (/^(?:company|firm|organisation|organization)\s*(?:name)?$/i.test(key)) {
          result.companyName = val;
        } else {
          tableRows.push(`${key}: ${val}`);
        }
      }
    }
  }
  if (tableRows.length > 0) {
    const base = result.requirement ? `${result.requirement}\n` : "";
    result.requirement = base + tableRows.join("\n");
  }

  // ── Quantity ──
  for (const line of lines) {
    let m = line.match(/(?:buyer\s+filled\s+details|quantity\s+required|quantity|qty|qnty)[:\s]+(.+)/i);
    if (m) { result.quantity = m[1]!.trim(); break; }
    m = line.match(/^(\d[\d,.]*\s*(?:liter|litre|l|kg|kgs|pcs|unit|units?|nos?|pieces?|ml|dozen|ton|mt|bags?|boxes?|carton|bottle)s?)\s*$/i);
    if (m && !result.quantity) { result.quantity = m[1]!.trim(); }
  }

  // ── GST ──
  const gstMatch = fullText.match(GST_PATTERN);
  if (gstMatch) result.gstNumber = gstMatch[0];

  // ── Address (multi-line extraction) ──
  const addrIdx = lines.findIndex(l => /^(?:address|addr|pickup\s*address|delivery\s*address|ship\s*to)[:\s]+/i.test(l));
  if (addrIdx >= 0) {
    const addrParts: string[] = [];
    const addrLine = lines[addrIdx]!.replace(/^(?:address|addr|pickup\s*address|delivery\s*address|ship\s*to)[:\s]+/i, "").trim();
    if (addrLine) addrParts.push(addrLine);
    for (let i = addrIdx + 1; i < Math.min(addrIdx + 4, lines.length); i++) {
      if (/^[A-Za-z][A-Za-z\s\/\(\)\-]{1,40}?[\s\t]*[:\t]/.test(lines[i]!)) break;
      if (lines[i] && !/^buyer\s+searched/i.test(lines[i]!)) addrParts.push(lines[i]!);
    }
    if (addrParts.length > 0) result.address = addrParts.join(", ");
  }

  // ── Member Since ──
  const memberMatch = fullText.match(/member\s+since[:\s]*(.+?)(?:\n|$)/i);
  if (memberMatch) result.memberSince = memberMatch[1]!.trim();

  // ── Probable Order Value ──
  const valueMatch = fullText.match(/(?:probable|estimated|order)\s*(?:order\s*)?value[:\s]*(.+?)(?:\n|$)/i);
  if (valueMatch) result.probableOrderValue = valueMatch[1]!.trim();

  return result;
}

// ─── Helper: strip company helper text ──────────────────────────────────────
// Removes IndiaMART boilerplate from company names. Keeps business suffixes
// like "Private Limited", "Industries", "Enterprises" intact.

const COMPANY_HELPER_PATTERNS = [
  /\s*\(GST\s+verified\s+by\s+IndiaMART\)/gi,
  /\s*\(?\s*Verified\s+Supplier\s*\)?/gi,
  /\s*\(?\s*Verified\s+Manufacturer\s*\)?/gi,
  /\s*\(?\s*Verified\s+Exporter\s*\)?/gi,
  /\s*\(?\s*Member\s+Since\s+\d{4}\s*\)?/gi,
  /\s*\(?\s*Member\s+Since\s*\)?/gi,
  /\s*Products?\s+of\s+Interest[:\s]*/gi,
  /\s*Sells?:/gi,
  /\s*Click\s+to\s+Call/gi,
  /\s*Regards[,.]?\s*$/gi,
  /,\s*Click\s+to\s+Call/gi,
  /\s*\(?\s*GST\s+No\.?\s*\)?/gi,
  /\s*GSTIN[:\s]*[A-Z0-9]{15}/gi,
];

function stripCompanyHelperText(raw: string): string {
  let cleaned = raw.trim();
  for (const pat of COMPANY_HELPER_PATTERNS) {
    cleaned = cleaned.replace(pat, "");
  }
  return cleaned.replace(/[.,;]+$/, "").trim();
}

// ─── Helper: structural company detection ───────────────────────────────────
// After customer name is found, check the next non-empty line.
// If it's NOT a known IndiaMART keyword, treat it as Company Name.
// Returns the company name (stripped of helper text) or null.

const COMPANY_SKIP_KEYWORDS = /^(?:click\s+to\s+call|email|mobile|phone|call|regards|hi\b|dear|hello|member\s+since|buylead\s+details|quantity|capacity|material|design|requirement|probable|products?\s+of\s+interest|sells?:|enquiry|buyer|looking|address|city|state|location|pincode|country|india|http|www|verified|trade|indiamart|tickicon)/i;

function detectCompanyStructurally(
  lines: string[],
  nameLineIdx: number,
  mobileIdx: number,
  emailIdx: number,
): { company: string; confidence: number } | null {
  if (nameLineIdx < 0) return null;

  // Look at the 1-3 lines after the customer name
  for (let i = nameLineIdx + 1; i < Math.min(nameLineIdx + 4, lines.length); i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    // Skip if this line is the mobile/email we already found
    if (mobileIdx >= 0 && i === mobileIdx) continue;
    if (emailIdx >= 0 && i === emailIdx) continue;

    // Skip known keywords
    if (COMPANY_SKIP_KEYWORDS.test(line)) return null;

    // Skip lines that are purely digits (mobile/pincode)
    if (/^\d{5,}$/.test(line)) return null;

    // Skip lines with @ (email)
    if (/@/.test(line)) return null;

    // Skip lines starting with +91 or long digit sequences (mobile)
    if (/^\+?91/.test(line) || /^\d{10,}/.test(line)) return null;

    // Skip lines that look like addresses (contain pincode patterns with many words)
    if (/\d{6}/.test(line) && line.split(/\s+/).length > 5) return null;

    // Pattern: "Company City - 382350, GJ" or "Company Gandhinagar - 382305, GJ"
    const compCityMatch = line.match(/^(.+?)\s+([A-Za-z][A-Za-z\s]{1,20}?)\s*[-–]\s*\d{6}/);
    if (compCityMatch) {
      const companyPart = stripCompanyHelperText(compCityMatch[1]!);
      if (companyPart.length >= 2 && !COMPANY_SKIP_KEYWORDS.test(companyPart)) {
        const isGstVerified = /\(?\s*GST\s+verified\s+by\s+IndiaMART\s*\)?/i.test(line);
        return { company: companyPart, confidence: isGstVerified ? 100 : 95 };
      }
    }

    // Pattern: "Company, City..." or "Company, Palanpur..."
    const compCommaMatch = line.match(/^(.+?),\s*([A-Za-z][A-Za-z\s]{1,25})[.,]?\s*$/);
    if (compCommaMatch) {
      const companyPart = stripCompanyHelperText(compCommaMatch[1]!);
      if (companyPart.length >= 2 && !COMPANY_SKIP_KEYWORDS.test(companyPart) && !/^\d/.test(companyPart)) {
        const isGstVerified = /\(?\s*GST\s+verified\s+by\s+IndiaMART\s*\)?/i.test(line);
        return { company: companyPart, confidence: isGstVerified ? 100 : 95 };
      }
    }

    // Plain company line (no city/pincode)
    const cleaned = stripCompanyHelperText(line);
    if (cleaned.length < 2) return null;

    const isGstVerified = /\(?\s*GST\s+verified\s+by\s+IndiaMART\s*\)?/i.test(line);
    return { company: cleaned, confidence: isGstVerified ? 100 : 95 };
  }
  return null;
}

// ─── Parser V2 — Heuristic Parser ──────────────────────────────────────────
// Catches fields V1 misses: product specs, GST, address, multi-format layouts.
// Uses structural analysis, not just regex.

export function parserV2(raw: string, v1Result: Partial<ParsedLead>): Partial<ParsedLead> {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const fullText = lines.join("\n");
  const result: Partial<ParsedLead> = { ...v1Result };

  // ── Extract GST if V1 missed it ──
  if (!result.gstNumber) {
    const gstMatch = fullText.match(GST_PATTERN);
    if (gstMatch) result.gstNumber = gstMatch[0];
  }

  // ── Extract Company from labeled patterns (Company: XYZ, Firm: ABC) ──
  if (!result.companyName) {
    for (const line of lines) {
      const m = line.match(/(?:^|,\s*)(?:company|firm|organisation|organization|business)\s*(?:name)?[:\s]+([A-Za-z][A-Za-z\s&.,' Pvt\. Ltd LLP Inc Corp]{2,60})/i);
      if (m) { result.companyName = m[1]!.trim(); break; }
    }
  }

  // ── Extract Company from keyword patterns (Pvt Ltd, Industries, etc.) ──
  if (!result.companyName) {
    for (const line of lines) {
      if (/\b(pvt\s*ltd|ltd|llp|inc|corp|llc|co\.|company|industries|enterprises|manufacturing|traders?|supplier|distributor)\b/i.test(line) &&
          line.length < 80 && !/click|call|email|@|http/i.test(line)) {
        result.companyName = stripCompanyHelperText(line);
        break;
      }
    }
  }

  // ── Structural company detection (line after customer name) ──
  // Catches Formats 1-4: company appears on its own line right after the name.
  if (!result.companyName && result.clientName) {
    let nameLineIdx = -1;
    if (result.clientName) {
      nameLineIdx = lines.findIndex(l => l.trim() === result.clientName!.trim());
    }
    let mobileIdx = -1;
    let emailIdx = -1;
    if (result.clientMobile) {
      mobileIdx = lines.findIndex(l => l.includes(result.clientMobile!.slice(0, 6)));
    }
    if (result.email) {
      emailIdx = lines.findIndex(l => l.toLowerCase().includes(result.email!.slice(0, 5)));
    }

    const detected = detectCompanyStructurally(lines, nameLineIdx, mobileIdx, emailIdx);
    if (detected) {
      result.companyName = detected.company;
    }
  }

  // ── Extract Requirement from "Requirement:" label ──
  if (!result.requirement) {
    for (const line of lines) {
      const m = line.match(/^(?:requirement|product\s+required|looking\s+for|enquiry\s+for|buying\s+for)[:\s]+(.+)$/i);
      if (m) { result.requirement = m[1]!.trim(); break; }
    }
  }

  // ── Product Spec Extraction (bottle type, material, capacity, colour, weight) ──
  const fullLower = fullText.toLowerCase();

  if (!result.material) {
    const matMatch = fullLower.match(MATERIAL_KEYWORDS);
    if (matMatch) result.material = matMatch[1]!.toUpperCase();
  }

  if (!result.capacity) {
    const capMatch = fullText.match(CAPACITY_KEYWORDS);
    if (capMatch) result.capacity = `${capMatch[1]} ${capMatch[2]}`;
  }

  if (!result.bottleType) {
    const botMatch = fullText.match(BOTTLE_KEYWORDS);
    if (botMatch) result.bottleType = botMatch[1]!.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  if (!result.colour) {
    const colMatch = fullText.match(COLOUR_KEYWORDS);
    if (colMatch) result.colour = colMatch[0];
  }

  if (!result.weight) {
    const wtMatch = fullText.match(WEIGHT_KEYWORDS);
    if (wtMatch) result.weight = `${wtMatch[1]}g`;
  }

  // ── Quantity enhancement ──
  if (!result.quantity) {
    const qtyPatterns = [
      /(?:required|need|want|ordering|order)\s*(?:quantity)?[:\s]*(\d[\d,.]*\s*(?:liter|litre|l|kg|kgs|pcs|unit|units?|nos?|pieces?|ml|dozen|ton|mt|bags?|boxes?|carton|bottle)s?)/i,
      /(\d[\d,.]*\s*(?:liter|litre|l|kg|kgs|pcs|unit|units?|nos?|pieces?|ml|dozen|ton|mt|bags?|boxes?|carton|bottle)s?)\s*(?:per\s+month|monthly|daily|weekly)?/i,
    ];
    for (const pat of qtyPatterns) {
      const m = fullText.match(pat);
      if (m) { result.quantity = m[1]!.trim(); break; }
    }
  }

  // ── Industry extraction ──
  if (!result.industry) {
    const industryKeywords: Record<string, string> = {
      "pharmaceutical": "Pharmaceutical", "pharma": "Pharmaceutical",
      "cosmetic": "Cosmetics", "cosmetics": "Cosmetics",
      "food": "Food & Beverage", "beverage": "Food & Beverage",
      "detergent": "FMCG", "soap": "FMCG", "shampoo": "FMCG",
      "automobile": "Automobile", "auto": "Automobile",
      "textile": "Textile", "garment": "Textile",
      "agriculture": "Agriculture", "fertilizer": "Agriculture",
      "chemical": "Chemical", "paint": "Chemical",
      "water": "Water Treatment", "mineral water": "Water Treatment",
      "milk": "Dairy", "dairy": "Dairy",
      "oil": "Edible Oil", "edible oil": "Edible Oil",
      "petroleum": "Petroleum", "lubricant": "Petroleum",
      "toy": "Toys", "toys": "Toys",
      "stationery": "Stationery",
      "hardware": "Hardware",
      "electronics": "Electronics",
    };
    for (const [kw, ind] of Object.entries(industryKeywords)) {
      if (fullLower.includes(kw)) { result.industry = ind; break; }
    }
  }

  // ── City from "City: X" or "Location: X" pattern ──
  if (!result.city) {
    for (const line of lines) {
      const m = line.match(/(?:city|location|place|town|district)[:\s]+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s*[,;]|\s*$)/i);
      if (m) { result.city = m[1]!.trim(); break; }
    }
  }

  // ── State from "State: X" pattern ──
  if (!result.state) {
    for (const line of lines) {
      const m = line.match(/(?:state|province|region)[:\s]+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s*[,;]|\s*$)/i);
      if (m) { result.state = expandState(m[1]!.trim()); break; }
    }
  }

  // ── State from pincode → state mapping ──
  if (!result.state) {
    const pinMatch = fullText.match(/\b(\d{6})\b/);
    if (pinMatch) {
      const pin = pinMatch[1]!;
      const firstTwo = parseInt(pin.slice(0, 2));
      // Indian pincode → state rough mapping
      const PIN_STATE: Record<number, string> = {
        11: "Delhi", 12: "Haryana", 13: "Punjab", 14: "Punjab", 15: "Jammu & Kashmir",
        16: "Punjab", 17: "Himachal Pradesh", 18: "Jammu & Kashmir", 19: "Jammu & Kashmir",
        20: "Uttar Pradesh", 21: "Uttar Pradesh", 22: "Uttar Pradesh", 23: "Uttar Pradesh",
        24: "Uttarakhand", 25: "Uttarakhand", 26: "Uttarakhand", 27: "Uttar Pradesh",
        28: "Uttar Pradesh", 30: "Rajasthan", 31: "Rajasthan", 32: "Rajasthan",
        33: "Rajasthan", 34: "Rajasthan", 35: "Gujarat", 36: "Gujarat", 37: "Gujarat",
        38: "Gujarat", 39: "Gujarat", 40: "Maharashtra", 41: "Maharashtra", 42: "Maharashtra",
        43: "Maharashtra", 44: "Maharashtra", 45: "Madhya Pradesh", 46: "Madhya Pradesh",
        47: "Madhya Pradesh", 48: "Madhya Pradesh", 49: "Chhattisgarh", 50: "Telangana",
        51: "Telangana", 52: "Telangana", 53: "Andhra Pradesh", 56: "Karnataka",
        57: "Karnataka", 58: "Karnataka", 59: "Karnataka", 60: "Tamil Nadu",
        61: "Tamil Nadu", 62: "Tamil Nadu", 63: "Tamil Nadu", 64: "Tamil Nadu",
        67: "Kerala", 68: "Kerala", 69: "Kerala", 70: "West Bengal", 71: "West Bengal",
        72: "West Bengal", 73: "West Bengal", 74: "West Bengal", 75: "Odisha",
        76: "Odisha", 77: "Odisha", 78: "Assam", 79: "Northeast States",
        80: "Bihar", 81: "Bihar", 82: "Bihar", 83: "Bihar", 84: "Bihar",
        85: "Jharkhand",
      };
      const stateName = PIN_STATE[firstTwo];
      if (stateName) result.state = stateName;
    }
  }

  // ── Address from labelled patterns ──
  if (!result.address) {
    for (const line of lines) {
      const m = line.match(/^(?:address|addr|complete\s*address|full\s*address|pickup\s*address|delivery\s*address|office\s*address|factory\s*address)[:\s]+(.+)$/i);
      if (m) { result.address = m[1]!.trim(); break; }
    }
  }

  return result;
}

// ─── Normalizer ─────────────────────────────────────────────────────────────

export function normalizeLead(data: Partial<ParsedLead>): Partial<ParsedLead> {
  const result = { ...data };

  // Normalize state abbreviations
  if (result.state) result.state = expandState(result.state);

  // Trim all string fields
  for (const key of Object.keys(result) as Array<keyof ParsedLead>) {
    if (typeof result[key] === "string") {
      (result as any)[key] = (result[key] as string).trim();
    }
  }

  // Normalize mobile: remove spaces, dashes, +91 prefix
  if (result.clientMobile) {
    let mobile = result.clientMobile.replace(/[\s\-()]/g, "");
    if (mobile.startsWith("+91")) mobile = mobile.slice(3);
    if (mobile.startsWith("91") && mobile.length === 12) mobile = mobile.slice(2);
    result.clientMobile = mobile;
  }

  // Normalize email to lowercase
  if (result.email) result.email = result.email.toLowerCase().trim();

  // Normalize GST to uppercase
  if (result.gstNumber) result.gstNumber = result.gstNumber.toUpperCase().trim();

  // Normalize material
  if (result.material) {
    const matUpper = result.material.toUpperCase().trim();
    const MATERIAL_MAP: Record<string, string> = {
      "HDPE": "HDPE", "PP": "PP", "PET": "PET", "LDPE": "LDPE", "LLDPE": "LLDPE",
      "POLYCARBONATE": "PC", "PC": "PC", "ABS": "ABS", "PVC": "PVC", "PS": "PS",
    };
    result.material = MATERIAL_MAP[matUpper] || result.material;
  }

  // Normalize capacity: "5L" → "5 L", "250ml" → "250 ml"
  if (result.capacity) {
    result.capacity = result.capacity.replace(/(\d)(ltr|litre|liter|l|ml|kg|g|gram|gm|ton|mt|oz|cl|dl)$/i, "$1 $2");
  }

  // Capacity normalization complete
  return result;
}

function expandState(s: string): string {
  const trimmed = s.trim();
  const upper = trimmed.toUpperCase();
  return STATE_ABBR_MAP[upper] || trimmed;
}

// ─── Confidence Scorer ──────────────────────────────────────────────────────

export function scoreConfidence(data: Partial<ParsedLead>, rawText: string): { confidence: FieldConfidence; overall: number } {
  const confidence: FieldConfidence = {};
  const weights: Record<string, number> = {
    clientName: 15,
    clientMobile: 20,
    email: 10,
    city: 10,
    state: 8,
    companyName: 8,
    requirement: 12,
    quantity: 5,
    address: 3,
    gstNumber: 3,
    material: 2,
    capacity: 2,
    industry: 2,
  };

  let totalWeight = 0;
  let weightedScore = 0;

  for (const [field, weight] of Object.entries(weights)) {
    const value = (data as any)[field];
    totalWeight += weight;

    if (value && typeof value === "string" && value.trim().length > 0) {
      let score = 100;

      // Reduce confidence for very short values
      if (field === "clientName" && value.trim().length < 3) score = 40;
      if (field === "clientMobile" && value.trim().length !== 10) score = 50;
      if (field === "email" && !/@/.test(value)) score = 30;
      if (field === "city" && value.trim().length < 2) score = 40;

      // Boost confidence if value appears in raw text (was actually parsed, not guessed)
      const valueLower = value.toLowerCase();
      const rawLower = rawText.toLowerCase();
      if (rawLower.includes(valueLower)) score = Math.min(100, score + 10);

      confidence[field] = Math.min(100, Math.max(0, score));
      weightedScore += weight * score;
    } else {
      confidence[field] = 0;
    }
  }

  const overall = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
  return { confidence, overall };
}

// ─── Duplicate Detection (5-layer priority) ─────────────────────────────────

export async function detectDuplicate(data: Partial<ParsedLead>): Promise<DuplicateInfo | null> {
  const checks: Array<{ field: string; value: string | null; matchType: string }> = [
    { field: "mobile", value: data.clientMobile || null, matchType: "mobile" },
    { field: "gst", value: data.gstNumber || null, matchType: "gst" },
    { field: "email", value: data.email || null, matchType: "email" },
  ];

  // Priority 1-3: Direct field matches
  for (const check of checks) {
    if (!check.value) continue;
    const existing = await db.select().from(contactsTable)
      .where(eq((contactsTable as any)[check.field === "gst" ? "gstNumber" : check.field], check.value))
      .limit(1);
    if (existing.length > 0) {
      return buildDuplicateInfo(existing[0]!, check.matchType);
    }
  }

  // Priority 4: Company + Customer Name
  if (data.companyName && data.clientName) {
    const existing = await db.select().from(contactsTable)
      .where(and(
        ilike(contactsTable.companyName, data.companyName),
        ilike(contactsTable.name, data.clientName),
      ))
      .limit(1);
    if (existing.length > 0) {
      return buildDuplicateInfo(existing[0]!, "company+name");
    }
  }

  // Priority 5: Company + City
  if (data.companyName && data.city) {
    const existing = await db.select().from(contactsTable)
      .where(and(
        ilike(contactsTable.companyName, data.companyName),
        ilike(contactsTable.city, data.city),
      ))
      .limit(1);
    if (existing.length > 0) {
      return buildDuplicateInfo(existing[0]!, "company+city");
    }
  }

  return null;
}

async function buildDuplicateInfo(contact: any, matchType: string): Promise<DuplicateInfo> {
  const [owner] = await db.select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable).where(eq(usersTable.id, contact.salesOwnerId)).limit(1);
  return {
    exists: true,
    contactId: contact.id,
    customerName: contact.name,
    companyName: contact.companyName,
    mobile: contact.mobile,
    email: contact.email,
    ownerId: contact.salesOwnerId,
    ownerName: owner?.name || "Unknown",
    unit: contact.unit,
    category: contact.category,
    dealStage: null,
    status: contact.customerStatus || "Active",
    lastFollowUp: null,
    createdAt: contact.createdAt,
    matchType,
  };
}

// ─── Product Matching ───────────────────────────────────────────────────────

export async function matchProducts(data: Partial<ParsedLead>): Promise<ProductMatch[]> {
  if (!data.requirement && !data.material && !data.capacity && !data.bottleType) return [];

  const searchText = [data.requirement, data.bottleType, data.material, data.capacity, data.colour]
    .filter(Boolean).join(" ").toLowerCase();

  if (!searchText) return [];

  // Search products by name (ILIKE)
  const products = await db.select().from(productsTable)
    .where(ilike(productsTable.name, `%${searchText.slice(0, 50)}%`))
    .limit(10);

  // Score each product
  const matches: ProductMatch[] = products.map(p => {
    let score = 0;
    const reasons: string[] = [];
    const nameLower = p.name.toLowerCase();

    // Material match
    if (data.material && p.materialType && nameLower.includes(data.material.toLowerCase())) {
      score += 30; reasons.push("material");
    }
    // Capacity match
    if (data.capacity && nameLower.includes(data.capacity.toLowerCase())) {
      score += 25; reasons.push("capacity");
    }
    // Bottle type match
    if (data.bottleType && nameLower.includes(data.bottleType.toLowerCase())) {
      score += 20; reasons.push("bottle type");
    }
    // Colour match
    if (data.colour && p.bottleColour && nameLower.includes(data.colour.toLowerCase())) {
      score += 15; reasons.push("colour");
    }
    // General keyword overlap
    const words = searchText.split(/\s+/);
    for (const w of words) {
      if (w.length > 2 && nameLower.includes(w)) score += 5;
    }

    return {
      productId: p.id,
      name: p.name,
      category: p.category,
      materialType: p.materialType,
      matchScore: Math.min(100, score),
      matchReason: reasons.join(", ") || "keyword match",
    };
  });

  return matches.filter(m => m.matchScore > 10).sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);
}

// ─── Category Suggestion ────────────────────────────────────────────────────

export function suggestCategory(data: Partial<ParsedLead>, existingContact: DuplicateInfo | null): string {
  // If duplicate exists, keep existing category
  if (existingContact?.category) return existingContact.category;

  // If requirement mentions repeat/order/sample → likely My Client
  const req = (data.requirement || "").toLowerCase();
  if (/\b(repeat|reorder|re-order|sample|order|purchase|buying)\b/.test(req)) return "My Client";

  // Default
  return "Regular Follow up";
}

// ─── Self-Learning: Apply Corrections ───────────────────────────────────────

export async function applyCorrections(data: Partial<ParsedLead>): Promise<Partial<ParsedLead>> {
  try {
    const corrections = await db.select().from(importCorrectionsTable).limit(200);
    if (corrections.length === 0) return data;

    const result = { ...data };

    for (const corr of corrections) {
      if (!corr.originalValue || !corr.correctedValue) continue;

      const field = corr.field as keyof ParsedLead;
      const currentValue = (result as any)[field];

      // If the current value matches the old correction pattern, apply the correction
      if (typeof currentValue === "string" && currentValue.toLowerCase() === corr.originalValue.toLowerCase()) {
        (result as any)[field] = corr.correctedValue;
      }
    }

    return result;
  } catch {
    return data; // Never crash on correction errors
  }
}

// ─── Store Correction ───────────────────────────────────────────────────────

export async function storeCorrection(field: string, originalValue: string, correctedValue: string, userId: number): Promise<void> {
  try {
    // Check if correction already exists
    const existing = await db.select().from(importCorrectionsTable)
      .where(and(
        eq(importCorrectionsTable.field, field),
        eq(importCorrectionsTable.originalValue, originalValue),
        eq(importCorrectionsTable.correctedValue, correctedValue),
      ))
      .limit(1);

    if (existing.length > 0) {
      // Increment hit count
      await db.update(importCorrectionsTable)
        .set({ hitCount: (existing[0]!.hitCount || 0) + 1, updatedAt: new Date() })
        .where(eq(importCorrectionsTable.id, existing[0]!.id));
    } else {
      await db.insert(importCorrectionsTable).values({
        field,
        originalValue,
        correctedValue,
        hitCount: 1,
        createdBy: userId,
      });
    }
  } catch {
    // Never crash on correction storage
  }
}

// ─── Store Import Session ───────────────────────────────────────────────────

export async function storeImportSession(params: {
  userId: number;
  source: string;
  rawText: string;
  parserVersion: string;
  parsedData: Partial<ParsedLead>;
  editedData: Partial<ParsedLead>;
  finalData: Partial<ParsedLead>;
  confidence: FieldConfidence;
  overallConfidence: number;
  duplicateDetected: boolean;
  duplicateContactId: number | null;
  duplicateAction: string | null;
  resultLeadId: number | null;
  result: string;
  errorMessage: string | null;
}): Promise<void> {
  try {
    await db.insert(importSessionsTable).values({
      userId: params.userId,
      source: params.source,
      rawText: params.rawText,
      parserVersion: params.parserVersion,
      parsedData: params.parsedData as any,
      editedData: params.editedData as any,
      finalData: params.finalData as any,
      confidence: params.confidence as any,
      overallConfidence: String(params.overallConfidence),
      duplicateDetected: params.duplicateDetected,
      duplicateContactId: params.duplicateContactId,
      duplicateAction: params.duplicateAction,
      resultLeadId: params.resultLeadId,
      result: params.result,
      errorMessage: params.errorMessage,
    });
  } catch {
    // Never crash on session storage
  }
}

// ─── Full Pipeline: Parse → Normalize → Score → Detect Duplicates ──────────

export async function parseEnquiry(rawText: string, userId: number): Promise<ImportPreview> {
  // Step 1: Parser V1 (existing stable parser)
  let v1Result = {};
  try { v1Result = parserV1(rawText); } catch { /* V1 should never crash, but guard */ }

  // Step 2: Parser V2 (heuristic — fills gaps V1 missed)
  let v2Result = {};
  try { v2Result = parserV2(rawText, v1Result); } catch { /* guard */ }

  // Step 3: Merge V1 + V2 (V1 takes priority, V2 fills gaps)
  const merged: Partial<ParsedLead> = { ...v2Result };
  for (const key of Object.keys(v1Result) as Array<keyof ParsedLead>) {
    const v1Val = (v1Result as any)[key];
    if (v1Val && typeof v1Val === "string" && v1Val.trim()) {
      (merged as any)[key] = v1Val;
    }
  }

  // Step 4: Normalizer
  const normalized = normalizeLead(merged);

  // Step 5: Apply self-learning corrections
  const corrected = await applyCorrections(normalized);

  // Step 6: Confidence scoring
  const { confidence, overall } = scoreConfidence(corrected, rawText);

  // Step 7: Duplicate detection
  let duplicate: DuplicateInfo | null = null;
  try { duplicate = await detectDuplicate(corrected); } catch { /* guard */ }

  // Step 8: Product matching
  let suggestedProducts: ProductMatch[] = [];
  try { suggestedProducts = await matchProducts(corrected); } catch { /* guard */ }

  // Step 9: Category suggestion
  const suggestedCategory = suggestCategory(corrected, duplicate);

  // Determine which parser was most useful
  const v1Fields = Object.values(v1Result).filter(Boolean).length;
  const v2ExtraFields = Object.entries(v2Result).filter(([k, v]) => v && !(v1Result as any)[k]).length;
  const parserVersion = v2ExtraFields > 0 ? "v1+v2" : "v1";

  return {
    parsedData: v1Result,
    editedData: corrected,
    finalData: corrected,
    confidence,
    overallConfidence: overall,
    parserVersion,
    duplicate,
    suggestedCategory,
    suggestedProducts,
    rawText,
  };
}
