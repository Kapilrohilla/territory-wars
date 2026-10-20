import { isNative } from './platform';

/**
 * Google AdMob via @capacitor-community/admob. Only rewarded ads for now (the revive).
 *
 * Ad unit ids come from Vite env vars at build time; without them Google's public
 * TEST units are used and ads are flagged as test ads, so development can never
 * serve (or click) real ads.
 */
const TEST_REWARDED_ID = 'ca-app-pub-3940256099942544/5224354917';
const REWARDED_ID: string | undefined = import.meta.env.VITE_ADMOB_REWARDED_ID;
const TESTING = !REWARDED_ID;

let init: Promise<boolean> | null = null;

/**
 * Starts AdMob once: consent (UMP) first, then the SDK. Resolves false when ads
 * can't be shown (browser, consent refused, SDK error). Safe to call repeatedly.
 */
export function initAds(): Promise<boolean> {
  if (!isNative) return Promise.resolve(false);
  init ??= (async () => {
    try {
      const { AdMob, AdmobConsentStatus, MaxAdContentRating } = await import('@capacitor-community/admob');
      let consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        consent = await AdMob.showConsentForm();
      }
      if (!consent.canRequestAds) return false;
      await AdMob.initialize({
        initializeForTesting: TESTING,
        // Rated for ages 13+: not a child-directed app, ads capped at Teen content.
        tagForChildDirectedTreatment: false,
        maxAdContentRating: MaxAdContentRating.Teen,
      });
      return true;
    } catch {
      return false;
    }
  })();
  return init;
}

/**
 * Shows a rewarded ad. Resolves true only if the viewer earned the reward; false if
 * they closed it early or no ad could load. In a browser it resolves true, so the
 * web build keeps its free revive.
 */
export async function showRewarded(): Promise<boolean> {
  if (!isNative) return true;
  if (!(await initAds())) return false;
  const { AdMob, RewardAdPluginEvents } = await import('@capacitor-community/admob');
  let earned = false;
  let close = () => {};
  const closed = new Promise<void>((resolve) => { close = resolve; });
  const handles = await Promise.all([
    AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { earned = true; }),
    AdMob.addListener(RewardAdPluginEvents.Dismissed, () => close()),
    AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => close()),
  ]);
  try {
    await AdMob.prepareRewardVideoAd({ adId: REWARDED_ID ?? TEST_REWARDED_ID, isTesting: TESTING });
    // showRewardVideoAd only settles once the reward is earned, so wait for the close instead.
    void AdMob.showRewardVideoAd().catch(() => {});
    await closed;
    return earned;
  } catch {
    return false;
  } finally {
    for (const h of handles) void h.remove();
  }
}
