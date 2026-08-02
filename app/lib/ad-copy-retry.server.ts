/* Getting ad copy out of the model when the product is somebody else's brand.
 *
 * A 54-script sweep failed 14 times, and every failure was a branded
 * collectible — "POP MART SkullPanda Blind Box Case", "2024 Sonny Angel
 * Christmas Series". A plain "Stainless Steel Insulated Water Bottle" never
 * failed once. The model returns nothing rather than write promotional copy
 * for a third-party trademark, and the pipelines threw on empty, so a quarter
 * of one merchant's catalogue could not produce a video at all.
 *
 * Resellers are a large share of who this product is for, so "don't sell
 * branded goods" is not an available answer. The fix is to stop leading with
 * the trademark: ask again describing WHAT THE THING IS. A customer says "a
 * sealed case of blind-box figures", not "POP MART SkullPanda Blind Box Case
 * (12 pcs)" — which is better ad copy anyway, and the same reasoning the
 * jingle writer already applies to SKUs and region tags.
 */

/** Brand-ish tokens: capitalised words, ALLCAPS, and the pack/size/edition
 *  noise that listing titles carry. Stripping them leaves the category. */
const NOISE = /\b(\d+\s*(pcs?|pieces?|pack|count|ct|box(es)?|set)|\(.*?\)|v\d+|oem|s-chinese|\d{4})\b/gi;

/** A plain description of what the product IS, with the brand dropped.
 *
 *  Deliberately crude — it only has to give the writer something concrete to
 *  sell when the trademarked title got refused. Anything it can't reduce
 *  falls back to a generic phrase rather than an empty string. */
export function categoryDescription(productTitle: string): string {
  const cleaned = (productTitle || "")
    .replace(NOISE, " ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Keep the lowercase words — those are the common nouns that say what it is
  // ("blind box case", "insulated water bottle"). Capitalised tokens are
  // overwhelmingly the brand and the series name.
  const words = cleaned.split(" ").filter(Boolean);
  const common = words.filter((w) => w === w.toLowerCase() && w.length > 2);
  const phrase = (common.length >= 2 ? common : words.slice(-3)).join(" ").toLowerCase().trim();
  return phrase || "product";
}

/** Run a copy writer, retrying and then de-branding before giving up.
 *
 *  `write` is called with the product description to use. First with the real
 *  title, then again (a refusal can be a one-off), then with the category
 *  description and no brand name at all. */
export async function withBrandFallback(
  write: (productRef: string, debranded: boolean) => Promise<string>,
  productTitle: string,
  label: string
): Promise<string> {
  let out = (await write(productTitle, false)).trim();
  if (out) return out;

  out = (await write(productTitle, false)).trim();
  if (out) return out;

  const category = categoryDescription(productTitle);
  console.warn(`[${label}] model returned nothing twice for "${productTitle.slice(0, 60)}" — retrying as "${category}"`);
  out = (await write(category, true)).trim();
  if (out) return out;

  throw new Error(`[${label}] no copy after two attempts and a de-branded retry`);
}
