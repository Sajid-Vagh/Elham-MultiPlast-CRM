import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ZoomIn, ZoomOut, X, Search } from "lucide-react";

interface DocumentViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: {
    id: number;
    name: string;
    originalName: string;
    fileExtension: string;
    mimeType?: string;
    storagePath: string;
  };
}

export function DocumentViewer({ open, onOpenChange, document: doc }: DocumentViewerProps) {
  const [zoom, setZoom] = useState(1);
  const isImage = [".jpg", ".jpeg", ".png", ".webp"].includes(doc.fileExtension?.toLowerCase() || "");
  const isPdf = doc.fileExtension?.toLowerCase() === ".pdf";
  const token = typeof window !== "undefined" ? localStorage.getItem("crm_token") : null;
  const previewUrl = `/api/documents/${doc.id}/preview`;
  const downloadUrl = `/api/documents/${doc.id}/download`;

  const handleDownload = async () => {
    try {
      const res = await fetch(downloadUrl, {
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

  if (!isImage && !isPdf) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{doc.name}</DialogTitle></DialogHeader>
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground mb-4">Preview not available for this file type.</p>
            <Button size="sm" onClick={handleDownload}>
              <Download className="h-3 w-3 mr-1" /> Download File
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-4xl max-h-[90vh] ${isPdf ? "h-[90vh]" : ""}`}>
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="text-sm truncate max-w-md">{doc.name}</DialogTitle>
          <div className="flex items-center gap-1">
            {isImage && (
              <>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}>
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setZoom(z => Math.min(3, z + 0.25))}>
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto flex items-center justify-center bg-muted/30 rounded-lg min-h-[300px]">
          {isImage ? (
            <img
              src={previewUrl}
              alt={doc.name}
              className="max-w-full max-h-[70vh] object-contain transition-transform duration-200"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
              crossOrigin="anonymous"
            />
          ) : isPdf ? (
            <iframe
              src={previewUrl}
              className="w-full h-full min-h-[70vh] rounded"
              title={doc.name}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
