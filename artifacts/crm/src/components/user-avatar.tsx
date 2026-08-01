import { useMemo } from "react";
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
  const cacheBuster = useMemo(() => Date.now(), [profilePhoto]);
  // Backend may return a relative path (e.g. "/api/uploads/profiles/x.jpg" when
  // using local storage). Resolve it against the configured API base URL so the
  // image loads regardless of the frontend origin.
  const resolved = profilePhoto ? resolveApiUrl(profilePhoto) : undefined;
  const src = resolved ? `${resolved}${resolved.includes("?") ? "&" : "?"}v=${cacheBuster}` : undefined;

  return (
    <Avatar className={className}>
      <AvatarImage src={src} alt={name} className="object-cover object-center" />
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
    </Avatar>
  );
}
