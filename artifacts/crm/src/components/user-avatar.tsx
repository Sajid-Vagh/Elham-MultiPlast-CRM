import { useMemo, useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveApiUrl } from "@workspace/api-client-react";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map(w => w.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface UserAvatarProps {
  profilePhoto?: string | null;
  name: string;
  className?: string;
}

export function UserAvatar({ profilePhoto, name, className }: UserAvatarProps) {
  // Bump counter that forces a fresh cache-buster when the browser tab regains
  // visibility (e.g. after laptop sleep/wake).  Without this, the <img src>
  // URL stays identical after resume, so the browser never retries a load
  // that the in-memory bitmap eviction caused to error.
  const [visibilityBump, setVisibilityBump] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Small delay lets the network stack settle after system wake.
        timer = setTimeout(() => setVisibilityBump(b => b + 1), 300);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Recomputes when the photo URL changes OR when the browser regains visibility.
  const cacheBuster = useMemo(() => Date.now(), [profilePhoto, visibilityBump]);

  // Backend normally returns an absolute Supabase public URL (already
  // normalized server-side). As a failsafe, if we ever receive a relative path
  // (e.g. "/api/uploads/...") resolve it against the configured API base URL —
  // and only pass it to the image if it became absolute, otherwise fall back to
  // the initials instead of firing a broken request.
  const src = useMemo(() => {
    if (!profilePhoto) return undefined;
    if (/^https?:\/\//i.test(profilePhoto)) {
      return `${profilePhoto}${profilePhoto.includes("?") ? "&" : "?"}v=${cacheBuster}`;
    }
    const resolved = resolveApiUrl(profilePhoto);
    if (!/^https?:\/\//i.test(resolved)) return undefined;
    return `${resolved}${resolved.includes("?") ? "&" : "?"}v=${cacheBuster}`;
  }, [profilePhoto, cacheBuster]);

  return (
    <Avatar className={className}>
      <AvatarImage src={src} alt={name} className="object-cover object-center" />
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
    </Avatar>
  );
}
