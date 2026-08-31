/* Campaigns on the WEB app — a month of content created and posted for the
 * merchant, hands off.
 *
 * Deliberately NOT a port of app.campaigns.tsx. That page reads products
 * straight out of the Shopify Admin API, which is exactly the assumption
 * EasyMode does not get to make: this side has to work for a Wix store, a
 * BigCommerce store or a plain website. So the product source here is the
 * imported catalogue (CatalogProduct), which the Import tab fills from any
 * storefront link.
 *
 * Everything below the route is shared with the embedded app — acceptQuestline,
 * parseSchedule, abandonQuestline all key off shopId, not a Shopify session. */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { useState } from "react";
import { db } from "../db.server";
import { requireWebIdentity } from "../lib/web-auth.server";
import { AVATARS, avatarImg, privateCastFor } from "../lib/avatars";
import { parseSchedule } from "../lib/questlines";
import { SOCIAL_PLAN_DEFS, questlineCostFor } from "../lib/questlines";
import { acceptQuestline, abandonQuestline } from "../lib/questlines.server";
import { linkedFromCache } from "../lib/social-provider.server";
import { tokensRemainingLive } from "../lib/tokens.server";
import { capabilitiesFor } from "../lib/capabilities.server";
import { CATALOG_CAP } from "../lib/catalog-import.server";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = () => [{ title: "Campaigns · EasyMode" }];

/* The four plans, in the order a merchant should read them: cheapest and
 * safest first, so the ladder sells itself instead of the biggest number
 * doing the talking. Mix and cost come from SOCIAL_PLAN_DEFS — token maths
 * has exactly one source of truth. */
/* "Get Found" is missing on purpose. It is 14 SEO articles plus 20 image
 * posts, and articles cannot auto-publish from the web app — there is no
 * Online Store blog behind a web-<id>.easymode.app shop. Stripped of its
 * articles it is not the plan its name sells, so it belongs to the embedded
 * app until the web side has a real publishing destination. */
const PLAN_ORDER = ["SOCIAL_STEADY", "SOCIAL_VIRAL", "SOCIAL_EMPIRE"];
const PLAN_PITCH: Record<string, { badge: string; pitch: string; worth: string }> = {
  SOCIAL_FOUND: { badge: "SEO", pitch: "Articles targeting what your buyers actually search, plus a steady feed of image posts. The cheapest customers you will ever get.", worth: "≈ $2,000 of agency SEO content" },
  SOCIAL_STEADY: { badge: "Balanced", pitch: "A post nearly every day across video and image, so your feed never goes quiet and buyers never forget you.", worth: "≈ a $1,500/mo retainer" },
  SOCIAL_VIRAL: { badge: "Video-heavy", pitch: "Presenter-led videos twice a week on top of a wall of image posts. You only need one of them to hit.", worth: "≈ $1,200 in UGC video alone" },
  SOCIAL_EMPIRE: { badge: "Max", pitch: "The whole machine. Drops every single day across every platform — some brands post, yours is simply always there.", worth: "≈ a $4,000/mo growth agency" },
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const PLAT_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
const pad = (n: number) => String(n).padStart(2, "0");
/** "2 Video" / "Image" — a count only when it earns one. Labels beat dots:
 *  a merchant scanning the month wants to know WHAT lands, not just that
 *  something does. */
function typeLines(day: { video: number; image: number }): string[] {
  const out: string[] = [];
  if (day.video) out.push(`${day.video > 1 ? day.video + " " : ""}Video`);
  if (day.image) out.push(`${day.image > 1 ? day.image + " " : ""}Image`);
  return out;
}

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Scheduled", FORGING: "Creating", READY: "Ready", POSTED: "Posted", FAILED: "Needs a retry",
};

