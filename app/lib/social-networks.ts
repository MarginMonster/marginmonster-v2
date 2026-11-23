/* The networks EasyMode posts to — one list, and the rules each one needs.
 *
 * Pure and dependency-free (no database, no env) so client code can import the names and the tests can
 * run it directly. social-provider.server.ts re-exports it; nothing else should keep its own list.
 *
 * Every fact below is from the provider's own documentation (upload-post), read 2026-11-22:
 *   platform[] values, per-network fields ......... docs.upload-post.com/api/upload-video , /api/upload-photo
 *   length limits and how they are counted ........ docs.upload-post.com/resources/character-limits
 *   the AI-generated label per network ............ docs.upload-post.com/guides/ai-content-labeling
 *   which networks the hosted connect page takes .. docs.upload-post.com/api/user-profiles (generate-jwt)
 *   analytics ...................................... docs.upload-post.com/api/get-analytics
 *
 * Left out on purpose: PINTEREST — `pinterest_board_id` is REQUIRED on every pin (upload-video and
 * upload-photo pages), i.e. the member would have to pick a board. Reddit (503 at the provider, and needs a
 * subreddit), Discord/Telegram/Mastodon/etc. are not short-video networks.
 *
 * TikTok, Instagram and Facebook keep exactly the request they had before this file existed: one `title`
 * trimmed by trimKeepingDisclosure (post-title.ts), no per-network fields. Only the new networks get extras.
 */

import { trimKeepingDisclosure } from "./post-title.ts";
import { trimToWord, trimTitle } from "./text-trim.ts";

export type NetworkKey = "tiktok" | "instagram" | "facebook" | "youtube" | "x" | "threads" | "linkedin" | "bluesky";

export type Network = {
  key: NetworkKey;
  /** the network's own name, shown as-is (brand names are not translated) */
  name: string;
  video: boolean;
  photo: boolean;
  /** the most the post text may be once the link, the hashtags, #EasyModeAi and the trial credit are on */
  captionMax: number;
  /** how the network counts captionMax: UTF-16 characters, or UTF-8 bytes (Threads, YouTube) */
  captionUnit: "chars" | "bytes";
  /** "shared": the one `title` every network has always had (≤150, the three original networks).
   *  "own": the network gets its own text field, fitted to captionMax.
   *  "headline+own": also a separate short HEADLINE of at most headlineMax characters (a YouTube title). */
  titleRule: "shared" | "own" | "headline+own";
  headlineMax?: number;
  /** the network removes links from the text (X) — so the go-link is not spent out of the budget */
  stripsLinks?: boolean;
  /** the provider's hosted "link your accounts" page offers it (generate-jwt `platforms` values) */
  hostedConnect: boolean;
  /** hashtags the caption writer asks for */
  hashtags: number;
};

export const NETWORKS: readonly Network[] = [
  { key: "tiktok", name: "TikTok", video: true, photo: true, captionMax: 150, captionUnit: "chars", titleRule: "shared", hostedConnect: true, hashtags: 5 },
  { key: "instagram", name: "Instagram", video: true, photo: true, captionMax: 150, captionUnit: "chars", titleRule: "shared", hostedConnect: true, hashtags: 6 },
  { key: "facebook", name: "Facebook", video: true, photo: true, captionMax: 150, captionUnit: "chars", titleRule: "shared", hostedConnect: true, hashtags: 3 },
  // Shorts: video only (YouTube is not a platform[] value on upload_photos). Title ≤100 and is required;
  // the description is checked as 5,000 characters AND 5,000 UTF-8 bytes — bytes is the stricter one.
  { key: "youtube", name: "YouTube", video: true, photo: false, captionMax: 5000, captionUnit: "bytes", titleRule: "headline+own", headlineMax: 100, hostedConnect: true, hashtags: 3 },
  // 280 (Premium 25,000 — we cannot tell, so 280). Longer text becomes a THREAD; URLs are removed by the provider.
  { key: "x", name: "X", video: true, photo: true, captionMax: 280, captionUnit: "chars", titleRule: "own", stripsLinks: true, hostedConnect: true, hashtags: 2 },
  // 500, counted in UTF-8 bytes (an emoji is 4). Longer text becomes a thread.
  { key: "threads", name: "Threads", video: true, photo: true, captionMax: 500, captionUnit: "bytes", titleRule: "own", hostedConnect: true, hashtags: 1 },
  // post 3,000; a video title is cut at 400 with an ellipsis, so the text goes in the description (commentary)
  { key: "linkedin", name: "LinkedIn", video: true, photo: true, captionMax: 3000, captionUnit: "chars", titleRule: "headline+own", headlineMax: 100, hostedConnect: true, hashtags: 3 },
  // 300. NOT a value the hosted connect page documents (Bluesky links with an app password) — posted to only
  // when the account is already linked to the member's profile.
  { key: "bluesky", name: "Bluesky", video: true, photo: true, captionMax: 300, captionUnit: "chars", titleRule: "own", hostedConnect: false, hashtags: 2 },
];

