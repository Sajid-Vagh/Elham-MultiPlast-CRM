// SINGLE canonical sound for ALL chat-message and voice-note notifications,
// for EVERY user role (Admin, Sales, Production, Support). Do NOT add
// role-specific or alternate chat sounds — the backend delivers the same
// notification types (production_message, voice_note) to all roles.
// The ?v= query busts browser caches so a replaced .wav reaches everyone
// on the next deploy instead of serving a stale cached tone per user.
export const CHAT_NOTIFICATION_SOUND_URL = "/assets/chat-notification.wav?v=2";

export const NOTIFICATION_VOLUME_KEY = "crm-notification-volume";
export const NOTIFICATION_MUTED_KEY = "notification_muted";

export function getNotificationVolume(): number {
  try {
    const val = localStorage.getItem(NOTIFICATION_VOLUME_KEY);
    if (val !== null) {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        return parsed;
      }
    }
    // Backward compatibility: if notification_muted is "true", volume is 0
    if (localStorage.getItem(NOTIFICATION_MUTED_KEY) === "true") {
      return 0;
    }
    return 50; // default 50%
  } catch {
    return 50;
  }
}

export function setNotificationVolume(volume: number) {
  try {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    localStorage.setItem(NOTIFICATION_VOLUME_KEY, String(clamped));
    // Also sync the legacy boolean key for any code still reading it
    localStorage.setItem(NOTIFICATION_MUTED_KEY, String(clamped === 0));
  } catch {
    /* localStorage unavailable — ignore */
  }
}

export function isNotificationSoundMuted(): boolean {
  return getNotificationVolume() === 0;
}

export function setNotificationSoundMuted(muted: boolean) {
  if (muted) {
    setNotificationVolume(0);
  } else {
    const current = getNotificationVolume();
    setNotificationVolume(current > 0 ? current : 50);
  }
}

export function playNotificationSoundForType(type: string) {
  const volume = getNotificationVolume();
  if (volume <= 0) return;

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
    audio.volume = Math.max(0, Math.min(1, volume / 100));
    audio.play().catch(() => {});
  } catch {
    // Audio not supported
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
