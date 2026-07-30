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
];

export const AD_FORMAT_BY_KEY: Record<string, AdFormat> = Object.fromEntries(
  AD_FORMATS.map((f) => [f.key, f])
);
