/* Video engine menu — the Arcads-style model picker. Merchants choose which
 * AI video engine animates their ad; premium engines carry a token surcharge
 * that covers their higher per-second cost. Pure data: safe on client+server.
 *
 * The server adapter (animateCreate in ugc-ad-pipeline.server.ts) maps keys
 * to Replicate models and ALWAYS falls back to our default engine on any
 * rejection, so an engine choice can never kill a paid generation. */

export interface VideoEngine {
  key: string;
  name: string;
  blurb: string;
  /** Extra tokens on top of TOKEN_COST.video — the margin protector. */
  surcharge: number;
}

export const VIDEO_ENGINES: VideoEngine[] = [
  { key: "auto", name: "Auto", blurb: "EasyMode picks — fast, consistent, included", surcharge: 0 },
  { key: "kling", name: "Kling", blurb: "Rock-solid motion & product fidelity", surcharge: 0 },
  { key: "hailuo", name: "Hailuo 2", blurb: "Cinematic lighting, lush color", surcharge: 25 },
  { key: "seedance", name: "Seedance 1 Pro", blurb: "Punchy, dynamic, TikTok-native energy", surcharge: 25 },
  { key: "veo", name: "Veo 3 Fast", blurb: "Google's flagship — premium realism", surcharge: 75 },
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
