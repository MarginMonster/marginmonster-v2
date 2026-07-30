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
}

export const AD_FORMATS: AdFormat[] = [
  {
    key: "callout", name: "Callouts", emoji: "🎯",
    blurb: "Your product with benefit callouts — the highest-converting static format",
    fields: ["headline", "c1", "c2", "c3", "c4", "cta"],
    preview: { headline: "Built different.", c1: "Zero sugar", c2: "300mg electrolytes", c3: "Insane flavor", c4: "Recyclable bottle", cta: "Shop now" },
  },
  {
    key: "review", name: "Review Card", emoji: "⭐",
    blurb: "A glowing 5-star review as the creative — social proof sells",
    fields: ["quote", "name"],
    preview: { quote: "I replaced my morning coffee with this. Never looking back.", name: "Jordan M." },
  },
  {
    key: "chat", name: "Text Convo", emoji: "💬",
    blurb: "An iMessage conversation raving about it — the format that feels native",
    fields: ["m1", "m2", "m3", "m4"],
    preview: { m1: "ok what is that green drink you had at the gym", m2: "EASYMODE. i'm obsessed", m3: "is it actually good??", m4: "bought 3 more. just try it" },
  },
  {
    key: "versus", name: "Us vs Them", emoji: "🆚",
    blurb: "A comparison table your product wins — steal demand from the category",
    fields: ["headline", "r1", "r2", "r3", "t1", "t2", "t3"],
    preview: { headline: "There's no comparison.", r1: "Zero sugar", r2: "Real electrolytes", r3: "Actually tastes good", t1: "Loaded with sugar", t2: "Artificial everything", t3: "Tastes like medicine" },
  },
  {
    key: "beforeafter", name: "Before / After", emoji: "↔️",
    blurb: "The transformation split — problem on the left, your product on the right",
    fields: ["headline", "before", "after"],
    preview: { headline: "Your 3pm crash called.", before: "Dragging through the day", after: "Locked in til 6" },
  },
  {
    key: "offer", name: "Big Offer", emoji: "💥",
    blurb: "Hero product + an offer starburst — urgency that gets the click",
    fields: ["headline", "offer", "cta"],
    preview: { headline: "The switch is easy.", offer: "20% OFF first order", cta: "Claim it" },
  },
  {
    key: "ugcframe", name: "Feed Native", emoji: "📱",
    blurb: "Looks like a viral post, not an ad — caption bar, real-photo energy",
    fields: ["caption"],
    preview: { caption: "tiktok made me buy it and honestly… it's better than they said" },
  },
  {
    key: "poster", name: "Statement Poster", emoji: "🗞",
    blurb: "The bold headline poster — award-ad energy (our classic)",
    fields: ["headline", "sub", "cta"],
    preview: { headline: "Hydration, upgraded.", sub: "Everything you want. Nothing you don't.", cta: "Shop now" },
  },
  {
    key: "stat", name: "Number Flex", emoji: "🔢",
    blurb: "One huge product fact — a real number that does the selling",
    fields: ["stat", "statlabel", "headline", "cta"],
    preview: { stat: "300mg", statlabel: "electrolytes per bottle", headline: "Numbers don't lie.", cta: "Shop now" },
  },
  {
    key: "magazine", name: "Cover Story", emoji: "📰",
    blurb: "Your product as a glossy magazine cover star — editorial flex",
    fields: ["masthead", "cover1", "cover2"],
    preview: { masthead: "EASYMODE", cover1: "The drink your gym bag is missing", cover2: "Zero sugar, all signal" },
  },
  {
    key: "macro", name: "Detail Shots", emoji: "🔬",
    blurb: "Three extreme close-ups — texture and craft sell quality",
    fields: ["d1", "d2", "d3"],
    preview: { d1: "Ice-cold condensation", d2: "Emerald clarity", d3: "Sport-cap precision" },
  },
  {
    key: "unbox", name: "What's Inside", emoji: "🎁",
    blurb: "Flat-lay of everything they get — value made visible",
    fields: ["headline", "i1", "i2", "i3"],
    preview: { headline: "Everything you get", i1: "The emerald original", i2: "Shaker-safe cap", i3: "Zero sugar formula" },
  },
  {
    key: "founder", name: "Founder's Note", emoji: "✍️",
    blurb: "A sincere handwritten note from the maker — trust in one card",
    fields: ["note", "founder"],
    preview: { note: "I got tired of sports drinks that taste like candy and do nothing. So we made the one I actually wanted.", founder: "Dan, founder" },
  },
  {
    key: "poll", name: "This or That", emoji: "⚖️",
    blurb: "A playful side-by-side pick — your product is the obvious answer",
    fields: ["question", "left", "right"],
    preview: { question: "Gym bag essentials only", left: "The sugary stuff", right: "EASYMODE" },
  },
];

export const AD_FORMAT_BY_KEY: Record<string, AdFormat> = Object.fromEntries(
  AD_FORMATS.map((f) => [f.key, f])
);
