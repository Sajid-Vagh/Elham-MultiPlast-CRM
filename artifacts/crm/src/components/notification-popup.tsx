import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { useLocation } from "wouter";
import { playNotificationSound } from "@/lib/notification-sound";

interface NotificationPopupProps {
  id: number;
  title: string;
  message: string;
  link?: string | null;
  onDismiss: (id: number) => void;
}

export function NotificationPopup({ id, title, message, link, onDismiss }: NotificationPopupProps) {
  const [, setLocation] = useLocation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    playNotificationSound();
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(id), 300);
    }, 10000);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  if (!visible) return null;

  const handleClick = () => {
    if (link) setLocation(link);
    onDismiss(id);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] animate-in slide-in-from-right-5 fade-in duration-300">
      <div className="bg-white border rounded-lg shadow-lg w-80 overflow-hidden">
        <div className="flex items-start justify-between p-3 pb-2">
          <button
            className="flex-1 text-left cursor-pointer"
            onClick={handleClick}
          >
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-line line-clamp-3">{message}</p>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 ml-2 flex-shrink-0"
            onClick={() => onDismiss(id)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <div className="h-1 bg-blue-500 animate-[shrink_10s_linear]" />
      </div>
    </div>
  );
}
