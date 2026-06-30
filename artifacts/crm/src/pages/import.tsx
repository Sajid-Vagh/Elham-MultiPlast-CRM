import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { useImportIndiaMart, useImportExcel, useListUsers, getListContactsQueryKey, useGetMe } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { playNotificationSound, showBrowserNotification } from "@/lib/notification-sound";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Upload, FileSpreadsheet, X, Info, Sparkles, ClipboardPaste } from "lucide-react";
import { Link } from "wouter";

// ── IndiaMart multi-format parser ────────────────────────────────────────────
interface ParsedLead {
  clientName: string;
  clientMobile: string;
  email: string;
  city: string;
  state: string;
  companyName: string;
  requirement: string;
  quantity: string;
}

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

function expandStateAbbr(s: string): string {
  const trimmed = s.trim();
  const upper = trimmed.toUpperCase();
  return STATE_ABBR_MAP[upper] || trimmed;
}

const KNOWN_CITY_STATE_MAP: Record<string, string> = {
  "surat": "Gujarat", "ahmedabad": "Gujarat", "vadodara": "Gujarat", "baroda": "Gujarat",
  "rajkot": "Gujarat", "bhavnagar": "Gujarat", "jamnagar": "Gujarat", "anand": "Gujarat",
  "navsari": "Gujarat", "valsad": "Gujarat", "mehsana": "Gujarat", "gandhinagar": "Gujarat",
  "mumbai": "Maharashtra", "bombay": "Maharashtra", "pune": "Maharashtra", "poonah": "Maharashtra",
  "nagpur": "Maharashtra", "thane": "Maharashtra", "nashik": "Maharashtra", "aurangabad": "Maharashtra",
  "delhi": "Delhi", "new delhi": "Delhi",
  "jaipur": "Rajasthan", "jodhpur": "Rajasthan", "udaipur": "Rajasthan", "kota": "Rajasthan",
  "ajmer": "Rajasthan", "bikaner": "Rajasthan", "jhunjhunu": "Rajasthan",
  "indore": "Madhya Pradesh", "bhopal": "Madhya Pradesh", "ujjain": "Madhya Pradesh",
  "bangalore": "Karnataka", "bengaluru": "Karnataka",
  "chennai": "Tamil Nadu", "madras": "Tamil Nadu", "coimbatore": "Tamil Nadu",
  "kolkata": "West Bengal", "calcutta": "West Bengal",
  "hyderabad": "Telangana",
  "lucknow": "Uttar Pradesh", "kanpur": "Uttar Pradesh", "agra": "Uttar Pradesh",
  "varanasi": "Uttar Pradesh", "noida": "Uttar Pradesh",
  "chandigarh": "Chandigarh",
  "gurgaon": "Haryana", "gurugram": "Haryana", "faridabad": "Haryana",
  "amritsar": "Punjab", "ludhiana": "Punjab",
  "patna": "Bihar",
  "ranchi": "Jharkhand",
  "bhubaneswar": "Odisha", "cuttack": "Odisha",
  "guwahati": "Assam",
  "dehradun": "Uttarakhand",
  "shimla": "Himachal Pradesh",
  "goa": "Goa",
  "panaji": "Goa",
  "pondicherry": "Puducherry",
};

const STATE_NAMES = new Set(Object.values(KNOWN_CITY_STATE_MAP).map(s => s.toLowerCase()));

function parseLocation(raw: string | null | undefined): { city: string | null; state: string | null } {
  if (!raw) return { city: null, state: null };
  const text = raw.trim();
  if (!text) return { city: null, state: null };

  const upper = text.toUpperCase();

  // Exact state abbreviation
  if (STATE_ABBR_MAP[upper]) {
    return { city: null, state: STATE_ABBR_MAP[upper] };
  }

  // Exact state name
  if (STATE_NAMES.has(text.toLowerCase())) {
    return { city: null, state: text };
  }

  // Known city
  const cityLower = text.toLowerCase();
  if (KNOWN_CITY_STATE_MAP[cityLower]) {
    return { city: text, state: KNOWN_CITY_STATE_MAP[cityLower] };
  }

  // "City ABBR" pattern (last 2-3 uppercase chars as state code)
  const words = text.split(/\s+/);
  const lastWord = words[words.length - 1]!;
  const lastUpper = lastWord.toUpperCase();
  if (lastUpper.length === 2 && STATE_ABBR_MAP[lastUpper]) {
    const cityPart = words.slice(0, -1).join(" ");
    return { city: cityPart || null, state: STATE_ABBR_MAP[lastUpper] };
  }

  // "City, State" or "City - State" pattern
  const commaMatch = text.match(/^(.+?)\s*[,–—\-]\s*(.+)$/);
  if (commaMatch) {
    const part1 = commaMatch[1]!.trim();
    const part2 = commaMatch[2]!.trim();
    const p2Upper = part2.toUpperCase();
    if (STATE_ABBR_MAP[p2Upper]) {
      return { city: part1, state: STATE_ABBR_MAP[p2Upper] };
    }
    if (KNOWN_CITY_STATE_MAP[part1.toLowerCase()]) {
      return { city: part1, state: part2 };
    }
  }

  // Single word left — check if it's a known city
  if (words.length === 1) {
    return { city: text, state: null };
  }

  // Multi-word — try last word as state name
  const lastLower = lastWord.toLowerCase();
  if (STATE_NAMES.has(lastLower)) {
    const cityPart = words.slice(0, -1).join(" ");
    return { city: cityPart, state: lastWord };
  }

  // Fallback: return as city only
  return { city: text, state: null };
}

