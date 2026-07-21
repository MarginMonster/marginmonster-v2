/**
 * Launch-time visibility gates. The plumbing for every feature stays wired —
 * these flags only control what MERCHANTS SEE, so anything that depends on a
 * pending external approval never renders as a broken / "coming soon" placeholder
 * (which Shopify App Store review rejects). Flip the env var on the moment the
 * approval lands and the full UI reappears — no code changes, no redeploy of logic.
 *
 * paidAds  — Meta/TikTok paid campaigns (Boost, ad-account connect, Performance &
 *            ROI dashboard). Gated on Marketing API approval, which is external and
 *            pending. Set FEATURE_PAID_ADS=1 once approved.
 */
export function paidAdsEnabled(): boolean {
  return process.env.FEATURE_PAID_ADS === "1";
}
