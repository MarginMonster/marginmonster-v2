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

// A DeepAI-style 3-rung ladder: Fast (drafts) → Smart (the intelligent default)
// → Genius (the premium, 2K, capped at ~$0.25 COGS — DeepAI's own top rung is
// "Super Genius 2K" at $0.25). Every rung renders text; only Genius surcharges.
export const CREATE_MODELS: CreateModel[] = [
  // Cheap + instant (~$0.003), weaker at words — for text-free art/quick drafts.
  { key: "fast", name: "Fast", blurb: "Instant drafts — cheapest, best for text-free art", id: "black-forest-labs/flux-schnell", surcharge: 0 },
  // DEFAULT, intelligent. Gemini 2.5 Flash Image — premium photoreal + legible
  // text, ~$0.039/img. Proven in this codebase (photo edits). Same price.
  { key: "smart", name: "Smart", blurb: "Our smart default — premium quality and crisp text", id: "google/nano-banana", surcharge: 0 },
  // PREMIUM "Genius". Gemini 3 Pro Image (nano-banana-pro) at 2K — the sharpest
  // detail + best-in-class text. ~$0.15/img at 2K (hard-capped under $0.25 by
  // pinning resolution:"2K"; 4K is never requested).
  { key: "genius", name: "Genius", blurb: "Top-tier 2K — the sharpest detail and flawless text", id: "google/nano-banana-pro", surcharge: 5, resolution: "2K" },
];

export const CREATE_MODEL_BY_KEY: Record<string, CreateModel> = Object.fromEntries(
  CREATE_MODELS.map((m) => [m.key, m]),
);

export const DEFAULT_CREATE_MODEL = "smart";

/** A valid model key, or the default — never trust a raw form value. */
export function normalizeCreateModelKey(key: string | null | undefined): string {
  return key && CREATE_MODEL_BY_KEY[key] ? key : DEFAULT_CREATE_MODEL;
}

/** Extra tokens for a model key (0 for unknown/standard). */
export function createModelSurcharge(key: string | null | undefined): number {
  const m = key ? CREATE_MODEL_BY_KEY[key] : undefined;
  return m ? m.surcharge : 0;
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
