import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
  const src = profilePhoto ? `${profilePhoto}?v=${cacheBuster}` : undefined;

  return (
    <Avatar className={className}>
      <AvatarImage src={src} alt={name} className="object-cover object-center" />
      <AvatarFallback>{getInitials(name)}</AvatarFallback>
    </Avatar>
  );
}
