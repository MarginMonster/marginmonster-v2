import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, useNavigate, Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { parseSchedule } from "../lib/questlines";
import { linkedFromCache } from "../lib/social-provider.server";
import { tokensRemaining } from "../lib/tokens.server";
import { acceptQuestline, rescheduleSlot, abandonQuestline, swapQuestlineItem, addDrop } from "../lib/questlines.server";

const SHORT: Record<string, "tt" | "ig" | "fb"> = { tiktok: "tt", instagram: "ig", facebook: "fb" };
const QUOTES = [
  "While they scroll, you sell.",
  "Every post is a salesperson that never sleeps.",
  "Consistency is the cheat code.",
  "The feed rewards the relentless.",
  "Fortune favors the brand that shows up.",
  "Build the empire one drop at a time.",
  "Your competition is posting. Are you?",
  "Attention is the new currency — go take yours.",
  "Show up daily. Get paid quietly.",
  "Small drops, tidal waves.",
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
function fmtNext(dateStr: string, timeStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  const h = parseInt((timeStr || "12:00").slice(0, 2), 10);
  const mm = (timeStr || "12:00").slice(3, 5);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const t = mm === "00" ? `${h12}${ap}` : `${h12}:${mm}${ap}`;
  return `${MON[(m || 1) - 1]} ${d} · ${t}`;
}
function fmtTime(timeStr: string): string {
  const h = parseInt((timeStr || "12:00").slice(0, 2), 10);
  const mm = (timeStr || "12:00").slice(3, 5);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm === "00" ? `${h12}${ap}` : `${h12}:${mm}${ap}`;
}

type DropInfo = { qid: string; name: string; slotIdx: number; type: "video" | "image" | "blog"; product: string; time: string; status: string };
type ActiveCampaign = { id: string; name: string; createdDate: string; durationDays: number };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, questlines: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  const linked = shop ? linkedFromCache(shop.socialsJson).filter((p) => p in SHORT) : [];
  const platforms = linked.length ? linked : ["tiktok", "instagram", "facebook"];
  const platShorts = platforms.map((p) => SHORT[p]);

  const url = new URL(request.url);
  const now = new Date();
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth();
  let year = curY;
  let month0 = curM;
  const ymMatch = /^(\d{4})-(\d{2})$/.exec(url.searchParams.get("ym") || "");
  if (ymMatch) {
    const yy = parseInt(ymMatch[1], 10);
    const mm = parseInt(ymMatch[2], 10) - 1;
    if (yy >= 2000 && yy <= 2100 && mm >= 0 && mm <= 11) { year = yy; month0 = mm; }
  }
  const todayDay = curY === year && curM === month0 ? now.getUTCDate() : 0;
  const ymStr = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;
  const prevYm = ymStr(month0 === 0 ? year - 1 : year, month0 === 0 ? 11 : month0 - 1);
  const nextYm = ymStr(month0 === 11 ? year + 1 : year, month0 === 11 ? 0 : month0 + 1);
  const openParam = url.searchParams.get("open") || "";
  const openDay = /^\d{1,2}$/.test(openParam) ? Math.min(31, Math.max(1, parseInt(openParam, 10))) : null;

  const dropMap: Record<number, { video: number; image: number; blog: number }> = {};
  const dayDrops: Record<number, DropInfo[]> = {};
  const activeCampaigns: ActiveCampaign[] = [];
  const campaigns: {
    id: string; name: string; image: string | null; status: string;
    made: number; total: number; platforms: ("tt" | "ig" | "fb")[]; next: string | null;
    drops: { when: string; date: string; type: string; product: string; status: string }[];
  }[] = [];

  const todayStr = now.toISOString().slice(0, 10);
  for (const q of shop?.questlines ?? []) {
    if (q.status === "COMPLETE") continue;
    const slots = parseSchedule(q.scheduleJson).slots;
    let made = 0;
    let next: { date: string; time: string } | null = null;
    for (const s of slots) {
      if (s.status === "POSTED") made++;
      const [y, m, d] = s.date.split("-").map(Number);
      if (y === year && m - 1 === month0 && (s.type === "video" || s.type === "image" || s.type === "blog")) {
        const cell = (dropMap[d] = dropMap[d] || { video: 0, image: 0, blog: 0 });
        cell[s.type]++;
        (dayDrops[d] = dayDrops[d] || []).push({ qid: q.id, name: q.name, slotIdx: s.idx, type: s.type, product: s.productTitle || "", time: s.time, status: s.status });
      }
      if ((s.status === "SCHEDULED" || s.status === "READY" || s.status === "FORGING") && s.date >= todayStr) {
        if (!next || s.date < next.date || (s.date === next.date && s.time < next.time)) next = { date: s.date, time: s.time };
      }
    }
    if (q.status !== "PAUSED") {
      activeCampaigns.push({ id: q.id, name: q.name, createdDate: q.createdAt.toISOString().slice(0, 10), durationDays: q.durationDays || 30 });
    }
    const drops = slots
      .filter((s) => s.type === "video" || s.type === "image" || s.type === "blog")
      .slice()
      .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))
      .map((s) => ({ when: fmtNext(s.date, s.time), date: s.date, type: s.type, product: s.productTitle || "", status: s.status }));
    campaigns.push({
      id: q.id, name: q.name, image: q.productImageUrl, status: q.status,
      made, total: slots.length, platforms: platShorts,
      next: next ? fmtNext(next.date, next.time) : null,
      drops,
    });
  }

  const total = Object.values(dropMap).reduce((a, v) => a + v.video + v.image + v.blog, 0);

  // When does coverage end? The last drop date across active (running) plans —
  // days after it are "no plan" gaps that nudge a new Social Media Plan.
  const activeDates = campaigns.filter((c) => c.status === "ACTIVE").flatMap((c) => c.drops.map((d) => d.date));
  const lastDropDate = activeDates.length ? activeDates.reduce((a, b) => (a > b ? a : b)) : null;

  return json({
    hasPlan: !!shop?.activePlan,
    tokens: shop?.activePlan ? tokensRemaining(shop.activePlan) : 0,
    lastDropDate,
    platforms: platShorts,
    weeks: monthGrid(year, month0),
    monthLabel: `${MONTHS[month0]} ${year}`.toUpperCase(),
    year, month0, todayDay, todayStr,
    prevYm, nextYm,
    openDay,
    quote: QUOTES[now.getUTCDate() % QUOTES.length],
    dropMap,
    dayDrops,
    activeCampaigns,
    total,
    campaigns,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ error: "Shop not found" });

  if (intent === "accept") {
    let bag: { title: string; image: string | null; url?: string | null }[] = [];
    try { bag = JSON.parse((form.get("bag") as string) || "[]"); } catch { /* empty */ }
    const res = await acceptQuestline({
      shopId: shop.id,
      templateKey: (form.get("template") as string) || "",
      avatarId: ((form.get("avatarId") as string) || "").trim() || null,
      avatarVariant: parseInt((form.get("avatarVariant") as string) || "0", 10) || 0,
      reviewMode: (form.get("reviewMode") as "REVIEW_FIRST" | "SET_AND_FORGET") || "REVIEW_FIRST",
      bag,
    });
    return json(res.ok ? { accepted: true } : { error: res.error });
  }
  if (intent === "reschedule") {
    const res = await rescheduleSlot(shop.id, (form.get("questlineId") as string) || "", parseInt((form.get("slotIdx") as string) || "-1", 10), (form.get("date") as string) || "", (form.get("time") as string) || "");
    return json(res.ok ? { rescheduled: true } : { error: res.error });
  }
  if (intent === "swapItem") {
    const res = await swapQuestlineItem(shop.id, (form.get("questlineId") as string) || "", (form.get("fromTitle") as string) || "", { title: (form.get("toTitle") as string) || "", image: ((form.get("toImage") as string) || "").trim() || null });
    return json(res.ok ? { swapped: res.swapped } : { error: res.error });
  }
  if (intent === "addDrop") {
    const res = await addDrop(shop.id, (form.get("questlineId") as string) || "", parseInt((form.get("day") as string) || "0", 10), ((form.get("dropType") as string) || "video") as "video" | "image" | "blog", { instant: form.get("instant") === "1", productTitle: ((form.get("dropProduct") as string) || "").trim() || undefined, direction: ((form.get("dropTopic") as string) || "").trim() || undefined, time: ((form.get("dropTime") as string) || "").trim() || undefined });
    return json(res.ok ? { dropAdded: res.cost, instant: form.get("instant") === "1" } : { error: res.error });
  }
  if (intent === "pauseToggle") {
    const id = (form.get("questlineId") as string) || "";
    const q = await db.questline.findFirst({ where: { id, shopId: shop.id } });
    if (q && q.status !== "COMPLETE") await db.questline.update({ where: { id }, data: { status: q.status === "ACTIVE" ? "PAUSED" : "ACTIVE" } });
    return json({ ok: true });
  }
  if (intent === "delete") {
    const res = await abandonQuestline(shop.id, (form.get("questlineId") as string) || "");
    return json({ ok: true, refunded: res.refunded });
  }
  return json({ ok: true });
};

