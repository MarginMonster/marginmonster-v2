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
}

export const CREATE_MODELS: CreateModel[] = [
  // DEFAULT. Google Gemini 2.5 Flash Image — premium photoreal + reliable,
  // legible text, ~$0.039/img. Already proven in this codebase (photo edits).
  { key: "best", name: "Best", blurb: "Premium quality — sharp detail and readable text", id: "google/nano-banana" },
  // Cheap + instant (~$0.003), but weak at words — keep for text-free art/drafts.
  { key: "fast", name: "Fast", blurb: "Instant drafts — cheapest, but fuzzy on words", id: "black-forest-labs/flux-schnell" },
];

export const CREATE_MODEL_BY_KEY: Record<string, CreateModel> = Object.fromEntries(
  CREATE_MODELS.map((m) => [m.key, m]),
);

export const DEFAULT_CREATE_MODEL = "best";

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
