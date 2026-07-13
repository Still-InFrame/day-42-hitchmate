// Tiny synthesized UI chimes via the Web Audio API — no audio files needed.
// Note: browsers require a user gesture before audio can play, so we unlock the
// context on first interaction. A sound that fires before any interaction on the
// page may be silent (autoplay policy) — best-effort by design.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Unlock the audio context on the first user gesture on this page.
export function armSound() {
  if (typeof window === "undefined") return () => {};
  const unlock = () => getCtx();
  window.addEventListener("pointerdown", unlock, { once: true });
  return () => window.removeEventListener("pointerdown", unlock);
}

function tone(freq: number, startOffset: number, dur: number, gainVal = 0.14) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = c.currentTime + startOffset;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(gainVal, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// Bright rising two-note chime — a driver accepted the request.
export function playAccepted() {
  tone(660, 0, 0.25);
  tone(880, 0.12, 0.35);
}

// Soft descending pair — the ride ended or was cancelled.
export function playEnded() {
  tone(520, 0, 0.3);
  tone(392, 0.14, 0.42);
}

// Quick, quiet outgoing blip when you send a message.
export function playSent() {
  tone(700, 0, 0.06, 0.07);
  tone(920, 0.05, 0.08, 0.07);
}

// Brighter incoming two-tone when a message arrives.
export function playReceived() {
  tone(880, 0, 0.08, 0.11);
  tone(1175, 0.07, 0.12, 0.11);
}
