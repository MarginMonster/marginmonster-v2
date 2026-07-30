/* AD FORMATS — the statistically-proven static ad COMPOSITIONS (what Arcads
 * and Zeely lead with), replacing "one poster layout on eight backdrops".
 * Each format is a genuinely different creative structure — callouts,
 * testimonial cards, chat threads, comparisons, social screenshots, search
 * bars, editorial pull quotes, gift guides and more.
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
  {
    key: "tweet", name: "Viral Post", emoji: "🐦",
    blurb: "A social post raving about it — screenshot energy that stops the scroll",
    fields: ["name", "handle", "tweet"],
    hero: "a brushed stainless-steel insulated tumbler with a clear sliding lid",
    preview: { name: "Maya", handle: "@mayamoves", tweet: "not to be dramatic but this tumbler kept ice frozen through a nine hour road trip. i fear no summer." },
  },
  {
    key: "search", name: "Search Bar", emoji: "🔍",
    blurb: "\"best ___\" search with your product as the answer — intent made visible",
    fields: ["query", "s1", "s2", "s3"],
    hero: "a slim white sunscreen tube with minimalist typography",
    preview: { query: "best everyday sunscreen", s1: "best everyday sunscreen no white cast", s2: "best everyday sunscreen under makeup", s3: "best everyday sunscreen spf 50" },
  },
  {
    key: "notes", name: "Notes App", emoji: "📝",
    blurb: "A phone-notes checklist of reasons — private-thoughts authenticity",
    fields: ["title", "n1", "n2", "n3", "n4"],
    hero: "a rolled sage-green yoga mat with a carry strap",
    preview: { title: "why i actually stretch now", n1: "rolls out flat, never curls", n2: "grippy even mid sweat", n3: "wipes clean in seconds", n4: "fits behind the couch" },
  },
  {
    key: "reminder", name: "Lock Screen", emoji: "⏰",
    blurb: "A friendly phone notification — the ad that feels like a nudge",
    fields: ["alerttitle", "alertbody"],
    hero: "a matte white electric toothbrush on a charging stand",
    preview: { alerttitle: "EASYMODE", alertbody: "Two minutes. Your future smile says thanks." },
  },
  {
    key: "threereasons", name: "3 Reasons", emoji: "1️⃣",
    blurb: "Three numbered reasons to believe — the classic persuasion stack",
    fields: ["headline", "w1", "w2", "w3"],
    hero: "a kraft bag of dog training treats with a paw-print window",
    preview: { headline: "Why dogs lose their minds", w1: "One ingredient: real chicken", w2: "Baked slow, never fried", w3: "Tiny enough for training" },
  },
  {
    key: "handheld", name: "In Hand", emoji: "🤳",
    blurb: "A first-person hand-held shot with a sticky note — feels like a friend's photo",
    fields: ["caption"],
    hero: "a slim sage-green phone case with raised protective edges",
    preview: { caption: "the case that finally survived me dropping it down the stairs" },
  },
  {
    key: "pricemath", name: "Price Math", emoji: "🧮",
    blurb: "Cost-per-use math that makes the price feel tiny",
    fields: ["headline", "math", "punchline"],
    hero: "a tall dark-glass olive oil bottle with a cream minimalist label",
    preview: { headline: "Do the math.", math: "$0.40 per drizzle", punchline: "Cheaper than a bad oil habit." },
  },
  {
    key: "faq", name: "Q&A Card", emoji: "❓",
    blurb: "The question every buyer asks, answered in one confident card",
    fields: ["question", "answer"],
    hero: "an amber glass plant-food dropper bottle beside a thriving monstera leaf",
    preview: { question: "Does it actually work?", answer: "Droopy monstera to brand-new leaf in two weeks. Yes." },
  },
  {
    key: "press", name: "Pull Quote", emoji: "🗞️",
    blurb: "An editorial pull quote with big serif type — instant credibility",
    fields: ["praise", "outlet"],
    hero: "a minimalist brass desk lamp with a warm glowing shade",
    preview: { praise: "The desk lamp your eyes have been begging for.", outlet: "The Daily Edit" },
  },
  {
    key: "steps", name: "How It Works", emoji: "🪜",
    blurb: "1-2-3 panels from box to payoff — simplicity sells",
    fields: ["headline", "step1", "step2", "step3"],
    hero: "a compact matte-black handheld milk frother",
    preview: { headline: "Cafe foam in 20 seconds", step1: "Charge it once", step2: "Froth 20 seconds", step3: "Pour like a pro" },
  },
  {
    key: "gift", name: "Gift Pick", emoji: "🎀",
    blurb: "A gift-guide card with an editor's ribbon — seasonal money-maker",
    fields: ["headline", "badge", "sub"],
    hero: "a pair of thick cream merino wool socks folded neatly",
    preview: { headline: "The gift that always wins", badge: "Editor's Pick", sub: "Wool socks they'll actually wear out." },
  },
  {
    key: "restock", name: "Selling Fast", emoji: "🔥",
    blurb: "Back-in-stock urgency — the shelf that's almost empty",
    fields: ["headline", "urgency", "cta"],
    hero: "a matcha green tea powder tin with a bamboo scoop",
    preview: { headline: "Back in stock. Finally.", urgency: "Last restock sold out in days", cta: "Get yours" },
  },
  {
    key: "ingredients", name: "What's In It", emoji: "🧪",
    blurb: "Exploded ingredient view — transparency as the pitch",
    fields: ["headline", "g1", "g2", "g3"],
    hero: "a natural deodorant stick with a soft sage label",
    preview: { headline: "Nothing to hide", g1: "Shea butter", g2: "Coconut oil", g3: "Zero aluminum" },
  },
];

export const AD_FORMAT_BY_KEY: Record<string, AdFormat> = Object.fromEntries(
  AD_FORMATS.map((f) => [f.key, f])
);