function parseIndiaMartMessage(raw: string): Partial<ParsedLead> {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const fullText = lines.join("\n");
  const result: Partial<ParsedLead> = {};

  // ── Mobile: try patterns, most specific first ─────────────────────────────
  const mobilePatterns = [
    /click\s*to\s*call[:\s]*\+?91[-\s]?(\d{5})[-\s]?(\d{5})/i,
    /\+91[-\s]?(\d{5})[-\s]?(\d{5})/,
    /\+91(\d{10})/,
    /\b91([6-9]\d{9})\b/,
    /\b([6-9]\d{9})\b/,
  ];

  let mobileLineIdx = -1;
  for (let li = 0; li < lines.length; li++) {
    let found = false;
    for (const pat of mobilePatterns) {
      const m = lines[li]!.match(pat);
      if (m) {
        let digits = m[0].replace(/[^\d]/g, "");
        if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
        if (digits.length === 10) {
          result.clientMobile = digits;
          mobileLineIdx = li;
          found = true;
          break;
        }
      }
    }
    if (found) break;
  }

  // Extra mobile numbers on the same line (e.g. "Mobile: +91-9784197841, 9602005122")
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

  // ── Email ─────────────────────────────────────────────────────────────────
  const emailMatch = fullText.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) result.email = emailMatch[1]!.toLowerCase();

  // ── Name: try strategies in order ─────────────────────────────────────────
  // Strategy 1: After "Regards," line
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

  // Strategy 2: "Name :" / "Contact Person :" label in table
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

  // Strategy 3: Line immediately AFTER the mobile number line (Format 3 style)
  // e.g.: "9610118214 \n Arvind"
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

  // Strategy 4: First short ALL-CAPS or Title-case line (Format 2 "RABARI" style)
  // Only runs if no name found yet — look at first 4 lines
  if (!result.clientName) {
    const nameSkipKw = /^(?:hi|dear|hello|regards|chat|enquiry|buylead|details|member|buyer|requirement|material|design|capacity|quantity|probable|click|email|mobile|phone|hdpe|pp|pet|ldpe|bottle|can|jar|drum|ltr|litr|piece|pcs)/i;
    for (let i = 0; i < Math.min(4, lines.length); i++) {
      const line = lines[i]!;
      // Skip lines with digits (could be mobile) or email chars
      if (/\d/.test(line) || /@/.test(line)) continue;
      // Must be purely letters/spaces/dots, 2–5 words max
      if (/^[A-Za-z][A-Za-z\s.']{1,50}$/.test(line) &&
          !nameSkipKw.test(line) &&
          line.split(/\s+/).length <= 5) {
        result.clientName = line;
        break;
      }
    }
  }

  // ── City & State ─────────────────────────────────────────────────────────
  const citySkip = /^(?:regards|email|mobile|phone|call|click|http|name|company|contact|please|dear|hi\b|i am|i'm|looking|kindly|india|gujarat|rajasthan|maharashtra|member)/i;
  const clean = (s: string) => s.trim().replace(/[.,;]+$/, "").trim();
  const knownStates = new Set(
    Object.keys(STATE_ABBR_MAP).map(k => k.toLowerCase()).concat(
    Object.values(STATE_ABBR_MAP).map(v => v.toLowerCase()))
  );

  for (const line of lines) {
    let m: RegExpMatchArray | null;

    // "Surat - 395006, Gujarat, India"  OR  "Mundra - 370435, GJ"
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?)\s*[-–]\s*\d{6}/);
    if (m && !citySkip.test(m[1]!.trim()) && !m[1]!.includes(",") && m[1]!.trim().split(" ").length <= 4) {
      result.city = clean(m[1]!);
      const st = line.match(/\d{6}\s*,\s*([A-Za-z\s]{2,30}?)(?:\s*,\s*India)?\s*$/i);
      if (st) result.state = expandStateAbbr(clean(st[1]!));
      break;
    }

    // "Sadri, Rajasthan, India"  (also allows 2-char state & trailing period)
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?),\s*([A-Za-z\s]{2,30}),\s*India[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 3) {
      result.city = clean(m[1]!);
      result.state = expandStateAbbr(clean(m[2]!));
      break;
    }

    // "City, State - pincode" (now supports 2-char state like GJ, RJ)
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?),\s*([A-Za-z\s]{2,30})\s*[-–]\s*\d{6}/i);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 3) {
      result.city = clean(m[1]!);
      result.state = expandStateAbbr(clean(m[2]!));
      break;
    }

    // "City, State" (simple two-part, e.g. "Jalore, RJ" or "Tharad, GJ")
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?),\s*([A-Za-z\s]{2,30})[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && !citySkip.test(m[2]!.trim()) &&
        m[1]!.trim().split(" ").length <= 3 && m[2]!.trim().split(" ").length <= 3 &&
        !/\d/.test(m[2]!)) {
      result.city = clean(m[1]!);
      result.state = expandStateAbbr(clean(m[2]!));
      break;
    }

    // "Location : Surat" or "City : Surat"
    m = line.match(/^(?:location|city|place)[:\s]+([A-Za-z][A-Za-z\s]{1,25}?)[.,]?\s*$/i);
    if (m) { result.city = clean(m[1]!); break; }

    // "... City, State, India" anywhere in line (e.g. "Plot-123, Area, City, State, India")
    m = line.match(/.*,\s*([A-Za-z][A-Za-z\s]{1,30}),\s*([A-Za-z\s]{2,30}),\s*India[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && !/\d/.test(m[1]!) && !/\d/.test(m[2]!) &&
        m[1]!.trim().split(" ").length <= 4 && !result.city && !result.state) {
      result.city = clean(m[1]!);
      result.state = expandStateAbbr(clean(m[2]!));
      break;
    }

    // "... City - 395006, State(, India)" anywhere in line (e.g. "..., Udaipur - 313604, Rajasthan, India")
    m = line.match(/.*,\s*([A-Za-z][A-Za-z\s]{1,25}?)\s*[-–]\s*\d{6}\s*,\s*([A-Za-z\s]{2,30})(?:,\s*India)?[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 4 &&
        !result.city && !result.state) {
      result.city = clean(m[1]!);
      result.state = expandStateAbbr(clean(m[2]!));
      break;
    }

    // "City: X, State: Y" inline colon format
    m = line.match(/(?:^|,\s*)city[:\s]+([A-Za-z][A-Za-z\s]{1,25}?)\s*[,;]\s*state[:\s]+([A-Za-z\s]{2,30})/i);
    if (m && !citySkip.test(m[1]!.trim()) && !result.city && !result.state) {
      result.city = clean(m[1]!);
      result.state = expandStateAbbr(clean(m[2]!));
      break;
    }

    // "Pincode - City, State" e.g. "395006 - Surat, Gujarat"
    m = line.match(/^(\d{6})\s*[-–]\s*([A-Za-z][A-Za-z\s]{1,25}?),\s*([A-Za-z\s]{2,30})[.,]?\s*$/);
    if (m && !citySkip.test(m[2]!.trim()) && m[2]!.trim().split(" ").length <= 3 &&
        !result.city && !result.state) {
      result.city = clean(m[2]!);
      result.state = expandStateAbbr(clean(m[3]!));
      break;
    }

    // "... City, State" at end of any line, validated against known states
    // e.g. "Deep Hostel , Tharad, GJ"  or  "Area, City, Gujarat"
    m = line.match(/.*,\s*([A-Za-z][A-Za-z\s]{1,30}),\s*([A-Za-z\s]{2,30})[.,]?\s*$/i);
    if (m && !citySkip.test(m[1]!.trim()) && !/\d/.test(m[1]!) && !/\d/.test(m[2]!) &&
        m[1]!.trim().split(" ").length <= 4 && m[2]!.trim().split(" ").length <= 3 &&
        !result.city && !result.state &&
        knownStates.has(m[2]!.trim().toLowerCase())) {
      result.city = clean(m[1]!);
      result.state = expandStateAbbr(clean(m[2]!));
      break;
    }
  }

  // Fallback: labelled City / State on their own lines
  if (!result.city || !result.state) {
    for (const line of lines) {
      const cm = line.match(/^(?:city|location)[:\s]+([A-Za-z][A-Za-z\s]{1,25}?)$/i);
      if (cm && !result.city) result.city = clean(cm[1]!);
      const sm = line.match(/^(?:state|province)[:\s]+(.+)$/i);
      if (sm && !result.state) result.state = expandStateAbbr(clean(sm[1]!));
      if (result.city && result.state) break;
    }
  }

  // ── Requirement ───────────────────────────────────────────────────────────
  // Strategy 1: "I am looking for..." / "I want..."
  for (const line of lines) {
    let m = line.match(/i(?:'m|\s+am)\s+looking\s+for\s+(.+?)\.?\s*$/i);
    if (m) { result.requirement = m[1]!.trim(); break; }
    m = line.match(/i(?:\s+(?:want|need|require))\s+(?:to\s+purchase\s+|to\s+buy\s+)?(.+?)\.?\s*$/i);
    if (m) { result.requirement = m[1]!.trim(); break; }
    m = line.match(/we\s+(?:are\s+)?(?:looking\s+for|need|require)\s+(.+?)\.?\s*$/i);
    if (m) { result.requirement = m[1]!.trim(); break; }
  }

  // Strategy 2: Line(s) after "Buylead Details:" header
  if (!result.requirement) {
    let buyLeadIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^buylead\s+details\s*[:\-]?\s*$/i.test(lines[i]!)) { buyLeadIdx = i; break; }
    }
    if (buyLeadIdx >= 0) {
      // Collect the next non-empty lines until we hit a key:value pattern
      const parts: string[] = [];
      for (let i = buyLeadIdx + 1; i < Math.min(buyLeadIdx + 5, lines.length); i++) {
        const l = lines[i]!;
        if (/^[A-Za-z][A-Za-z\s\/\(\)\-]{1,40}?[\s\t]*[:\t]/.test(l)) break; // reached table rows
        if (l && !/^buyer\s+searched/i.test(l)) parts.push(l);
      }
      if (parts.length > 0) result.requirement = parts.join(", ");
    }
  }

  // Strategy 3: "Buyer Searched for..." line
  if (!result.requirement) {
    for (const line of lines) {
      const m = line.match(/buyer\s+searched\s+for\s+(.+?)\.?\s*$/i);
      if (m) { result.requirement = m[1]!.trim(); break; }
    }
  }

  // Strategy 4: Last meaningful line that looks like a product description
  if (!result.requirement) {
    const contactSkip = /click|call|email|@|\+?91|\d{7,}|regards|member|since|buylead|details|india|http|pincode|probable|quantity|material|design/i;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!;
      if (l.length > 3 && l.length < 120 && !contactSkip.test(l) && !/^\d/.test(l)) {
        // Make sure it's not city/name we already extracted
        if (l !== result.city && l !== result.clientName) {
          result.requirement = l;
          break;
        }
      }
    }
  }

  // ── Table rows: "Key : Value" pairs (specs) ───────────────────────────────
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

  // ── Quantity ──────────────────────────────────────────────────────────────
  for (const line of lines) {
    let m = line.match(/(?:buyer\s+filled\s+details|quantity\s+required|quantity|qty|qnty)[:\s]+(.+)/i);
    if (m) { result.quantity = m[1]!.trim(); break; }
    m = line.match(/^(\d[\d,.]*\s*(?:liter|litre|l|kg|kgs|pcs|unit|units?|nos?|pieces?|ml|dozen|ton|mt|bags?|boxes?|carton|bottle)s?)\s*$/i);
    if (m && !result.quantity) { result.quantity = m[1]!.trim(); }
  }

  return result;
}

