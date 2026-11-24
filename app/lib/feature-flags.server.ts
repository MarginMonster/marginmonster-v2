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
 * CI / local sweeps. A presenter image ad sells for 5 tokens (TOKEN_COST.image):
 * $0.32 on Starter ($19/300), $0.22 on Studio and Legend ($39/900, $69/1600),
 * $0.07 at the Creator floor ($6.99/500). The default path is one compose plus
 * one retry on nano-banana-pro/edit at $0.15 a picture (fal.ai/models/fal-ai/
 * nano-banana-pro/edit, read 2026-11-24) — $0.15 to $0.30 before the vision
 * gate, so it is NOT "well under" the price any more (that was written at
 * Seedream's ~$0.03): one compose is most of a Studio charge, and a retry puts
 * it over. Left set in the PRODUCTION env these flags would multiply that
 * again, so they are HARD-OFF in production regardless of the env value — run
 * sweeps off-prod.
 *
 * presenterSpray    — PRESENTER_SPRAY=1 fans one image into PRESENTER_TRIES (5)
 *                     parallel composes + QA instead of one compose + one retry.
 * composeResolution — COMPOSE_RESOLUTION (e.g. "4K") raises output pixels and
 *                     doubles the per-edit price at 4K ($0.30; 1K and 2K are
 *                     both $0.15); undefined = engine default (1K).
 */
export function presenterSprayEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.PRESENTER_SPRAY === "1";
}
export function composeResolution(): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return process.env.COMPOSE_RESOLUTION?.trim() || undefined;
}
