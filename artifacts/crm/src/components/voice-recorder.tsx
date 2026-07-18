import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "./ui/button";
import { Mic, Square, Loader2, Clock } from "lucide-react";

interface VoiceRecorderProps {
  onRecordingComplete: (blob: Blob, transcript: string, durationMs: number) => void;
  onCancel: () => void;
  maxDurationMs?: number;
}

export function VoiceRecorder({
  onRecordingComplete,
  onCancel,
  maxDurationMs = 60_000,
}: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript("");
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Prefer WebM with Opus, fall back to whatever is supported
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const durationMs = Date.now() - startTimeRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());

        onRecordingComplete(blob, transcript, durationMs);
      };

      recorder.start(250); // collect data every 250ms
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setElapsedMs(0);

      // Elapsed timer
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setElapsedMs(elapsed);
        if (elapsed >= maxDurationMs) {
          stopRecording();
        }
      }, 100);

      // Start speech recognition for transcript
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-IN";

        let finalTranscript = "";
        recognition.onresult = (event: any) => {
          let interim = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              finalTranscript += result[0].transcript + " ";
            } else {
              interim += result[0].transcript;
            }
          }
          setTranscript((finalTranscript + interim).trim());
        };
        recognition.onerror = () => { /* ignore — mic permission already granted */ };
        recognition.onend = () => { setIsTranscribing(false); };

        recognitionRef.current = recognition;
        recognition.start();
        setIsTranscribing(true);
      }
    } catch (err: any) {
      setError(err?.name === "NotAllowedError"
        ? "Microphone permission denied. Please allow microphone access."
        : "Could not start recording. Please check your microphone.");
    }
  }, [maxDurationMs, onRecordingComplete, stopRecording, transcript]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  const remainingMs = maxDurationMs - elapsedMs;
  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const progress = Math.min((elapsedMs / maxDurationMs) * 100, 100);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <p className="text-sm text-destructive text-center">{error}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={startRecording}>Try Again</Button>
        </div>
      </div>
    );
  }

  if (!isRecording) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <p className="text-sm text-muted-foreground">
          Record a voice note for the Production team (max {maxDurationMs / 1000}s)
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Skip</Button>
          <Button size="sm" onClick={startRecording} className="gap-2">
            <Mic className="h-4 w-4" /> Start Recording
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      {/* Timer + Progress */}
      <div className="flex items-center gap-2">
        <div className="relative h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
        </div>
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-mono font-medium tabular-nums">
          {remainingSec}s
        </span>
        {isTranscribing && (
          <span className="text-xs text-muted-foreground italic ml-2">transcribing...</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xs h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-200 ${
            progress > 80 ? "bg-red-500" : "bg-primary"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Live transcript preview */}
      {transcript && (
        <p className="text-xs text-muted-foreground text-center max-w-xs italic line-clamp-2">
          "{transcript}"
        </p>
      )}

      {/* Stop button */}
      <Button
        size="sm"
        variant="destructive"
        onClick={stopRecording}
        className="gap-2"
      >
        <Square className="h-3 w-3" /> Stop Recording
      </Button>
    </div>
  );
}
