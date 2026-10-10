/* AI models + output frames for the Creator "Make an image" generator — pure
 * data so it's safe on both the client (the pickers) and the server (the
 * generation + allow-list validation). The merchant asked for model selection
 * and a frame/aspect control; this is the single source of truth for both.
 *
 * COGS note: a create-image costs the user 5 tokens (= ~$0.35–0.50 of revenue
 * at $0.07–0.10/token). Every model here is well under that per image, so all
 * ship at the SAME 5 tokens and stay profitable. A true flagship (e.g.
 * nano-banana Pro at $0.13–0.24) would need its own higher-token tier — add it
 * with a `surcharge` and wire the video-engine surcharge pattern if we ever do.
 */

export interface CreateModel {
  key: string;
  name: string;
  /** One-line, shown under the selected model. */
  blurb: string;
  /** Replicate official-model id, called via repRun. */
  id: string;
  /** Extra tokens ON TOP of the base image cost (TOKEN_COST.image). The margin
   *  protector for premium engines — mirrors the video-engine surcharge. 0 =
   *  same price as a standard image. */
  surcharge: number;
  /** For nano-banana-pro only: pin the output resolution so a single Genius
   *  generation never exceeds the ~$0.25 COGS cap (2K ≈ $0.15; 4K ≈ $0.30 is
   *  NEVER used). Ignored by models that don't take a resolution param. */
  resolution?: "1K" | "2K";
}

// TWO premium engines — no weak/draft rung (a fuzzy flux-schnell result would
// make the platform look cheap). Signature is the intelligent default; Imperial
// is the flagship. Both are top-tier and render text cleanly.
export const CREATE_MODELS: CreateModel[] = [
  // DEFAULT, intelligent. Gemini 2.5 Flash Image — premium photoreal + legible
  // text, ~$0.039/img. Proven in this codebase (photo edits).
  { key: "pro", name: "Pro", blurb: "Premium quality and crisp, readable text — our default", id: "google/nano-banana", surcharge: 0 },
  // FLAGSHIP. Gemini 3 Pro Image (nano-banana-pro) — the sharpest detail and
  // flawless text. We quietly render it at the model's top standard resolution
  // (~$0.15/img) and never touch the pricey max tier, so the COGS stays capped
  // — but the LABEL never says "2K" (reads like a downgrade next to 4K).
  { key: "ultra", name: "Ultra", blurb: "Our flagship — the sharpest detail and flawless text", id: "google/nano-banana-pro", surcharge: 5, resolution: "2K" },
];

export const CREATE_MODEL_BY_KEY: Record<string, CreateModel> = Object.fromEntries(
  CREATE_MODELS.map((m) => [m.key, m]),
);

export const DEFAULT_CREATE_MODEL = "pro";

/** A valid model key, or the default — never trust a raw form value. */
export function normalizeCreateModelKey(key: string | null | undefined): string {
  return key && CREATE_MODEL_BY_KEY[key] ? key : DEFAULT_CREATE_MODEL;
}

/** Extra tokens for a model key (0 for unknown/standard). */
export function createModelSurcharge(key: string | null | undefined): number {
  const m = key ? CREATE_MODEL_BY_KEY[key] : undefined;
  return m ? m.surcharge : 0;
}

/** Faceless video B-ROLL quality. The b-roll images ARE the visual, so this is
 *  the quality lever. The default is nano-banana (flux-schnell is retired — it
 *  was visibly sloppy); Ultra steps up to nano-banana-pro @2K. The surcharge is
 *  per VIDEO (it covers all ~6-7 b-roll stills at the premium model), on top of
 *  TOKEN_COST.faceless. */
export interface FacelessQuality {
  key: "pro" | "ultra";
  name: string;
  blurb: string;
  surcharge: number;
}
export const FACELESS_QUALITIES: FacelessQuality[] = [
  { key: "pro", name: "Pro", blurb: "Premium cinematic b-roll — crisp and clean", surcharge: 0 },
  { key: "ultra", name: "Ultra", blurb: "Flagship b-roll — the sharpest, most cinematic look", surcharge: 20 },
];
export const FACELESS_QUALITY_BY_KEY: Record<string, FacelessQuality> = Object.fromEntries(
  FACELESS_QUALITIES.map((q) => [q.key, q]),
);
export function normalizeFacelessQuality(key: string | null | undefined): "pro" | "ultra" {
  return key === "ultra" ? "ultra" : "pro";
}
export function facelessQualitySurcharge(key: string | null | undefined): number {
  return FACELESS_QUALITY_BY_KEY[key || "pro"]?.surcharge ?? 0;
}

export interface CreateAspect {
  /** The Replicate aspect_ratio enum value, e.g. "1:1". */
  value: string;
  name: string;
  /** For CSS aspect-ratio (so the Stage can pre-shape to the frame). */
  css: string;
}

export const CREATE_ASPECTS: CreateAspect[] = [
  { value: "1:1", name: "Square", css: "1 / 1" },
  { value: "4:5", name: "Portrait", css: "4 / 5" },
  { value: "9:16", name: "Story", css: "9 / 16" },
  { value: "16:9", name: "Wide", css: "16 / 9" },
];

export const CREATE_ASPECT_VALUES: string[] = CREATE_ASPECTS.map((a) => a.value);

export const DEFAULT_CREATE_ASPECT = "1:1";

/** CSS aspect-ratio string for a frame value (falls back to square). */
export function aspectCss(value: string | null | undefined): string {
  return CREATE_ASPECTS.find((a) => a.value === value)?.css || "1 / 1";
}
