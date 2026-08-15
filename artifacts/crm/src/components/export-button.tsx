import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExportButtonProps {
  exportUrl: string;
  filename?: string;
  disabled?: boolean;
  onBeforeExport?: () => Record<string, string>;
  label?: string;
}

// Single-click "Detailed Export" button. Immediately downloads the complete
// Excel report (mode=detailed) — no Quick/Detailed dropdown, no format picker.
// Used on standard pages (Leads, Deals, Activities, Existing Customers,
// Dispatch). The Reports page keeps its own Quick/Detailed dropdown.
export function ExportButton({
  exportUrl,
  filename = "export",
  disabled = false,
  onBeforeExport,
  label = "Export",
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const doExport = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      params.set("mode", "detailed");
      params.set("format", "xlsx");

      if (onBeforeExport) {
        const extra = onBeforeExport();
        Object.entries(extra).forEach(([k, v]) => {
          if (v) params.set(k, v);
        });
      }

      const url = `${exportUrl}?${params.toString()}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Export failed");
      }

      const blob = await res.blob();
      const date = new Date().toISOString().split("T")[0];
      const fname = `${filename}_${date}.xlsx`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      toast({ title: "Export completed", description: `Detailed XLSX downloaded.` });
    } catch (err: any) {
      console.error("Export error:", err);
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [exportUrl, filename, onBeforeExport, toast]);

  return (
    <Button variant="outline" size="sm" onClick={doExport} disabled={disabled || loading}>
      {loading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-2" />
      )}
      {loading ? "Exporting..." : label}
    </Button>
  );
}
