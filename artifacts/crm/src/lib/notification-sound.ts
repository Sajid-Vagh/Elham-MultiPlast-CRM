export function playFollowUpSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;

    // Gentle two-tone chime — triangle wave for softer timbre
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.type = "triangle";
    osc1.frequency.value = 440;
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.16, now + 0.03);
    gain1.gain.setValueAtTime(0.16, now + 0.2);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc1.start(now);
    osc1.stop(now + 0.6);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = "triangle";
    osc2.frequency.value = 554;
    gain2.gain.setValueAtTime(0, now + 0.22);
    gain2.gain.linearRampToValueAtTime(0.14, now + 0.26);
    gain2.gain.setValueAtTime(0.14, now + 0.4);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    osc2.start(now + 0.22);
    osc2.stop(now + 0.85);
  } catch {
    // Audio not supported
  }
}

export function playEnquirySound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;

    // Premium three-tone lead alert with dual oscillators for richness
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523, now);
    osc1.frequency.setValueAtTime(659, now + 0.12);
    osc1.frequency.setValueAtTime(784, now + 0.24);

    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.28, now + 0.03);
    gain1.gain.setValueAtTime(0.28, now + 0.12);
    gain1.gain.setValueAtTime(0.28, now + 0.24);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc1.start(now);
    osc1.stop(now + 0.55);

    // Subtle harmonic layer for a richer, more premium tone
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1047, now);      // C6 (one octave up)
    osc2.frequency.setValueAtTime(1319, now + 0.12); // E6
    osc2.frequency.setValueAtTime(1568, now + 0.24); // G6

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.08, now + 0.03);
    gain2.gain.setValueAtTime(0.08, now + 0.12);
    gain2.gain.setValueAtTime(0.08, now + 0.24);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.start(now);
    osc2.stop(now + 0.5);
  } catch {
    // Audio not supported
  }
}

// Alias for backward compatibility
export const playNotificationSound = playFollowUpSound;

export function showBrowserNotification(title: string, body: string, tag?: string) {
  if (!("Notification" in window)) return;
  const fire = () => new Notification(title, { body, icon: "/favicon.ico", tag });
  if (Notification.permission === "granted") {
    fire();
  } else if (Notification.permission === "default") {
    Notification.requestPermission().then(p => { if (p === "granted") fire(); });
  }
}
