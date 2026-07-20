import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { Play, Pause, Download, Trash2, FileText, AlertCircle, Mic, Loader2 } from "lucide-react";
import type { VoiceNoteData, VoiceNoteEntityType } from "@/lib/use-voice-notes";
import { useVoiceNotes, useDeleteVoiceNote, downloadVoiceNote, getVoiceNotesQueryKey } from "@/lib/use-voice-notes";
import { useToast } from "@/hooks/use-toast";

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "--:--";
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

function fmtTime(sec: number): string {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getRoleBadgeColor(role: string): string {
  switch (role) {
    case "sales": return "bg-blue-100 text-blue-700";
    case "production_manager":
    case "production": return "bg-orange-100 text-orange-700";
    case "production_and_support":
    case "support": return "bg-purple-100 text-purple-700";
    case "admin": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-700";
  }
}

function getRoleLabel(role: string): string {
  switch (role) {
    case "sales": return "Sales";
    case "production_manager":
    case "production": return "Production";
    case "production_and_support":
    case "support": return "Support";
    case "admin": return "Admin";
    default: return role;
  }
}

// ────────────────────────────────────────────
// VoiceNotePlayer — Single reusable audio player
// ────────────────────────────────────────────
interface VoiceNotePlayerProps {
  note: VoiceNoteData;
  canDelete?: boolean;
  onDelete?: (id: number) => void;
  isDeleting?: boolean;
  compact?: boolean;
}

export function VoiceNotePlayer({
  note,
  canDelete,
  onDelete,
  isDeleting,
  compact,
}: VoiceNotePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);
    const onError = () => setSourceError(true);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => {
        setSourceError(true);
        setIsPlaying(false);
      });
      setIsPlaying(true);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * duration;
  };

  const hasValidSource = note.url && !sourceError && note.fileAvailable;

  if (!note.fileAvailable && !hasValidSource) {
    return (
      <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
          <span>This voice note is unavailable.</span>
        </div>
        {!compact && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{note.uploadedByName || "Unknown"}</span>
            <span>·</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${getRoleBadgeColor(note.createdByRole)}`}>
              {getRoleLabel(note.createdByRole)}
            </span>
            <span>·</span>
            <span>{formatDuration(note.durationMs)}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`border rounded-lg p-3 bg-muted/30 space-y-2 ${compact ? "py-2" : ""}`}>
      {hasValidSource && (
        <audio ref={audioRef} src={note.url} preload="metadata" />
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={togglePlay}
          className={`rounded-full shrink-0 ${compact ? "h-7 w-7" : "h-8 w-8"} p-0`}
        >
          {isPlaying ? <Pause className={compact ? "h-3 w-3" : "h-4 w-4"} /> : <Play className={compact ? "h-3 w-3" : "h-4 w-4"} />}
        </Button>

        <div
          className="flex-1 h-5 bg-muted rounded cursor-pointer relative overflow-hidden"
          onClick={seek}
        >
          <div
            className="absolute inset-y-0 left-0 bg-primary/30 rounded transition-all"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
          />
          <div className="absolute inset-0 flex items-center gap-px px-1">
            {Array.from({ length: 30 }).map((_, i) => {
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
          {fmtTime(currentTime)}
        </span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mic className="h-3 w-3" />
          <span className="font-medium">{note.uploadedByName || "Unknown"}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getRoleBadgeColor(note.createdByRole)}`}>
            {getRoleLabel(note.createdByRole)}
          </span>
          <span>·</span>
          <span>{formatDuration(note.durationMs)}</span>
          <span>·</span>
          <span>{formatFileSize(note.fileSize)}</span>
          <span>·</span>
          <span>{new Date(note.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadVoiceNote(note.id, note.originalName)}
            className="h-7 px-2 text-xs gap-1"
            title="Download"
          >
            <Download className="h-3 w-3" />
            {!compact && "Download"}
          </Button>

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

          {canDelete && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(note.id)}
              disabled={isDeleting}
              className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
            >
              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {!compact && "Delete"}
            </Button>
          )}
        </div>
      </div>

      {showTranscript && note.transcript && (
        <div className="text-sm text-muted-foreground bg-background rounded p-2 border text-xs whitespace-pre-wrap">
          {note.transcript}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// VoiceNoteSection — Fetches and displays notes for an entity
// ────────────────────────────────────────────
interface VoiceNoteSectionProps {
  entityType: VoiceNoteEntityType;
  entityId: number | null | undefined;
  title?: string;
  compact?: boolean;
  canDelete?: boolean;
}

export function VoiceNoteSection({ entityType, entityId, title, compact, canDelete = true }: VoiceNoteSectionProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: notes = [], isLoading } = useVoiceNotes(entityType, entityId);
  const deleteMutation = useDeleteVoiceNote();

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id);
      queryClient.invalidateQueries({ queryKey: getVoiceNotesQueryKey(entityType, entityId!) });
      toast({ title: "Voice note deleted" });
    } catch {
      toast({ title: "Error", description: "Could not delete voice note", variant: "destructive" });
    }
  };

  if (isLoading) return null;
  if (!notes || notes.length === 0) return null;

  return (
    <div className="space-y-2">
      {title && <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>}
      {notes.map((note: VoiceNoteData) => (
        <VoiceNotePlayer
          key={note.id}
          note={note}
          canDelete={canDelete}
          onDelete={handleDelete}
          isDeleting={deleteMutation.isPending}
          compact={compact}
        />
      ))}
    </div>
  );
}