function monthGrid(year: number, month0: number): number[][] {
  const first = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: number[] = [];
  for (let i = 0; i < first; i++) cells.push(0);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(0);
  const weeks: number[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
function fmtWhen(dateStr: string, timeStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  const h = parseInt((timeStr || "12:00").slice(0, 2), 10);
  const mm = (timeStr || "12:00").slice(3, 5);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${MON[(m || 1) - 1]} ${d} · ${mm === "00" ? `${h12}${ap}` : `${h12}:${mm}${ap}`}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const full = await db.shop.findUnique({
    where: { id: shop.id },
    include: { activePlan: true, questlines: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  const url = new URL(request.url);
  const now = new Date();
  let year = now.getUTCFullYear();
  let month0 = now.getUTCMonth();
  const ym = /^(\d{4})-(\d{2})$/.exec(url.searchParams.get("ym") || "");
  if (ym) {
    const yy = parseInt(ym[1], 10);
    const mm = parseInt(ym[2], 10) - 1;
    if (yy >= 2000 && yy <= 2100 && mm >= 0 && mm <= 11) { year = yy; month0 = mm; }
  }
  const todayDay = now.getUTCFullYear() === year && now.getUTCMonth() === month0 ? now.getUTCDate() : 0;
  const ymStr = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;

  const todayStr = now.toISOString().slice(0, 10);
  const dropMap: Record<number, { video: number; image: number }> = {};
  const campaigns: {
    id: string; name: string; status: string; image: string | null;
    posted: number; overdue: number; total: number; next: string | null; holdsForReview: boolean;
    upcoming: { when: string; type: string; product: string; status: string }[];
  }[] = [];

  for (const q of full?.questlines ?? []) {
    if (q.status === "COMPLETE") continue;
    const slots = parseSchedule(q.scheduleJson).slots;
    let posted = 0;
    let overdue = 0;
    let next: { date: string; time: string } | null = null;
    for (const s of slots) {
      if (s.status === "POSTED") posted++;
      const [y, m, d] = s.date.split("-").map(Number);
      if (y === year && m - 1 === month0 && (s.type === "video" || s.type === "image")) {
        const cell = (dropMap[d] = dropMap[d] || { video: 0, image: 0 });
        cell[s.type]++;
      }
      const waiting = s.status === "SCHEDULED" || s.status === "READY" || s.status === "FORGING";
      if (waiting && s.date >= todayStr) {
        if (!next || s.date < next.date || (s.date === next.date && s.time < next.time)) next = { date: s.date, time: s.time };
      }
      // A slot whose date has passed while still waiting — or one that failed —
      // is not a future drop, and it is emphatically not a posted one. Counting
      // it nowhere is what let the card say "All drops posted" about a campaign
      // that had posted nothing at all.
      if ((waiting && s.date < todayStr) || s.status === "FAILED") overdue++;
    }
    if (q.template === "MANUAL") continue; // one-off container, not a campaign
    const upcoming = slots
      .filter((s) => (s.type === "video" || s.type === "image" || s.type === "blog") && s.date >= todayStr)
      .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))
      .slice(0, 6)
      .map((s) => ({ when: fmtWhen(s.date, s.time), type: s.type, product: s.productTitle || "", status: s.status }));
    campaigns.push({
      id: q.id, name: q.name, status: q.status, image: q.productImageUrl,
      posted, overdue, total: slots.length,
      // A REVIEW_FIRST campaign is never published by the scheduler — the
      // poster skips those questlines outright. The card must not keep saying
      // "Auto-posts to …" about one.
      holdsForReview: q.reviewMode === "REVIEW_FIRST",
      next: next ? fmtWhen(next.date, next.time) : null,
      upcoming,
    });
  }

  const allowance = tokensRemainingLive(full?.activePlan);
  const caps = [...capabilitiesFor(full?.activePlan)] as string[];
  const hasVideo = caps.includes("video");
  const plans = PLAN_ORDER.map((key) => {
    const def = SOCIAL_PLAN_DEFS.find((d) => d.key === key)!;
    // Web plans post to social only, so articles are dropped from the mix,
    // the drop count AND the price. Quoting a month of articles we can't
    // deliver would be charging for nothing.
    const postable = def.objectives.filter((o) => o.type !== "blog");
    const mix = { video: 0, image: 0 };
    for (const o of postable) if (o.type in mix) (mix as Record<string, number>)[o.type] = o.target;
    // questlineCostFor, not questlineTokenCost — the same function accept()
    // charges with. Top-tier members get a 15% break on premium campaigns, and
    // quoting the undiscounted number meant the Legend plan card advertised a
    // "Campaign discount on token costs" that was never visible anywhere the
    // merchant could see it: they upgraded for a benefit the purchase screen
    // then hid. It also made the quote disagree with the charge — in their
    // favour, but a price that is not the price is still wrong.
    const cost = questlineCostFor({ ...def, objectives: postable }, full?.activePlan?.type);
    const videoLocked = mix.video > 0 && !hasVideo;
    return {
      key, name: def.name, icon: def.icon, cadence: def.cadence, bagSize: def.bagSize,
      ...PLAN_PITCH[key], mix, cost, drops: mix.video + mix.image,
      videoLocked, affordable: !videoLocked && allowance >= cost,
    };
  });

  const custom = await (async () => {
    const { customCastFor } = await import("../lib/custom-avatars.server");
    return customCastFor(shop.id);
  })();
  const cast = [
    ...custom.filter((c) => c.status === "ready").map((c) => ({ id: c.id, name: c.name, img: c.img })),
    ...[...privateCastFor(account.email, shop.id, shop.domain), ...AVATARS].map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0) })),
  ];

  // THE ARCHIVE, as campaign material. Merchants accumulate a library — the
  // nine bursts they didn't pick, last month's drops, things made and never
  // posted. Scheduling that costs nothing to generate, so it deserves to be
  // a first-class way to start a campaign rather than a reason to re-buy.
  //
  // Anything already sitting in a slot is filtered out: double-booking one
  // asset across two campaigns posts it twice and looks like a bug to the
  // merchant's followers.
  const scheduledAssetIds = new Set<string>();
  for (const q of full?.questlines ?? []) {
    if (q.status === "COMPLETE") continue;
    for (const s of parseSchedule(q.scheduleJson).slots) if (s.assetId) scheduledAssetIds.add(s.assetId);
  }
  const archive = (
    await db.asset.findMany({
      // VIDEO + IMAGE only. Articles publish through publishBlogAsset, which
      // needs a Shopify admin session for the store's Online Store blog — a
      // web-app shop has no such destination, so a scheduled article would sit
      // READY forever, retried every five minutes, never posting. Offering it
      // would be selling a button that does nothing.
      where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } },
      orderBy: { createdAt: "desc" },
      take: 120,
      select: { id: true, type: true, title: true, bodyJson: true, createdAt: true },
    })
  )
    .filter((a) => !scheduledAssetIds.has(a.id))
    .map((a) => {
      const body = (() => { try { return JSON.parse(a.bodyJson || "{}"); } catch { return {}; } })() as
        { videoUrl?: string; imageUrl?: string };
      return {
        id: a.id,
        kind: a.type === "VIDEO_AD" ? "video" : "image",
        title: a.title || "Untitled",
        media: body.imageUrl || body.videoUrl || null,
        isVideo: a.type === "VIDEO_AD",
      };
    })
    // A render whose file vanished can't be posted, so it isn't offered.
    .filter((a) => !!a.media);

  const catalog = await db.catalogProduct.findMany({
    where: { shopId: shop.id },
    orderBy: { position: "asc" },
    // CATALOG_CAP, not a hand-picked 200. The import ceiling is 300, so 200
    // silently hid products 201-300 from the campaign picker — a merchant with
    // 270 products could not feature 70 of them, with nothing saying why. The
    // Studio picker already reached past this number; the two disagreed about
    // what the merchant owned.
    take: CATALOG_CAP,
    select: { title: true, url: true, imageUrl: true },
  });

  const total = Object.values(dropMap).reduce((a, v) => a + v.video + v.image, 0);
  // When does coverage run out? The last scheduled drop across live campaigns
  // — the day after it is when the feed goes quiet, which is worth marking.
  const allDates = (full?.questlines ?? [])
    .filter((q) => q.status === "ACTIVE")
    .flatMap((q) => parseSchedule(q.scheduleJson).slots.map((sl) => sl.date));
  const lastDropDate = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : null;

  return json({
    total,
    lastDropDate,
    year,
    month0,
    todayStr,
    plans,
    campaigns,
    cast,
    catalog,
    archive,
    brandFaceId: full?.brandAvatarId && cast.some((c) => c.id === full.brandAvatarId) ? full.brandAvatarId : null,
    linked: full ? linkedFromCache(full.socialsJson) : [],
    hasPlan: !!full?.activePlan?.active,
    tokens: allowance,
    weeks: monthGrid(year, month0),
    monthLabel: `${MONTHS[month0]} ${year}`,
    todayDay,
    dropMap,
    prevYm: ymStr(month0 === 0 ? year - 1 : year, month0 === 0 ? 11 : month0 - 1),
    nextYm: ymStr(month0 === 11 ? year + 1 : year, month0 === 11 ? 0 : month0 + 1),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "launch") {
    let bag: { title: string; image: string | null; url?: string | null }[] = [];
    try { bag = JSON.parse((form.get("products") as string) || "[]"); } catch { /* empty */ }
    if (!bag.length) return json({ error: "Pick at least one product for the campaign to feature." });
    const res = await acceptQuestline({
      shopId: shop.id,
      templateKey: (form.get("plan") as string) || "",
      avatarId: ((form.get("avatarId") as string) || "").trim() || null,
      avatarVariant: 0,
      reviewMode: (form.get("reviewMode") as "REVIEW_FIRST" | "SET_AND_FORGET") || "REVIEW_FIRST",
      bag,
      platforms: (() => { try { return JSON.parse((form.get("platforms") as string) || "[]"); } catch { return []; } })(),
      // Articles can't publish from the web app — there is no Online Store
      // blog behind a web-<id>.easymode.app shop. Excluded from the schedule
      // AND from the price.
      excludeTypes: ["blog"],
    });
    return json(res.ok ? { launched: true } : { error: res.error });
  }
  if (intent === "repost") {
    let assetIds: string[] = [];
    try { assetIds = JSON.parse((form.get("assetIds") as string) || "[]"); } catch { /* empty */ }
    const { scheduleExistingAssets } = await import("../lib/questlines.server");
    const res = await scheduleExistingAssets(shop.id, {
      assetIds,
      days: parseInt((form.get("days") as string) || "30", 10),
      time: (form.get("time") as string) || "12:00",
      name: (form.get("name") as string) || "",
      platforms: (() => { try { return JSON.parse((form.get("platforms") as string) || "[]"); } catch { return []; } })(),
    });
    return res.ok
      ? json({ launched: true, reposted: res.scheduled, alreadyQueued: res.skipped, tooMany: res.tooMany })
      : json({ error: res.error });
  }
  if (intent === "pauseToggle") {
    const id = (form.get("campaignId") as string) || "";
    const q = await db.questline.findFirst({ where: { id, shopId: shop.id } });
    if (q && q.status !== "COMPLETE") {
      await db.questline.update({ where: { id }, data: { status: q.status === "ACTIVE" ? "PAUSED" : "ACTIVE" } });
    }
    return json({ ok: true });
  }
  if (intent === "stop") {
    const res = await abandonQuestline(shop.id, (form.get("campaignId") as string) || "");
    return json({ stopped: true, refunded: res.refunded });
  }
  return json({ ok: true });
};

