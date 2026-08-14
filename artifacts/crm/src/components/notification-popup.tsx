import { X, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";

interface NotificationPopupProps {
  id: number;
  title: string;
  message: string;
  link?: string | null;
  type?: string;
  position?: "bottom-right" | "top-right";
  onDismiss: (id: number) => void;
  onOpen: () => void;
}

export function NotificationPopup({ id, title, message, link, type, position = "bottom-right", onDismiss, onOpen }: NotificationPopupProps) {
  // NOTE: No auto-hide. Notifications stay on screen until the user manually
  // dismisses them (X) or opens them (opens the side panel).

  const isEnquiry = type === "enquiry_assigned";
  const isRepeatEnquiry = type === "repeat_enquiry";
  const isReminder = type === "follow_up";
  const accent = isRepeatEnquiry ? "bg-yellow-50 border-yellow-200" : isEnquiry ? "bg-blue-50 border-blue-200" : isReminder ? "bg-violet-50 border-violet-200" : "bg-white";
  const showLabeled = isEnquiry || isRepeatEnquiry;
  const positionClass = position === "top-right" ? "fixed top-20 right-4" : "fixed bottom-4 right-4";

  const handleClick = () => {
    onOpen();
  };

  return (
    <div className={`${positionClass} z-[100] animate-in slide-in-from-right-5 fade-in duration-300`}>
      <div className={`border rounded-lg shadow-lg w-80 overflow-hidden ${accent}`}>
        <div className="flex items-start justify-between p-3 pb-2">
          <button
            className="flex-1 text-left cursor-pointer"
            onClick={handleClick}
          >
            <p className="text-sm font-semibold text-gray-900">
              {isRepeatEnquiry ? "Repeat Enquiry" : title}
            </p>
            <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">
              {showLabeled ? (
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
            {isRepeatEnquiry ? "Open Repeat Enquiry" : isEnquiry ? "Open Lead" : "Open"}
          </button>
        )}
      </div>
    </div>
  );
}
