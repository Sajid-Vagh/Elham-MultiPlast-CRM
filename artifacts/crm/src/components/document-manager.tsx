import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, Eye, Trash2, File, FileImage, FileText, Archive, Replace, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DocumentUploadDialog } from "./document-upload-dialog";
import { DocumentViewer } from "./document-viewer";
const DOCUMENT_TYPES = [
  "Visiting Card", "GST Certificate", "PAN Card", "Aadhaar",
  "Company Registration", "Purchase Order", "Quotation", "Proforma Invoice PDF",
  "Product Image", "Customer Image", "Payment Receipt", "Signed Agreement",
  "Product Specification", "Catalogue", "Excel File", "Word File", "PDF File", "ZIP File", "Other",
] as const;

const DOCUMENT_CATEGORIES = [
  "Customer Documents", "GST", "PAN", "Quotation", "Purchase Order",
  "Proforma Invoice", "Images", "Payment Proof", "Other Files",
] as const;
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Document {
  id: number;
  name: string;
  originalName: string;
  documentType: string;
  category: string;
  fileExtension: string;
  mimeType?: string;
  fileSize: string;
  version: number;
  storagePath: string;
  uploadedBy: number;
  updatedBy?: number;
  uploadedByUser?: { id: number; name: string } | null;
  updatedByUser?: { id: number; name: string } | null;
  createdAt: string;
  updatedAt?: string;
}

interface DocumentManagerProps {
  contactId: number;
  dealId?: number | null;
  proformaInvoiceId?: number | null;
  compact?: boolean;
}

const FILE_ICONS: Record<string, string> = {
  ".jpg": "image", ".jpeg": "image", ".png": "image", ".webp": "image",
  ".pdf": "pdf",
  ".zip": "archive", ".rar": "archive", ".7z": "archive",
};

function FileIcon({ ext }: { ext?: string }) {
  const type = FILE_ICONS[ext?.toLowerCase() || ""];
  if (type === "image") return <FileImage className="h-4 w-4 text-blue-500" />;
  if (type === "pdf") return <FileText className="h-4 w-4 text-red-500" />;
  if (type === "archive") return <Archive className="h-4 w-4 text-yellow-600" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

const CATEGORY_COLORS: Record<string, string> = {
  "GST": "bg-orange-100 text-orange-700",
  "PAN": "bg-purple-100 text-purple-700",
  "Quotation": "bg-blue-100 text-blue-700",
  "Purchase Order": "bg-green-100 text-green-700",
  "Proforma Invoice": "bg-indigo-100 text-indigo-700",
  "Images": "bg-pink-100 text-pink-700",
  "Payment Proof": "bg-emerald-100 text-emerald-700",
  "Customer Documents": "bg-gray-100 text-gray-700",
  "Other Files": "bg-slate-100 text-slate-700",
};

export function DocumentManager({ contactId, dealId, proformaInvoiceId, compact }: DocumentManagerProps) {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewDoc, setViewDoc] = useState<Document | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<Document | null>(null);
  const [replaceDoc, setReplaceDoc] = useState<Document | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [search, setSearch] = useState("");
  const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ contactId: String(contactId), pageSize: "50" });
      if (filterType !== "all") params.set("documentType", filterType);
      if (search) params.set("search", search);
      const res = await fetch(`/api/documents?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.data || []);
      }
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchDocuments(); }, [contactId, filterType]);

  const handleDelete = async () => {
    if (!deleteDoc) return;
    try {
      const res = await fetch(`/api/documents/${deleteDoc.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast({ title: "Document deleted" });
        setDeleteDoc(null);
        fetchDocuments();
      } else {
        const err = await res.json().catch(() => ({ error: "Delete failed" }));
        toast({ title: "Delete failed", description: err.error, variant: "destructive" });
      }
    } catch (e: any) { toast({ title: "Delete failed", description: e?.message, variant: "destructive" }); }
  };

  const handleReplace = async () => {
    if (!replaceDoc) return;
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch(`/api/documents/${replaceDoc.id}/replace`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (res.ok) {
          toast({ title: "Document replaced" });
          setReplaceDoc(null);
          fetchDocuments();
        } else {
          const err = await res.json().catch(() => ({ error: "Replace failed" }));
          toast({ title: "Replace failed", description: err.error, variant: "destructive" });
        }
      } catch (e: any) { toast({ title: "Replace failed", description: e?.message, variant: "destructive" }); }
    };
    input.click();
  };
  
  const handleDownload = async (doc: Document) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.originalName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  const filtered = documents.filter(d =>
    search ? d.name.toLowerCase().includes(search.toLowerCase()) || d.documentType.toLowerCase().includes(search.toLowerCase()) : true
  );

  const displayed = compact ? filtered.slice(0, 5) : filtered;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[120px]">
            <Input
              placeholder="Search documents..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Types</SelectItem>
              {DOCUMENT_TYPES.map((t: string) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="default" className="h-8 text-xs" onClick={() => setUploadOpen(true)}>
            <Upload className="h-3 w-3 mr-1" /> Upload
          </Button>
        </div>
      )}

      {!compact && (
        <Button size="sm" variant="default" className="h-8 text-xs w-full" onClick={() => setUploadOpen(true)}>
          <Upload className="h-3 w-3 mr-1" /> Upload Documents
        </Button>
      )}

      {/* Document list */}
      {loading ? (
        <p className="text-xs text-muted-foreground text-center py-4">Loading...</p>
      ) : displayed.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {displayed.map(doc => (
            <div key={doc.id} className="flex items-center gap-2 p-2 border rounded-md text-xs hover:bg-muted/50 transition-colors">
              <FileIcon ext={doc.fileExtension} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium truncate">{doc.name}</span>
                  <Badge className={`text-[10px] px-1 py-0 ${CATEGORY_COLORS[doc.category] || "bg-gray-100 text-gray-700"}`}>{doc.category}</Badge>
                  {doc.version > 1 && <Badge variant="outline" className="text-[10px] px-1 py-0">v{doc.version}</Badge>}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <span>{doc.documentType}</span>
                  <span>{doc.fileSize ? `${(Number(doc.fileSize) / 1024).toFixed(0)}KB` : ""}</span>
                  <span>{doc.uploadedByUser?.name || `User #${doc.uploadedBy}`}</span>
                  <span>{new Date(doc.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" onClick={() => setViewDoc(doc)} title="Preview">
                  <Eye className="h-3.5 w-3.5" />
                </button>
                <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" onClick={() => handleDownload(doc)} title="Download">
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground" onClick={() => setReplaceDoc(doc)} title="Replace">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600" onClick={() => setDeleteDoc(doc)} title="Delete (Admin)">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {compact && documents.length > 5 && (
            <p className="text-xs text-blue-600 text-center mt-1">+{documents.length - 5} more documents</p>
          )}
        </div>
      )}

      {/* Upload dialog */}
      <DocumentUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        contactId={contactId}
        dealId={dealId}
        proformaInvoiceId={proformaInvoiceId}
        onSuccess={fetchDocuments}
      />

      {/* Document Viewer */}
      {viewDoc && (
        <DocumentViewer
          open={!!viewDoc}
          onOpenChange={(open) => { if (!open) setViewDoc(null); }}
          document={viewDoc}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteDoc} onOpenChange={(open) => { if (!open) setDeleteDoc(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteDoc?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This will soft-delete the document. Admin can restore if needed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
