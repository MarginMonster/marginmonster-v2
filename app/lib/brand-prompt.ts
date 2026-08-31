/**
 * One house block describing the merchant's brand, for every prompt that needs
 * one.
 *
 * Four generators each built their own version of this block by interpolating
 * BrandProfile fields straight into a template literal. That is fine for a
 * profile written by the Shopify importer, which fills every field. It is not
 * fine for a profile created by the web brand form, which stores `productJson`
 * as "{}" and leaves `vocabulary` and `values` as empty arrays — so the blog
 * prompt went to the model reading:
 *
 *     Vocabulary to use:
 *     Brand values:
 *     Brand positioning: undefined
 *
 * A model handed the literal word "undefined" as a brand's positioning will
 * write around it, and empty labels spend the model's attention on nothing.
 * Omitting a line we cannot fill is strictly better than shipping a blank one.
 */

type Json = Record<string, unknown>;

export type BrandProfileJson = { voiceJson?: string | null; productJson?: string | null };

/** Never throws, and never returns an array or null pretending to be an object. */
const parse = (raw: string | null | undefined): Json => {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
  } catch {
    return {};
  }
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const list = (v: unknown): string =>
  Array.isArray(v) ? v.map(str).filter(Boolean).join(", ") : "";

/**
 * The lines that actually have content, newline-joined. Empty string when the
 * profile is blank — callers pair it with `|| NO_BRAND` so the prompt still
 * says something true.
 */
export function brandLines(profile: BrandProfileJson): string {
  const voice = parse(profile.voiceJson);
  const products = parse(profile.productJson);

  const out: string[] = [];
  const push = (label: string, value: string) => {
    if (value) out.push(`${label}: ${value}`);
  };

  push("Store", str(products.storeName));
  push("Sells", list(products.categories));
  push("Tone", str(voice.tone));
  push("Vocabulary to use", list(voice.vocabulary));
  push("Brand values", list(voice.values));
  push("Tagline", str(voice.tagline));
  push("Brand positioning", str(products.positioning));
  // The merchant's own words about their store, from the web brand form. Capped
  // because it is a free-text box and the rest of the prompt has work to do.
  push("About the store, in the merchant's own words", str(voice.about).slice(0, 600));

  return out.join("\n");
}

/** What to say when we know nothing about the brand yet. */
export const NO_BRAND =
  "No brand profile on file yet — write in a clear, confident, modern voice and keep every claim about the product itself.";

/** `brandLines` with the honest fallback already applied. */
export const brandBlock = (profile: BrandProfileJson): string => brandLines(profile) || NO_BRAND;
