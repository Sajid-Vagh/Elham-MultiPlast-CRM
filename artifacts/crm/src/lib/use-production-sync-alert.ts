import { useRef } from "react";
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

  // Fire only when the timestamp *advances* past the last one we saw.
  // The very first fetch is ignored (mountedRef starts false).
  if (data?.latestModifiedAt) {
    if (!mountedRef.current) {
      // First fetch — seed the baseline, don't alert.
      prevLatestRef.current = data.latestModifiedAt;
      mountedRef.current = true;
    } else if (data.latestModifiedAt !== prevLatestRef.current) {
      prevLatestRef.current = data.latestModifiedAt;

      // Play sound
      try {
        const audio = getAudio();
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } catch {}

      // Show toast
      toast({
        title: "Production Order Updated",
        description:
          "An existing production order has been modified with new items or changes.",
      });
    }
  }

  return data;
}