// ── platform glyphs ─────────────────────────────────────────────────────────
const TT = () => <svg viewBox="0 0 24 24"><path d="M16.5 3c.35 2.34 1.68 3.9 3.9 4.12v2.86c-1.3.08-2.53-.28-3.68-.98v5.9c0 3.5-2.48 6-5.86 6C7.6 20.9 5.3 18.7 5.3 15.6c0-3.02 2.4-5.3 5.5-5.3.34 0 .67.03 1 .09v2.94c-.32-.1-.65-.15-1-.15-1.42 0-2.5 1.05-2.5 2.44 0 1.42 1.1 2.46 2.55 2.46 1.53 0 2.6-1.13 2.6-2.98V3h3.05z" fill="#111" /></svg>;
const IG = () => <svg viewBox="0 0 24 24" fill="none" stroke="#E1306C" strokeWidth="2"><rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" /><circle cx="12" cy="12" r="4.1" /><circle cx="17.4" cy="6.6" r="1.2" fill="#E1306C" stroke="none" /></svg>;
const FB = () => <svg viewBox="0 0 24 24"><path d="M13.8 21v-8h2.6l.42-3.1h-3.02V7.9c0-.9.26-1.5 1.56-1.5h1.66V3.62c-.29-.04-1.27-.12-2.42-.12-2.4 0-4.04 1.46-4.04 4.15V9.9H8.1v3.1h2.44V21h3.26z" fill="#1877F2" /></svg>;
const GLYPH = { tt: TT, ig: IG, fb: FB } as const;
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const TYPE_LABEL: Record<string, string> = { video: "Video", image: "Image", blog: "Blog" };
const STATUS_LABEL: Record<string, string> = { SCHEDULED: "Scheduled", FORGING: "Creating", READY: "Ready", POSTED: "Posted", FAILED: "Retry needed" };
const TYPE_COST: Record<string, number> = { video: 60, image: 5, blog: 10 };