export default function WebCampaigns() {
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [planKey, setPlanKey] = useState(d.plans[1]?.key || d.plans[0]?.key || "");
  const plan = d.plans.find((p) => p.key === planKey) || d.plans[0];
  const [avatarId, setAvatarId] = useState<string | null>(d.brandFaceId ?? d.cast[0]?.id ?? null);
  const [castQ, setCastQ] = useState("");
  const [picked, setPicked] = useState<number[]>(d.catalog.length ? [0] : []);
  const [reviewMode, setReviewMode] = useState<"REVIEW_FIRST" | "SET_AND_FORGET">("REVIEW_FIRST");
  const [showLaunch, setShowLaunch] = useState(d.campaigns.length === 0);
  // Two ways to start: pay to make a month of content, or schedule the month
  // you already made. The second costs nothing, so it leads when there's a
  // library to schedule.
  const [mode, setMode] = useState<"new" | "archive">("new");
  const [pickedAssets, setPickedAssets] = useState<string[]>([]);
  const [spreadDays, setSpreadDays] = useState(30);
  const [postTime, setPostTime] = useState("12:00");

  // The soonest unposted drop across every running campaign — the single most
  // useful fact on this page, and the one the month grid can't tell you.
  const activeCampaigns = d.campaigns.filter((c) => c.status === "ACTIVE");
  const nextUp = activeCampaigns.flatMap((c) => c.upcoming).find(Boolean);
  // Nothing running will publish itself. The poster skips a REVIEW_FIRST
  // questline outright, so "Auto-posts to …" is a claim the scheduler will
  // not honour for any of them.
  const allHeldForReview = activeCampaigns.length > 0 && activeCampaigns.every((c) => c.holdsForReview);

  const needle = castQ.trim().toLowerCase();
  const castShown = needle
    ? d.cast.filter((c) => c.name.toLowerCase().includes(needle) || c.id === avatarId)
    : d.cast;

  const cap = plan?.bagSize ?? 6;
  const toggleProduct = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length >= cap ? p : [...p, i]));

  const repost = () => {
    submit(
      {
        intent: "repost",
        assetIds: JSON.stringify(pickedAssets),
        days: String(spreadDays),
        time: postTime,
        // Deliberately NOT pinned to the accounts linked right now. Freezing
        // them meant a merchant who connected Instagram a week into a 30-day
        // campaign — the most likely next action after seeing the "Connect an
        // account" chip — got nothing there for the rest of the month, while
        // this page's own "Auto-posts to" panel listed it. Omitted, so the
        // poster uses whatever is linked at the time it publishes.
      },
      { method: "post" }
    );
  };

  const launch = () => {
    if (!plan) return;
    submit(
      {
        intent: "launch",
        plan: plan.key,
        avatarId: avatarId ?? "",
        reviewMode,
        // Deliberately NOT pinned to the accounts linked right now. Freezing
        // them meant a merchant who connected Instagram a week into a 30-day
        // campaign — the most likely next action after seeing the "Connect an
        // account" chip — got nothing there for the rest of the month, while
        // this page's own "Auto-posts to" panel listed it. Omitted, so the
        // poster uses whatever is linked at the time it publishes.
        products: JSON.stringify(picked.map((i) => d.catalog[i]).filter(Boolean).map((p) => ({ title: p.title, image: p.imageUrl, url: p.url }))),
      },
      { method: "post" }
    );
  };

  return (
    <div className="wc">
      <style dangerouslySetInnerHTML={{ __html: WC_STYLE }} />

      <div className="wc-head">
        <div>
          <h1>Campaigns</h1>
          <p>A month of content, created and posted for you. Pick a plan once — it runs itself from there.</p>
        </div>
        {d.campaigns.length > 0 && (
          <button type="button" className="wb-btn wc-newbtn" onClick={() => setShowLaunch((s) => !s)}>
            {showLaunch ? "Close" : "New campaign"}
          </button>
        )}
      </div>

      {actionData && "error" in actionData && actionData.error
        ? <div className="wb-err">{String(actionData.error)}</div> : null}
      {actionData && "launched" in actionData && actionData.launched
        ? <p className="wc-ok">
            {"reposted" in actionData && actionData.reposted
              ? `Scheduled ${actionData.reposted} post${actionData.reposted === 1 ? "" : "s"} from your Archive — no tokens spent.`
              : "Campaign is live — the first drops are being created now."}
            {/* Say what we dropped rather than silently scheduling fewer than
                the merchant picked. */}
            {"tooMany" in actionData && Number(actionData.tooMany) > 0
              ? ` One campaign holds 60 pieces, so ${Number(actionData.tooMany)} of your picks weren’t scheduled — they’re still in the Archive, ready for a second run.`
              : ""}
            {"alreadyQueued" in actionData && Number(actionData.alreadyQueued) > 0
              ? ` ${Number(actionData.alreadyQueued)} of them ${Number(actionData.alreadyQueued) === 1 ? "was" : "were"} already scheduled, so ${Number(actionData.alreadyQueued) === 1 ? "it" : "they"} won't go out twice.`
              : ""}
          </p> : null}

      {/* ---- running campaigns ---- */}
      {d.campaigns.length > 0 && (
        <section className="wc-sec">
          <div className="wc-lbl">Running</div>
          <div className="wc-cards">
            {d.campaigns.map((c) => (
              <div className={`wc-card${c.status === "PAUSED" ? " paused" : ""}`} key={c.id}>
                <div className="wc-card-top">
                  <span className="wc-card-img" style={c.image ? { backgroundImage: `url(${c.image})` } : undefined} />
                  <div className="wc-card-id">
                    <b>{c.name}</b>
                    <span>
                      {c.status === "PAUSED"
                        ? "Paused"
                        : c.next
                          ? `Next drop ${c.next}`
                          : c.overdue > 0
                            ? `${c.overdue} drop${c.overdue === 1 ? "" : "s"} still waiting`
                            : c.posted > 0
                              ? "All drops posted"
                              : "Nothing posted yet"}
                    </span>
                  </div>
                </div>
                <div className="wc-bar" role="img" aria-label={`${c.posted} of ${c.total} posted`}>
                  <span style={{ width: `${c.total ? Math.round((c.posted / c.total) * 100) : 0}%` }} />
                </div>
                <div className="wc-prog">{c.posted} of {c.total} posted</div>
                {c.upcoming.length > 0 && (
                  <ul className="wc-next">
                    {c.upcoming.map((u, i) => (
                      <li key={i}>
                        <span className={`wc-dot t-${u.type}`} />
                        <span className="wc-when">{u.when}</span>
                        <span className="wc-what">{u.product || u.type}</span>
                        <span className="wc-st">{STATUS_LABEL[u.status] || u.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="wc-card-acts">
                  <button type="button" disabled={busy}
                    onClick={() => submit({ intent: "pauseToggle", campaignId: c.id }, { method: "post" })}>
                    {c.status === "PAUSED" ? "Resume" : "Pause"}
                  </button>
                  <button type="button" className="danger" disabled={busy}
                    onClick={() => { if (confirm(`Stop "${c.name}"? Drops that haven't started yet are cancelled and refunded — anything already made is yours to keep and is not refunded.`)) submit({ intent: "stop", campaignId: c.id }, { method: "post" }); }}>
                    Stop
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- the month ---- */}
      <section className="wc-sec">
        <div className="wc-slab">
          {/* The GStyle rosettes. Two of them, counter-rotating at a crawl —
              they read as instrumentation rather than decoration, which is the
              point: this panel is a schedule, not a poster. */}
          <img className="wc-rose a" src="/gstyle-rosette-green.svg" alt="" aria-hidden="true" />
          <img className="wc-rose b" src="/gstyle-rosette.svg" alt="" aria-hidden="true" />
          <div className="wc-slab-frame" aria-hidden="true" />
          <div className="wc-slab-in">
            <div className="wc-slab-hd">
              <div className="wc-page">
                <Link className="wc-nav" to={`?ym=${d.prevYm}`} aria-label="Previous month" prefetch="intent">‹</Link>
                <span className="wc-mo">{d.monthLabel}</span>
                <Link className="wc-nav" to={`?ym=${d.nextYm}`} aria-label="Next month" prefetch="intent">›</Link>
              </div>
              <span className="wc-ct">{d.total} {d.total === 1 ? "DROP" : "DROPS"}</span>
            </div>

            <div className="wc-grid">
              {DOW.map((x, i) => <div className="wc-dow" key={i}>{x}</div>)}
              {d.weeks.flat().map((day, i) => {
                if (day === 0) return <div className="wc-dy empty" key={i} />;
                const cell = d.dropMap[day];
                const n = cell ? cell.video + cell.image : 0;
                const cellDate = `${d.year}-${pad(d.month0 + 1)}-${pad(day)}`;
                const past = cellDate < d.todayStr;
                const isToday = cellDate === d.todayStr;
                const endHere = !!d.lastDropDate && cellDate === d.lastDropDate;
                return (
                  <div
                    className={`wc-dy${n ? " drop" : ""}${past ? " past" : ""}${isToday ? " today" : ""}${endHere ? " endday" : ""}`}
                    key={i}
                    title={n ? `${day}: ${typeLines(cell!).join(" · ")}` : undefined}
                  >
                    <span className="wc-dn">{day}</span>
                    {n > 0 ? (
                      <div className="wc-types">
                        {typeLines(cell!).map((t, j) => <span className="wc-t" key={j}>{t}</span>)}
                        {endHere && <span className="wc-endtag">ENDS</span>}
                      </div>
                    ) : past ? (
                      <span className="wc-x" aria-hidden="true">✕</span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* What the app doesn't show: the very next thing that happens.
                A month grid answers "how busy", not "what's next" — and
                "what's next" is the question a merchant actually opens this
                page to ask. */}
            {nextUp && (
              <div className="wc-next-up">
                <span className="wc-pulse" aria-hidden="true" />
                <span>Next drop <b>{nextUp.when}</b>{nextUp.product ? <> · {nextUp.product}</> : null}</span>
              </div>
            )}

            <div className="wc-posts">
              <span className="wc-plabel">{allHeldForReview ? "You publish to" : "Auto-posts to"}</span>
              {d.linked.length
                ? d.linked.map((p) => <span className="wc-pchip" key={p}>{PLAT_LABEL[p] || p}</span>)
                : <Link className="wc-pchip off" to="/web/connect">Connect an account</Link>}
            </div>
            {allHeldForReview && (
              <p className="wc-hint">
                You chose to approve each drop, so nothing posts on its own — each piece lands in your{" "}
                <Link to="/web/archive">Archive</Link> and goes out when you send it.
              </p>
            )}
          </div>
        </div>
        <div className="wc-key">
          <span><i className="t-video" /> Video</span>
          <span><i className="t-image" /> Image</span>
        </div>
      </section>

      {/* ---- launch a new one ---- */}
      {showLaunch && (
        <section className="wc-sec">
          <div className="wc-lbl">Start a campaign</div>

          <div className="wc-modes">
            <button type="button" className={mode === "new" ? "sel" : ""} onClick={() => setMode("new")} aria-pressed={mode === "new"}>
              <b>Make a month of content</b>
              <span>We create everything and post it. Costs tokens.</span>
            </button>
            <button type="button" className={mode === "archive" ? "sel" : ""} onClick={() => setMode("archive")} aria-pressed={mode === "archive"}>
              <b>Schedule what I&rsquo;ve already made</b>
              <span>{d.archive.length} piece{d.archive.length === 1 ? "" : "s"} in your Archive · <em>free</em></span>
            </button>
          </div>

          {mode === "archive" ? (
            <>
              {d.archive.length === 0 ? (
                <p className="wc-hint">
                  Nothing unscheduled in your Archive yet — anything you make in the{" "}
                  <Link to="/web/studio">Studio</Link> shows up here to schedule for free.
                </p>
              ) : (
                <>
                  <div className="wc-lbl sm">
                    Pick what to post <span className="wc-cap">{pickedAssets.length} selected</span>
                    <button type="button" className="wc-selall"
                      onClick={() => setPickedAssets(pickedAssets.length === d.archive.length ? [] : d.archive.map((a) => a.id))}>
                      {pickedAssets.length === d.archive.length ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  <div className="wc-arch">
                    {d.archive.map((a) => {
                      const on = pickedAssets.includes(a.id);
                      return (
                        <button type="button" key={a.id} title={a.title}
                          className={`wc-asset${on ? " sel" : ""}`}
                          aria-pressed={on}
                          onClick={() => setPickedAssets((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))}>
                          <span className="wc-asset-img" style={a.media ? { backgroundImage: `url(${a.media})` } : undefined}>
                            {a.isVideo && <i className="wc-asset-play" aria-hidden="true">▶</i>}
                            {on && <b>✓</b>}
                          </span>
                          <span className="wc-asset-nm">{a.title}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="wc-lbl sm">Spread them over</div>
                  <div className="ws-seg">
                    {[7, 14, 30, 60].map((dd) => (
                      <button type="button" key={dd} className={spreadDays === dd ? "sel" : ""} onClick={() => setSpreadDays(dd)}>
                        {dd} days
                      </button>
                    ))}
                  </div>
                  {pickedAssets.length > 1 && (
                    <p className="wc-hint">
                      Evenly spaced — about one post every{" "}
                      {Math.max(1, Math.round(spreadDays / (pickedAssets.length - 1)))} day
                      {Math.max(1, Math.round(spreadDays / (pickedAssets.length - 1))) === 1 ? "" : "s"}, at{" "}
                      <input className="wc-time" type="time" value={postTime} onChange={(e) => setPostTime(e.target.value || "12:00")} aria-label="Post time" />.
                    </p>
                  )}
                  <p className="wc-hint">
                    {d.linked.length
                      ? `Posting to ${d.linked.join(", ")}.`
                      : <>No accounts connected — <Link to="/web/connect">connect auto-posting</Link> first, or these will sit waiting.</>}
                  </p>
                  <button type="button" className="wb-btn wc-go" disabled={busy || pickedAssets.length === 0} onClick={repost}>
                    {busy ? "Scheduling…" : `Schedule ${pickedAssets.length || ""} post${pickedAssets.length === 1 ? "" : "s"} — free`}
                  </button>
                </>
              )}
            </>
          ) : (
          <>
          <div className="wc-plans">
            {d.plans.map((p) => (
              <button type="button" key={p.key} className={`wc-plan${p.key === planKey ? " sel" : ""}${p.videoLocked ? " locked" : ""}`}
                onClick={() => setPlanKey(p.key)} aria-pressed={p.key === planKey}>
                <span className="wc-plan-top">
                  <span className="wc-plan-ic" aria-hidden="true">{p.icon}</span>
                  <span className="wc-badge">{p.badge}</span>
                </span>
                <b>{p.name}</b>
                <span className="wc-plan-mix">
                  {p.mix.video > 0 && <em>{p.mix.video} video</em>}
                  {p.mix.image > 0 && <em>{p.mix.image} image</em>}
                </span>
                <span className="wc-plan-pitch">{p.pitch}</span>
                <span className="wc-plan-foot">
                  <span>{p.drops} drops · {p.cadence}</span>
                  <span className={p.videoLocked ? "bad" : p.affordable ? "ok" : "warn"}>
                    {p.videoLocked
                      ? "Video unlocks on the Studio plan"
                      : p.affordable
                        ? `${p.cost.toLocaleString("en-US")} of your ${d.tokens.toLocaleString("en-US")} tokens`
                        : `${p.cost.toLocaleString("en-US")} tokens — top up to run this`}
                  </span>
                </span>
                <span className="wc-worth">{p.worth}</span>
              </button>
            ))}
          </div>

          {/* presenter */}
          <div className="wc-lbl sm">Who stars in it</div>
          <div className="ws-castsearch">
            <input className="wb-in" type="search" value={castQ} placeholder={`Search ${d.cast.length} presenters by name…`}
              onChange={(e) => setCastQ(e.target.value)} aria-label="Search presenters by name" />
            {needle && <button type="button" className="ws-cs-clr" onClick={() => setCastQ("")} aria-label="Clear search">✕</button>}
          </div>
          {needle && castShown.length === 0 && <p className="wc-hint">No presenter called “{castQ.trim()}”.</p>}
          <div className="wc-cast">
            {castShown.map((c) => (
              <button type="button" key={c.id} className={`wc-face${avatarId === c.id ? " sel" : ""}`}
                onClick={() => setAvatarId(c.id)} aria-pressed={avatarId === c.id}>
                <span className="wc-face-img" style={{ backgroundImage: `url(${c.img})` }}>{avatarId === c.id && <b>✓</b>}</span>
                <span>{c.id === d.brandFaceId ? "★ Brand face" : c.name}</span>
              </button>
            ))}
          </div>

          {/* products */}
          <div className="wc-lbl sm">What it features <span className="wc-cap">{picked.length} of {cap}</span></div>
          {d.catalog.length === 0 ? (
            <p className="wc-hint">
              No products imported yet — <Link to="/web/studio?tab=import">pull your store in</Link> and they will appear here.
            </p>
          ) : (
            <div className="wc-prods">
              {d.catalog.map((p, i) => (
                <button type="button" key={i} title={p.title}
                  className={`wc-prod${picked.includes(i) ? " sel" : ""}`}
                  onClick={() => toggleProduct(i)} aria-pressed={picked.includes(i)}>
                  <span className="wc-prod-img" style={p.imageUrl ? { backgroundImage: `url(${p.imageUrl})` } : undefined}>
                    {picked.includes(i) && <b>✓</b>}
                  </span>
                  <span className="wc-prod-nm">{p.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* review mode */}
          <div className="wc-lbl sm">Before it posts</div>
          <div className="ws-seg">
            <button type="button" className={reviewMode === "REVIEW_FIRST" ? "sel" : ""} onClick={() => setReviewMode("REVIEW_FIRST")}>
              Let me approve each drop
            </button>
            <button type="button" className={reviewMode === "SET_AND_FORGET" ? "sel" : ""} onClick={() => setReviewMode("SET_AND_FORGET")}>
              Post automatically
            </button>
          </div>
          <p className="wc-hint">
            {d.linked.length
              ? `Posting to ${d.linked.join(", ")}.`
              : <>No accounts connected yet — drops will be saved to your Archive. <Link to="/web/connect">Connect auto-posting</Link>.</>}
          </p>

          <button type="button" className="wb-btn wc-go" disabled={busy || !picked.length || !plan || plan.videoLocked} onClick={launch}>
            {busy ? "Starting…" : `Start ${plan?.name || "campaign"}`}
          </button>
          </>
          )}
        </section>
      )}
    </div>
  );
}

const WC_STYLE = `
.wc{max-width:1080px;margin:0 auto;padding:4px 0 40px}
.wc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.wc-head h1{font-family:Poppins,sans-serif;font-size:26px;font-weight:800;margin:0 0 4px;color:var(--ink,#14201A)}
.wc-head p{margin:0;font-size:13.5px;color:var(--ink2,#4A554E);max-width:56ch}
.wc-newbtn{flex:0 0 auto;padding:9px 18px;font-size:13px}
.wc-ok{margin:0 0 14px;padding:10px 14px;border-radius:12px;background:#F0FAF4;border:1px solid #12A85E;color:#0C7A46;font-size:13.5px;font-weight:600}
.wc-sec{margin:0 0 30px}
.wc-lbl{font-family:Poppins,sans-serif;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2,#4A554E);margin:0 0 10px}
.wc-lbl.sm{margin-top:22px}
.wc-lblrow{display:flex;align-items:center;justify-content:space-between}
.wc-cap{font-weight:600;letter-spacing:0;text-transform:none;color:var(--ink3,#8A938D)}
.wc-hint{font-size:12.5px;color:var(--ink2,#4A554E);margin:8px 0 0}

/* running campaigns */
.wc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.wc-card{border:1px solid var(--line,#E4DFCF);border-radius:16px;background:var(--card,#FDFCF7);padding:14px}
.wc-card.paused{opacity:.72}
.wc-card-top{display:flex;gap:11px;align-items:center;margin-bottom:11px}
.wc-card-img{flex:0 0 auto;width:42px;height:42px;border-radius:10px;background:var(--paper,#F4F1E6) center/cover no-repeat;border:1px solid var(--line,#E4DFCF)}
.wc-card-id b{display:block;font-size:14px;color:var(--ink,#14201A)}
.wc-card-id span{display:block;font-size:12px;color:var(--ink2,#4A554E);margin-top:2px}
.wc-bar{height:5px;border-radius:999px;background:var(--paper,#F4F1E6);overflow:hidden}
.wc-bar span{display:block;height:100%;background:#12A85E;border-radius:999px}
.wc-prog{font-size:11.5px;color:var(--ink2,#4A554E);margin:5px 0 0;font-variant-numeric:tabular-nums}
.wc-next{list-style:none;margin:11px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}
.wc-next li{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--ink2,#4A554E)}
.wc-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%}
.wc-when{flex:0 0 auto;font-variant-numeric:tabular-nums;color:var(--ink,#14201A);font-weight:600}
.wc-what{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-st{flex:0 0 auto;font-size:10.5px;color:var(--ink3,#8A938D)}
.wc-card-acts{display:flex;gap:8px;margin-top:13px}
.wc-card-acts button{flex:1;padding:7px 10px;border-radius:10px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink,#14201A);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
.wc-card-acts button:hover{border-color:#12A85E}
.wc-card-acts button.danger{color:#A33232}
.wc-card-acts button.danger:hover{border-color:#A33232}

/* THE MONTH SLAB.
   The embedded app renders this on a dark slab and it is the best-looking
   surface in the product, so the web app matches its structure rather than
   inventing a lesser one — then goes past it: counter-rotating GStyle
   rosettes instead of a static texture, a live next-drop line the app has no
   equivalent for, and day cells that name what lands instead of dotting it. */
.wc-slab{position:relative;border-radius:24px;overflow:hidden;padding:20px 14px 18px;background:#060B08;
  box-shadow:0 26px 64px rgba(6,20,12,.4),0 4px 14px rgba(0,0,0,.3)}
.wc-rose{position:absolute;pointer-events:none;opacity:.16;filter:saturate(1.2)}
.wc-rose.a{width:420px;top:-150px;right:-140px;animation:wcspin 150s linear infinite}
.wc-rose.b{width:320px;bottom:-130px;left:-110px;opacity:.09;animation:wcspin 210s linear infinite reverse}
@keyframes wcspin{to{transform:rotate(360deg)}}
.wc-slab-frame{position:absolute;inset:9px;border-radius:17px;border:1px solid rgba(231,200,121,.22);pointer-events:none}
.wc-slab-in{position:relative;z-index:1}
.wc-slab-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 6px 14px}
.wc-page{display:flex;align-items:center;gap:10px}
.wc-nav{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;text-decoration:none;
  border:1px solid rgba(231,200,121,.3);color:#E7C879;font-size:16px;line-height:1}
.wc-nav:hover,.wc-nav:focus-visible{background:rgba(231,200,121,.12);color:#F6E4AE}
.wc-mo{font-family:Poppins,sans-serif;font-size:14.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#F3F1E6}
.wc-ct{font-family:Poppins,sans-serif;font-size:11px;font-weight:800;letter-spacing:.12em;color:#E7C879;
  border:1px solid rgba(231,200,121,.3);border-radius:999px;padding:3px 10px;white-space:nowrap}
.wc-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.wc-dow{text-align:center;font-size:10px;font-weight:800;letter-spacing:.08em;color:rgba(243,241,230,.42);padding-bottom:4px}
.wc-dy{position:relative;min-height:62px;border-radius:11px;padding:5px 4px;
  border:1px solid rgba(243,241,230,.10);background:rgba(243,241,230,.035);
  display:flex;flex-direction:column;gap:3px;overflow:hidden}
.wc-dy.empty{border-color:transparent;background:none}
.wc-dn{font-size:10.5px;font-weight:700;color:rgba(243,241,230,.5);font-variant-numeric:tabular-nums;line-height:1}
.wc-dy.drop{border-color:rgba(18,168,94,.5);background:linear-gradient(180deg,rgba(18,168,94,.18),rgba(18,168,94,.06))}
.wc-dy.drop .wc-dn{color:#EAF7EF}
.wc-dy.today{border-color:#E7C879;box-shadow:0 0 0 1px #E7C879,0 0 18px rgba(231,200,121,.25)}
.wc-dy.past{opacity:.42}
.wc-dy.endday{border-color:rgba(231,200,121,.6)}
.wc-types{display:flex;flex-direction:column;gap:2px}
.wc-t{font-size:9.5px;font-weight:700;letter-spacing:.02em;color:#CFEBD9;background:rgba(18,168,94,.28);
  border-radius:5px;padding:1px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-endtag{font-size:8.5px;font-weight:800;letter-spacing:.08em;color:#0A0F0C;background:#E7C879;border-radius:4px;padding:1px 4px}
.wc-x{font-size:11px;color:rgba(243,241,230,.2);margin-top:auto;align-self:center}
/* The line the app doesn't have. */
.wc-next-up{display:flex;align-items:center;gap:9px;margin:14px 6px 0;padding:9px 12px;border-radius:12px;
  background:rgba(18,168,94,.12);border:1px solid rgba(18,168,94,.32);font-size:12.5px;color:#DCEFE3}
.wc-next-up b{color:#fff}
.wc-pulse{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:#12A85E;box-shadow:0 0 0 0 rgba(18,168,94,.7);animation:wcpulse 2.2s ease-out infinite}
@keyframes wcpulse{70%{box-shadow:0 0 0 9px rgba(18,168,94,0)}100%{box-shadow:0 0 0 0 rgba(18,168,94,0)}}
.wc-posts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 6px 0}
.wc-plabel{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:rgba(243,241,230,.45)}
.wc-pchip{font-size:11px;font-weight:700;color:#F3F1E6;background:rgba(243,241,230,.09);
  border:1px solid rgba(243,241,230,.16);border-radius:999px;padding:3px 10px;text-decoration:none}
.wc-pchip.off{color:#E7C879;border-color:rgba(231,200,121,.4)}
.wc-key{display:flex;gap:14px;margin-top:11px;font-size:11.5px;color:var(--ink2,#4A554E)}
.wc-key i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}
.t-video{background:#12A85E}.t-image{background:#B08526}
/* legacy campaigns may still carry article slots in their upcoming list */
.t-blog{background:#3B7EA1}
@media (prefers-reduced-motion:reduce){
  .wc-rose,.wc-pulse{animation:none}
}

/* plan picker */
.wc-plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.wc-plan{display:flex;flex-direction:column;gap:7px;text-align:left;padding:14px;border-radius:16px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);cursor:pointer;font:inherit;color:var(--ink,#14201A)}
.wc-plan.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E;background:#F7FCF9}
.wc-plan.locked{opacity:.72}
.wc-plan-top{display:flex;align-items:center;justify-content:space-between}
.wc-plan-ic{font-size:20px}
.wc-badge{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7E5E13;background:#FFFBEF;border:1px solid #E7C879;border-radius:999px;padding:2px 8px}
.wc-plan b{font-family:Poppins,sans-serif;font-size:15px}
.wc-plan-mix{display:flex;flex-wrap:wrap;gap:5px}
.wc-plan-mix em{font-style:normal;font-size:11px;font-weight:700;color:var(--ink2,#4A554E);background:var(--paper,#F4F1E6);border-radius:999px;padding:2px 8px}
.wc-plan-pitch{font-size:12.5px;color:var(--ink2,#4A554E);line-height:1.5}
.wc-plan-foot{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--ink2,#4A554E);margin-top:2px}
.wc-plan-foot .ok{color:#0C7A46;font-weight:700}
.wc-plan-foot .warn{color:#7E5E13;font-weight:700}
.wc-plan-foot .bad{color:#A33232;font-weight:700}
.wc-worth{font-size:11px;color:var(--ink3,#8A938D);border-top:1px solid var(--line,#E4DFCF);padding-top:7px}

/* cast + products */
.wc-cast{display:flex;gap:11px;overflow-x:auto;padding:2px 2px 8px}
.wc-face{flex:0 0 auto;width:66px;border:0;background:none;padding:0;cursor:pointer;font:inherit;text-align:center;color:var(--ink,#14201A)}
.wc-face-img{position:relative;display:block;width:66px;height:88px;border-radius:11px;background:var(--paper,#F4F1E6) center/cover no-repeat;border:1px solid var(--line,#E4DFCF)}
.wc-face.sel .wc-face-img{border-color:#12A85E;box-shadow:0 0 0 2px rgba(18,168,94,.35)}
.wc-face-img b{position:absolute;inset:auto 4px 4px auto;width:18px;height:18px;border-radius:50%;background:#12A85E;color:#fff;font-size:11px;display:grid;place-items:center}
.wc-face span{display:block;font-size:11px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-prods{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:11px;max-height:300px;overflow-y:auto;padding:2px}
.wc-prod{border:0;background:none;padding:0;cursor:pointer;font:inherit;text-align:center;color:var(--ink,#14201A)}
.wc-prod-img{position:relative;display:block;width:100%;aspect-ratio:1;border-radius:11px;background:var(--paper,#F4F1E6) center/cover no-repeat;border:1px solid var(--line,#E4DFCF)}
.wc-prod.sel .wc-prod-img{border-color:#12A85E;box-shadow:0 0 0 2px rgba(18,168,94,.35)}
.wc-prod-img b{position:absolute;inset:auto 4px 4px auto;width:18px;height:18px;border-radius:50%;background:#12A85E;color:#fff;font-size:11px;display:grid;place-items:center}
.wc-prod-nm{display:block;font-size:11px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-go{margin-top:18px;padding:12px 26px;font-size:14px}
/* Two ways in: pay to make a month, or schedule the month you already made. */
.wc-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:11px;margin-bottom:20px}
.wc-modes button{text-align:left;padding:13px 15px;border-radius:14px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);cursor:pointer;font:inherit;color:var(--ink,#14201A)}
.wc-modes button.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E;background:#F7FCF9}
.wc-modes b{display:block;font-family:Poppins,sans-serif;font-size:14px}
.wc-modes span{display:block;font-size:12.5px;color:var(--ink2,#4A554E);margin-top:3px}
.wc-modes em{font-style:normal;font-weight:800;color:#0C7A46}
.wc-selall{margin-left:auto;border:0;background:none;color:#0C7A46;font:inherit;font-size:11.5px;font-weight:800;letter-spacing:0;text-transform:none;cursor:pointer;padding:0}
.wc-lbl.sm{display:flex;align-items:center;gap:8px}
.wc-arch{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:11px;max-height:340px;overflow-y:auto;padding:2px}
.wc-asset{border:0;background:none;padding:0;cursor:pointer;font:inherit;text-align:center;color:var(--ink,#14201A)}
.wc-asset-img{position:relative;display:block;width:100%;aspect-ratio:3/4;border-radius:11px;background:var(--paper,#F4F1E6) center/cover no-repeat;border:1px solid var(--line,#E4DFCF);overflow:hidden}
.wc-asset.sel .wc-asset-img{border-color:#12A85E;box-shadow:0 0 0 2px rgba(18,168,94,.35)}
.wc-asset-img b{position:absolute;inset:auto 4px 4px auto;width:18px;height:18px;border-radius:50%;background:#12A85E;color:#fff;font-size:11px;display:grid;place-items:center;font-style:normal}
.wc-asset-play{position:absolute;inset:0;display:grid;place-items:center;font-size:20px;font-style:normal;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.6)}
.wc-asset-nm{display:block;font-size:11px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-time{font:inherit;font-size:12.5px;padding:2px 6px;border-radius:8px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink,#14201A)}

@media (max-width:640px){
  .wc-head h1{font-size:22px}
  .wc-slab{padding:16px 10px 14px;border-radius:20px}
  .wc-grid{gap:3px}
  .wc-dy{min-height:52px;border-radius:8px;padding:4px 3px}
  .wc-t{font-size:8.5px;padding:1px 3px}
  .wc-rose.a{width:280px;top:-100px;right:-90px}
  .wc-rose.b{width:220px;bottom:-90px;left:-70px}
}
`;
