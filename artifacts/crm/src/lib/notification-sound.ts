// SINGLE canonical sound for ALL chat-message and voice-note notifications,
// for EVERY user role (Admin, Sales, Production, Support). Do NOT add
// role-specific or alternate chat sounds — the backend delivers the same
// notification types (production_message, voice_note) to all roles.
// The ?v= query busts browser caches so a replaced .wav reaches everyone
// on the next deploy instead of serving a stale cached tone per user.
export const CHAT_NOTIFICATION_SOUND_URL = "/assets/chat-notification.wav?v=2";

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
    // Production order lifecycle events — same system alert as production_status.
    // These are the alerts the Production role depends on (new order, PI change,
    // unit transfer, PI revision), so they must have explicit, distinct sound
    // mappings instead of silently falling through to the default.
    production_order_created: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    production_pi_modified: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    production_unit_transfer: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    pi_revision: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    invoice_created: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    invoice_updated: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    invoice_deleted: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    user_created: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
  product_added: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
  // Order conversation chat (Production + Sales order messages & voice notes)
  // uses the SAME unified sound for every role — identical to what Sales/Admin
  // hear. Never differentiate chat/voice-note sounds by role or workspace.
  production_message: CHAT_NOTIFICATION_SOUND_URL,
  voice_note: CHAT_NOTIFICATION_SOUND_URL,
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
export const playChatNotificationSound = () => playNotificationSoundForType("production_message");

export function showBrowserNotification(title: string, body: string, tag?: string) {
  if (!("Notification" in window)) return;
  const fire = () => new Notification(title, { body, icon: "/favicon.ico", tag });
  if (Notification.permission === "granted") {
    fire();
  } else if (Notification.permission === "default") {
    Notification.requestPermission().then(p => { if (p === "granted") fire(); });
  }
}
