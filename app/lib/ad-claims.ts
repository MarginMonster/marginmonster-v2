/* The claims guardrail shared by every copy generator — static ad fields
 * (image-generation), the blog body, and the UGC/commercial spoken scripts.
 *
 * Grounding stopped the generators INVENTING specs out of nothing, but a live
 * prod QA sweep (2026-10-05) surfaced a second failure grounding does not
 * touch: CLAIM-INFLATION of the very real terms they are now grounded on.
 *   - A "Comic-Con Pick" curation tag in a product title came back as
 *     "COMIC-CON'S MOST-HUNTED" — an implied endorsement by the trademarked
 *     convention — and "convention-level exclusivity" — invented scarcity.
 *   - A Simplified-Chinese Pokémon pack came back as "Authentic Pokémon TCG" —
 *     an authenticity/provenance claim we have no way to verify.
 * Both ship as paid advertising the merchant is liable for: FTC (16 CFR 465)
 * plus third-party trademark exposure (Comic-Con / Nintendo both litigate).
 *
 * Naming the product and its franchise descriptively stays fine — reselling
 * genuine goods allows naming them. These rules block the ADDED claim, not the
 * noun. One shared string so the four prompts can never drift apart. */
export const CLAIMS_GUARDRAIL =
  "Make NO claim you cannot verify about a third party or about provenance. Specifically: " +
  "(1) Never call the product authentic, official, genuine, licensed, original or a 'real' branded item, and never assert its packaging condition — no 'factory-sealed', 'sealed', 'unopened', 'brand-new' or 'mint' — unless the merchant's details state it; we cannot verify provenance or condition. Say what it is without an authenticity, licensing or condition claim. " +
  "(2) A brand, franchise, event, publication, retailer or person named on the product (for example a 'Comic-Con Pick' tag) is the STORE's own reference, NEVER a third-party endorsement: never write it as a possessive or approval ('Comic-Con's pick', 'chosen by', 'X-approved', 'as seen at X'), and never claim that third party endorses, stocks, awarded, licensed or is associated with it. " +
  "(3) Invent no scarcity or exclusivity — no 'limited', 'exclusive', 'rare', 'most-hunted', 'only at', 'event-exclusive', 'while supplies last' or 'selling fast' — unless the merchant's own details state it. " +
  "(4) State no superlative, ranking or market/category-performance claim as fact — no '#1', 'best', 'most-loved', 'top-rated', 'strongest-performing', 'fastest-growing', no 'S-tier'/tier ranking — unless the merchant's details support it. " +
  "(5) Promise no guarantee, warranty, refund, return or replacement — no 'lifetime', 'money-back', 'free replacement', 'satisfaction guaranteed', 'X-year warranty' — unless the merchant's details state that exact promise (it is a binding contract). " +
  "(6) In any comparison, state no specific factual claim about a competitor, rival brand or the category — contrast only on your product's own real, given strengths; never invent a rival's weakness or a 'most people…' statistic. " +
  "You MAY still name the product and its franchise descriptively and sell it on its real, given features.";

// Merchants append store-internal curation/marketing labels to product titles —
// "– Comic-Con Pick", "– Hot Deal", "– Best Seller". The copywriter anchors on
// them: live QA showed every Blokees "...– Comic-Con Pick" ad headline inflate
// the tag into "COMIC-CON'S PICK" (implied convention endorsement), and the tag
// also crowds out fresh angles. Strip a trailing DASH-suffix promo label before
// writing copy, so copy comes from the real product. Only the dash form — a
// parenthetical like "(9 pcs)" or "(20 Boxes)" is real spec info, never touched.
const PROMO_SUFFIX =
  /\s*[–—-]\s*(comic[\s-]?con\s+pick|hot\s+deal|hot\s+pick|best[\s-]?sell(?:er|ing)|staff\s+pick|editor'?s?\s+pick|top\s+pick|fan\s+favou?rite|limited\s+edition|must[\s-]?have|new\s+arrival|trending|exclusive|on\s+sale|sale)\s*$/i;
export function stripPromoTag(title: string | null | undefined): string {
  let t = (title || "").trim();
  for (let i = 0; i < 2 && PROMO_SUFFIX.test(t); i++) t = t.replace(PROMO_SUFFIX, "").trim();
  return t || (title || "").trim();
}

// Belt-and-braces for the endorsement possessive: even with the tag stripped
// from the title, the merchant's description can carry "Comic-Con Pick", so the
// model can still write "Comic-Con's pick". Strip the possessive from a KNOWN
// third-party trademark name (narrow list, so legit badges like "Editor's Pick"
// and ordinary possessives like "a collector's dream" are left alone). The org
// name itself stays — only the endorsement-implying 's is removed.
const ORG_POSSESSIVE =
  /\b(comic[\s-]?con|sdcc|nintendo|pok[eé]mon|sanrio|hello\s+kitty|bandai|disney|marvel|hasbro|funko)(['’]s)\b/gi;
export function dropOrgEndorsementPossessive(text: string): string {
  return typeof text === "string" ? text.replace(ORG_POSSESSIVE, "$1") : text;
}
