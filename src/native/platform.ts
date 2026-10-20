import { Capacitor } from '@capacitor/core';

/**
 * Thin bridge to the Android shell (Capacitor). In a plain browser every call
 * falls back to the web API or does nothing, so the web build keeps working.
 * Native plugins are imported lazily so they stay out of the web code path.
 */
export const isNative = Capacitor.isNativePlatform();

/** Short buzz: the Haptics plugin in the app, navigator.vibrate in a browser. */
export function vibrate(ms: number): void {
  if (isNative) {
    void import('@capacitor/haptics')
      .then(({ Haptics }) => Haptics.vibrate({ duration: ms }))
      .catch(() => {});
    return;
  }
  try { (globalThis.navigator as Navigator | undefined)?.vibrate?.(ms); } catch { /* ignore */ }
}

export type AppHooks = {
  /** Android back button. Return true when it was handled (e.g. a modal closed). */
  onBack(): boolean;
  /** App returned to the foreground. */
  onResume(): void;
};

/** Wires the Android back button and app lifecycle. No-op in a browser. */
export async function initApp(hooks: AppHooks): Promise<void> {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  // Back is only allowed to quit from the home screen, so a stray press never ends a game.
  await App.addListener('backButton', () => {
    if (!hooks.onBack()) void App.exitApp();
  });
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) hooks.onResume();
  });
}
