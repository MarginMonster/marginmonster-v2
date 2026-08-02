/* Web Archive — finished pieces for web accounts. Media serves from the same
 * /renders route the embedded app uses. Full parity with the embedded Archive:
 * fullscreen viewer, Keep + 30-day expiry countdown, delete, remix, blog
 * read/export, caption preview before posting, downloads, wallet readout. */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useActionData, useLoaderData, useNavigation, useRevalidator, useSearchParams, useSubmit } from "@remix-run/react";
import { useEffect, useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { ensureProfile, linkedFromCache, publishPost, refreshLinkedPlatforms, socialProviderEnabled } from "../lib/social-provider.server";
import { spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { assertCapability, videoCapabilityFor } from "../lib/capabilities.server";
import { enqueueJob } from "../lib/job-queue.server";
import { AI_DISCLOSURE_TAG, buildPostTitle, fallbackCaption, getOrMakeCaptions, trialCredit } from "../lib/social-caption.server";
import { catalogImageFor, productLinkFor } from "../lib/catalog-import.server";

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Human name for the recipe behind an asset — the ad format, backdrop
 *  template, cartoon style or video style it was built with. metaJson carries
 *  the picked keys; bodyJson's `method` records what the pipeline ACTUALLY
 *  used after any fallback, which is the honest answer. */
/** The format the merchant picked, when the render didn't manage to deliver it.
 *
 *  A silent fallback is worse than a visible one: the merchant spent tokens on
 *  a Versus ad, got a scene ad, and had no way to tell whether the pick was
 *  ignored or the layout just didn't land. Surfacing it also makes Remix the
 *  obvious next move. */
function pickedButMissed(metaJson: string | null, bodyJson: string | null): string | null {
  let meta: Record<string, unknown> = {};
  let body: Record<string, unknown> = {};
  try { meta = JSON.parse(metaJson || "{}"); } catch { /* ignore */ }
  try { body = JSON.parse(bodyJson || "{}"); } catch { /* ignore */ }
  if (typeof body.formatFallback !== "string" || !body.formatFallback) return null;
  const key = typeof meta.formatKey === "string" ? meta.formatKey : "";
  if (!key) return null;
  return key.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function recipeLabel(metaJson: string | null, bodyJson: string | null): string | null {
  let meta: Record<string, unknown> = {};
  let body: Record<string, unknown> = {};
  try { meta = JSON.parse(metaJson || "{}"); } catch { /* ignore */ }
  try { body = JSON.parse(bodyJson || "{}"); } catch { /* ignore */ }
  const pretty = (k: string) => k.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const method = typeof body.method === "string" ? body.method : "";
  const m = method.match(/^(format|template|template-staged|template-fallback):(.+)$/);
  if (m) return `${pretty(m[2])}${m[1].startsWith("template") ? " backdrop" : ""}`;
  // metaJson always records the format the merchant PICKED, but the render
  // falls back to a plain scene ad when the layout fails QA. Claiming the
  // format anyway told merchants they got a Versus ad when they plainly
  // hadn't — the label has to describe what was BUILT, not what was asked for.
  if (typeof body.formatFallback === "string" && body.formatFallback) return method ? pretty(method) : null;
  if (typeof meta.formatKey === "string" && meta.formatKey) return pretty(meta.formatKey);
  if (typeof meta.templateKey === "string" && meta.templateKey) return `${pretty(meta.templateKey)} backdrop`;
  if (typeof meta.cartoonStyle === "string" && meta.cartoonStyle) return pretty(meta.cartoonStyle);
  if (typeof meta.style === "string" && meta.style) return pretty(meta.style);
  if (method === "presenter") return "With presenter";
  if (method) return pretty(method);
  return null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const assets = await db.asset.findMany({
    where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "BLOG_POST"] } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const jobs = await db.job.findMany({
    where: { shopId: shop.id, status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] }, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  // Cooking tiles, same logic as the embedded Archive: live ETA per job type,
  // product image as the tile art, failed jobs surfaced instead of vanishing.
  const nowMs = Date.now();
  const TYPICAL: Record<string, number> = { GENERATE_VIDEO_AD: 180, GENERATE_IMAGE_AD: 45, GENERATE_BLOG_POST: 40 };
  const KIND: Record<string, "video" | "image" | "blog"> = { GENERATE_VIDEO_AD: "video", GENERATE_IMAGE_AD: "image", GENERATE_BLOG_POST: "blog" };
  const RETRY_FLAT: Record<string, number> = { GENERATE_VIDEO_AD: TOKEN_COST.video, GENERATE_IMAGE_AD: TOKEN_COST.image, GENERATE_BLOG_POST: TOKEN_COST.blog };
  const cookingCards: { jobId: string; kind: "video" | "image" | "blog"; status: "generating" | "failed"; productImage: string | null; productTitle: string; etaSec: number; elapsedSec: number; refunded: boolean; retryCost: number }[] = [];
  for (const j of jobs) {
    let p: { productImageUrl?: string; productTitle?: string; refunded?: boolean } = {};
    try { p = JSON.parse(j.payload); } catch { /* ignore */ }
    const due = !j.runAt || j.runAt.getTime() <= nowMs;
    const failed = j.status === "FAILED";
    const generating = j.status === "IN_PROGRESS" || (j.status === "PENDING" && due);
    if (!failed && !generating) continue; // future-scheduled drip isn't "cooking"
    const startMs = (j.status === "IN_PROGRESS" ? j.updatedAt : j.createdAt).getTime();
    // Math.max(5, …) pinned the countdown at "5s left" forever once the
    // estimate ran out — a merchant watched it say that for two minutes. An
    // estimate that has expired is not a five-second estimate; it is an
    // expired estimate, and the honest thing is to stop counting and say the
    // render is taking longer than usual.
    const elapsedSec = Math.round((nowMs - startMs) / 1000);
    const etaSec = generating ? Math.round(TYPICAL[j.type] - elapsedSec) : 0;
    const pl = p as { chargedTokens?: number };
    const retryCost = failed && p.refunded ? (typeof pl.chargedTokens === "number" && pl.chargedTokens > 0 ? pl.chargedTokens : RETRY_FLAT[j.type] || 0) : 0;
    cookingCards.push({ jobId: j.id, kind: KIND[j.type] || "image", status: failed ? "failed" : "generating", productImage: p.productImageUrl || null, productTitle: p.productTitle || "", etaSec, elapsedSec, refunded: !!p.refunded, retryCost });
  }
  const linked = linkedFromCache(shop.socialsJson).filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
  // Un-kept media (PENDING video/photo) auto-clears at 30 days — surface a
  // per-item countdown so nothing vanishes as a surprise. Blogs never expire.
  const CACHE_DAYS = 30;
  return json({
    canPost: socialProviderEnabled() && linked.length > 0,
    linkedCount: linked.length,
    linked,
    tokens: tokensRemainingLive(shop.activePlan),
    hasPlan: !!shop.activePlan,
    cost: TOKEN_COST,
    cooking: cookingCards.filter((c) => c.status === "generating").length,
    cookingCards,
    assets: assets.map((a) => {
      let body: { videoUrl?: string; imageUrl?: string; title?: string; html?: string } = {};
      try { body = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
      const text = typeof body.html === "string" ? stripHtml(body.html) : undefined;
      const unkeptMedia = a.status === "PENDING" && (a.type === "VIDEO_AD" || a.type === "IMAGE_AD");
      const daysLeft = unkeptMedia ? Math.max(0, CACHE_DAYS - Math.floor((nowMs - a.createdAt.getTime()) / 86_400_000)) : undefined;
      return {
        id: a.id,
        type: a.type,
        title: a.title || body.title || "Untitled",
        media: body.videoUrl || body.imageUrl || null,
        isVideo: a.type === "VIDEO_AD",
        snippet: text ? text.slice(0, 140) : undefined,
        html: a.type === "BLOG_POST" && typeof body.html === "string" ? body.html : undefined,
        // Which recipe built this? Merchants remix and compare, and "the one
        // that worked" is unfindable if the ad won't say what it was.
        recipe: recipeLabel(a.metaJson, a.bodyJson),
        missed: pickedButMissed(a.metaJson, a.bodyJson),
        when: a.createdAt.toISOString(),
        status: a.status,
        daysLeft,
      };
    }),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "retryJob") {
    // Same economics as the embedded app: interrupted failure = free retry;
    // refunded terminal failure = a fresh purchase (re-charge, restore prePaid).
    // No status filter — a wedged IN_PROGRESS job can be kicked back to PENDING.
    const jobId = (form.get("jobId") as string) || "";
    const job = await db.job.findFirst({ where: { id: jobId, shopId: shop.id, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] } } });
    if (!job) return json({ error: "That job's gone — try generating again from the Studio." });
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(job.payload); } catch { /* ignore */ }
    if (job.type === "GENERATE_VIDEO_AD") {
      try { assertCapability(shop.activePlan, videoCapabilityFor((payload.contentType as string) || undefined)); }
      catch (e) { return json({ error: (e as Error).message }); }
    }
    let newPayload: string | undefined;
    if (payload.refunded) {
      const flat = job.type === "GENERATE_VIDEO_AD" ? TOKEN_COST.video : job.type === "GENERATE_IMAGE_AD" ? TOKEN_COST.image : TOKEN_COST.blog;
      const cost = typeof payload.chargedTokens === "number" && payload.chargedTokens > 0 ? (payload.chargedTokens as number) : flat;
      try { await spendTokens(shop.id, cost); }
      catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens to retry." }); }
      newPayload = JSON.stringify({ ...payload, prePaid: true, refunded: false });
    }
    await db.job.update({ where: { id: job.id }, data: { status: "PENDING", attempts: 0, lastError: null, runAt: new Date(), ...(newPayload ? { payload: newPayload } : {}) } });
    return json({ ok: "Retrying — back in the oven. 🔥" });
  }
  if (intent === "dismissJob") {
    const jobId = (form.get("jobId") as string) || "";
    await db.job.deleteMany({ where: { id: jobId, shopId: shop.id, status: "FAILED", type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] } } });
    return json({});
  }
  if (intent === "keep") {
    await db.asset.updateMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id }, data: { status: "APPROVED" } });
    return json({ kept: true });
  }
  if (intent === "delete") {
    await db.asset.deleteMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id } });
    return json({ deleted: true });
  }
  if (intent === "remix") {
    // "Remix" = make a fresh variation of a piece they already liked. We reuse
    // the original's product + direction and enqueue the same kind of job; the
    // avatar variant is nudged so the new take genuinely looks different.
    // Costs the same as making one new. (Web accounts have no Shopify catalog
    // to re-fetch a photo from — the metaJson-stored productImageUrl rides along.)
    if (!shop.brandProfile) return json({ error: "Analyze your store first so remixes match your brand." });
    if (!shop.activePlan?.active) return json({ error: "Pick a plan first — remixes run on tokens." });
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "BLOG_POST"] } } });
    if (!asset) return json({ error: "That piece is gone — refresh and try again." });
    let meta: { productTitle?: string; avatarId?: string; avatarVariant?: number; direction?: string; style?: string; cartoonStyle?: string; productImageUrl?: string; formatKey?: string; templateKey?: string; serviceMode?: boolean; styleMode?: string; wear?: boolean } = {};
    try { meta = JSON.parse(asset.metaJson || "{}"); } catch { /* ignore */ }
    const productTitle = (meta.productTitle || asset.title || "").trim();
    if (!productTitle) return json({ error: "Couldn't tell which product this was — remake it from the Studio." });
    const avatarId = meta.avatarId || undefined;
    const direction = meta.direction || undefined;
    const nextVariant = avatarId ? (((meta.avatarVariant ?? 0) + 1) % 4) : 0; // rotate the take
    // Ads made before metaJson carried the photo would be un-remixable forever.
    // The catalogue has the same product under the same title, so recover from
    // there rather than stranding the whole back catalogue.
    const productImageUrl = asset.type !== "BLOG_POST"
      ? meta.productImageUrl || (await catalogImageFor(shop.id, productTitle)) || undefined
      : undefined;
    // Same story for the recipe: older assets never stored formatKey, but
    // bodyJson.method recorded what actually ran ("format:callout"). Recover it
    // so a remix of a Callout is another Callout, not a plain scene.
    if (!meta.formatKey && !meta.templateKey) {
      try {
        const body = JSON.parse(asset.bodyJson || "{}") as { method?: string };
        const m = (body.method || "").match(/^(format|template|template-staged|template-fallback):(.+)$/);
        if (m) {
          if (m[1] === "format") meta.formatKey = m[2];
          else meta.templateKey = m[2];
        }
      } catch { /* no recipe to recover */ }
    }
    const type = asset.type === "VIDEO_AD" ? "video" : asset.type === "IMAGE_AD" ? "image" : "blog";
    // No photo means the pipeline invents a product from its name. That's the
    // AI-slop path, and it costs the SAME as a real render — 150 tokens on a
    // video. Refuse BEFORE the spend. Anything made before we started saving
    // the photo lands here, which is a one-time cliff, not an ongoing one.
    if (asset.type !== "BLOG_POST" && !meta.serviceMode && !productImageUrl) {
      return json({
        error: `This ${type === "video" ? "video" : "ad"} was made before we started saving its product photo, so a remix would invent a product instead of using yours. Remake it from the Studio — pick the product and we'll keep the rest.`,
      });
    }
    const cost = type === "video" ? TOKEN_COST.video : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;
    // Tier gate BEFORE the spend: old assets stay viewable/postable forever,
    // but remixing (new generation) needs the capability on the current tier.
    {
      const cap = type === "video"
        ? videoCapabilityFor(meta.style === "CARTOON" ? "cartoon" : meta.style === "JINGLE" ? "jingle" : undefined)
        : type === "image" ? ("image" as const) : ("blog" as const);
      try { assertCapability(shop.activePlan, cap); }
      catch (e) { return json({ error: (e as Error).message }); }
    }
    try { await spendTokens(shop.id, cost); }
    catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for a remix." }); }
    if (type === "video") {
      const style = avatarId ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT";
      // Cartoon/jingle remixes stay cartoon/jingle — the content type (and the
      // picked animation style) rides along from the original's metaJson.
      const contentType = meta.style === "CARTOON" ? "cartoon" : meta.style === "JINGLE" ? "jingle" : undefined;
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", { productTitle, style, contentType, cartoonStyle: meta.cartoonStyle, customPrompt: direction, avatarId, avatarVariant: nextVariant, productImageUrl, productDescription: direction, holdProduct: !!avatarId && !contentType, wearProduct: false, prePaid: true, initiator: "remix" });
    } else if (type === "image") {
      // A remix is a VARIATION of this ad, so the recipe rides along — without
      // the format/template the "remix" quietly became a different ad entirely.
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        productTitle, productImageUrl, stylePrompt: direction,
        avatarId, avatarVariant: nextVariant, wear: !!meta.wear,
        formatKey: meta.formatKey || undefined,
        templateKey: meta.templateKey || undefined,
        serviceMode: !!meta.serviceMode,
        styleMode: meta.styleMode === "scene" || meta.styleMode === "backdrop" ? meta.styleMode : undefined,
        prePaid: true,
      });
    } else {
      await enqueueJob(shop.id, "GENERATE_BLOG_POST", { productTitle, productDescription: direction, prePaid: true });
    }
    return json({ remixed: type });
  }
  if (intent === "draft") {
    // Suggest one editable caption for the manual post box. A single caption
    // the merchant can tweak, not three per-platform boxes. Tuned to Instagram
    // when linked (richest tag style), else the first linked network.
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
    if (!asset) return json({ error: "That piece is gone — refresh and try again." });
    let title = asset.title || "New from our shop";
    try { const m = JSON.parse(asset.metaJson || "{}"); title = m.productTitle || title; } catch { /* ignore */ }
    const isVideo = asset.type === "VIDEO_AD";
    let platforms: string[] = [];
    try {
      if (socialProviderEnabled()) platforms = (await refreshLinkedPlatforms(shop.id)).filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
    } catch { /* ignore */ }
    if (platforms.length === 0) platforms = ["instagram"];
    const tune = platforms.includes("instagram") ? "instagram" : platforms[0];
    const captions = await getOrMakeCaptions(id, shop.id, { productTitle: title, isVideo, platforms });
    const fbText = fallbackCaption({ productTitle: title, isVideo, platforms }).text;
    // Deep-link the post at the actual product page when we mirrored their
    // catalogue — an ad nobody can act on is half an ad.
    const buyUrl = await productLinkFor(shop.id, title);
    return json({ draft: buildPostTitle(captions[tune], buyUrl, fbText) });
  }
  if (intent === "post") {
    if (!socialProviderEnabled()) return json({ error: "Social posting is coming online — check back shortly." });
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
    if (!asset) return json({ error: "That piece is gone — refresh and try again." });
    let media: string | undefined;
    let title = asset.title || "New from our shop";
    try { const b = JSON.parse(asset.bodyJson || "{}"); media = b.videoUrl || b.imageUrl; } catch { /* ignore */ }
    try { const m = JSON.parse(asset.metaJson || "{}"); title = m.productTitle || title; } catch { /* ignore */ }
    if (!media) return json({ error: "This piece has no media to post." });
    // Provision-on-demand instead of hard-failing on a missing profile key, and
    // a live platform refresh instead of trusting the stale socials cache.
    const profileKey = await ensureProfile(shop.id);
    if (!profileKey) return json({ error: "Couldn't reach the posting service — try again in a minute." });
    const platforms = (await refreshLinkedPlatforms(shop.id)).filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
    if (platforms.length === 0) return json({ error: "Link your socials first on the Auto-posting page." });
    const isVideo = asset.type === "VIDEO_AD";
    const base = new URL(request.url).origin;
    const mediaUrl = /^https?:\/\//.test(media) ? media : `${base}${media}`;

    // If the merchant edited a caption in the draft box, post THAT verbatim to
    // every platform (their words win, no tokens spent). Otherwise fall back to
    // the AI writer: a per-platform tuned caption, cached on the asset.
    const custom = ((form.get("caption") as string) || "").trim();
    const credit = trialCredit(shop.activePlan);
    let titleFor: (p: string) => string;
    if (custom) {
      // Merchant words win, but the AI-disclosure tag is mandatory on every
      // post — append it unless their caption already carries it.
      const capBase = custom.slice(0, 860);
      const withTag = new RegExp(`#${AI_DISCLOSURE_TAG}\\b`, "i").test(capBase) ? capBase : `${capBase}\n\n#${AI_DISCLOSURE_TAG}`;
      titleFor = () => (credit ? `${withTag}\n\n${credit}` : withTag);
    } else {
      const captions = await getOrMakeCaptions(id, shop.id, { productTitle: title, isVideo, platforms });
      const fbText = fallbackCaption({ productTitle: title, isVideo, platforms }).text;
      const buyUrl = await productLinkFor(shop.id, title);
      titleFor = (p) => buildPostTitle(captions[p], buyUrl, fbText, credit);
    }
    let anyOk = false;
    let lastErr: string | undefined;
    for (const p of platforms) {
      const r = await publishPost(profileKey, { title: titleFor(p), mediaUrl, isVideo, platforms: [p] });
      if (r.ok) anyOk = true;
      else lastErr = r.error;
    }
    if (!anyOk) return json({ error: `Posting failed (${lastErr || "unknown"}) — check your linked accounts.` });
    await db.asset.update({ where: { id }, data: { status: "PUBLISHED" } });
    return json({ posted: platforms.join(" · "), ok: `Posted to ${platforms.join(" · ")} 🎉` });
  }
  return json({});
};

