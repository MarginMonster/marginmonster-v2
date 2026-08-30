/* Web dashboard — brand setup + plan/billing (Stripe). The wallet, tiers and
 * trial rules are IDENTICAL to the Shopify app; only the payer differs. */

import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit, Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import {
  PLAN_TIERS, PLAN_BY_KEY, TOKEN_PACKS, TOKEN_COST, TOKEN_COST_LEGEND, TRIAL_TOKEN_CAP,
  annualPrice, planCapacityLine, resolveTierKey, type PlanKey,
} from "../lib/plan-config";
import { tokensRemainingLive, planTrialing } from "../lib/tokens.server";
import { createPackCheckout, createPlanCheckout, stripeEnabled } from "../lib/stripe.server";
import { capabilitiesFor } from "../lib/capabilities.server";
import { linkedFromCache } from "../lib/social-provider.server";
import { parseSocialStats, sumStats } from "../lib/social-insights.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const tierKey = shop.activePlan?.active ? resolveTierKey(shop.activePlan.type) : null;
  const { CONTENT_LANGS, normalizeContentLang } = await import("../lib/content-lang");

  // ── Real progress numbers (drive the launch tracker + "this week" block) ──
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [contentCount, madeThisWeek, publishedCount, pendingCount] = await Promise.all([
    db.asset.count({ where: { shopId: shop.id } }),
    db.asset.count({ where: { shopId: shop.id, createdAt: { gte: weekAgo } } }),
    db.asset.count({ where: { shopId: shop.id, status: "PUBLISHED" } }),
    db.asset.count({ where: { shopId: shop.id, status: "PENDING" } }),
  ]);

  const linked = linkedFromCache(shop.socialsJson);
  const launch = {
    brand: !!shop.brandProfile,
    plan: !!shop.activePlan?.active,
    social: linked.length > 0,
    content: contentCount > 0,
  };

  // Real organic results (from linked socials) → the "it's working" moment.
  const totals = sumStats(parseSocialStats(shop.socialStatsJson));
  const wins = {
    reach: totals.reach,
    views: totals.views,
    followers: totals.followers,
    engagement: totals.likes + totals.comments + totals.shares + totals.saves,
    hasData: totals.reach + totals.views + totals.followers + totals.likes > 0,
  };

  // Referral — surface the invite once they can earn (have a plan).
  let referral: { code: string; reward: number; referredBy: boolean } | null = null;
  if (shop.activePlan?.active) {
    try {
      const { ensureReferralCode, REFERRAL_REWARD_TOKENS } = await import("../lib/referral.server");
      referral = { code: await ensureReferralCode(shop.id), reward: REFERRAL_REWARD_TOKENS, referredBy: !!shop.referredBy };
    } catch { /* non-fatal */ }
  }

  // ── Next best move: highest-value action the plan features AND the wallet
  // affords right now. Kills the blank-page moment. ──
  let nextMove: { kind: "video" | "image" | "blog"; reason: string; cost: number } | null = null;
  if (shop.brandProfile && shop.activePlan?.active) {
    try {
      const caps = capabilitiesFor(shop.activePlan);
      const balance = tokensRemainingLive(shop.activePlan);
      if (caps.has("video") && balance >= TOKEN_COST.video) {
        nextMove = { kind: "video", reason: "Video is what stops the scroll — pick a presenter, a cartoon style or a cinematic highlight.", cost: TOKEN_COST.video };
      } else if (caps.has("image") && balance >= TOKEN_COST.image) {
        nextMove = { kind: "image", reason: "A scroll-stopping image ad built on a famous ad format — done in about a minute.", cost: TOKEN_COST.image };
      } else if (caps.has("blog") && balance >= TOKEN_COST.blog) {
        nextMove = { kind: "blog", reason: "An SEO article pulls in free Google traffic that keeps working long after you post it.", cost: TOKEN_COST.blog };
      }
    } catch { /* non-fatal — the card just won't render */ }
  }

  const brandVoice = shop.brandProfile
    ? (() => { try { return JSON.parse(shop.brandProfile.voiceJson || "{}") as { tone?: string; tagline?: string; about?: string }; } catch { return null; } })()
    : null;

  return json({
    name: account.name || account.email,
    hasBrand: !!shop.brandProfile,
    brand: brandVoice,
    contentLang: normalizeContentLang(shop.contentLang),
    langs: CONTENT_LANGS,
    tier: tierKey,
    tierName: tierKey ? PLAN_BY_KEY[tierKey].name : null,
    trialing: planTrialing(shop.activePlan),
    tokens: tokensRemainingLive(shop.activePlan),
    billingOn: stripeEnabled(),
    launch,
    week: { made: madeThisWeek, posted: publishedCount, toReview: pendingCount },
    wins,
    referral,
    nextMove,
    tiers: PLAN_TIERS.map((t) => ({
      key: t.key, name: t.name, price: t.price, yearly: annualPrice(t), tagline: t.tagline,
      tokens: t.monthlyTokens, capacity: planCapacityLine(t), features: t.features, highlight: !!t.highlight,
    })),
    packs: TOKEN_PACKS.map((p) => ({ tokens: p.tokens, price: p.price, best: !!(p as { best?: boolean }).best })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const baseUrl = new URL(request.url).origin;

  if (intent === "brand") {
    const tone = ((form.get("tone") as string) || "").trim();
    const tagline = ((form.get("tagline") as string) || "").trim();
    const about = ((form.get("about") as string) || "").trim();
    if (!tone && !about) return json({ error: "Tell us a little about the brand so content sounds like you." });
    const voiceJson = JSON.stringify({ tone: tone || "friendly, confident, modern", tagline, about, vocabulary: [], values: [] });
    await db.brandProfile.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id, voiceJson, visualJson: "{}", productJson: "{}" },
      update: { voiceJson },
    });
    // Content language rides the brand form — it's part of the brand's voice.
    const { normalizeContentLang } = await import("../lib/content-lang");
    const lang = (form.get("contentLang") as string) || "";
    if (lang) await db.shop.update({ where: { id: shop.id }, data: { contentLang: normalizeContentLang(lang) } });
    return json({ ok: "Voice updated ✓ — new content will speak it. The studio is open.", voiceSaved: true });
  }

  // Referral: a new account enters someone's code (paid out on conversion).
  if (intent === "applyReferral") {
    const { applyReferralCode } = await import("../lib/referral.server");
    const r = await applyReferralCode(shop.id, (form.get("code") as string) || "");
    return json(r.ok ? { referralApplied: true } : { error: r.error });
  }

  if (intent === "subscribe") {
    if (!stripeEnabled()) return json({ error: "Billing is coming online — check back shortly." });
    const tierKey = form.get("tier") as PlanKey;
    if (!PLAN_BY_KEY[tierKey]) return json({ error: "Unknown plan." });
    // Don't let an active subscriber buy the plan they are already on. `pack`
    // has always guarded this; `subscribe` did not, so a re-post (or a stale
    // tab) opened a second Stripe subscription for the same tier and billed
    // twice. A DIFFERENT tier is a legitimate upgrade/downgrade and still goes
    // through — this only blocks the pure duplicate.
    if (shop.activePlan?.active && resolveTierKey(shop.activePlan.type) === tierKey) {
      return json({ error: `You're already on ${PLAN_BY_KEY[tierKey].name}.` });
    }
    const annual = form.get("annual") === "1";
    try {
      const url = await createPlanCheckout({ accountId: account.id, email: account.email, tierKey, annual, baseUrl });
      return redirect(url);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Checkout couldn't start." });
    }
  }

  if (intent === "pack") {
    if (!stripeEnabled()) return json({ error: "Billing is coming online — check back shortly." });
    if (!shop.activePlan?.active) return json({ error: "Pick a plan first — packs top up a plan's balance." });
    const tokens = parseInt((form.get("tokens") as string) || "0", 10);
    try {
      const url = await createPackCheckout({ accountId: account.id, email: account.email, tokens, baseUrl });
      return redirect(url);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Checkout couldn't start." });
    }
  }

  return json({});
};

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(n));