// ── Excel helpers ─────────────────────────────────────────────────────────────
const COLUMN_MAP: Record<string, string> = {
  "name": "name", "client name": "name", "clientname": "name", "contact name": "name",
  "customer name": "name", "customername": "name", "party name": "name", "partyname": "name",
  "mobile": "mobile", "mobile number": "mobile", "phone": "mobile", "contact number": "mobile",
  "mobilenumber": "mobile", "contact": "mobile", "phone number": "mobile", "phonenumber": "mobile",
  "email": "email", "email id": "email", "emailid": "email",
  "company": "companyName", "company name": "companyName", "companyname": "companyName", "firm": "companyName",
  "city": "city", "location": "city",
  "state": "state",
  "owner": "salesOwnerName", "sales owner": "salesOwnerName", "salesowner": "salesOwnerName", "assigned to": "salesOwnerName",
  "inquiry date": "inquiryDate", "inquirydate": "inquiryDate",
  "last call": "lastCallDate", "last call date": "lastCallDate", "lastcalldate": "lastCallDate",
  "next call": "nextCallDate", "next call date": "nextCallDate", "nextcalldate": "nextCallDate",
  "industry": "industry", "sector": "industry",
  "unit": "unit", "branch": "unit",
  "source": "leadSource", "lead source": "leadSource",
  "notes": "notes", "remarks": "notes",
  "tags": "tags", "tag": "tags",
  "address": "address",
  "area": "address", "area/address": "address", "area / address": "address",
  "locality": "address",
  "category": "category", "categories": "category", "cat": "category",
};

