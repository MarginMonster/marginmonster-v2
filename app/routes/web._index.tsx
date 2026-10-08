/* Web dashboard — brand setup + plan/billing (Stripe). The wallet, tiers and
 * trial rules are IDENTICAL to the Shopify app; only the payer differs. */

import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit, Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { Ico } from "../lib/icons";
import {
  PLAN_TIERS, MARKETING_TIERS, PLAN_BY_KEY, CREATOR_PRICE, TOKEN_PACKS, TOKEN_COST, TOKEN_COST_LEGEND, TRIAL_TOKEN_CAP,
  annualPrice, planCapacityLine, resolveTierKey, type PlanKey,
} from "../lib/plan-config";
import { tokensRemainingLive, planTrialing } from "../lib/tokens.server";
import { createPackCheckout, createPlanCheckout, resolvePendingCheckout, setSubscriptionCreatorAddon, stripeEnabled, trialAlreadyTaken } from "../lib/stripe.server";
import { capabilitiesFor } from "../lib/capabilities.server";
import { linkedFromCache } from "../lib/social-provider.server";
import { parseSocialStats, sumStats } from "../lib/social-insights.server";
import { externalOrigin } from "../lib/origin.server";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = () => [{ title: "Dashboard · EasyMode" }];

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

  // REFERRAL CODES COULD NEVER BE REDEEMED.
  //
  // This whole block — including the “Got a code from someone?” input, the
  // only place in the app a code can be entered — was built solely when
  // shop.activePlan?.active. applyReferralCode refuses EXACTLY that state,
  // and for a good reason spelled out in referral.server.ts: the reward buys
  // a conversion, and there is none to buy from someone already paying. So
  // the box was shown only to people it would reject, and never to the new
  // stores the programme exists for. Every code handed out was dead on
  // arrival, and the invite copy promises both wallets 150 tokens.
  //
  // Built for everyone now; the two halves are gated separately below.
  let referral: { code: string; reward: number; referredBy: boolean; canEarn: boolean } | null = null;
  try {
    const { ensureReferralCode, REFERRAL_REWARD_TOKENS } = await import("../lib/referral.server");
    referral = {
      code: await ensureReferralCode(shop.id),
      reward: REFERRAL_REWARD_TOKENS,
      referredBy: !!shop.referredBy,
      // Sharing a code only pays once THIS store is on a plan.
      canEarn: !!shop.activePlan?.active,
    };
  } catch { /* non-fatal */ }

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
    // Local-part, not the whole address, when no name is set — "Welcome,
    // daniel." reads better than a full email, and a long email with no space
    // to wrap pushed the dashboard H1 into horizontal scroll at phone width.
    // (The HUD in web.tsx already greets this way.) The H1 also gets
    // overflow-wrap as a belt-and-braces guard for a very long display name.
    name: account.name?.trim() || account.email.split("@")[0],
    hasBrand: !!shop.brandProfile,
    brand: brandVoice,
    contentLang: normalizeContentLang(shop.contentLang),
    langs: CONTENT_LANGS,
    tier: tierKey,
    tierName: tierKey ? PLAN_BY_KEY[tierKey].name : null,
    // Creator section entitlement + how it was granted, for the Creator add-on
    // card on the plans page.
    hasCreator: capabilitiesFor(shop.activePlan).has("creator"),
    creatorAddon: !!shop.activePlan?.creatorAddon,
    trialing: planTrialing(shop.activePlan),
    // A trial is once per ACCOUNT. The plan cards promised a free one to
    // everybody, including merchants who had already spent theirs — and
    // createPlanCheckout correctly does not attach one, so Stripe charged in
    // full on a page that had just said “7-day free trial”.
    trialAvailable: !trialAlreadyTaken(account),
    tokens: tokensRemainingLive(shop.activePlan),
    billingOn: stripeEnabled(),
    launch,
    week: { made: madeThisWeek, posted: publishedCount, toReview: pendingCount },
    wins,
    referral,
    nextMove,
    tiers: MARKETING_TIERS.map((t) => ({
      key: t.key, name: t.name, price: t.price, yearly: annualPrice(t), tagline: t.tagline,
      tokens: t.monthlyTokens, capacity: planCapacityLine(t), features: t.features, highlight: !!t.highlight,
    })),
    packs: TOKEN_PACKS.map((p) => ({ tokens: p.tokens, price: p.price, best: !!(p as { best?: boolean }).best })),
    // Cancelled but still inside the period they paid for.
    cancelPending: !!shop.activePlan?.cancelAtPeriodEnd,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  // Not `new URL(request.url).origin` — behind Render’s TLS-terminating edge
  // that reads http://, which Stripe then uses for the checkout product image
  // (dropped as mixed content on their https page) and for success_url.
  const baseUrl = externalOrigin(request);

  if (intent === "brand") {
    const tone = ((form.get("tone") as string) || "").trim();
    const tagline = ((form.get("tagline") as string) || "").trim();
    const about = ((form.get("about") as string) || "").trim();
    if (!tone && !about) return json({ error: "Tell us a little about the brand so content sounds like you." });
    const voiceJson = JSON.stringify({ tone: tone || "friendly, confident, modern", tagline, about, vocabulary: [], values: [] });
    // "{}" here meant every prompt that reads productJson.positioning got the
    // literal string "undefined" for a web merchant. What the merchant typed
    // in "about" IS their positioning, so carry it across — merged into any
    // existing profile rather than replacing it, because a store that also
    // connected Shopify has real categories, avgPrice and storeName in there
    // that this form knows nothing about and must not wipe.
    const prior = await db.brandProfile.findUnique({
      where: { shopId: shop.id },
      select: { productJson: true },
    });
    let productMeta: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(prior?.productJson || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) productMeta = parsed;
    } catch { /* a corrupt blob is worth less than what the merchant just typed */ }
    if (about) productMeta.positioning = about.slice(0, 600);
    // Shop rows for the web have a synthetic domain and no display name, so
    // the store name comes off the account. Never overwritten — a Shopify
    // import knows the real storefront name.
    if (!productMeta.storeName && account.name) productMeta.storeName = account.name;
    const productJson = JSON.stringify(productMeta);
    await db.brandProfile.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id, voiceJson, visualJson: "{}", productJson },
      update: { voiceJson, productJson },
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
    // Bolt the $6.99 Creator section onto this plan (ignored on CREATOR itself,
    // and on Legend which already includes it). The per-plan toggle sends an
    // EXPLICIT withCreator ("1" or "0") — honour it so the add-on can be removed,
    // not just added. Only when a form is SILENT on it (e.g. a legacy/other path)
    // do we carry the existing add-on FORWARD, so a tier change never silently
    // drops (and stops billing) a Creator entitlement the merchant pays for.
    const creatorField = form.get("withCreator");
    const withCreator = (creatorField != null ? creatorField === "1" : !!shop.activePlan?.creatorAddon)
      && tierKey !== "CREATOR" && tierKey !== "ANTHEM";
    // Don't let an active subscriber buy the plan they are already on. `pack`
    // has always guarded this; `subscribe` did not, so a re-post (or a stale
    // tab) opened a second Stripe subscription for the same tier and billed
    // twice. A DIFFERENT tier is a legitimate upgrade/downgrade and still goes
    // through — this only blocks the pure duplicate. Toggling the Creator add-on
    // on the SAME tier is a real change, so it is NOT a duplicate.
    if (shop.activePlan?.active && resolveTierKey(shop.activePlan.type) === tierKey && !!shop.activePlan.creatorAddon === withCreator) {
      return json({ error: `You're already on ${PLAN_BY_KEY[tierKey].name}${withCreator ? " with Creator" : ""}.` });
    }
    // SAME tier, only the Creator add-on is changing → modify the LIVE
    // subscription in place (prorated). Re-running checkout here would open a
    // fresh full-price subscription and cancel the current one with no refund.
    if (shop.activePlan?.active && account.stripeSubId
        && resolveTierKey(shop.activePlan.type) === tierKey
        && tierKey !== "CREATOR" && tierKey !== "ANTHEM"
        && !!shop.activePlan.creatorAddon !== withCreator) {
      const r = await setSubscriptionCreatorAddon({ subId: account.stripeSubId, on: withCreator });
      if (!r.ok) return json({ error: r.error });
      // Mirror locally for an instant UI update; the subscription.updated webhook
      // re-affirms it from the subscription metadata (the source of truth).
      await db.plan.updateMany({ where: { shopId: shop.id }, data: { creatorAddon: withCreator } }).catch(() => { /* non-fatal */ });
      return json({ ok: withCreator ? "Creator added to your plan — your Create section is unlocked. 🎨" : "Creator removed from your plan." });
    }
    // ...but that guard can only read what the WEBHOOK writes, and Stripe
    // redirects the merchant back the instant checkout completes. For the first
    // seconds after paying, plan.active is still false, the HUD still says "No
    // plan", and the success modal above is drawn from the ?welcome= parameter
    // alone — so re-reading that screen and clicking again passed this check
    // and opened a SECOND full-price subscription. activateStripePlan then
    // cancels the superseded one, but Stripe has already raised its invoice and
    // nothing refunds it.
    //
    // So ask Stripe about the checkout we know is in flight before opening
    // another. An abandoned or expired session is cleared and we fall straight
    // through, so nobody is locked out of subscribing; a PAID one activates
    // here and tells the merchant the truth instead of charging them twice.
    try {
      const pending = await resolvePendingCheckout(account.id);
      if (pending.state === "paid") {
        const name = PLAN_BY_KEY[(pending.tierKey || tierKey) as PlanKey]?.name || "Your plan";
        return json({ error: `${name} is already active — that last payment just took a moment to land. Reload to see it.` });
      }
    } catch (e) {
      // Never block a checkout on the guard itself failing: the window this
      // closes is narrow, and refusing to sell is worse than re-opening it.
      console.error("[web] pending-checkout resolve failed (continuing):", e instanceof Error ? e.message : e);
    }
    const annual = form.get("annual") === "1";
    try {
      const url = await createPlanCheckout({
        accountId: account.id,
        email: account.email,
        tierKey,
        annual,
        baseUrl,
        withCreator,
        // One trial per account, and a tier change mid-trial keeps the
        // original end date rather than minting seven more free days.
        trialUsedAt: trialAlreadyTaken(account) ? (account.trialUsedAt ?? account.createdAt) : null,
        trialEndsAt: shop.activePlan?.trialEndsAt ?? null,
        customerId: account.stripeCustomerId,
      });
      return redirect(url);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : "Checkout couldn't start." });
    }
  }

  // "Cancel anytime" is printed on the Stripe checkout page and in the terms.
  // Until now it was not true anywhere in the product.
  if (intent === "cancelPlan" || intent === "resumePlan") {
    const { setPlanCancellation } = await import("../lib/stripe.server");
    const r = await setPlanCancellation(account.id, intent === "cancelPlan");
    if (!r.ok) return json({ error: r.error || "Couldn't update your plan just now." });
    return json({
      ok:
        intent === "cancelPlan"
          ? "Your plan won't renew. You keep everything until the end of the period you've already paid for."
          : "Your plan is back on — it'll renew as normal.",
    });
  }

  if (intent === "pack") {
    if (!stripeEnabled()) return json({ error: "Billing is coming online — check back shortly." });
    if (!shop.activePlan?.active) return json({ error: "Pick a plan first — packs top up a plan's balance." });
    // A TRIAL WILL NOT LET THEM SPEND THIS.
    //
    // Purchased tokens land in tokensExtra, and for the whole trial both the
    // spend path and the balance display deliberately exclude that bucket —
    // the ceiling is the point of a trial. So a merchant who hit the cap on
    // day one could be shown "Top up tokens", pay $140 for two thousand of
    // them, and watch the balance not move: no error, no explanation, nothing
    // to spend. Ending the trial is what actually unlocks them, and that
    // button already exists in the Studio.
    if (planTrialing(shop.activePlan)) {
      return json({
        error:
          "Top-ups unlock when your trial converts — they can't be spent before then. " +
          "Start your plan now from the Studio and your balance opens up straight away.",
      });
    }
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
  // Per-plan Creator add-on toggle. Keyed by tier so each card tracks its own
  // "+ Creator" choice. If the merchant already pays for the add-on, default it
  // ON for every addable card — so switching tiers KEEPS Creator (visibly, and
  // still removable) instead of silently dropping an entitlement they pay for.
  const [wantCreator, setWantCreator] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    if (d.creatorAddon) for (const t of d.tiers) if (t.key !== "ANTHEM") o[t.key] = true;
    return o;
  });
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
            <div className="ws-mi"><Ico n={success.kind === "plan" ? "check" : "coin"} size={30} /></div>
            {success.kind === "plan" ? (
              <>
                <b className="ws-mh">{PLAN_BY_KEY[success.key]?.name ?? "Your plan"} is live</b>
                {/* Only the FIRST subscription gets a trial. Someone changing tier,
                    or coming back after a lapse, is charged in full at Stripe —
                    and was then told on landing that their free trial had just
                    started. */}
                <p className="ws-mp">
                  Your marketing just leveled up —{" "}
                  {d.trialing
                    ? <>your 7-day free trial starts now, with </>
                    : <>you&apos;re on {PLAN_BY_KEY[success.key]?.name}, with </>}
                  {PLAN_BY_KEY[success.key]?.monthlyTokens.toLocaleString("en-US")} <Ico n="coin" /> tokens loading every month.
                </p>
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
            <div className="wdl-title"><Ico n="rocket" /> Launch tracker <span>{doneCount}/{steps.length}</span></div>
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
            <div className="wdn-tag" style={{ marginBottom: 8 }}><Ico n="trend" /> Your content is working</div>
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
            <span className="wdn-kind"><Ico n={d.nextMove.kind === "video" ? "video" : d.nextMove.kind === "image" ? "image" : "article"} size={22} /></span>
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
        {d.tiers.map((t) => {
          const isCurrent = d.tier === t.key;
          const isLegend = t.key === "ANTHEM"; // Legend includes Creator free
          const creatorOn = !!wantCreator[t.key];
          const creatorSuffix = creatorOn ? (annual ? ` + $${(CREATOR_PRICE * 10).toFixed(2)}/yr Creator` : ` + $${CREATOR_PRICE}/mo Creator`) : "";
          const comboMo = (t.price + CREATOR_PRICE).toFixed(2);
          const comboYr = (t.yearly + CREATOR_PRICE * 10).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return (
          <div className={`wb-card wd-plancard${t.highlight ? " hot" : ""}`} key={t.key}>
            {t.highlight && <div className="wd-ribbon">Most popular</div>}
            <div className="wb-price-name">{t.name} {isCurrent && "· your plan ✓"}</div>
            <div className="wd-tagline">{t.tagline}</div>
            <div className="wb-price-amt">
              {annual ? <>${t.yearly.toLocaleString("en-US")}<small>/yr</small></> : <>${t.price}<small>/mo</small></>}
            </div>
            <div className="wb-note">{annual ? `Just $${Math.round((t.price * 10) / 12)}/mo, billed yearly · 2 months free` : "billed monthly"}</div>
            <div className="wb-note"><Ico n="coin" /> {t.tokens.toLocaleString("en-US")} tokens/mo</div>
            <div className="wb-note">{t.capacity}</div>
            <ul className="wb-feats">{t.features.map((f) => <li key={f}>{f}</li>)}</ul>

            {/* Creator add-on, right where the plan is chosen — toggle it on and
                the CTA + total update. Legend includes it, so it shows a badge. */}
            {d.billingOn && (isLegend ? (
              <div className="wd-ac wd-ac-incl"><span className="wd-ac-check" aria-hidden="true">✓</span> Creator section included</div>
            ) : (
              <>
                <button type="button" className={`wd-ac${creatorOn ? " on" : ""}`} aria-pressed={creatorOn}
                  onClick={() => setWantCreator((s) => ({ ...s, [t.key]: !s[t.key] }))}>
                  <span className="wd-ac-check" aria-hidden="true">{creatorOn ? "✓" : "＋"}</span>
                  <span className="wd-ac-txt">{creatorOn ? "Creator added" : "Add Creator"}</span>
                  <span className="wd-ac-price">+${CREATOR_PRICE}/mo</span>
                </button>
                {creatorOn && (
                  <div className="wd-ac-combo">Total {annual ? <>${comboYr}/yr</> : <>${comboMo}/mo</>} — plan + Creator</div>
                )}
              </>
            ))}

            {/* Flipping to Annual re-prices every card, including the one the
                merchant is already on — which had no buy button, because the
                subscribe form only renders for OTHER tiers. Say the path. */}
            {isCurrent && annual && (
              <p className="wb-note" style={{ marginTop: 8 }}>
                Already on this plan. To move it to annual billing, email{" "}
                <a href="mailto:hello@easymodeapp.com?subject=Switch%20me%20to%20annual%20billing">hello@easymodeapp.com</a>{" "}
                and we&apos;ll switch it over without you losing the period you&apos;ve paid for.
              </p>
            )}
            {isCurrent && d.billingOn && (
              <>
                {/* Add / remove Creator in place when the toggle differs from the
                    live add-on state (prorated; no full re-charge). */}
                {!isLegend && creatorOn !== d.creatorAddon && (
                  <Form method="post" className="wd-ac-apply">
                    <input type="hidden" name="intent" value="subscribe" />
                    <input type="hidden" name="tier" value={t.key} />
                    <input type="hidden" name="withCreator" value={creatorOn ? "1" : "0"} />
                    <button className="wb-btn" disabled={busy}>{creatorOn ? `Add Creator — $${CREATOR_PRICE}/mo` : "Remove Creator"}</button>
                  </Form>
                )}
                {d.cancelPending ? (
                  <>
                    <p className="wb-note" style={{ marginTop: 8 }}>
                      Cancelled — this plan won&apos;t renew. You keep every generator and every token
                      until the period you&apos;ve paid for ends.
                    </p>
                    <Form method="post">
                      <input type="hidden" name="intent" value="resumePlan" />
                      <button className="wb-btn" disabled={busy}>Keep my plan</button>
                    </Form>
                  </>
                ) : (
                  <Form
                    method="post"
                    onSubmit={(e) => {
                      if (!confirm("Cancel your plan? It stays active — with all your tokens — until the end of the period you've already paid for, then stops renewing.")) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="intent" value="cancelPlan" />
                    <button className="wb-btn ghost" disabled={busy}>Cancel plan</button>
                  </Form>
                )}
              </>
            )}
            {!isCurrent && (
              <>
                <Form method="post">
                  <input type="hidden" name="intent" value="subscribe" />
                  <input type="hidden" name="tier" value={t.key} />
                  {annual && <input type="hidden" name="annual" value="1" />}
                  <input type="hidden" name="withCreator" value={creatorOn ? "1" : "0"} />
                  {/* Say what will happen. A merchant already inside their one
                      trial is CHANGING tier and keeps the original end date;
                      one who has spent it is charged today. Neither is
                      “Start free trial”. */}
                  <button className="wb-btn" disabled={busy || !d.billingOn}>
                    {(d.trialAvailable ? "Start free trial" : d.trialing ? `Switch to ${t.name}` : `Get ${t.name}`)}{!isLegend && creatorOn ? " + Creator" : ""}
                  </button>
                </Form>
                {/* The trial ceiling is a CAP, not a grant: what a trialist can
                    actually spend is min(the tier’s own allowance, the cap). */}
                <div className="wd-trial">
                  {d.trialAvailable
                    ? <>7-day free trial ({Math.min(t.tokens, TRIAL_TOKEN_CAP).toLocaleString("en-US")} tokens to play) · then ${annual ? `${t.yearly.toLocaleString("en-US")}/yr` : `${t.price}/mo`}{!isLegend ? creatorSuffix : ""}</>
                    : d.trialing
                      ? <>Keeps your current trial end date · then ${annual ? `${t.yearly.toLocaleString("en-US")}/yr` : `${t.price}/mo`}{!isLegend ? creatorSuffix : ""}</>
                      : <>${annual ? `${t.yearly.toLocaleString("en-US")}/yr` : `${t.price}/mo`}{!isLegend ? creatorSuffix : ""}, billed today · your free trial is already used</>}
                </div>
              </>
            )}
          </div>
          );
        })}
      </div>

      {/* Creator now rides each plan card as a toggle (above). What's left here
          is the STANDALONE path for people who want only Creator and no
          marketing plan — plus a quick way in once it's active. A plan-holder
          without Creator uses the per-card toggle, so nothing shows for them. */}
      {d.billingOn && (d.hasCreator ? (
        <div className="wb-card wd-solo">
          <span className="wd-solo-emoji" aria-hidden="true">🎨</span>
          <div className="wd-solo-txt">
            <b>Creator section — active ✓</b>
            <p>Edit &amp; restyle your own photos, make images &amp; music with Helpurr.</p>
          </div>
          <Link to="/web/create" className="wb-btn ghost wd-solo-cta">Open Creator →</Link>
        </div>
      ) : !d.tier ? (
        <div className="wb-card wd-solo">
          <span className="wd-solo-emoji" aria-hidden="true">🎨</span>
          <div className="wd-solo-txt">
            <b>Just want to create?</b>
            <p>Skip the marketing plans — get the Creator section on its own. Edit &amp; restyle photos, make images &amp; music with Helpurr. ${CREATOR_PRICE}/mo.</p>
          </div>
          <Form method="post" className="wd-solo-cta">
            <input type="hidden" name="intent" value="subscribe" />
            <input type="hidden" name="tier" value="CREATOR" />
            <button className="wb-btn" disabled={busy || !d.billingOn}>Get Creator — ${CREATOR_PRICE}/mo</button>
          </Form>
        </div>
      ) : null)}

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

      {d.tier && d.trialing && (
        <div className="wb-note" style={{ marginBottom: 22 }}>
          <b>Top-ups unlock when your trial converts.</b> Extra tokens can&apos;t be spent during the
          trial, so we don&apos;t sell them yet — start your plan from the Studio whenever you&apos;re ready
          and your full balance opens up.
        </div>
      )}

      {/* ── Top-ups ────────────────────────────────────────────────────── */}
      {/* Not during a trial: purchased tokens sit in a bucket the trial does
          not let anyone spend, so offering the shop here sells something that
          cannot be used and does not even show up in the balance. The action
          refuses it too — this only stops us asking. */}
      {d.tier && !d.trialing && (
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
          {/* Sharing pays only once this store is itself on a plan. */}
          {d.referral.canEarn && (
            <div className="wdr-main">
              <b>Refer a friend — you both get {d.referral.reward} <Ico n="coin" /></b>
              <span>Share your code; tokens land in both wallets when they start a paid plan.</span>
              <div className="wdr-act">
                <span className="wdr-code">{d.referral.code}</span>
                <button type="button" className="wb-btn" onClick={copyReferral}>{refCopied ? "Copied ✓" : "Copy invite"}</button>
              </div>
            </div>
          )}
          {/* Entering one is for a store that has NOT started a plan yet —
              the same condition applyReferralCode enforces. */}
          {!d.referral.canEarn && !d.referral.referredBy && !referralApplied && (
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
            <div className="wdr-enter"><div className="wb-note">You joined with a referral — enjoy your bonus tokens.</div></div>
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
/* Per-plan Creator add-on toggle — sits inside each plan card above the CTA. */
.wd-ac{display:flex;align-items:center;gap:8px;width:100%;margin:10px 0 2px;padding:9px 12px;border-radius:12px;cursor:pointer;font:inherit;text-align:left;
  background:var(--paper,#F4F1E6);border:1px dashed var(--line,#E4DFCF);color:var(--ink2,#4A554E);transition:all .12s;}
.wd-ac:hover{border-color:#9CCBB1;}
.wd-ac.on{background:#EAF7F0;border-style:solid;border-color:#0C7A46;color:var(--ink,#14201A);}
.wd-ac-check{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;flex:0 0 auto;font-size:13px;font-weight:800;
  background:#fff;border:1px solid var(--line,#E4DFCF);color:#0C7A46;}
.wd-ac.on .wd-ac-check{background:#0C7A46;border-color:#0C7A46;color:#fff;}
.wd-ac-txt{flex:1 1 auto;font-family:Poppins,sans-serif;font-weight:700;font-size:13px;}
.wd-ac-price{flex:0 0 auto;font-weight:800;font-size:12.5px;color:#0C7A46;}
.wd-ac-incl{cursor:default;background:#EAF7F0;border-style:solid;border-color:#9CCBB1;color:#0C7A46;font-family:Poppins,sans-serif;font-weight:700;font-size:13px;}
.wd-ac-incl .wd-ac-check{background:#0C7A46;border-color:#0C7A46;color:#fff;}
.wd-ac-combo{margin:2px 0 2px;font-size:11.5px;font-weight:700;color:#0C7A46;}
.wd-ac-apply{margin-top:8px;}
/* Standalone Creator card (no marketing plan) + "active" quick-open. */
.wd-solo{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:0 0 24px;background:linear-gradient(135deg,#F0FAF4,#FBFAF2);}
.wd-solo-emoji{font-size:30px;line-height:1;flex:0 0 auto;filter:drop-shadow(0 1px 1px rgba(20,32,26,.15));}
.wd-solo-txt{flex:1 1 240px;min-width:0;}
.wd-solo-txt b{font-family:Poppins,sans-serif;font-size:16px;color:var(--ink);}
.wd-solo-txt p{margin:3px 0 0;font-size:13px;color:var(--ink2);}
.wd-solo-cta{flex:0 0 auto;}
@media(max-width:620px){.wd-solo-cta{flex:1 1 100%;}.wd-solo-cta .wb-btn{width:100%;}}
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
