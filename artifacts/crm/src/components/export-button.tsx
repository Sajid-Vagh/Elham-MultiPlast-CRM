import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGetMe } from "@workspace/api-client-react";
import { ExportVerificationDialog } from "./export-verification-dialog";

interface ExportButtonProps {
  exportUrl: string;
  filename?: string;
  disabled?: boolean;
  onBeforeExport?: () => Record<string, string>;
  label?: string;
}

// Single-click "Detailed Export" button.
// For Admin users: requires 6-digit OTP verification before downloading.
// For Non-admin users: immediately downloads according to current permissions.
export function ExportButton({
  exportUrl,
  filename = "export",
  disabled = false,
  onBeforeExport,
  label = "Export",
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const { toast } = useToast();
  const { data: me } = useGetMe();

  const runExport = useCallback(async (exportAuthToken?: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      params.set("mode", "detailed");
      params.set("format", "xlsx");

      if (exportAuthToken) {
        params.set("exportToken", exportAuthToken);
      }

      if (onBeforeExport) {
        const extra = onBeforeExport();
        Object.entries(extra).forEach(([k, v]) => {
          if (v) params.set(k, v);
        });
      }

      const url = `${exportUrl}?${params.toString()}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (exportAuthToken) {
        headers["X-Export-Token"] = exportAuthToken;
      }

      const res = await fetch(url, { headers });

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

      toast({ title: "Export completed", description: "Detailed XLSX downloaded." });
    } catch (err: any) {
      console.error("Export error:", err);
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [exportUrl, filename, onBeforeExport, toast]);

  const handleClick = () => {
    // Only Admin users require additional export OTP verification
    if (me?.role === "admin") {
      setVerifyOpen(true);
    } else {
      runExport();
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleClick} disabled={disabled || loading}>
        {loading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Download className="h-4 w-4 mr-2" />
        )}
        {loading ? "Exporting..." : label}
      </Button>

      <ExportVerificationDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        onVerified={runExport}
        exportLabel={label === "Export" ? filename : label}
      />
    </>
  );
}
