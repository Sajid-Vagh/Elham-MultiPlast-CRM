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

// ── IndiaMart message parser ──────────────────────────────────────────────────
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

  const result: Partial<ParsedLead> = {};

  // ── Name: line after "Regards," or "Regards" ──
  const regardsIdx = lines.findIndex(l => /^regards[,.]?\s*$/i.test(l));
  if (regardsIdx >= 0 && regardsIdx + 1 < lines.length) {
    let nameLine = lines[regardsIdx + 1];
    // strip "tickicon" prefix if present
    nameLine = nameLine.replace(/^tickicon\s*/i, "").trim();
    if (nameLine && !/click to call|email:|@/i.test(nameLine)) {
      result.clientName = nameLine;
    }
  }

  // ── Mobile: look for "+91" pattern or "click to call" ──
  for (const line of lines) {
    const mobileMatch = line.match(/(?:click to call[:\s]*)?(\+?91[-\s]?\d{5}[-\s]?\d{5}|\+?91\d{10}|\b[6-9]\d{9}\b)/i);
    if (mobileMatch) {
      // normalise: strip spaces/dashes, keep +91 prefix or add it
      let m = mobileMatch[1]!.replace(/[-\s]/g, "");
      if (m.startsWith("+91")) m = m.slice(3);
      if (m.startsWith("91") && m.length === 12) m = m.slice(2);
      result.clientMobile = m;
      break;
    }
  }

  // ── Email ──
  for (const line of lines) {
    const emailMatch = line.match(/(?:email[:\s]+)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
    if (emailMatch) {
      result.email = emailMatch[1]!;
      break;
    }
  }

  // ── City: look for "City, State - pincode" or "City - pincode" pattern ──
  for (const line of lines) {
    // "Surat - 395006, Gujarat, India" or "Surat, Gujarat - 395006"
    const cityMatch = line.match(/^([A-Za-z\s]+?)(?:\s*[-–]\s*\d{6}|\s*,\s*\d{6}|\s*,\s*[A-Za-z\s]+?,\s*India)/i);
    if (cityMatch) {
      const city = cityMatch[1]!.trim();
      // skip lines that look like names
      if (city.split(" ").length <= 3 && !/regards|email|call|click/i.test(city)) {
        result.city = city;
        break;
      }
    }
  }

  // ── Requirement: "I am looking for X" ──
  for (const line of lines) {
    const reqMatch = line.match(/i(?:'?m| am) looking for (.+?)\.?\s*$/i);
    if (reqMatch) {
      result.requirement = reqMatch[1]!.trim();
      break;
    }
  }

  // ── Build requirement detail from table rows (Key : Value pairs) ──
  const tableRows: string[] = [];
  for (const line of lines) {
    // "Material : HDPE" or "Bottle Design\t:\tAriel Style"
    const tableMatch = line.match(/^([A-Za-z][A-Za-z\s\/]{1,40}?)\s*[:\t]+\s*(.+)$/);
    if (tableMatch) {
      const key = tableMatch[1]!.trim();
      const val = tableMatch[2]!.trim();
      // skip lines that are clearly contact info
      if (!/email|mobile|phone|call|regards|india/i.test(key)) {
        tableRows.push(`${key}: ${val}`);
      }
    }
  }
  if (tableRows.length > 0) {
    const base = result.requirement ? `${result.requirement}\n` : "";
    result.requirement = base + tableRows.join("\n");
  }

  // ── Quantity: look for a quantity line or Buyer Filled Details ──
  for (const line of lines) {
    const qtyMatch = line.match(/(?:buyer filled details|quantity|qty)[:\s]+(.+)/i);
    if (qtyMatch) {
      result.quantity = qtyMatch[1]!.trim();
      break;
    }
    // standalone "3 liter" / "500 pcs" style
    const standaloneQty = line.match(/^(\d+[\d,.]*\s*(?:liter|litre|l|kg|pcs|units?|nos?|pieces?|ml|dozen)s?)/i);
    if (standaloneQty && !result.quantity) {
      result.quantity = standaloneQty[1]!.trim();
    }
  }

  return result;
}

// ── Excel column mapping ───────────────────────────────────────────────────────
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

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

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

  // IndiaMart form
  const [im, setIm] = useState({ companyName: "", clientName: "", clientMobile: "", email: "", city: "", requirement: "", quantity: "", salesOwnerId: "" });
  const [smartPasteText, setSmartPasteText] = useState("");
  const [smartPasteOpen, setSmartPasteOpen] = useState(false);
  const [imResult, setImResult] = useState<any>(null);

  const imF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setIm(p => ({ ...p, [k]: e.target.value }));

  const handleSmartParse = () => {
    if (!smartPasteText.trim()) return;
    const parsed = parseIndiaMartMessage(smartPasteText);
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
    toast({ title: "Fields filled from IndiaMart message" });
  };

  // Excel upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[] | null>(null);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [excelOwner, setExcelOwner] = useState("");
  const [excelResult, setExcelResult] = useState<any>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Paste fallback
  const [pasteText, setPasteText] = useState("");
  const [pasteOwner, setPasteOwner] = useState("");
  const [pasteResult, setPasteResult] = useState<any>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setParsedRows(null);
    setParseError(null);
    setExcelResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]!]!;
        const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (!raw || raw.length < 2) {
          setParseError("The sheet is empty or has no data rows.");
          return;
        }

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
    importExcel.mutate({
      data: {
        rows: parsedRows,
        defaultSalesOwnerId: excelOwner ? Number(excelOwner) : null,
      }
    }, {
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
              <CardDescription>
                Paste the full IndiaMart message to auto-fill, or enter details manually
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Smart paste area */}
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
                      <Input value={im.email} onChange={imF("email")} placeholder="Optional" />
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
                    <div className={`flex items-start gap-3 p-3 rounded-md ${imResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
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
              <CardDescription>
                Upload a <code>.xlsx</code> or <code>.xls</code> file. The first row must be column headers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">

              <div className="flex gap-2 p-3 bg-muted/60 rounded-md text-xs text-muted-foreground">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-foreground">Recognised columns: </span>
                  Name, Mobile, Email, Company, City, Owner, Industry, Unit, Inquiry Date, Last Call Date, Next Call Date, Source, Address, Tags, Notes
                </div>
              </div>

              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${uploadedFile ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  handleFileChange({ target: { files: e.dataTransfer.files } } as any);
                }}
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
                <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  {parseError}
                </div>
              )}

              {parsedRows && parsedRows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Preview (first 3 rows)</p>
                  <div className="overflow-x-auto border rounded-md">
                    <table className="text-xs w-full">
                      <thead className="bg-muted">
                        <tr>
                          {previewHeaders.map(h => <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.slice(0, 3).map((row, i) => (
                          <tr key={i} className="border-t">
                            {previewHeaders.map(h => {
                              const key = COLUMN_MAP[normalizeHeader(h)] || normalizeHeader(h).replace(/\s+/g, "");
                              return <td key={h} className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{row[key] ?? ""}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">{parsedRows.length} total rows</p>
                </div>
              )}

              {parsedRows && (
                <div>
                  <Label>Default Sales Owner <span className="text-muted-foreground text-xs">(used when Owner column is blank)</span></Label>
                  <Select value={excelOwner || "none"} onValueChange={v => setExcelOwner(v === "none" ? "" : v)}>
                    <SelectTrigger className="mt-1 w-56"><SelectValue placeholder="Select default owner" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (skip rows without owner)</SelectItem>
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
              )}

              <Button
                onClick={handleExcelUploadImport}
                disabled={importExcel.isPending || !parsedRows?.length}
                className="w-full"
              >
                <Upload className="h-4 w-4 mr-2" />
                {importExcel.isPending ? "Importing..." : `Import ${parsedRows?.length ?? 0} Rows`}
              </Button>

              {excelResult && (
                <div className="p-3 bg-muted rounded-md text-sm space-y-1">
                  <p className="font-medium flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-600" /> Import Complete</p>
                  <p className="text-green-600">✓ Imported: <strong>{excelResult.imported}</strong></p>
                  {excelResult.skipped > 0 && <p className="text-muted-foreground">⊘ Skipped: {excelResult.skipped}</p>}
                  {excelResult.duplicates?.length > 0 && <p className="text-amber-600">⚠ Duplicates: {excelResult.duplicates.join(", ")}</p>}
                  {excelResult.errors?.length > 0 && <p className="text-destructive">✗ Errors: {excelResult.errors.join("; ")}</p>}
                  <Link href="/leads" className="text-primary text-xs underline block mt-1">View all leads →</Link>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PASTE ── */}
        <TabsContent value="paste">
          <Card>
            <CardHeader>
              <CardTitle>Paste Data</CardTitle>
              <CardDescription>Copy rows from Excel and paste here (tab-separated), or paste a JSON array</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Default Sales Owner</Label>
                <Select value={pasteOwner || "none"} onValueChange={v => setPasteOwner(v === "none" ? "" : v)}>
                  <SelectTrigger className="mt-1 w-56"><SelectValue placeholder="Select default owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Paste Data</Label>
                <Textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={"Name\tMobile\tCity\tOwner\nRajesh Shah\t9876543210\tSurat\tRavi Patel\n\nOR paste JSON:\n[{\"name\":\"Rajesh Shah\",\"mobile\":\"9876543210\"}]"} rows={10} className="font-mono text-sm mt-1" />
              </div>
              <Button onClick={handlePasteImport} disabled={importExcel.isPending || !pasteText.trim()} className="w-full">
                <Upload className="h-4 w-4 mr-2" /> {importExcel.isPending ? "Importing..." : "Import"}
              </Button>
              {pasteResult && (
                <div className="p-3 bg-muted rounded-md text-sm space-y-1">
                  <p className="font-medium">Import Result</p>
                  <p className="text-green-600">Imported: {pasteResult.imported}</p>
                  {pasteResult.skipped > 0 && <p className="text-muted-foreground">Skipped: {pasteResult.skipped}</p>}
                  {pasteResult.duplicates?.length > 0 && <p className="text-amber-600">Duplicates: {pasteResult.duplicates.join(", ")}</p>}
                  {pasteResult.errors?.length > 0 && <p className="text-destructive">Errors: {pasteResult.errors.join("; ")}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
