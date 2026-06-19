import { useEffect, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { useLocation } from "wouter";
import { playFollowUpSound } from "@/lib/notification-sound";

interface NotificationPopupProps {
  id: number;
  title: string;
  message: string;
  link?: string | null;
  type?: string;
  onDismiss: (id: number) => void;
}

export function NotificationPopup({ id, title, message, link, type, onDismiss }: NotificationPopupProps) {
  const [, setLocation] = useLocation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    playFollowUpSound();
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(id), 300);
    }, 10000);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  if (!visible) return null;

  const isEnquiry = type === "enquiry_assigned";

  const handleClick = () => {
    if (link) setLocation(link);
    onDismiss(id);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] animate-in slide-in-from-right-5 fade-in duration-300">
      <div className={`border rounded-lg shadow-lg w-80 overflow-hidden ${isEnquiry ? "bg-blue-50 border-blue-200" : "bg-white"}`}>
        <div className="flex items-start justify-between p-3 pb-2">
          <button
            className="flex-1 text-left cursor-pointer"
            onClick={handleClick}
          >
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">
              {isEnquiry ? (
                <div className="space-y-0.5">
                  {message.split("\n").map((line, i) => {
                    const isLabel = line.includes(":");
                    if (!isLabel) return <span key={i}>{line}</span>;
                    const [label, ...rest] = line.split(":");
                    return (
                      <div key={i} className="flex">
                        <span className="font-medium text-gray-600 w-20 flex-shrink-0">{label}:</span>
                        <span className="text-gray-800">{rest.join(":").trim()}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                message
              )}
            </div>
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
        {link && (
          <button
            onClick={handleClick}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100/50 border-t border-blue-100 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            {isEnquiry ? "View Lead" : "View"}
          </button>
        )}
        <div className={`h-1 ${isEnquiry ? "bg-blue-500" : "bg-blue-500"} animate-[shrink_10s_linear]`} />
      </div>
    </div>
  );
}
