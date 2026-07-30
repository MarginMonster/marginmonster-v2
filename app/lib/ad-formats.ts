/* AD FORMATS — the statistically-proven static ad COMPOSITIONS (what Arcads
 * and Zeely lead with), replacing "one poster layout on eight backdrops".
 * Each format is a genuinely different creative structure:
 *
 *   callout      product hero + benefit callout lines   (Zeely signature)
 *   review       5-star testimonial card                (social proof)
 *   chat         text-message conversation              (Arcads signature)
 *   versus       us-vs-them comparison                  (category killer)
 *   beforeafter  split transformation                   (problem → solution)
 *   offer        big promo starburst                    (urgency/DTC sale)
 *   ugcframe     native social-feed frame               ("tiktok made me buy it")
 *   poster       bold statement headline                (the classic — existing engine)
 *
 * Copy is written per product by Claude (exact strings), the layout is
 * rendered by nano-banana around the merchant's REAL product photo, and a
 * vision QA gate rejects garbled text or a warped product before shipping.
 *
 * Every picker preview stars a DIFFERENT EasyMode-branded hero product,
 * chosen from the category that statistically dominates that format
 * (callouts → skincare, chat → sneakers, founder note → craft food…), so the
 * wall of tiles reads "we do every product", not "we do drink ads".
 * Pure data: safe on client and server. */

export interface AdFormat {
  key: string;
  name: string;
  emoji: string;
  blurb: string;
  /** Copy fields Claude must return for this format. */
  fields: string[];
  /** Canned copy for the self-forged EASYMODE picker preview. */
  preview: Record<string, string>;
  /** The EasyMode-branded hero product the preview is rendered around — a
   * different product category per format, from the category that most
   * commonly uses this ad style. */
  hero: string;
}