function normalizeHeader(h: string): string { return h.trim().toLowerCase(); }

function mapRow(headers: string[], values: string[]): Record<string, string | null> {
  const obj: Record<string, string | null> = {};
  headers.forEach((h, i) => {
    const key = COLUMN_MAP[normalizeHeader(h)] || normalizeHeader(h).replace(/\s+/g, "");
    const val = (values[i] ?? "").toString().trim();
    obj[key] = val || null;
  });
  return obj;
}

function excelDateToString(val: any): string | null {
  if (!val) return null;
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
  }
  return String(val).trim() || null;
}

// ─────────────────────────────────────────────────────────────────────────────

function FieldChip({ label, value, ok }: { label: string; value?: string; ok: boolean }) {
  if (!value && ok) return null;
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${ok ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
      <span className={ok ? "text-green-500" : "text-amber-400"}>
        {ok ? "✓" : "⚠"}
      </span>
      <span className="text-muted-foreground">{label}:</span>
      <span className="truncate max-w-[140px]">{value || "not detected"}</span>
    </div>
  );
}

export default function ImportPage() {
  const { data: users } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetMe();
  const importIndiaMart = useImportIndiaMart();
  const importExcel = useImportExcel();

  // ── Unit state (persisted per user) ──
  const unitStorageKey = `crm_import_unit_${me?.id ?? "anon"}`;
  const [unit, setUnit] = useState(() => localStorage.getItem(unitStorageKey) || "");
  useEffect(() => {
    if (unit) localStorage.setItem(unitStorageKey, unit);
    else localStorage.removeItem(unitStorageKey);
  }, [unit, unitStorageKey]);

  // ── IndiaMart state ──
  const emptyIm = { companyName: "", clientName: "", clientMobile: "", email: "", city: "", state: "", requirement: "", quantity: "", salesOwnerId: "" };
  const [im, setIm] = useState(emptyIm);
  const [smartPasteText, setSmartPasteText] = useState("");
  const [parsePreview, setParsePreview] = useState<Partial<ParsedLead> | null>(null);
  const [imResult, setImResult] = useState<any>(null);

  const imF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setIm(p => ({ ...p, [k]: e.target.value }));

  const handleSmartParse = () => {
    if (!smartPasteText.trim()) return;
    const parsed = parseIndiaMartMessage(smartPasteText);
    setParsePreview(parsed);
    setIm(prev => ({
      ...prev,
      clientName:   parsed.clientName   || prev.clientName,
      clientMobile: parsed.clientMobile || prev.clientMobile,
      email:        parsed.email        || prev.email,
      city:         parsed.city         || prev.city,
      state:        parsed.state        || prev.state,
      requirement:  parsed.requirement  || prev.requirement,
      quantity:     parsed.quantity     || prev.quantity,
      companyName:  parsed.companyName  || prev.companyName,
    }));
    setSmartPasteText("");
    const found = Object.values(parsed).filter(Boolean).length;
    toast({ title: `Extracted ${found} field${found !== 1 ? "s" : ""} — review and save` });
  };

  const handleIndiaMart = () => {
    if (!im.clientName || !im.clientMobile) {
      toast({ title: "Name and mobile are required", variant: "destructive" });
      return;
    }
    importIndiaMart.mutate({
      data: {
        companyName:  im.companyName  || null,
        clientName:   im.clientName,
        clientMobile: im.clientMobile,
        email:        im.email        || null,
        city:         im.city         || null,
        state:        im.state        || null,
        requirement:  im.requirement  || null,
        quantity:     im.quantity     || null,
        salesOwnerId: im.salesOwnerId ? Number(im.salesOwnerId) : null,
        unit: unit || null,
        category: importCategory,
      } as any,
    }, {
      onSuccess: (contact) => {
        setImResult({ success: true, contact });
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["category-counts"] });
        queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
        setIm(emptyIm);
        setParsePreview(null);
        toast({ title: `Lead "${im.clientName}" imported from IndiaMart` });
        playNotificationSound();
        showBrowserNotification("New Enquiry Imported", `${im.clientName}${im.city ? ` from ${im.city}` : ""} — IndiaMart`, "crm-import");
      },
      onError: (e: any) => {
        const isDup = e?.status === 409;
        setImResult({ success: false, error: e?.data?.error || "Failed", isDup });
      },
    });
  };

  // ── Excel state ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[] | null>(null);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [excelOwner, setExcelOwner] = useState("");
  const [excelResult, setExcelResult] = useState<any>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [pasteText, setPasteText] = useState("");
  const [pasteOwner, setPasteOwner] = useState("");
  const [pasteResult, setPasteResult] = useState<any>(null);

  const CATEGORY_OPTIONS = ["Regular Follow up", "Category A", "Category B", "Category C", "My Client"] as const;
  const [importCategory, setImportCategory] = useState("Regular Follow up");
  const [useCategoryFromFile, setUseCategoryFromFile] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<"skip" | "update">("skip");
  const [showImportConfirm, setShowImportConfirm] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file); setParsedRows(null); setParseError(null); setExcelResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]!]!;
        const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (!raw || raw.length < 2) { setParseError("The sheet is empty or has no data rows."); return; }
        const headers: string[] = (raw[0] as any[]).map(h => String(h ?? ""));
        const rows = raw.slice(1).filter(r => r.some((c: any) => c !== "" && c !== null && c !== undefined));
        const mapped = rows.map(r => {
          const obj = mapRow(headers, r.map(String));
          const dateFields = ["inquiryDate", "lastCallDate", "nextCallDate"];
          for (const df of dateFields) {
            const raw_idx = headers.findIndex(h => COLUMN_MAP[normalizeHeader(h)] === df || normalizeHeader(h).replace(/\s+/g, "") === df);
            if (raw_idx >= 0 && r[raw_idx] !== "" && r[raw_idx] !== null) {
              obj[df] = excelDateToString(r[raw_idx]);
            }
          }
          if (obj.address && !obj.city && !obj.state) {
            const parsed = parseLocation(obj.address);
            obj.city = parsed.city ?? obj.city;
            obj.state = parsed.state ?? obj.state;
          }
          return obj;
        });
        setPreviewHeaders(headers);
        setParsedRows(mapped);
        toast({ title: `Parsed ${mapped.length} rows from "${file.name}"` });
      } catch {
        setParseError("Could not read the file. Make sure it's a valid .xlsx or .xls file.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleExcelUploadImport = () => {
    if (!parsedRows?.length) return;
    const rowsWithUnit = parsedRows.map(r => ({ ...r, unit: r.unit || unit || null }));
    importExcel.mutate({
      data: {
        rows: rowsWithUnit,
        defaultSalesOwnerId: excelOwner ? Number(excelOwner) : null,
        category: importCategory,
        useCategoryFromFile,
        duplicateAction,
      } as any,
    }, {
      onSuccess: (result) => {
        setExcelResult(result);
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["category-counts"] });
        queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
        toast({ title: `Imported ${result.imported} leads into ${(result as any).importedInto}` });
        if (result.imported > 0) {
          playNotificationSound();
          showBrowserNotification("Enquiries Imported", `${result.imported} lead${result.imported > 1 ? "s" : ""} imported from Excel`, "crm-import");
        }
      },
      onError: () => toast({ title: "Import failed", variant: "destructive" }),
    });
  };

  const handlePasteImport = () => {
    let rows: any[] = [];
    try {
      const text = pasteText.trim();
      if (text.startsWith("[")) {
        rows = JSON.parse(text);
      } else {
        const lines = text.split("\n").filter(Boolean);
        const headers = lines[0]?.split("\t") ?? [];
        rows = lines.slice(1).map(line => mapRow(headers, line.split("\t")));
      }
    } catch {
      toast({ title: "Invalid format", variant: "destructive" }); return;
    }
    const rowsWithUnit = rows.map(r => ({ ...r, unit: r.unit || unit || null }));
    importExcel.mutate({ data: { rows: rowsWithUnit, defaultSalesOwnerId: pasteOwner ? Number(pasteOwner) : null, category: importCategory, duplicateAction } as any }, {
      onSuccess: (result) => {
        setPasteResult(result);
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["category-counts"] });
        queryClient.invalidateQueries({ queryKey: ["leads-contacts"] });
        toast({ title: `Imported ${result.imported} leads` });
        if (result.imported > 0) {
          playNotificationSound();
          showBrowserNotification("Enquiries Imported", `${result.imported} lead${result.imported > 1 ? "s" : ""} imported`, "crm-import");
        }
      },
      onError: () => toast({ title: "Import failed", variant: "destructive" }),
    });
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Data</h1>
        <p className="text-muted-foreground mt-1">Add IndiaMart leads or upload Excel data</p>
      </div>

      <Tabs defaultValue="indiamart">
        <TabsList>
          <TabsTrigger value="indiamart">IndiaMart</TabsTrigger>
          <TabsTrigger value="excel-upload">Excel Upload</TabsTrigger>
          <TabsTrigger value="paste">Paste / JSON</TabsTrigger>
        </TabsList>

        {/* ── INDIAMART ── */}
        <TabsContent value="indiamart">
          <Card>
            <CardHeader>
              <CardTitle>IndiaMart Lead</CardTitle>
              <CardDescription>Paste the IndiaMart message to auto-fill all fields, or enter details manually</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Smart paste area */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  Paste IndiaMart Message — auto-fills form
                </Label>
                <Textarea
                  value={smartPasteText}
                  onChange={e => setSmartPasteText(e.target.value)}
                  data-no-cap="1"
                  placeholder={"Paste any IndiaMart enquiry or BuyLead message here…\n\nWorks with all formats:\n• Standard (Regards / Click to call)\n• BuyLead (RABARI / Mundra - 370435, GJ)\n• Minimal (mobile number on first line)"}
                  rows={7}
                  className="font-mono text-sm resize-y"
                />
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleSmartParse}
                    disabled={!smartPasteText.trim()}
                    variant="outline"
                    className="border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:border-amber-500"
                  >
                    <ClipboardPaste className="h-4 w-4 mr-2" />
                    Extract &amp; Fill Fields
                  </Button>
                  {smartPasteText && (
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setSmartPasteText("")}>
                      <X className="h-3.5 w-3.5 mr-1" /> Clear
                    </Button>
                  )}
                </div>
              </div>

              {/* Extraction result chips */}
              {parsePreview && (
                <div className="flex flex-wrap gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="w-full text-xs font-medium text-green-700 mb-1">✓ Extracted — edit any field below before saving</p>
                  <FieldChip label="Name"   value={parsePreview.clientName}   ok={!!parsePreview.clientName} />
                  <FieldChip label="Mobile" value={parsePreview.clientMobile} ok={!!parsePreview.clientMobile} />
                  {parsePreview.email    && <FieldChip label="Email" value={parsePreview.email}    ok={true} />}
                  {parsePreview.city     && <FieldChip label="City"  value={parsePreview.city}     ok={true} />}
                  {parsePreview.state    && <FieldChip label="State" value={parsePreview.state}    ok={true} />}
                  {parsePreview.quantity && <FieldChip label="Qty"   value={parsePreview.quantity} ok={true} />}
                </div>
              )}

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Lead details</span>
                </div>
              </div>

              {/* Full editable form */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Client Name <span className="text-destructive">*</span></Label>
                  <Input value={im.clientName} onChange={imF("clientName")} placeholder="Full name" />
                </div>
                <div>
                  <Label>Mobile <span className="text-destructive">*</span></Label>
                  <Input value={im.clientMobile} onChange={imF("clientMobile")} placeholder="10-digit mobile" data-no-cap="1" />
                </div>
                <div>
                  <Label>Company Name</Label>
                  <Input value={im.companyName} onChange={imF("companyName")} placeholder="Optional" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={im.email} onChange={imF("email")} placeholder="Optional" data-no-cap="1" />
                </div>
                <div>
                  <Label>City</Label>
                  <Input value={im.city} onChange={imF("city")} placeholder="City" />
                </div>
                <div>
                  <Label>State</Label>
                  <Input value={im.state} onChange={imF("state")} placeholder="State" />
                </div>
                <div>
                  <Label>Sales Owner</Label>
                  <Select value={im.salesOwnerId || "none"} onValueChange={v => setIm(p => ({ ...p, salesOwnerId: v === "none" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Auto-assign</SelectItem>
                      {users?.map(u => (
                        <SelectItem key={u.id} value={u.id.toString()}>
                          <span className="flex items-center gap-2">
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: u.colorCode }} />
                            {u.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Requirement</Label>
                  <Textarea value={im.requirement} onChange={imF("requirement")} placeholder="Product requirement, specs…" rows={3} />
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input value={im.quantity} onChange={imF("quantity")} placeholder="e.g. 3 liter, 500 pcs" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 border-t pt-4">
                <div>
                  <Label>Unit <span className="text-destructive">*</span></Label>
                  <Select value={unit} onValueChange={setUnit}>
                    <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Himatnagar">Himatnagar</SelectItem>
                      <SelectItem value="Rajkot">Rajkot</SelectItem>
                      <SelectItem value="Surat">Surat</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Import Into Category <span className="text-destructive">*</span></Label>
                  <Select value={importCategory} onValueChange={setImportCategory}>
                    <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button onClick={handleIndiaMart} disabled={importIndiaMart.isPending || !unit} className="w-full">
                <Upload className="h-4 w-4 mr-2" />
                {importIndiaMart.isPending ? "Importing…" : "Save Lead"}
              </Button>

              {/* Result feedback */}
              {imResult && (
                <div className={`flex items-start gap-3 p-3 rounded-lg ${imResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                  {imResult.success
                    ? <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
                    : <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />}
                  <div className="flex-1">
                    {imResult.success ? (
                      <>
                        <p className="font-medium text-green-800">Lead imported successfully!</p>
                        <p className="text-sm text-green-700 mt-0.5">{imResult.contact?.name} — {imResult.contact?.mobile}</p>
                        {unit && <p className="text-xs text-green-600 mt-0.5">Unit: {unit}</p>}
                        <Link href={`/leads/${imResult.contact?.id}`} className="text-xs text-green-700 underline mt-1 inline-block">
                          View lead →
                        </Link>
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-red-800">{imResult.isDup ? "Already in CRM" : "Import failed"}</p>
                        <p className="text-sm text-red-700 mt-0.5">{imResult.error}</p>
                      </>
                    )}
                  </div>
                </div>
              )}

            </CardContent>
          </Card>
        </TabsContent>

        {/* ── EXCEL UPLOAD ── */}
        <TabsContent value="excel-upload">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-green-600" />
                Excel / CSV Upload
              </CardTitle>
              <CardDescription>
                Upload an .xlsx or .xls file. First row must be column headers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium">{uploadedFile ? uploadedFile.name : "Click to upload"}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {uploadedFile ? `${parsedRows?.length ?? 0} rows ready to import` : ".xlsx or .xls files supported"}
                </p>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />

              {parseError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {parseError}
                </div>
              )}

              {parsedRows && parsedRows.length > 0 && (
                <>
                  {/* ── Import Preview ── */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1 text-sm">
                    <p className="font-medium text-blue-800">Import Preview</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-blue-700">
                      <span>Total Records:</span><span className="font-semibold">{parsedRows.length}</span>
                      <span>Missing Name:</span><span className="font-semibold">{parsedRows.filter(r => !r.name).length}</span>
                      <span>Missing Mobile:</span><span className="font-semibold">{parsedRows.filter(r => !r.mobile).length}</span>
                      <span>Import Category:</span><span className="font-semibold">{useCategoryFromFile ? "From File \u2192" : importCategory}</span>
                    </div>
                  </div>

                  {/* ── Location Parsing Preview ── */}
                  {parsedRows.some(r => r.address) && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-2 text-sm">
                      <p className="font-medium text-indigo-800">Location Parsing (from AREA / ADDRESS column)</p>
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {parsedRows.filter(r => r.address).slice(0, 10).map((r, i) => {
                          const parsed = parseLocation(r.address);
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs text-indigo-700">
                              <span className="font-mono bg-indigo-100 px-1.5 py-0.5 rounded truncate max-w-[160px]">{r.address}</span>
                              <span className="text-indigo-400">→</span>
                              <span>City: <strong>{parsed.city || "—"}</strong></span>
                              <span>State: <strong>{parsed.state || "—"}</strong></span>
                            </div>
                          );
                        })}
                        {parsedRows.filter(r => r.address).length > 10 && (
                          <p className="text-xs text-indigo-400">… and {parsedRows.filter(r => r.address).length - 10} more</p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="bg-muted/50 rounded-lg overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="border-b">
                          {previewHeaders.slice(0, 6).map((h, i) => (
                            <th key={i} className="p-2 text-left font-medium text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.slice(0, 3).map((row, i) => (
                          <tr key={i} className="border-b last:border-0">
                            {previewHeaders.slice(0, 6).map((h, j) => {
                              const key = COLUMN_MAP[normalizeHeader(h)] || normalizeHeader(h).replace(/\s+/g, "");
                              return <td key={j} className="p-2 truncate max-w-[120px]">{row[key] ?? ""}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {parsedRows.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center py-1.5">… and {parsedRows.length - 3} more rows</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Default Sales Owner (if not in sheet)</Label>
                      <Select value={excelOwner || "none"} onValueChange={v => setExcelOwner(v === "none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Required (skip rows without owner)</SelectItem>
                          {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Unit <span className="text-destructive">*</span></Label>
                      <Select value={unit} onValueChange={setUnit}>
                        <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Himatnagar">Himatnagar</SelectItem>
                          <SelectItem value="Rajkot">Rajkot</SelectItem>
                          <SelectItem value="Surat">Surat</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Import Into Category <span className="text-destructive">*</span></Label>
                      <Select value={importCategory} onValueChange={setImportCategory}>
                        <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                        <SelectContent>
                          {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">On Duplicate</Label>
                      <Select value={duplicateAction} onValueChange={v => setDuplicateAction(v as "skip" | "update")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">Skip Duplicates</SelectItem>
                          <SelectItem value="update">Update Existing Records</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useCategoryFromFile}
                      onChange={e => setUseCategoryFromFile(e.target.checked)}
                      className="rounded"
                    />
                    <span>Use Category From File</span>
                    {useCategoryFromFile && (
                      <span className="text-xs text-muted-foreground">(falls back to selected category if missing)</span>
                    )}
                  </label>

                  {showImportConfirm && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3 text-sm">
                      <p className="font-medium text-amber-800">Confirm Import</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-amber-700">
                        <span>Selected Category:</span><span className="font-semibold">{useCategoryFromFile ? "From File \u2192" : importCategory}</span>
                        <span>Total Records:</span><span className="font-semibold">{parsedRows.length}</span>
                      </div>
                      <p className="text-amber-700">All {parsedRows.length} records will be imported into <strong>{useCategoryFromFile ? importCategory : importCategory}</strong>.</p>
                      <div className="flex gap-2">
                        <Button onClick={() => { setShowImportConfirm(false); handleExcelUploadImport(); }} disabled={importExcel.isPending} className="flex-1">
                          {importExcel.isPending ? "Importing…" : "Confirm Import"}
                        </Button>
                        <Button onClick={() => setShowImportConfirm(false)} variant="outline" className="flex-1">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={() => setShowImportConfirm(true)}
                    disabled={importExcel.isPending || !parsedRows.length || !unit}
                    className="w-full"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {importExcel.isPending ? "Importing…" : `Import ${parsedRows.length} Rows`}
                  </Button>
                </>
              )}

              {excelResult && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-1 text-sm">
                  <p className="font-medium text-green-800 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Import complete
                  </p>
                  <p className="text-green-700">✓ {excelResult.imported} imported &nbsp;·&nbsp; {(excelResult as any).autoNamed > 0 ? `${(excelResult as any).autoNamed} auto-named · ` : ""}{(excelResult as any).updated > 0 ? `${(excelResult as any).updated} updated · ` : ""}{excelResult.skipped} skipped</p>
                  {unit && <p className="text-green-600 text-xs">Unit: {unit}</p>}
                  <p className="text-green-600 text-xs">Imported Into: {(excelResult as any).importedInto}</p>
                  {excelResult.duplicates?.length > 0 && (
                    <p className="text-amber-700 text-xs">Duplicates: {excelResult.duplicates.length} ({excelResult.duplicates.slice(0, 5).join(", ")}{excelResult.duplicates.length > 5 ? "..." : ""})</p>
                  )}
                  {excelResult.errors?.length > 0 && (
                    <p className="text-red-600 text-xs">Failed: {excelResult.errors.length} — {excelResult.errors.slice(0, 3).join(" · ")}</p>
                  )}
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium">Recognised column names:</p>
                <p>Name, Mobile, Email, Company, City, State, Owner, Inquiry Date, Industry, Unit, Lead Source, Tags, Category</p>
                <p>AREA / ADDRESS → auto-parses City &amp; State from values like "Pune MH", "Surat", "RJ"</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PASTE / JSON ── */}
        <TabsContent value="paste">
          <Card>
            <CardHeader>
              <CardTitle>Paste Tab-separated or JSON</CardTitle>
              <CardDescription>Paste rows copied from Excel (tab-separated), or a JSON array of objects.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                data-no-cap="1"
                placeholder={"Tab-separated (header row first):\nName\tMobile\tEmail\tCity\nRavi Shah\t9876543210\travi@ex.com\tSurat\n\nOr JSON array:\n[{\"name\":\"Ravi\",\"mobile\":\"9876543210\"}]"}
                rows={8}
                className="font-mono text-sm"
              />
              <div className="grid grid-cols-4 gap-3">
                <Select value={pasteOwner || "none"} onValueChange={v => setPasteOwner(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Sales Owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Required (skip without owner)</SelectItem>
                    {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Himatnagar">Himatnagar</SelectItem>
                    <SelectItem value="Rajkot">Rajkot</SelectItem>
                    <SelectItem value="Surat">Surat</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={importCategory} onValueChange={setImportCategory}>
                  <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={handlePasteImport} disabled={importExcel.isPending || !pasteText.trim() || !unit}>
                  <Upload className="h-4 w-4 mr-2" /> Import
                </Button>
              </div>

              {pasteResult && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                  <p className="font-medium text-green-800 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Import complete
                  </p>
                  <p className="text-green-700 mt-1">✓ {pasteResult.imported} imported &nbsp;·&nbsp; {(pasteResult as any).autoNamed > 0 ? `${(pasteResult as any).autoNamed} auto-named · ` : ""}{pasteResult.skipped} skipped</p>
                  {unit && <p className="text-green-600 text-xs mt-0.5">Unit: {unit}</p>}
                  <p className="text-green-600 text-xs">Imported Into: {(pasteResult as any).importedInto}</p>
                  {pasteResult.errors?.length > 0 && (
                    <p className="text-red-600 text-xs mt-0.5">Failed: {pasteResult.errors.slice(0, 3).join(" · ")}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