const BY_KEY: Record<string, Network> = Object.fromEntries(NETWORKS.map((n) => [n.key, n]));

/** Every network a piece can be posted to. */
export const POSTABLE_PLATFORMS: readonly NetworkKey[] = NETWORKS.map((n) => n.key);
/** …that take a video (the Channels / Product Channels pickers). */
export const VIDEO_PLATFORMS: readonly NetworkKey[] = NETWORKS.filter((n) => n.video).map((n) => n.key);
/** …that take a photo. */
export const PHOTO_PLATFORMS: readonly NetworkKey[] = NETWORKS.filter((n) => n.photo).map((n) => n.key);
/** …that the provider's hosted connect page can link (the generate-jwt `platforms` array). */
export const CONNECT_PLATFORMS: readonly NetworkKey[] = NETWORKS.filter((n) => n.hostedConnect).map((n) => n.key);
/** The analytics endpoint answers for every network above (get-analytics lists them all); a network it
 *  cannot answer for comes back as a per-network message, which fetchAnalytics skips. */
export const ANALYTICS_PLATFORMS: readonly NetworkKey[] = POSTABLE_PLATFORMS;

export function network(key: string): Network | undefined {
  return BY_KEY[key];
}
export function isPostable(key: string): key is NetworkKey {
  return key in BY_KEY;
}
/** The network's display name; an unknown key is shown as itself. */
export function networkName(key: string): string {
  return BY_KEY[key]?.name ?? key;
}
/** Can this network take this kind of piece? */
export function takes(key: string, isVideo: boolean): boolean {
  const n = BY_KEY[key];
  return !!n && (isVideo ? n.video : n.photo);
}

// ── fitting a post into a network's limit ────────────────────────────────────────────────────────────
// The same priorities as trimKeepingDisclosure (post-title.ts), for any limit and either unit:
// the disclosure (legal), then the link (the money), then the caption, then the member's other hashtags,
// then the trial credit (a watermark). The literals are duplicated on purpose, as post-title does: this
// is the last gate before bytes leave, and it must not depend on the caption writer's module.

const DISCLOSURE = "#EasyModeAi";
/** Must equal TRIAL_CREDIT in social-caption.server.ts (a test holds them together). */
export const TRIAL_CREDIT_TEXT = "✨ Made with EasyMode";
const SEP = "\n\n";
const LINK_BLOCK = /^(?:🛒\s*)?https?:\/\/\S+$/;
const TAGS_ONLY = /^(?:#[0-9A-Za-z_]+\s*)+$/;

const encoder = new TextEncoder();
export const utf8Bytes = (s: string): number => encoder.encode(s).length;
const measurer = (unit: "chars" | "bytes") => (unit === "bytes" ? utf8Bytes : (s: string) => s.length);
const hasDisclosure = (s: string) => s.toLowerCase().includes(DISCLOSURE.toLowerCase());

/** The longest whole-word start of `s` that measures at most `room`. */
function trimToFit(s: string, room: number, measure: (s: string) => number): string {
  let n = Math.min(s.length, room);
  while (n > 0) {
    const cut = trimToWord(s, n);
    const m = measure(cut);
    if (m <= room) return cut;
    n -= Math.max(1, m - room);
  }
  return "";
}

/** Fit an assembled post (caption \n\n 🛒 link \n\n #tags #EasyModeAi \n\n credit) into `max`.
 *  Text that already fits comes back unchanged. #EasyModeAi is never cut off. */
export function fitCaption(raw: string, max: number, opts: { unit?: "chars" | "bytes"; dropLink?: boolean } = {}): string {
  const measure = measurer(opts.unit ?? "chars");
  let blocks = (raw || "").trim().split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (opts.dropLink) blocks = blocks.filter((b) => !LINK_BLOCK.test(b));
  const whole = opts.dropLink ? blocks.join(SEP) : (raw || "").trim();
  if (measure(whole) <= max && (hasDisclosure(whole) || !whole)) return whole;

  const linkIdx = blocks.findIndex((b) => LINK_BLOCK.test(b));
  const tagIdx = blocks.findIndex((b, i) => i !== linkIdx && TAGS_ONLY.test(b) && hasDisclosure(b));
  const creditIdx = blocks.findIndex((b, i) => i !== linkIdx && i !== tagIdx && b === TRIAL_CREDIT_TEXT);
  const link = linkIdx >= 0 ? blocks[linkIdx] : "";
  const tagBlock = tagIdx >= 0 ? blocks[tagIdx] : "";
  const credit = creditIdx >= 0 ? blocks[creditIdx] : "";
  const body = blocks
    .filter((_, i) => i !== linkIdx && i !== tagIdx && i !== creditIdx)
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .trim();
  const join = (parts: string[]) => parts.filter(Boolean).join(SEP);
  // an inline #EasyModeAi in the member's own words counts; otherwise the tag is added
  const tags = tagBlock || (hasDisclosure(body) ? "" : DISCLOSURE);

  // 1. everything, the credit (a watermark) going first
  for (const tail of [credit, ""]) {
    const all = join([body, link, tags, tail]);
    if (measure(all) <= max) return all;
  }
  // 2. the member's other hashtags go before any of the caption does
  if (tagBlock && tagBlock !== DISCLOSURE) {
    const lean = join([body, link, DISCLOSURE]);
    if (measure(lean) <= max) return lean;
  }
  // 3. cut the caption, never the disclosure; the link only if even link + tag do not fit
  let keepLink = link;
  if (measure(join([keepLink, DISCLOSURE])) > max) keepLink = "";
  const room = max - measure(join([keepLink, DISCLOSURE])) - measure(SEP);
  const kept = room >= 12 ? trimToFit(body, room, measure) : "";
  return join([kept, keepLink, hasDisclosure(kept) ? "" : DISCLOSURE]);
}

/** A short, real title from an assembled post: its words only — no link, no hashtag block, no credit. */
export function headlineOf(raw: string, max: number, fallback = "New video"): string {
  const body = (raw || "")
    .trim()
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b && !LINK_BLOCK.test(b) && !TAGS_ONLY.test(b) && b !== TRIAL_CREDIT_TEXT)
    .join(" ");
  return trimTitle(body, max) || trimTitle(fallback, max);
}

