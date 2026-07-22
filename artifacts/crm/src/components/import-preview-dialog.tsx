/**
 * Import Preview Dialog — Shows parsed enquiry data with editable fields,
 * confidence highlighting, duplicate warning, product suggestions, and
 * smart category assignment.
 *
 * Green = high confidence (≥80)
 * Yellow = medium confidence (40-79)
 * Red = low / missing (<40)
 */

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { onContactChange } from "@/lib/query-invalidation";
import { useActiveUnits } from "@/lib/use-active-units";
import { PENDING_UNIT_ASSIGNMENT } from "@/lib/unit-constants";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import {
  CheckCircle, AlertCircle, AlertTriangle, Upload, X, Sparkles,
  User, Building2, MapPin, Phone, Mail, Package, Tag, Search,
  FileText, ArrowRight, Copy, RefreshCw, Info,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ParsedLead {
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

interface FieldConfidence {
  [field: string]: number;
}

interface DuplicateInfo {
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
  createdAt: string | null;
  matchType: string;
}

interface ProductMatch {
  productId: number;
  name: string;
  category: string | null;
  materialType: string | null;
  matchScore: number;
  matchReason: string;
}

export interface ImportPreviewData {
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

interface ImportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewData: ImportPreviewData | null;
  loading: boolean;
  onImported: () => void;
  onConfirmImport?: (data: { form: Partial<ParsedLead>; category: string; unit: string | null; salesOwnerId: number | null }) => void;
  users: Array<{ id: number; name: string; profilePhoto?: string | null }> | undefined;
  currentUserId: number | undefined;
  currentUserRole: string | undefined;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function confidenceColor(score: number): string {
  if (score >= 80) return "border-green-300 bg-green-50";
  if (score >= 40) return "border-amber-300 bg-amber-50";
  return "border-red-300 bg-red-50";
}

function confidenceBadge(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "High", color: "bg-green-100 text-green-700 border-green-200" };
  if (score >= 40) return { label: "Medium", color: "bg-amber-100 text-amber-700 border-amber-200" };
  return { label: "Low", color: "bg-red-100 text-red-700 border-red-200" };
}

const CATEGORY_OPTIONS = ["Regular Follow up", "Category A", "Category B", "Category C", "My Client"] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function ImportPreviewDialog({
  open, onOpenChange, previewData, loading, onImported, onConfirmImport,
  users, currentUserId, currentUserRole, }: ImportPreviewDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { units: activeUnits } = useActiveUnits();

  // Editable form state
  const [form, setForm] = useState<Partial<ParsedLead>>({});
  const [category, setCategory] = useState("Regular Follow up");
  const [unit, setUnit] = useState(PENDING_UNIT_ASSIGNMENT);
  const [salesOwnerId, setSalesOwnerId] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [duplicateAction, setDuplicateAction] = useState<"skip" | "merge" | "import_anyway">("skip");

  // Sync form when previewData changes
  useEffect(() => {
    if (previewData) {
      setForm({ ...previewData.finalData });
      setCategory(previewData.suggestedCategory || "Regular Follow up");
      if (previewData.duplicate) setDuplicateAction("skip");
    }
  }, [previewData]);

  // Auto-assign sales user for non-admin
  useEffect(() => {
    if (currentUserRole && currentUserRole !== "admin" && currentUserId) {
      setSalesOwnerId(String(currentUserId));
    }
  }, [currentUserId, currentUserRole]);

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleImport = async () => {
    if (!form.clientName?.trim() || !form.clientMobile?.trim()) {
      toast({ title: "Name and Mobile are required", variant: "destructive" });
      return;
    }

    setImporting(true);
    try {
      // Use callback if provided (original import flow), otherwise fall back to /import/confirm
      if (onConfirmImport) {
        onConfirmImport({
          form,
          category,
          unit: unit === PENDING_UNIT_ASSIGNMENT ? null : unit || null,
          salesOwnerId: currentUserRole !== "admin" && currentUserId ? currentUserId : (salesOwnerId ? Number(salesOwnerId) : null),
        });
        toast({ title: `Lead "${form.clientName}" imported successfully!` });
        onOpenChange(false);
        onImported();
        return;
      }

      const result = await customFetch<any>("/import/confirm", {
        method: "POST",
        body: JSON.stringify({
          finalData: {
            clientName: form.clientName,
            clientMobile: form.clientMobile,
            email: form.email || null,
            companyName: form.companyName || null,
            city: form.city || null,
            state: form.state || null,
            requirement: form.requirement || null,
            quantity: form.quantity || null,
            address: form.address || null,
            gstNumber: form.gstNumber || null,
            industry: form.industry || null,
          },
          salesOwnerId: currentUserRole !== "admin" && currentUserId ? currentUserId : (salesOwnerId ? Number(salesOwnerId) : null),
          unit: unit === PENDING_UNIT_ASSIGNMENT ? null : unit || null,
          category,
          duplicateAction: previewData?.duplicate ? duplicateAction : "skip",
          duplicateContactId: previewData?.duplicate?.contactId || null,
        }),
      });

      toast({ title: `Lead "${form.clientName}" imported successfully!` });
      onContactChange(queryClient);
      onOpenChange(false);
      onImported();
    } catch (err: any) {
      if (err?.status === 409) {
        toast({ title: "Duplicate detected", description: err?.data?.error || "Contact already exists", variant: "destructive" });
      } else {
        toast({ title: "Import failed", description: err?.message || "Unknown error", variant: "destructive" });
      }
    } finally {
      setImporting(false);
    }
  };

  // Copy missing fields from original parsed data
  const restoreParsed = () => {
    if (previewData?.parsedData) {
      setForm(prev => {
        const restored = { ...prev };
        for (const [key, val] of Object.entries(previewData.parsedData)) {
          if (val && !(restored as any)[key]) (restored as any)[key] = val;
        }
        return restored;
      });
      toast({ title: "Restored original parsed values" });
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh]">
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <p className="text-sm text-muted-foreground">Parsing enquiry with multi-layer engine...</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!previewData) return null;

  const conf = previewData.confidence;
  const overallBadge = confidenceBadge(previewData.overallConfidence);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Import Preview
          </DialogTitle>
          <DialogDescription>
            Multi-layer parsed result — edit any field before importing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Confidence Summary */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge className={overallBadge.color}>
              {previewData.overallConfidence}% confidence
            </Badge>
            <Badge variant="outline" className="text-xs">
              Parser: {previewData.parserVersion}
            </Badge>
            {previewData.suggestedProducts.length > 0 && (
              <Badge variant="outline" className="text-xs border-blue-200 text-blue-700">
                <Package className="h-3 w-3 mr-1" />
                {previewData.suggestedProducts.length} product match{previewData.suggestedProducts.length > 1 ? "es" : ""}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={restoreParsed} className="ml-auto text-xs">
              <RefreshCw className="h-3 w-3 mr-1" />
              Restore Parsed
            </Button>
          </div>

          {/* Duplicate Warning */}
          {previewData.duplicate?.exists && (
            <Card className="border-amber-300 bg-amber-50">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-amber-800">Duplicate Detected ({previewData.duplicate.matchType})</p>
                    <p className="text-amber-700">
                      {previewData.duplicate.customerName}
                      {previewData.duplicate.companyName ? ` — ${previewData.duplicate.companyName}` : ""}
                      {previewData.duplicate.ownerName ? ` (Owner: ${previewData.duplicate.ownerName})` : ""}
                    </p>
                    {previewData.duplicate.contactId && (
                      <a href={`/leads/${previewData.duplicate.contactId}`} target="_blank" className="text-xs text-amber-600 underline">
                        View existing lead →
                      </a>
                    )}
                    <div className="mt-2">
                      <Select value={duplicateAction} onValueChange={v => setDuplicateAction(v as any)}>
                        <SelectTrigger className="h-8 w-auto text-xs bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">Skip (don't import)</SelectItem>
                          <SelectItem value="merge">Merge into existing</SelectItem>
                          <SelectItem value="import_anyway">Import anyway (new lead)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Product Suggestions */}
          {previewData.suggestedProducts.length > 0 && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="p-3">
                <p className="text-xs font-medium text-blue-800 mb-2 flex items-center gap-1">
                  <Package className="h-3 w-3" />
                  Matching Products from Master
                </p>
                <div className="space-y-1">
                  {previewData.suggestedProducts.slice(0, 3).map(p => (
                    <div key={p.productId} className="flex items-center gap-2 text-xs text-blue-700">
                      <span className="font-mono bg-blue-100 px-1.5 py-0.5 rounded">{p.matchScore}%</span>
                      <span className="font-medium">{p.name}</span>
                      {p.materialType && <span className="text-blue-500">({p.materialType})</span>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Editable Fields Grid */}
          <div className="grid grid-cols-2 gap-3">
            <FieldInput
              label="Client Name" required icon={<User className="h-3.5 w-3.5" />}
              value={form.clientName || ""} onChange={v => updateField("clientName", v)}
              confidence={conf.clientName}
            />
            <FieldInput
              label="Mobile" required icon={<Phone className="h-3.5 w-3.5" />}
              value={form.clientMobile || ""} onChange={v => updateField("clientMobile", v)}
              confidence={conf.clientMobile} noCap
            />
            <FieldInput
              label="Company" icon={<Building2 className="h-3.5 w-3.5" />}
              value={form.companyName || ""} onChange={v => updateField("companyName", v)}
              confidence={conf.companyName}
            />
            <FieldInput
              label="Email" icon={<Mail className="h-3.5 w-3.5" />}
              value={form.email || ""} onChange={v => updateField("email", v)}
              confidence={conf.email} noCap
            />
            <FieldInput
              label="City" icon={<MapPin className="h-3.5 w-3.5" />}
              value={form.city || ""} onChange={v => updateField("city", v)}
              confidence={conf.city}
            />
            <FieldInput
              label="State" icon={<MapPin className="h-3.5 w-3.5" />}
              value={form.state || ""} onChange={v => updateField("state", v)}
              confidence={conf.state}
            />
            <FieldInput
              label="GST Number" icon={<FileText className="h-3.5 w-3.5" />}
              value={form.gstNumber || ""} onChange={v => updateField("gstNumber", v)}
              confidence={conf.gstNumber || 0}
            />
            <FieldInput
              label="Industry" icon={<Tag className="h-3.5 w-3.5" />}
              value={form.industry || ""} onChange={v => updateField("industry", v)}
              confidence={conf.industry || 0}
            />
          </div>

          <div>
            <Label className="text-xs">Requirement</Label>
            <Textarea
              value={form.requirement || ""} onChange={e => updateField("requirement", e.target.value)}
              placeholder="Product requirement, specifications..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FieldInput label="Quantity" value={form.quantity || ""} onChange={v => updateField("quantity", v)} confidence={conf.quantity || 0} />
            <FieldInput label="Material" value={form.material || ""} onChange={v => updateField("material", v)} confidence={0} />
            <FieldInput label="Capacity" value={form.capacity || ""} onChange={v => updateField("capacity", v)} confidence={0} />
            <FieldInput label="Bottle Type" value={form.bottleType || ""} onChange={v => updateField("bottleType", v)} confidence={0} />
            <FieldInput label="Colour" value={form.colour || ""} onChange={v => updateField("colour", v)} confidence={0} />
            <FieldInput label="Weight" value={form.weight || ""} onChange={v => updateField("weight", v)} confidence={0} />
          </div>

          <div>
            <Label className="text-xs">Address</Label>
            <Textarea
              value={form.address || ""} onChange={e => updateField("address", e.target.value)}
              placeholder="Full address..."
              rows={2}
            />
          </div>

          {/* Assignment */}
          <div className="grid grid-cols-3 gap-3 border-t pt-3">
            <div>
              <Label className="text-xs">Sales Owner</Label>
              {currentUserRole === "admin" ? (
                <Select value={salesOwnerId || "none"} onValueChange={v => setSalesOwnerId(v === "none" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Auto-assign</SelectItem>
                    {users?.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <div className="h-8 px-2 rounded border bg-muted flex items-center text-xs text-muted-foreground">
                  {users?.find(u => u.id === currentUserId)?.name || "You"} (auto)
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Unit</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={PENDING_UNIT_ASSIGNMENT}>{PENDING_UNIT_ASSIGNMENT}</SelectItem>
                  {activeUnits.filter(u => u !== PENDING_UNIT_ASSIGNMENT).map(u => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-muted/30">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || !form.clientName?.trim() || !form.clientMobile?.trim()}
            className="min-w-[140px]"
          >
            {importing ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" /> Importing...</>
            ) : (
              <><Upload className="h-4 w-4 mr-2" /> Import Lead</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Field Input Component ──────────────────────────────────────────────────

function FieldInput({
  label, value, onChange, confidence, icon, required, noCap,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  confidence?: number;
  icon?: React.ReactNode;
  required?: boolean;
  noCap?: boolean;
}) {
  const borderColor = confidence !== undefined ? (
    confidence >= 80 ? "border-green-300 focus:border-green-500 focus:ring-green-200" :
    confidence >= 40 ? "border-amber-300 focus:border-amber-500 focus:ring-amber-200" :
    "border-red-300 focus:border-red-500 focus:ring-red-200"
  ) : "";

  return (
    <div>
      <Label className="text-xs flex items-center gap-1">
        {icon}
        {label}
        {required && <span className="text-destructive">*</span>}
        {confidence !== undefined && (
          <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded ${
            confidence >= 80 ? "bg-green-100 text-green-700" :
            confidence >= 40 ? "bg-amber-100 text-amber-700" :
            "bg-red-100 text-red-700"
          }`}>
            {confidence}%
          </span>
        )}
      </Label>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`h-8 text-xs ${borderColor}`}
        data-no-cap={noCap ? "1" : undefined}
      />
    </div>
  );
}
