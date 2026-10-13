/* Video engine menu — the Arcads-style model picker. Merchants choose which
 * AI video engine animates their ad; premium engines carry a token surcharge
 * that covers their higher per-second cost. Pure data: safe on client+server.
 *
 * The server adapter (animateCreate in ugc-ad-pipeline.server.ts) maps keys
 * to fal or Replicate models and ALWAYS falls back to our default engine on
 * any rejection, so an engine choice can never kill a paid generation. */

export interface VideoEngine {
  key: string;
  name: string;
  blurb: string;
  /** Extra tokens on top of TOKEN_COST.video — the margin protector. */
  surcharge: number;
}

export const VIDEO_ENGINES: VideoEngine[] = [
  { key: "auto", name: "Auto", blurb: "EasyMode picks — Kling 3 Pro, included", surcharge: 0 },
  { key: "kling", name: "Kling 3 Pro", blurb: "Newest Kling — top motion & product fidelity", surcharge: 0 },
  { key: "kling26", name: "Kling 2.6 Pro", blurb: "Previous generation — dependable", surcharge: 0 },
  { key: "kling25fal", name: "Kling 2.5 Turbo", blurb: "Fast and dependable — the safe pick", surcharge: 0 },
  { key: "hailuo", name: "Hailuo 2", blurb: "Cinematic lighting, lush color", surcharge: 25 },
  // Seedance 2.5 is the newest Seedance (fal, ~$0.47/s at 720p) — pricier than
  // v1 Pro, so it carries the premium surcharge. A fal reject falls back to the
  // Replicate seedance-1-pro. Validate COGS on a live gen before dropping it.
  { key: "seedance", name: "Seedance 2.5", blurb: "Newest Seedance — punchy TikTok-native energy", surcharge: 75 },
  // KEEP VEO ON THE *FAST* VARIANTS. +75 tokens (~$7.50) covers a Veo-FAST clip
  // with margin, but a true full-quality Veo-3 clip costs $8-10 and would be
  // break-even-to-loss at this surcharge. The server adapter (animateModelFor in
  // ugc-ad-pipeline.server.ts) maps both keys to the fal/Google *fast* models;
  // never repoint them at full-quality Veo, and never add a non-fast Veo SKU,
  // without also raising its surcharge. (Owner decision 2026-10-04: no price
  // change — the real Veo loss, a Commercial firing 5 clips for one surcharge,
  // is fixed by pinning Commercial to the default engine.)
  { key: "veo31", name: "Veo 3.1 Fast", blurb: "Google's latest — premium realism", surcharge: 75 },
  { key: "veo", name: "Veo 3 Fast", blurb: "Google's previous generation", surcharge: 75 },
];

export const VIDEO_ENGINE_BY_KEY: Record<string, VideoEngine> = Object.fromEntries(
  VIDEO_ENGINES.map((e) => [e.key, e])
);

export function engineSurcharge(key: string | null | undefined): number {
  return VIDEO_ENGINE_BY_KEY[key || "auto"]?.surcharge ?? 0;
}

/** Sanitize a merchant-submitted engine key. */
export function normalizeEngineKey(key: string | null | undefined): string | undefined {
  if (!key || key === "auto") return undefined;
  return VIDEO_ENGINE_BY_KEY[key] ? key : undefined;
}
