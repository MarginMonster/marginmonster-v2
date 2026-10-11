/* Product Channels — the MARKETING-side autopilot. Point it at your store and it
 * rotates your catalogue, turning each product into a faceless selling video and
 * (if auto-post) publishing it on a cadence with a link back to the product.
 * Reuses the Channels engine (CreatorSeries sourceType "product" + tickDueSeries
 * + postCreatorDrop) and the product-aware faceless pipeline. No faceless
 * competitor can make a video about a specific SKU — this is the moat. */

import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useMemo, useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { tokensRemainingLive } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { xpForSpend } from "../lib/achievements";
import { CADENCE, cadenceOf, parsePlatforms } from "../lib/creator-series.server";
import { socialProviderEnabled, linkedFromCache } from "../lib/social-provider.server";
import { Ico } from "../lib/icons";

export const meta = () => [{ title: "Product Channels · EasyMode" }];

const SOCIAL = ["tiktok", "instagram", "facebook"] as const;
const PLAT_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
const ANGLES: [string, string][] = [["spotlight", "Spotlight"], ["hype", "Hype"], ["story", "Storytime"], ["value", "Value"]];
const VOICES: [string, string][] = [["f-warm", "Female · calm"], ["f-hype", "Female · hype"], ["m-warm", "Male · calm"], ["m-hype", "Male · hype"]];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);

  let canUse = false;
  if (shop.activePlan) {
    try {
      const { assertCapability } = await import("../lib/capabilities.server");
      assertCapability(shop.activePlan, "video");
      canUse = true;
    } catch { canUse = false; }
  }

  const providerOn = socialProviderEnabled();
  const linked = providerOn ? linkedFromCache(shop.socialsJson).filter((p) => (SOCIAL as readonly string[]).includes(p)) : [];
  const [productCount, rows] = await Promise.all([
    db.catalogProduct.count({ where: { shopId: shop.id } }),
    db.creatorSeries.findMany({ where: { shopId: shop.id, sourceType: "product", status: { not: "ENDED" } }, orderBy: { createdAt: "desc" }, take: 24 }),
  ]);
  const series = rows.map((s) => ({
    id: s.id, name: s.name, format: s.format, voiceKey: s.voiceKey, cadence: s.cadence,
    perWeek: cadenceOf(s.cadence).perWeek, platforms: parsePlatforms(s.platformsJson), autoPost: s.autoPost,
    status: s.status, pauseReason: s.pauseReason, dropsMade: s.dropsMade, dropsPosted: s.dropsPosted,
    nextRunAt: s.status === "ACTIVE" && s.nextRunAt ? s.nextRunAt.toISOString() : null,
  }));

  return json({
    name: account.name?.trim()?.split(" ")[0] || account.email.split("@")[0],
    tokens: tokensRemainingLive(shop.activePlan),
    facelessCost: TOKEN_COST.faceless,
    canUse, providerOn, linked, productCount, series,
    cadences: Object.entries(CADENCE).map(([key, v]) => ({ key, label: v.label, perWeek: v.perWeek })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = (form.get("intent") as string) || "";
  const mine = async (id: string) =>
    (await db.creatorSeries.findFirst({ where: { id, shopId: shop.id, sourceType: "product" }, select: { id: true } }))?.id;

  if (intent === "pause") {
    const id = await mine((form.get("id") as string) || "");
    if (id) await db.creatorSeries.update({ where: { id }, data: { status: "PAUSED", pauseReason: "user" } });
    return json({ ok: true });
  }
  if (intent === "resume") {
    const id = await mine((form.get("id") as string) || "");
    if (id) await db.creatorSeries.update({ where: { id }, data: { status: "ACTIVE", pauseReason: null, nextRunAt: new Date(Date.now() + 60_000) } });
    return json({ ok: true });
  }
  if (intent === "end") {
    const id = await mine((form.get("id") as string) || "");
    if (id) await db.creatorSeries.update({ where: { id }, data: { status: "ENDED", nextRunAt: null } });
    return json({ ok: true });
  }

  if (intent === "create") {
    let canUse = false;
    if (shop.activePlan) {
      try { const { assertCapability } = await import("../lib/capabilities.server"); assertCapability(shop.activePlan, "video"); canUse = true; } catch { canUse = false; }
    }
    if (!canUse) return json({ error: "Product Channels need a plan with video — upgrade to Studio or Anthem." }, { status: 400 });

    const productCount = await db.catalogProduct.count({ where: { shopId: shop.id } });
    if (productCount === 0) return json({ error: "Import your store first — there are no products to feature yet." }, { status: 400 });

    const name = ((form.get("name") as string) || "").trim().slice(0, 60);
    const angle = ((form.get("format") as string) || "spotlight").trim();
    const voiceKey = ((form.get("voiceKey") as string) || "f-warm").trim();
    const cadence = ((form.get("cadence") as string) || "3x_week").trim();
    const autoPost = (form.get("autoPost") as string) === "1";
    const platforms = ((form.get("platforms") as string) || "").split(",").map((s) => s.trim()).filter((p) => (SOCIAL as readonly string[]).includes(p));

    if (!CADENCE[cadence]) return json({ error: "Pick a posting cadence." }, { status: 400 });
    if (!ANGLES.some(([k]) => k === angle)) return json({ error: "Pick an angle." }, { status: 400 });
    if (autoPost) {
      const linked = socialProviderEnabled() ? linkedFromCache(shop.socialsJson).filter((p) => (SOCIAL as readonly string[]).includes(p)) : [];
      const targets = platforms.length ? platforms.filter((p) => linked.includes(p)) : linked;
      if (targets.length === 0) return json({ error: "Connect a social account first (or switch to “Let me approve each one”)." }, { status: 400 });
    }

    await db.creatorSeries.create({
      data: {
        shopId: shop.id,
        sourceType: "product",
        name: name || "My product channel",
        niche: "", // unused for product channels (catalogue is the source)
        format: angle,
        voiceKey, cadence,
        platformsJson: JSON.stringify(platforms),
        autoPost,
        status: "ACTIVE",
        nextRunAt: new Date(Date.now() + 60_000),
      },
    });
    return redirect("/web/product-channels");
  }
  return json({ error: "Unknown action." }, { status: 400 });
};

function relTime(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "any minute now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

type Series = ReturnType<typeof useLoaderData<typeof loader>>["series"][number];

export default function ProductChannels() {
  const { tokens, facelessCost, canUse, linked, productCount, series, cadences } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const nav = useNavigation();
  const creating = nav.state !== "idle" && nav.formData?.get("intent") === "create";
  const [showForm, setShowForm] = useState(series.length === 0);

  return (
    <div className="pc">
      <style dangerouslySetInnerHTML={{ __html: PC_CSS }} />
      <header className="pc-head">
        <div>
          <h1 className="pc-title">Product Channels</h1>
          <p className="pc-sub">Your store, on autopilot — we turn each product into a short video &amp; post it on repeat. <span className="pc-accent">Hands off.</span></p>
        </div>
        {series.length > 0 && canUse && productCount > 0 && (
          <button className="pc-newbtn" onClick={() => setShowForm((v) => !v)}>{showForm ? "Close" : "＋ New channel"}</button>
        )}
      </header>

      {!canUse && (
        <div className="pc-upsell">
          <div className="pc-upsell-ic"><Ico n="film" size={30} /></div>
          <div><b>Product Channels run on video.</b><p>That's on the Studio &amp; Anthem plans. Upgrade and your store can start posting today.</p></div>
          <Link to="/web#plans" className="pc-go sm">See plans</Link>
        </div>
      )}

      {canUse && productCount === 0 && (
        <div className="pc-upsell">
          <div className="pc-upsell-ic"><Ico n="box" size={30} /></div>
          <div><b>Import your store first.</b><p>Product Channels feature your real products — bring your catalogue in and you're ready.</p></div>
          <Link to="/web/studio" className="pc-go sm">Import store</Link>
        </div>
      )}

      {canUse && productCount > 0 && showForm && (
        <SetupForm linked={linked} tokens={tokens} facelessCost={facelessCost} productCount={productCount} cadences={cadences} error={actionData?.error} creating={creating} onCancel={series.length ? () => setShowForm(false) : undefined} />
      )}

      {series.length > 0 && (
        <div className="pc-grid">{series.map((s) => <ChannelCard key={s.id} s={s} tokens={tokens} facelessCost={facelessCost} />)}</div>
      )}

      {canUse && productCount > 0 && series.length === 0 && !showForm && (
        <div className="pc-empty">No product channels yet — <button className="pc-link" onClick={() => setShowForm(true)}>start one</button>.</div>
      )}
    </div>
  );
}

function SetupForm({ linked, tokens, facelessCost, productCount, cadences, error, creating, onCancel }: {
  linked: string[]; tokens: number; facelessCost: number; productCount: number;
  cadences: { key: string; label: string; perWeek: number }[];
  error?: string; creating: boolean; onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [angle, setAngle] = useState("spotlight");
  const [voiceKey, setVoiceKey] = useState("f-warm");
  const [cadence, setCadence] = useState("3x_week");
  const [plats, setPlats] = useState<string[]>(linked);
  const [autoPost, setAutoPost] = useState(linked.length > 0);
  const perWeek = useMemo(() => cadences.find((c) => c.key === cadence)?.perWeek || 3, [cadence, cadences]);
  const weeklyTokens = perWeek * facelessCost;
  const canAfford = tokens >= facelessCost;
  const togglePlat = (p: string) => setPlats((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const disabled = creating || (autoPost && plats.length === 0);

  return (
    <Form method="post" className="pc-setup">
      <input type="hidden" name="intent" value="create" />
      <input type="hidden" name="format" value={angle} />
      <input type="hidden" name="voiceKey" value={voiceKey} />
      <input type="hidden" name="cadence" value={cadence} />
      <input type="hidden" name="platforms" value={plats.join(",")} />
      <input type="hidden" name="autoPost" value={autoPost ? "1" : "0"} />
      <input type="hidden" name="name" value={name || "My product channel"} />

      <div className="pc-setup-head"><span className="pc-spark">✦</span> Start a product channel {onCancel && <button type="button" className="pc-x" onClick={onCancel}>✕</button>}</div>

      <div className="pc-feats">Rotates all <b>{productCount}</b> of your products — one video per drop, with the real product.</div>

      <label className="pc-lbl">Channel name <span className="pc-opt">(optional)</span></label>
      <input className="pc-field" placeholder="My product channel" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />

      <div className="pc-row2">
        <div>
          <label className="pc-lbl">Angle</label>
          <div className="pc-pills2">{ANGLES.map(([k, l]) => <button type="button" key={k} className={`pc-pill${angle === k ? " sel" : ""}`} onClick={() => setAngle(k)}>{l}</button>)}</div>
        </div>
        <div>
          <label className="pc-lbl">Voice</label>
          <div className="pc-pills2">{VOICES.map(([k, l]) => <button type="button" key={k} className={`pc-pill${voiceKey === k ? " sel" : ""}`} onClick={() => setVoiceKey(k)}>{l}</button>)}</div>
        </div>
      </div>

      <label className="pc-lbl">How often?</label>
      <div className="pc-cads">{cadences.map((c) => (
        <button type="button" key={c.key} className={`pc-cad${cadence === c.key ? " sel" : ""}`} onClick={() => setCadence(c.key)}><b>{c.label}</b><span>{c.perWeek} videos/week</span></button>
      ))}</div>

      <label className="pc-lbl">Where it posts</label>
      {linked.length > 0 ? (
        <div className="pc-chips">{linked.map((p) => <button type="button" key={p} className={`pc-chip${plats.includes(p) ? " on" : ""}`} onClick={() => togglePlat(p)}>{plats.includes(p) ? "✓ " : ""}{PLAT_LABEL[p]}</button>)}</div>
      ) : (
        <div className="pc-connect">No socials linked yet — <Link to="/web/connect" className="pc-link">connect TikTok / Instagram / Facebook</Link> to post automatically. You can still start in approve mode below.</div>
      )}

      <label className="pc-lbl">Posting</label>
      <div className="pc-modes">
        <button type="button" className={`pc-mode${autoPost ? " sel" : ""}`} disabled={linked.length === 0} onClick={() => setAutoPost(true)}><b><Ico n="sparkle" /> Post automatically</b><span>Each video posts to your socials with a link to the product.</span></button>
        <button type="button" className={`pc-mode${!autoPost ? " sel" : ""}`} onClick={() => setAutoPost(false)}><b><Ico n="eye" /> Let me approve each one</b><span>Videos wait in your Archive — you post with one tap.</span></button>
      </div>

      <div className="pc-summary"><span><b>{perWeek}</b> videos/week · ~<b>{weeklyTokens}</b> tokens · <b>+{xpForSpend(weeklyTokens)}</b> XP / wk</span><span className="pc-bal">{tokens} tokens in wallet</span></div>

      {error && <div className="pc-err">{error}</div>}
      {!canAfford && <div className="pc-err">You need at least {facelessCost} tokens to run a channel — <Link to="/web#plans" className="pc-link">top up</Link>.</div>}

      <button className="pc-go" type="submit" disabled={disabled}><span className="pc-go-flower" aria-hidden="true" />{creating ? "Starting…" : "Start my product channel"}</button>
    </Form>
  );
}

function ChannelCard({ s, tokens, facelessCost }: { s: Series; tokens: number; facelessCost: number }) {
  const paused = s.status === "PAUSED";
  const angleLabel = ANGLES.find(([k]) => k === s.format)?.[1] || s.format;
  const reasonText: Record<string, string> = { "out-of-tokens": "Out of tokens", "no-accounts": "No socials linked", "no-products": "No products imported", "needs-plan": "Plan changed", user: "Paused by you" };
  return (
    <div className={`pc-card${paused ? " paused" : ""}`}>
      <div className="pc-card-top">
        <div><div className="pc-card-name">{s.name}</div><div className="pc-card-niche">{angleLabel} · your store</div></div>
        <span className={`pc-badge ${s.status === "ACTIVE" ? "live" : "off"}`}>{s.status === "ACTIVE" ? "● Running" : "❙❙ Paused"}</span>
      </div>
      <div className="pc-card-meta">
        <span><b>{s.perWeek}</b> videos/week</span>
        <span>{s.autoPost ? "auto-post" : "approve"}</span>
        {s.platforms.length > 0 && <span>{s.platforms.map((p) => PLAT_LABEL[p]).join(" · ")}</span>}
      </div>
      {s.status === "ACTIVE" && <div className="pc-next"><span className="pc-next-dot" /> Next drop {relTime(s.nextRunAt) || "soon"}</div>}
      {paused && s.pauseReason && (
        <div className="pc-paused-note">{reasonText[s.pauseReason] || "Paused"}
          {s.pauseReason === "out-of-tokens" && <> — <Link to="/web#plans" className="pc-link">top up</Link></>}
          {s.pauseReason === "no-accounts" && <> — <Link to="/web/connect" className="pc-link">connect</Link></>}
          {s.pauseReason === "no-products" && <> — <Link to="/web/studio" className="pc-link">import store</Link></>}
        </div>
      )}
      <div className="pc-card-stats"><div><b>{s.dropsMade}</b><span>made</span></div><div><b>{s.dropsPosted}</b><span>posted</span></div><Link to="/web/archive" className="pc-card-gal">Archive →</Link></div>
      <div className="pc-card-acts">
        {paused
          ? <Form method="post"><input type="hidden" name="intent" value="resume" /><input type="hidden" name="id" value={s.id} /><button className="pc-act primary" disabled={tokens < facelessCost}>Resume</button></Form>
          : <Form method="post"><input type="hidden" name="intent" value="pause" /><input type="hidden" name="id" value={s.id} /><button className="pc-act">Pause</button></Form>}
        <Form method="post" onSubmit={(e) => { if (!confirm("End this channel? It stops making new videos (your Archive keeps everything).")) e.preventDefault(); }}>
          <input type="hidden" name="intent" value="end" /><input type="hidden" name="id" value={s.id} /><button className="pc-act ghost">End</button>
        </Form>
      </div>
    </div>
  );
}

const PC_CSS = `
.pc{--l:#E7E2D2;--ink:#14201A;--ink2:#5B6B61;--ink3:#8A968E;--g:#0C7A46;--g2:#12A85E;
  --sh-sm:0 1px 2px rgba(20,32,26,.05);--sh-md:0 2px 6px rgba(20,32,26,.05),0 14px 34px -14px rgba(20,32,26,.16);
  max-width:960px;margin:0 auto;padding:14px 16px 64px;font-family:Poppins,sans-serif;color:var(--ink);}
.pc-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px;}
.pc-title{font-size:30px;font-weight:800;letter-spacing:-.02em;margin:0;}
.pc-sub{margin:4px 0 0;color:var(--ink2);font-size:14px;font-weight:500;max-width:56ch;}
.pc-accent{background:linear-gradient(120deg,var(--g2),var(--g));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700;}
.pc-newbtn{flex:0 0 auto;font:inherit;font-weight:700;font-size:13px;color:var(--g);background:#fff;border:1px solid var(--l);border-radius:999px;padding:9px 16px;cursor:pointer;box-shadow:var(--sh-sm);transition:all .12s;}
.pc-newbtn:hover{transform:translateY(-1px);box-shadow:var(--sh-md);}
.pc-upsell{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid var(--l);border-radius:18px;padding:18px 20px;box-shadow:var(--sh-sm);margin-bottom:22px;}
.pc-upsell-ic{font-size:30px;}.pc-upsell b{font-size:15px;}.pc-upsell p{margin:2px 0 0;color:var(--ink2);font-size:13px;}
.pc-setup{position:relative;background:#fff;border:1px solid var(--l);border-radius:22px;padding:22px;box-shadow:var(--sh-md),inset 0 0 0 1px rgba(231,200,121,.22);margin-bottom:26px;}
.pc-setup-head{display:flex;align-items:center;gap:8px;font-weight:800;font-size:16px;margin-bottom:12px;}
.pc-spark{color:#C79A2E;}.pc-x{margin-left:auto;border:0;background:transparent;color:var(--ink3);font-size:15px;cursor:pointer;}
.pc-feats{background:#F7FBF8;border:1px solid #D9EDE2;border-radius:12px;padding:10px 14px;font-size:13px;color:var(--ink2);margin-bottom:4px;}
.pc-feats b{color:var(--ink);}
.pc-lbl{display:block;font-weight:700;font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:var(--ink2);margin:16px 0 8px;}
.pc-opt{text-transform:none;letter-spacing:0;color:var(--ink3);font-weight:500;}
.pc-field{width:100%;box-sizing:border-box;background:#F4F1E6;border:1px solid #E2DCC8;border-radius:14px;padding:13px 15px;font:inherit;font-size:14.5px;color:var(--ink);box-shadow:inset 0 1px 3px rgba(20,32,26,.055);transition:all .15s;}
.pc-field:focus{outline:none;border-color:#9CCBB1;box-shadow:inset 0 1px 3px rgba(20,32,26,.045),0 0 0 3px rgba(12,122,70,.14);}
.pc-field::placeholder{color:#A9B2AA;}
.pc-row2{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.pc-pills2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.pc-pill{font:inherit;font-weight:700;font-size:12.5px;color:var(--ink2);background:#fff;border:1px solid var(--l);border-radius:12px;padding:10px 8px;cursor:pointer;text-align:center;transition:all .12s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pc-pill:hover{border-color:#9CCBB1;transform:translateY(-1px);box-shadow:var(--sh-sm);}
.pc-pill.sel{background:#EAF6EF;border-color:var(--g);color:var(--ink);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.pc-cads{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.pc-cad{font:inherit;display:flex;flex-direction:column;gap:3px;align-items:center;background:#fff;border:1px solid var(--l);border-radius:14px;padding:13px 8px;cursor:pointer;transition:all .12s;}
.pc-cad b{font-size:14px;color:var(--ink);}.pc-cad span{font-size:11.5px;color:var(--ink3);font-weight:600;}
.pc-cad:hover{border-color:#9CCBB1;transform:translateY(-1px);box-shadow:var(--sh-sm);}
.pc-cad.sel{background:#EAF6EF;border-color:var(--g);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.pc-chips{display:flex;flex-wrap:wrap;gap:8px;}
.pc-chip{font:inherit;font-weight:600;font-size:12.5px;color:var(--ink2);background:#fff;border:1px solid var(--l);border-radius:999px;padding:7px 13px;cursor:pointer;transition:all .12s;}
.pc-chip:hover{border-color:#9CCBB1;color:var(--ink);}.pc-chip.on{background:#EAF6EF;border-color:var(--g);color:var(--ink);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.pc-connect{background:#FBF7EA;border:1px dashed #E2DCC8;border-radius:12px;padding:11px 14px;font-size:12.5px;color:var(--ink2);}
.pc-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.pc-mode{font:inherit;text-align:left;display:flex;flex-direction:column;gap:3px;background:#fff;border:1px solid var(--l);border-radius:14px;padding:13px 14px;cursor:pointer;transition:all .12s;}
.pc-mode b{font-size:13.5px;color:var(--ink);}.pc-mode span{font-size:11.5px;color:var(--ink3);font-weight:500;line-height:1.35;}
.pc-mode:hover:not(:disabled){border-color:#9CCBB1;}.pc-mode.sel{background:#EAF6EF;border-color:var(--g);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.pc-mode:disabled{opacity:.45;cursor:not-allowed;}
.pc-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 4px;font-size:13px;color:var(--ink2);}
.pc-summary b{color:var(--ink);}.pc-bal{color:var(--ink3);font-size:12px;}
.pc-err{background:#FDECEC;border:1px solid #F3C9C9;color:#A4342E;border-radius:12px;padding:10px 14px;font-size:12.5px;margin-top:12px;}
.pc-go{position:relative;isolation:isolate;overflow:hidden;width:100%;margin-top:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;cursor:pointer;font:inherit;font-weight:800;font-size:15px;color:#fff;padding:15px 22px;border-radius:15px;transition:all .1s;background:linear-gradient(100deg,#12A85E 38%,#0A6A3D 78%,#075530);box-shadow:0 4px 14px rgba(12,122,70,.32),inset 0 0 0 1px rgba(231,200,121,.34);}
.pc-go::before{content:"";position:absolute;inset:4px;border:1px solid rgba(255,210,74,.42);border-radius:11px;pointer-events:none;}
.pc-go.sm{width:auto;padding:11px 18px;font-size:13.5px;margin:0;text-decoration:none;flex:0 0 auto;}
.pc-go-flower{position:absolute;z-index:-1;right:-26px;top:-26px;width:120px;height:120px;background:#FFD24A;-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.5;animation:wbDrift 60s linear infinite;}
.pc-go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 20px rgba(12,122,70,.36),inset 0 0 0 1px rgba(231,200,121,.34);filter:brightness(1.04);}
.pc-go:disabled{opacity:.42;cursor:not-allowed;box-shadow:none;}
.pc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;}
.pc-card{background:#fff;border:1px solid var(--l);border-radius:18px;padding:18px;box-shadow:var(--sh-sm);transition:all .14s;}
.pc-card:hover{transform:translateY(-2px);box-shadow:var(--sh-md);}.pc-card.paused{opacity:.92;background:#FCFBF6;}
.pc-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
.pc-card-name{font-weight:800;font-size:16px;letter-spacing:-.01em;}
.pc-card-niche{color:var(--ink3);font-size:12px;font-weight:500;margin-top:2px;}
.pc-badge{flex:0 0 auto;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;}
.pc-badge.live{color:#0C7A46;background:#EAF6EF;}.pc-badge.off{color:#8A7A3A;background:#F6F0DE;}
.pc-card-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin:12px 0;font-size:12px;color:var(--ink2);font-weight:600;}.pc-card-meta b{color:var(--ink);}
.pc-next{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--g);font-weight:700;}
.pc-next-dot{width:7px;height:7px;border-radius:50%;background:var(--g2);box-shadow:0 0 0 3px rgba(18,168,94,.18);}
.pc-paused-note{font-size:12.5px;color:#8A7A3A;font-weight:600;}
.pc-card-stats{display:flex;align-items:center;gap:20px;margin:14px 0;padding:12px 0;border-top:1px solid #F0ECDE;border-bottom:1px solid #F0ECDE;}
.pc-card-stats>div{display:flex;flex-direction:column;}
.pc-card-stats b{font-size:18px;font-weight:800;line-height:1;}.pc-card-stats span{font-size:11px;color:var(--ink3);font-weight:600;margin-top:3px;}
.pc-card-gal{margin-left:auto;font-size:12px;font-weight:700;color:var(--g);text-decoration:none;}
.pc-card-acts{display:flex;gap:8px;}.pc-card-acts form{flex:1;}
.pc-act{width:100%;font:inherit;font-weight:700;font-size:12.5px;padding:9px;border-radius:11px;border:1px solid var(--l);background:#fff;color:var(--ink);cursor:pointer;transition:all .12s;}
.pc-act:hover:not(:disabled){border-color:#9CCBB1;background:#F7FBF8;}.pc-act:disabled{opacity:.4;cursor:not-allowed;}
.pc-act.primary{background:#EAF6EF;border-color:var(--g);color:var(--g);}
.pc-act.ghost{color:var(--ink3);}.pc-act.ghost:hover{color:#A4342E;border-color:#E6B9B6;background:#FDF3F2;}
.pc-empty{margin-top:10px;padding:22px;border-radius:16px;background:#fff;border:1px dashed var(--l);font-size:14px;color:var(--ink2);text-align:center;}
.pc-link{color:var(--g);font-weight:700;background:none;border:0;cursor:pointer;font:inherit;text-decoration:underline;padding:0;}
@media(max-width:560px){.pc-row2{grid-template-columns:1fr;}.pc-modes{grid-template-columns:1fr;}.pc-title{font-size:25px;}}
`;
