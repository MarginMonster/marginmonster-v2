/* Ad Templates — the famous ad formats, rendered ONCE as clean plates with
 * the EasyMode Statue standing in for the product. Merchants browse statue
 * previews and know EXACTLY what they'll get:
 *   kind "exact"  — delivery composites the merchant's REAL product cutout
 *                   onto the same plate the preview used. Pixel-deterministic.
 *   kind "staged" — delivery re-stages the scene around the product with the
 *                   identity model + QA gate (splash, held-in-hand — things a
 *                   composite can't fake).
 * Preview text is PLACEHOLDER ("Your headline here") — real ads get fresh
 * copy written per product, so template text never conflicts with the item.
 * Pure data: safe to import from client and server code. */

export type AdTemplateKind = "exact" | "staged";

export interface AdTemplate {
  key: string;
  name: string;
  emoji: string;
  kind: AdTemplateKind;
  blurb: string;
  /** Prompt for the EMPTY plate (no product, no statue — a clean stage). */
  plate: string;
  /** For staged delivery: how the product sits in the scene. */
  placement?: string;
}

export const AD_TEMPLATES: AdTemplate[] = [
  {
    key: "colorblock", name: "Color Block", emoji: "🟥", kind: "exact",
    blurb: "The famous single-color poster — bold, flat, impossible to scroll past",
    plate: "Bold advertising backdrop: a flat vivid coral-red studio wall meeting a matching seamless coral floor, single-color color-block look, bright punchy even studio lighting, completely empty scene with clear open floor space across the lower third where a product will stand, no objects, no text, photorealistic, magazine-quality",
  },
  {
    key: "cleanwhite", name: "Clean White", emoji: "⬜", kind: "exact",
    blurb: "Minimal white editorial — the premium catalog look",
    plate: "Minimal editorial advertising backdrop: bright white seamless studio sweep, soft daylight-quality diffused lighting, faint soft ground shadow area in the lower third where a product will stand, completely empty, airy and premium, no objects, no text, photorealistic",
  },
  {
    key: "marbleluxe", name: "Marble Luxe", emoji: "💎", kind: "exact",
    blurb: "Polished marble + metal — quiet luxury",
    plate: "Luxury advertising backdrop: a polished white-and-gray marble surface with subtle brushed-gold metal accents, elegant controlled soft spotlight from above creating a refined pool of light on the empty marble surface in the lower third, generous negative space above, dark sophisticated ambience at the edges, completely empty, no objects, no text, photorealistic",
  },
  {
    key: "goldenhour", name: "Golden Hour", emoji: "🌇", kind: "exact",
    blurb: "Warm sunset glow — lifestyle warmth without the risk",
    plate: "Golden-hour advertising backdrop: a warm rustic wooden tabletop outdoors, glowing low golden-hour sunlight from behind with a soft lens flare and creamy bokeh of greenery, the empty tabletop surface across the lower third where a product will stand, completely empty, warm and aspirational, no objects, no text, photorealistic",
  },
  {
    key: "neonnight", name: "Neon Night", emoji: "🌃", kind: "exact",
    blurb: "Dark studio with electric neon rims — hype-drop energy",
    plate: "Neon advertising backdrop: a dark studio with two vertical neon light strips in electric blue and violet glowing at the sides, their colors reflecting on a glossy dark floor, an empty pool of reflective floor across the lower third where a product will stand, moody premium hype energy, completely empty, no objects, no text, photorealistic",
  },
  {
    key: "cozyhome", name: "Cozy Home", emoji: "🪴", kind: "exact",
    blurb: "Bright morning windowsill — warm, real, trustworthy",
    plate: "Cozy lifestyle advertising backdrop: a bright tidy wooden table by a big sunlit window, soft morning light, a small potted plant and a folded linen cloth at the far edges only, the center and lower third of the table completely EMPTY where a product will stand, warm inviting home feel, no other objects, no text, photorealistic",
  },
  {
    key: "splash", name: "Splash", emoji: "💦", kind: "staged",
    blurb: "Frozen water splash around your product — the classic drink-ad move",
    plate: "Commercial advertising backdrop: a clean bright aqua-blue studio, dynamic arcs of crystal-clear water frozen mid-splash around an empty central space where a product will appear, crisp bright studio lighting, energetic and fresh, no product, no text, photorealistic high-speed photography",
    placement: "the product bursting through the center of the splash, water droplets interacting with it naturally",
  },
  {
    key: "inhand", name: "In Hand", emoji: "🤳", kind: "staged",
    blurb: "Held up to camera, street-daylight UGC — social-native",
    plate: "UGC advertising backdrop: a person's hand raised toward the camera against a bright softly-blurred city street in daylight, the hand OPEN and empty where a product will be placed, candid phone-photo energy, bright true-to-life colors, no product, no text, photorealistic",
    placement: "held naturally in the hand, facing the camera, at its true real-world size with a five-fingered natural grip",
  },
];

export const AD_TEMPLATE_BY_KEY: Record<string, AdTemplate> = Object.fromEntries(
  AD_TEMPLATES.map((t) => [t.key, t])
);
