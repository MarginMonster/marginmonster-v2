// Creator "Channels" — faceless video on autopilot.
//
// A CreatorSeries is a running channel: pick a vibe + format + voice + cadence
// once, and the worker picks a FRESH AI topic on schedule, renders a faceless
// video (the exact same pipeline the Studio uses), and — if autoPost — publishes
// it to the shop's linked socials via the same upload-post provider the
// marketing campaigns use. No product, no XP, no /go attribution: pure creator
// content. The expensive, risky parts (render pipeline, token prepay/refund,
// per-platform publish, not-double-posting) are all REUSED; this file is the
// thin scheduler + topic brain + a lean creator-flavoured poster on top.

import { db } from "../db.server";
import { TOKEN_COST } from "./plan-config";
import { spendTokens, tokensRemainingLive } from "./tokens.server";
import { enqueueJob } from "./job-queue.server";
import { anthropicText } from "./anthropic.server";
import { FACELESS_FORMATS } from "./faceless-video.server";

const SOCIAL = ["tiktok", "instagram", "facebook"] as const;

/** Cadence presets, framed the way creators think ("videos per week"), not as a
 *  token meter. intervalHours drives the next-drop time. */
export const CADENCE: Record<string, { label: string; perWeek: number; intervalHours: number }> = {
  "3x_week": { label: "3× / week", perWeek: 3, intervalHours: 56 },
  daily: { label: "Daily", perWeek: 7, intervalHours: 24 },
  "2x_day": { label: "2× / day", perWeek: 14, intervalHours: 12 },
};
export function cadenceOf(key: string): { label: string; perWeek: number; intervalHours: number } {
  return CADENCE[key] || CADENCE["3x_week"];
}

