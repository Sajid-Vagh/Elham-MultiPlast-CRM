import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X, File, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
const DOCUMENT_TYPES = [
  "Visiting Card", "GST Certificate", "PAN Card", "Aadhaar",
  "Company Registration", "Purchase Order", "Proforma Invoice PDF",
  "Product Image", "Customer Image", "Payment Receipt", "Signed Agreement",
  "Product Specification", "Catalogue", "Excel File", "Word File", "PDF File", "ZIP File", "Other",
] as const;

const DOCUMENT_CATEGORIES = [
  "Customer Documents", "GST", "PAN", "Purchase Order",
  "Proforma Invoice", "Images", "Payment Proof", "Other Files",
] as const;

interface FileEntry {
  file: File;
  id: string;
  progress: number;
  error?: string;
}

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: number;
  dealId?: number | null;
  proformaInvoiceId?: number | null;
  onSuccess?: () => void;
}

export function DocumentUploadDialog({ open, onOpenChange, contactId, dealId, proformaInvoiceId, onSuccess }: DocumentUploadDialogProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [documentType, setDocumentType] = useState("Other");
  const [category, setCategory] = useState("Customer Documents");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const entries: FileEntry[] = Array.from(newFiles).map(f => ({
      file: f,
      id: Math.random().toString(36).slice(2),
      progress: 0,
    }));
    setFiles(prev => [...prev, ...entries]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);

    const token = localStorage.getItem("crm_token");
    const uploaded: string[] = [];
    let hasError = false;

    for (const entry of files) {
      try {
        const formData = new FormData();
        formData.append("file", entry.file);
        formData.append("contactId", String(contactId));
        formData.append("documentType", documentType);
        formData.append("category", category);
        if (dealId) formData.append("dealId", String(dealId));
        if (proformaInvoiceId) formData.append("proformaInvoiceId", String(proformaInvoiceId));
        formData.append("name", entry.file.name.replace(/\.[^/.]+$/, ""));

        const res = await fetch("/api/documents/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (res.ok) {
          uploaded.push(entry.file.name);
        } else {
          const err = await res.json();
          throw new Error(err.error || "Upload failed");
        }
      } catch (err: any) {
        hasError = true;
        setFiles(prev => prev.map(f => f.id === entry.id ? { ...f, error: err.message } : f));
      }
    }

    setUploading(false);

    if (uploaded.length > 0) {
      const failedFile = files.find(f => f.error);
      const msg = failedFile ? ` (${failedFile.error})` : "";
      toast({ title: `${uploaded.length} file(s) uploaded successfully${msg}` });
      setFiles([]);
      setDocumentType("Other");
      setCategory("Customer Documents");
      onSuccess?.();
      if (!hasError) onOpenChange(false);
    } else {
      const firstErr = files.find(f => f.error);
      toast({ title: "Upload failed", description: firstErr?.error || "Unknown error", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Upload Documents</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          {/* Document type & category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Document Type</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((t: string) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map((c: string) => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" multiple className="hidden" onChange={e => e.target.files && addFiles(e.target.files)} />
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Drag & drop files here, or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">Max 50MB per file</p>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {files.map(entry => (
                <div key={entry.id} className={`flex items-center gap-2 p-2 rounded text-xs border ${entry.error ? "border-red-300 bg-red-50" : ""}`}>
                  <File className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{entry.file.name}</span>
                  <span className="text-muted-foreground">{(entry.file.size / 1024).toFixed(0)}KB</span>
                  {entry.error && <AlertCircle className="h-3 w-3 text-red-500" />}
                  <button onClick={() => removeFile(entry.id)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={uploading}>Cancel</Button>
          <Button size="sm" onClick={handleUpload} disabled={files.length === 0 || uploading}>
            {uploading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Uploading...</> : <><Upload className="h-3 w-3 mr-1" /> Upload {files.length > 0 && `(${files.length})`}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
