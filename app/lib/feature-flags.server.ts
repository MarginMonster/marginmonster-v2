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

/**
 * COGS experiment flags. These multiply per-image art spend and exist only for
 * CI / local sweeps. A presenter image ad sells for 5 tokens (~$0.30-0.50); the
 * default path (one compose + one retry) costs ~$0.06-0.08 and stays well under
 * that. Left set in the PRODUCTION env these flags would silently turn every
 * merchant render into a money-loser, so they are HARD-OFF in production
 * regardless of the env value — run sweeps off-prod.
 *
 * presenterSpray    — PRESENTER_SPRAY=1 fans one image into PRESENTER_TRIES (5)
 *                     parallel composes + QA instead of one compose + one retry.
 * composeResolution — COMPOSE_RESOLUTION (e.g. "4K") raises output pixels and
 *                     ~doubles the per-edit price; undefined = engine default.
 */
export function presenterSprayEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.PRESENTER_SPRAY === "1";
}
export function composeResolution(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return process.env.COMPOSE_RESOLUTION?.trim() || undefined;
}
