/* Post one finished piece to the shop's linked socials — the Archive's "Post" button, as a function.
 *
 * This is the `intent === "post"` branch of app/routes/web.archive.tsx, lifted out so the posting queue
 * (post-queue.server.ts) sends a piece exactly the way a member's own tap does: the profile provisioned
 * on demand, the linked platforms refreshed live, a caption per platform with the go-link, the mandatory
 * #EasyModeAi tag on the member's own words, the trial credit, one publishPost per platform, and then the
 * bookkeeping on the asset (postedTo / postedUrls / postedAt, a campaign slot closed, SHIPPED_IT).
 *
 * It returns CODES, not sentences: the caller owns the wording (and the member's language). The Archive
 * can switch to this and keep its own sentences — see `PostAssetFail` for which sentence each code is.
 *
 * Everything that runs AFTER a publish succeeded is wrapped so it cannot throw: a caller that sees a throw
 * may treat it as "nothing went out", and that must be true.
 */

import { db } from "../db.server";
import { ensureProfile, publishPost, refreshLinkedPlatforms, socialProviderEnabled } from "./social-provider.server";
import { AI_DISCLOSURE_TAG, buildPostTitle, fallbackCaption, getOrMakeCaptions, trialCredit } from "./social-caption.server";
import { productLinkFor } from "./catalog-import.server";

import { POSTABLE_PLATFORMS as ALL_NETWORKS, takes } from "./social-networks";

/** The networks a piece can be posted to from here — the one shared list (social-networks.ts). */
export const POSTABLE_PLATFORMS: readonly string[] = ALL_NETWORKS;

/**
 * The one editable caption a member sees before a piece goes out — the Archive viewer's draft (the
 * `intent === "draft"` branch of app/routes/web.archive.tsx), as a function, so the posting queue's "Edit"
 * shows the very same words. Tuned to Instagram when linked, else the first linked network that takes the
 * piece; deep-linked at the product page when the catalogue was mirrored.
 *
 * Read-only except for one thing: writing the caption calls a text model, and getOrMakeCaptions caches what
 * it wrote on the asset (bodyJson.captions) so the next call, and the post itself, reuse it. It never spends
 * the member's tokens and never posts anything. Call it only when a member asks to see the words.
 */
