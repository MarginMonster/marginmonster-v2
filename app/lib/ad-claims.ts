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
  "(7) State no price, discount, sale, percentage-off or 'was/now' figure unless the merchant's details give that exact number — invent no '50% off', 'today only', 'lowest price' or deal. " +
  "(8) Invent no social proof: no reviews, star ratings, review or sales counts ('4.9 stars', '10,000 sold', 'thousands of five-star fans'), testimonials, quotes or awards unless the merchant's details state them. " +
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

/* ---- THE CLAIMS THAT CAN BE RECOGNISED BY THEIR OWN WORDS -------------------------------------
 *
 * The guardrail above is an instruction, and an instruction can lose. Made as a customer on
 * 2026-11-23: a Commercial for a set of toys with the Ad Maker's own quick direction "fast + funny,
 * lead with the price". The writer was given no price — so it led with one anyway: "Sixteen blind
 * boxes, the lowest price around", and the tagline "Sixteen Wonders, Lowest Price". Rule (7) names
 * 'lowest price' as a thing never to invent; the member's direction outweighed it. The line was
 * spoken by the narrator and printed on the screen.
 *
 * So the writer's answer is READ before it is used. These are the claims of rules 1, 3, 4, 5, 7 and 8
 * that are unmistakable as words (a price superlative, a discount, a deadline, a rank, a guarantee, a
 * provenance word). A claim the MERCHANT made — the words are in their own title, details or
 * direction — is theirs to make and is not a fault. English only: in another language the
 * instruction is still all there is.
 */
const CLAIM_WORDS: RegExp[] = [
  // price superlatives and comparisons (7)
  /\b(?:lowest|best|cheapest|unbeatable|unbeaten|rock[- ]bottom)\s+(?:price|prices|deal|deals|value|rate|rates)\b/gi,
  /\blowest[- ]ever\b/gi,
  /\bcheapest\b/gi,
  /\bprices?\s+(?:around|anywhere|in town|on the market)\b/gi,
  /\bbeats?\s+any\s+price\b/gi,
  /\bhalf[- ]price\b/gi,
  // discounts and deadlines (7)
  /\b\d{1,3}\s?%\s?off\b/gi,
  /\bpercent off\b/gi,
  /\bon sale\b/gi,
  /\bsale ends\b/gi,
  /\btoday only\b/gi,
  /\blimited[- ]time\b/gi,
  /\bflash sale\b/gi,
  /\bclearance\b/gi,
  /\bfree shipping\b/gi,
  /\bbuy one,? get one\b/gi,
  // scarcity (3)
  /\bwhile (?:supplies|stocks?) lasts?\b/gi,
  /\bselling (?:out )?fast\b/gi,
  /\balmost gone\b/gi,
  /\bonly \d+ left\b/gi,
  /\blast chance\b/gi,
  // rank and social proof (4, 8)
  /#\s?1\b/g,
  /\bnumber[- ]one\b/gi,
  /\bbest[- ]sell(?:er|ers|ing)\b/gi,
  /\btop[- ]rated\b/gi,
  /\baward[- ]winning\b/gi,
  /\b(?:five|5)[- ]stars?\b/gi,
  /\b\d(?:\.\d)?\s?stars\b/gi,
  /\bthousands of (?:happy |satisfied |five-star )?(?:customers|fans|reviews|buyers)\b/gi,
  // promises (5)
  /\bmoney[- ]back\b/gi,
  /\bguarantee[ds]?\b/gi,
  /\bwarranty\b/gi,
  /\brisk[- ]free\b/gi,
  // provenance (1)
  /\bauthentic\b/gi,
  /\bofficial(?:ly)?[- ]licen[sc]ed\b/gi,
  /\bgenuine\b/gi,
  /\bfactory[- ]sealed\b/gi,
];
const plainWords = (s: string) => (s || "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

/** The forbidden claims written into `text`, as the words that make them — minus any the merchant
 *  made themselves (`merchantSaid`: their title, details and direction). Empty = nothing to fix. */
export function claimFaults(text: string | null | undefined, merchantSaid?: string | null): string[] {
  const t = plainWords(text || "");
  if (!t) return [];
  const said = plainWords(merchantSaid || "");
  const out: string[] = [];
  for (const re of CLAIM_WORDS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const hit = m[0].trim();
      if (hit && !said.includes(hit) && !out.includes(hit)) out.push(hit);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return out;
}

/** What the writer is told when its draft made such claims: which words, and what to do instead. */
export function claimRepairNote(faults: readonly string[]): string {
  const quoted = faults.slice(0, 8).map((f) => `"${f}"`).join(", ");
  return (
    `YOUR LAST DRAFT BROKE THE CLAIMS RULE. It said ${quoted} — claims nobody gave you and nobody can check. ` +
    `Write it again. Every line that made one of those claims must be rewritten to sell on what the product IS and DOES, ` +
    `with no price talk, discount, deadline, rank, guarantee or authenticity claim that the details above do not state in those words. ` +
    `Keep the story, the scenes and every line that made no such claim.`
  );
}

/** Last resort, when a second draft still makes the claim: the sentences that make it are taken out and
 *  the rest is kept. Returns "" when nothing is left — the caller puts a plain line there. */
export function dropFaultSentences(text: string | null | undefined, merchantSaid?: string | null): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t || !claimFaults(t, merchantSaid).length) return t;
  const kept = t.split(/(?<=[.!?…])\s+/).filter((s) => !claimFaults(s, merchantSaid).length);
  return kept.join(" ").trim();
}