/** The post text for ONE network, inside its limit. The three original networks get exactly what they
 *  always got (trimKeepingDisclosure's 150). */
export function captionFor(key: string, raw: string): string {
  const n = BY_KEY[key];
  if (!n || n.titleRule === "shared") return trimKeepingDisclosure(raw);
  return fitCaption(raw, n.captionMax, { unit: n.captionUnit, dropLink: n.stripsLinks });
}

// YouTube rejects a title or description containing "<" or ">".
const noAngles = (s: string) => s.replace(/[<>]/g, "");

/** The extra form fields ONE network needs, beyond the shared ones. Empty for TikTok/Instagram/Facebook.
 *  Field names are the provider's (upload-video / upload-photo pages); the AI label rides the shared
 *  `is_ai_generated` alias (X → made_with_ai, Threads → is_made_with_ai), except YouTube, set explicitly. */
export function networkFields(key: string, raw: string, isVideo: boolean): Array<[string, string]> {
  const n = BY_KEY[key];
  if (!n || n.titleRule === "shared" || !takes(key, isVideo)) return [];
  const text = captionFor(key, raw);
  switch (n.key) {
    case "youtube":
      return [
        ["youtube_title", noAngles(headlineOf(raw, n.headlineMax!))],
        ["youtube_description", noAngles(text)],
        ["privacyStatus", "public"],
        ["selfDeclaredMadeForKids", "false"],
        ["containsSyntheticMedia", "true"],
      ];
    case "linkedin":
      return [
        ["linkedin_title", headlineOf(raw, n.headlineMax!)],
        ["linkedin_description", text],
      ];
    case "x":
      return [["x_title", text]];
    case "threads":
      return [["threads_title", text]];
    case "bluesky":
      return [["bluesky_title", text]];
    default:
      return [];
  }
}

export type SkipReason = "unknown-network" | "no-photos" | "no-videos";
export type PublishPlan = {
  /** the form fields, in order, before the media is attached */
  fields: Array<[string, string]>;
  /** the networks the request goes to */
  sent: string[];
  /** the networks left out of the request, and why */
  skipped: Array<{ platform: string; reason: SkipReason }>;
};

/** Everything publishPost sends except the media itself. A network that cannot take this kind of piece
 *  is left out (and named in `skipped`) instead of failing the whole post. */
export function planPublish(username: string, p: { title: string; isVideo: boolean; platforms: string[] }): PublishPlan {
  const sent: string[] = [];
  const skipped: PublishPlan["skipped"] = [];
  for (const key of p.platforms) {
    const n = BY_KEY[key];
    if (!n) skipped.push({ platform: key, reason: "unknown-network" });
    else if (!takes(key, p.isVideo)) skipped.push({ platform: key, reason: p.isVideo ? "no-videos" : "no-photos" });
    else sent.push(key);
  }
  const fields: Array<[string, string]> = [["user", username], ["title", trimKeepingDisclosure(p.title)]];
  for (const key of sent) fields.push(["platform[]", key]);
  // THE PLATFORMS' OWN "AI-GENERATED" LABEL — see publishPost.
  fields.push(["is_ai_generated", "true"]);
  if (p.isVideo && sent.includes("facebook")) fields.push(["facebook_is_ai_generated", "true"]);
  for (const key of sent) fields.push(...networkFields(key, p.title, p.isVideo));
  return { fields, sent, skipped };
}
