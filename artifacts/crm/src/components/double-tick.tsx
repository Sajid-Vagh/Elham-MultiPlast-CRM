// DoubleTick — WhatsApp-style read receipt indicator.
// Grey ticks = Delivered; Blue ticks = Read by the recipient.
// Only show on messages sent by the current user (isMe).
export function DoubleTick({ isRead, className }: { isRead: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 11"
      width="16"
      height="11"
      className={`inline-block shrink-0 ${className || ""}`}
      aria-label={isRead ? "Read" : "Delivered"}
    >
      {/* First tick */}
      <path
        d="M1.5 5.5L4.5 8.5L10.5 2.5"
        fill="none"
        stroke={isRead ? "#3b82f6" : "#9ca3af"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Second tick (offset right) */}
      <path
        d="M5 5.5L8 8.5L14 2.5"
        fill="none"
        stroke={isRead ? "#3b82f6" : "#9ca3af"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