/** Countdown text, or the truth when the estimate has run out.
 *
 *  These are queued renders behind a third-party API — they routinely run
 *  past a typical time, and a stuck "5s left" makes a working render look
 *  frozen. Below ~10s we stop giving a number at all, because a number that
 *  keeps not arriving is worse than no number. */
function fmtEta(etaSec: number, elapsedSec?: number): string {
  if (etaSec > 60) return `${Math.ceil(etaSec / 60)} min left`;
  if (etaSec > 10) return `${etaSec}s left`;
  if (etaSec > 0) return "almost there";
  const mins = Math.floor((elapsedSec ?? 0) / 60);
  return mins >= 1 ? `taking longer than usual · ${mins} min in` : "taking longer than usual";
}
// Sanitized download filename from the piece's title.
function dlName(title: string, isVideo: boolean): string {
  const base = (title || "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "easymode";
  return `${base}.${isVideo ? "mp4" : "jpg"}`;
}

type ATab = "video" | "image" | "blog";
const A_KIND: Record<string, ATab> = { VIDEO_AD: "video", IMAGE_AD: "image", BLOG_POST: "blog" };

// Route-local styles for everything the parity pass added (viewer, badges,
// chips, caption box, failed section). Matches the web front-door look:
// paper #F4F1E6 / card #FDFCF7 / ink #14201A / green #12A85E / gold #B08526.
const WA_CSS = `
.wa-wallet{font-size:13px;font-weight:800;color:#0C7A46;margin:0 0 12px;}
.wa-shelfnote{font-size:12.5px;color:var(--ink2,#5b6b61);margin:-4px 0 14px;}
.wa-poster{position:relative;display:block;width:100%;padding:0;border:0;background:#0b0f0d;cursor:pointer;font:inherit;color:inherit;}
.wa-poster video,.wa-poster img{width:100%;aspect-ratio:4/5;height:auto;object-fit:cover;display:block;pointer-events:none;}
.wa-play{position:absolute;inset:0;display:grid;place-items:center;font-size:32px;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.65);pointer-events:none;}
.wa-cd{position:absolute;top:8px;left:8px;background:rgba(20,32,26,.8);color:#E7C879;font-size:11.5px;font-weight:800;padding:4px 9px;border-radius:999px;letter-spacing:.02em;}
.wa-cd.urgent{background:#8C2E1B;color:#fff;}
.wa-recipe{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:.02em;
  background:#F3F1E4;color:#6B5312;border:1px solid rgba(176,133,38,.32);}
.wa-chip{display:inline-block;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:.03em;text-transform:uppercase;}
.wa-chip.new{background:#FBF4E2;color:#8a6207;border:1px solid #E7C879;}
.wa-chip.kept{background:#EAF6EF;color:#0C7A46;border:1px solid #BFE2CD;}
.wa-chip.posted{background:linear-gradient(165deg,#12A85E,#0B6B3E);color:#fff;border:1px solid transparent;}
.wa-tileacts{display:flex;gap:8px;align-items:center;margin-top:8px;}
.wa-jacts{display:flex;gap:8px;margin-top:8px;}
.wa-icon{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:10px;border:1px solid var(--line,#E5E0CF);background:#fff;color:var(--ink,#14201A);cursor:pointer;font-size:14px;text-decoration:none;padding:0;}
.wa-icon:hover{filter:brightness(.97)}
.wa-icon[disabled]{opacity:.5;cursor:not-allowed}
.wa-blogrows{display:grid;gap:12px;}
.wa-blogrow{display:flex;gap:10px;align-items:flex-start;background:var(--card,#FDFCF7);border:1px solid var(--line,#E5E0CF);border-radius:16px;padding:16px 18px;}
.wa-blogopen{flex:1;text-align:left;border:0;background:none;padding:0;cursor:pointer;font:inherit;color:inherit;}
.wa-blogopen b{font-family:Poppins,sans-serif;font-size:15px;}
.wa-blogopen p{margin:6px 0 8px;font-size:12.5px;color:var(--ink2,#5b6b61);line-height:1.5;}
.wa-failsec{margin-top:26px;}
.wa-faildiv{display:flex;align-items:center;gap:12px;margin:0 0 12px;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#8C2E1B;white-space:nowrap;}
.wa-faildiv::before,.wa-faildiv::after{content:"";height:1px;background:var(--line,#E5E0CF);flex:1;}
.wa-scrim{position:fixed;inset:0;z-index:10500;background:rgba(10,14,12,.68);display:grid;place-items:center;padding:16px;}
/* 100% (of the scrim's padded box), never a vw unit: a vw width ignores the
 * scrim's own padding, so the panel overhung the right edge and took the close
 * button and the next arrow off-screen with it. */
.wa-viewer{position:relative;background:var(--card,#FDFCF7);border-radius:18px;width:min(920px,100%);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 70px rgba(10,14,12,.45);}
.wa-vx{position:absolute;top:10px;right:10px;z-index:4;width:34px;height:34px;border-radius:50%;border:0;background:rgba(20,32,26,.75);color:#fff;font-size:15px;cursor:pointer;display:grid;place-items:center;}
.wa-vnav{position:absolute;top:42%;z-index:4;width:40px;height:40px;border-radius:50%;border:0;background:rgba(20,32,26,.72);color:#E7C879;font-size:24px;line-height:1;cursor:pointer;display:grid;place-items:center;padding-bottom:3px;}
.wa-vnav:hover{background:rgba(20,32,26,.9)}
.wa-vnav.prev{left:10px}
.wa-vnav.next{right:10px}
.wa-vcount{position:absolute;top:14px;left:14px;z-index:4;background:rgba(20,32,26,.75);color:#fff;font-size:11.5px;font-weight:800;padding:4px 10px;border-radius:999px;}
.wa-vfull{width:100%;max-height:56vh;object-fit:contain;background:#0b0f0d;display:block;}
.wa-read{padding:24px 28px;overflow:auto;max-height:52vh;font-size:14.5px;line-height:1.65;color:var(--ink,#14201A);}
.wa-read h1,.wa-read h2,.wa-read h3{font-family:Poppins,sans-serif;line-height:1.25;margin:1em 0 .4em;}
.wa-read h1:first-child,.wa-read h2:first-child{margin-top:0}
.wa-read img{max-width:100%;border-radius:12px;}
.wa-vmeta{padding:14px 18px 18px;border-top:1px solid var(--line,#E5E0CF);overflow:auto;}
.wa-vtitle{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.wa-vtitle b{font-family:Poppins,sans-serif;font-size:14.5px;}
.wa-vok{font-size:12.5px;font-weight:800;color:#0C7A46;}
.wa-verr{font-size:12.5px;font-weight:700;color:#8C2E1B;}
.wa-vcdnote{display:block;margin-top:6px;font-size:12px;color:#8a6207;font-weight:600;}
.wa-vmissed{display:block;margin-top:8px;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.45;
  background:#FDF4E3;border:1px solid #E8D3A6;color:#7A5A12;font-weight:600;}
.wa-vcdnote.urgent{color:#8C2E1B;}
.wa-aitag{display:inline-block;margin-top:6px;font-size:11.5px;color:var(--ink2,#5b6b61);}
.wa-vacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center;}
.wa-vbtn{border:0;cursor:pointer;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#fff;padding:10px 18px;border-radius:12px;background:linear-gradient(165deg,#12A85E,#0B6B3E);box-shadow:0 4px 12px rgba(12,122,70,.25);text-decoration:none;display:inline-block;}
.wa-vbtn:hover{filter:brightness(1.06)}
.wa-vbtn.gold{background:linear-gradient(165deg,#C98F12,#8a6207);box-shadow:0 4px 12px rgba(176,133,38,.3);}
.wa-vbtn.ghost{background:#fff;color:var(--ink,#14201A);border:1px solid var(--line,#E5E0CF);box-shadow:none;}
.wa-vbtn.danger{background:#fff;color:#8C2E1B;border:1px solid #E8C4BC;box-shadow:none;}
.wa-vbtn[disabled]{opacity:.5;cursor:not-allowed}
.wa-vbtn .c{display:block;font-size:10px;font-weight:700;opacity:.85;margin-top:1px;}
.wa-cap{margin-top:12px;background:#FBF9F0;border:1px solid var(--line,#E5E0CF);border-radius:14px;padding:12px;}
.wa-capbox{width:100%;box-sizing:border-box;border:1px solid var(--line,#E5E0CF);border-radius:12px;padding:10px 12px;font:inherit;font-size:13.5px;line-height:1.5;background:#fff;color:var(--ink,#14201A);resize:vertical;}
.wa-capbox:disabled{opacity:.6}
.wa-caprow{display:flex;gap:8px;margin-top:8px;}
.wa-caphint{display:block;font-size:11.5px;color:var(--ink2,#5b6b61);margin-top:6px;}
/* ---- Phone shelf: the same doom-scroll relief the Studio pickers got. ----
 * One full-width column of 4/5 tiles is a ~500px card apiece, so a dozen
 * finished pieces became a mile of scrolling. Two-up halves it and the crop
 * is unchanged (aspect is what decides that, not size). Everything inside the
 * card tightens to survive a ~170px column — the retry row wraps rather than
 * running off the edge. */
@media (max-width:640px){
  .wb-assets{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
  .wb-asset{border-radius:14px;}
  .wb-asset .m{padding:9px 10px;font-size:12px;line-height:1.35;}
  .wb-asset .s{font-size:10.5px;}
  .wa-tileacts{gap:6px;margin-top:7px;}
  .wa-icon{width:28px;height:28px;border-radius:9px;font-size:13px;}
  .wa-chip{font-size:9.5px;padding:3px 7px;}
  .wa-play{font-size:26px;}
  .wa-cd{top:6px;left:6px;font-size:10.5px;padding:3px 7px;}
  /* Inline styles on these buttons, so !important is the only lever. */
  .wa-jacts{flex-wrap:wrap;gap:6px;}
  .wa-jacts .wb-btn{padding:8px 12px !important;font-size:11.5px !important;}
  /* The buffer scales with the tile it now lives in. */
  .wb-bufwrap{gap:7px;}
  .wb-bufwrap::before{width:150px;height:150px;}
  .wb-spin{width:74px;height:74px;}
  .wb-eta{font-size:11.5px;}
  .wb-failbadge{font-size:24px;}
}
/* Phone viewer: the frame keeps its margin, the chrome pulls in with it, and
   the ad gets more of the height back now that the buttons stack tighter. */
@media (max-width:640px){
  .wa-scrim{padding:10px;}
  .wa-viewer{max-height:95vh;border-radius:14px;}
  .wa-read{padding:18px;max-height:56vh;}
  .wa-vfull{max-height:52vh;}
  .wa-vx{top:8px;right:8px;width:32px;height:32px;font-size:14px;}
  .wa-vcount{top:10px;left:10px;font-size:11px;padding:3px 9px;}
  .wa-vnav{width:36px;height:36px;font-size:21px;}
  .wa-vnav.prev{left:6px}
  .wa-vnav.next{right:6px}
  .wa-vmeta{padding:12px 14px 16px;}
  .wa-vtitle b{font-size:13.5px;}
  .wa-vacts{gap:7px;margin-top:10px;}
  .wa-vbtn{padding:10px 14px;font-size:12.5px;border-radius:11px;}
}
`;

export default function WebArchive() {
  const { assets, cooking, cookingCards, canPost, linkedCount, linked, tokens, hasPlan, cost } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  // ?tab= deep link → initial tab.
  const [searchParams] = useSearchParams();
  const startTab = (["video", "image", "blog"] as const).find((t) => t === searchParams.get("tab"));
  const [tab, setTab] = useState<ATab>(startTab || "video");
  const [viewer, setViewer] = useState<(typeof assets)[number] | null>(null);
  const [copied, setCopied] = useState(false);

  // Live tiles: while anything is cooking, refresh the data every 8s so the
  // ETAs count down and finished pieces swap in without a manual reload.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (cooking === 0) return;
    const t = setInterval(() => { if (revalidator.state === "idle") revalidator.revalidate(); }, 8000);
    return () => clearInterval(t);
  }, [cooking, revalidator]);

  const err = actionData && "error" in actionData ? (actionData as { error: string }).error : null;
  const ok = actionData && "ok" in actionData ? (actionData as { ok: string }).ok : null;
  const posted = actionData && "posted" in actionData ? (actionData as { posted: string }).posted : null;
  const remixed = actionData && "remixed" in actionData ? (actionData as { remixed: string }).remixed : null;
  const draftText = actionData && "draft" in actionData ? (actionData as { draft: string }).draft : null;

  const retryJob = (jobId: string) => submit({ intent: "retryJob", jobId }, { method: "post" });
  const dismissJob = (jobId: string) => submit({ intent: "dismissJob", jobId }, { method: "post" });
  const keepAsset = (assetId: string) => submit({ intent: "keep", assetId }, { method: "post" });
  const deleteAsset = (assetId: string) => submit({ intent: "delete", assetId }, { method: "post" });
  const remix = (assetId: string) => submit({ intent: "remix", assetId }, { method: "post" });

  // Editable caption preview: "Post to socials" opens one caption box pre-filled
  // with an AI suggestion (intent "draft") the merchant can tweak or post as-is.
  const [capOpen, setCapOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [draftPending, setDraftPending] = useState(false);
  const startPost = (assetId: string) => { setCaption(""); setCapOpen(true); setDraftPending(true); submit({ intent: "draft", assetId }, { method: "post" }); };
  const doPost = (assetId: string) => submit({ intent: "post", assetId, caption }, { method: "post" });
  useEffect(() => { if (draftText != null) { setCaption(draftText); setDraftPending(false); } }, [draftText]);
  useEffect(() => { setCapOpen(false); setCaption(""); setDraftPending(false); setCopied(false); }, [viewer?.id]);
  useEffect(() => { if (posted) setCapOpen(false); }, [posted]);
  // Close the viewer once a piece is deleted or kept, and when a remix starts
  // (so the fresh "cooking…" tile is visible under the auto-revalidator).
  useEffect(() => { if (actionData && ("deleted" in actionData || "kept" in actionData || "remixed" in actionData)) setViewer(null); }, [actionData]);

  const shelf = assets.filter((a) => A_KIND[a.type] === tab);
  const vIdx = viewer ? shelf.findIndex((c) => c.id === viewer.id) : -1;
  const openAt = (idx: number) => { const n = shelf[(idx % shelf.length + shelf.length) % shelf.length]; if (n) setViewer(n); };
  // Keyboard: Escape closes, arrows cycle the current tab's pieces.
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setViewer(null); return; }
      if (shelf.length < 2 || vIdx < 0) return;
      if (e.key === "ArrowLeft") openAt(vIdx - 1);
      else if (e.key === "ArrowRight") openAt(vIdx + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const chipFor = (a: { type: string; status: string }): [string, string] =>
    a.type === "BLOG_POST"
      ? a.status === "PUBLISHED" ? ["posted", "Published"] : a.status === "APPROVED" ? ["kept", "Kept"] : ["new", "Ready"]
      : a.status === "PUBLISHED" ? ["posted", "Posted"] : a.status === "APPROVED" ? ["kept", "Kept"] : ["new", "New"];
  const costOf = (t: string) => (t === "VIDEO_AD" ? cost.video : t === "IMAGE_AD" ? cost.image : cost.blog);
  const copyHtml = (html: string) => { navigator.clipboard.writeText(html).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { /* ignore */ }); };
  const downloadHtml = (title: string, html: string) => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "article").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "article"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const genCards = cookingCards.filter((j) => j.kind === tab && j.status === "generating");
  const failCards = cookingCards.filter((j) => j.kind === tab && j.status === "failed");

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: WA_CSS }} />
      <h1 className="wb-h1">Archive</h1>
      <p className="wb-sub">
        Everything you&apos;ve made — tap a piece to watch it big, keep it, download it{canPost ? `, or post it to your ${linkedCount} linked account${linkedCount > 1 ? "s" : ""}` : ""}.
        {cooking > 0 && <> · <b>{cooking} piece{cooking > 1 ? "s" : ""} cooking below</b> — this page updates itself.</>}
      </p>
      {!canPost && <p className="wb-note" style={{ marginTop: -14, marginBottom: 18 }}>Want one-tap posting? <Link to="/web/connect">Link your socials</Link>.</p>}
      <p className="wa-wallet">{hasPlan ? `Wallet: ${tokens.toLocaleString()} tokens` : "Pick a plan to generate."}</p>
      {err && !viewer && <div className="wb-err">{err}</div>}
      {ok && <div className="wb-ok">{ok}</div>}
      {remixed && <div className="wb-ok">✨ Remixing — a fresh {remixed === "blog" ? "article" : remixed} is on the way. It&apos;ll land on this shelf in a minute.</div>}
      <div className="ws-tabs" style={{ marginBottom: 16 }}>
        {([["video", "🎬 Videos"], ["image", "🖼 Images"], ["blog", "✍️ Articles"]] as [ATab, string][]).map(([k, label]) => {
          const n = assets.filter((a) => A_KIND[a.type] === k).length + cookingCards.filter((j) => j.kind === k).length;
          return (
            <button type="button" key={k} className={`ws-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>
              {label}{n > 0 ? ` · ${n}` : ""}
            </button>
          );
        })}
      </div>
      {(tab === "video" || tab === "image") && shelf.some((a) => a.daysLeft != null) && (
        <p className="wa-shelfnote">⏳ Un-kept videos &amp; photos clear after 30 days — open a piece and hit <b>Keep</b> to save it for good.</p>
      )}
      {shelf.length === 0 && genCards.length === 0 && failCards.length === 0 && (
        <div className="wb-card">No {tab === "blog" ? "articles" : `${tab}s`} yet — make one in the <Link to="/web/studio">Studio</Link>.</div>
      )}

      {/* Cooking tiles stay pinned at the top of the shelf. */}
      {genCards.length > 0 && (
        <div className="wb-assets" style={{ marginBottom: 16 }}>
          {genCards.map((j) => (
            <div className="wb-asset" key={j.jobId}>
              <div
                className="wb-cookimg"
                style={j.productImage ? { backgroundImage: `linear-gradient(rgba(10,14,12,.5),rgba(10,14,12,.55)), url(${j.productImage})` } : undefined}
              >
                <span className="wb-bufwrap"><span className="wb-spin" /><span className="wb-eta">{j.etaSec > 10 ? "~" : ""}{fmtEta(j.etaSec, j.elapsedSec)}</span></span>
              </div>
              <div className="m">
                {j.kind === "blog" ? `Writing${j.productTitle ? ` about ${j.productTitle}` : " your article"}…` : `Creating your ${j.kind}${j.productTitle ? ` — ${j.productTitle}` : ""}…`}
                <div className="s">Rendering · {j.etaSec > 10 ? "~" : ""}{fmtEta(j.etaSec, j.elapsedSec)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Finished pieces: poster-frame tiles (media) or read rows (blogs). */}
      {tab === "blog" ? (
        <div className="wa-blogrows">
          {shelf.map((a) => {
            const [cc, cl] = chipFor(a);
            return (
              <div className="wa-blogrow" key={a.id}>
                <button type="button" className="wa-blogopen" onClick={() => setViewer(a)}>
                  <b>{a.title}</b>
                  {a.snippet && <p>{a.snippet}…</p>}
                  <span className={`wa-chip ${cc}`}>{cl}</span>
                </button>
                <button type="button" className="wa-icon" title="Delete this article" disabled={busy} onClick={() => deleteAsset(a.id)}>🗑</button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="wb-assets">
          {shelf.map((a) => {
            const [cc, cl] = chipFor(a);
            return (
              <div className="wb-asset" key={a.id}>
                <button type="button" className="wa-poster" onClick={() => setViewer(a)} title="Open it big">
                  {a.isVideo && a.media && <video src={`${a.media}#t=0.1`} muted playsInline preload="metadata" />}
                  {!a.isVideo && a.media && <img src={a.media} alt={a.title} loading="lazy" />}
                  {!a.media && <div style={{ height: 220, display: "grid", placeItems: "center", fontSize: 34, color: "#E7C879" }}>{a.isVideo ? "🎬" : "🖼"}</div>}
                  {a.isVideo && a.media && <span className="wa-play" aria-hidden>▶</span>}
                  {a.daysLeft != null && <span className={`wa-cd${a.daysLeft <= 5 ? " urgent" : ""}`} title={`Auto-clears in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} — open it and hit Keep`}>⏳ {a.daysLeft}d</span>}
                </button>
                <div className="m">
                  {a.title}
                  <div className="s">{a.isVideo ? "Video" : "Image ad"} · {new Date(a.when).toLocaleDateString()}</div>
                  <div className="wa-tileacts">
                    <span className={`wa-chip ${cc}`}>{cl}</span>
                    {a.media && <a className="wa-icon" href={a.media} download={dlName(a.title, a.isVideo)} title="Download">⬇</a>}
                    <button type="button" className="wa-icon" title="Delete" disabled={busy} onClick={() => deleteAsset(a.id)}>🗑</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wipeouts live below the finished work, not mixed into it. */}
      {failCards.length > 0 && (
        <div className="wa-failsec">
          <div className="wa-faildiv"><span>Didn&apos;t come through — retry or clear it</span></div>
          <div className="wb-assets">
            {failCards.map((j) => (
              <div className="wb-asset" key={j.jobId}>
                <div
                  className="wb-cookimg"
                  style={j.productImage ? { backgroundImage: `linear-gradient(rgba(10,14,12,.5),rgba(10,14,12,.55)), url(${j.productImage})` } : undefined}
                >
                  <span className="wb-failbadge">✕</span>
                </div>
                <div className="m">
                  This {j.kind} didn&apos;t make it{j.refunded ? " — tokens refunded" : ""}.
                  <div className="s">Failed — retry it right here</div>
                  <div className="wa-jacts">
                    <button type="button" className="wb-btn" style={{ padding: "8px 16px", fontSize: 12.5 }} disabled={busy} onClick={() => retryJob(j.jobId)}>
                      {j.retryCost > 0 ? `Retry · ${j.retryCost} tokens` : "Retry free"}
                    </button>
                    <button type="button" className="wb-btn ghost" style={{ padding: "8px 14px", fontSize: 12.5 }} disabled={busy} onClick={() => dismissJob(j.jobId)}>Dismiss</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fullscreen viewer: media plays big / blogs read in a scroll pane. */}
      {viewer && (
        <div className="wa-scrim" onClick={() => setViewer(null)}>
          <div className="wa-viewer" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="wa-vx" aria-label="Close" onClick={() => setViewer(null)}>✕</button>
            {shelf.length > 1 && vIdx >= 0 && (
              <>
                <button type="button" className="wa-vnav prev" aria-label="Previous" onClick={() => openAt(vIdx - 1)}>‹</button>
                <button type="button" className="wa-vnav next" aria-label="Next" onClick={() => openAt(vIdx + 1)}>›</button>
                <span className="wa-vcount">{vIdx + 1} / {shelf.length}</span>
              </>
            )}
            {viewer.type === "BLOG_POST" ? (
              viewer.html
                ? <div className="wa-read" dangerouslySetInnerHTML={{ __html: viewer.html }} />
                : <div className="wa-read"><h2>{viewer.title}</h2><p>{viewer.snippet || "Still being written…"}</p></div>
            ) : viewer.isVideo && viewer.media ? (
              <video className="wa-vfull" src={viewer.media} controls autoPlay playsInline />
            ) : viewer.media ? (
              <img className="wa-vfull" src={viewer.media} alt={viewer.title} />
            ) : (
              <div className="wa-read"><p>Still being made…</p></div>
            )}
            <div className="wa-vmeta">
              <div className="wa-vtitle">
                <b>{viewer.title}</b>
                {viewer.recipe && <span className="wa-recipe" title="The recipe this ad was built with">🎛 {viewer.recipe}</span>}
                {posted ? <span className="wa-vok">Posted to {posted} ✓</span>
                  : err ? <span className="wa-verr">{err}</span>
                  : <span className={`wa-chip ${chipFor(viewer)[0]}`}>{chipFor(viewer)[1]}</span>}
              </div>
              {viewer.missed && (
                <span className="wa-vmissed">
                  ⚠ The <b>{viewer.missed}</b> layout didn&apos;t render cleanly, so this went out as a plain product ad instead. <b>Remix</b> re-rolls it.
                </span>
              )}
              {viewer.daysLeft != null && !posted && (
                <span className={`wa-vcdnote${viewer.daysLeft <= 5 ? " urgent" : ""}`}>⏳ Clears in {viewer.daysLeft} day{viewer.daysLeft === 1 ? "" : "s"} — <b>Keep</b> saves it for good.</span>
              )}
              {viewer.type !== "BLOG_POST" && <span className="wa-aitag">✦ AI-generated · review before posting</span>}
              {viewer.type === "BLOG_POST" ? (
                <div className="wa-vacts">
                  {viewer.html && <button type="button" className="wa-vbtn ghost" onClick={() => copyHtml(viewer.html!)}>{copied ? "Copied ✓" : "Copy HTML"}</button>}
                  {viewer.html && <button type="button" className="wa-vbtn ghost" onClick={() => downloadHtml(viewer.title, viewer.html!)}>⬇ Download</button>}
                  <button type="button" className="wa-vbtn gold" disabled={busy} title="Write a fresh article on the same product" onClick={() => remix(viewer.id)}>✨ Remix<span className="c">{costOf(viewer.type)} tokens</span></button>
                  <button type="button" className="wa-vbtn danger" disabled={busy} onClick={() => deleteAsset(viewer.id)}>Delete</button>
                </div>
              ) : (
                <>
                  <div className="wa-vacts">
                    {canPost && linked.length > 0 && !capOpen && viewer.media && (
                      <button type="button" className="wa-vbtn" disabled={busy} onClick={() => startPost(viewer.id)}>Post to socials</button>
                    )}
                    {viewer.status !== "APPROVED" && viewer.status !== "PUBLISHED" && (
                      <button type="button" className="wa-vbtn ghost" disabled={busy} onClick={() => keepAsset(viewer.id)}>Keep</button>
                    )}
                    {viewer.media && <a className="wa-vbtn ghost" href={viewer.media} download={dlName(viewer.title, viewer.isVideo)}>⬇ Download</a>}
                    <button type="button" className="wa-vbtn gold" disabled={busy} title="Make a fresh variation of this piece" onClick={() => remix(viewer.id)}>✨ Remix<span className="c">{costOf(viewer.type)} tokens</span></button>
                    <button type="button" className="wa-vbtn danger" disabled={busy} onClick={() => deleteAsset(viewer.id)}>Delete</button>
                  </div>
                  {capOpen && (
                    <div className="wa-cap">
                      <textarea
                        className="wa-capbox"
                        rows={5}
                        value={caption}
                        disabled={draftPending}
                        placeholder={draftPending ? "✨ Writing a caption for you…" : "Write your caption…"}
                        onChange={(e) => setCaption(e.target.value)}
                      />
                      <div className="wa-caprow">
                        <button type="button" className="wa-vbtn" disabled={busy || draftPending || !caption.trim()} onClick={() => doPost(viewer.id)}>{busy && !draftPending ? "Posting…" : "Post now"}</button>
                        <button type="button" className="wa-vbtn ghost" disabled={busy} onClick={() => setCapOpen(false)}>Cancel</button>
                      </div>
                      <span className="wa-caphint">Posts to {linked.join(" · ")}. Tweak it or post as-is — the #EasyModeAi disclosure rides along either way.</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
