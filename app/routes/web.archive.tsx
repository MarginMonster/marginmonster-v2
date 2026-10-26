/* Web Archive — finished pieces for web accounts. Media serves from the same
 * /renders route the embedded app uses. Full parity with the embedded Archive:
 * fullscreen viewer, Keep + 30-day expiry countdown, delete, remix, blog
 * read/export, caption preview before posting, downloads, wallet readout. */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useActionData, useLoaderData, useNavigation, useRevalidator, useSearchParams, useSubmit } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { readUiLang, tr } from "../lib/ui-i18n";
import { requireWebIdentity } from "../lib/web-auth.server";
import { isExpiringUrl } from "../lib/image-generation.server";
import { db } from "../db.server";
import { ensureProfile, linkedFromCache, publishPost, refreshLinkedPlatforms, socialProviderEnabled } from "../lib/social-provider.server";
import { spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { facelessQualitySurcharge } from "../lib/create-models";
import { engineSurcharge, normalizeEngineKey } from "../lib/video-engines";
import { xpForSpend } from "../lib/achievements";
import { AVATAR_BY_ID } from "../lib/avatars";

/** The CURRENT price to retry a failed job, derived from its payload — not the
 *  amount originally charged. A job that failed before a reprice (e.g. faceless
 *  at the old 80 tokens, now 30) must retry at today's price, never the stale
 *  one. Callers clamp with Math.min(stored, current) so a retry is never more
 *  than either the original charge or the current price. */
function currentRetryCost(type: string, pl: Record<string, unknown>): number {
  if (type === "GENERATE_VIDEO_AD") {
    if (pl.contentType === "faceless") return TOKEN_COST.faceless + facelessQualitySurcharge(pl.facelessQuality as string);
    const eng = engineSurcharge(normalizeEngineKey(pl.videoEngine as string));
    return (pl.section === "creator" ? TOKEN_COST.casualVideo : TOKEN_COST.video) + eng;
  }
  // A COMBINE frame is a GENERATE_IMAGE_AD but runs the pricey nano-banana-pro
  // compose (presenterOnly), so it reprices at the combine rate, not the cheap
  // shared image rate — a retry must not undercharge for it.
  if (type === "GENERATE_IMAGE_AD") return pl.presenterOnly === true ? TOKEN_COST.combine : TOKEN_COST.image;
  if (type === "GENERATE_SONG") return TOKEN_COST.music;
  if (type === "GENERATE_BLOG_POST") return TOKEN_COST.blog;
  return TOKEN_COST.image;
}
import { assertCapability, videoCapabilityFor, videoCapabilityForSection } from "../lib/capabilities.server";
import { enqueueJob } from "../lib/job-queue.server";
import { AI_DISCLOSURE_TAG, buildPostTitle, fallbackCaption, getOrMakeCaptions, trialCredit } from "../lib/social-caption.server";
import { catalogImageFor, productLinkFor } from "../lib/catalog-import.server";
import { externalOrigin } from "../lib/origin.server";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = ({ matches }: { matches: Array<{ id: string; data: unknown }> }) => {
  const uiLang = (matches.find((m) => m.id === "root")?.data as { uiLang?: string } | null)?.uiLang;
  return [{ title: tr((uiLang || "en") as Parameters<typeof tr>[0], "Archive") + " · EasyMode" }];
};

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

/** THE RECEIPT. What the merchant picked and what the AI wrote, pulled out of
 *  the two JSON blobs every asset carries, so the viewer's right rail can show
 *  "here's exactly how this was made" instead of a bare title. Every field is
 *  optional — older assets stored less, and the UI renders only what exists.
 *  `kind` / `scriptLabel` are English source strings the client runs through
 *  t(); every value field is user content and is shown verbatim. */
export type PieceDetails = {
  kind: string | null;         // "Avatar video", "Commercial", …
  product: string | null;      // the product it's about
  presenter: string | null;    // "Mara · hype energy" for avatar pieces
  held: boolean;               // the presenter is holding the product
  service: boolean;            // service / no-physical-product mode
  topic: string | null;        // faceless topic
  tagline: string | null;      // commercial tagline
  direction: string | null;    // the merchant's OWN words / brief
  script: string | null;       // what the AI actually wrote (spoken/narration)
  scriptLabel: string | null;  // how to title the script block
};
function buildDetails(type: string, metaJson: string | null, bodyJson: string | null): PieceDetails {
  let meta: Record<string, unknown> = {};
  let body: Record<string, unknown> = {};
  try { meta = JSON.parse(metaJson || "{}"); } catch { /* ignore */ }
  try { body = JSON.parse(bodyJson || "{}"); } catch { /* ignore */ }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const style = str(meta.style) || str(body.style);
  const isFaceless = meta.kind === "faceless" || style === "FACELESS";
  const hasPresenter = style === "AI_AVATAR" || style === "COMMERCIAL" || style === "CARTOON" || style === "JINGLE";
  const kind =
    type === "AUDIO" ? "Music track"
    : type === "BLOG_POST" ? "Article"
    : type === "IMAGE_AD" ? "Image ad"
    : isFaceless ? "Faceless video"
    : style === "AI_AVATAR" ? "Avatar video"
    : style === "COMMERCIAL" ? "Commercial"
    : style === "CARTOON" ? "Cartoon ad"
    : style === "JINGLE" ? "Jingle video"
    : type === "VIDEO_AD" ? "Video"
    : null;
  const av = str(meta.avatarId) ? AVATAR_BY_ID[str(meta.avatarId)!] : undefined;
  const presenter = av ? (av.vibe ? `${av.name} · ${av.vibe}` : av.name) : null;
  const topic = str(meta.topic);
  // body.script is the spoken/narrated line; body.prompt doubles as the script
  // on older cartoon/avatar rows and as the topic on faceless — don't echo the
  // topic back as if it were the script.
  let script = str(body.script) || str(body.prompt);
  if (script && script === topic) script = null;
  return {
    kind,
    product: str(meta.productTitle),
    presenter,
    held: body.heldProduct === true,
    service: meta.serviceMode === true,
    topic,
    tagline: str(body.tagline),
    direction: str(meta.direction),
    script,
    scriptLabel: script ? (isFaceless ? "Narration" : hasPresenter ? "What they say" : "Prompt") : null,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const lang = readUiLang(request);

  // SEPARATE ARCHIVES per section. Creator (casual) pieces carry
  // metaJson.section === "creator"; everything else — marketing content and all
  // legacy assets made before the split — is the Marketing archive. Filtered on
  // the stringified metaJson (no schema migration): JSON.stringify writes the
  // key with no spaces, so this substring is stable.
  const section = new URL(request.url).searchParams.get("section") === "creator" ? "creator" : "marketing";
  const CREATOR_TAG = '"section":"creator"';
  // metaJson is a non-nullable column (always at least "{}"), so a plain NOT is
  // safe — no null rows to drop. Marketing = everything NOT tagged creator
  // (which includes all legacy assets made before the section split).
  const sectionWhere = section === "creator"
    ? { metaJson: { contains: CREATOR_TAG } }
    : { NOT: { metaJson: { contains: CREATOR_TAG } } };

  // How many to render. This USED to be a hard `take: 60` with no pagination
  // and no total — which quietly hid everything older than the newest 60. That
  // was not merely cosmetic: un-kept media is permanently deleted at 30 days
  // (storage-cleanup.server.ts), and the only ways to save a piece — Keep and
  // Post — require opening it HERE. The hidden assets are by definition the
  // oldest, i.e. exactly the ones about to be destroyed, so a merchant past 60
  // pieces could not rescue the work they had paid for.
  const SHOW_STEP = 60;
  const SHOW_MAX = 600;
  const showParam = parseInt(new URL(request.url).searchParams.get("show") || "", 10);
  const show = Math.min(SHOW_MAX, Math.max(SHOW_STEP, Number.isFinite(showParam) ? showParam : SHOW_STEP));

  // True per-type totals, independent of what we render — the tab labels were
  // counting the truncated page and therefore under-reported the library.
  const totalsRaw = await db.asset.groupBy({
    by: ["type"],
    where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "AUDIO", "BLOG_POST"] }, ...sectionWhere },
    _count: { _all: true },
  });
  const totals = { video: 0, image: 0, music: 0, blog: 0 };
  for (const t of totalsRaw) {
    if (t.type === "VIDEO_AD") totals.video = t._count._all;
    else if (t.type === "IMAGE_AD") totals.image = t._count._all;
    else if (t.type === "AUDIO") totals.music = t._count._all;
    else if (t.type === "BLOG_POST") totals.blog = t._count._all;
  }
  const totalAll = totals.video + totals.image + totals.music + totals.blog;

  const assets = await db.asset.findMany({
    where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "AUDIO", "BLOG_POST"] }, ...sectionWhere },
    orderBy: { createdAt: "desc" },
    take: show,
  });
  const jobs = await db.job.findMany({
    where: { shopId: shop.id, status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] }, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_SONG", "GENERATE_BLOG_POST"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  // Cooking tiles, same logic as the embedded Archive: live ETA per job type,
  // product image as the tile art, failed jobs surfaced instead of vanishing.
  const nowMs = Date.now();
  const TYPICAL: Record<string, number> = { GENERATE_VIDEO_AD: 180, GENERATE_IMAGE_AD: 45, GENERATE_SONG: 60, GENERATE_BLOG_POST: 40 };
  const KIND: Record<string, "video" | "image" | "music" | "blog"> = { GENERATE_VIDEO_AD: "video", GENERATE_IMAGE_AD: "image", GENERATE_SONG: "music", GENERATE_BLOG_POST: "blog" };
  const cookingCards: { jobId: string; kind: "video" | "image" | "music" | "blog"; status: "generating" | "failed"; productImage: string | null; productTitle: string; etaSec: number; elapsedSec: number; refunded: boolean; retryCost: number }[] = [];
  for (const j of jobs) {
    let p: { productImageUrl?: string; productTitle?: string; refunded?: boolean; __startedAt?: string; section?: string } = {};
    try { p = JSON.parse(j.payload); } catch { /* ignore */ }
    // Cooking tiles belong to the section they were started in.
    const jobSection = p.section === "creator" ? "creator" : "marketing";
    if (jobSection !== section) continue;
    const due = !j.runAt || j.runAt.getTime() <= nowMs;
    const failed = j.status === "FAILED";
    const generating = j.status === "IN_PROGRESS" || (j.status === "PENDING" && due);
    if (!failed && !generating) continue; // future-scheduled drip isn't "cooking"
    // __startedAt is written once, when the job is claimed. Falling back to
    // updatedAt keeps jobs claimed before this existed reporting sensibly.
    const stamped = Date.parse(String((p as { __startedAt?: string }).__startedAt || ""));
    const startMs =
      j.status === "IN_PROGRESS"
        ? (Number.isFinite(stamped) ? stamped : j.updatedAt.getTime())
        : j.createdAt.getTime();
    // Math.max(5, …) pinned the countdown at "5s left" forever once the
    // estimate ran out — a merchant watched it say that for two minutes. An
    // estimate that has expired is not a five-second estimate; it is an
    // expired estimate, and the honest thing is to stop counting and say the
    // render is taking longer than usual.
    const elapsedSec = Math.round((nowMs - startMs) / 1000);
    const etaSec = generating ? Math.round(TYPICAL[j.type] - elapsedSec) : 0;
    const pl = p as { chargedTokens?: number };
    const curCost = currentRetryCost(j.type, p as Record<string, unknown>);
    const storedCost = typeof pl.chargedTokens === "number" && pl.chargedTokens > 0 ? pl.chargedTokens : curCost;
    const retryCost = failed && p.refunded ? Math.min(storedCost, curCost) : 0;
    cookingCards.push({ jobId: j.id, kind: KIND[j.type] || "image", status: failed ? "failed" : "generating", productImage: p.productImageUrl || null, productTitle: p.productTitle || "", etaSec, elapsedSec, refunded: !!p.refunded, retryCost });
  }
  const linked = linkedFromCache(shop.socialsJson).filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
  // Un-kept media (PENDING video/photo) auto-clears at 30 days — surface a
  // per-item countdown so nothing vanishes as a surprise. Blogs never expire.
  const CACHE_DAYS = 30;
  return json({
    section,
    canPost: socialProviderEnabled() && linked.length > 0,
    linkedCount: linked.length,
    linked,
    tokens: tokensRemainingLive(shop.activePlan),
    hasPlan: !!shop.activePlan,
    cost: TOKEN_COST,
    cooking: cookingCards.filter((c) => c.status === "generating").length,
    cookingCards,
    totals,
    // Whether anything is still hidden, and how to ask for more of it.
    shown: Math.min(show, totalAll),
    totalAll,
    nextShow: totalAll > show ? Math.min(SHOW_MAX, show + SHOW_STEP) : null,
    assets: assets.map((a) => {
      let body: { videoUrl?: string; imageUrl?: string; audioUrl?: string; title?: string; html?: string; needsRegen?: boolean } = {};
      try { body = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
      // MEDIA WE KNOW IS GONE.
      //
      // Provider render URLs die after about an hour. backfillDeadImages
      // re-forges what it can and stamps needsRegen:true on the rest — but
      // the only thing that ever read that flag was the query that skips
      // those rows, so the merchant was left with a permanently broken tile,
      // a download link to nothing, and a Post button that could only fail.
      // Say it plainly instead. The age check matters: a just-generated asset
      // can legitimately still be serving from the provider.
      const rawMedia = body.videoUrl || body.imageUrl || body.audioUrl || null;
      const pastProviderTtl = nowMs - a.createdAt.getTime() > 2 * 60 * 60 * 1000;
      // Audio lives on our own durable /renders disk (no provider TTL to expire).
      const expired = a.type !== "AUDIO" && (body.needsRegen === true || (pastProviderTtl && isExpiringUrl(rawMedia || undefined)));
      const text = typeof body.html === "string" ? stripHtml(body.html) : undefined;
      const unkeptMedia = a.status === "PENDING" && (a.type === "VIDEO_AD" || a.type === "IMAGE_AD");
      const daysLeft = unkeptMedia ? Math.max(0, CACHE_DAYS - Math.floor((nowMs - a.createdAt.getTime()) / 86_400_000)) : undefined;
      return {
        id: a.id,
        type: a.type,
        title: a.title || body.title || tr(lang, "Untitled"),
        media: expired ? null : rawMedia,
        expired,
        isVideo: a.type === "VIDEO_AD",
        isAudio: a.type === "AUDIO",
        snippet: text ? text.slice(0, 140) : undefined,
        html: a.type === "BLOG_POST" && typeof body.html === "string" ? body.html : undefined,
        // Which recipe built this? Merchants remix and compare, and "the one
        // that worked" is unfindable if the ad won't say what it was.
        recipe: recipeLabel(a.metaJson, a.bodyJson),
        missed: pickedButMissed(a.metaJson, a.bodyJson),
        // The "receipt" for the viewer's right rail — selections + the script.
        details: buildDetails(a.type, a.metaJson, a.bodyJson),
        when: a.createdAt.toISOString(),
        status: a.status,
        daysLeft,
        // Post tracking: clicks counted by the /go/a turnstile + where the
        // piece went live, for the Boost panel.
        clicks: (() => { try { return Number(JSON.parse(a.metaJson || "{}").clicks) || 0; } catch { return 0; } })(),
        postedUrls: (() => { try { const u = JSON.parse(a.metaJson || "{}").postedUrls; return u && typeof u === "object" ? (u as Record<string, string>) : undefined; } catch { return undefined; } })(),
        // WE LOST IT, SO WE REPLACE IT.
        //
        // When a render goes missing the only thing the merchant can do is
        // remix — and remix charges full price for a video (150 tokens) they
        // already paid for once. Charging a second time for our own storage
        // failure is not a thing this app should do. One free replacement per
        // dead piece; the stamp lives on the asset so it cannot be farmed.
        freeRemake: expired && !(() => { try { return JSON.parse(a.metaJson || "{}").freeReplacedAt; } catch { return false; } })(),
      };
    }),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const lang = readUiLang(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "retryJob") {
    // Same economics as the embedded app: interrupted failure = free retry;
    // refunded terminal failure = a fresh purchase (re-charge, restore prePaid).
    // FAILED or wedged IN_PROGRESS only — never a COMPLETED job (see below).
    const jobId = (form.get("jobId") as string) || "";
    // A retry is only ever legitimate for a job that FAILED terminally or is
    // WEDGED in progress. With no status filter this also matched a COMPLETED
    // job: payload.refunded is falsy on a successful run, so nothing was
    // re-charged, the job went back to PENDING with attempts cleared, and the
    // worker rendered the merchant another 150-token video for free — as many
    // times as they pressed it.
    const job = await db.job.findFirst({ where: { id: jobId, shopId: shop.id, status: { in: ["FAILED", "IN_PROGRESS"] }, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_SONG", "GENERATE_BLOG_POST"] } } });
    if (!job) return json({ error: tr(lang, "That job's gone — try generating again from the Studio.") });
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(job.payload); } catch { /* ignore */ }
    // Re-assert entitlement for EVERY generator type before re-charging — a
    // retry is a fresh paid generation, and a plan that has since lost the
    // capability (e.g. dropped the Creator add-on) must not re-run a song/edit
    // the tier no longer includes. (Two-currency rule: tokens never unlock a
    // generator the tier lacks.) The worker's own cases re-assert too.
    {
      const retryCap = job.type === "GENERATE_VIDEO_AD" ? videoCapabilityForSection((payload.section as string) || undefined, (payload.contentType as string) || undefined)
        : job.type === "GENERATE_IMAGE_AD" ? "image" as const
        : job.type === "GENERATE_SONG" ? "music" as const
        : "blog" as const;
      try { assertCapability(shop.activePlan, retryCap); }
      catch (e) { return json({ error: (e as Error).message }); }
    }
    let newPayload: string | undefined;
    // Hoisted so the losing side of the claim below can give back exactly
    // what this request charged.
    let spent = 0;
    let retryFromExtra = 0;
    if (payload.refunded) {
      // Retry at TODAY's price, clamped so it is never more than the original
      // charge (a pre-reprice faceless job stored 80; the current price is 30).
      const curCost = currentRetryCost(job.type, payload as Record<string, unknown>);
      const storedCost = typeof payload.chargedTokens === "number" && payload.chargedTokens > 0 ? (payload.chargedTokens as number) : curCost;
      const cost = Math.min(storedCost, curCost);
      spent = cost;
      // The RE-SPEND has its own split. The refund that preceded this put
      // tokens back into whichever bucket paid the first time, but the wallet
      // has moved on since — a period roll, a top-up, other spends — so the
      // second charge can easily come out of the other bucket. Carrying the
      // old chargedFromExtra forward would refund a purchased token as an
      // expiring one on the next failure, which is the bug this field exists
      // to prevent.
      try { retryFromExtra = (await spendTokens(shop.id, cost)).fromExtra; }
      catch (e) { return json({ error: e instanceof Error ? e.message : tr(lang, "Not enough tokens to retry.") }); }
      // START CLEAN. A re-run is a fresh render the merchant is paying for
      // again, so it must not inherit the previous run's stage checkpoints:
      // ckFalRequestId, ckTalkingUrl and friends would re-attach to — or
      // re-deliver — work from the earlier attempt, handing over an old video
      // for a new charge. Everything the pipelines checkpoint is prefixed ck.
      const fresh = Object.fromEntries(
        Object.entries(payload as Record<string, unknown>).filter(([k]) => !k.startsWith("ck"))
      );
      newPayload = JSON.stringify({ ...fresh, prePaid: true, refunded: false, chargedTokens: cost, chargedFromExtra: retryFromExtra });
    }
    // CLAIM THE RETRY, AND REFUND THE LOSER.
    //
    // This was a bare update. Two overlapping clicks — a double-tap, a
    // resubmitted form — both read payload.refunded as true, both charged, and
    // both wrote the row back to PENDING: one render, two charges, and the
    // second write also reset attempts on a job the first had already made
    // runnable. The status the row was READ with is the guard, exactly as in
    // the worker.
    const claimed = await db.job.updateMany({
      where: { id: job.id, status: job.status },
      data: { status: "PENDING", attempts: 0, lastError: null, runAt: new Date(), ...(newPayload ? { payload: newPayload } : {}) },
    });
    if (claimed.count !== 1) {
      // Someone else got there first. Give back what this request charged —
      // to the bucket it actually came out of — or the merchant pays twice
      // for the one retry that is now running.
      if (spent > 0) {
        const { refundTokens } = await import("../lib/tokens.server");
        await refundTokens(shop.id, spent, retryFromExtra).catch((e) => console.error("[retry] losing click refund failed:", e));
      }
      return json({ ok: tr(lang, "Already retrying — hang tight.") });
    }
    return json({ ok: tr(lang, "Retrying — back in the oven.") });
  }
  if (intent === "dismissJob") {
    const jobId = (form.get("jobId") as string) || "";
    await db.job.deleteMany({ where: { id: jobId, shopId: shop.id, status: "FAILED", type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_SONG", "GENERATE_BLOG_POST"] } } });
    return json({});
  }
  if (intent === "keep") {
    await db.asset.updateMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id }, data: { status: "APPROVED" } });
    return json({ kept: true });
  }
  if (intent === "unkeep") {
    // Toggle Keep back off — the heart is a switch, so a second tap un-saves the
    // piece (it rejoins the 30-day auto-clear). Scoped to APPROVED so a tap can
    // never un-publish a piece that was actually posted to socials.
    await db.asset.updateMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id, status: "APPROVED" }, data: { status: "PENDING" } });
    return json({ unkept: true });
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
    if (!shop.brandProfile) return json({ error: tr(lang, "Analyze your store first so remixes match your brand.") });
    if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan first — remixes run on tokens.") });
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "BLOG_POST"] } } });
    if (!asset) return json({ error: tr(lang, "That piece is gone — refresh and try again.") });
    let meta: { productTitle?: string; avatarId?: string; avatarVariant?: number; direction?: string; style?: string; cartoonStyle?: string; productImageUrl?: string; formatKey?: string; templateKey?: string; serviceMode?: boolean; styleMode?: string; wear?: boolean } = {};
    try { meta = JSON.parse(asset.metaJson || "{}"); } catch { /* ignore */ }
    const productTitle = (meta.productTitle || asset.title || "").trim();
    if (!productTitle) return json({ error: tr(lang, "Couldn't tell which product this was — remake it from the Studio.") });
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
        error: tr(lang, "This {kind} was made before we started saving its product photo, so a remix would invent a product instead of using yours. Remake it from the Studio — pick the product and we'll keep the rest.", { kind: type === "video" ? "video" : "ad" }),
      });
    }
    // Creator-section pieces (faceless / casual clips) remix on the cheap path:
    // the casual-video price + the "creatorvideo" cap, not the marketing video
    // price + "video" cap — otherwise a Creator remixing their own clip would be
    // over-charged and blocked behind Studio.
    const assetSection = (meta as { section?: string }).section === "creator" ? "creator" : "marketing";
    const cost = type === "video" ? (assetSection === "creator" ? TOKEN_COST.casualVideo : TOKEN_COST.video) : type === "image" ? TOKEN_COST.image : TOKEN_COST.blog;
    // Tier gate BEFORE the spend: old assets stay viewable/postable forever,
    // but remixing (new generation) needs the capability on the current tier.
    {
      const cap = type === "video"
        ? videoCapabilityForSection(assetSection, meta.style === "CARTOON" ? "cartoon" : meta.style === "JINGLE" ? "jingle" : undefined)
        : type === "image" ? ("image" as const) : ("blog" as const);
      try { assertCapability(shop.activePlan, cap); }
      catch (e) { return json({ error: (e as Error).message }); }
    }
    // Capture WHICH bucket paid. spendTokens draws from the expiring monthly
    // allowance first and the purchased top-up only after it runs out, and
    // the job carries that split so a terminal failure refunds to the same
    // place. Discarding it meant a failed remix paid for with bought,
    // never-expiring tokens came back as allowance — and expired at the next
    // period roll. The merchant paid cash for those.
    // IS THIS A REPLACEMENT FOR SOMETHING WE LOST?
    //
    // Same test the loader uses: needsRegen stamped by the healer, or a
    // provider URL that is past its ~1h life. If so the remake is free, once.
    // The stamp is claimed with a compare-and-swap BEFORE anything is spent
    // or enqueued, so two clicks in the same second cannot both take it — the
    // loser pays like any other remix.
    let free = false;
    if (asset.type !== "BLOG_POST") {
      let deadBody: { videoUrl?: string; imageUrl?: string; needsRegen?: boolean } = {};
      try { deadBody = JSON.parse(asset.bodyJson || "{}"); } catch { /* treat as alive */ }
      const rawMedia = deadBody.videoUrl || deadBody.imageUrl || null;
      const pastProviderTtl = Date.now() - asset.createdAt.getTime() > 2 * 60 * 60 * 1000;
      const mediaLost = deadBody.needsRegen === true || (pastProviderTtl && isExpiringUrl(rawMedia || undefined));
      if (mediaLost && !(meta as { freeReplacedAt?: string }).freeReplacedAt) {
        const claimed = await db.asset.updateMany({
          where: { id: asset.id, metaJson: asset.metaJson },
          data: { metaJson: JSON.stringify({ ...meta, freeReplacedAt: new Date().toISOString() }) },
        });
        free = claimed.count === 1;
      }
    }
    let remixFromExtra = 0;
    if (!free) {
      try { remixFromExtra = (await spendTokens(shop.id, cost)).fromExtra; }
      catch (e) { return json({ error: e instanceof Error ? e.message : tr(lang, "Not enough tokens for a remix.") }); }
    }
    // prePaid:false on a free job, NOT chargedTokens:0 — the refund path
    // falls back to REFUND_BY_TYPE when chargedTokens is not a positive
    // number, so a failed free remake would have minted 150 tokens out of a
    // spend that never happened.
    const paid = !free;
    if (type === "video") {
      const style = avatarId ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT";
      // Cartoon/jingle remixes stay cartoon/jingle — the content type (and the
      // picked animation style) rides along from the original's metaJson.
      // COMMERCIAL was missing from this map, so remixing a cinematic
      // commercial fell through to contentType undefined and produced a plain
      // product highlight — a different format entirely, for the same 150
      // tokens, with nothing on screen saying so. Every branch job-queue
      // dispatches on (cartoon / commercial / jingle) is now represented.
      const contentType = meta.style === "CARTOON" ? "cartoon"
        : meta.style === "COMMERCIAL" ? "commercial"
        : meta.style === "JINGLE" ? "jingle"
        : undefined;
      // SERVICE MODE HAS TO RIDE ALONG.
      //
      // The guard above lets a piece through with no product photo precisely
      // BECAUSE meta.serviceMode is true — and then this payload dropped the
      // flag, so the pipelines took the physical-product path: a script
      // written about an object, a presenter told to hold one, and a prompt
      // demanding the product "stay exactly as it appears in the source
      // photograph" when there is no photograph and no product. A coach or a
      // local service paid 150 tokens for the AI-slop path the guard above
      // exists to refuse. The image branch below already passes it.
      const serviceMode = !!meta.serviceMode;
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", { section: assetSection, productTitle, style, contentType, cartoonStyle: meta.cartoonStyle, customPrompt: direction, avatarId, avatarVariant: nextVariant, productImageUrl, productDescription: direction, serviceMode, holdProduct: !!avatarId && !contentType && !serviceMode, wearProduct: false, prePaid: paid, chargedTokens: paid ? cost : undefined, chargedFromExtra: remixFromExtra, initiator: "remix" });
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
        prePaid: paid, chargedTokens: paid ? cost : undefined, chargedFromExtra: remixFromExtra,
      });
    } else {
      await enqueueJob(shop.id, "GENERATE_BLOG_POST", { productTitle, productDescription: direction, prePaid: paid, chargedTokens: paid ? cost : undefined, chargedFromExtra: remixFromExtra });
    }
    return json({ remixed: type, free });
  }
  if (intent === "draft") {
    // Suggest one editable caption for the manual post box. A single caption
    // the merchant can tweak, not three per-platform boxes. Tuned to Instagram
    // when linked (richest tag style), else the first linked network.
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
    if (!asset) return json({ error: tr(lang, "That piece is gone — refresh and try again.") });
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
    if (!socialProviderEnabled()) return json({ error: tr(lang, "Social posting is coming online — check back shortly.") });
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
    if (!asset) return json({ error: tr(lang, "That piece is gone — refresh and try again.") });
    let media: string | undefined;
    let title = asset.title || "New from our shop";
    try { const b = JSON.parse(asset.bodyJson || "{}"); media = b.videoUrl || b.imageUrl; } catch { /* ignore */ }
    try { const m = JSON.parse(asset.metaJson || "{}"); title = m.productTitle || title; } catch { /* ignore */ }
    if (!media) return json({ error: tr(lang, "This piece has no media to post.") });
    // Provision-on-demand instead of hard-failing on a missing profile key, and
    // a live platform refresh instead of trusting the stale socials cache.
    const profileKey = await ensureProfile(shop.id);
    if (!profileKey) return json({ error: tr(lang, "Couldn't reach the posting service — try again in a minute.") });
    const platforms = (await refreshLinkedPlatforms(shop.id)).filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
    if (platforms.length === 0) return json({ error: tr(lang, "Link your socials first on the Auto-posting page.") });
    const isVideo = asset.type === "VIDEO_AD";
    // DO NOT ABSOLUTIZE HERE.
    //
    // Render terminates TLS at its edge and forwards over plain HTTP, and
    // remix-serve never sets Express’s "trust proxy", so req.protocol is
    // "http" and `new URL(request.url).origin` is http://easymodeapp.com on a
    // page the merchant loaded over HTTPS. The provider was handed an http://
    // video URL to fetch — and because it already began with "http",
    // publishPost’s own correct absolutization (SHOPIFY_APP_URL) was skipped.
    // So this button and the scheduled poster disagreed about the address of
    // the very same file, and only the scheduler had it right.
    //
    // Every pipeline stores videoUrl/imageUrl as "/renders/<file>", so pass
    // the stored value through and let publishPost resolve it exactly the way
    // it does for a campaign drop.
    const mediaUrl = media;
    // The go-link goes out IN THE CAPTION, publicly, so it must be https for
    // the same reason: request.url reads http:// behind the edge. Resolved the
    // way the scheduled poster resolves it, from the env, with the forwarded
    // origin as a fallback.
    const base =
      (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "") || externalOrigin(request);

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
      // The caption links through OUR turnstile, not the raw product page —
      // every click gets counted on this exact piece before forwarding with
      // UTM tags. This is where "which post made money" starts.
      const goUrl = `${base}/go/a/${id}`;
      titleFor = (p) => buildPostTitle(captions[p], goUrl, fbText, credit);
    }
    // NAME THE PLATFORMS THAT ACTUALLY TOOK IT.
    //
    // This used to track a single anyOk flag and then report success against
    // `platforms` — the list the merchant ASKED for, not the list that
    // worked. One live account out of two, and the toast still read "Posted
    // to tiktok · facebook". The merchant believes it went to Facebook, it
    // did not, and nothing ever corrects them. Same defect the questline
    // poster was already fixed for; the manual path kept it.
    let lastErr: string | undefined;
    const postedUrls: Record<string, string> = {};
    const landed: string[] = [];
    const missed: string[] = [];
    for (const p of platforms) {
      const r = await publishPost(profileKey, { title: titleFor(p), mediaUrl, isVideo, platforms: [p] });
      if (r.ok) {
        landed.push(p);
        if (r.urls) Object.assign(postedUrls, r.urls);
      } else {
        missed.push(p);
        lastErr = r.error;
      }
    }
    if (!landed.length) return json({ error: tr(lang, "Posting failed ({err}) — check your linked accounts.", { err: lastErr || "unknown" }) });
    // Remember WHERE it landed: the live post links power the Boost panel
    // and stay on the card long after this response is gone.
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(asset.metaJson || "{}"); } catch { /* fresh */ }
    // postedTo is the load-bearing one: it is what stops a second attempt from
    // posting again where it already landed. Re-read and merge rather than
    // writing back a blob captured before the network round-trip — the public
    // click counter writes this same field, so the stale copy loses real state.
    // Union, never replace: two attempts that each reached different accounts
    // must both be remembered.
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
    // If this piece is a drop in a running campaign, close its slot too.
    // REVIEW_FIRST is the default and the poster never touches those, so this
    // is the ONLY thing that can advance such a campaign.
    try {
      const { recordManualPost } = await import("../lib/questlines.server");
      await recordManualPost(shop.id, id, landed, postedUrls);
    } catch (e) {
      console.error("[archive] manual post slot update failed (non-fatal):", e);
    }
    // Shipped It — first piece that actually reached a social account.
    if (landed.length) { try { const { unlockAchievement } = await import("../lib/xp.server"); await unlockAchievement(shop.id, "SHIPPED_IT"); } catch { /* non-fatal */ } }
    return json({
      // WHICH piece this is about. Without it the badge below is a claim
      // about whatever the merchant happens to be looking at.
      postedAssetId: id,
      posted: landed.join(" · "),
      ok: missed.length
        ? tr(lang, "Posted to {landed}. {missed} didn't go through ({err}) — check that account and try again.", { landed: landed.join(" · "), missed: missed.join(" · "), err: lastErr || "unknown" })
        : tr(lang, "Posted to {landed}", { landed: landed.join(" · ") }),
      postedUrls,
    });
  }
  return json({});
};

