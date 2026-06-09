import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { useImportIndiaMart, useImportExcel, useListUsers, getListContactsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  companyName: string;
  requirement: string;
  quantity: string;
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

  // ── City ──────────────────────────────────────────────────────────────────
  const citySkip = /^(?:regards|email|mobile|phone|call|click|http|name|company|contact|please|dear|hi\b|i am|i'm|looking|kindly|india|gujarat|rajasthan|maharashtra|member)/i;

  for (const line of lines) {
    let m: RegExpMatchArray | null;

    // "Surat - 395006, Gujarat, India"  OR  "Mundra - 370435, GJ"
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?)\s*[-–]\s*\d{6}/);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 4) {
      result.city = m[1]!.trim();
      break;
    }

    // "Sadri, Rajasthan, India"
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?),\s*[A-Za-z\s]{3,20},\s*India$/i);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 3) {
      result.city = m[1]!.trim();
      break;
    }

    // "City, State - pincode"
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?),\s*[A-Za-z\s]{3,20}\s*[-–]\s*\d{6}/i);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 3) {
      result.city = m[1]!.trim();
      break;
    }

    // "Location : Surat" or "City : Surat"
    m = line.match(/^(?:location|city|place)[:\s]+([A-Za-z][A-Za-z\s]{1,25}?)$/i);
    if (m) { result.city = m[1]!.trim(); break; }
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
  "mobile": "mobile", "mobile number": "mobile", "phone": "mobile", "contact number": "mobile", "mobilenumber": "mobile",
  "email": "email", "email id": "email", "emailid": "email",
  "company": "companyName", "company name": "companyName", "companyname": "companyName", "firm": "companyName",
  "city": "city", "location": "city",
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
  const importIndiaMart = useImportIndiaMart();
  const importExcel = useImportExcel();

  // ── IndiaMart state ──
  const emptyIm = { companyName: "", clientName: "", clientMobile: "", email: "", city: "", requirement: "", quantity: "", salesOwnerId: "" };
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
        requirement:  im.requirement  || null,
        quantity:     im.quantity     || null,
        salesOwnerId: im.salesOwnerId ? Number(im.salesOwnerId) : null,
      }
    }, {
      onSuccess: (contact) => {
        setImResult({ success: true, contact });
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setIm(emptyIm);
        setParsePreview(null);
        toast({ title: `Lead "${im.clientName}" imported from IndiaMart` });
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
    importExcel.mutate({ data: { rows: parsedRows, defaultSalesOwnerId: excelOwner ? Number(excelOwner) : null } }, {
      onSuccess: (result) => {
        setExcelResult(result);
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: `Imported ${result.imported} leads` });
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
    importExcel.mutate({ data: { rows, defaultSalesOwnerId: pasteOwner ? Number(pasteOwner) : null } }, {
      onSuccess: (result) => {
        setPasteResult(result);
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: `Imported ${result.imported} leads` });
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

              <Button onClick={handleIndiaMart} disabled={importIndiaMart.isPending} className="w-full">
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

                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <Label className="text-xs text-muted-foreground mb-1 block">Default Sales Owner (if not in sheet)</Label>
                      <Select value={excelOwner || "none"} onValueChange={v => setExcelOwner(v === "none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Required (skip rows without owner)</SelectItem>
                          {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      onClick={handleExcelUploadImport}
                      disabled={importExcel.isPending || !parsedRows.length}
                      className="mt-5"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {importExcel.isPending ? "Importing…" : `Import ${parsedRows.length} Rows`}
                    </Button>
                  </div>
                </>
              )}

              {excelResult && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-1 text-sm">
                  <p className="font-medium text-green-800 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Import complete
                  </p>
                  <p className="text-green-700">✓ {excelResult.imported} imported &nbsp;·&nbsp; {excelResult.skipped} skipped</p>
                  {excelResult.duplicates?.length > 0 && (
                    <p className="text-amber-700 text-xs">Duplicates skipped: {excelResult.duplicates.join(", ")}</p>
                  )}
                  {excelResult.errors?.length > 0 && (
                    <p className="text-red-600 text-xs">{excelResult.errors.slice(0, 3).join(" · ")}</p>
                  )}
                </div>
              )}

              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-medium">Recognised column names:</p>
                <p>Name, Mobile, Email, Company, City, Owner, Inquiry Date, Industry, Unit, Lead Source, Tags, Address</p>
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
              <div className="flex items-center gap-3">
                <Select value={pasteOwner || "none"} onValueChange={v => setPasteOwner(v === "none" ? "" : v)}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Default Sales Owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Required (skip without owner)</SelectItem>
                    {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={handlePasteImport} disabled={importExcel.isPending || !pasteText.trim()}>
                  <Upload className="h-4 w-4 mr-2" /> Import
                </Button>
              </div>

              {pasteResult && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
                  <p className="font-medium text-green-800 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Import complete
                  </p>
                  <p className="text-green-700 mt-1">✓ {pasteResult.imported} imported · {pasteResult.skipped} skipped</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
