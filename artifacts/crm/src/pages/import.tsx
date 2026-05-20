import { useState } from "react";
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
import { CheckCircle, AlertCircle, Upload } from "lucide-react";
import { Link } from "wouter";

export default function ImportPage() {
  const { data: users } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const importIndiaMart = useImportIndiaMart();
  const importExcel = useImportExcel();

  const [im, setIm] = useState({ companyName: "", clientName: "", clientMobile: "", email: "", city: "", requirement: "", quantity: "", salesOwnerId: "" });
  const imF = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setIm(p => ({ ...p, [k]: e.target.value }));
  const [imResult, setImResult] = useState<any>(null);

  const [excelText, setExcelText] = useState("");
  const [excelOwner, setExcelOwner] = useState("");
  const [excelResult, setExcelResult] = useState<any>(null);

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

  const handleExcel = () => {
    let rows: any[] = [];
    try {
      const text = excelText.trim();
      if (text.startsWith("[")) {
        rows = JSON.parse(text);
      } else {
        const lines = text.split("\n").filter(Boolean);
        const headers = lines[0]?.split("\t").map(h => h.trim().toLowerCase().replace(/\s+/g, ""));
        rows = lines.slice(1).map(line => {
          const vals = line.split("\t");
          const obj: any = {};
          headers?.forEach((h, i) => { obj[h] = vals[i]?.trim() || null; });
          const nameMap: Record<string, string> = { "name": "name", "clientname": "name", "mobile": "mobile", "mobilenumber": "mobile", "phone": "mobile", "email": "email", "emailid": "email", "company": "companyName", "companyname": "companyName", "city": "city", "owner": "salesOwnerName", "salesowner": "salesOwnerName", "inquirydate": "inquiryDate", "lastcall": "lastCallDate", "lastcalldate": "lastCallDate", "nextcall": "nextCallDate", "nextcalldate": "nextCallDate", "industry": "industry", "unit": "unit", "notes": "notes" };
          const mapped: any = {};
          Object.entries(obj).forEach(([k, v]) => { const norm = nameMap[k] || k; mapped[norm] = v; });
          return mapped;
        });
      }
    } catch (e) {
      toast({ title: "Invalid format", variant: "destructive" }); return;
    }
    importExcel.mutate({ data: { rows, defaultSalesOwnerId: excelOwner ? Number(excelOwner) : null } }, {
      onSuccess: (result) => {
        setExcelResult(result);
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
        <p className="text-muted-foreground mt-1">Add leads from IndiaMart or paste your Excel data</p>
      </div>

      <Tabs defaultValue="indiamart">
        <TabsList><TabsTrigger value="indiamart">IndiaMart Lead</TabsTrigger><TabsTrigger value="excel">Excel / Bulk Import</TabsTrigger></TabsList>

        <TabsContent value="indiamart">
          <Card>
            <CardHeader>
              <CardTitle>IndiaMart Lead</CardTitle>
              <CardDescription>Paste lead details directly from IndiaMart enquiry</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Client Name <span className="text-destructive">*</span></Label><Input value={im.clientName} onChange={imF("clientName")} placeholder="Full name" /></div>
                <div><Label>Mobile <span className="text-destructive">*</span></Label><Input value={im.clientMobile} onChange={imF("clientMobile")} placeholder="Mobile number" /></div>
                <div><Label>Company Name</Label><Input value={im.companyName} onChange={imF("companyName")} placeholder="Optional" /></div>
                <div><Label>Email</Label><Input value={im.email} onChange={imF("email")} placeholder="Optional" /></div>
                <div><Label>City</Label><Input value={im.city} onChange={imF("city")} placeholder="City" /></div>
                <div><Label>Sales Owner</Label>
                  <Select value={im.salesOwnerId || "none"} onValueChange={v => setIm(p => ({ ...p, salesOwnerId: v === "none" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Auto-assign</SelectItem>
                      {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}><span className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: u.colorCode }} />{u.name}</span></SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Label>Requirement + Quantity</Label>
                  <div className="flex gap-2">
                    <Input value={im.requirement} onChange={imF("requirement")} placeholder="Product requirement..." className="flex-1" />
                    <Input value={im.quantity} onChange={imF("quantity")} placeholder="Qty" className="w-24" />
                  </div>
                </div>
              </div>
              <Button onClick={handleIndiaMart} disabled={importIndiaMart.isPending} className="w-full">
                <Upload className="h-4 w-4 mr-2" /> {importIndiaMart.isPending ? "Importing..." : "Import Lead"}
              </Button>
              {imResult && (
                <div className={`flex items-start gap-3 p-3 rounded-md ${imResult.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                  {imResult.success ? <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" /> : <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />}
                  <div>
                    {imResult.success ? (
                      <><p className="text-sm font-medium text-green-700">Lead imported successfully</p><Link href={`/leads/${imResult.contact.id}`} className="text-xs text-green-600 underline">View {imResult.contact.name}</Link></>
                    ) : (
                      <p className="text-sm text-red-600">{imResult.error}</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="excel">
          <Card>
            <CardHeader>
              <CardTitle>Excel / Bulk Import</CardTitle>
              <CardDescription>Paste tab-separated data (copy from Excel) or JSON array. Columns: name, mobile, email, company, city, owner, inquiryDate, lastCallDate, nextCallDate, industry, unit</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Default Sales Owner (for rows without owner)</Label>
                <Select value={excelOwner || "none"} onValueChange={v => setExcelOwner(v === "none" ? "" : v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select default owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Paste Data</Label>
                <Textarea value={excelText} onChange={e => setExcelText(e.target.value)} placeholder={"name\tmobile\tcity\n\nOR paste JSON: [{\"name\":\"...\",\"mobile\":\"...\"}]"} rows={10} className="font-mono text-sm mt-1" />
              </div>
              <Button onClick={handleExcel} disabled={importExcel.isPending || !excelText.trim()} className="w-full">
                <Upload className="h-4 w-4 mr-2" /> {importExcel.isPending ? "Importing..." : "Import"}
              </Button>
              {excelResult && (
                <div className="p-3 bg-muted rounded-md text-sm space-y-1">
                  <p className="font-medium">Import Result</p>
                  <p className="text-green-600">Imported: {excelResult.imported}</p>
                  <p className="text-muted-foreground">Skipped: {excelResult.skipped}</p>
                  {excelResult.duplicates?.length > 0 && <p className="text-amber-600">Duplicates: {excelResult.duplicates.join(", ")}</p>}
                  {excelResult.errors?.length > 0 && <p className="text-destructive">Errors: {excelResult.errors.join(", ")}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