const PACK_FRAMING: Record<number, string> = {
  250: "A quick refill — a handful of extra videos or a full image campaign.",
  750: "The workhorse pack — a whole campaign with room to spare.",
  2000: "The best rate per token in the shop — go all-in.",
};

export default function WebDashboard() {
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const [params] = useSearchParams();
  const busy = nav.state !== "idle";

  // ── Purchase-success celebration modal (replaces the old flat banners).
  // Initialized from ?welcome= / ?topped=; the params are scrubbed on dismiss.
  const [success, setSuccess] = useState<null | { kind: "plan"; key: PlanKey } | { kind: "tokens"; n: number }>(() => {
    const welcome = params.get("welcome");
    const topped = params.get("topped");
    return welcome && PLAN_BY_KEY[welcome as PlanKey]
      ? { kind: "plan", key: welcome as PlanKey }
      : topped
        ? { kind: "tokens", n: Number(topped) || 0 }
        : null;
  });
  const closeSuccess = () => {
    setSuccess(null);
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("welcome");
      u.searchParams.delete("topped");
      window.history.replaceState({}, "", u.toString());
    } catch { /* cosmetic */ }
  };

  // ── Launch tracker: auto-hides once every step is done; dismissible (per
  // browser) once you've seen it through.
  const [launchHidden, setLaunchHidden] = useState(false);
  useEffect(() => { try { if (localStorage.getItem("emWebLaunchDone") === "1") setLaunchHidden(true); } catch { /* ignore */ } }, []);
  const dismissLaunch = () => { try { localStorage.setItem("emWebLaunchDone", "1"); } catch { /* ignore */ } setLaunchHidden(true); };

  // ── Billing period toggle + referral input.
  const [annual, setAnnual] = useState(false);
  const [refInput, setRefInput] = useState("");
  const [refCopied, setRefCopied] = useState(false);
  const referralApplied = !!(actionData && "referralApplied" in actionData);
  const copyReferral = () => {
    if (!d.referral) return;
    const msg = `Try EasyMode — AI videos, image ads & articles for your store, made and posted for you. Use my code ${d.referral.code} when you pick a plan and we both get ${d.referral.reward} free tokens. https://easymodeapp.com`;
    navigator.clipboard?.writeText(msg).then(() => { setRefCopied(true); setTimeout(() => setRefCopied(false), 1800); }).catch(() => { /* blocked */ });
  };

  const err = actionData && "error" in actionData ? (actionData.error as string) : null;
  const ok = actionData && "ok" in actionData ? (actionData.ok as string) : null;

  const steps = [
    { key: "brand", label: "Set your brand voice", hint: "So content sounds like you", done: d.launch.brand, href: "#brand" },
    { key: "plan", label: "Pick your plan", hint: "Start your 7-day free trial", done: d.launch.plan, href: "#plans" },
    { key: "social", label: "Link your socials", hint: "So pieces can post themselves", done: d.launch.social, href: "/web/connect" },
    { key: "content", label: "Make your first piece", hint: "A video, image ad or article", done: d.launch.content, href: "/web/studio" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const nextKey = steps.find((s) => !s.done)?.key;

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: DASH_CSS }} />
      <h1 className="wb-h1">Welcome, {d.name}.</h1>
      <p className="wb-sub">
        {d.tierName
          ? <>You&apos;re on <b>{d.tierName}</b>{d.trialing ? " (free trial)" : ""} with <b>{d.tokens.toLocaleString("en-US")}</b> tokens ready.</>
          : "Two steps to your first AI content drop: set your brand voice, pick a plan."}
      </p>

      {success && (
        <div className="ws-scrim" role="dialog" aria-label="Purchase confirmed" onClick={closeSuccess}>
          <div className="ws-modal" onClick={(e) => e.stopPropagation()}>
            <span className="ws-mrose" aria-hidden="true" />
            <div className="ws-mi">{success.kind === "plan" ? "🎉" : "🪙"}</div>
            {success.kind === "plan" ? (
              <>
                <b className="ws-mh">{PLAN_BY_KEY[success.key]?.name ?? "Your plan"} is live</b>
                <p className="ws-mp">Your marketing just leveled up — your 7-day free trial starts now, with {PLAN_BY_KEY[success.key]?.monthlyTokens.toLocaleString("en-US")} 🪙 tokens loading every month.</p>
              </>
            ) : (
              <>
                <b className="ws-mh">+{success.n.toLocaleString("en-US")} tokens</b>
                <p className="ws-mp">They&apos;re landing on your balance now — spend them on anything your plan unlocks.</p>
              </>
            )}
            <Link className="wb-btn ws-mcta" to="/web/studio" onClick={closeSuccess}>Open the Studio →</Link>
            <button type="button" className="ws-mclose" onClick={closeSuccess}>Not now</button>
          </div>
        </div>
      )}

      {err && <div className="wb-err">{err}</div>}
      {ok && <div className="wb-ok">{ok}</div>}
      {referralApplied && <div className="wb-ok">Code applied ✓ — your bonus tokens land when your paid plan starts.</div>}

      {/* ── Launch tracker ─────────────────────────────────────────────── */}
      {!allDone && !launchHidden && (
        <div className="wd-launch">
          <div className="wdl-top">
            <div className="wdl-title">🚀 Launch tracker <span>{doneCount}/{steps.length}</span></div>
            <button type="button" className="wdl-x" onClick={dismissLaunch} aria-label="Dismiss">✕</button>
          </div>
          <div className="wdl-bar"><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
          <div className="wdl-steps">
            {steps.map((s) => {
              const isNext = s.key === nextKey;
              const inner = (
                <>
                  <span className={`wdl-tick${s.done ? " on" : ""}`}>{s.done ? "✓" : ""}</span>
                  <span className="wdl-lab"><b>{s.label}</b><em>{s.hint}</em></span>
                  {isNext && <span className="wdl-go">Start ›</span>}
                </>
              );
              const cls = `wdl-step${s.done ? " done" : ""}${isNext ? " next" : ""}`;
              if (s.done) return <div className={cls} key={s.key}>{inner}</div>;
              if (s.href.startsWith("#")) return <a className={cls} key={s.key} href={s.href}>{inner}</a>;
              return <Link className={cls} key={s.key} to={s.href}>{inner}</Link>;
            })}
          </div>
        </div>
      )}

      {/* ── This week ──────────────────────────────────────────────────── */}
      {d.launch.plan && (
        <div className="wd-week">
          <div className="wdw-big">
            {d.week.made > 0
              ? <>This week you made <b>{d.week.made}</b> {d.week.made === 1 ? "piece" : "pieces"}{d.week.posted > 0 ? <> and posted <b>{d.week.posted}</b></> : null}.</>
              : "Nothing made this week yet — the Studio is one click away."}
          </div>
          <div className="wdw-row">
            <div className="wdw-st"><div className="n">{d.week.made}</div><div className="k">Made</div></div>
            <div className="wdw-st"><div className="n">{d.week.posted}</div><div className="k">Posted</div></div>
            <div className="wdw-st"><div className="n">{d.week.toReview}</div><div className="k">To review</div></div>
          </div>
          {d.week.toReview > 0 && (
            <Link className="wdw-review" to="/web/archive">
              <span className="rv-n">{d.week.toReview}</span>
              {d.week.toReview === 1 ? "new piece in your Archive" : "new pieces in your Archive"} →
            </Link>
          )}
        </div>
      )}

      {/* ── Results tiles (only when real numbers exist) ───────────────── */}
      {d.wins.hasData && (() => {
        const tiles = [
          d.wins.reach > 0 && { n: d.wins.reach, k: "reached" },
          d.wins.views > 0 && { n: d.wins.views, k: "views" },
          d.wins.engagement > 0 && { n: d.wins.engagement, k: "engagements" },
          d.wins.followers > 0 && { n: d.wins.followers, k: "followers" },
        ].filter(Boolean).slice(0, 4) as { n: number; k: string }[];
        return (
          <div className="wd-wins">
            <div className="wdn-tag" style={{ marginBottom: 8 }}>📈 Your content is working</div>
            <div className="wdw-grid">
              {tiles.map((t) => (
                <div className="wdw-tile" key={t.k}><b>{fmtK(t.n)}</b><span>{t.k}</span></div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Next best move ─────────────────────────────────────────────── */}
      {d.nextMove && (
        <Link className="wd-next" to="/web/studio">
          <div className="wdn-tag">Your next move</div>
          <div className="wdn-row">
            <span className="wdn-kind">{d.nextMove.kind === "video" ? "🎬" : d.nextMove.kind === "image" ? "🖼" : "✍️"}</span>
            <div className="wdn-body">
              <b>Make {d.nextMove.kind === "video" ? "a product video" : d.nextMove.kind === "image" ? "an image ad" : "an article"}</b>
              <p>{d.nextMove.reason}</p>
            </div>
          </div>
          <span className="wdn-cta">Create it — {d.nextMove.cost} tokens →</span>
        </Link>
      )}

      {/* ── Brand voice ────────────────────────────────────────────────── */}
      <div id="brand" className="wb-card" style={{ marginBottom: 22, scrollMarginTop: 80 }}>
        <div className="wb-price-name">1 · Brand voice {d.hasBrand && "✓"}</div>
        <p className="wb-note" style={{ margin: "6px 0 0" }}>Every script, caption and article is written in your voice.</p>
        {d.hasBrand && d.brand && (d.brand.tagline || d.brand.tone || d.brand.about) && (
          <div className="wd-voice">
            {d.brand.tagline && <div className="wdv-quote">“{d.brand.tagline}”</div>}
            <div className="wdv-chips">
              {d.brand.tone && <span className="wdv-chip tone">{d.brand.tone}</span>}
              {d.brand.about && <span className="wdv-chip">{d.brand.about.length > 90 ? `${d.brand.about.slice(0, 90)}…` : d.brand.about}</span>}
            </div>
          </div>
        )}
        <Form method="post">
          <input type="hidden" name="intent" value="brand" />
          <label className="wb-lbl">What do you sell, and to whom?</label>
          <textarea className="wb-ta" name="about" placeholder="Handmade ceramic mugs for coffee people who like slow mornings…" defaultValue={d.brand?.about || ""} />
          <label className="wb-lbl">Tone (optional)</label>
          <input className="wb-in" name="tone" placeholder="warm, playful, a little cheeky" defaultValue={d.brand?.tone || ""} />
          <label className="wb-lbl">Tagline (optional)</label>
          <input className="wb-in" name="tagline" placeholder="Slow mornings, served hot." defaultValue={d.brand?.tagline || ""} />
          <label className="wb-lbl">Content language — everything generates in this language</label>
          <select className="wb-sel" name="contentLang" defaultValue={d.contentLang}>
            {Object.entries(d.langs).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <div style={{ marginTop: 14 }}>
            <button className="wb-btn ghost" disabled={busy}>{d.hasBrand ? "Update brand voice" : "Save brand voice"}</button>
          </div>
        </Form>
      </div>

      {/* ── Plans ──────────────────────────────────────────────────────── */}
      <div id="plans" className="wb-price-name" style={{ marginBottom: 10, scrollMarginTop: 80 }}>2 · Your plan</div>
      {!d.billingOn && <div className="wb-err">Billing is coming online — plans can&apos;t be purchased on the web quite yet.</div>}
      <div className="wd-toggle" role="group" aria-label="Billing period">
        <button type="button" className={annual ? "" : "on"} onClick={() => setAnnual(false)}>Monthly</button>
        <button type="button" className={annual ? "on" : ""} onClick={() => setAnnual(true)}>Annual <span>2 months free</span></button>
      </div>
      <div className="wb-grid" style={{ marginBottom: 22 }}>
        {d.tiers.map((t) => (
          <div className={`wb-card wd-plancard${t.highlight ? " hot" : ""}`} key={t.key}>
            {t.highlight && <div className="wd-ribbon">Most popular</div>}
            <div className="wb-price-name">{t.name} {d.tier === t.key && "· your plan ✓"}</div>
            <div className="wd-tagline">{t.tagline}</div>
            <div className="wb-price-amt">
              {annual ? <>${t.yearly.toLocaleString("en-US")}<small>/yr</small></> : <>${t.price}<small>/mo</small></>}
            </div>
            <div className="wb-note">{annual ? `Just $${Math.round((t.price * 10) / 12)}/mo, billed yearly · 2 months free` : "billed monthly"}</div>
            <div className="wb-note">🪙 {t.tokens.toLocaleString("en-US")} tokens/mo</div>
            <div className="wb-note">{t.capacity}</div>
            <ul className="wb-feats">{t.features.map((f) => <li key={f}>{f}</li>)}</ul>
            {d.tier !== t.key && (
              <>
                <Form method="post">
                  <input type="hidden" name="intent" value="subscribe" />
                  <input type="hidden" name="tier" value={t.key} />
                  {annual && <input type="hidden" name="annual" value="1" />}
                  <button className="wb-btn" disabled={busy || !d.billingOn}>Start free trial</button>
                </Form>
                <div className="wd-trial">7-day free trial ({TRIAL_TOKEN_CAP} tokens to play) · then ${annual ? `${t.yearly.toLocaleString("en-US")}/yr` : `${t.price}/mo`}</div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* One balance, one currency — what each action costs */}
      <div className="wd-legend">
        <div className="wdg-h">One balance runs everything</div>
        <div className="wdg-row">
          {TOKEN_COST_LEGEND.map((l) => (
            <div className="wdg-item" key={l.action}><b>{l.cost}</b><span>{l.label}</span></div>
          ))}
        </div>
        <div className="wdg-note">Your plan unlocks WHICH generators you can use; tokens meter HOW MUCH you make. Run out mid-month? Top up below — tokens never unlock a generator your plan doesn&apos;t include.</div>
      </div>

      {/* ── Top-ups ────────────────────────────────────────────────────── */}
      {d.tier && (
        <>
          <div className="wb-price-name" style={{ marginBottom: 10 }}>Top up tokens</div>
          <div className="wb-grid">
            {d.packs.map((p) => (
              <div className={`wb-card wd-plancard${p.best ? " hot" : ""}`} key={p.tokens}>
                {p.best && <div className="wd-ribbon gold">Best value</div>}
                <div className="wb-price-name">+{p.tokens.toLocaleString("en-US")} tokens</div>
                <p className="wb-note" style={{ margin: "6px 0 4px" }}>{PACK_FRAMING[p.tokens] || "Extra fuel for anything your plan unlocks."}</p>
                <div className="wb-note" style={{ margin: "0 0 12px" }}>One-time · they never expire</div>
                <Form method="post">
                  <input type="hidden" name="intent" value="pack" />
                  <input type="hidden" name="tokens" value={p.tokens} />
                  <button className="wb-btn gold" disabled={busy || !d.billingOn}>Buy for ${p.price}</button>
                </Form>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Referral ───────────────────────────────────────────────────── */}
      {d.referral && (
        <div className="wd-refer">
          <div className="wdr-main">
            <b>Refer a friend — you both get {d.referral.reward} 🪙</b>
            <span>Share your code; tokens land in both wallets when they start a paid plan.</span>
            <div className="wdr-act">
              <span className="wdr-code">{d.referral.code}</span>
              <button type="button" className="wb-btn" onClick={copyReferral}>{refCopied ? "Copied ✓" : "Copy invite"}</button>
            </div>
          </div>
          {!d.referral.referredBy && !referralApplied && (
            <div className="wdr-enter">
              <label className="wb-lbl" style={{ margin: "0 0 6px" }}>Got a code from someone?</label>
              <div className="wdr-row">
                <input className="wb-in" value={refInput} maxLength={12} placeholder="ENTER CODE" onChange={(e) => setRefInput(e.target.value.toUpperCase())} />
                <button
                  type="button"
                  className="wb-btn ghost"
                  disabled={busy || refInput.trim().length < 5}
                  onClick={() => submit({ intent: "applyReferral", code: refInput.trim() }, { method: "post" })}
                >Apply</button>
              </div>
            </div>
          )}
          {d.referral.referredBy && (
            <div className="wdr-enter"><div className="wb-note">You joined with a referral — enjoy your bonus tokens 🪙</div></div>
          )}
        </div>
      )}

      <p className="wb-note" style={{ marginTop: 26 }}>
        Ready to create? <Link to="/web/studio">Open the Studio →</Link>
      </p>
    </div>
  );
}

/* Route-local dashboard styles — GStyle palette (paper #F4F1E6, card #FDFCF7,
 * ink #14201A, green #12A85E, gold #B08526/#E7C879). */
const DASH_CSS = `
/* launch tracker */
.wd-launch{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px;margin:0 0 22px;box-shadow:0 2px 8px rgba(20,32,26,.05);}
.wdl-top{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.wdl-title{font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink);}
.wdl-title span{margin-left:8px;font-size:12px;color:var(--ink2);font-weight:700;}
.wdl-x{border:0;background:none;cursor:pointer;color:var(--ink2);font-size:14px;padding:4px;}
.wdl-x:hover{color:var(--ink)}
.wdl-bar{height:7px;border-radius:99px;background:#EAE6D8;margin:10px 0 14px;overflow:hidden;}
.wdl-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#12A85E,#E7C879);transition:width .4s ease;}
.wdl-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;}
.wdl-step{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:13px;border:1px solid var(--line);background:#fff;
  text-decoration:none;color:var(--ink);text-align:left;font:inherit;cursor:default;}
.wdl-step.next{border-color:rgba(18,168,94,.55);box-shadow:0 0 0 1px rgba(18,168,94,.25);cursor:pointer;}
.wdl-step.next:hover{background:#F6FBF7;}
.wdl-step.done{opacity:.62;}
.wdl-tick{flex:0 0 auto;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;border:1.5px solid var(--line);
  font-size:12px;font-weight:900;color:#fff;background:#fff;}
.wdl-tick.on{background:#12A85E;border-color:#12A85E;}
.wdl-lab{display:flex;flex-direction:column;min-width:0;}
.wdl-lab b{font-size:12.5px;font-weight:700;color:var(--ink);}
.wdl-lab em{font-style:normal;font-size:11px;color:var(--ink2);}
.wdl-go{margin-left:auto;flex:0 0 auto;font-family:Poppins,sans-serif;font-weight:800;font-size:12px;color:var(--green2);white-space:nowrap;}
/* this-week block */
.wd-week{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px;margin:0 0 22px;box-shadow:0 2px 8px rgba(20,32,26,.05);}
.wdw-big{font-family:Poppins,sans-serif;font-weight:700;font-size:16px;color:var(--ink);margin-bottom:12px;}
.wdw-big b{color:var(--green);}
.wdw-row{display:flex;gap:10px;flex-wrap:wrap;}
.wdw-st{flex:1;min-width:90px;background:#fff;border:1px solid var(--line);border-radius:13px;padding:10px 14px;text-align:center;}
.wdw-st .n{font-family:Poppins,sans-serif;font-weight:800;font-size:20px;color:var(--ink);}
.wdw-st .k{font-size:11px;color:var(--ink2);font-weight:600;letter-spacing:.03em;text-transform:uppercase;}
.wdw-review{display:inline-flex;align-items:center;gap:8px;margin-top:12px;font-weight:700;font-size:13px;color:var(--green);text-decoration:none;}
.wdw-review:hover{text-decoration:underline}
.wdw-review .rv-n{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#12A85E;color:#fff;font-size:12px;font-weight:800;}
/* results tiles */
.wd-wins{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px 20px;margin:0 0 22px;box-shadow:0 2px 8px rgba(20,32,26,.05);}
.wdw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;}
.wdw-tile{background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px;text-align:center;}
.wdw-tile b{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:20px;color:var(--green);}
.wdw-tile span{font-size:11px;color:var(--ink2);font-weight:600;letter-spacing:.03em;text-transform:uppercase;}
/* next-move card */
.wd-next{display:block;background:linear-gradient(165deg,#FDFCF7,#F3F8F1);border:1px solid rgba(18,168,94,.4);border-radius:18px;
  padding:16px 20px;margin:0 0 22px;text-decoration:none;color:var(--ink);box-shadow:0 2px 10px rgba(12,122,70,.08);transition:transform .12s,box-shadow .12s;}
.wd-next:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(12,122,70,.14);}
.wdn-tag{display:inline-block;font-family:Poppins,sans-serif;font-weight:800;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--gold-deep);background:rgba(231,200,121,.28);border:1px solid rgba(176,133,38,.3);border-radius:999px;padding:3px 10px;}
.wdn-row{display:flex;align-items:center;gap:14px;margin:10px 0;}
.wdn-kind{flex:0 0 auto;width:48px;height:48px;border-radius:14px;display:grid;place-items:center;font-size:24px;background:#fff;border:1px solid var(--line);}
.wdn-body b{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink);}
.wdn-body p{margin:3px 0 0;font-size:12.5px;color:var(--ink2);line-height:1.45;}
.wdn-cta{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:var(--green);}
/* plans: toggle, ribbon, tagline, trial line */
.wd-toggle{display:inline-flex;gap:4px;background:#fff;border:1px solid var(--line);border-radius:999px;padding:4px;margin:0 0 16px;}
.wd-toggle button{border:0;background:none;cursor:pointer;font-family:Poppins,sans-serif;font-weight:700;font-size:13px;color:var(--ink2);
  padding:7px 16px;border-radius:999px;}
.wd-toggle button.on{background:linear-gradient(165deg,#12A85E,#0B6B3E);color:#fff;box-shadow:0 2px 8px rgba(12,122,70,.25);}
.wd-toggle button span{font-size:10.5px;font-weight:800;color:#E7C879;margin-left:5px;}
.wd-toggle button:not(.on) span{color:var(--gold);}
.wd-plancard{position:relative;}
.wd-plancard.hot{border-color:rgba(18,168,94,.5);box-shadow:0 6px 18px rgba(12,122,70,.12);}
.wd-ribbon{position:absolute;top:-11px;left:50%;transform:translateX(-50%);white-space:nowrap;font-family:Poppins,sans-serif;
  font-weight:800;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#fff;padding:4px 14px;border-radius:999px;
  background:linear-gradient(165deg,#12A85E,#0B6B3E);box-shadow:0 3px 8px rgba(12,122,70,.3);}
.wd-ribbon.gold{background:linear-gradient(165deg,#C98F12,#8a6207);box-shadow:0 3px 8px rgba(176,133,38,.35);}
.wd-tagline{font-size:12.5px;color:var(--ink2);line-height:1.45;margin:4px 0 2px;}
.wd-trial{margin-top:8px;font-size:11.5px;color:var(--ink2);}
/* token-cost legend */
.wd-legend{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px;margin:0 0 26px;box-shadow:0 2px 8px rgba(20,32,26,.05);}
.wdg-h{font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink);margin-bottom:10px;}
.wdg-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;}
.wdg-item{flex:1;min-width:110px;display:flex;align-items:baseline;gap:7px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:9px 13px;}
.wdg-item b{font-family:Poppins,sans-serif;font-weight:800;font-size:17px;color:var(--gold-deep);}
.wdg-item span{font-size:12px;color:var(--ink2);font-weight:600;}
.wdg-note{font-size:12px;color:var(--ink2);line-height:1.5;}
/* referral */
.wd-refer{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;background:var(--card);border:1px solid var(--line);
  border-radius:18px;padding:18px 20px;margin:26px 0 0;box-shadow:0 2px 8px rgba(20,32,26,.05);}
.wdr-main{flex:1 1 300px;}
.wdr-main b{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink);}
.wdr-main span{display:block;font-size:12.5px;color:var(--ink2);margin:4px 0 12px;}
.wdr-act{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.wdr-code{font-family:Poppins,sans-serif;font-weight:800;font-size:17px;letter-spacing:.14em;color:var(--gold-deep);
  background:rgba(231,200,121,.24);border:1.5px dashed rgba(176,133,38,.5);border-radius:12px;padding:8px 16px;}
.wdr-enter{flex:1 1 240px;}
.wdr-row{display:flex;gap:8px;}
.wdr-row input{flex:1;letter-spacing:.12em;font-weight:700;text-transform:uppercase;}
/* brand voice readout */
.wd-voice{margin:12px 0 2px;}
.wdv-quote{font-family:Poppins,sans-serif;font-weight:700;font-size:15px;color:var(--ink);margin-bottom:8px;}
.wdv-chips{display:flex;gap:8px;flex-wrap:wrap;}
.wdv-chip{font-size:12px;color:var(--ink2);background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-weight:600;}
.wdv-chip.tone{color:#0A3D26;background:#EAF6EF;border-color:#BFE2CD;}
`;