export async function draftCaptionFor(
  shopId: string,
  assetId: string
): Promise<{ ok: true; caption: string; isVideo: boolean } | { ok: false; code: "gone" }> {
  const asset = await db.asset.findFirst({ where: { id: assetId, shopId, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
  if (!asset) return { ok: false, code: "gone" };
  let title = asset.title || "New from our shop";
  try { const m = JSON.parse(asset.metaJson || "{}"); title = m.productTitle || title; } catch { /* ignore */ }
  const isVideo = asset.type === "VIDEO_AD";
  let platforms: string[] = [];
  try {
    if (socialProviderEnabled()) platforms = (await refreshLinkedPlatforms(shopId)).filter((p) => takes(p, isVideo));
  } catch { /* ignore */ }
  if (platforms.length === 0) platforms = ["instagram"];
  const tune = platforms.includes("instagram") ? "instagram" : platforms[0];
  const captions = await getOrMakeCaptions(asset.id, shopId, { productTitle: title, isVideo, platforms });
  const fbText = fallbackCaption({ productTitle: title, isVideo, platforms }).text;
  const buyUrl = await productLinkFor(shopId, title);
  return { ok: true, caption: buildPostTitle(captions[tune], buyUrl, fbText, undefined, tune), isVideo };
}

/** Why nothing went out. In the Archive's words:
 *  provider-off → "Social posting is coming online — check back shortly."
 *  gone         → "That piece is gone — refresh and try again."
 *  no-media     → "This piece has no media to post."
 *  no-profile   → "Couldn't reach the posting service — try again in a minute."
 *  no-accounts  → "Link your socials first on the Auto-posting page."
 *  failed       → "Posting failed ({err}) — check your linked accounts." */
export type PostAssetFail = "provider-off" | "gone" | "no-media" | "no-profile" | "no-accounts" | "failed";

export type PostAssetResult =
  | { ok: true; landed: string[]; missed: string[]; postedUrls: Record<string, string>; lastErr?: string }
  | { ok: false; code: PostAssetFail; error?: string };

/**
 * Post `assetId` (which must belong to `shopId`, and be a VIDEO_AD or IMAGE_AD with media) to the shop's
 * linked accounts.
 *
 * @param caption   the member's own words — posted verbatim to every platform, with #EasyModeAi appended
 *                  when missing; empty/undefined = the AI caption written for the piece
 * @param platforms only these networks (still only the ones linked right now); empty/undefined = every
 *                  linked network
 * @param origin    fallback base for the go-link when SHOPIFY_APP_URL is unset (the Archive passes
 *                  externalOrigin(request); the worker has no request)
 */
export async function postAssetToSocials(opts: {
  shopId: string;
  assetId: string;
  caption?: string | null;
  platforms?: readonly string[] | null;
  origin?: string;
}): Promise<PostAssetResult> {
  const { shopId, assetId: id } = opts;
  if (!socialProviderEnabled()) return { ok: false, code: "provider-off" };
  const asset = await db.asset.findFirst({ where: { id, shopId, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
  if (!asset) return { ok: false, code: "gone" };
  let media: string | undefined;
  let title = asset.title || "New from our shop";
  try { const b = JSON.parse(asset.bodyJson || "{}"); media = b.videoUrl || b.imageUrl; } catch { /* ignore */ }
  try { const m = JSON.parse(asset.metaJson || "{}"); title = m.productTitle || title; } catch { /* ignore */ }
  if (!media) return { ok: false, code: "no-media" };
  // Provision-on-demand instead of hard-failing on a missing profile key, and a live platform refresh
  // instead of trusting the stale socials cache.
  const profileKey = await ensureProfile(shopId);
  if (!profileKey) return { ok: false, code: "no-profile" };
  // …and only the networks that take this kind of piece: a picture is never sent to a video-only network.
  let platforms = (await refreshLinkedPlatforms(shopId)).filter((p) => takes(p, asset.type === "VIDEO_AD"));
  if (opts.platforms && opts.platforms.length) platforms = platforms.filter((p) => opts.platforms!.includes(p));
  if (platforms.length === 0) return { ok: false, code: "no-accounts" };
  const isVideo = asset.type === "VIDEO_AD";
  // DO NOT ABSOLUTIZE THE MEDIA URL (the Archive's note, kept): every pipeline stores "/renders/<file>",
  // and publishPost resolves it against SHOPIFY_APP_URL — https — exactly as it does for a campaign drop.
  // Absolutising from a request reads http:// behind Render's edge.
  const mediaUrl = media;
  // The go-link goes out IN THE CAPTION, publicly, so it must be https: from the env, with the caller's
  // forwarded origin as a fallback.
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "") || (opts.origin || "").replace(/\/$/, "");

  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { activePlan: { select: { trialEndsAt: true } } } });
  const credit = trialCredit(shop?.activePlan);
  const custom = (opts.caption || "").trim();
  let titleFor: (p: string) => string;
  if (custom) {
    // Member words win, but the AI-disclosure tag is mandatory on every post — append it unless their
    // caption already carries it.
    const capBase = custom.slice(0, 860);
    const withTag = new RegExp(`#${AI_DISCLOSURE_TAG}\\b`, "i").test(capBase) ? capBase : `${capBase}\n\n#${AI_DISCLOSURE_TAG}`;
    titleFor = () => (credit ? `${withTag}\n\n${credit}` : withTag);
  } else {
    const captions = await getOrMakeCaptions(id, shopId, { productTitle: title, isVideo, platforms });
    const fbText = fallbackCaption({ productTitle: title, isVideo, platforms }).text;
    // Through OUR turnstile, so every click is counted on this exact piece.
    const goUrl = `${base}/go/a/${id}`;
    titleFor = (p) => buildPostTitle(captions[p], goUrl, fbText, credit, p);
  }

  // Name the platforms that actually took it — never the list that was asked for.
  let lastErr: string | undefined;
  const postedUrls: Record<string, string> = {};
  const landed: string[] = [];
  const missed: string[] = [];
  for (const p of platforms) {
    // publishPost never throws (it catches and returns ok:false); titleFor is a string build. So once the
    // first platform has gone out, nothing below can throw past this function.
    let r: { ok: boolean; error?: string; urls?: Record<string, string> };
    try {
      r = await publishPost(profileKey, { title: titleFor(p), mediaUrl, isVideo, platforms: [p] });
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : "network" };
    }
    if (r.ok) {
      landed.push(p);
      if (r.urls) Object.assign(postedUrls, r.urls);
    } else {
      missed.push(p);
      lastErr = r.error;
    }
  }
  if (!landed.length) return { ok: false, code: "failed", error: lastErr || "unknown" };

  // Remember WHERE it landed. postedTo is load-bearing; re-read and merge (a union, never a replace) with
  // a write pinned to the value read — the public click counter writes this same blob.
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const fresh = await db.asset.findUnique({ where: { id }, select: { metaJson: true } });
      if (!fresh) break; // the piece was deleted while we were posting
      let m: Record<string, unknown> = {};
      try { m = JSON.parse(fresh.metaJson || "{}"); } catch { /* fresh */ }
      m.postedUrls = { ...(m.postedUrls as Record<string, string> | undefined), ...postedUrls };
      m.postedAt = new Date().toISOString();
      m.postedTo = [...new Set([...((m.postedTo as string[] | undefined) || []), ...landed])];
      const done = await db.asset.updateMany({
        where: { id, metaJson: fresh.metaJson },
        data: { status: "PUBLISHED", metaJson: JSON.stringify(m) },
      });
      if (done.count === 1) break;
    }
  } catch (e) {
    console.error("[post-asset] could not record where the post landed (non-fatal):", e);
  }
  // If this piece is a drop in a running campaign, close its slot too.
  try {
    const { recordManualPost } = await import("./questlines.server");
    await recordManualPost(shopId, id, landed, postedUrls);
  } catch (e) {
    console.error("[post-asset] campaign slot update failed (non-fatal):", e);
  }
  // Shipped It — first piece that actually reached a social account.
  try { const { unlockAchievement } = await import("./xp.server"); await unlockAchievement(shopId, "SHIPPED_IT"); } catch { /* non-fatal */ }
  return { ok: true, landed, missed, postedUrls, lastErr };
}
