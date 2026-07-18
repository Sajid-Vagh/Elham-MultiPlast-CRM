import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Play, Pause, Trash2, Replace, Loader2, FileText } from "lucide-react";
import { useToast } from "../hooks/use-toast";

interface VoiceNoteData {
  id: number;
  url: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  durationMs: number | null;
  transcript: string | null;
  transcriptStatus: string;
  uploadedById: number;
  uploadedByName: string | null;
  createdAt: string;
}

interface VoiceNotePlayerProps {
  note: VoiceNoteData;
  canEdit: boolean;
  onDelete: (id: number) => void;
  onReplace: (id: number) => void;
  isDeleting?: boolean;
  isReplacing?: boolean;
}

function formatDuration(ms: number | null): string {
  if (!ms) return "--:--";
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VoiceNotePlayer({
  note,
  canEdit,
  onDelete,
  onReplace,
  isDeleting,
  isReplacing,
}: VoiceNotePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    audioRef.current.currentTime = pct * duration;
  };

  const fmt = (sec: number) => {
    if (!sec || !isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
      <audio ref={audioRef} src={note.url} preload="metadata" />

      {/* Row 1: play button + waveform + duration */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={togglePlay}
          className="h-8 w-8 p-0 rounded-full shrink-0"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>

        {/* Waveform / progress bar */}
        <div
          className="flex-1 h-6 bg-muted rounded cursor-pointer relative overflow-hidden"
          onClick={seek}
        >
          <div
            className="absolute inset-y-0 left-0 bg-primary/30 rounded transition-all"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
          />
          {/* Fake waveform bars for visual effect */}
          <div className="absolute inset-0 flex items-center gap-px px-1">
            {Array.from({ length: 40 }).map((_, i) => {
              const h = 20 + Math.sin(i * 0.8) * 40 + Math.cos(i * 1.3) * 30;
              return (
                <div
                  key={i}
                  className="flex-1 bg-primary/20 rounded-full"
                  style={{ height: `${Math.max(20, Math.min(h, 100))}%` }}
                />
              );
            })}
          </div>
        </div>

        <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0 w-10 text-right">
          {fmt(currentTime)}
        </span>
      </div>

      {/* Row 2: metadata + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatDuration(note.durationMs)}</span>
          <span>·</span>
          <span>{formatFileSize(note.fileSize)}</span>
          <span>·</span>
          <span>{note.uploadedByName || "Unknown"}</span>
        </div>

        <div className="flex items-center gap-1">
          {note.transcript && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTranscript(!showTranscript)}
              className="h-7 px-2 text-xs gap-1"
            >
              <FileText className="h-3 w-3" />
              {showTranscript ? "Hide" : "Transcript"}
            </Button>
          )}

          {canEdit && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReplace(note.id)}
                disabled={isReplacing}
                className="h-7 px-2 text-xs gap-1"
              >
                {isReplacing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Replace className="h-3 w-3" />}
                Replace
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDelete(note.id)}
                disabled={isDeleting}
                className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
              >
                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Transcript panel */}
      {showTranscript && note.transcript && (
        <div className="text-sm text-muted-foreground bg-background rounded p-2 border text-xs whitespace-pre-wrap">
          {note.transcript}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// Standalone list component to fetch + display voice notes
// ────────────────────────────────────────────

interface VoiceNoteListProps {
  dealId?: number | null;
  productionOrderId?: number | null;
  currentUserId: number;
  userRole: string;
}

export function VoiceNoteList({
  dealId,
  productionOrderId,
  currentUserId,
  userRole,
}: VoiceNoteListProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const endpoint = productionOrderId
    ? `/voice-notes/production/${productionOrderId}`
    : dealId
      ? `/voice-notes/deal/${dealId}`
      : null;

  const { data: notes = [], isLoading } = useQuery<VoiceNoteData[]>({
    queryKey: endpoint ? ["voice-notes", endpoint] : ["voice-notes", "disabled"],
    queryFn: () => fetch(endpoint!, { headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` } }).then((r) => r.json()),
    enabled: !!endpoint,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/voice-notes/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      }).then((r) => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voice-notes"] });
      toast({ title: "Voice note deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not delete voice note", variant: "destructive" });
    },
  });

  const replaceMutation = useMutation({
    // Replace is handled by the parent (opens file picker, uploads new file)
    mutationFn: (id: number) => Promise.resolve(id),
  });

  if (isLoading || notes.length === 0) return null;

  return (
    <div className="space-y-3">
      {notes.map((note) => (
        <VoiceNotePlayer
          key={note.id}
          note={note}
          canEdit={
            userRole === "admin" ||
            userRole === "production_and_support" ||
            (userRole === "sales" && note.uploadedById === currentUserId)
          }
          onDelete={(id) => deleteMutation.mutate(id)}
          onReplace={(id) => replaceMutation.mutate(id)}
          isDeleting={deleteMutation.isPending}
          isReplacing={replaceMutation.isPending}
        />
      ))}
    </div>
  );
}
