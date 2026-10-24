/**
 * The one place settings touch storage. Every access, including looking up
 * `globalThis.localStorage` itself (that getter throws a SecurityError where site data is
 * blocked), happens inside a try, so a blocked or broken store only ever means "defaults".
 * Pure: no DOM, no audio; the game modules import it too.
 */

/** The parts of Storage the settings use (tests pass a small in-memory one). */
export type SettingsStore = {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
} | undefined;

/** Sound effects volume, 0–100. */
export const SFX_VOLUME_KEY = 'territory-wars.sfxVolume';
export const DEFAULT_SFX_VOLUME = 80;
/** Music volume, 0–100. */
export const MUSIC_VOLUME_KEY = 'territory-wars.musicVolume';
export const DEFAULT_MUSIC_VOLUME = 50;
/** "Directional sound": pan cues toward the side of the screen they happen on. */
export const DIRECTIONAL_KEY = 'territory-wars.directional';
/** "Danger warnings": the far-from-home pill, vignette, heartbeat, threat arrows and glow. */
export const DANGER_WARNINGS_KEY = 'territory-wars.dangerWarnings';
/** "Screen shake & freeze-frames": the knockout hit-stop, zoom punch and camera nudges. */
export const IMPACT_KEY = 'territory-wars.impact';

/** `globalThis.localStorage`, or undefined when it is missing or blocked. Never throws. */
export function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** The raw stored string; null when unset or storage is unavailable. Never throws. */
export function readRaw(key: string, store?: SettingsStore): string | null {
  try {
    return (store ?? safeStorage())?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Stores a string; silently does nothing when storage is unavailable. Never throws. */
export function writeRaw(key: string, value: string, store?: SettingsStore): void {
  try {
    (store ?? safeStorage())?.setItem?.(key, value);
  } catch { /* storage unavailable */ }
}

/** A '1'/'0' flag; `fallback` when unset, corrupt or storage is unavailable. */
export function readBool(key: string, fallback: boolean, store?: SettingsStore): boolean {
  const v = readRaw(key, store);
  return v === '1' ? true : v === '0' ? false : fallback;
}

export function writeBool(key: string, on: boolean, store?: SettingsStore): void {
  writeRaw(key, on ? '1' : '0', store);
}

/** A whole number in 0..100; NaN (and anything non-numeric) gives `fallback`. */
function clampVolume(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.round(Math.min(100, Math.max(0, v)));
}

export function getSfxVolume(store?: SettingsStore): number {
  const raw = readRaw(SFX_VOLUME_KEY, store);
  if (raw === null || raw.trim() === '') return DEFAULT_SFX_VOLUME;
  return clampVolume(Number(raw), DEFAULT_SFX_VOLUME);
}

export function setSfxVolume(v: number, store?: SettingsStore): void {
  writeRaw(SFX_VOLUME_KEY, String(clampVolume(v, DEFAULT_SFX_VOLUME)), store);
}

export function getMusicVolume(store?: SettingsStore): number {
  const raw = readRaw(MUSIC_VOLUME_KEY, store);
  if (raw === null || raw.trim() === '') return DEFAULT_MUSIC_VOLUME;
  return clampVolume(Number(raw), DEFAULT_MUSIC_VOLUME);
}

export function setMusicVolume(v: number, store?: SettingsStore): void {
  writeRaw(MUSIC_VOLUME_KEY, String(clampVolume(v, DEFAULT_MUSIC_VOLUME)), store);
}

// The three "on by default" feel flags: anything but '0' is on.
export const getDirectional = (store?: SettingsStore): boolean => readBool(DIRECTIONAL_KEY, true, store);
export const setDirectional = (on: boolean, store?: SettingsStore): void => writeBool(DIRECTIONAL_KEY, on, store);
export const getDangerWarnings = (store?: SettingsStore): boolean => readRaw(DANGER_WARNINGS_KEY, store) !== '0';
export const setDangerWarnings = (on: boolean, store?: SettingsStore): void => writeBool(DANGER_WARNINGS_KEY, on, store);
export const getImpact = (store?: SettingsStore): boolean => readRaw(IMPACT_KEY, store) !== '0';
export const setImpact = (on: boolean, store?: SettingsStore): void => writeBool(IMPACT_KEY, on, store);
