export function playNotificationSoundForType(type: string) {
  if (isNotificationSoundMuted()) return;
  const soundMap: Record<string, string> = {
    enquiry_assigned: "https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3",
    lead_assigned: "https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3",
    lead_deleted: "https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3",
    follow_up: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    follow_up_completed: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    deal_created: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    deal_won: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    deal_lost: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    deal_stage_changed: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    deal_reopened: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    assignment: "https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3",
    production_status: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    invoice_created: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    invoice_updated: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    invoice_deleted: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    user_created: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
  product_added: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
  production_message: "https://assets.mixkit.co/active_storage/sfx/2011/2011-preview.mp3",
  repeat_enquiry: "https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3",
};
  const url = soundMap[type] || "https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3";
  try {
    const audio = new Audio(url);
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch {
    // Audio not supported
  }
}

export const NOTIFICATION_MUTED_KEY = "notification_muted";

export function isNotificationSoundMuted(): boolean {
  try {
    return localStorage.getItem(NOTIFICATION_MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setNotificationSoundMuted(muted: boolean) {
  try {
    localStorage.setItem(NOTIFICATION_MUTED_KEY, String(muted));
  } catch {
    /* localStorage unavailable — ignore */
  }
}

export const playNotificationSound = () => playNotificationSoundForType("follow_up");
export const playFollowUpSound = playNotificationSound;
export const playDealWonSound = () => playNotificationSoundForType("deal_won");
export const playDealLostSound = () => playNotificationSoundForType("deal_lost");
export const playGenericNotificationSound = playNotificationSound;

export function showBrowserNotification(title: string, body: string, tag?: string) {
  if (!("Notification" in window)) return;
  const fire = () => new Notification(title, { body, icon: "/favicon.ico", tag });
  if (Notification.permission === "granted") {
    fire();
  } else if (Notification.permission === "default") {
    Notification.requestPermission().then(p => { if (p === "granted") fire(); });
  }
}
