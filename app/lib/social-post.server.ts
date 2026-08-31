import { db } from "../db.server";
import { zonedInstant } from "./timezone";
import { parseSchedule, type QuestSlot } from "./questlines";

/* The auto-posting engine (v0 scaffold).
 *
 * The campaign scheduler forges content ~24h early and marks slots READY.
 * This engine's job: when a READY slot's post time arrives AND the shop has
 * the platform connected, publish it and mark the slot POSTED.
 *
 * HONESTY RULE: a slot only ever becomes POSTED on a confirmed API success.
 * The publish call below is the single integration point for the TikTok
 * Content Posting API / Meta Content Publishing API — wire credentials +
 * calls there and the whole pipeline lights up end to end. Until then, due
 * slots stay READY and we just log the backlog (throttled).
 */

type Publishable = {
  shopId: string;
  questlineId: string;
  slotIdx: number;
  type: string;
  productTitle: string;
  topic?: string;
  assetId?: string;
  credit?: string; // trial watermark, if any
};

/** THE integration point — now live via the upload-post provider. Returns
 *  ok only on a confirmed provider success. Blogs aren't social posts (they
 *  publish to the store), so they're skipped here. */
async function publishContent(
  linked: string[],
  profileKey: string,
  item: Publishable
): Promise<{ ok: boolean; pending?: string; urls?: Record<string, string>; posted?: string[]; failed?: string[] }> {
  if (item.type === "blog") return { ok: false, pending: "blog-not-social" };
  if (!item.assetId) return { ok: false, pending: "no-asset" };
  const { publishPost, socialProviderEnabled } = await import("./social-provider.server");
  if (!socialProviderEnabled()) return { ok: false, pending: "provider-key" };

  const asset = await db.asset.findUnique({ where: { id: item.assetId }, select: { bodyJson: true } });
  if (!asset) return { ok: false, pending: "asset-missing" };
  let mediaUrl: string | undefined;
  try {
    const body = JSON.parse(asset.bodyJson);
    mediaUrl = body.videoUrl || body.imageUrl || body.url;
  } catch { /* fall through */ }
  if (!mediaUrl) return { ok: false, pending: "no-media" };

  const platforms = linked.filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
  if (platforms.length === 0) return { ok: false, pending: "no-platforms" };

  // ATTRIBUTION: the caption links through OUR /go turnstile, which counts
  // the click on this exact slot and forwards to the product with UTM tags —
  // the "which post made money" loop starts at this line.
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const goUrl = base ? `${base}/go/${item.questlineId}/${item.slotIdx}` : "";

  // AI caption + per-platform hashtags (cached on the asset after the first
  // spend). Falls back to the plain caption if generation fails — a post
  // never blocks on the writer.
  const isVideo = item.type === "video";
  const { getOrMakeCaptions, buildPostTitle, fallbackCaption } = await import("./social-caption.server");
  const captions = await getOrMakeCaptions(item.assetId, item.shopId, {
    productTitle: item.productTitle,
    topic: item.topic,
    isVideo,
    platforms,
  });
  const fbText = fallbackCaption({ productTitle: item.productTitle, topic: item.topic, isVideo, platforms }).text;

  // Each platform gets its own tailored caption + tag set, so we post
  // per-platform rather than one blanket call.
  // Report per platform. This used to collapse to a single `anyOk`: one
  // success out of three made the whole slot POSTED, and the two failures were
  // discarded — never retried, never shown to the merchant, who believed the
  // drop went out everywhere. `ok` now means EVERY targeted account took it;
  // `posted` says which ones did, so a retry can skip them instead of
  // publishing a duplicate to the account that already worked.
  const urls: Record<string, string> = {};
  const posted: string[] = [];
  const failed: string[] = [];
  let lastErr: string | undefined;
  for (const p of platforms) {
    const title = buildPostTitle(captions[p], goUrl, fbText, item.credit);
    const res = await publishPost(profileKey, { title, mediaUrl, isVideo, platforms: [p] });
    if (res.ok) {
      posted.push(p);
      if (res.urls) Object.assign(urls, res.urls);
    } else {
      failed.push(p);
      lastErr = res.error;
    }
  }
  return { ok: failed.length === 0 && posted.length > 0, urls, posted, failed, pending: lastErr };
}

let lastScan = 0;
const SCAN_EVERY_MS = 5 * 60_000;