export const AD_FORMATS: AdFormat[] = [
  {
    key: "callout", name: "Callouts", emoji: "🎯",
    blurb: "Your product with benefit callouts — the highest-converting static format",
    fields: ["headline", "c1", "c2", "c3", "c4", "cta"],
    hero: "a sleek frosted-glass skincare serum bottle with a matte white dropper cap and a minimalist clinical label",
    preview: { headline: "Glass skin, minus the 12 steps.", c1: "2% hyaluronic acid", c2: "Vitamin C boost", c3: "Fragrance free", c4: "Recyclable glass", cta: "Shop now" },
  },
  {
    key: "review", name: "Review Card", emoji: "⭐",
    blurb: "A glowing 5-star review as the creative — social proof sells",
    fields: ["quote", "name"],
    hero: "a matte-black resealable bag of specialty coffee beans with a modern minimalist label",
    preview: { quote: "My kitchen makes better coffee than the cafe now. Not even close.", name: "Jordan M." },
  },
  {
    key: "chat", name: "Text Convo", emoji: "💬",
    blurb: "An iMessage conversation raving about it — the format that feels native",
    fields: ["m1", "m2", "m3", "m4"],
    hero: "a pair of clean minimalist white-and-sage running sneakers",
    preview: { m1: "ok where did you get those sneakers", m2: "EASYMODE. i'm obsessed", m3: "are they actually comfy??", m4: "bought a second pair. just try them" },
  },
  {
    key: "versus", name: "Us vs Them", emoji: "🆚",
    blurb: "A comparison table your product wins — steal demand from the category",
    fields: ["headline", "r1", "r2", "r3", "t1", "t2", "t3"],
    hero: "a modern protein snack bar in a matte kraft-and-green wrapper",
    preview: { headline: "There's no comparison.", r1: "12g protein", r2: "Five ingredients", r3: "Actually tastes good", t1: "Candy in disguise", t2: "Unpronounceable list", t3: "Chalk texture" },
  },
  {
    key: "beforeafter", name: "Before / After", emoji: "↔️",
    blurb: "The transformation split — problem on the left, your product on the right",
    fields: ["headline", "before", "after"],
    hero: "an amber glass hair-oil bottle with a gold dropper cap and a minimalist label",
    preview: { headline: "Frizz doesn't stand a chance.", before: "An hour fighting the flat iron", after: "One pass. Out the door." },
  },
  {
    key: "offer", name: "Big Offer", emoji: "💥",
    blurb: "Hero product + an offer starburst — urgency that gets the click",
    fields: ["headline", "offer", "cta"],
    hero: "premium matte-cream wireless over-ear headphones with plush earcups",
    preview: { headline: "Silence, upgraded.", offer: "$40 OFF this week", cta: "Claim it" },
  },
  {
    key: "ugcframe", name: "Feed Native", emoji: "📱",
    blurb: "Looks like a viral post, not an ad — caption bar, real-photo energy",
    fields: ["caption"],
    hero: "a lit hand-poured soy candle in an amber glass jar with a minimalist label",
    preview: { caption: "tiktok made me buy this candle and my whole apartment smells expensive now" },
  },
  {
    key: "poster", name: "Statement Poster", emoji: "🗞",
    blurb: "The bold headline poster — award-ad energy (our classic)",
    fields: ["headline", "sub", "cta"],
    hero: "a premium emerald sports hydration drink bottle with a black sport cap",
    preview: { headline: "Hydration, upgraded.", sub: "Everything you want. Nothing you don't.", cta: "Shop now" },
  },
  {
    key: "stat", name: "Number Flex", emoji: "🔢",
    blurb: "One huge product fact — a real number that does the selling",
    fields: ["stat", "statlabel", "headline", "cta"],
    hero: "a minimalist smartwatch with a slim aluminum case and a softly glowing watch face",
    preview: { stat: "14 days", statlabel: "of battery on one charge", headline: "Numbers don't lie.", cta: "Shop now" },
  },
  {
    key: "magazine", name: "Cover Story", emoji: "📰",
    blurb: "Your product as a glossy magazine cover star — editorial flex",
    fields: ["masthead", "cover1", "cover2"],
    hero: "an elegant rectangular glass perfume bottle with a gold cap",
    preview: { masthead: "EASYMODE", cover1: "The scent of the season", cover2: "Cedar, citrus, confidence" },
  },
  {
    key: "macro", name: "Detail Shots", emoji: "🔬",
    blurb: "Three extreme close-ups — texture and craft sell quality",
    fields: ["d1", "d2", "d3"],
    hero: "a minimalist stainless-steel wristwatch with a sapphire crystal face and a tan full-grain leather strap",
    preview: { d1: "Sapphire crystal", d2: "Brushed steel case", d3: "Full-grain leather" },
  },
  {
    key: "unbox", name: "What's Inside", emoji: "🎁",
    blurb: "Flat-lay of everything they get — value made visible",
    fields: ["headline", "i1", "i2", "i3"],
    hero: "a premium shaving kit — a weighted metal razor, a matching stand and a neat stack of blade refill cartridges",
    preview: { headline: "Everything you get", i1: "Weighted precision razor", i2: "Magnetic stand", i3: "A year of blades" },
  },
  {
    key: "founder", name: "Founder's Note", emoji: "✍️",
    blurb: "A sincere handwritten note from the maker — trust in one card",
    fields: ["note", "founder"],
    hero: "a small-batch hot sauce bottle with a hand-applied kraft paper label",
    preview: { note: "I spent three years perfecting this recipe in my kitchen. This is the bottle I finally felt proud to sign.", founder: "Dan, founder" },
  },
  {
    key: "poll", name: "This or That", emoji: "⚖️",
    blurb: "A playful side-by-side pick — your product is the obvious answer",
    fields: ["question", "left", "right"],
    hero: "a sleek water-resistant travel backpack in charcoal with matte black zippers",
    preview: { question: "Carry-on essentials only", left: "The saggy old duffel", right: "EASYMODE" },
  },
];

export const AD_FORMAT_BY_KEY: Record<string, AdFormat> = Object.fromEntries(
  AD_FORMATS.map((f) => [f.key, f])
);