export function parsePlatforms(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((p) => (SOCIAL as readonly string[]).includes(p)) : [];
  } catch {
    return [];
  }
}
function parseTopics(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** One fresh topic for a channel's next drop — riffs on the niche in the chosen
 *  format, steering clear of the recent ones so a channel never repeats itself.
 *  Cheap (default Haiku); on any failure falls back to the niche itself so a
 *  drop is never blocked on the topic brain. */
export async function nextTopic(niche: string, format: string, recent: string[]): Promise<string> {
  const fmt = FACELESS_FORMATS[format] || FACELESS_FORMATS.facts;
  try {
    const prompt =
      `You run a faceless short-video channel about: "${niche}".\n` +
      `Style: ${fmt}.\n` +
      `Give ONE fresh, specific, scroll-stopping topic for the NEXT video — a single short line (max ~12 words). No quotes, no numbering, no hashtags.\n` +
      (recent.length ? `Do NOT repeat or closely overlap any of these recent topics:\n- ${recent.slice(-12).join("\n- ")}\n` : "") +
      `Keep it true and general — don't invent specific stats, prices or named people.\n` +
      `Return ONLY the topic line.`;
    const raw = (await anthropicText(prompt, { maxTokens: 60 })).trim();
    const line = raw
      .split("\n")
      .map((s) => s.replace(/^["'`\-\d.)\s]+/, "").replace(/["'`]+$/, "").trim())
      .find(Boolean) || "";
    return line.slice(0, 120) || niche;
  } catch {
    return niche;
  }
}

async function pause(id: string, reason: string): Promise<void> {
  try {
    await db.creatorSeries.update({ where: { id }, data: { status: "PAUSED", pauseReason: reason } });
  } catch {
    /* non-fatal */
  }
}

let lastScan = 0;
const SCAN_EVERY_MS = 2 * 60_000;
// Channels advanced per scan. One drop per channel per scan, and a hard cap
// across channels, so a backlog drains at a human pace instead of firing a
// burst of renders (and posts) the moment the worker catches up.
const PER_TICK_CAP = 4;

/** Worker-tick entry. Finds channels whose next drop is due, picks a fresh
 *  topic, prepays the render and enqueues it. Self-throttled; never throws. */
export async function tickDueSeries(): Promise<void> {
  const now = Date.now();
  if (now - lastScan < SCAN_EVERY_MS) return;
  lastScan = now;

  try {
    const due = await db.creatorSeries.findMany({
      where: { status: "ACTIVE", nextRunAt: { lte: new Date(now) } },
      orderBy: { nextRunAt: "asc" },
      take: PER_TICK_CAP,
    });
    if (due.length === 0) return;

    const { assertCapability } = await import("./capabilities.server");
    const { socialProviderEnabled, linkedFromCache } = await import("./social-provider.server");

    for (const s of due) {
      try {
        const shop = await db.shop.findUnique({
          where: { id: s.shopId },
          select: { id: true, socialsJson: true, activePlan: true },
        });
        if (!shop?.activePlan) { await pause(s.id, "user"); continue; }

        // Faceless rides the "video" capability — a channel can't outrun its plan.
        try { assertCapability(shop.activePlan, "video"); } catch { await pause(s.id, "needs-plan"); continue; }

        // Never burn tokens we don't have: a short wallet pauses the channel with
        // a clear reason instead of failing renders one by one.
        if (tokensRemainingLive(shop.activePlan) < TOKEN_COST.faceless) { await pause(s.id, "out-of-tokens"); continue; }

        // Auto-post needs somewhere to post. If the accounts went away, pause
        // rather than render videos that can't go out.
        const wantPlatforms = parsePlatforms(s.platformsJson);
        if (s.autoPost) {
          const linked = socialProviderEnabled() ? linkedFromCache(shop.socialsJson) : [];
          const targets = wantPlatforms.length ? wantPlatforms.filter((p) => linked.includes(p)) : linked;
          if (targets.length === 0) { await pause(s.id, "no-accounts"); continue; }
        }

        const recent = parseTopics(s.recentTopicsJson);
        const topic = await nextTopic(s.niche, s.format, recent);

        // Spend at enqueue, like the Studio. A terminal render failure refunds
        // via refundPrepaidOnce (chargedTokens), same as a manual faceless.
        let fromExtra = 0;
        try {
          const r = await spendTokens(s.shopId, TOKEN_COST.faceless);
          fromExtra = r.fromExtra;
        } catch { await pause(s.id, "out-of-tokens"); continue; }

        await enqueueJob(s.shopId, "GENERATE_VIDEO_AD", {
          contentType: "faceless", topic, facelessFormat: s.format, voiceKey: s.voiceKey,
          section: "creator", prePaid: true, chargedTokens: TOKEN_COST.faceless, chargedFromExtra: fromExtra,
          seriesId: s.id, seriesName: s.name, seriesAutoPost: s.autoPost, seriesPlatforms: wantPlatforms,
          initiator: "series",
        });

        const interval = cadenceOf(s.cadence).intervalHours * 3600_000;
        await db.creatorSeries.update({
          where: { id: s.id },
          data: {
            lastRunAt: new Date(now),
            nextRunAt: new Date(now + interval),
            dropsMade: { increment: 1 },
            recentTopicsJson: JSON.stringify([...recent, topic].slice(-12)),
            pauseReason: null,
          },
        });
      } catch (e) {
        console.error(`[series] drop failed for ${s.id} (non-fatal):`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.error("[series] scan failed (non-fatal):", e);
  }
}

/** TEMP owner-scoped diagnostic: walks the per-series drop checks for a shop's
 *  first ACTIVE channel and reports exactly where it stops — WITHOUT spending or
 *  enqueuing. Lets us see why a channel isn't dropping without worker logs. */
export async function debugDropOnce(shopId: string): Promise<Record<string, unknown>> {
  const steps: Record<string, unknown> = {};
  try {
    const now = Date.now();
    const all = await db.creatorSeries.findMany({ where: { shopId }, orderBy: { createdAt: "desc" }, take: 5 });
    steps.totalSeries = all.length;
    steps.rows = all.map((s) => ({ id: s.id, status: s.status, pauseReason: s.pauseReason, nextRunAt: s.nextRunAt, due: s.nextRunAt ? s.nextRunAt.getTime() <= now : null, dropsMade: s.dropsMade }));
    const due = await db.creatorSeries.findMany({ where: { shopId, status: "ACTIVE", nextRunAt: { lte: new Date(now) } }, orderBy: { nextRunAt: "asc" }, take: 1 });
    steps.dueCount = due.length;
    if (!due.length) return { ...steps, stop: "nothing due" };
    const s = due[0];
    const shop = await db.shop.findUnique({ where: { id: shopId }, select: { id: true, socialsJson: true, activePlan: true } });
    steps.hasPlan = !!shop?.activePlan;
    if (!shop?.activePlan) return { ...steps, stop: "no active plan" };
    try {
      const { assertCapability } = await import("./capabilities.server");
      assertCapability(shop.activePlan, "video");
      steps.cap = "ok";
    } catch (e) { return { ...steps, stop: "capability", capErr: e instanceof Error ? e.message : String(e) }; }
    steps.walletTokens = tokensRemainingLive(shop.activePlan);
    steps.facelessCost = TOKEN_COST.faceless;
    if (tokensRemainingLive(shop.activePlan) < TOKEN_COST.faceless) return { ...steps, stop: "out-of-tokens" };
    const recent = parseTopics(s.recentTopicsJson);
    const topic = await nextTopic(s.niche, s.format, recent);
    steps.topic = topic;
    return { ...steps, reached: "pre-spend OK — would enqueue a drop here" };
  } catch (e) {
    return { ...steps, error: e instanceof Error ? e.stack || e.message : String(e) };
  }
}

/** Publish a finished series drop to the shop's linked socials. Reuses the SAME
 *  provider + caption + title stack as the manual "Post to socials" button and
 *  the campaign scheduler, minus the product /go link. Records postedTo on the
 *  asset so a retry never double-posts, and bumps the channel's posted count.
 *  Called from the faceless job on completion; never throws (the video already
 *  exists in the Gallery whether or not the post lands). */
export async function postCreatorDrop(opts: {
  shopId: string;
  assetId: string;
  seriesId?: string;
  topic?: string;
  platforms?: string[];
}): Promise<void> {
  const { socialProviderEnabled, ensureProfile, refreshLinkedPlatforms, publishPost } = await import("./social-provider.server");
  if (!socialProviderEnabled()) return;

  const profileKey = await ensureProfile(opts.shopId);
  if (!profileKey) return;

  let linked = (await refreshLinkedPlatforms(opts.shopId)).filter((p) => (SOCIAL as readonly string[]).includes(p));
  if (opts.platforms && opts.platforms.length) linked = linked.filter((p) => opts.platforms!.includes(p));
  if (linked.length === 0) return;

  const asset = await db.asset.findUnique({ where: { id: opts.assetId }, select: { bodyJson: true, metaJson: true } });
  if (!asset) return;
  let mediaUrl = "";
  try { const b = JSON.parse(asset.bodyJson) as { videoUrl?: string; url?: string }; mediaUrl = b.videoUrl || b.url || ""; } catch { /* */ }
  if (!mediaUrl) return;

  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(asset.metaJson || "{}"); } catch { /* */ }
  const already: string[] = Array.isArray(meta.postedTo) ? (meta.postedTo as string[]) : [];
  const targets = linked.filter((p) => !already.includes(p));
  if (targets.length === 0) return;

  const { getOrMakeCaptions, buildPostTitle, fallbackCaption } = await import("./social-caption.server");
  const capInput = { productTitle: (opts.topic || "New video").slice(0, 120), isVideo: true, platforms: targets };
  const captions = await getOrMakeCaptions(opts.assetId, opts.shopId, capInput);
  const fbText = fallbackCaption(capInput).text;

  const posted: string[] = [];
  const urls: Record<string, string> = {};
  for (const p of targets) {
    const title = buildPostTitle(captions[p], "", fbText); // no /go link for creator content
    const res = await publishPost(profileKey, { title, mediaUrl, isVideo: true, platforms: [p] });
    if (res.ok) {
      posted.push(p);
      if (res.urls) Object.assign(urls, res.urls);
    }
  }
  if (!posted.length) return;

  const newPosted = [...new Set([...already, ...posted])];
  const prevUrls = meta.postedUrls && typeof meta.postedUrls === "object" ? (meta.postedUrls as Record<string, string>) : {};
  meta.postedTo = newPosted;
  meta.postedUrls = { ...prevUrls, ...urls };
  const allLinkedDone = linked.every((p) => newPosted.includes(p));
  await db.asset.update({
    where: { id: opts.assetId },
    data: { metaJson: JSON.stringify(meta), ...(allLinkedDone ? { status: "PUBLISHED" as const } : {}) },
  });
  if (opts.seriesId) {
    try { await db.creatorSeries.update({ where: { id: opts.seriesId }, data: { dropsPosted: { increment: 1 } } }); } catch { /* */ }
  }
}