/** Countdown text, or the truth when the estimate has run out.
 *
 *  These are queued renders behind a third-party API — they routinely run
 *  past a typical time, and a stuck "5s left" makes a working render look
 *  frozen. Below ~10s we stop giving a number at all, because a number that
 *  keeps not arriving is worse than no number. */
function fmtEta(etaSec: number, elapsedSec: number | undefined, t: (s: string, p?: Record<string, string | number>) => string): string {
  if (etaSec > 60) return t("{n} min left", { n: Math.ceil(etaSec / 60) });
  if (etaSec > 10) return t("{n}s left", { n: etaSec });
  if (etaSec > 0) return t("almost there");
  const mins = Math.floor((elapsedSec ?? 0) / 60);
  return mins >= 1 ? t("taking longer than usual · {mins} min in", { mins }) : t("taking longer than usual");
}
// Sanitized download filename from the piece's title.
function dlName(title: string, isVideo: boolean, isAudio = false): string {
  const base = (title || "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "easymode";
  return `${base}.${isAudio ? "mp3" : isVideo ? "mp4" : "jpg"}`;
}

type ATab = "video" | "image" | "music" | "blog";
const A_KIND: Record<string, ATab> = { VIDEO_AD: "video", IMAGE_AD: "image", AUDIO: "music", BLOG_POST: "blog" };

// Route-local styles for everything the parity pass added (viewer, badges,
// chips, caption box, failed section). Matches the web front-door look:
// paper #F4F1E6 / card #FDFCF7 / ink #14201A / green #0C7A46 / gold #B08526.
// ONE accent green: the wallet + Kept chips resolve to the canonical brand
// green (#0C7A46 = --green). The section pills keep a #12A85E→#0C7A46 gradient
// on purpose — a lit pill reads as a toggle, not a status chip, so the two are
// deliberately different weights of the same green.
const WA_CSS = `
.wa-wallet{font-size:13px;font-weight:800;color:var(--green,#0C7A46);margin:0 0 12px;}
.wa-shelfnote{font-size:12.5px;color:var(--ink2,#5b6b61);margin:-4px 0 14px;}
.wa-poster{position:relative;display:block;width:100%;padding:0;border:0;background:#0b0f0d;cursor:pointer;font:inherit;color:inherit;}
.wa-poster video,.wa-poster img{width:100%;aspect-ratio:4/5;height:auto;object-fit:cover;display:block;pointer-events:none;}
.wa-play{position:absolute;inset:0;display:grid;place-items:center;font-size:32px;color:#fff;text-shadow:0 2px 14px rgba(0,0,0,.65);pointer-events:none;}
/* Audio has no still — a soft green-on-cream panel with a music glyph stands
   in on the tile; the real <audio> player lives in the viewer. */
.wa-audiotile{position:relative;width:100%;aspect-ratio:4/5;display:grid;place-items:center;background:linear-gradient(150deg,#0C7A46,#14201A);}
.wa-audiotile .wa-audio-ico{color:var(--paper);opacity:.9;}
.wa-audiotile .wa-play{font-size:26px;opacity:.85;}
.wa-audiofull{width:100%;background:linear-gradient(150deg,#0C7A46,#14201A);display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px 20px;}
.wa-audiofull .wa-audio-ico{color:var(--paper);opacity:.92;}
.wa-audiofull audio{width:min(420px,88%);}
.wa-cd{position:absolute;top:8px;left:8px;background:rgba(20,32,26,.8);color:#E7C879;font-size:11.5px;font-weight:800;padding:4px 9px;border-radius:999px;letter-spacing:.02em;}
.wa-cd.urgent{background:#8C2E1B;color:#fff;}
.wa-track{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px;padding:10px 12px;border:1px solid var(--line,#e4e1d5);border-radius:10px;background:rgba(255,255,255,.55);}
.wa-clicks{font-size:12px;font-weight:800;color:#0A3D26;background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:5px 11px;}
.wa-boost{font-size:12px;font-weight:800;text-decoration:none;color:#5b3c00;background:#FFF3D6;border:1px solid #EAD79E;border-radius:999px;padding:5px 11px;}
.wa-boost:hover{background:#FFE9B3;}
.wa-boosthint{flex-basis:100%;font-size:11.5px;color:var(--ink2,#4a4f4b);opacity:.85;line-height:1.5;}
.wa-recipe{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:.02em;
  background:#F3F1E4;color:#6B5312;border:1px solid rgba(176,133,38,.32);}
.wa-chip{display:inline-block;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:999px;letter-spacing:.03em;text-transform:uppercase;}
.wa-chip.new{background:#FBF4E2;color:#8a6207;border:1px solid #E7C879;}
.wa-chip.kept{background:#EAF6EF;color:var(--green,#0C7A46);border:1px solid #BFE2CD;}
.wa-chip.posted{background:linear-gradient(165deg,#12A85E,#0B6B3E);color:#fff;border:1px solid transparent;}
.wa-tileacts{display:flex;gap:8px;align-items:center;margin-top:8px;}
.wa-jacts{display:flex;gap:8px;margin-top:8px;}
.wa-icon{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:10px;border:1px solid var(--line,#E5E0CF);background:#fff;color:var(--ink,#14201A);cursor:pointer;font-size:14px;text-decoration:none;padding:0;}
/* armed delete — first tap turns the trash red; a second tap within 4s deletes. */
.wa-icon.armed{border-color:#C0392B;background:#FBEAE7;color:#8C2E1B;box-shadow:0 0 0 2px rgba(192,57,43,.28);animation:waArm .18s ease}
@keyframes waArm{from{transform:scale(.88)}to{transform:scale(1)}}
.wa-icon:hover{filter:brightness(.97)}
.wa-icon[disabled]{opacity:.5;cursor:not-allowed}
.wa-blogrows{display:grid;gap:12px;}
.wa-blogrow{display:flex;gap:10px;align-items:flex-start;background:var(--card,#FDFCF7);border:1px solid var(--line,#E5E0CF);border-radius:16px;padding:16px 18px;}
.wa-blogopen{flex:1;text-align:left;border:0;background:none;padding:0;cursor:pointer;font:inherit;color:inherit;}
.wa-blogopen b{font-family:Poppins,sans-serif;font-size:15px;}
.wa-blogopen p{margin:6px 0 8px;font-size:12.5px;color:var(--ink2,#5b6b61);line-height:1.5;}
/* "Read" — a visible affordance so an Articles row looks like the rest of the
   app (the other tabs have a play/▶ and a thumbnail; a blog row is just text).
   It opens the same viewer the row click does. */
.wa-read-btn{align-self:center;flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;font-family:Poppins,sans-serif;font-weight:800;font-size:12.5px;color:var(--green,#0C7A46);background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:7px 14px;cursor:pointer;text-decoration:none;}
.wa-read-btn:hover{background:#DCF0E5;}
.wa-failsec{margin-top:26px;}
.wa-faildiv{display:flex;align-items:center;gap:12px;margin:0 0 12px;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#8C2E1B;white-space:nowrap;}
.wa-faildiv::before,.wa-faildiv::after{content:"";height:1px;background:var(--line,#E5E0CF);flex:1;}
.wa-scrim{position:fixed;inset:0;z-index:10500;background:rgba(10,14,12,.68);display:grid;place-items:center;padding:16px;}
/* 100% (of the scrim's padded box), never a vw unit: a vw width ignores the
 * scrim's own padding, so the panel overhung the right edge and took the close
 * button and the next arrow off-screen with it. */
.wa-viewer{position:relative;background:var(--card,#FDFCF7);border-radius:18px;width:min(920px,100%);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 70px rgba(10,14,12,.45);}
/* The clip sits in a dark STAGE that hugs it — a portrait video gets no cream
   letterbox bands — and the cycle arrows + count + Keep heart all live inside
   the stage, so they flank the actual clip, never the screen edges. The stage
   is only the dark cinematic frame for real media (video/image); blog + audio
   render in a plain transparent stage so their own layout is untouched. */
.wa-vstage{position:relative;min-width:0;min-height:0;}
.wa-vstage.media{display:flex;align-items:center;justify-content:center;background:#0b0f0d;}
/* MOBILE / default: stacked. The clip fills a phone-width card, info below. */
.wa-viewer.vmedia{width:min(440px,94vw);}
.wa-viewer.vmedia .wa-vfull{width:auto;height:auto;max-width:100%;max-height:74vh;object-fit:contain;}
@media (min-width:760px){
  /* DESKTOP: clip LEFT, info RIGHT — a landscape card. The clip (max 80vh)
     drives the card height; the rail stretches to match and its text is
     clamped to fit, so nothing scrolls and the clip has no bands. */
  .wa-viewer.vmedia{flex-direction:row;width:auto;max-width:min(900px,95vw);max-height:84vh;align-items:stretch;}
  .wa-viewer.vmedia .wa-vstage{flex:0 0 auto;align-self:stretch;max-width:58vh;}
  .wa-viewer.vmedia .wa-vfull{width:auto;height:auto;max-width:58vh;max-height:80vh;}
  .wa-viewer.vmedia .wa-vmeta{flex:1 1 340px;min-width:306px;max-width:360px;border-top:none;border-left:1px solid var(--line,#E5E0CF);align-self:stretch;}
  .wa-viewer.vmedia .wa-vheart{right:12px;}
}
.wa-vx{position:absolute;top:10px;right:10px;z-index:6;width:34px;height:34px;border-radius:50%;border:0;background:rgba(20,32,26,.78);color:#fff;font-size:15px;cursor:pointer;display:grid;place-items:center;}
.wa-vx:hover{background:rgba(20,32,26,.94)}
/* Keep = a heart over the clip's top-right. Fills gold once the piece is kept. */
.wa-vheart{position:absolute;top:10px;right:52px;z-index:6;width:38px;height:38px;border-radius:50%;border:0;background:rgba(20,32,26,.6);color:#fff;cursor:pointer;display:grid;place-items:center;transition:transform .14s ease,background .14s ease,color .14s ease;}
.wa-vheart:hover{background:rgba(20,32,26,.9);transform:scale(1.08)}
.wa-vheart.on{color:#FFC24A;background:rgba(20,32,26,.72);}
.wa-vheart[disabled]{cursor:default}
.wa-vheart[disabled]:not(.on){opacity:.55;cursor:not-allowed}
.wa-vnav{position:absolute;top:50%;transform:translateY(-50%);z-index:5;width:40px;height:40px;border-radius:50%;border:0;background:rgba(20,32,26,.6);color:#fff;font-size:24px;line-height:1;cursor:pointer;display:grid;place-items:center;padding-bottom:3px;}
.wa-vnav:hover{background:rgba(20,32,26,.9)}
.wa-vnav.prev{left:10px}
.wa-vnav.next{right:10px}
.wa-vcount{position:absolute;top:12px;left:12px;z-index:5;background:rgba(20,32,26,.72);color:#fff;font-size:11.5px;font-weight:800;padding:4px 10px;border-radius:999px;}
.wa-vfull{display:block;margin:0 auto;width:auto;height:auto;max-width:100%;max-height:74vh;object-fit:contain;background:#0b0f0d;}
.wa-read{padding:24px 28px;overflow:auto;max-height:52vh;font-size:14.5px;line-height:1.65;color:var(--ink,#14201A);}
.wa-read h1,.wa-read h2,.wa-read h3{font-family:Poppins,sans-serif;line-height:1.25;margin:1em 0 .4em;}
.wa-read h1:first-child,.wa-read h2:first-child{margin-top:0}
.wa-read img{max-width:100%;border-radius:12px;}
/* Rail content is clamped to fit the clip's height, so it shouldn't need to
   scroll — but keep it scrollable as a safety (never clip the action buttons)
   while HIDING the scrollbar, so the panel always reads as a clean, scroll-free
   card the way the merchant expects. */
.wa-vmeta{padding:14px 16px 16px;border-top:1px solid var(--line,#E5E0CF);overflow:auto;scrollbar-width:none;-ms-overflow-style:none;}
.wa-vmeta::-webkit-scrollbar{display:none;}
.wa-vtitle{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.wa-vtitle b{font-family:Poppins,sans-serif;font-size:14.5px;}
.wa-vok{font-size:12.5px;font-weight:800;color:var(--green,#0C7A46);}
.wa-verr{font-size:12.5px;font-weight:700;color:#8C2E1B;}
.wa-vcdnote{display:block;margin-top:6px;font-size:12px;color:#8a6207;font-weight:600;}
.wa-vmissed{display:block;margin-top:8px;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.45;
  background:#FDF4E3;border:1px solid #E8D3A6;color:#7A5A12;font-weight:600;}
.wa-vcdnote.urgent{color:#8C2E1B;}
.wa-aitag{display:inline-block;margin-top:6px;font-size:11.5px;color:var(--ink2,#5b6b61);}
/* "The receipt" — what was picked + what the AI wrote, filling the viewer's
   right rail. Key/value grid uses display:contents rows so dt/dd align in one
   two-column grid; the prompt/script blocks read like a transcript (green
   accent, scrollable when long). */
.wa-spec{margin-top:10px;background:#FBF9F0;border:1px solid var(--line,#E5E0CF);border-radius:14px;padding:11px 13px;}
.wa-spec-kind{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#0A3D26;background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:3px 10px;margin-bottom:10px;}
.wa-spec-list{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0;}
.wa-spec-row{display:contents;}
.wa-spec-list dt{font-size:11.5px;font-weight:700;color:var(--ink2,#5b6b61);white-space:nowrap;}
.wa-spec-list dd{margin:0;font-size:12.5px;font-weight:600;color:var(--ink,#14201A);word-break:break-word;}
.wa-spec-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
.wa-spec-tag{font-size:11px;font-weight:700;color:#5b3c00;background:#FFF3D6;border:1px solid #EAD79E;border-radius:999px;padding:3px 9px;}
.wa-prompt{margin-top:10px;}
.wa-prompt-h{display:block;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2,#5b6b61);margin-bottom:5px;}
.wa-prompt p{margin:0;font-size:13px;line-height:1.5;color:var(--ink,#14201A);padding:9px 11px;background:#fff;border:1px solid var(--line,#E5E0CF);border-left:3px solid var(--green,#12A85E);border-radius:0 10px 10px 0;white-space:pre-wrap;}
/* Clamp so the rail fits the clip height with no scroll; fade the last line so
   a cut script reads as intentional, not broken. The full text is still in the
   piece — this is a preview panel, not the editor. */
.wa-prompt p.wa-prompt-dir,.wa-prompt p.wa-prompt-script{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;}
.wa-prompt-dir{-webkit-line-clamp:3;}
.wa-prompt-script{-webkit-line-clamp:6;}
/* The action row: two-up, every button the SAME height. The primary (Post) and
   the destructive Delete span the full width; the rest share equal half-width
   cells, and the last button in an odd row grows to fill — so there's never a
   lone half-button or a stray floating icon. */
.wa-vacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}
.wa-vacts > .wa-vbtn{flex:1 1 calc(50% - 4px);min-width:0;}
.wa-vacts > .wa-vbtn.full{flex-basis:100%;}
/* Two-layer premium gradient baked into the base rule: the viewer is portaled to
   document.body (outside .wb-main), so the .wb-main-scoped two-layer in web.tsx no
   longer reaches these CTAs. This block renders after web.tsx, so at equal 0,1,0
   it wins for the portaled buttons; in-shell .wa-vbtn still gets the identical
   two-layer via .wb-main (0,2,0) — no divergence either way. */
.wa-vbtn{border:0;cursor:pointer;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#fff;padding:8px 14px;min-height:46px;border-radius:12px;background:linear-gradient(100deg,#12A85E 58%,#0B7443 86%,#095F36),linear-gradient(165deg,#12A85E,#0B6B3E);box-shadow:0 4px 12px rgba(12,122,70,.25);text-decoration:none;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:2px 6px;box-sizing:border-box;text-align:center;line-height:1.2;}
.wa-vbtn:hover{filter:brightness(1.06)}
.wa-vbtn.gold{background:linear-gradient(165deg,#C98F12,#8a6207);box-shadow:0 4px 12px rgba(176,133,38,.3);}
.wa-vbtn.ghost{background:#fff;color:var(--ink,#14201A);border:1px solid var(--line,#E5E0CF);box-shadow:none;}
.wa-vbtn.danger{background:#fff;color:#8C2E1B;border:1px solid #E8C4BC;box-shadow:none;}
.wa-vbtn.danger.armed{background:#8C2E1B;color:#fff;border-color:#8C2E1B;}
.wa-vbtn[disabled]{opacity:.5;cursor:not-allowed}
/* The token/XP sub-line drops onto its own centered line under the label
   (flex-basis:100% forces the wrap), so Remix stays the same height as the rest. */
.wa-vbtn .c{flex-basis:100%;display:block;font-size:10px;font-weight:700;opacity:.85;}
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
  /* The clip is HEIGHT-capped so a tall portrait video can never spill past the
     viewport top (it was: the base ".vmedia .wa-vfull{74vh}" out-specifies a
     bare ".wa-vfull", so the phone never got the shorter cap and the 74vh clip
     overflowed its flex-shrunk stage). Match that specificity so this wins, and
     let the details scroll BELOW the clip instead of squeezing it. */
  .wa-viewer.vmedia .wa-vstage{flex:0 0 auto;min-height:0;max-height:62vh;}
  .wa-viewer.vmedia .wa-vfull{max-height:62vh;}
  .wa-viewer.vmedia .wa-vmeta{flex:1 1 auto;min-height:0;}
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

/* ===================================================================
   CASUAL (Creator) Gallery — premium treatment, scoped to .wa-creator
   so the Marketing Archive is untouched. Styling only. =============== */
.wa-creator .wb-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:34px;line-height:1.08;letter-spacing:-.025em;text-align:center;margin:8px 0 10px;}
.wa-creator .wb-sub{text-align:center;max-width:560px;margin:0 auto 8px;font-size:14.5px;color:var(--ink2,#4A554E);}
.wa-creator .wa-wallet{text-align:center;}
.wa-creator .ws-tabs{justify-content:center;gap:8px;}
.wa-creator .ws-tab{border-radius:999px;border:1px solid var(--line,#E1DECD);background:#fff;box-shadow:0 1px 2px rgba(20,32,26,.05);font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--ink2,#4A554E);padding:9px 17px;transition:transform .12s,box-shadow .12s,color .12s;}
.wa-creator .ws-tab:hover{transform:translateY(-1px);box-shadow:0 10px 22px -12px rgba(20,32,26,.3);color:var(--ink,#14201A);}
.wa-creator .ws-tab.on{background:linear-gradient(135deg,#12A85E,#0C7A46);color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(12,122,70,.3);}
/* Tiles — rounder, softer, premium hover lift. */
.wa-creator .wa-poster{border-radius:16px;overflow:hidden;}
.wa-creator .wa-audiotile{border-radius:16px;}
.wa-creator .wb-asset{transition:transform .14s ease,box-shadow .14s ease;}
.wa-creator .wb-asset:hover{transform:translateY(-3px);}
@media(max-width:620px){.wa-creator .wb-h1{font-size:27px;}}
/* Section toggle (Creator | Social) — a small segmented pill under the heading. */
.wa-sections{display:inline-flex;gap:3px;padding:3px;margin:0 0 14px;background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;}
.wa-creator .wa-sections{display:flex;width:max-content;margin-left:auto;margin-right:auto;}
.wa-sectab{font-family:Poppins,sans-serif;font-size:12.5px;font-weight:700;color:var(--green,#0C7A46);text-decoration:none;padding:6px 15px;border-radius:999px;line-height:1;display:inline-flex;align-items:center;min-height:30px;transition:background .12s,color .12s;}
.wa-sectab:hover{background:#DCF0E5;}
.wa-sectab.on{background:linear-gradient(135deg,#12A85E,#0C7A46);color:#fff;box-shadow:0 2px 8px rgba(12,122,70,.28);}
@media(max-width:640px){.wa-sectab{min-height:40px;padding:8px 16px;}}
/* Quick-filter chips — a light outlined pill row that sifts the current tab
   ("All / Clearing soon / Kept"). Lit chip reuses the same green as the tabs so
   the whole header reads as one control surface. */
.wa-filters{display:flex;flex-wrap:wrap;gap:8px;margin:-4px 0 14px;}
.wa-filterchip{display:inline-flex;align-items:center;gap:5px;font-family:Poppins,sans-serif;font-weight:700;font-size:12.5px;color:var(--ink2,#4A554E);background:#fff;border:1px solid var(--line,#E1DECD);border-radius:999px;padding:6px 13px;cursor:pointer;line-height:1;transition:background .12s,color .12s,border-color .12s;}
.wa-filterchip:hover{color:var(--ink,#14201A);border-color:#CFD6C5;}
.wa-filterchip.on{background:#EAF6EF;color:var(--green,#0C7A46);border-color:#BFE2CD;}
/* An inline text button that reads as a link — for the "Show all" reset on an
   empty filtered view, so it matches the Link styling the notes use. */
.wa-linkbtn{border:0;background:none;padding:0;font:inherit;color:var(--green,#0C7A46);text-decoration:underline;cursor:pointer;}
@media(max-width:640px){.wa-filterchip{min-height:44px;box-sizing:border-box;}}
/* ── 44px tap-target floor (mobile touch). Appended so source order wins over
   the shrunk mobile icon rules above; glyph sizes unchanged, only hit boxes. ── */
@media(max-width:640px){
  .wa-boost{min-height:44px;box-sizing:border-box;display:inline-flex;align-items:center}
  .wa-icon{width:44px;height:44px;border-radius:9px;font-size:13px}
  .wa-jacts .wb-btn{min-height:44px !important;box-sizing:border-box !important}
  .wa-vx{width:44px;height:44px;font-size:14px}
  .wa-vbtn{min-height:44px;box-sizing:border-box}
  .wa-vnav{width:44px;height:44px;font-size:21px}
}
@media(max-width:620px){
  .wa-creator .ws-tab{min-height:44px;box-sizing:border-box}
}
/* Empty tab — a real empty state, not a bare sentence with an inline link.
   An icon, one line of encouragement, and a prominent deep-linked button into
   the Studio, so a fresh account has an obvious first move. */
.wa-empty{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;background:linear-gradient(178deg,#FEFDF9,#F7F6EB);border:1px solid var(--line2,#D7DCCB);border-radius:18px;padding:40px 24px;}
.wa-empty-ic{display:grid;place-items:center;width:58px;height:58px;border-radius:50%;background:#EAF6EF;border:1px solid #BFE2CD;color:var(--green,#0C7A46);}
.wa-empty-ln{margin:0;font-size:14.5px;color:var(--ink2,#4A554E);max-width:360px;line-height:1.5;}
.wa-empty .wa-empty-cta{margin-top:4px;}
/* Delete / retry toast — a small confirmation that drops in at the bottom,
   fades, and (for delete) offers an Undo while the piece is still recoverable.
   Mirrors the wb-ok palette so it reads as the same system. */
.wa-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:10700;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);background:#14201A;color:#fff;font-size:13.5px;font-weight:600;padding:12px 16px;border-radius:14px;box-shadow:0 14px 40px rgba(10,14,12,.4);animation:waToastIn .18s ease;}
@keyframes waToastIn{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}
.wa-toast .wa-toast-ic{color:#8FE3B4;display:inline-grid;place-items:center;}
.wa-toast-undo{border:0;background:none;color:#FFC24A;font:inherit;font-weight:800;cursor:pointer;padding:4px 6px;text-decoration:underline;flex:0 0 auto;}
@media(max-width:640px){.wa-toast{left:16px;right:16px;transform:none;bottom:16px;}.wa-toast-undo{min-height:44px}@keyframes waToastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}}
`;

export default function WebArchive() {
  const t = useT();
  const { section, assets, cooking, cookingCards, canPost, linkedCount, linked, tokens, hasPlan, cost, totals, nextShow } = useLoaderData<typeof loader>();
  const isCreator = section === "creator";
  // Preserve the section across tab links, "show more", and revalidation so the
  // Gallery stays the Gallery.
  const sectionQ = isCreator ? "section=creator" : "";
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  // ?tab= deep link → initial tab.
  const [searchParams] = useSearchParams();
  const startTab = (["video", "image", "music", "blog"] as const).find((t) => t === searchParams.get("tab"));
  const [tab, setTab] = useState<ATab>(startTab || "video");
  // Quick-filter within a tab. Up to 600 pieces land here, and the two things a
  // merchant actually hunts for are "what's about to be deleted" (un-kept media
  // on the 30-day clock — oldest = nearest purge) and "what I already saved".
  // "all" is the default; the chips only render when there's something to sift.
  type AFilter = "all" | "clearing" | "kept";
  const [filter, setFilter] = useState<AFilter>("all");
  const [viewer, setViewer] = useState<(typeof assets)[number] | null>(null);
  const [copied, setCopied] = useState(false);
  // The fullscreen viewer portals to document.body (to escape the .wb-main
  // stacking context that otherwise traps its z-index below the shell nav).
  // Portal only after mount so SSR never touches `document`; the viewer only
  // opens on a client click, so `mounted` is always true by the time it shows.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
  // actionData survives for the whole page, and the viewer is not closed on a
  // successful post — only on delete/keep/remix. So after posting one piece,
  // opening ANY other piece showed "Posted to … ✓" on it and suppressed its
  // real status chip: the Archive told the merchant something had gone out
  // when it had not, and hid what actually had. Tie the badge to the id the
  // action reported.
  const postedAssetId = actionData && "postedAssetId" in actionData ? (actionData as { postedAssetId: string }).postedAssetId : null;
  const remixed = actionData && "remixed" in actionData ? (actionData as { remixed: string }).remixed : null;
  const remixFree = !!(actionData && "free" in actionData && (actionData as { free?: boolean }).free);
  const draftText = actionData && "draft" in actionData ? (actionData as { draft: string }).draft : null;

  // WHICH piece a viewer action was fired against. actionData.error is global
  // and sticks around for the whole page, so without this an error from acting
  // on piece A kept showing — and suppressed the real status chip — on piece B
  // when the merchant cycled to it. Scope the inline error to this id, exactly
  // the way postedAssetId scopes the "Posted ✓" badge. Reset on viewer change.
  const [actedId, setActedId] = useState<string | null>(null);

  const retryJob = (jobId: string) => submit({ intent: "retryJob", jobId }, { method: "post" });
  const dismissJob = (jobId: string) => submit({ intent: "dismissJob", jobId }, { method: "post" });
  const keepAsset = (assetId: string) => { setActedId(assetId); submit({ intent: "keep", assetId }, { method: "post" }); };
  const unkeepAsset = (assetId: string) => { setActedId(assetId); submit({ intent: "unkeep", assetId }, { method: "post" }); };
  const deleteAsset = (assetId: string) => submit({ intent: "delete", assetId }, { method: "post" });
  const remix = (assetId: string) => { setActedId(assetId); submit({ intent: "remix", assetId }, { method: "post" }); };
  // Delete is permanent and the trash icons are small and easy to mis-tap, so
  // guard it behind a confirm: the first tap arms the button, a second tap
  // within 4s actually deletes. Arming auto-clears so a stray tap is harmless.
  const [armedDel, setArmedDel] = useState<string | null>(null);
  useEffect(() => {
    if (!armedDel) return;
    const timer = setTimeout(() => setArmedDel(null), 4000);
    return () => clearTimeout(timer);
  }, [armedDel]);
  // A small confirmation that fades, with an Undo for delete while the piece is
  // still recoverable. `undo` runs on the Undo tap; `pending` is the timer that
  // fires the real server delete once the window closes un-undone.
  const [toast, setToast] = useState<{ msg: string; undo?: () => void; pending?: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    if (!toast) return;
    // Undo-able toasts linger until their delete actually commits (6s); plain
    // confirmations clear on their own after 3s.
    const timer = setTimeout(() => setToast(null), toast.undo ? 6200 : 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  // DELETE WITH UNDO. The grid/viewer trash is permanent, so the second ("armed")
  // tap does NOT hit the server right away — it closes the piece, shows an Undo
  // toast, and only submits the delete after a short window. Undo cancels the
  // pending submit, so nothing is ever lost to a mis-tap. All client-side: the
  // action still hard-deletes, we just hold the trigger for a beat.
  const askDelete = (assetId: string) => {
    if (armedDel !== assetId) { setArmedDel(assetId); return; }
    setArmedDel(null);
    setViewer(null); // close the piece being deleted (old flow closed it too)
    const pending = setTimeout(() => { setToast(null); deleteAsset(assetId); }, 5000);
    setToast({
      msg: t("Deleted."),
      pending,
      undo: () => { clearTimeout(pending); setToast({ msg: t("Restored.") }); },
    });
  };
  // Retry a failed job and confirm it with the same toast system (no undo —
  // nothing destructive to reverse, just a "back in the oven" acknowledgement).
  const retryWithToast = (jobId: string) => { retryJob(jobId); setToast({ msg: t("Retrying — back in the oven.") }); };

  // Editable caption preview: "Post to socials" opens one caption box pre-filled
  // with an AI suggestion (intent "draft") the merchant can tweak or post as-is.
  const [capOpen, setCapOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [draftPending, setDraftPending] = useState(false);
  const startPost = (assetId: string) => { setActedId(assetId); setCaption(""); setCapOpen(true); setDraftPending(true); submit({ intent: "draft", assetId }, { method: "post" }); };
  const doPost = (assetId: string) => { setActedId(assetId); submit({ intent: "post", assetId, caption }, { method: "post" }); };
  useEffect(() => { if (draftText != null) { setCaption(draftText); setDraftPending(false); } }, [draftText]);
  // Reset per-piece UI when the viewer opens or cycles to another piece. armedDel
  // MUST reset here too: without it, arming a grid tile's trash and then opening
  // that piece left the viewer's full-width Delete already armed — a single tap
  // destroyed it with no confirm. Clearing it means the viewer's Delete always
  // starts disarmed (tap once to arm, again to delete), like a fresh open.
  useEffect(() => { setCapOpen(false); setCaption(""); setDraftPending(false); setCopied(false); setArmedDel(null); setActedId(null); }, [viewer?.id]);
  useEffect(() => { if (posted) setCapOpen(false); }, [posted]);
  // Close the viewer once a piece is deleted, or when a remix starts (so the
  // fresh "cooking…" tile is visible under the auto-revalidator). KEEP does NOT
  // close it — the merchant tapped the heart to save the piece they're looking
  // at, so backing them out is jarring. Instead flip the open viewer to kept in
  // place (heart fills gold, chip reads Kept, the clears-in countdown drops);
  // the grid tile behind updates on the revalidation the submit already fires.
  useEffect(() => {
    if (actionData && ("deleted" in actionData || "remixed" in actionData)) setViewer(null);
    else if (actionData && "kept" in actionData) setViewer((v) => (v ? { ...v, status: "APPROVED" } : v));
    else if (actionData && "unkept" in actionData) setViewer((v) => (v ? { ...v, status: "PENDING" } : v));
  }, [actionData]);

  const shelf = assets.filter((a) => A_KIND[a.type] === tab);
  // The true library count for the open tab, so the note under the shelf
  // matches the number on the tab itself.
  const tabTotal = totals?.[tab] ?? shelf.length;
  // Quick-filter counts come off the full tab shelf (not the filtered view), so
  // a chip can say how many it holds. "Clearing soon" = un-kept media on the
  // 30-day clock (daysLeft is only set for video/image); "Kept" = saved or
  // already posted. The chip row only shows on video/image, where clearing is a
  // real concept and the volume lives.
  const isKept = (a: { status: string }) => a.status === "APPROVED" || a.status === "PUBLISHED";
  const clearingCount = shelf.filter((a) => a.daysLeft != null).length;
  const keptCount = shelf.filter((a) => isKept(a)).length;
  const canFilter = (tab === "video" || tab === "image") && (clearingCount > 0 || keptCount > 0);
  // What actually renders + what the viewer arrows cycle through. Pagination and
  // the empty state stay on the unfiltered `shelf` — they describe the library,
  // not the chip. Oldest-first would bury the nearest-purge pieces, so the
  // default desc order already puts "clearing soon" where the merchant expects.
  const visibleShelf = !canFilter || filter === "all"
    ? shelf
    : filter === "clearing"
      ? shelf.filter((a) => a.daysLeft != null)
      : shelf.filter((a) => isKept(a));
  const vIdx = viewer ? visibleShelf.findIndex((c) => c.id === viewer.id) : -1;
  const openAt = (idx: number) => { const n = visibleShelf[(idx % visibleShelf.length + visibleShelf.length) % visibleShelf.length]; if (n) setViewer(n); };
  // Keyboard: Escape closes, arrows cycle the current tab's pieces.
  // The handler reads the shelf + index off a ref so the listener can bind ONCE
  // per open piece instead of re-binding every render — visibleShelf is a fresh
  // array each render (shelf itself is assets.filter(...)), so depending on it
  // defeated the point. The ref is refreshed each render (free) and the effect
  // only re-runs when the open piece changes identity.
  const navRef = useRef({ shelf: visibleShelf, vIdx });
  navRef.current = { shelf: visibleShelf, vIdx };
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setViewer(null); return; }
      const { shelf: s, vIdx: i } = navRef.current;
      if (s.length < 2 || i < 0) return;
      const goTo = (idx: number) => { const n = s[(idx % s.length + s.length) % s.length]; if (n) setViewer(n); };
      if (e.key === "ArrowLeft") goTo(i - 1);
      else if (e.key === "ArrowRight") goTo(i + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer?.id]);

  const chipFor = (a: { type: string; status: string }): [string, string] =>
    a.type === "BLOG_POST"
      ? a.status === "PUBLISHED" ? ["posted", t("Published")] : a.status === "APPROVED" ? ["kept", t("Kept")] : ["new", t("Ready")]
      : a.status === "PUBLISHED" ? ["posted", t("Posted")] : a.status === "APPROVED" ? ["kept", t("Kept")] : ["new", t("New")];
  const costOf = (t: string) => (t === "VIDEO_AD" ? cost.video : t === "IMAGE_AD" ? cost.image : t === "AUDIO" ? cost.music : cost.blog);
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
    <div className={isCreator ? "wa-creator" : undefined}>
      <style dangerouslySetInnerHTML={{ __html: WA_CSS }} />
      <h1 className="wb-h1">{isCreator ? t("Creator Archive") : t("Social Marketing Archive")}</h1>
      {/* Section toggle — the two stores stay SEPARATE (by design) but read as
          parallel places you can hop between, instead of a Gallery/Archive name
          mismatch. Pure ?section= links; no mode coupling. */}
      <div className="wa-sections" role="tablist" aria-label={t("Which section")}>
        <Link to="/web/archive?section=creator" role="tab" aria-selected={isCreator} className={`wa-sectab${isCreator ? " on" : ""}`} preventScrollReset>{t("Creator")}</Link>
        <Link to="/web/archive" role="tab" aria-selected={!isCreator} className={`wa-sectab${!isCreator ? " on" : ""}`} preventScrollReset>{t("Social Marketing")}</Link>
      </div>
      <p className="wb-sub">
        {isCreator ? t("Everything you've made in Creator") : t("Everything you've made")} — {t("tap a piece to watch it big, keep it, download it")}{canPost ? (isCreator ? (linkedCount > 1 ? t(", or share it to your {n} linked accounts", { n: linkedCount }) : t(", or share it to your {n} linked account", { n: linkedCount })) : (linkedCount > 1 ? t(", or post it to your {n} linked accounts", { n: linkedCount }) : t(", or post it to your {n} linked account", { n: linkedCount }))) : ""}.
        {cooking > 0 && <> · <b>{cooking > 1 ? t("{n} pieces cooking below", { n: cooking }) : t("{n} piece cooking below", { n: cooking })}</b> — {t("this page updates itself.")}</>}
      </p>
      {!canPost && <p className="wb-note" style={{ marginTop: -14, marginBottom: 18 }}>{t("Want one-tap posting?")} <Link to="/web/connect">{t("Link your socials")}</Link>.</p>}
      <p className="wa-wallet">{hasPlan ? t("Wallet: {n} tokens", { n: tokens.toLocaleString("en-US") }) : t("Pick a plan to generate.")}</p>
      {err && !viewer && <div className="wb-err">{err}</div>}
      {ok && <div className="wb-ok">{ok}</div>}
      {remixed && (
        <div className="wb-ok">
          <Ico n="sparkle" /> {remixFree ? t("Making it again, on us") : t("Remixing")} — {t("a fresh {kind} is on the way. It'll land on this shelf in a minute.", { kind: remixed === "blog" ? t("article") : remixed })}{remixFree ? t(" No tokens spent.") : ""}
        </div>
      )}
      <div className="ws-tabs" style={{ marginBottom: 16 }}>
        {([["video", "video", t("Videos")], ["image", "image", t("Images")], ["music", "music", t("Music")], ["blog", "article", t("Articles")]] as [ATab, string, string][]).map(([k, icon, label]) => {
          // Count the whole library, not the slice we happened to render —
          // this used to read off `assets`, so a truncated page under-reported
          // how much the merchant actually owned.
          const n = (totals?.[k] ?? assets.filter((a) => A_KIND[a.type] === k).length)
            + cookingCards.filter((j) => j.kind === k).length;
          return (
            <button type="button" key={k} className={`ws-tab${tab === k ? " on" : ""}`} onClick={() => { setTab(k); setFilter("all"); }}>
              <Ico n={icon} /> {label} · {n}
            </button>
          );
        })}
      </div>
      {/* Quick-filters within a tab, so a library of hundreds isn't a single
          doom-scroll. "Clearing soon" surfaces exactly the un-kept media on the
          30-day clock (what a merchant comes here to rescue); "Kept" is the
          saved shelf. Only shows when there's actually something to sift. */}
      {canFilter && (
        <div className="wa-filters" role="group" aria-label={t("Filter pieces")}>
          <button type="button" className={`wa-filterchip${filter === "all" ? " on" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("All")} · {shelf.length}</button>
          {clearingCount > 0 && (
            <button type="button" className={`wa-filterchip${filter === "clearing" ? " on" : ""}`} aria-pressed={filter === "clearing"} onClick={() => setFilter("clearing")}><Ico n="hourglass" /> {t("Clearing soon")} · {clearingCount}</button>
          )}
          {keptCount > 0 && (
            <button type="button" className={`wa-filterchip${filter === "kept" ? " on" : ""}`} aria-pressed={filter === "kept"} onClick={() => setFilter("kept")}><Ico n="heart" /> {t("Kept")} · {keptCount}</button>
          )}
        </div>
      )}
      {(tab === "video" || tab === "image") && shelf.some((a) => a.daysLeft != null) && (
        <p className="wa-shelfnote"><Ico n="hourglass" /> {t("Un-kept videos & photos clear after 30 days — open a piece and hit")} <b>{t("Keep")}</b> {t("to save it for good.")}</p>
      )}
      {/* Only when there is genuinely more of THIS type to load. The library
          can be past the page size while the open tab is already complete —
          the Videos tab read “Showing 9 of 9 videos. Show older pieces→”. */}
      {nextShow != null && shelf.length < tabTotal && (
        // The oldest pieces are the ones nearest the 30-day clear, so "older"
        // must stay reachable — Keep is only available from the viewer here.
        //
        // Counted for THIS tab, not the whole library. The page loads the
        // newest N across every type and the tabs then filter that slice in
        // the browser, so the tab label ("Images · 77") and the shelf under it
        // disagreed with no explanation, and the note said "60 of 87" on a tab
        // showing neither number.
        <p className="wa-shelfnote">
          {shelf.length === 0
            // None of THIS type are in the recent window (older ones got crowded
            // out by newer pieces of other types) — don't pretend there are none.
            ? <>{t("Your")} <b>{tabTotal}</b> {tab === "blog" ? t("articles") : tab === "music" ? t("tracks") : t(tab + "s")} {t("are further back.")}{" "}</>
            : <>{t("Showing")} <b>{shelf.length}</b> {t("of")} <b>{tabTotal}</b>{" "}{tab === "blog" ? t("articles") : tab === "music" ? t("tracks") : t(tab + "s")}.{" "}</>}
          <Link to={`?show=${nextShow}${isCreator ? "&section=creator" : ""}`} preventScrollReset>{t("Show older pieces")} →</Link>
        </p>
      )}
      {/* "Yet — make one" only when there are GENUINELY none of this type —
          tabTotal === 0 — not merely none in the current page (which is the
          "are further back" note above). */}
      {shelf.length === 0 && tabTotal === 0 && genCards.length === 0 && failCards.length === 0 && (
        // A real empty state: an icon, one line of encouragement, and a bold
        // deep-link into the Studio — not a bare inline text link.
        <div className="wa-empty">
          <span className="wa-empty-ic"><Ico n={tab === "blog" ? "article" : tab === "music" ? "music" : tab === "image" ? "image" : "video"} size={26} /></span>
          <p className="wa-empty-ln">
            {tab === "video" ? t("No videos yet — your first one lands right here.")
              : tab === "image" ? t("No image ads yet — your first one lands right here.")
              : tab === "music" ? t("No music yet — your first track lands right here.")
              : t("No articles yet — your first one lands right here.")}
          </p>
          {/* Marketing is the default mode, so a plain Link lands right. For
              Creator, set emMode the way the cross-section bridge above does (a
              full load so the shell re-reads it) and the Studio opens in casual. */}
          {isCreator ? (
            <button type="button" className="wb-btn wa-empty-cta"
              onClick={() => { try { localStorage.setItem("emMode", "casual"); } catch { /* */ } window.location.href = "/web/studio"; }}>
              <Ico n="sparkle" /> {t("Open the Studio")} →
            </button>
          ) : (
            <Link to="/web/studio" className="wb-btn wa-empty-cta"><Ico n="sparkle" /> {t("Open the Studio")} →</Link>
          )}
        </div>
      )}
      {/* A filter that hid everything on the page — say so plainly with a one-tap
          way back, rather than leaving an empty grid that reads as broken. */}
      {canFilter && filter !== "all" && visibleShelf.length === 0 && shelf.length > 0 && (
        <p className="wa-shelfnote">
          {filter === "clearing" ? t("Nothing's clearing soon — everything here is kept or still fresh.") : t("Nothing kept in this tab yet.")}{" "}
          <button type="button" className="wa-linkbtn" onClick={() => setFilter("all")}>{t("Show all")}</button>
        </p>
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
                <span className="wb-bufwrap"><span className="wb-spin" /><span className="wb-eta">{j.etaSec > 10 ? "~" : ""}{fmtEta(j.etaSec, j.elapsedSec, t)}</span></span>
              </div>
              <div className="m">
                {j.kind === "blog"
                  ? (j.productTitle ? t("Writing about {title}…", { title: j.productTitle }) : t("Writing your article…"))
                  : (j.productTitle ? t("Creating your {kind} — {title}…", { kind: j.kind, title: j.productTitle }) : t("Creating your {kind}…", { kind: j.kind }))}
                <div className="s">{t("Rendering")} · {j.etaSec > 10 ? "~" : ""}{fmtEta(j.etaSec, j.elapsedSec, t)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Finished pieces: poster-frame tiles (media) or read rows (blogs). */}
      {tab === "blog" ? (
        <div className="wa-blogrows">
          {visibleShelf.map((a) => {
            const [cc, cl] = chipFor(a);
            return (
              <div className="wa-blogrow" key={a.id}>
                <button type="button" className="wa-blogopen" onClick={() => setViewer(a)}>
                  <b>{a.title}</b>
                  {a.snippet && <p>{a.snippet}…</p>}
                  <span className={`wa-chip ${cc}`}>{cl}</span>
                </button>
                {/* A visible Read affordance, so an Articles row reads like the
                    rest of the app instead of a wall of text. Opens the same
                    viewer the row does. */}
                <button type="button" className="wa-read-btn" onClick={() => setViewer(a)}><Ico n="book" /> {t("Read")}</button>
                <button type="button" className={`wa-icon${armedDel === a.id ? " armed" : ""}`} title={armedDel === a.id ? t("Tap again to delete — can't be undone") : t("Delete this article")} disabled={busy} onClick={() => askDelete(a.id)}><Ico n="trash" /></button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="wb-assets">
          {visibleShelf.map((a) => {
            const [cc, cl] = chipFor(a);
            return (
              <div className="wb-asset" key={a.id}>
                <button type="button" className="wa-poster" onClick={() => setViewer(a)} title={a.isAudio ? t("Open & play") : t("Open it big")}>
                  {a.isVideo && a.media && <video src={`${a.media}#t=0.1`} muted playsInline preload="metadata" />}
                  {!a.isVideo && !a.isAudio && a.media && <img src={a.media} alt={a.title} loading="lazy" />}
                  {/* Audio has no still — the tile is a play affordance; the real
                      <audio> player lives in the viewer. (An <img src=mp3> would
                      just render broken, so audio never hits the <img> above.) */}
                  {a.isAudio && a.media && (
                    <div className="wa-audiotile">
                      <span className="wa-audio-ico"><Ico n="music" size={34} /></span>
                      <span className="wa-play" aria-hidden>▶</span>
                    </div>
                  )}
                  {!a.media && (
                    <div style={{ height: 220, display: "grid", placeItems: "center", gap: 6, textAlign: "center", color: "#E7C879" }}>
                      <span style={{ display: "grid", placeItems: "center", opacity: .5 }}><Ico n={a.isVideo ? "video" : a.isAudio ? "music" : "image"} size={32} /></span>
                      {a.expired && <span style={{ fontSize: 11, opacity: 0.75, padding: "0 14px" }}>{t("The render for this one is gone — make it again.")}</span>}
                    </div>
                  )}
                  {a.isVideo && a.media && <span className="wa-play" aria-hidden>▶</span>}
                  {/* Not on a dead tile. A video whose render is gone was
                      showing “The render for this one is gone” and “⏳ 29d” at
                      the same time — one says it is lost, the other says it is
                      safe for a month. The countdown is about un-kept media
                      clearing; there is nothing here left to clear. */}
                  {a.daysLeft != null && !a.expired && <span className={`wa-cd${a.daysLeft <= 5 ? " urgent" : ""}`} title={a.daysLeft === 1 ? t("Auto-clears in {n} day — open it and hit Keep", { n: a.daysLeft }) : t("Auto-clears in {n} days — open it and hit Keep", { n: a.daysLeft })}><Ico n="hourglass" /> {a.daysLeft}d</span>}
                </button>
                <div className="m">
                  {a.title}
                  {/* Rendered on the server in UTC and on the client in the
                      viewer's zone, so these two disagree for anything made
                      after early evening local time. That mismatch aborted
                      hydration for the ENTIRE route (React #418, then #423 —
                      "switch to client rendering"), which is why the Archive
                      re-rendered itself from scratch on every visit. Keep the
                      local date; let React reconcile this one node. */}
                  <div className="s">{a.isVideo ? t("Video") : a.isAudio ? t("Music") : t("Image ad")} · <span suppressHydrationWarning>{new Date(a.when).toLocaleDateString()}</span></div>
                  <div className="wa-tileacts">
                    <span className={`wa-chip ${cc}`}>{cl}</span>
                    {a.media && <a className="wa-icon" href={a.media} download={dlName(a.title, a.isVideo, a.isAudio)} title={t("Download")}><Ico n="download" /></a>}
                    <button type="button" className={`wa-icon${armedDel === a.id ? " armed" : ""}`} title={armedDel === a.id ? t("Tap again to delete — can't be undone") : t("Delete")} disabled={busy} onClick={() => askDelete(a.id)}><Ico n="trash" /></button>
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
          <div className="wa-faildiv"><span>{t("Didn't come through — retry or clear it")}</span></div>
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
                  {t("This {kind} didn't make it", { kind: j.kind })}{j.refunded ? t(" — tokens refunded") : ""}.
                  <div className="s">{t("Failed — retry it right here")}</div>
                  <div className="wa-jacts">
                    <button type="button" className="wb-btn" style={{ padding: "8px 16px", fontSize: 12.5 }} disabled={busy} onClick={() => retryWithToast(j.jobId)}>
                      {j.retryCost > 0 ? t("Retry · {n} tokens · +{xp} XP", { n: j.retryCost, xp: xpForSpend(j.retryCost) }) : t("Retry free")}
                    </button>
                    <button type="button" className="wb-btn ghost" style={{ padding: "8px 14px", fontSize: 12.5 }} disabled={busy} onClick={() => dismissJob(j.jobId)}>{t("Dismiss")}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fullscreen viewer: media plays big / blogs read in a scroll pane.
          Portaled to document.body so it escapes .wb-main's stacking context
          and its z-index:10500 scrim paints above the shell nav (z-index:30);
          the Helpurr FAB (z-index:10600) still sits above the scrim. */}
      {viewer && mounted ? createPortal(
        <div className="wa-scrim" onClick={() => setViewer(null)}>
          <div className={`wa-viewer${viewer.media && viewer.type !== "BLOG_POST" && !viewer.isAudio ? " vmedia" : ""}`} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="wa-vx" aria-label={t("Close")} onClick={() => setViewer(null)}>✕</button>
            <div className={`wa-vstage${viewer.media && viewer.type !== "BLOG_POST" && !viewer.isAudio ? " media" : ""}`}>
              {visibleShelf.length > 1 && vIdx >= 0 && (
                <>
                  <button type="button" className="wa-vnav prev" aria-label={t("Previous")} onClick={() => openAt(vIdx - 1)}>‹</button>
                  <button type="button" className="wa-vnav next" aria-label={t("Next")} onClick={() => openAt(vIdx + 1)}>›</button>
                  <span className="wa-vcount">{vIdx + 1} / {visibleShelf.length}</span>
                </>
              )}
              {/* Keep = a heart TOGGLE over the clip's top-right. Outline → tap to
                  keep (fills gold); gold → tap to un-keep (back to an ordinary
                  piece on the 30-day clock). A PUBLISHED piece stays gold and
                  locked — a tap must never un-publish something already posted. */}
              {viewer.type !== "BLOG_POST" && viewer.media && (() => {
                const published = viewer.status === "PUBLISHED";
                const kept = viewer.status === "APPROVED" || published;
                return (
                  <button type="button" className={`wa-vheart${kept ? " on" : ""}`} disabled={busy || published}
                    aria-pressed={kept}
                    title={published ? t("Posted — saved for good") : kept ? t("Kept — tap to un-keep") : t("Keep — save it for good")}
                    aria-label={kept ? t("Kept") : t("Keep")}
                    onClick={() => { if (published) return; if (viewer.status === "APPROVED") unkeepAsset(viewer.id); else keepAsset(viewer.id); }}>
                    <Ico n="heart" size={20} style={kept ? { fill: "currentColor" } : undefined} />
                  </button>
                );
              })()}
              {viewer.type === "BLOG_POST" ? (
                viewer.html
                  ? <div className="wa-read" dangerouslySetInnerHTML={{ __html: viewer.html }} />
                  : <div className="wa-read"><h2>{viewer.title}</h2><p>{viewer.snippet || t("Still being written…")}</p></div>
              ) : viewer.isVideo && viewer.media ? (
                <video className="wa-vfull" src={viewer.media} controls autoPlay playsInline />
              ) : viewer.isAudio && viewer.media ? (
                <div className="wa-audiofull">
                  <span className="wa-audio-ico"><Ico n="music" size={46} /></span>
                  <audio src={viewer.media} controls autoPlay />
                </div>
              ) : viewer.media ? (
                <img className="wa-vfull" src={viewer.media} alt={viewer.title} />
              ) : (
                <div className="wa-read"><p>{t("Still being made…")}</p></div>
              )}
            </div>
            <div className="wa-vmeta">
              <div className="wa-vtitle">
                <b>{viewer.title}</b>
                {viewer.recipe && <span className="wa-recipe" title={t("The recipe this ad was built with")}><Ico n="sliders" /> {viewer.recipe}</span>}
                {posted && postedAssetId === viewer.id ? <span className="wa-vok">{t("Posted to {where}", { where: posted })} ✓</span>
                  : err && actedId === viewer.id ? <span className="wa-verr">{err}</span>
                  : <span className={`wa-chip ${chipFor(viewer)[0]}`}>{chipFor(viewer)[1]}</span>}
              </div>
              {viewer.missed && (
                <span className="wa-vmissed">
                  <Ico n="warning" /> {t("The")} <b>{viewer.missed}</b> {t("layout didn't render cleanly, so this went out as a plain product ad instead.")} <b>{t("Remix")}</b> {t("re-rolls it.")}
                </span>
              )}
              {/* THE RECEIPT — what the merchant picked and what the AI wrote.
                  Only renders the fields a given piece actually stored. */}
              {(() => {
                const d = viewer.details;
                if (!d) return null;
                const showProduct = d.product && d.product !== viewer.title;
                const hasRow = showProduct || d.presenter || d.topic || d.tagline;
                if (!d.kind && !hasRow && !d.held && !d.service && !d.direction && !d.script) return null;
                return (
                  <div className="wa-spec">
                    {d.kind && <span className="wa-spec-kind">{t(d.kind)}</span>}
                    {hasRow && (
                      <dl className="wa-spec-list">
                        {showProduct && <div className="wa-spec-row"><dt>{t("Product")}</dt><dd>{d.product}</dd></div>}
                        {d.presenter && <div className="wa-spec-row"><dt>{t("Presenter")}</dt><dd>{d.presenter}</dd></div>}
                        {d.topic && <div className="wa-spec-row"><dt>{t("Topic")}</dt><dd>{d.topic}</dd></div>}
                        {d.tagline && <div className="wa-spec-row"><dt>{t("Tagline")}</dt><dd>{d.tagline}</dd></div>}
                      </dl>
                    )}
                    {(d.held || d.service) && (
                      <div className="wa-spec-tags">
                        {d.held && <span className="wa-spec-tag">✋ {t("Holding the product")}</span>}
                        {d.service && <span className="wa-spec-tag">{t("Service — no physical product")}</span>}
                      </div>
                    )}
                    {d.direction && (
                      <div className="wa-prompt">
                        <span className="wa-prompt-h">{t("Your direction")}</span>
                        <p>{d.direction}</p>
                      </div>
                    )}
                    {d.script && d.scriptLabel && (
                      <div className="wa-prompt">
                        <span className="wa-prompt-h">{t(d.scriptLabel)}</span>
                        <p className="wa-prompt-script">{d.script}</p>
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Post tracking + the Boost Bridge. Clicks come from the /go/a
                  turnstile in every posted caption; the live post links open
                  the exact post so boosting is two taps in Meta's own UI —
                  the SMB way to put spend behind a winner, no ads API needed. */}
              {(viewer.clicks > 0 || viewer.postedUrls) && (
                <div className="wa-track">
                  <span className="wa-clicks" title={t("Shoppers who tapped the link in this post's caption")}><Ico n="link" /> {viewer.clicks === 1 ? t("{n} click", { n: viewer.clicks }) : t("{n} clicks", { n: viewer.clicks })}</span>
                  {viewer.postedUrls && Object.entries(viewer.postedUrls).map(([p, u]) => (
                    <a key={p} className="wa-boost" href={u} target="_blank" rel="noreferrer"><Ico n="bolt" /> {t("Boost on {platform}", { platform: p.charAt(0).toUpperCase() + p.slice(1) })} ↗</a>
                  ))}
                  {viewer.postedUrls && (
                    <span className="wa-boosthint">{t("Open the post")} → {t("tap")} <b>⋯ / Boost</b>. {t("Suggested start: $10/day × 3 days, Advantage+ audience. Clicks above tell you which piece earned the spend.")}</span>
                  )}
                </div>
              )}
              {viewer.daysLeft != null && !posted && !viewer.expired && (
                <span className={`wa-vcdnote${viewer.daysLeft <= 5 ? " urgent" : ""}`}><Ico n="hourglass" /> {viewer.daysLeft === 1 ? t("Clears in {n} day", { n: viewer.daysLeft }) : t("Clears in {n} days", { n: viewer.daysLeft })} — {t("tap the heart to save it for good.")}</span>
              )}
              {viewer.type !== "BLOG_POST" && <span className="wa-aitag"><Ico n="sparkle" /> {t("AI-generated · review before posting")}</span>}
              {viewer.type === "BLOG_POST" ? (
                <div className="wa-vacts">
                  {viewer.html && <button type="button" className="wa-vbtn ghost" onClick={() => copyHtml(viewer.html!)}>{copied ? t("Copied ✓") : t("Copy HTML")}</button>}
                  {viewer.html && <button type="button" className="wa-vbtn ghost" onClick={() => downloadHtml(viewer.title, viewer.html!)}><Ico n="download" /> {t("Download")}</button>}
                  <button type="button" className="wa-vbtn gold" disabled={busy} title={t("Write a fresh article on the same product")} onClick={() => remix(viewer.id)}><Ico n="sparkle" /> {t("Remix")}<span className="c">{t("{n} tokens · +{xp} XP", { n: costOf(viewer.type), xp: xpForSpend(costOf(viewer.type)) })}</span></button>
                  <button type="button" className={`wa-vbtn danger full${armedDel === viewer.id ? " armed" : ""}`} disabled={busy} title={armedDel === viewer.id ? t("Tap again to delete — can't be undone") : t("Delete")} onClick={() => askDelete(viewer.id)}>{armedDel === viewer.id ? t("Tap again to delete") : t("Delete")}</button>
                </div>
              ) : (
                <>
                  <div className="wa-vacts">
                    {canPost && linked.length > 0 && !capOpen && viewer.media && !viewer.isAudio && (
                      <button type="button" className="wa-vbtn full" disabled={busy} onClick={() => startPost(viewer.id)}>{isCreator ? t("Share to socials") : t("Post to socials")}</button>
                    )}
                    {viewer.media && <a className="wa-vbtn ghost" href={viewer.media} download={dlName(viewer.title, viewer.isVideo, viewer.isAudio)}><Ico n="download" /> {t("Download")}</a>}
                    {/* CROSS-SECTION BRIDGE — "edit my own content": open this
                        image in the Creator editor (seeds ?src=; the full
                        describe-first edit flow runs on it). Image-only — the
                        edit pipeline can't edit video. Flips to casual so the
                        edit lands back in the Creator Gallery. */}
                    {!viewer.isVideo && !viewer.isAudio && viewer.media && (
                      <button type="button" className="wa-vbtn ghost" disabled={busy}
                        title={t("Open this image in the Creator editor")}
                        onClick={() => { try { localStorage.setItem("emMode", "casual"); } catch { /* */ } window.location.href = `/web/studio?do=edit&src=${encodeURIComponent(viewer.media!)}`; }}>
                        <Ico n="article" /> {t("Edit")}{isCreator ? "" : t(" in Creator")}
                      </button>
                    )}
                    {/* CROSS-SECTION BRIDGE — "use creator content on Marketing":
                        schedule this creation into a marketing campaign (repost,
                        0 tokens, posts the media as-is — no ad-format claims are
                        layered on, so no fabrication risk). Flips to marketing. */}
                    {isCreator && !viewer.isAudio && viewer.media && (
                      <button type="button" className="wa-vbtn ghost" disabled={busy}
                        title={t("Schedule this into a social campaign")}
                        onClick={() => { try { localStorage.setItem("emMode", "marketing"); } catch { /* */ } window.location.href = `/web/campaigns?pick=${encodeURIComponent(viewer.id)}`; }}>
                        ➜ {t("Use in a campaign")}
                      </button>
                    )}
                    {/* A piece whose render we lost is replaced on us, so the
                        button must not quote a price the merchant will not pay. */}
                    {!viewer.isAudio && (
                      <button type="button" className="wa-vbtn gold" disabled={busy} title={viewer.freeRemake ? t("We lost this render — make it again, on us") : t("Make a fresh variation of this piece")} onClick={() => remix(viewer.id)}>{viewer.freeRemake ? t("Make it again") : t("Remix")}<span className="c">{viewer.freeRemake ? t("free — on us") : t("{n} tokens · +{xp} XP", { n: costOf(viewer.type), xp: xpForSpend(costOf(viewer.type)) })}</span></button>
                    )}
                    <button type="button" className={`wa-vbtn danger full${armedDel === viewer.id ? " armed" : ""}`} disabled={busy} title={armedDel === viewer.id ? t("Tap again to delete — can't be undone") : t("Delete")} onClick={() => askDelete(viewer.id)}>{armedDel === viewer.id ? t("Tap again to delete") : t("Delete")}</button>
                  </div>
                  {capOpen && (
                    <div className="wa-cap">
                      <textarea
                        className="wa-capbox"
                        rows={5}
                        value={caption}
                        disabled={draftPending}
                        placeholder={draftPending ? t("Writing a caption for you…") : t("Write your caption…")}
                        onChange={(e) => setCaption(e.target.value)}
                      />
                      <div className="wa-caprow">
                        <button type="button" className="wa-vbtn" disabled={busy || draftPending || !caption.trim()} onClick={() => doPost(viewer.id)}>{busy && !draftPending ? t("Posting…") : t("Post now")}</button>
                        <button type="button" className="wa-vbtn ghost" disabled={busy} onClick={() => setCapOpen(false)}>{t("Cancel")}</button>
                      </div>
                      <span className="wa-caphint">{t("Posts to {where}.", { where: linked.join(" · ") })} {t("Tweak it or post as-is — the #EasyModeAi disclosure rides along either way.")}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      , document.body) : null}

      {/* Delete / retry confirmation toast. Portaled to document.body so its
          fixed position + z-index clear any stacking context and it shows
          whether or not the viewer is open. */}
      {toast && mounted ? createPortal(
        <div className="wa-toast" role="status" aria-live="polite">
          <span className="wa-toast-ic"><Ico n={toast.undo ? "trash" : "check"} /></span>
          <span>{toast.msg}</span>
          {toast.undo && <button type="button" className="wa-toast-undo" onClick={toast.undo}>{t("Undo")}</button>}
        </div>
      , document.body) : null}
    </div>
  );
}