function typeLines(day: { video: number; image: number; blog: number }): string[] {
  const out: string[] = [];
  if (day.video) out.push(`${day.video > 1 ? day.video + " " : ""}Video`);
  if (day.image) out.push(`${day.image > 1 ? day.image + " " : ""}Image`);
  if (day.blog) out.push(`${day.blog > 1 ? day.blog + " " : ""}Blog`);
  return out;
}
const pad = (n: number) => String(n).padStart(2, "0");

export default function Campaigns() {
  const { hasPlan, tokens, lastDropDate, platforms, weeks, monthLabel, year, month0, todayDay, todayStr, prevYm, nextYm, openDay, quote, dropMap, dayDrops, activeCampaigns, total, campaigns } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [open, setOpen] = useState<number | null>(openDay); // selected day-of-month
  const [openCamp, setOpenCamp] = useState<string | null>(null); // expanded campaign
  const [schedType, setSchedType] = useState<"video" | "image" | "blog">("video");
  const [schedCid, setSchedCid] = useState<string>(activeCampaigns[0]?.id ?? "");
  const [schedTopic, setSchedTopic] = useState("");
  const [schedTime, setSchedTime] = useState("12:00");

  // Close the sheet after a successful mutation.
  useEffect(() => {
    if (!actionData) return;
    if ("rescheduled" in actionData || "dropAdded" in actionData) setOpen(null);
  }, [actionData]);
  // Deep-link / tap-a-schedule-row → open that day (openDay comes from the URL).
  useEffect(() => { setOpen(openDay); }, [openDay]);

  const err = actionData && "error" in actionData ? (actionData as { error: string }).error : null;
  const drops = open != null ? dayDrops[open] || [] : [];
  const monthName = MONTHS[month0];
  const openDate = open != null ? `${year}-${pad(month0 + 1)}-${pad(open)}` : null;
  const isPast = openDate != null && !!todayStr && openDate < todayStr;
  const openEnd = openDate != null && openDate === lastDropDate;
  const openNoPlan = openDate != null && !!lastDropDate && openDate > lastDropDate && drops.length === 0;
  const fmtDay = (ds: string) => { const [, m, d] = ds.split("-").map(Number); return `${MON[m - 1]} ${d}`; };

  // Jump to a specific drop's day (may live in another month → navigate there).
  const goToDrop = (dateStr: string) => {
    const [y, m, dd] = dateStr.split("-").map(Number);
    if (y === year && m - 1 === month0) setOpen(dd);
    else navigate(`?ym=${y}-${pad(m)}&open=${dd}`);
  };

  const reschedule = (qid: string, slotIdx: number, date: string, time: string) =>
    submit({ intent: "reschedule", questlineId: qid, slotIdx: String(slotIdx), date, time }, { method: "post" });

  const scheduleDrop = () => {
    if (open == null || !schedCid) return;
    const camp = activeCampaigns.find((c) => c.id === schedCid);
    if (!camp) return;
    const target = `${year}-${pad(month0 + 1)}-${pad(open)}`;
    const dayDiff = Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${camp.createdDate}T00:00:00Z`)) / 86400000);
    const campaignDay = dayDiff + 1;
    submit({ intent: "addDrop", questlineId: schedCid, day: String(campaignDay), dropType: schedType, dropTopic: schedTopic.trim(), dropTime: schedTime }, { method: "post" });
  };

  return (
    <Page>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <filter id="mm-obs">
            <feTurbulence type="fractalNoise" baseFrequency="0.006 0.018" numOctaves="6" seed="3" result="n" />
            <feSpecularLighting in="n" surfaceScale="4" specularConstant="0.9" specularExponent="16" lightingColor="#2b6b4a" result="s"><feDistantLight azimuth="215" elevation="50" /></feSpecularLighting>
            <feComposite in="s" in2="SourceGraphic" operator="over" />
          </filter>
        </defs>
      </svg>

      <div className="dcal">
        <span className="dc-ey">Automated Marketing</span>
        <h1 className="dc-h1">Your drop calendar</h1>
        <p className="dc-sub">Cut from obsidian, lit in gold — tap any day to see or schedule drops.</p>

        <Link className="dc-new" to="/app/campaigns/new">＋ New campaign</Link>

        <div className="dc-slab">
          <div className="dc-bg"><svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" viewBox="0 0 460 560"><rect width="460" height="560" fill="#060b08" /><rect width="460" height="560" filter="url(#mm-obs)" /></svg></div>
          <div className="dc-frame" />
          <div className="dc-inner">
            <div className="dc-hd">
              <div className="dc-page">
                <Link className="dc-nav" to={`?ym=${prevYm}`} aria-label="Previous month" prefetch="intent">‹</Link>
                <span className="dc-mo">{monthLabel}</span>
                <Link className="dc-nav" to={`?ym=${nextYm}`} aria-label="Next month" prefetch="intent">›</Link>
              </div>
              <span className="dc-ct">{total} DROPS</span>
            </div>
            <div className="dc-grid">
              {DOW.map((x, i) => <div className="dc-dow" key={i}>{x}</div>)}
              {weeks.flat().map((d, i) => {
                if (d === 0) return <div className="dc-dy empty" key={i} />;
                const day = dropMap[d];
                const isDrop = !!day && (day.video + day.image + day.blog > 0);
                const cellDate = `${year}-${pad(month0 + 1)}-${pad(d)}`;
                const past = !!todayStr && cellDate < todayStr;
                const isToday = cellDate === todayStr;
                const endHere = !!lastDropDate && cellDate === lastDropDate;
                const noPlan = !!lastDropDate && !past && !isDrop && cellDate > lastDropDate;
                const canSchedule = !past && !noPlan && activeCampaigns.length > 0;
                const clickable = isDrop || canSchedule || noPlan;
                return (
                  <button
                    type="button"
                    className={`dc-dy${isDrop ? " drop" : ""}${past ? " past" : ""}${noPlan ? " noplan" : ""}${endHere ? " endday" : ""}${clickable ? " tap" : ""}${isToday ? " today" : ""}`}
                    key={i}
                    disabled={!clickable}
                    onClick={() => clickable && setOpen(d)}
                  >
                    <span className="dc-dn">{d}</span>
                    {isDrop ? (
                      <div className="dc-types">
                        {typeLines(day).map((t, j) => <span className="dc-t" key={j}>{t}</span>)}
                        {endHere && <span className="dc-endtag">ENDS</span>}
                      </div>
                    ) : past ? (
                      <span className="dc-x">✕</span>
                    ) : noPlan ? (
                      <span className="dc-noplan">＋ Plan</span>
                    ) : canSchedule ? (
                      <span className="dc-plus">＋</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="dc-posts">
              <span className="dc-plabel">Auto-posts to</span>
              {platforms.map((p) => { const G = GLYPH[p]; return <span className="dc-pchip" key={p}><G /></span>; })}
            </div>
          </div>
        </div>

        <div className="dc-quote"><span className="dc-qmark">“</span>{quote}<span className="dc-qmark r">”</span></div>

        {campaigns.length > 0 ? (
          <>
            <div className="dc-sec">Active campaigns</div>
            {campaigns.map((c) => {
              const pct = c.total > 0 ? Math.round((c.made / c.total) * 100) : 0;
              const live = c.status === "ACTIVE";
              const expanded = openCamp === c.id;
              return (
                <div className={`dc-camp${expanded ? " open" : ""}`} key={c.id}>
                  <button type="button" className="dc-chead" onClick={() => setOpenCamp(expanded ? null : c.id)} aria-expanded={expanded}>
                    <div className="dc-thumb" style={c.image ? { backgroundImage: `url(${c.image})` } : undefined} />
                    <div className="dc-cbody">
                      <div className="dc-ctop"><b>{c.name}</b><span className={`dc-cstat ${live ? "on" : "off"}`}>{live ? "LIVE" : "PAUSED"}</span></div>
                      <div className="dc-cmeta">
                        {c.platforms.map((p) => { const G = GLYPH[p]; return <span className="dc-cchip" key={p}><G /></span>; })}
                        {c.next && <span className="dc-cnext">Next drop {c.next}</span>}
                      </div>
                      <div className="dc-cbar"><i style={{ width: `${pct}%` }} /></div>
                      <div className="dc-cprog">{c.made}/{c.total} drops made · <span className="dc-cmore">{expanded ? "hide schedule" : "view schedule"}</span></div>
                    </div>
                    <span className="dc-cx">⌄</span>
                  </button>
                  {expanded && (
                    <div className="dc-cdrops">
                      {c.drops.length === 0 ? (
                        <p className="dc-cempty">No drops scheduled yet.</p>
                      ) : (
                        c.drops.map((dp, i) => (
                          <button type="button" className="dc-cdrop" key={i} onClick={() => goToDrop(dp.date)}>
                            <span className={`dc-dtag ${dp.type}`}>{TYPE_LABEL[dp.type]}</span>
                            <div className="dc-cdinfo"><b>{dp.product || c.name}</b><span>{dp.when}</span></div>
                            <span className={`dc-cdst s-${dp.status.toLowerCase()}`}>{STATUS_LABEL[dp.status] || dp.status}</span>
                            <span className="dc-cdgo">›</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <div className="dc-empty">
            <b>No campaigns running yet</b>
            <p>Start one and EasyMode fills this calendar with drops — created and posted for you, automatically.</p>
            <Link className="dc-new" to="/app/campaigns/new">Start your first campaign</Link>
          </div>
        )}
      </div>

      {/* ── day sheet ─────────────────────────────────────────────────────── */}
      {open != null && (
        <div className="dc-scrim" onClick={() => setOpen(null)}>
          <div className="dc-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="dc-shbar" />
            <div className="dc-shhd">
              <div><span className="dc-shd">{monthName} {open}</span><span className="dc-shc">{drops.length ? `${drops.length} drop${drops.length > 1 ? "s" : ""}` : "Open day"}</span></div>
              <button type="button" className="dc-shx" onClick={() => setOpen(null)}>✕</button>
            </div>

            {err && <div className="dc-sherr">{err}</div>}

            {openEnd && <div className="dc-shend">🏁 End of campaign — this is your plan's last scheduled drop.</div>}

            {drops.length > 0 && (
              <div className="dc-shlist">
                {drops.map((dp) => (
                  <DropRow key={`${dp.qid}-${dp.slotIdx}`} dp={dp} day={open} year={year} month0={month0} busy={busy} onMove={reschedule} />
                ))}
              </div>
            )}

            {openNoPlan && (
              <div className="dc-shnoplan">
                <div className="np-hd">No plan covers this day</div>
                <p className="np-sub">{lastDropDate ? `Your current plan's last drop is ${fmtDay(lastDropDate)}.` : ""} Start a Social Media Plan to keep posting past then — {hasPlan ? `you have ${tokens.toLocaleString()} tokens ready to spend` : "pick a plan to begin"}.</p>
                <Link className="np-cta" to="/app/campaigns/new">Browse Social Media Plans ›</Link>
              </div>
            )}

            {!openNoPlan && !isPast && activeCampaigns.length > 0 && (
              <div className="dc-shadd">
                <div className="dc-shsub">{drops.length ? "Add another drop this day" : "Schedule a drop"}</div>
                <div className="dc-fld">
                  <label>Campaign</label>
                  <select value={schedCid} onChange={(e) => setSchedCid(e.target.value)}>
                    {activeCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="dc-fld">
                  <label>Content</label>
                  <div className="dc-seg">
                    {(["video", "image", "blog"] as const).map((t) => (
                      <button type="button" key={t} className={schedType === t ? "sel" : ""} onClick={() => setSchedType(t)}>{TYPE_LABEL[t]} <span>· {TYPE_COST[t]}</span></button>
                    ))}
                  </div>
                </div>
                <div className="dc-fld">
                  <label>Time</label>
                  <input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} />
                  {drops.length > 0 && <span className="dc-taken">Already this day: {drops.map((d) => fmtTime(d.time)).join(", ")}</span>}
                </div>
                <div className="dc-fld">
                  <label>Direction <span className="opt">optional</span></label>
                  <input type="text" value={schedTopic} maxLength={160} placeholder="e.g. Unboxing reveal, summer sale…" onChange={(e) => setSchedTopic(e.target.value)} />
                </div>
                <button type="button" className="dc-shcta" disabled={busy || !schedCid} onClick={scheduleDrop}>
                  {busy ? "Scheduling…" : `Schedule ${TYPE_LABEL[schedType]} — ${TYPE_COST[schedType]} tokens`}
                </button>
              </div>
            )}

            {isPast && drops.length === 0 && <p className="dc-shpast">This day has already passed.</p>}
          </div>
        </div>
      )}
    </Page>
  );
}

function DropRow({ dp, day, year, month0, busy, onMove }: { dp: DropInfo; day: number; year: number; month0: number; busy: boolean; onMove: (qid: string, slotIdx: number, date: string, time: string) => void }) {
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(`${year}-${pad(month0 + 1)}-${pad(day)}`);
  const [time, setTime] = useState(dp.time || "12:00");
  const canMove = dp.status === "SCHEDULED" || dp.status === "FAILED";
  return (
    <div className="dc-drow">
      <span className={`dc-dtag ${dp.type}`}>{TYPE_LABEL[dp.type]}</span>
      <div className="dc-dinfo">
        <b>{dp.product || dp.name}</b>
        <span>{dp.name} · {fmtTime(dp.time)} · {STATUS_LABEL[dp.status] || dp.status}</span>
      </div>
      {canMove && !moving && <button type="button" className="dc-dmove" onClick={() => setMoving(true)}>Move</button>}
      {canMove && moving && (
        <div className="dc-dmv">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => onMove(dp.qid, dp.slotIdx, date, time)}>{busy ? "…" : "Save"}</button>
        </div>
      )}
    </div>
  );
}
