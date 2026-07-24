import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";

/* AI caption + hashtag writer for auto-posted content.
 *
 * The creative (video/image) is billion-dollar; the caption is what the
 * recommendation engine actually reads to decide who sees it. Before this,
 * every post shipped as "ProductTitle — topic" + a link: no hook, no
 * hashtags, identical on every platform. That suppresses reach and reads as
 * spam. This writes a scroll-stopping, brand-true caption with a curated,
 * PER-PLATFORM hashtag set, then caches it on the asset so re-posts and
 * boosts reuse it instead of re-spending tokens.
 *
 * Cost: one Claude call on the cheap tier (~a few hundred output tokens) —
 * negligible next to the 60-token video it's promoting. Never blocks a post:
 * any failure falls back to the old minimal caption so a slot still ships.
 */

export type PlatformCaption = { text: string; hashtags: string[] };
export type CaptionSet = Record<string, PlatformCaption>; // keyed by platform

const SUPPORTED = ["tiktok", "instagram", "facebook"] as const;

// Per-platform hashtag budgets — each network's discovery sweet spot.
const TAG_CAP: Record<string, number> = { tiktok: 5, instagram: 6, facebook: 3 };

export interface CaptionInput {
  productTitle: string;
  productType?: string;
  topic?: string;
  isVideo: boolean;
  platforms: string[];
}

interface BrandVoice {
  tone?: string;
  vocabulary?: string[];
  tagline?: string;
  values?: string[];
}

/** Load the shop's brand voice (tone/vocab/tagline) so captions sound like
 *  the merchant, not a template. Returns {} if no profile yet. */
async function loadVoice(shopId: string): Promise<BrandVoice> {
  try {
    const bp = await db.brandProfile.findUnique({ where: { shopId }, select: { voiceJson: true } });
    if (!bp) return {};
    const v = JSON.parse(bp.voiceJson || "{}");
    return {
      tone: typeof v.tone === "string" ? v.tone : undefined,
      vocabulary: Array.isArray(v.vocabulary) ? v.vocabulary.slice(0, 6) : undefined,
      tagline: typeof v.tagline === "string" ? v.tagline : undefined,
      values: Array.isArray(v.values) ? v.values.slice(0, 3) : undefined,
    };
  } catch {
    return {};
  }
}

/** #-strip, keep alphanumerics only, drop empties/dupes, cap to the platform
 *  budget. Provider caption + tags come from a model, so we sanitize hard. */
function cleanTags(raw: unknown, platform: string): string[] {
  const cap = TAG_CAP[platform] ?? 4;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.replace(/[^0-9A-Za-z]/g, "");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= cap) break;
  }
  return out;
}

function firstJsonObject(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in caption response");
  return JSON.parse(m[0]);
}

/** The minimal, always-safe caption — matches the pre-AI behaviour so a
 *  failed generation never blocks a post. */
export function fallbackCaption(input: CaptionInput): PlatformCaption {
  const text = `${input.productTitle}${input.topic ? ` — ${input.topic}` : ""}`.trim() || "New from our shop";
  return { text, hashtags: [] };
}

/** Generate a per-platform caption set for the requested platforms. Never
 *  throws — on any error every requested platform gets the fallback. */
