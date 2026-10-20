/**
 * Tiny synthesized sounds. One shared AudioContext, created lazily inside a
 * user gesture (`unlockAudio`) so browsers allow playback. Silently no-ops when
 * WebAudio is unavailable or blocked.
 */
let ctx: AudioContext | null = null;
let failed = false;

type AudioCtor = { new (): AudioContext };

/** Call from a user-gesture handler (e.g. the Play button click). */
export function unlockAudio(): void {
  if (failed) return;
  try {
    if (!ctx) {
      const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctor) { failed = true; return; }
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch {
    failed = true;
    ctx = null;
  }
}

/** Soft sine blip: 660 → 880 Hz over 80 ms, peak gain 0.08. */
export function playPop(): void {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.08);
    // Short attack and release so the blip doesn't click.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.09);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch {
    /* ignore */
  }
}
