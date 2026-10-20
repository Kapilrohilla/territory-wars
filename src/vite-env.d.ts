/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** AdMob rewarded ad unit id for release builds; unset means Google's test unit. */
  readonly VITE_ADMOB_REWARDED_ID?: string;
}