/** Called from the worker tick. Cheap, throttled, and never lies. */
export async function postDueSlots(): Promise<void> {
  const now = Date.now();
  if (now - lastScan < SCAN_EVERY_MS) return;
  lastScan = now;

  try {
    const active = await db.questline.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, shopId: true, scheduleJson: true, reviewMode: true },
    });
    if (active.length === 0) return;

    // provider link state per shop (from the cached socialsJson)
    const shopIds = [...new Set(active.map((q) => q.shopId))];
    const shops = await db.shop.findMany({
      where: { id: { in: shopIds } },
      select: { id: true, domain: true, timezone: true, socialProfileKey: true, socialsJson: true, activePlan: { select: { trialEndsAt: true } } },
    });
    const { linkedFromCache } = await import("./social-provider.server");
    const { trialCredit } = await import("./social-caption.server");
    const byShop = new Map(shops.map((s) => [s.id, { domain: s.domain, timezone: s.timezone, profileKey: s.socialProfileKey, linked: linkedFromCache(s.socialsJson), credit: trialCredit(s.activePlan) }]));

    let due = 0;
    let posted = 0;

    // DRAIN A BACKLOG, DO NOT DUMP IT.
    //
    // This loop had no lower bound on how far in the past a due slot could
    // be, no per-scan cap and no spacing. A slot that could not publish
    // earlier — no linked account, no provider key, campaign paused — stays
    // READY and stays due forever, so the moment the blocker clears, one tick
    // fires the ENTIRE backlog back to back. A merchant who connects
    // Instagram two weeks into a 30-day campaign gets fourteen posts in a
    // burst: exactly the pattern every platform treats as spam, on the
    // account we just helped them link.
    //
    // Counted per SHOP, not per questline — a shop can be running several
    // campaigns plus a repost, and the platform sees one account. The rest
    // stay READY and go out on the next five-minute tick, so nothing is
    // dropped, it just arrives at a human pace.
    const CATCHUP_PER_SHOP = 3;
    const publishedThisScan = new Map<string, number>();
    let heldForReview = 0;
    for (const q of active) {
      // "LET ME APPROVE EACH DROP" MEANS EXACTLY THAT.
      //
      // The campaign builder offers "Before it posts: Let me approve each drop"
      // or "Post automatically", stores the answer on the questline, and
      // nothing anywhere read it as a gate — this scan published every READY
      // drop to the merchant's live TikTok, Instagram and Facebook either way.
      // REVIEW_FIRST is the DEFAULT, so the setting was wrong for most
      // campaigns, and posting to someone's real accounts is not undoable.
      //
      // The content still forges and still lands in the Archive; the merchant
      // publishes it there with the button that is already on the card. The
      // questline still completes either way — settleQuestlineIfDone falls
      // through on scheduleElapsed when slots never post.
      if (q.reviewMode === "REVIEW_FIRST") {
        heldForReview++;
        // THE COMMENT ABOVE WAS NOT TRUE. It says the questline "still
        // completes either way — settleQuestlineIfDone falls through on
        // scheduleElapsed when slots never post", and the `continue` that
        // used to be on this line skipped the only call that does it. So every
        // held campaign — which is every campaign on the default setting —
        // stayed ACTIVE forever, never paid out its xpReward (550 to 3,000)
        // and never unlocked QUEST_COMPLETE. Nothing published, so nothing
        // else could ever settle it either.
        try {
          const held = parseSchedule(q.scheduleJson);
          const lastMs = held.slots.reduce((m, s) => {
            const t = zonedInstant(s.date, s.time, byShop.get(q.shopId)?.timezone).getTime();
            return Number.isFinite(t) && t > m ? t : m;
          }, 0);
          if (lastMs > 0 && now > lastMs + 24 * 60 * 60 * 1000) {
            const { settleQuestlineIfDone } = await import("./questlines.server");
            await settleQuestlineIfDone(q.id);
          }
        } catch (e) {
          console.error("[post] held-campaign settle check failed (non-fatal):", e);
        }
        continue;
      }
      // Re-read rather than trusting the batch snapshot: by the time the loop
      // reaches a questline near the end, that snapshot is as old as all the
      // publishing done before it. One row, and it decides what we post.
      const row = await db.questline.findUnique({ where: { id: q.id }, select: { scheduleJson: true } });
      if (!row) continue;
      const schedule = parseSchedule(row.scheduleJson);
      let changed = false;

      // Record EVERY post the moment it lands. These marks used to accumulate
      // in memory and get written once at the end of the questline's loop, so
      // any throw in between — a provider hanging up, publishBlogAsset raising —
      // escaped to the outer catch and discarded the marks for posts that had
      // ALREADY gone out. The next scan saw those slots still READY and
      // published them again: duplicate posts on the merchant's real accounts,
      // which we cannot take back. A few extra writes a day is nothing against
      // that.
      // ...and write ONLY the three fields this scan owns, onto the CURRENT row.
      //
      // This used to serialize the whole in-memory `schedule` — a snapshot taken
      // before publishing began. Publishing is not quick: a caption call, then a
      // network round trip per platform, per slot. The worker is imported into
      // shopify.server.ts and shares one event loop with the Remix handlers, so
      // every await in there hands control to whatever the merchant is doing.
      // Anything they committed in that window was erased by this write:
      //
      //   - a drop they had just paid 150 tokens to add vanished off the map,
      //     tokens spent and never refunded, with objectivesJson left counting a
      //     target the schedule no longer contains;
      //   - a slot they had just hit Retry on had its status dragged back to
      //     READY with the OLD assetId restored, so the next scan published to
      //     their live accounts the exact asset they had paid to replace.
      //
      // Re-read, find the slot by idx (never by array position — addDrop assigns
      // idx = max+1, so positions shift), copy across status/postedTo/postedUrls
      // and nothing else, then commit with a compare-and-swap on the exact JSON
      // just read, so a write landing in between is detected instead of lost.
      const record = async (slot: QuestSlot): Promise<boolean> => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const fresh = await db.questline.findUnique({ where: { id: q.id }, select: { scheduleJson: true } });
            if (!fresh) return false; // abandoned mid-scan — stop touching it
            const current = parseSchedule(fresh.scheduleJson);
            const target = current.slots.find((x) => x.idx === slot.idx);
            if (!target) return true; // no longer in the schedule — do not re-add it

            // postedTo is a UNION, never a replacement. It is the only thing
            // stopping a re-publish to an account that already took the post,
            // and that cannot be taken back.
            const union = [...new Set([...(target.postedTo || []), ...(slot.postedTo || [])])];
            if (union.length) target.postedTo = union;
            if (slot.postedUrls) target.postedUrls = { ...(target.postedUrls || {}), ...slot.postedUrls };

            // Forward only. If the merchant hit Retry mid-publish the fresh copy
            // reads FORGING with a new assetId — bank where this post reached,
            // but leave the status for the next scan to decide.
            if (slot.status === "POSTED" && (target.status === "READY" || target.status === "POSTED")) {
              target.status = "POSTED";
            }

            const done = await db.questline.updateMany({
              where: { id: q.id, scheduleJson: fresh.scheduleJson },
              data: { scheduleJson: JSON.stringify(current) },
            });
            if (done.count === 1) return true;
            // Someone committed between the read and the write — read it again.
          } catch (e) {
            console.error(`[social-post] could not record a post for questline ${q.id} — halting its scan so nothing double-posts:`, e);
            return false;
          }
        }
        console.error(`[social-post] questline ${q.id}: its schedule kept changing under the recorder — halting its scan so nothing double-posts`);
        return false;
      };

      for (const s of schedule.slots) {
        if (s.status !== "READY") continue;
        if ((publishedThisScan.get(q.shopId) || 0) >= CATCHUP_PER_SHOP) {
          console.log(`[social-post] shop ${q.shopId} hit the ${CATCHUP_PER_SHOP}-per-scan catch-up cap — the rest stay READY for the next tick`);
          break;
        }
        // A slot time is a WALL time in the merchant's day. Read as UTC it
        // fired at the wrong hour for everyone outside it — and for a merchant
        // west of UTC, hours EARLY, publishing a drop before its date.
        if (zonedInstant(s.date, s.time, byShop.get(q.shopId)?.timezone).getTime() > now) continue;
        due++;
        const link = byShop.get(q.shopId);

        // Blogs publish to the store's Online Store blog (SEO), not to socials —
        // no linked account required. This is the "Get Found" delivery path.
        if (s.type === "blog") {
          if (!s.assetId || !link?.domain) continue;
          const { publishBlogAsset } = await import("./blog-publish.server");
          const br = await publishBlogAsset(link.domain, s.assetId);
          if (br.ok) {
            s.status = "POSTED";
            if (br.url) s.postedUrls = { blog: br.url };
            changed = true;
            posted++;
            publishedThisScan.set(q.shopId, (publishedThisScan.get(q.shopId) || 0) + 1);
            if (!(await record(s))) break; // it is live; if we cannot write that down, stop.
          } else {
            console.log(`[blog-publish] slot ${q.id}#${s.idx} pending: ${br.error}`);
          }
          continue;
        }

        if (!link?.profileKey || link.linked.length === 0) continue; // nothing linked yet
        // Social Media Plans scope a plan to specific accounts — post only there.
        const wanted = schedule.platforms?.length ? link.linked.filter((p) => schedule.platforms!.includes(p)) : link.linked;
        // Never re-publish to an account this slot already reached. A partial
        // success on a previous scan is remembered in postedTo precisely so the
        // retry finishes the job instead of duplicating the part that worked.
        const already = s.postedTo || [];
        const targets = wanted.filter((p) => !already.includes(p));
        if (wanted.length === 0) continue;
        if (targets.length === 0) {
          // Everything it was ever meant to reach is done — close the slot.
          s.status = "POSTED";
          changed = true;
          if (!(await record(s))) break;
          continue;
        }
        const res = await publishContent(targets, link.profileKey, {
          shopId: q.shopId, questlineId: q.id, slotIdx: s.idx,
          type: s.type, productTitle: s.productTitle, topic: s.topic, assetId: s.assetId, credit: link.credit,
        });
        // Bank whatever DID publish, whether or not the whole set succeeded.
        if (res.posted?.length) {
          s.postedTo = [...new Set([...already, ...res.posted])];
          if (res.urls && Object.keys(res.urls).length) s.postedUrls = { ...(s.postedUrls || {}), ...res.urls };
          changed = true;
          posted += res.posted.length;
          // One SLOT is one post as far as the platform is concerned, however
          // many accounts it reached, so the catch-up cap counts slots.
          publishedThisScan.set(q.shopId, (publishedThisScan.get(q.shopId) || 0) + 1);
        }
        // POSTED only once every account it was aimed at has taken it. A slot
        // that reached TikTok but not Facebook stays READY so the next scan
        // finishes Facebook — and, thanks to postedTo, does not touch TikTok
        // again. Previously one success marked the slot done and the failures
        // were thrown away silently.
        if (wanted.every((p) => (s.postedTo || []).includes(p))) {
          s.status = "POSTED";
          changed = true;
        } else if (res.failed?.length) {
          console.warn(
            `[social-post] slot ${q.id}#${s.idx}: published to ${(res.posted || []).join(", ") || "nothing"}, ` +
              `still owed ${res.failed.join(", ")}${res.pending ? ` (${res.pending})` : ""} — will retry`
          );
        }
        if (changed && !(await record(s))) break; // it is live; if we cannot write that down, stop.
      }
      // A campaign finishes when its LAST DROP POSTS, not when the last piece
      // rendered — and this scan is the only place that can know that. The
      // completion flip used to live on the forge path, where it fired a day
      // early and then hid the questline from this very scan, stranding the
      // final drops. Ask after a slot goes out, and also once the schedule has
      // fully elapsed, so a drop that can never post (socials unlinked, a
      // platform permanently refusing) can't pin the campaign ACTIVE forever.
      const lastSlotMs = schedule.slots.reduce((m, s) => {
        const t = zonedInstant(s.date, s.time, byShop.get(q.shopId)?.timezone).getTime();
        return Number.isFinite(t) && t > m ? t : m;
      }, 0);
      if (changed || (lastSlotMs > 0 && now > lastSlotMs + 24 * 60 * 60 * 1000)) {
        const { settleQuestlineIfDone } = await import("./questlines.server");
        await settleQuestlineIfDone(q.id);
      }
    }
    if (heldForReview > 0) {
      console.log(`[social-post] ${heldForReview} campaign(s) set to "approve each drop" — their ready drops wait in the Archive`);
    }
    if (due > 0) {
      console.log(`[social-post] ${due} slot(s) past post time (${posted} posted; publisher pending platform APIs)`);
    }
  } catch (e) {
    console.error("[social-post] scan failed (non-fatal):", e);
  }
}
