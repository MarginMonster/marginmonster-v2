/* Channels — the Creator section's autopilot. Pick a vibe once; EASYMODE writes,
 * voices, captions, scores and POSTS a fresh faceless video on a cadence, hands
 * off. Reuses the faceless pipeline + the upload-post provider + the token
 * prepay/refund safety (see creator-series.server.ts). Green-on-cream premium,
 * "videos/week" not token-math, reliability + approve-gate up front. */

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

export const meta = () => [{ title: "Channels · EasyMode" }];

const SOCIAL = ["tiktok", "instagram", "facebook"] as const;
const PLAT_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };

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

  const rows = await db.creatorSeries.findMany({
    where: { shopId: shop.id, status: { not: "ENDED" } },
    orderBy: { createdAt: "desc" },
    take: 24,
  });
  const series = rows.map((s) => {
    const cad = cadenceOf(s.cadence);
    return {
      id: s.id,
      name: s.name,
      niche: s.niche,
      format: s.format,
      voiceKey: s.voiceKey,
      cadence: s.cadence,
      perWeek: cad.perWeek,
      platforms: parsePlatforms(s.platformsJson),
      autoPost: s.autoPost,
      status: s.status,
      pauseReason: s.pauseReason,
      dropsMade: s.dropsMade,
      dropsPosted: s.dropsPosted,
      nextRunAt: s.status === "ACTIVE" && s.nextRunAt ? s.nextRunAt.toISOString() : null,
    };
  });

  return json({
    name: account.name?.trim()?.split(" ")[0] || account.email.split("@")[0],
    tokens: tokensRemainingLive(shop.activePlan),
    facelessCost: TOKEN_COST.faceless,
    canUse,
    providerOn,
    linked,
    series,
    cadences: Object.entries(CADENCE).map(([key, v]) => ({ key, label: v.label, perWeek: v.perWeek })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = (form.get("intent") as string) || "";

  const mine = async (id: string) =>
    (await db.creatorSeries.findFirst({ where: { id, shopId: shop.id }, select: { id: true } }))?.id;

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
    // Gate: channels render faceless, which rides the video capability.
    let canUse = false;
    if (shop.activePlan) {
      try { const { assertCapability } = await import("../lib/capabilities.server"); assertCapability(shop.activePlan, "video"); canUse = true; } catch { canUse = false; }
    }
    if (!canUse) return json({ error: "Channels need a plan with video — upgrade to Studio or Anthem." }, { status: 400 });

    const name = ((form.get("name") as string) || "").trim().slice(0, 60);
    const niche = ((form.get("niche") as string) || "").trim().slice(0, 160);
    const format = ((form.get("format") as string) || "facts").trim();
    const voiceKey = ((form.get("voiceKey") as string) || "f-warm").trim();
    const cadence = ((form.get("cadence") as string) || "3x_week").trim();
    const autoPost = (form.get("autoPost") as string) === "1";
    const platforms = ((form.get("platforms") as string) || "")
      .split(",").map((s) => s.trim()).filter((p) => (SOCIAL as readonly string[]).includes(p));

    if (!niche) return json({ error: "Give your channel a vibe — what's it about?" }, { status: 400 });
    if (!CADENCE[cadence]) return json({ error: "Pick a posting cadence." }, { status: 400 });

    if (autoPost) {
      const linked = socialProviderEnabled() ? linkedFromCache(shop.socialsJson).filter((p) => (SOCIAL as readonly string[]).includes(p)) : [];
      const targets = platforms.length ? platforms.filter((p) => linked.includes(p)) : linked;
      if (targets.length === 0) return json({ error: "Connect a social account first (or switch to “Let me approve each one”)." }, { status: 400 });
    }

    await db.creatorSeries.create({
      data: {
        shopId: shop.id,
        name: name || niche.slice(0, 48),
        niche,
        format,
        voiceKey,
        cadence,
        platformsJson: JSON.stringify(platforms),
        autoPost,
        status: "ACTIVE",
        // First drop fires on the next worker tick (~2-3 min) so the channel
        // comes alive right after you press start.
        nextRunAt: new Date(Date.now() + 60_000),
      },
    });
    return redirect("/web/channels");
  }

  return json({ error: "Unknown action." }, { status: 400 });
};

/* ---------------- UI ---------------- */

const FORMATS: [string, string][] = [["motivational", "Motivational"], ["facts", "Facts"], ["storytime", "Storytime"], ["listicle", "Listicle"]];
const VOICES: [string, string][] = [["f-warm", "Female · calm"], ["f-hype", "Female · hype"], ["m-warm", "Male · calm"], ["m-hype", "Male · hype"]];
const NICHES = ["Deep ocean facts", "Stoic motivation", "Weird history", "Money & side hustles", "Mind-blowing science", "Space facts", "Fitness tips", "Life hacks", "Mythology stories", "True crime shorts"];

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

export default function Channels() {
  const { name, tokens, facelessCost, canUse, linked, series, cadences } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const nav = useNavigation();
  const creating = nav.state !== "idle" && nav.formData?.get("intent") === "create";

  const [showForm, setShowForm] = useState(series.length === 0);

  return (
    <div className="ch">
      <style dangerouslySetInnerHTML={{ __html: CH_CSS }} />

      <header className="ch-head">
        <div>
          <h1 className="ch-title">Channels</h1>
          <p className="ch-sub">Put your content on autopilot — we write, voice &amp; post a fresh video on repeat. <span className="ch-accent">Hands off.</span></p>
        </div>
        {series.length > 0 && canUse && (
          <button className="ch-newbtn" onClick={() => setShowForm((v) => !v)}>{showForm ? "Close" : "＋ New channel"}</button>
        )}
      </header>

      {!canUse && (
        <div className="ch-upsell">
          <div className="ch-upsell-ic"><Ico n="film" size={28} /></div>
          <div>
            <b>Channels run on faceless video.</b>
            <p>That's on the Studio &amp; Anthem plans. Upgrade and your channel can start posting today.</p>
          </div>
          <Link to="/web#plans" className="ch-go sm">See plans</Link>
        </div>
      )}

      {canUse && showForm && (
        <SetupForm linked={linked} tokens={tokens} facelessCost={facelessCost} cadences={cadences} error={actionData?.error} creating={creating} onCancel={series.length ? () => setShowForm(false) : undefined} />
      )}

      {series.length > 0 && (
        <div className="ch-grid">
          {series.map((s) => <ChannelCard key={s.id} s={s} tokens={tokens} facelessCost={facelessCost} />)}
        </div>
      )}

      {canUse && series.length === 0 && !showForm && (
        <div className="ch-empty">No channels yet — <button className="ch-link" onClick={() => setShowForm(true)}>start one</button>.</div>
      )}
    </div>
  );
}

function SetupForm({ linked, tokens, facelessCost, cadences, error, creating, onCancel }: {
  linked: string[]; tokens: number; facelessCost: number;
  cadences: { key: string; label: string; perWeek: number }[];
  error?: string; creating: boolean; onCancel?: () => void;
}) {
  const [niche, setNiche] = useState("");
  const [name, setName] = useState("");
  const [format, setFormat] = useState("facts");
  const [voiceKey, setVoiceKey] = useState("f-warm");
  const [cadence, setCadence] = useState("3x_week");
  const [plats, setPlats] = useState<string[]>(linked);
  const [autoPost, setAutoPost] = useState(linked.length > 0);

  const perWeek = useMemo(() => cadences.find((c) => c.key === cadence)?.perWeek || 3, [cadence, cadences]);
  const weeklyTokens = perWeek * facelessCost;
  const canAfford = tokens >= facelessCost;
  const togglePlat = (p: string) => setPlats((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const disabled = creating || !niche.trim() || (autoPost && plats.length === 0);

  return (
    <Form method="post" className="ch-setup">
      <input type="hidden" name="intent" value="create" />
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="voiceKey" value={voiceKey} />
      <input type="hidden" name="cadence" value={cadence} />
      <input type="hidden" name="platforms" value={plats.join(",")} />
      <input type="hidden" name="autoPost" value={autoPost ? "1" : "0"} />
      <input type="hidden" name="name" value={name || niche.slice(0, 48)} />

      <div className="ch-setup-head">
        <span className="ch-spark">✦</span> Start a channel
        {onCancel && <button type="button" className="ch-x" onClick={onCancel}>✕</button>}
      </div>

      <label className="ch-lbl">What's it about?</label>
      <input className="ch-field" placeholder="e.g. mind-blowing deep ocean facts" value={niche} maxLength={160}
        onChange={(e) => setNiche(e.target.value)} />
      <div className="ch-chips">
        {NICHES.map((n) => <button type="button" key={n} className={`ch-chip${niche === n ? " on" : ""}`} onClick={() => setNiche(n)}>{n}</button>)}
      </div>

      <label className="ch-lbl">Channel name <span className="ch-opt">(optional)</span></label>
      <input className="ch-field" placeholder={niche ? niche.slice(0, 48) : "Deep Ocean Facts"} value={name} maxLength={60}
        onChange={(e) => setName(e.target.value)} />

      <div className="ch-row2">
        <div>
          <label className="ch-lbl">Format</label>
          <div className="ch-pills2">
            {FORMATS.map(([k, l]) => <button type="button" key={k} className={`ch-pill${format === k ? " sel" : ""}`} onClick={() => setFormat(k)}>{l}</button>)}
          </div>
        </div>
        <div>
          <label className="ch-lbl">Voice</label>
          <div className="ch-pills2">
            {VOICES.map(([k, l]) => <button type="button" key={k} className={`ch-pill${voiceKey === k ? " sel" : ""}`} onClick={() => setVoiceKey(k)}>{l}</button>)}
          </div>
        </div>
      </div>

      <label className="ch-lbl">How often?</label>
      <div className="ch-cads">
        {cadences.map((c) => (
          <button type="button" key={c.key} className={`ch-cad${cadence === c.key ? " sel" : ""}`} onClick={() => setCadence(c.key)}>
            <b>{c.label}</b>
            <span>{c.perWeek} videos/week</span>
          </button>
        ))}
      </div>

      <label className="ch-lbl">Where it posts</label>
      {linked.length > 0 ? (
        <div className="ch-chips">
          {linked.map((p) => <button type="button" key={p} className={`ch-chip plat${plats.includes(p) ? " on" : ""}`} onClick={() => togglePlat(p)}>{plats.includes(p) ? "✓ " : ""}{PLAT_LABEL[p]}</button>)}
        </div>
      ) : (
        <div className="ch-connect">No socials linked yet — <Link to="/web/connect" className="ch-link">connect TikTok / Instagram / Facebook</Link> to post automatically. You can still start in approve mode below.</div>
      )}

      <label className="ch-lbl">Posting</label>
      <div className="ch-modes">
        <button type="button" className={`ch-mode${autoPost ? " sel" : ""}`} disabled={linked.length === 0} onClick={() => setAutoPost(true)}>
          <b><Ico n="sparkle" /> Post automatically</b><span>Each drop goes straight to your socials.</span>
        </button>
        <button type="button" className={`ch-mode${!autoPost ? " sel" : ""}`} onClick={() => setAutoPost(false)}>
          <b><Ico n="eye" /> Let me approve each one</b><span>Drops wait in your Gallery — you post with one tap.</span>
        </button>
      </div>

      <div className="ch-summary">
        <span><b>{perWeek}</b> videos/week · ~<b>{weeklyTokens}</b> tokens · <b>+{xpForSpend(weeklyTokens)}</b> XP / wk</span>
        <span className="ch-bal">{tokens} tokens in wallet</span>
      </div>

      {error && <div className="ch-err">{error}</div>}
      {!canAfford && <div className="ch-err">You need at least {facelessCost} tokens to run a channel — <Link to="/web#plans" className="ch-link">top up</Link>.</div>}

      <button className="ch-go" type="submit" disabled={disabled}>
        <span className="ch-go-flower" aria-hidden="true" />
        {creating ? "Starting…" : <>Start my channel <Ico n="rocket" /></>}
      </button>
    </Form>
  );
}

function ChannelCard({ s, tokens, facelessCost }: { s: Series; tokens: number; facelessCost: number }) {
  const paused = s.status === "PAUSED";
  const fmtLabel = FORMATS.find(([k]) => k === s.format)?.[1] || s.format;
  const reasonText: Record<string, string> = {
    "out-of-tokens": "Out of tokens",
    "no-accounts": "No socials linked",
    "needs-plan": "Plan changed",
    user: "Paused by you",
  };
  return (
    <div className={`ch-card${paused ? " paused" : ""}`}>
      <div className="ch-card-top">
        <div>
          <div className="ch-card-name">{s.name}</div>
          <div className="ch-card-niche">{fmtLabel} · {s.niche}</div>
        </div>
        <span className={`ch-badge ${s.status === "ACTIVE" ? "live" : "off"}`}>{s.status === "ACTIVE" ? "● Running" : "❙❙ Paused"}</span>
      </div>

      <div className="ch-card-meta">
        <span><b>{s.perWeek}</b> videos/week</span>
        <span>{s.autoPost ? <><Ico n="sparkle" /> auto-post</> : <><Ico n="eye" /> approve</>}</span>
        {s.platforms.length > 0 && <span>{s.platforms.map((p) => PLAT_LABEL[p]).join(" · ")}</span>}
      </div>

      {s.status === "ACTIVE" && (
        <div className="ch-next"><span className="ch-next-dot" /> Next drop {relTime(s.nextRunAt) || "soon"}</div>
      )}
      {paused && s.pauseReason && (
        <div className="ch-paused-note">
          {reasonText[s.pauseReason] || "Paused"}
          {s.pauseReason === "out-of-tokens" && <> — <Link to="/web#plans" className="ch-link">top up</Link></>}
          {s.pauseReason === "no-accounts" && <> — <Link to="/web/connect" className="ch-link">connect</Link></>}
        </div>
      )}

      <div className="ch-card-stats">
        <div><b>{s.dropsMade}</b><span>made</span></div>
        <div><b>{s.dropsPosted}</b><span>posted</span></div>
        <Link to="/web/archive?section=creator" className="ch-card-gal">Gallery →</Link>
      </div>

      <div className="ch-card-acts">
        {paused ? (
          <Form method="post"><input type="hidden" name="intent" value="resume" /><input type="hidden" name="id" value={s.id} /><button className="ch-act primary" disabled={tokens < facelessCost}>Resume</button></Form>
        ) : (
          <Form method="post"><input type="hidden" name="intent" value="pause" /><input type="hidden" name="id" value={s.id} /><button className="ch-act">Pause</button></Form>
        )}
        <Form method="post" onSubmit={(e) => { if (!confirm("End this channel? It stops making new videos (your Gallery keeps everything).")) e.preventDefault(); }}>
          <input type="hidden" name="intent" value="end" /><input type="hidden" name="id" value={s.id} />
          <button className="ch-act ghost">End</button>
        </Form>
      </div>
    </div>
  );
}

const CH_CSS = `
.ch{--l:#E7E2D2;--ink:#14201A;--ink2:#5B6B61;--ink3:#8A968E;--g:#0C7A46;--g2:#12A85E;
  --sh-sm:0 1px 2px rgba(20,32,26,.05);--sh-md:0 2px 6px rgba(20,32,26,.05),0 14px 34px -14px rgba(20,32,26,.16);
  max-width:960px;margin:0 auto;padding:14px 16px 64px;font-family:Poppins,sans-serif;color:var(--ink);}
.ch-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px;}
.ch-title{font-size:30px;font-weight:800;letter-spacing:-.02em;margin:0;}
.ch-sub{margin:4px 0 0;color:var(--ink2);font-size:14px;font-weight:500;max-width:52ch;}
.ch-accent{background:linear-gradient(120deg,var(--g2),var(--g));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700;}
.ch-newbtn{flex:0 0 auto;font:inherit;font-weight:700;font-size:13px;color:var(--g);background:#fff;border:1px solid var(--l);border-radius:999px;padding:9px 16px;cursor:pointer;box-shadow:var(--sh-sm);transition:all .12s;}
.ch-newbtn:hover{transform:translateY(-1px);box-shadow:var(--sh-md);}
.ch-upsell{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid var(--l);border-radius:18px;padding:18px 20px;box-shadow:var(--sh-sm);margin-bottom:22px;}
.ch-upsell-ic{font-size:30px;}
.ch-upsell b{font-size:15px;} .ch-upsell p{margin:2px 0 0;color:var(--ink2);font-size:13px;}

/* setup */
.ch-setup{position:relative;background:#fff;border:1px solid var(--l);border-radius:22px;padding:22px;box-shadow:var(--sh-md),inset 0 0 0 1px rgba(231,200,121,.22);margin-bottom:26px;}
.ch-setup-head{display:flex;align-items:center;gap:8px;font-weight:800;font-size:16px;margin-bottom:14px;}
.ch-spark{color:#C79A2E;}
.ch-x{margin-left:auto;border:0;background:transparent;color:var(--ink3);font-size:15px;cursor:pointer;line-height:1;}
.ch-lbl{display:block;font-weight:700;font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:var(--ink2);margin:16px 0 8px;}
.ch-lbl:first-of-type{margin-top:0;}
.ch-opt{text-transform:none;letter-spacing:0;color:var(--ink3);font-weight:500;}
.ch-field{width:100%;box-sizing:border-box;background:#F4F1E6;border:1px solid #E2DCC8;border-radius:14px;padding:13px 15px;font:inherit;font-size:14.5px;color:var(--ink);box-shadow:inset 0 1px 3px rgba(20,32,26,.055);transition:border-color .15s,box-shadow .15s;}
.ch-field:focus{outline:none;border-color:#9CCBB1;box-shadow:inset 0 1px 3px rgba(20,32,26,.045),0 0 0 3px rgba(12,122,70,.14);}
.ch-field::placeholder{color:#A9B2AA;}
.ch-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.ch-chip{font:inherit;font-weight:600;font-size:12.5px;color:var(--ink2);background:#fff;border:1px solid var(--l);border-radius:999px;padding:7px 13px;cursor:pointer;transition:all .12s;}
.ch-chip:hover{border-color:#9CCBB1;color:var(--ink);}
.ch-chip.on{background:#EAF6EF;border-color:var(--g);color:var(--ink);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ch-row2{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.ch-pills2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.ch-pill{font:inherit;font-weight:700;font-size:12.5px;color:var(--ink2);background:#fff;border:1px solid var(--l);border-radius:12px;padding:10px 8px;cursor:pointer;text-align:center;transition:all .12s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ch-pill:hover{border-color:#9CCBB1;transform:translateY(-1px);box-shadow:var(--sh-sm);}
.ch-pill.sel{background:#EAF6EF;border-color:var(--g);color:var(--ink);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ch-cads{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.ch-cad{font:inherit;display:flex;flex-direction:column;gap:3px;align-items:center;background:#fff;border:1px solid var(--l);border-radius:14px;padding:13px 8px;cursor:pointer;transition:all .12s;}
.ch-cad b{font-size:14px;color:var(--ink);} .ch-cad span{font-size:11.5px;color:var(--ink3);font-weight:600;}
.ch-cad:hover{border-color:#9CCBB1;transform:translateY(-1px);box-shadow:var(--sh-sm);}
.ch-cad.sel{background:#EAF6EF;border-color:var(--g);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ch-connect{background:#FBF7EA;border:1px dashed #E2DCC8;border-radius:12px;padding:11px 14px;font-size:12.5px;color:var(--ink2);}
.ch-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.ch-mode{font:inherit;text-align:left;display:flex;flex-direction:column;gap:3px;background:#fff;border:1px solid var(--l);border-radius:14px;padding:13px 14px;cursor:pointer;transition:all .12s;}
.ch-mode b{font-size:13.5px;color:var(--ink);} .ch-mode span{font-size:11.5px;color:var(--ink3);font-weight:500;line-height:1.35;}
.ch-mode:hover:not(:disabled){border-color:#9CCBB1;}
.ch-mode.sel{background:#EAF6EF;border-color:var(--g);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ch-mode:disabled{opacity:.45;cursor:not-allowed;}
.ch-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 4px;font-size:13px;color:var(--ink2);}
.ch-summary b{color:var(--ink);} .ch-bal{color:var(--ink3);font-size:12px;}
.ch-err{background:#FDECEC;border:1px solid #F3C9C9;color:#A4342E;border-radius:12px;padding:10px 14px;font-size:12.5px;margin-top:12px;}
.ch-go{position:relative;isolation:isolate;overflow:hidden;width:100%;margin-top:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;cursor:pointer;font:inherit;font-weight:800;font-size:15px;color:#fff;padding:15px 22px;border-radius:15px;transition:transform .1s,box-shadow .1s,filter .1s;
  background:linear-gradient(100deg,#12A85E 38%,#0A6A3D 78%,#075530);box-shadow:0 4px 14px rgba(12,122,70,.32),inset 0 0 0 1px rgba(231,200,121,.34);}
.ch-go::before{content:"";position:absolute;inset:4px;border:1px solid rgba(255,210,74,.42);border-radius:11px;pointer-events:none;}
.ch-go.sm{width:auto;padding:11px 18px;font-size:13.5px;margin:0;text-decoration:none;flex:0 0 auto;}
.ch-go-flower{position:absolute;z-index:-1;right:-26px;top:-26px;width:120px;height:120px;background:#FFD24A;-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.5;animation:wbDrift 60s linear infinite;}
.ch-go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 20px rgba(12,122,70,.36),inset 0 0 0 1px rgba(231,200,121,.34);filter:brightness(1.04);}
.ch-go:disabled{opacity:.42;cursor:not-allowed;box-shadow:none;}

/* dashboard */
.ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;}
.ch-card{background:#fff;border:1px solid var(--l);border-radius:18px;padding:18px;box-shadow:var(--sh-sm);transition:transform .14s,box-shadow .14s;}
.ch-card:hover{transform:translateY(-2px);box-shadow:var(--sh-md);}
.ch-card.paused{opacity:.92;background:#FCFBF6;}
.ch-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
.ch-card-name{font-weight:800;font-size:16px;letter-spacing:-.01em;}
.ch-card-niche{color:var(--ink3);font-size:12px;font-weight:500;margin-top:2px;max-width:30ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ch-badge{flex:0 0 auto;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;}
.ch-badge.live{color:#0C7A46;background:#EAF6EF;}
.ch-badge.off{color:#8A7A3A;background:#F6F0DE;}
.ch-card-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin:12px 0;font-size:12px;color:var(--ink2);font-weight:600;}
.ch-card-meta b{color:var(--ink);}
.ch-next{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--g);font-weight:700;}
.ch-next-dot{width:7px;height:7px;border-radius:50%;background:var(--g2);box-shadow:0 0 0 3px rgba(18,168,94,.18);}
.ch-paused-note{font-size:12.5px;color:#8A7A3A;font-weight:600;}
.ch-card-stats{display:flex;align-items:center;gap:20px;margin:14px 0;padding:12px 0;border-top:1px solid #F0ECDE;border-bottom:1px solid #F0ECDE;}
.ch-card-stats>div{display:flex;flex-direction:column;}
.ch-card-stats b{font-size:18px;font-weight:800;line-height:1;} .ch-card-stats span{font-size:11px;color:var(--ink3);font-weight:600;margin-top:3px;}
.ch-card-gal{margin-left:auto;font-size:12px;font-weight:700;color:var(--g);text-decoration:none;}
.ch-card-acts{display:flex;gap:8px;}
.ch-card-acts form{flex:1;}
.ch-act{width:100%;font:inherit;font-weight:700;font-size:12.5px;padding:9px;border-radius:11px;border:1px solid var(--l);background:#fff;color:var(--ink);cursor:pointer;transition:all .12s;}
.ch-act:hover:not(:disabled){border-color:#9CCBB1;background:#F7FBF8;}
.ch-act:disabled{opacity:.4;cursor:not-allowed;}
.ch-act.primary{background:#EAF6EF;border-color:var(--g);color:var(--g);}
.ch-act.ghost{color:var(--ink3);} .ch-act.ghost:hover{color:#A4342E;border-color:#E6B9B6;background:#FDF3F2;}
.ch-empty{margin-top:10px;padding:22px;border-radius:16px;background:#fff;border:1px dashed var(--l);font-size:14px;color:var(--ink2);text-align:center;}
.ch-link{color:var(--g);font-weight:700;background:none;border:0;cursor:pointer;font:inherit;text-decoration:underline;padding:0;}
@media(max-width:560px){.ch-row2{grid-template-columns:1fr;}.ch-modes{grid-template-columns:1fr;}.ch-title{font-size:25px;}}
`;
