import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText, FileType, FileDown, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGetMe } from "@workspace/api-client-react";
import { ExportVerificationDialog } from "./export-verification-dialog";

interface ExportDropdownProps {
  exportUrl: string;
  filename?: string;
  disabled?: boolean;
  onBeforeExport?: () => Record<string, string>;
  selectedIds?: number[];
  selectionLabel?: string;
  quickLabel?: string;
  detailedLabel?: string;
}

export function ExportDropdown({
  exportUrl,
  filename = "export",
  disabled = false,
  onBeforeExport,
  selectedIds,
  selectionLabel = "selected",
  quickLabel = "Quick Export (Current View)",
  detailedLabel = "Detailed Export (Complete Report)",
}: ExportDropdownProps) {
  const [loading, setLoading] = useState<{ mode: string; format: string } | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ mode: string; format: string; ids?: number[] } | null>(null);
  const { toast } = useToast();
  const { data: me } = useGetMe();

  const runExport = useCallback(async (mode: string, format: string, ids?: number[], exportAuthToken?: string) => {
    setLoading({ mode, format });
    try {
      const token = localStorage.getItem("crm_token");
      const params = new URLSearchParams();
      params.set("mode", mode);
      params.set("format", format);

      if (ids && ids.length > 0) {
        params.set("ids", ids.join(","));
      }

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
      const ext = format === "csv" ? "csv" : format === "pdf" ? "pdf" : "xlsx";
      const date = new Date().toISOString().split("T")[0];
      const suffix = ids && ids.length > 0 ? "_selected" : "";
      const fname = `${filename}${suffix}_${date}.${ext}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      toast({ title: "Export completed", description: `${mode === "quick" ? "Quick" : "Detailed"} ${format.toUpperCase()} downloaded.` });
    } catch (err: any) {
      console.error("Export error:", err);
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(null);
      setPendingExport(null);
    }
  }, [exportUrl, filename, onBeforeExport, toast]);

  const doExport = (mode: string, format: string, ids?: number[]) => {
    // Only Admin users require export OTP verification
    if (me?.role === "admin") {
      setPendingExport({ mode, format, ids });
      setVerifyOpen(true);
    } else {
      runExport(mode, format, ids);
    }
  };

  const handleVerified = async (exportToken: string) => {
    if (pendingExport) {
      await runExport(pendingExport.mode, pendingExport.format, pendingExport.ids, exportToken);
    }
  };

  const isLoading = loading !== null;

  const renderExportOptions = (mode: string, label: string) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {isLoading && loading?.mode === mode ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : mode === "quick" ? (
          <FileText className="h-4 w-4 mr-2" />
        ) : (
          <FileSpreadsheet className="h-4 w-4 mr-2" />
        )}
        <span>{label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => doExport(mode, "xlsx")}>
          <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => doExport(mode, "csv")}>
          <FileText className="h-4 w-4 mr-2" /> CSV (.csv)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => doExport(mode, "pdf")}>
          <FileType className="h-4 w-4 mr-2" /> PDF (.pdf)
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  const renderSelectedExportOptions = (mode: string) => (
    <>
      <DropdownMenuItem onClick={() => doExport(mode, "xlsx", selectedIds)}>
        <FileSpreadsheet className="h-4 w-4 mr-2" /> {mode === "quick" ? "Quick" : "Detailed"} Excel (.xlsx)
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => doExport(mode, "csv", selectedIds)}>
        <FileText className="h-4 w-4 mr-2" /> {mode === "quick" ? "Quick" : "Detailed"} CSV (.csv)
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => doExport(mode, "pdf", selectedIds)}>
        <FileType className="h-4 w-4 mr-2" /> {mode === "quick" ? "Quick" : "Detailed"} PDF (.pdf)
      </DropdownMenuItem>
    </>
  );

  const hasSelection = selectedIds && selectedIds.length > 0;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled || isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {isLoading ? "Exporting..." : "Export"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {renderExportOptions("quick", quickLabel)}
          {renderExportOptions("detailed", detailedLabel)}

          {hasSelection && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FileDown className="h-4 w-4 mr-2" />
                  <span>Export Selected ({selectedIds.length})</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {renderSelectedExportOptions("quick")}
                  <DropdownMenuSeparator />
                  {renderSelectedExportOptions("detailed")}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ExportVerificationDialog
        open={verifyOpen}
        onOpenChange={(isOpen) => {
          setVerifyOpen(isOpen);
          if (!isOpen) setPendingExport(null);
        }}
        onVerified={handleVerified}
        exportLabel={filename}
      />
    </>
  );
}
