import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { parseSchedule } from "../lib/questlines";
import { linkedFromCache } from "../lib/social-provider.server";
import { tokensRemaining } from "../lib/tokens.server";
import { acceptQuestline, rescheduleSlot, abandonQuestline, swapQuestlineItem, addDrop } from "../lib/questlines.server";

const SHORT: Record<string, "tt" | "ig" | "fb"> = { tiktok: "tt", instagram: "ig", facebook: "fb" };
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, questlines: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  const linked = shop ? linkedFromCache(shop.socialsJson).filter((p) => p in SHORT) : [];
  // If nothing linked yet, still show the three platforms so the calendar reads.
  const platforms = linked.length ? linked : ["tiktok", "instagram", "facebook"];
  const platShorts = platforms.map((p) => SHORT[p]);

  const now = new Date();
  const year = now.getUTCFullYear();
  const month0 = now.getUTCMonth();

  // Per-day content-type counts (the day cell shows what kind of content drops).
  const dropMap: Record<number, { video: number; image: number; blog: number }> = {};
  const campaigns: {
    id: string; name: string; image: string | null; status: string;
    made: number; total: number; platforms: ("tt" | "ig" | "fb")[]; next: string | null;
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
      }
      if ((s.status === "SCHEDULED" || s.status === "READY" || s.status === "FORGING") && s.date >= todayStr) {
        if (!next || s.date < next.date || (s.date === next.date && s.time < next.time)) next = { date: s.date, time: s.time };
      }
    }
    campaigns.push({
      id: q.id, name: q.name, image: q.productImageUrl, status: q.status,
      made, total: slots.length, platforms: platShorts,
      next: next ? fmtNext(next.date, next.time) : null,
    });
  }

  const total = Object.values(dropMap).reduce((a, v) => a + v.video + v.image + v.blog, 0);

  return json({
    hasPlan: !!shop?.activePlan,
    tokens: shop?.activePlan ? tokensRemaining(shop.activePlan) : 0,
    platforms: platShorts,
    weeks: monthGrid(year, month0),
    monthLabel: `${MONTHS[month0]} ${year}`.toUpperCase(),
    dropMap,
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
    const res = await addDrop(shop.id, (form.get("questlineId") as string) || "", parseInt((form.get("day") as string) || "0", 10), ((form.get("dropType") as string) || "video") as "video" | "image" | "blog", { instant: form.get("instant") === "1", productTitle: ((form.get("dropProduct") as string) || "").trim() || undefined, direction: ((form.get("dropTopic") as string) || "").trim() || undefined });
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

function typeLines(day: { video: number; image: number; blog: number }): string[] {
  const out: string[] = [];
  if (day.video) out.push(`${day.video > 1 ? day.video + " " : ""}Video`);
  if (day.image) out.push(`${day.image > 1 ? day.image + " " : ""}Image`);
  if (day.blog) out.push(`${day.blog > 1 ? day.blog + " " : ""}Blog`);
  return out;
}

export default function Campaigns() {
  const { hasPlan, platforms, weeks, monthLabel, dropMap, total, campaigns } = useLoaderData<typeof loader>();

  return (
    <Page>
      {/* obsidian texture filter (renders as a background layer) */}
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
        <p className="dc-sub">Cut from obsidian, lit in gold — every post, every platform.</p>

        <Link className="dc-new" to={hasPlan ? "/app/strategy" : "/app/plans"}>＋ New campaign</Link>

        <div className="dc-slab">
          <div className="dc-bg"><svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" viewBox="0 0 460 560"><rect width="460" height="560" fill="#060b08" /><rect width="460" height="560" filter="url(#mm-obs)" /></svg></div>
          <div className="dc-frame" />
          <div className="dc-inner">
            <div className="dc-hd"><span className="dc-mo">{monthLabel}</span><span className="dc-ct">{total} DROPS</span></div>
            <div className="dc-grid">
              {DOW.map((x, i) => <div className="dc-dow" key={i}>{x}</div>)}
              {weeks.flat().map((d, i) => {
                if (d === 0) return <div className="dc-dy empty" key={i} />;
                const day = dropMap[d];
                const isDrop = !!day && (day.video + day.image + day.blog > 0);
                return (
                  <div className={`dc-dy${isDrop ? " drop" : ""}`} key={i}>
                    <span className="dc-dn">{d}</span>
                    {isDrop && (
                      <div className="dc-types">
                        {typeLines(day).map((t, j) => <span className="dc-t" key={j}>{t}</span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="dc-posts">
              <span className="dc-plabel">Auto-posts to</span>
              {platforms.map((p) => { const G = GLYPH[p]; return <span className="dc-pchip" key={p}><G /></span>; })}
            </div>
          </div>
        </div>

        {campaigns.length > 0 ? (
          <>
            <div className="dc-sec">Active campaigns</div>
            {campaigns.map((c) => {
              const pct = c.total > 0 ? Math.round((c.made / c.total) * 100) : 0;
              const live = c.status === "ACTIVE";
              return (
                <div className="dc-camp" key={c.id}>
                  <div className="dc-thumb" style={c.image ? { backgroundImage: `url(${c.image})` } : undefined} />
                  <div className="dc-cbody">
                    <div className="dc-ctop"><b>{c.name}</b><span className={`dc-cstat ${live ? "on" : "off"}`}>{live ? "LIVE" : "PAUSED"}</span></div>
                    <div className="dc-cmeta">
                      {c.platforms.map((p) => { const G = GLYPH[p]; return <span className="dc-cchip" key={p}><G /></span>; })}
                      {c.next && <span className="dc-cnext">Next drop {c.next}</span>}
                    </div>
                    <div className="dc-cbar"><i style={{ width: `${pct}%` }} /></div>
                    <div className="dc-cprog">{c.made}/{c.total} drops made</div>
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="dc-empty">
            <b>No campaigns running yet</b>
            <p>Start one and EasyMode fills this calendar with drops — created and posted for you, automatically.</p>
            <Link className="dc-new" to={hasPlan ? "/app/strategy" : "/app/plans"}>Start your first campaign</Link>
          </div>
        )}
      </div>
    </Page>
  );
}