export async function generateCaptionSet(
  shopId: string,
  input: CaptionInput
): Promise<CaptionSet> {
  const wanted = input.platforms.filter((p) => (SUPPORTED as readonly string[]).includes(p));
  const set: CaptionSet = {};
  const fb = fallbackCaption(input);
  if (wanted.length === 0) return set;

  try {
    const voice = await loadVoice(shopId);
    const voiceLines = [
      voice.tone ? `Brand tone: ${voice.tone}` : "",
      voice.vocabulary?.length ? `Words the brand uses: ${voice.vocabulary.join(", ")}` : "",
      voice.tagline ? `Brand tagline: ${voice.tagline}` : "",
      voice.values?.length ? `Brand values: ${voice.values.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const medium = input.isVideo ? "short-form video (Reel/TikTok)" : "photo post";
    const platformRules = wanted.map((p) => {
      if (p === "instagram") return `- instagram: warm hook + 1 short line. ${TAG_CAP.instagram} hashtags: mix 2 broad-reach, 2-3 niche/product-specific, 1 branded.`;
      if (p === "tiktok") return `- tiktok: punchy, curiosity-driven opener (lowercase-casual ok). ${TAG_CAP.tiktok} broad DISCOVERY hashtags people actually search (e.g. #tiktokmademebuyit style), no niche jargon.`;
      return `- facebook: friendly, a touch more descriptive, clear value. only ${TAG_CAP.facebook} hashtags.`;
    }).join("\n");

    const prompt = `You write high-performing social captions for an e-commerce brand. Write scroll-stopping captions that boost reach WITHOUT looking AI-generated or spammy.

Product: ${input.productTitle}${input.productType ? ` (${input.productType})` : ""}
Format: ${medium}${input.topic ? `\nAngle/theme: ${input.topic}` : ""}
${voiceLines || "Brand voice: friendly, confident, modern."}

Write a distinct caption for EACH of these platforms, tuned to how that platform rewards content:
${platformRules}

Rules:
- Lead with a hook in the first 5-7 words. No "Introducing" / "Check out our".
- 1-2 short sentences MAX. A tasteful emoji or two, not a wall of them.
- Do NOT put the hashtags inside the caption text — return them separately.
- Do NOT include any link, price, or @mentions — those are added later.
- Hashtags: no spaces, no # symbol in the array, real tags people search.

Return ONLY this JSON (only the platforms listed above):
{
${wanted.map((p) => `  "${p}": { "text": "caption here", "hashtags": ["tag1", "tag2"] }`).join(",\n")}
}`;

    const raw = await anthropicText(prompt, { maxTokens: 700 });
    const parsed = firstJsonObject(raw);
    for (const p of wanted) {
      const entry = parsed[p] as { text?: unknown; hashtags?: unknown } | undefined;
      const text = typeof entry?.text === "string" && entry.text.trim() ? entry.text.trim() : fb.text;
      set[p] = { text: text.slice(0, 300), hashtags: cleanTags(entry?.hashtags, p) };
    }
  } catch (e) {
    console.error("[caption] generation failed, using fallback:", e instanceof Error ? e.message : e);
    for (const p of wanted) set[p] = fb;
  }
  return set;
}

/** Get cached captions for an asset, generating (and caching) any that are
 *  missing for the requested platforms. Content is stable per asset, so this
 *  spends tokens at most once per asset per platform. Cache lives under
 *  bodyJson.captions so it travels with the asset. */
export async function getOrMakeCaptions(
  assetId: string,
  shopId: string,
  input: CaptionInput
): Promise<CaptionSet> {
  const wanted = input.platforms.filter((p) => (SUPPORTED as readonly string[]).includes(p));
  if (wanted.length === 0) return {};

  let body: Record<string, unknown> = {};
  try {
    const asset = await db.asset.findUnique({ where: { id: assetId }, select: { bodyJson: true } });
    if (asset) body = JSON.parse(asset.bodyJson || "{}");
  } catch { /* treat as empty */ }

  const cached = (body.captions && typeof body.captions === "object" ? body.captions : {}) as CaptionSet;
  const missing = wanted.filter((p) => !cached[p]?.text);
  if (missing.length === 0) return cached;

  const fresh = await generateCaptionSet(shopId, { ...input, platforms: missing });
  const merged: CaptionSet = { ...cached, ...fresh };

  // Persist the merged set back onto the asset (best-effort; a write failure
  // just means we regenerate next time — never blocks the post).
  try {
    await db.asset.update({
      where: { id: assetId },
      data: { bodyJson: JSON.stringify({ ...body, captions: merged }) },
    });
  } catch (e) {
    console.error("[caption] cache write failed (non-fatal):", e instanceof Error ? e.message : e);
  }
  return merged;
}

/** Assemble the final post string for one platform: caption + shop link +
 *  hashtag block. Falls back to the plain caption if no captions were made. */
export function buildPostTitle(
  caption: PlatformCaption | undefined,
  goUrl: string,
  fallbackText: string
): string {
  const text = caption?.text?.trim() || fallbackText;
  const tags = (caption?.hashtags || []).map((t) => `#${t}`).join(" ");
  const parts = [text];
  if (goUrl) parts.push(`🛒 ${goUrl}`);
  if (tags) parts.push(tags);
  return parts.join("\n\n");
}
