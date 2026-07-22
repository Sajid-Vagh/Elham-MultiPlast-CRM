import { useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

const HAPPY_BELLS_URL =
  "https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3";

let audioSingleton: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement {
  if (!audioSingleton) {
    audioSingleton = new Audio(HAPPY_BELLS_URL);
  }
  return audioSingleton;
}

/**
 * Polls GET /production/modified-since every 10 s.
 * When a *new* modification is detected (latestModifiedAt moves forward)
 * it plays the "Happy bells" sound once and shows a toast.
 *
 * The hook is safe to mount on any Production page — each mount site
 * gets its own `prevLatestRef` so a navigation between pages won't
 * re-trigger the same alert.
 */
export function useProductionSyncAlert(enabled = true) {
  const { toast } = useToast();
  const prevLatestRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  const { data } = useQuery({
    queryKey: ["production-modified-since"],
    queryFn: () =>
      customFetch<{ latestModifiedAt: string | null; modifiedCount: number }>(
        "/production/modified-since"
      ),
    refetchInterval: 10_000,
    enabled,
  });

  useEffect(() => {
    if (!data?.latestModifiedAt) return;

    if (!mountedRef.current) {
      prevLatestRef.current = data.latestModifiedAt;
      mountedRef.current = true;
      return;
    }

    if (data.latestModifiedAt !== prevLatestRef.current) {
      prevLatestRef.current = data.latestModifiedAt;

      try {
        const audio = getAudio();
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } catch {}

      toast({
        title: "Production Order Updated",
        description:
          "An existing production order has been modified with new items or changes.",
      });
    }
  }, [data?.latestModifiedAt, toast]);

  return data;
}
