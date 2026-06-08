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

// ── Improved IndiaMart message parser ───────────────────────────────────────
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

  // ── Mobile: try multiple patterns, most specific first ──
  const mobilePatterns = [
    // "Click to call: +91-XXXXX-XXXXX"
    /click\s*to\s*call[:\s]*\+?91[-\s]?(\d{5})[-\s]?(\d{5})/i,
    // "+91-XXXXX-XXXXX" or "+91 XXXXX XXXXX"
    /\+91[-\s]?(\d{5})[-\s]?(\d{5})/,
    // "+91XXXXXXXXXX" (10 digits after +91)
    /\+91(\d{10})/,
    // "91XXXXXXXXXX" at start
    /\b91([6-9]\d{9})\b/,
    // standalone 10-digit mobile (starts 6-9)
    /\b([6-9]\d{9})\b/,
  ];

  for (const line of lines) {
    let found = false;
    for (const pat of mobilePatterns) {
      const m = line.match(pat);
      if (m) {
        // Extract just the digits
        let digits = m[0].replace(/[^\d]/g, "");
        // Strip leading 91 if 12 digits total
        if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
        if (digits.length === 10) {
          result.clientMobile = digits;
          found = true;
          break;
        }
      }
    }
    if (found) break;
  }

  // ── Name: after "Regards" line (same line or next line) ──
  let regardsIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^regards[,.]?\s*$/i.test(lines[i]!) || /^regards[,.:]\s+\S/i.test(lines[i]!)) {
      regardsIdx = i;
      break;
    }
  }

  if (regardsIdx >= 0) {
    const regardsLine = lines[regardsIdx]!;
    // Name on same line: "Regards, John Smith"
    const sameLineMatch = regardsLine.match(/^regards[,.:]\s+(.+)$/i);
    if (sameLineMatch) {
      const candidate = sameLineMatch[1]!.trim();
      if (!/click|call|email|@|\d{7,}/i.test(candidate)) {
        result.clientName = candidate;
      }
    } else {
      // Name on next line, possibly with "tickicon" prefix
      for (let i = regardsIdx + 1; i < Math.min(regardsIdx + 4, lines.length); i++) {
        let nameLine = lines[i]!.replace(/^tickicon\s*/i, "").trim();
        // Skip lines that look like contact info
        if (!nameLine || /click\s*to\s*call|email[:\s]|@|\+?91|\d{8,}|http/i.test(nameLine)) continue;
        // Must look like a name (letters and spaces)
        if (/^[A-Za-z][A-Za-z\s.']{2,60}$/.test(nameLine)) {
          result.clientName = nameLine;
          break;
        }
      }
    }
  }

  // Fallback: look for "Name :" or "Contact Person :" in table rows
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

  // ── Email ──
  const emailMatch = fullText.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) result.email = emailMatch[1]!.toLowerCase();

  // ── City: various "City, State" or "City - pincode" patterns ──
  const citySkip = /^(?:regards|email|mobile|phone|call|click|http|name|company|contact|please|dear|hi\b|i am|i'm|looking|kindly|india|gujarat|rajasthan|maharashtra)/i;
  for (const line of lines) {
    let m: RegExpMatchArray | null;

    // "Surat - 395006, Gujarat, India" or "Surat-395006"
    m = line.match(/^([A-Za-z][A-Za-z\s]{1,25}?)\s*[-–]\s*\d{6}/);
    if (m && !citySkip.test(m[1]!.trim()) && m[1]!.trim().split(" ").length <= 4) {
      result.city = m[1]!.trim();
      break;
    }

    // "City, State, India" pattern
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

    // Look for City in "Location : Surat" style table row
    m = line.match(/^(?:location|city|place)[:\s]+([A-Za-z][A-Za-z\s]{1,25}?)$/i);
    if (m) {
      result.city = m[1]!.trim();
      break;
    }
  }

  // ── Requirement: "I am looking for..." / "I'm looking for..." / "I want..." ──
  for (const line of lines) {
    let m = line.match(/i(?:'m|\s+am)\s+looking\s+for\s+(.+?)\.?\s*$/i);
    if (m) { result.requirement = m[1]!.trim(); break; }
    m = line.match(/i(?:\s+(?:want|need|require))\s+(?:to\s+purchase\s+|to\s+buy\s+)?(.+?)\.?\s*$/i);
    if (m) { result.requirement = m[1]!.trim(); break; }
    m = line.match(/we\s+(?:are\s+)?(?:looking\s+for|need|require)\s+(.+?)\.?\s*$/i);
    if (m) { result.requirement = m[1]!.trim(); break; }
  }

  // ── Table rows: "Key : Value" pairs (product specs, details) ──
  const skipTableKeys = /^(?:email|mobile|phone|call|regards|india|pincode|country|state|website|location|city|place|name|contact|buyer|address|verified)/i;
  const tableRows: string[] = [];
  for (const line of lines) {
    // Match "Key : Value" or "Key\t:\tValue" or "Key\tValue"
    const m = line.match(/^([A-Za-z][A-Za-z\s\/\(\)\-]{1,40}?)\s*[:\t]+\s*(.{1,200})$/);
    if (m) {
      const key = m[1]!.trim();
      const val = m[2]!.trim();
      if (!skipTableKeys.test(key) && val.length > 0 && val.length < 200) {
        // Try to extract company name
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

  // ── Quantity: "Quantity : 500 Pcs" or "Buyer Filled Details: 3 liter" ──
  for (const line of lines) {
    let m = line.match(/(?:buyer\s+filled\s+details|quantity\s+required|quantity|qty|qnty)[:\s]+(.+)/i);
    if (m) { result.quantity = m[1]!.trim(); break; }
    // standalone "500 pcs", "3 liter" on its own line
    m = line.match(/^(\d[\d,.]*\s*(?:liter|litre|l|kg|kgs|pcs|unit|units?|nos?|pieces?|ml|dozen|ton|mt|bags?|boxes?|carton|bottle)s?)\s*$/i);
    if (m && !result.quantity) { result.quantity = m[1]!.trim(); }
  }

  return result;
}

// ── Excel column mapping ─────────────────────────────────────────────────────
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

export default function ImportPage() {
  const { data: users } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const importIndiaMart = useImportIndiaMart();
  const importExcel = useImportExcel();

  const [im, setIm] = useState({ companyName: "", clientName: "", clientMobile: "", email: "", city: "", requirement: "", quantity: "", salesOwnerId: "" });
  const [smartPasteText, setSmartPasteText] = useState("");
  const [smartPasteOpen, setSmartPasteOpen] = useState(false);
  const [imResult, setImResult] = useState<any>(null);
  const [parsePreview, setParsePreview] = useState<Partial<ParsedLead> | null>(null);

  const imF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setIm(p => ({ ...p, [k]: e.target.value }));

  const handleSmartParse = () => {
    if (!smartPasteText.trim()) return;
    const parsed = parseIndiaMartMessage(smartPasteText);
    setParsePreview(parsed);
    setIm(prev => ({
      ...prev,
      clientName: parsed.clientName || prev.clientName,
      clientMobile: parsed.clientMobile || prev.clientMobile,
      email: parsed.email || prev.email,
      city: parsed.city || prev.city,
      requirement: parsed.requirement || prev.requirement,
      quantity: parsed.quantity || prev.quantity,
      companyName: parsed.companyName || prev.companyName,
    }));
    setSmartPasteOpen(false);
    setSmartPasteText("");
    const found = Object.values(parsed).filter(Boolean).length;
    toast({ title: `Extracted ${found} field${found !== 1 ? "s" : ""} from IndiaMart message` });
  };

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

  const handleIndiaMart = () => {
    if (!im.clientName || !im.clientMobile) { toast({ title: "Name and mobile required", variant: "destructive" }); return; }
    importIndiaMart.mutate({
      data: {
        companyName: im.companyName || null, clientName: im.clientName, clientMobile: im.clientMobile,
        email: im.email || null, city: im.city || null, requirement: im.requirement || null,
        quantity: im.quantity || null, salesOwnerId: im.salesOwnerId ? Number(im.salesOwnerId) : null,
      }
    }, {
      onSuccess: (contact) => {
        setImResult({ success: true, contact });
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setIm({ companyName: "", clientName: "", clientMobile: "", email: "", city: "", requirement: "", quantity: "", salesOwnerId: "" });
        setParsePreview(null);
        toast({ title: "Lead imported from IndiaMart" });
      },
      onError: (e: any) => setImResult({ success: false, error: e?.data?.error || "Failed" }),
    });
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Data</h1>
        <p className="text-muted-foreground mt-1">Upload an Excel file, paste data, or add IndiaMart leads</p>
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
              <CardDescription>Paste the full IndiaMart message to auto-fill, or enter details manually</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {smartPasteOpen ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2 text-base">
                      <Sparkles className="h-4 w-4 text-amber-500" />
                      Paste IndiaMart Message
                    </Label>
                    <Button variant="ghost" size="sm" onClick={() => { setSmartPasteOpen(false); setSmartPasteText(""); }}>
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                  </div>
                  <Textarea
                    value={smartPasteText}
                    onChange={e => setSmartPasteText(e.target.value)}
                    data-no-cap="1"
                    placeholder={"Paste the full IndiaMart enquiry message here...\n\nExample:\nHi Manjur Bhatt,\nI am looking for HDPE Liquid Detergent Bottles.\n...\nRegards,\nVaghasiya Rajendrakumar\nClick to call: +91-9723355971\nEmail: example@gmail.com\nSurat - 395006, Gujarat, India"}
                    rows={10}
                    className="font-mono text-sm"
                    autoFocus
                  />
                  <Button onClick={handleSmartParse} disabled={!smartPasteText.trim()} className="w-full">
                    <Sparkles className="h-4 w-4 mr-2" /> Extract & Fill Fields
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full border-dashed border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:border-amber-500 h-12"
                  onClick={() => setSmartPasteOpen(true)}
                >
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  Paste IndiaMart Message — auto-fill all fields
                </Button>
              )}

              {parsePreview && !smartPasteOpen && (
                <div className="text-xs bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
                  <p className="font-medium text-green-700 mb-1">✓ Extracted successfully</p>
                  {parsePreview.clientName && <p><span className="text-green-600">Name: </span>{parsePreview.clientName}</p>}
                  {parsePreview.clientMobile && <p><span className="text-green-600">Mobile: </span>{parsePreview.clientMobile}</p>}
                  {parsePreview.city && <p><span className="text-green-600">City: </span>{parsePreview.city}</p>}
                  {!parsePreview.clientName && <p className="text-amber-600">⚠ Name not detected — please fill manually</p>}
                  {!parsePreview.clientMobile && <p className="text-amber-600">⚠ Mobile not detected — please fill manually</p>}
                  {!parsePreview.city && <p className="text-amber-600">⚠ City not detected — please fill manually</p>}
                </div>
              )}

              {!smartPasteOpen && (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or fill manually</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Client Name <span className="text-destructive">*</span></Label>
                      <Input value={im.clientName} onChange={imF("clientName")} placeholder="Full name" />
                    </div>
                    <div>
                      <Label>Mobile <span className="text-destructive">*</span></Label>
                      <Input value={im.clientMobile} onChange={imF("clientMobile")} placeholder="Mobile number" />
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
                      <Textarea value={im.requirement} onChange={imF("requirement")} placeholder="Product requirement..." rows={3} />
                    </div>
                    <div>
                      <Label>Quantity</Label>
                      <Input value={im.quantity} onChange={imF("quantity")} placeholder="e.g. 3 liter, 500 pcs" />
                    </div>
                  </div>

                  <Button onClick={handleIndiaMart} disabled={importIndiaMart.isPending} className="w-full">
                    <Upload className="h-4 w-4 mr-2" /> {importIndiaMart.isPending ? "Importing..." : "Save Lead"}
                  </Button>

                  {imResult && (
                    <div className={`flex items-start gap-3 p-3 rounded-lg ${imResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                      {imResult.success ? <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" /> : <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />}
                      <div>
                        {imResult.success ? (
                          <><p className="text-sm font-medium text-green-700">Lead imported successfully</p><Link href={`/leads/${imResult.contact.id}`} className="text-xs text-green-600 underline">View {imResult.contact.name} →</Link></>
                        ) : (
                          <p className="text-sm text-red-600">{imResult.error}</p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── EXCEL FILE UPLOAD ── */}
        <TabsContent value="excel-upload">
          <Card>
            <CardHeader>
              <CardTitle>Upload Excel File</CardTitle>
              <CardDescription>Upload a <code>.xlsx</code> or <code>.xls</code> file. The first row must be column headers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex gap-2 p-3 bg-muted/60 rounded-lg text-xs text-muted-foreground">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-foreground">Recognised columns: </span>
                  Name, Mobile, Email, Company, City, Owner, Industry, Unit, Inquiry Date, Last Call Date, Next Call Date, Source, Address, Tags, Notes
                </div>
              </div>

              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${uploadedFile ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFileChange({ target: { files: e.dataTransfer.files } } as any); }}
              >
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
                {uploadedFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileSpreadsheet className="h-8 w-8 text-primary" />
                    <div className="text-left">
                      <p className="font-medium text-sm">{uploadedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{parsedRows ? `${parsedRows.length} rows parsed` : "Parsing..."}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="ml-2" onClick={e => { e.stopPropagation(); setUploadedFile(null); setParsedRows(null); setExcelResult(null); setParseError(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="font-medium text-sm">Click to upload or drag & drop</p>
                    <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls files supported</p>
                  </div>
                )}
              </div>

              {parseError && (
                <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />{parseError}
                </div>
              )}

              {parsedRows && parsedRows.length > 0 && !excelResult && (
                <>
                  <div className="border rounded-lg overflow-hidden text-xs">
                    <div className="bg-muted px-3 py-2 font-medium text-muted-foreground border-b">
                      Preview — first 3 rows of {parsedRows.length}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead><tr>{previewHeaders.map(h => <th key={h} className="px-3 py-2 text-left text-muted-foreground border-r last:border-0">{h}</th>)}</tr></thead>
                        <tbody>{parsedRows.slice(0, 3).map((row, i) => (
                          <tr key={i} className="border-t">
                            {previewHeaders.map(h => <td key={h} className="px-3 py-2 border-r last:border-0 truncate max-w-[120px]">{row[COLUMN_MAP[normalizeHeader(h)] || normalizeHeader(h).replace(/\s+/g,"")] ?? ""}</td>)}
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <Label>Default Sales Owner (if not in file)</Label>
                    <Select value={excelOwner || "none"} onValueChange={v => setExcelOwner(v === "none" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Auto-assign" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Auto-assign</SelectItem>
                        {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={handleExcelUploadImport} disabled={importExcel.isPending} className="w-full">
                    <Upload className="h-4 w-4 mr-2" /> {importExcel.isPending ? "Importing..." : `Import ${parsedRows.length} Leads`}
                  </Button>
                </>
              )}

              {excelResult && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-green-700">Import complete</p>
                    <p className="text-xs text-green-600">
                      {excelResult.imported} imported · {excelResult.skipped ?? 0} skipped · {excelResult.errors ?? 0} errors
                    </p>
                    <Link href="/leads" className="text-xs text-green-600 underline">View all leads →</Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PASTE / JSON ── */}
        <TabsContent value="paste">
          <Card>
            <CardHeader>
              <CardTitle>Paste Tab-Separated or JSON</CardTitle>
              <CardDescription>Paste tab-separated rows (Excel copy-paste) or a JSON array.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                data-no-cap="1"
                placeholder={"Tab-separated (first row = headers):\nName\tMobile\tCity\nJohn Doe\t9876543210\tSurat\n\nOr JSON array:\n[{\"name\":\"John\",\"mobile\":\"9876543210\"}]"}
                rows={8}
                className="font-mono text-sm"
              />
              <div>
                <Label>Default Sales Owner</Label>
                <Select value={pasteOwner || "none"} onValueChange={v => setPasteOwner(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Auto-assign" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Auto-assign</SelectItem>
                    {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handlePasteImport} disabled={!pasteText.trim() || importExcel.isPending} className="w-full">
                <Upload className="h-4 w-4 mr-2" /> {importExcel.isPending ? "Importing..." : "Import"}
              </Button>
              {pasteResult && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-green-700">Import complete: {pasteResult.imported} leads imported</p>
                    <Link href="/leads" className="text-xs text-green-600 underline">View all leads →</Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
