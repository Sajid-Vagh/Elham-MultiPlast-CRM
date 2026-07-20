import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Mic, Loader2, CheckCircle2, X } from "lucide-react";
import { VoiceRecorder } from "./voice-recorder";
import { useUploadVoiceNote, useReplaceVoiceNote, getVoiceNotesQueryKey, type VoiceNoteEntityType } from "@/lib/use-voice-notes";
import { useToast } from "@/hooks/use-toast";

// ────────────────────────────────────────────
// VoiceNoteUploader — Unified upload component
// Supports: recording new, file upload, replace
// ────────────────────────────────────────────
interface VoiceNoteUploaderProps {
  entityType: VoiceNoteEntityType;
  entityId: number;
  onUploadComplete?: () => void;
  replaceNoteId?: number;
  label?: string;
}

export function VoiceNoteUploader({
  entityType,
  entityId,
  onUploadComplete,
  replaceNoteId,
  label,
}: VoiceNoteUploaderProps) {
  const [showRecorder, setShowRecorder] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState("");
  const [durationMs, setDurationMs] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useUploadVoiceNote();
  const replaceMutation = useReplaceVoiceNote();

  const handleRecordingComplete = useCallback((blob: Blob, t: string, d: number) => {
    setRecordedBlob(blob);
    setTranscript(t);
    setDurationMs(d);
    setShowRecorder(false);
  }, []);

  const handleUpload = async () => {
    if (!recordedBlob) return;

    try {
      if (replaceNoteId) {
        await replaceMutation.mutateAsync({
          id: replaceNoteId,
          file: recordedBlob,
          transcript,
          durationMs,
        });
        toast({ title: "Voice note replaced" });
      } else {
        await uploadMutation.mutateAsync({
          file: recordedBlob,
          entityType,
          entityId,
          transcript,
          durationMs,
        });
        toast({ title: "Voice note uploaded" });
      }

      queryClient.invalidateQueries({ queryKey: getVoiceNotesQueryKey(entityType, entityId) });
      setRecordedBlob(null);
      setTranscript("");
      setDurationMs(0);
      onUploadComplete?.();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Could not upload voice note", variant: "destructive" });
    }
  };

  const isPending = uploadMutation.isPending || replaceMutation.isPending;

  if (showRecorder) {
    return (
      <VoiceRecorder
        onRecordingComplete={handleRecordingComplete}
        onCancel={() => setShowRecorder(false)}
      />
    );
  }

  if (recordedBlob) {
    return (
      <div className="flex items-center gap-3 py-2">
        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
        <span className="text-sm text-muted-foreground flex-1">
          Voice note recorded ({(durationMs / 1000).toFixed(0)}s)
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setRecordedBlob(null); setTranscript(""); setDurationMs(0); }}
          disabled={isPending}
          className="h-7 px-2"
        >
          <X className="h-3 w-3" />
        </Button>
        <Button size="sm" onClick={handleUpload} disabled={isPending} className="h-7 gap-1">
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {isPending ? "Uploading..." : "Upload"}
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setShowRecorder(true)}
      className="gap-1.5"
    >
      <Mic className="h-3.5 w-3.5" />
      {label || "Record Voice Note"}
    </Button>
  );
}
