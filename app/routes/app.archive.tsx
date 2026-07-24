import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, Link } from "@remix-run/react";
import { useState } from "react";
import { Page, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { parseSchedule } from "../lib/questlines";
import { generateSlotEarly, retrySlot } from "../lib/questlines.server";
import { tokensRemaining } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtWhen(date: string, time: string): string {
  const [, m, d] = date.split("-").map(Number);
  const h = parseInt((time || "12:00").slice(0, 2), 10);
  const mm = (time || "12:00").slice(3, 5);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${MON[(m || 1) - 1]} ${d} · ${mm === "00" ? `${h12}${ap}` : `${h12}:${mm}${ap}`}`;
}
const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

type Card = { id: string; title: string; status: string; video?: string; image?: string; snippet?: string; full?: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, questlines: { where: { status: { not: "COMPLETE" } }, orderBy: { createdAt: "desc" }, take: 30 } },
  });
  if (!shop) return json({ hasPlan: false, tokens: 0, library: { video: [], image: [], blog: [] }, scheduled: [], cost: TOKEN_COST });

  const assets = await db.asset.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 80 });
  const parse = (bodyJson: string) => { try { return JSON.parse(bodyJson); } catch { return {}; } };
  const byId = new Map(assets.map((a) => [a.id, a]));
  const toCard = (a: (typeof assets)[number]): Card => {
    const b = parse(a.bodyJson);
    const text = b.html ? stripHtml(b.html) : undefined;
    return { id: a.id, title: a.title || "Untitled", status: a.status, video: b.videoUrl, image: b.imageUrl, snippet: text?.slice(0, 140), full: text?.slice(0, 4000) };
  };
  const library = {
    video: assets.filter((a) => a.type === "VIDEO_AD").map(toCard),
    image: assets.filter((a) => a.type === "IMAGE_AD").map(toCard),
    blog: assets.filter((a) => a.type === "BLOG_POST").map(toCard),
  };

  const scheduled: { qid: string; slotIdx: number; type: string; product: string; when: string; date: string; status: string; campaign: string; image?: string; video?: string }[] = [];
  for (const q of shop.questlines) {
    for (const s of parseSchedule(q.scheduleJson).slots) {
      if (s.type !== "video" && s.type !== "image" && s.type !== "blog") continue;
      if (s.status === "POSTED") continue; // posted content lives in the library tabs
      const asset = s.assetId ? byId.get(s.assetId) : undefined;
      const b = asset ? parse(asset.bodyJson) : {};
      scheduled.push({ qid: q.id, slotIdx: s.idx, type: s.type, product: s.productTitle || q.name, when: fmtWhen(s.date, s.time), date: s.date, status: s.status, campaign: q.name, image: b.imageUrl, video: b.videoUrl });
    }
  }
  scheduled.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return json({
    hasPlan: !!shop.activePlan,
    tokens: shop.activePlan ? tokensRemaining(shop.activePlan) : 0,
    library,
    scheduled,
    cost: TOKEN_COST,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ error: "Shop not found." });
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const questlineId = (form.get("questlineId") as string) || "";
  const slotIdx = parseInt((form.get("slotIdx") as string) || "-1", 10);

  if (intent === "generateEarly") {
    const r = await generateSlotEarly(shop.id, questlineId, slotIdx);
    return json(r.ok ? { started: true } : { error: r.error });
  }
  if (intent === "retry") {
    const r = await retrySlot(shop.id, questlineId, slotIdx);
    return json(r.ok ? { retried: r.cost } : { error: r.error });
  }
  return json({ ok: true });
};

const TABS = [
  { key: "scheduled", label: "Scheduled", icon: "🗓" },
  { key: "video", label: "Videos", icon: "🎬" },
  { key: "image", label: "Images", icon: "🖼" },
  { key: "blog", label: "Blogs", icon: "✍️" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const TYPE_LABEL: Record<string, string> = { video: "Video", image: "Image", blog: "Blog" };
const STATUS_LABEL: Record<string, string> = { SCHEDULED: "Scheduled", FORGING: "Creating", READY: "Ready to post", FAILED: "Needs retry" };

export default function Archive() {
  const { hasPlan, tokens, library, scheduled, cost } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const err = actionData && "error" in actionData ? (actionData as { error: string }).error : null;
  const [tab, setTab] = useState<TabKey>("scheduled");
  const [viewer, setViewer] = useState<(Card & { kind: TabKey }) | null>(null);

  const early = (qid: string, slotIdx: number) => submit({ intent: "generateEarly", questlineId: qid, slotIdx: String(slotIdx) }, { method: "post" });
  const retry = (qid: string, slotIdx: number) => submit({ intent: "retry", questlineId: qid, slotIdx: String(slotIdx) }, { method: "post" });
  const costOf = (t: string) => (t === "video" ? cost.video : t === "image" ? cost.image : cost.blog);

  const lib = tab === "video" ? library.video : tab === "image" ? library.image : tab === "blog" ? library.blog : [];

  return (
    <Page>
      <div className="smp">
        <h1 className="smp-h1">Archive Storage</h1>
        <p className="smp-sub">Everything EasyMode makes, in one place — plus what's queued to post next.</p>

        <div className="cs-tabs">
          {TABS.map((t) => (
            <button type="button" key={t.key} className={`cs-tab${t.key === tab ? " sel" : ""}`} onClick={() => setTab(t.key)}>
              <span className="cs-ti">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {err && <div style={{ marginBottom: 14 }}><Banner tone="warning" title="Couldn't do that"><p>{err}</p></Banner></div>}

        {tab === "scheduled" ? (
          <>
            <div className="ar-note">Generating early just lets you <b>preview what will post</b> — it doesn't post early. Posting still happens on schedule.</div>
            {scheduled.length === 0 ? (
              <div className="ar-empty"><b>Nothing scheduled</b><p>Start a Social Media Plan or schedule a drop and it'll queue up here.</p><Link className="dc-new" to="/app/campaigns/new">Browse Social Media Plans</Link></div>
            ) : (
              <div className="ar-list">
                {scheduled.map((s) => {
                  const ready = s.status === "READY";
                  const forging = s.status === "FORGING";
                  const thumb = s.video || s.image;
                  return (
                    <div className="ar-sched" key={`${s.qid}-${s.slotIdx}`}>
                      <div className="ar-sthumb" style={s.image ? { backgroundImage: `url(${s.image})` } : undefined}>
                        {s.video && <video className="ar-svid" src={s.video} muted playsInline preload="metadata" />}
                        {!thumb && <span className={`dc-dtag ${s.type}`}>{TYPE_LABEL[s.type]}</span>}
                      </div>
                      <div className="ar-sbody">
                        <b>{s.product}</b>
                        <span className="ar-smeta"><span className={`dc-dtag ${s.type}`}>{TYPE_LABEL[s.type]}</span> {s.campaign} · posts {s.when}</span>
                        <span className={`ar-status s-${s.status.toLowerCase()}`}>{STATUS_LABEL[s.status] || s.status}</span>
                      </div>
                      <div className="ar-sact">
                        {s.status === "SCHEDULED" && <button type="button" className="ar-btn free" disabled={busy} onClick={() => early(s.qid, s.slotIdx)}>Generate early<span>free · preview it</span></button>}
                        {forging && <button type="button" className="ar-btn" disabled>Creating…</button>}
                        {(ready || s.status === "FAILED") && <button type="button" className="ar-btn retry" disabled={busy} onClick={() => retry(s.qid, s.slotIdx)}>Retry<span>{costOf(s.type)} tokens</span></button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="smp-wallet">{hasPlan ? `Wallet: ${tokens.toLocaleString()} tokens` : "Choose a plan to generate."}</p>
          </>
        ) : (
          <>
            {lib.length === 0 ? (
              <div className="ar-empty"><b>No {TABS.find((t) => t.key === tab)?.label.toLowerCase()} yet</b><p>Make one in the Content Studio and it lands here.</p><Link className="dc-new" to="/app/studio">Open Content Studio</Link></div>
            ) : (
              <div className={tab === "blog" ? "ar-blogs" : "ar-grid"}>
                {lib.map((c) => tab === "blog" ? (
                  <button type="button" className="ar-blog" key={c.id} onClick={() => setViewer({ ...c, kind: "blog" })}>
                    <b>{c.title}</b>
                    {c.snippet && <p>{c.snippet}…</p>}
                    <span className={`ar-status s-${c.status.toLowerCase()}`}>{c.status === "PUBLISHED" ? "Live on your blog" : c.status === "APPROVED" ? "Approved" : "In review"}</span>
                  </button>
                ) : (
                  <button type="button" className="ar-tile" key={c.id} onClick={() => setViewer({ ...c, kind: tab })}>
                    <div className="ar-timg" style={c.image ? { backgroundImage: `url(${c.image})` } : undefined}>
                      {c.video && <video className="ar-svid" src={c.video} muted playsInline preload="metadata" />}
                    </div>
                    <span className={`ar-tstatus s-${c.status.toLowerCase()}`}>{c.status === "PUBLISHED" ? "Posted" : c.status === "APPROVED" ? "Approved" : "In review"}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {viewer && (
          <div className="cs-scrim" onClick={() => setViewer(null)}>
            <div className={`ar-viewer${viewer.kind === "blog" ? " read" : ""}`} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="cs-vx" onClick={() => setViewer(null)}>✕</button>
              {viewer.kind === "blog" ? (
                <div className="ar-read"><h2>{viewer.title}</h2><p>{viewer.full || viewer.snippet}</p></div>
              ) : viewer.video ? (
                <video className="ar-vfull" src={viewer.video} controls autoPlay playsInline />
              ) : viewer.image ? (
                <img className="ar-vfull" src={viewer.image} alt={viewer.title} />
              ) : (
                <div className="ar-read"><p>Still being made…</p></div>
              )}
              {viewer.kind !== "blog" && (
                <div className="ar-vmeta"><b>{viewer.title}</b><span className={`ar-status s-${viewer.status.toLowerCase()}`}>{viewer.status === "PUBLISHED" ? "Posted" : viewer.status === "APPROVED" ? "Approved" : "In review"}</span></div>
              )}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
