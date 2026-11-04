/* Web dashboard — brand setup + plan/billing (Stripe). The wallet, tiers and
 * trial rules are IDENTICAL to the Shopify app; only the payer differs. */

import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit, useNavigate, useOutletContext, Link } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { readUiLang, tr } from "../lib/ui-i18n";
import {
  PLAN_TIERS, MARKETING_TIERS, PLAN_BY_KEY, CREATOR_PRICE, TOKEN_PACKS, TOKEN_COST, TRIAL_TOKEN_CAP,
  annualPrice, planCapacity, resolveTierKey, type PlanKey,
} from "../lib/plan-config";
import { tokensRemainingLive, planTrialing } from "../lib/tokens.server";
import { createPackCheckout, createPlanCheckout, resolvePendingCheckout, setSubscriptionCreatorAddon, stripeEnabled, trialAlreadyTaken } from "../lib/stripe.server";
import { capabilitiesFor } from "../lib/capabilities.server";
import { linkedFromCache } from "../lib/social-provider.server";
import { parseSocialStats, sumStats } from "../lib/social-insights.server";
import { externalOrigin } from "../lib/origin.server";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = ({ matches }: { matches: Array<{ id: string; data: unknown }> }) => {
  const uiLang = (matches.find((m) => m.id === "root")?.data as { uiLang?: string } | null)?.uiLang;
  return [{ title: tr((uiLang || "en") as Parameters<typeof tr>[0], "Dashboard") + " · EasyMode" }];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const lang = readUiLang(request);
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
        nextMove = { kind: "video", reason: tr(lang, "Video is what stops the scroll — pick a presenter, a cartoon style or a cinematic highlight."), cost: TOKEN_COST.video };
      } else if (caps.has("image") && balance >= TOKEN_COST.image) {
        nextMove = { kind: "image", reason: tr(lang, "A scroll-stopping image ad built on a famous ad format — done in about a minute."), cost: TOKEN_COST.image };
      } else if (caps.has("blog") && balance >= TOKEN_COST.blog) {
        nextMove = { kind: "blog", reason: tr(lang, "An SEO article pulls in free Google traffic that keeps working long after you post it."), cost: TOKEN_COST.blog };
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
      tokens: t.monthlyTokens, capacity: planCapacity(t).map((c) => ({ count: c.count, noun: c.noun })), features: t.features, highlight: !!t.highlight,
    })),
    packs: TOKEN_PACKS.map((p) => ({ tokens: p.tokens, price: p.price, best: !!(p as { best?: boolean }).best })),
    // Cancelled but still inside the period they paid for.
    cancelPending: !!shop.activePlan?.cancelAtPeriodEnd,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = readUiLang(request);
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
    if (!tone && !about) return json({ error: tr(lang, "Tell us a little about the brand so content sounds like you.") });
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
    const contentLang = (form.get("contentLang") as string) || "";
    if (contentLang) await db.shop.update({ where: { id: shop.id }, data: { contentLang: normalizeContentLang(contentLang) } });
    try { const { unlockAchievement } = await import("../lib/xp.server"); await unlockAchievement(shop.id, "SCANNER"); } catch { /* non-fatal */ }
    return json({ ok: tr(lang, "Voice updated ✓ — new content will speak it. The studio is open."), voiceSaved: true });
  }

  // Referral: a new account enters someone's code (paid out on conversion).
  if (intent === "applyReferral") {
    const { applyReferralCode } = await import("../lib/referral.server");
    const r = await applyReferralCode(shop.id, (form.get("code") as string) || "");
    return json(r.ok ? { referralApplied: true } : { error: r.error });
  }

  if (intent === "subscribe") {
    if (!stripeEnabled()) return json({ error: tr(lang, "Billing is coming online — check back shortly.") });
    const tierKey = form.get("tier") as PlanKey;
    if (!PLAN_BY_KEY[tierKey]) return json({ error: tr(lang, "Unknown plan.") });
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
      return json({ error: tr(lang, withCreator ? "You're already on {name} with Creator." : "You're already on {name}.", { name: PLAN_BY_KEY[tierKey].name }) });
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
      return json({ ok: withCreator ? tr(lang, "Creator added to your plan — your Create section is unlocked.") : tr(lang, "Creator removed from your plan.") });
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
        const name = PLAN_BY_KEY[(pending.tierKey || tierKey) as PlanKey]?.name || tr(lang, "Your plan");
        return json({ error: tr(lang, "{name} is already active — that last payment just took a moment to land. Reload to see it.", { name }) });
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
      return json({ error: e instanceof Error ? e.message : tr(lang, "Checkout couldn't start.") });
    }
  }

  // "Cancel anytime" is printed on the Stripe checkout page and in the terms.
  // Until now it was not true anywhere in the product.
  if (intent === "cancelPlan" || intent === "resumePlan") {
    const { setPlanCancellation } = await import("../lib/stripe.server");
    const r = await setPlanCancellation(account.id, intent === "cancelPlan");
    if (!r.ok) return json({ error: r.error || tr(lang, "Couldn't update your plan just now.") });
    return json({
      ok:
        intent === "cancelPlan"
          ? tr(lang, "Your plan won't renew. You keep everything until the end of the period you've already paid for.")
          : tr(lang, "Your plan is back on — it'll renew as normal."),
    });
  }

  if (intent === "pack") {
    if (!stripeEnabled()) return json({ error: tr(lang, "Billing is coming online — check back shortly.") });
    if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan first — packs top up a plan's balance.") });
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
        error: tr(
          lang,
          "Top-ups unlock when your trial converts — they can't be spent before then. " +
            "Start your plan now from the Studio and your balance opens up straight away.",
        ),
      });
    }
    const tokens = parseInt((form.get("tokens") as string) || "0", 10);
    try {
      const url = await createPackCheckout({ accountId: account.id, email: account.email, tokens, baseUrl });
      return redirect(url);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : tr(lang, "Checkout couldn't start.") });
    }
  }

  return json({});
};

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(n));

const PACK_FRAMING: Record<number, string> = {
  50: "The budget top-up — about ten more images or a video, for when you run low.",
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
  const t = useT();
  // The capacity line ("≈ 6 product videos, 180 image ads, or 90 blog posts") is
  // COMPOSED from the wallet, so it can't be a single dict key — translate the
  // nouns + a shape template instead, and reassemble in the viewer's language.
  const capacityText = (parts: { count: number; noun: string }[]) => {
    const items = parts.map((c) => `${c.count.toLocaleString("en-US")} ${t(c.noun)}`);
    if (items.length <= 1) return t("≈ {a} a month", { a: items[0] || "" });
    if (items.length === 2) return t("≈ {a}, or {b}", { a: items[0], b: items[1] });
    return t("≈ {a}, {b}, or {c}", { a: items[0], b: items[1], c: items[2] });
  };
  const navigate = useNavigate();
  const { setMode } = useOutletContext<{ mode: "marketing" | "casual"; setMode: (m: "marketing" | "casual") => void }>();
  // The Helpurr "Google-style" landing hero at the top of the home: ask Helpurr to
  // drive, or take the Creator/Social/Studio path to drive it yourself.
  const [ask, setAsk] = useState("");
  const firstName = (d.name || "").split(" ")[0];
  const openHelpurr = (text?: string) => { window.dispatchEvent(new CustomEvent("helpurr:open", { detail: { max: true, text: text || undefined, send: !!(text && text.trim()) } })); };
  const askHelpurr = () => { const text = ask.trim(); openHelpurr(text || undefined); if (text) setAsk(""); };
  // Unified home — one set of chips spanning both creative and social making,
  // since there's no Creator/Social mode to switch between anymore.
  const heroChips = [t("Make me an ad"), t("Make an image"), t("Make a video"), t("What's working best?")];

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
  // Make the celebration modal keyboard-complete: Escape closes it, the primary
  // CTA takes focus on open, a Tab focus-trap keeps focus inside while it's up,
  // and focus returns to wherever it was on close.
  const successCtaRef = useRef<HTMLAnchorElement | null>(null);
  const successModalRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!success) return;
    const prev = document.activeElement as HTMLElement | null;
    successCtaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { closeSuccess(); return; }
      if (e.key !== "Tab") return;
      const node = successModalRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === firstEl || !node.contains(activeEl))) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && activeEl === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [success]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Launch tracker: auto-hides once every step is done; dismissible (per
  // browser) once you've seen it through.
  const [launchHidden, setLaunchHidden] = useState(false);
  useEffect(() => { try { if (localStorage.getItem("emWebLaunchDone") === "1") setLaunchHidden(true); } catch { /* ignore */ } }, []);
  const dismissLaunch = () => { try { localStorage.setItem("emWebLaunchDone", "1"); } catch { /* ignore */ } setLaunchHidden(true); };

  // ── Billing period toggle + referral input.
  const [annual, setAnnual] = useState(false);
  // Brand "about" is silently truncated server-side at 600 — mirror that cap in
  // the field and show a live counter so nothing the merchant types is quietly lost.
  const ABOUT_MAX = 600;
  const [aboutLen, setAboutLen] = useState((d.brand?.about || "").length);
  const [refInput, setRefInput] = useState("");
  const [refCopied, setRefCopied] = useState(false);
  const referralApplied = !!(actionData && "referralApplied" in actionData);
  const copyReferral = () => {
    if (!d.referral) return;
    const msg = t("Try EasyMode — AI videos, image ads & articles for your store, made and posted for you. Use my code {code} when you pick a plan and we both get {reward} free tokens. https://easymodeapp.com", { code: d.referral.code, reward: d.referral.reward });
    navigator.clipboard?.writeText(msg).then(() => { setRefCopied(true); setTimeout(() => setRefCopied(false), 1800); }).catch(() => { /* blocked */ });
  };

  const err = actionData && "error" in actionData ? (actionData.error as string) : null;
  const ok = actionData && "ok" in actionData ? (actionData.ok as string) : null;

  // Action feedback (voice, referral, plan change, pack) is triggered from
  // controls spread down the page, but the banner used to render at the top of
  // the body — so after, say, cancelling a plan far down, the confirmation
  // landed off-screen and the click looked like it did nothing. Lift it into a
  // fixed top-center toast that's always visible: success auto-clears after a
  // few seconds, errors stay until dismissed.
  const [toast, setToast] = useState<{ kind: "err" | "ok"; msg: string } | null>(null);
  useEffect(() => {
    if (!actionData) return;
    if (err) setToast({ kind: "err", msg: err });
    else if (ok) setToast({ kind: "ok", msg: ok });
    else if (referralApplied) setToast({ kind: "ok", msg: t("Code applied ✓ — your bonus tokens land when your paid plan starts.") });
  }, [actionData]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (toast?.kind !== "ok") return;
    const tm = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(tm);
  }, [toast]);

  const steps = [
    { key: "brand", label: t("Set your brand voice"), hint: t("So content sounds like you"), done: d.launch.brand, href: "#brand" },
    { key: "plan", label: t("Pick your plan"), hint: t("Start your 7-day free trial"), done: d.launch.plan, href: "#plans" },
    { key: "social", label: t("Link your socials"), hint: t("So pieces can post themselves"), done: d.launch.social, href: "/web/connect" },
    { key: "content", label: t("Make your first piece"), hint: t("A video, image ad or article"), done: d.launch.content, href: "/web/studio" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const nextKey = steps.find((s) => !s.done)?.key;

  // ── Studios console — the launcher concept merged into the hub (owner 11-04).
  //    Hover/focus a tile to preview it up top; the button opens it. A studio
  //    flips the app mode (casual = Creator, marketing = Ad Maker) exactly like
  //    the old "drive it yourself" path cards did.
  const STUDIOS = [
    { id: "creator", name: t("Creator"), kicker: t("Make anything"), sub: t("Images, video & music"), title: t("Creator Studio"),
      blurb: t("Describe it and it's made — product shots, scenes, short videos and music, right in the chat."),
      cta: t("Open Creator"), ico: "palette", accent: "#2cc67f", go: () => { setMode("casual"); navigate("/web/studio"); } },
    { id: "admaker", name: t("Ad Maker"), kicker: t("Marketing studio"), sub: t("Product ads that sell"), title: t("Ad Maker"),
      blurb: t("Turn a product into a scroll-stopping ad — image or video, built on famous ad formats, in about a minute."),
      cta: t("Open Ad Maker"), ico: "megaphone", accent: "#f2dca0", go: () => { setMode("marketing"); navigate("/web/studio"); } },
    { id: "movie", name: t("Movie Maker"), kicker: t("Entertainment engine"), sub: t("Episodes · dialogue"), title: t("Movie Maker"),
      blurb: t("Movies, kids episodes, music videos and real character dialogue — built to post, not just ads."),
      cta: t("Open Movie Maker"), ico: "filmreel", accent: "#f2dca0", go: () => navigate("/web/film") },
    { id: "social", name: t("Social"), kicker: t("Marketing on autopilot"), sub: t("Campaigns · posting"), title: t("Social"),
      blurb: t("Your marketing runs itself — campaigns, trending topics and auto-posting to every account."),
      cta: t("Open Social"), ico: "trend", accent: "#34c9c0", go: () => navigate("/web/product-channels") },
    { id: "presenters", name: t("Presenters"), kicker: t("Your AI cast"), sub: t("Avatars that sell"), title: t("Presenters"),
      blurb: t("A cast of AI presenters — pick one to front your videos, or forge a custom face with its own voice."),
      cta: t("Open Presenters"), ico: "figure", accent: "#c48cf0", go: () => navigate("/web/presenters") },
    { id: "archive", name: t("Archive"), kicker: t("Everything you've made"), sub: t("Watch · keep · post"), title: t("Archive"),
      blurb: t("Every image and video you've made in one place — watch it big, keep the good ones or push them live."),
      cta: t("Open Archive"), ico: "bookcase", accent: "#b7c0a0", go: () => navigate("/web/archive") },
  ];
  const [studioSel, setStudioSel] = useState(0);
  const sct = STUDIOS[studioSel];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") setStudioSel((i) => Math.min(STUDIOS.length - 1, i + 1));
      if (e.key === "ArrowLeft") setStudioSel((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [STUDIOS.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wd-dark">
      <style dangerouslySetInnerHTML={{ __html: DASH_CSS }} />
      {/* The shell nav is hidden on /web (web.tsx), so the hub carries its own
          compact header — mirrors the launcher this merged in. */}
      <header className="wd-hd">
        <span className="wd-hd-brand"><b>EASY<span>MODE</span></b></span>
        <span className="wd-hd-tok"><span className="wd-hd-dot" aria-hidden="true" /><b>{d.tokens.toLocaleString("en-US")}</b> {t("tokens")}</span>
      </header>
      <div className="wd-console">
        {/* Helpurr Google-style opener — the front door the owner asked to keep. */}
        <section className="wd-opener">
          <h1>{firstName ? t("Hey {name} — what are we making today?", { name: firstName }) : t("What are we making today?")}</h1>
          <form className="wd-ask" onSubmit={(e) => { e.preventDefault(); askHelpurr(); }}>
            <span className="wd-ask-spark" aria-hidden="true"><Ico n="sparkle" size={17} /></span>
            <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={t("Ask Helpurr anything — or tell it what to make…")} aria-label={t("Ask Helpurr")} />
            <button type="submit" className="wd-ask-send" aria-label={t("Ask Helpurr")}><Ico n="bolt" size={18} /></button>
          </form>
          <div className="wd-chips">
            {heroChips.map((c) => <button key={c} type="button" onClick={() => openHelpurr(c)}>{c}</button>)}
          </div>
        </section>
        {/* Studios hero — previews the selected studio. */}
        <section className="lx-hero" style={{ ["--hero-accent" as string]: sct.accent }}>
          <div className="lx-herobg" key={sct.id} style={{ background: `linear-gradient(120deg, color-mix(in srgb, ${sct.accent} 22%, #0b1510), #0b1510)` }} />
          <div className="lx-heroinner">
            <span className="lx-eyebrow"><Ico n={sct.ico} size={16} /> {sct.kicker}</span>
            <h2>{sct.title}</h2>
            <p>{sct.blurb}</p>
            <div className="lx-actions">
              <button className="lx-btn lx-primary" type="button" onClick={sct.go}>{sct.cta} <Ico n="arrow" size={15} /></button>
              <button className="lx-btn lx-ghost" type="button" onClick={() => openHelpurr()}>{t("Ask Helpurr")}</button>
            </div>
          </div>
        </section>
        <div className="lx-railhead"><h3>{t("Your studios")}</h3><span className="lx-hint">{t("Pick a studio — or ← → to browse")}</span></div>
        <div className="lx-rail" role="listbox" aria-label={t("Studios")}>
          {STUDIOS.map((st, i) => (
            <button key={st.id} type="button" className="lx-tile" role="option" aria-selected={i === studioSel}
              style={{ ["--t-accent" as string]: st.accent }}
              onMouseEnter={() => setStudioSel(i)} onFocus={() => setStudioSel(i)} onClick={st.go}>
              <span className="lx-ticon"><Ico n={st.ico} size={21} /></span>
              <span className="lx-tx"><span className="lx-th">{st.name}</span><span className="lx-tsub">{st.sub}</span></span>
            </button>
          ))}
        </div>
      </div>
      <div className="wd-wrap">
      <p className="wb-sub wd-plan-line">
        {d.tierName
          ? <>{t("You're on")} <b>{d.tierName}</b>{d.trialing ? ` ${t("(free trial)")}` : ""} {t("with")} <b>{d.tokens.toLocaleString("en-US")}</b> {t("tokens ready.")}</>
          : <>{t("Heads up — making anything runs on a plan. Start your ")}<Link to="/web#plans">{t("free 7-day trial")}</Link>{t(" to make your first piece.")}</>}
      </p>

      {success && (
        <div className="ws-scrim" role="dialog" aria-modal="true" aria-label={t("Purchase confirmed")} onClick={closeSuccess}>
          <div className="ws-modal" ref={successModalRef} onClick={(e) => e.stopPropagation()}>
            <span className="ws-mrose" aria-hidden="true" />
            <div className="ws-mi"><Ico n={success.kind === "plan" ? "check" : "coin"} size={30} /></div>
            {success.kind === "plan" ? (
              <>
                <b className="ws-mh">{PLAN_BY_KEY[success.key]?.name ?? t("Your plan")} {t("is live")}</b>
                {/* Only the FIRST subscription gets a trial. Someone changing tier,
                    or coming back after a lapse, is charged in full at Stripe —
                    and was then told on landing that their free trial had just
                    started. */}
                <p className="ws-mp">
                  {t("Your social just leveled up —")}{" "}
                  {d.trialing
                    ? <>{t("your 7-day free trial starts now, with ")}</>
                    : <>{t("you're on")} {PLAN_BY_KEY[success.key]?.name}{t(", with ")}</>}
                  {PLAN_BY_KEY[success.key]?.monthlyTokens.toLocaleString("en-US")} <Ico n="coin" /> {t("tokens loading every month.")}
                </p>
              </>
            ) : (
              <>
                <b className="ws-mh">+{success.n.toLocaleString("en-US")} {t("tokens")}</b>
                <p className="ws-mp">{t("They're landing on your balance now — spend them on anything your plan unlocks.")}</p>
              </>
            )}
            <Link ref={successCtaRef} className="wb-btn ws-mcta" to="/web/studio" onClick={closeSuccess}>{t("Open the Studio")} →</Link>
            <button type="button" className="ws-mclose" onClick={closeSuccess}>{t("Not now")}</button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`wd-toast ${toast.kind === "err" ? "wb-err" : "wb-ok"}`} role="status" aria-live="polite">
          <span>{toast.msg}</span>
          <button type="button" className="wd-toast-x" onClick={() => setToast(null)} aria-label={t("Dismiss")}>✕</button>
        </div>
      )}

      {/* ── Launch tracker ─────────────────────────────────────────────── */}
      {!allDone && !launchHidden && (
        <div className="wd-launch">
          <div className="wdl-top">
            <div className="wdl-title"><Ico n="rocket" /> {t("Launch tracker")} <span>{doneCount}/{steps.length}</span></div>
            <button type="button" className="wdl-x" onClick={dismissLaunch} aria-label={t("Dismiss")}>✕</button>
          </div>
          <div className="wdl-bar"><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
          <div className="wdl-steps">
            {steps.map((s) => {
              const isNext = s.key === nextKey;
              const inner = (
                <>
                  <span className={`wdl-tick${s.done ? " on" : ""}`}>{s.done ? "✓" : ""}</span>
                  <span className="wdl-lab"><b>{s.label}</b><em>{s.hint}</em></span>
                  {isNext && <span className="wdl-go">{t("Start")} ›</span>}
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
              ? <>{t("This week you made")} <b>{d.week.made}</b> {d.week.made === 1 ? t("piece") : t("pieces")}{d.week.posted > 0 ? <> {t("and posted")} <b>{d.week.posted}</b></> : null}.</>
              : <>{t("Nothing made this week yet — the Studio is one click away.")}{" "}<Link className="wdw-review" to="/web/studio">{t("Open the Studio")} →</Link></>}
          </div>
          <div className="wdw-row">
            <div className="wdw-st"><div className="n">{d.week.made}</div><div className="k">{t("Made")}</div></div>
            <div className="wdw-st"><div className="n">{d.week.posted}</div><div className="k">{t("Posted")}</div></div>
            <div className="wdw-st"><div className="n">{d.week.toReview}</div><div className="k">{t("To review")}</div></div>
          </div>
          {d.week.toReview > 0 && (
            <Link className="wdw-review" to="/web/archive">
              <span className="rv-n">{d.week.toReview}</span>
              {d.week.toReview === 1 ? t("new piece in your Archive") : t("new pieces in your Archive")} →
            </Link>
          )}
        </div>
      )}

      {/* ── Results tiles (only when real numbers exist) ───────────────── */}
      {d.wins.hasData && (() => {
        const tiles = [
          d.wins.reach > 0 && { n: d.wins.reach, k: t("reached") },
          d.wins.views > 0 && { n: d.wins.views, k: t("views") },
          d.wins.engagement > 0 && { n: d.wins.engagement, k: t("engagements") },
          d.wins.followers > 0 && { n: d.wins.followers, k: t("followers") },
        ].filter(Boolean).slice(0, 4) as { n: number; k: string }[];
        return (
          <div className="wd-wins">
            <div className="wdn-tag" style={{ marginBottom: 8 }}><Ico n="trend" /> {t("Your content is working")}</div>
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
          <div className="wdn-tag">{t("Your next move")}</div>
          <div className="wdn-row">
            <span className="wdn-kind"><Ico n={d.nextMove.kind === "video" ? "video" : d.nextMove.kind === "image" ? "image" : "article"} size={22} /></span>
            <div className="wdn-body">
              <b>{d.nextMove.kind === "video" ? t("Make a product video") : d.nextMove.kind === "image" ? t("Make an image ad") : t("Make an article")}</b>
              <p>{d.nextMove.reason}</p>
            </div>
          </div>
          <span className="wdn-cta">{t("Create it — {cost} tokens", { cost: d.nextMove.cost })} →</span>
        </Link>
      )}

      {/* ── Brand voice ────────────────────────────────────────────────── */}
      <div id="brand" className="wb-card" style={{ marginBottom: 22, scrollMarginTop: 80 }}>
        <div className="wb-price-name" role="heading" aria-level={2}>{t("1 · Brand voice")} {d.hasBrand && "✓"}</div>
        <p className="wb-note" style={{ margin: "6px 0 0" }}>{t("Every script, caption and article is written in your voice.")}</p>
        {d.hasBrand && d.brand && (d.brand.tagline || d.brand.tone || d.brand.about) && (
          <div className="wd-voice">
            {d.brand.tagline && <div className="wdv-quote">“{d.brand.tagline}”</div>}
            <div className="wdv-chips">
              {d.brand.tone && <span className="wdv-chip tone" title={d.brand.tone}>{d.brand.tone}</span>}
              {d.brand.about && <span className="wdv-chip">{d.brand.about.length > 90 ? `${d.brand.about.slice(0, 90)}…` : d.brand.about}</span>}
            </div>
          </div>
        )}
        <Form method="post">
          <input type="hidden" name="intent" value="brand" />
          {/* The server accepts "about" OR "tone", but an empty form trips a
              generic error — so name the one field that satisfies it as required
              (tone/tagline stay marked "(optional)" to match). */}
          <label className="wb-lbl">{t("What do you sell, and to whom?")} <span className="wb-req">{t("(required)")}</span></label>
          <textarea className="wb-ta" name="about" maxLength={ABOUT_MAX} placeholder={t("Handmade ceramic mugs for coffee people who like slow mornings…")} defaultValue={d.brand?.about || ""} onChange={(e) => setAboutLen(e.target.value.length)} />
          <div className="wb-count" aria-live="polite">{t("{n}/{max}", { n: aboutLen, max: ABOUT_MAX })}</div>
          <label className="wb-lbl">{t("Tone (optional)")}</label>
          <input className="wb-in" name="tone" placeholder={t("warm, playful, a little cheeky")} defaultValue={d.brand?.tone || ""} />
          <label className="wb-lbl">{t("Tagline (optional)")}</label>
          <input className="wb-in" name="tagline" placeholder={t("Slow mornings, served hot.")} defaultValue={d.brand?.tagline || ""} />
          <label className="wb-lbl">{t("Content language — everything generates in this language")}</label>
          <select className="wb-sel" name="contentLang" defaultValue={d.contentLang}>
            {Object.entries(d.langs).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
          <div style={{ marginTop: 14 }}>
            <button className="wb-btn ghost" disabled={busy}>{d.hasBrand ? t("Update brand voice") : t("Save brand voice")}</button>
          </div>
        </Form>
      </div>

      {/* ── Plans ──────────────────────────────────────────────────────── */}
      <div id="plans" className="wb-price-name" role="heading" aria-level={2} style={{ marginBottom: 10, scrollMarginTop: 80 }}>{t("2 · Your plan")}</div>
      {!d.billingOn && <div className="wb-err">{t("Billing is coming online — plans can't be purchased on the web quite yet.")}</div>}
      <div className="wd-toggle" role="group" aria-label={t("Billing period")}>
        <button type="button" className={annual ? "" : "on"} onClick={() => setAnnual(false)}>{t("Monthly")}</button>
        <button type="button" className={annual ? "on" : ""} onClick={() => setAnnual(true)}>{t("Annual")} <span>{t("2 months free")}</span></button>
      </div>
      <div className="wb-grid" style={{ marginBottom: 22 }}>
        {d.tiers.map((tier) => {
          const isCurrent = d.tier === tier.key;
          return (
          <div className={`wb-card wd-plancard${tier.highlight ? " hot" : ""}`} key={tier.key}>
            {tier.highlight && !isCurrent && <div className="wd-ribbon">{t("Most popular")}</div>}
            <div className="wb-price-name">{tier.name} {isCurrent && t("· your plan ✓")}</div>
            <div className="wd-tagline">{t(tier.tagline)}</div>
            <div className="wb-price-amt">
              {annual ? <>${tier.yearly.toLocaleString("en-US")}<small>{t("/yr")}</small></> : <>${tier.price}<small>{t("/mo")}</small></>}
            </div>
            <div className="wb-note">{annual ? t("Just ${price}/mo, billed yearly · 2 months free", { price: Math.round((tier.price * 10) / 12) }) : t("billed monthly")}</div>
            <div className="wb-note"><Ico n="coin" /> {t("{tokens} tokens/mo", { tokens: tier.tokens.toLocaleString("en-US") })}</div>
            <div className="wb-note">{capacityText(tier.capacity)}</div>
            <ul className="wb-feats">{tier.features.map((f) => <li key={f}>{t(f)}</li>)}</ul>

            {/* Flipping to Annual re-prices every card, including the one the
                merchant is already on — which had no buy button, because the
                subscribe form only renders for OTHER tiers. Say the path. */}
            {isCurrent && annual && (
              <>
                <p className="wb-note" style={{ marginTop: 8 }}>
                  {t("Already on this plan — we'll move it to annual billing without you losing the period you've paid for.")}
                </p>
                <a className="wb-btn ghost" style={{ marginTop: 8, display: "inline-block" }} href="mailto:hello@easymodeapp.com?subject=Switch%20me%20to%20annual%20billing">{t("Request annual switch")}</a>
              </>
            )}
            {isCurrent && d.billingOn && (
              d.cancelPending ? (
                <>
                  <p className="wb-note" style={{ marginTop: 8 }}>
                    {t("Cancelled — this plan won't renew. You keep every generator and every token until the period you've paid for ends.")}
                  </p>
                  <Form method="post">
                    <input type="hidden" name="intent" value="resumePlan" />
                    <button className="wb-btn" disabled={busy}>{t("Keep my plan")}</button>
                  </Form>
                </>
              ) : (
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (!confirm(t("Cancel your plan? It stays active — with all your tokens — until the end of the period you've already paid for, then stops renewing."))) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="intent" value="cancelPlan" />
                  <button className="wb-btn ghost" disabled={busy}>{t("Cancel plan")}</button>
                </Form>
              )
            )}
            {!isCurrent && (
              <>
                <Form method="post">
                  <input type="hidden" name="intent" value="subscribe" />
                  <input type="hidden" name="tier" value={tier.key} />
                  {annual && <input type="hidden" name="annual" value="1" />}
                  {/* Say what will happen. A merchant already inside their one
                      trial is CHANGING tier and keeps the original end date;
                      one who has spent it is charged today. Neither is
                      “Start free trial”. */}
                  <button className="wb-btn" disabled={busy || !d.billingOn}>
                    {d.trialAvailable ? t("Start free trial") : d.trialing ? t("Switch to {name}", { name: tier.name }) : t("Get {name}", { name: tier.name })}
                  </button>
                </Form>
                {/* The trial ceiling is a CAP, not a grant: what a trialist can
                    actually spend is min(the tier’s own allowance, the cap). */}
                <div className="wd-trial">
                  {d.trialAvailable
                    ? <>{t("7-day free trial ({tokens} tokens to play) · then {price}", { tokens: Math.min(tier.tokens, TRIAL_TOKEN_CAP).toLocaleString("en-US"), price: annual ? `$${tier.yearly.toLocaleString("en-US")}/yr` : `$${tier.price}/mo` })}</>
                    : d.trialing
                      ? <>{t("Keeps your current trial end date · then {price}", { price: annual ? `$${tier.yearly.toLocaleString("en-US")}/yr` : `$${tier.price}/mo` })}</>
                      : <>{t("{price}, billed today · your free trial is already used", { price: annual ? `$${tier.yearly.toLocaleString("en-US")}/yr` : `$${tier.price}/mo` })}</>}
                </div>
              </>
            )}
          </div>
          );
        })}
      </div>

      {/* Creator is now INCLUDED FREE on every marketing plan (see the feature
          lists above). This card is the STANDALONE path — the creative tools on
          their own, for people who want no marketing plan — and a quick way in
          once Creator is active on their account. */}
      {d.billingOn && (d.hasCreator ? (
        <div className="wb-card wd-solo">
          <span className="wd-solo-emoji" aria-hidden="true"><Ico n="palette" size={28} /></span>
          <div className="wd-solo-txt">
            <b>{t("Creator section — included with your plan")} ✓</b>
            <p>{t("Make AI images, edit your photos and generate music with Helpurr.")}</p>
          </div>
          <Link to="/web/studio" className="wb-btn ghost wd-solo-cta">{t("Open Creator")} →</Link>
        </div>
      ) : !d.tier ? (
        <div className="wb-card wd-solo">
          <span className="wd-solo-emoji" aria-hidden="true"><Ico n="palette" size={28} /></span>
          <div className="wd-solo-txt">
            <b>{t("Just want the creative tools?")}</b>
            <p>{t("Skip the social plans — get Creator on its own: AI images, photo editing & music with Helpurr.")} <b>${CREATOR_PRICE}{t("/mo")}</b>{t(", no social plan needed.")}</p>
          </div>
          <Form method="post" className="wd-solo-cta">
            <input type="hidden" name="intent" value="subscribe" />
            <input type="hidden" name="tier" value="CREATOR" />
            <button className="wb-btn" disabled={busy || !d.billingOn}>{t("Get Creator — ${price}/mo", { price: CREATOR_PRICE })}</button>
          </Form>
        </div>
      ) : null)}

      {/* One balance, one currency — the concept in a single quiet line; the
          actual costs live on each Make button now, not in a standalone grid. */}
      <p className="wb-note" style={{ margin: "0 0 26px" }}>
        {t("Your plan unlocks which generators you can use; tokens meter how much you make — every Make button shows its cost.")}
      </p>

      {d.tier && d.trialing && (
        <div className="wb-note" style={{ marginBottom: 22 }}>
          <b>{t("Top-ups unlock when your trial converts.")}</b> {t("Extra tokens can't be spent during the trial, so we don't sell them yet — start your plan from the Studio whenever you're ready and your full balance opens up.")}
        </div>
      )}

      {/* ── Top-ups ────────────────────────────────────────────────────── */}
      {/* Not during a trial: purchased tokens sit in a bucket the trial does
          not let anyone spend, so offering the shop here sells something that
          cannot be used and does not even show up in the balance. The action
          refuses it too — this only stops us asking. */}
      {d.tier && !d.trialing && (
        <>
          <div className="wb-price-name" role="heading" aria-level={2} style={{ marginBottom: 10 }}>{t("Top up tokens")}</div>
          <div className="wb-grid">
            {d.packs.map((p) => (
              <div className={`wb-card wd-plancard${p.best ? " hot" : ""}`} key={p.tokens}>
                {p.best && <div className="wd-ribbon gold">{t("Best value")}</div>}
                <div className="wb-price-name">+{p.tokens.toLocaleString("en-US")} {t("tokens")}</div>
                <p className="wb-note" style={{ margin: "6px 0 4px" }}>{PACK_FRAMING[p.tokens] ? t(PACK_FRAMING[p.tokens]) : t("Extra fuel for anything your plan unlocks.")}</p>
                <div className="wb-note" style={{ margin: "0 0 12px" }}>{t("One-time · they never expire")}</div>
                <Form method="post">
                  <input type="hidden" name="intent" value="pack" />
                  <input type="hidden" name="tokens" value={p.tokens} />
                  <button className="wb-btn gold" disabled={busy || !d.billingOn}>{t("Buy for ${price}", { price: p.price })}</button>
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
              <b>{t("Refer a friend — you both get {reward}", { reward: d.referral.reward })} <Ico n="coin" /></b>
              <span>{t("Share your code; tokens land in both wallets when they start a paid plan.")}</span>
              <div className="wdr-act">
                <span className="wdr-code">{d.referral.code}</span>
                <button type="button" className="wb-btn" onClick={copyReferral}>{refCopied ? t("Copied ✓") : t("Copy invite")}</button>
              </div>
            </div>
          )}
          {/* Entering one is for a store that has NOT started a plan yet —
              the same condition applyReferralCode enforces. */}
          {!d.referral.canEarn && !d.referral.referredBy && !referralApplied && (
            <div className="wdr-enter">
              <label className="wb-lbl" htmlFor="wd-refcode" style={{ margin: "0 0 6px" }}>{t("Got a code from someone?")}</label>
              <div className="wdr-row">
                <input id="wd-refcode" className="wb-in" value={refInput} maxLength={12} placeholder={t("ENTER CODE")} onChange={(e) => setRefInput(e.target.value.toUpperCase())} />
                <button
                  type="button"
                  className="wb-btn ghost"
                  disabled={busy || refInput.trim().length < 5}
                  onClick={() => submit({ intent: "applyReferral", code: refInput.trim() }, { method: "post" })}
                >{t("Apply")}</button>
              </div>
            </div>
          )}
          {d.referral.referredBy && (
            <div className="wdr-enter"><div className="wb-note">{t("You joined with a referral — enjoy your bonus tokens.")}</div></div>
          )}
        </div>
      )}

      <p className="wb-note" style={{ marginTop: 26 }}>
        {t("Ready to create?")} <Link to="/web/studio">{t("Open the Studio")} →</Link>
      </p>
      </div>
    </div>
  );
}

/* Route-local dashboard styles — GStyle palette (paper #F4F1E6, card #FDFCF7,
 * ink #14201A, green #12A85E, gold #B08526/#E7C879). */
const DASH_CSS = `
/* Helpurr landing hero — the Google-style front door at the top of the home. */
.wd-hero{display:flex;flex-direction:column;align-items:center;text-align:center;
  background:radial-gradient(130% 90% at 50% 0,#FEFDF9,#F1EEE3 80%);border:1px solid var(--line2,#D7DCCB);
  border-radius:24px;padding:clamp(22px,4vw,40px) clamp(16px,5%,40px) clamp(20px,3vw,30px);margin:0 0 14px;
  box-shadow:0 6px 22px rgba(12,122,70,.08);}
.wd-hero-crest{width:72px;height:72px;display:grid;place-items:center;filter:drop-shadow(0 6px 13px rgba(12,122,70,.22));}
.wd-hero-word{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(28px,5.5vw,42px);color:var(--ink);margin:6px 0 2px;letter-spacing:-.01em;line-height:1;}
.wd-hero-word b{color:var(--gold);font-weight:800;}
.wd-hero-sub{font-size:14.5px;color:var(--ink2);margin:0 0 18px;}
.wd-hero-ask{display:flex;align-items:center;gap:8px;width:min(620px,100%);background:var(--card);
  border:1.5px solid var(--line2,#D7DCCB);border-radius:999px;padding:7px 8px 7px 16px;
  box-shadow:0 8px 26px rgba(12,122,70,.1),0 2px 6px rgba(20,32,26,.05);transition:border-color .14s,box-shadow .14s;}
.wd-hero-ask:focus-within{border-color:var(--green);box-shadow:0 10px 30px rgba(12,122,70,.18);}
.wd-hero-spark{flex:0 0 auto;display:grid;place-items:center;color:var(--gold,#B08526);}
.wd-hero-ask input{flex:1;border:0;background:none;outline:none;font:inherit;font-size:16px;color:var(--ink);min-width:0;}
.wd-hero-ask input::placeholder{color:#97a19a;}
.wd-hero-send{flex:0 0 auto;width:44px;height:44px;border-radius:50%;border:0;cursor:pointer;color:#fff;display:grid;place-items:center;
  background:linear-gradient(135deg,var(--green2,#12A85E) 40%,var(--green));box-shadow:0 3px 10px rgba(12,122,70,.3);transition:filter .12s,transform .12s;}
.wd-hero-send:hover{filter:brightness(1.07);transform:translateY(-1px);}
.wd-hero-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:14px;}
.wd-hero-chips button{border:1px solid var(--line2,#D7DCCB);background:var(--card);color:var(--ink2);font:inherit;font-weight:700;font-size:12.5px;cursor:pointer;padding:7px 14px;border-radius:999px;transition:border-color .14s,color .14s;}
.wd-hero-chips button:hover{border-color:var(--green);color:var(--ink);}
.wd-hero-paths{width:min(620px,100%);margin-top:22px;}
.wd-hero-paths-h{display:block;font-weight:800;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink2);margin-bottom:9px;}
.wd-hero-paths-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.wd-path{display:flex;align-items:center;gap:9px;min-width:0;text-align:left;cursor:pointer;
  background:var(--card);border:1px solid var(--line2,#D7DCCB);border-radius:15px;padding:11px 12px;transition:border-color .14s,transform .12s,box-shadow .14s;}
.wd-path:hover{border-color:var(--green);transform:translateY(-2px);box-shadow:0 8px 18px rgba(12,122,70,.12);}
.wd-path-ic{flex:0 0 auto;width:34px;height:34px;display:grid;place-items:center;border-radius:10px;color:var(--green,#0C7A46);background:linear-gradient(140deg,rgba(18,168,94,.14),rgba(176,133,38,.14));}
.wd-path-tx{display:flex;flex-direction:column;gap:1px;min-width:0;}
.wd-path-tx b{font-weight:800;font-size:13px;color:var(--ink);}
.wd-path-tx i{font-style:normal;font-size:11px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;}
/* Image-rich mode cards — the gorgeous Creator/Social art from the old mode gate,
   pulled into the hero so it's one flowing lander instead of a splash + a hero. */
.wd-path-img{flex-direction:column;align-items:stretch;gap:0;padding:0;overflow:hidden;}
.wd-path-hero{display:block;height:96px;background-size:cover;background-position:center;border-bottom:1px solid var(--line2,#D7DCCB);transition:transform .25s ease;}
.wd-path-img:hover .wd-path-hero{transform:scale(1.04);}
.wd-path-img{overflow:hidden;}
.wd-path-body{display:flex;flex-direction:column;gap:3px;padding:13px 15px 14px;min-width:0;}
.wd-path-eyebrow{font-weight:800;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--green);margin-bottom:1px;}
/* Creator card keeps its gold identity (its art is warm/gold); --gold-deep passes
   AA at 9.5px where --gold would not. Social stays green. */
.wd-hero-paths-row .wd-path-img:first-child .wd-path-eyebrow{color:var(--gold-deep,#7E5E13);}
.wd-path-body b{font-weight:800;font-size:16px;line-height:1.2;color:var(--ink);font-family:Poppins,sans-serif;}
.wd-path-body i{font-style:normal;font-size:12.5px;color:var(--ink2);line-height:1.4;}
.wd-path-cost{font-size:11.5px;font-weight:700;color:var(--ink);margin-top:2px;}
.wd-path-img:first-child .wd-path-cost{color:var(--gold-deep,#7E5E13);}
/* Subtle cue that these cards FLIP the app's mode — shows "Current mode" with a
   dot when already active, or a "Switch to …" hint (with a swap glyph) otherwise. */
.wd-path-cue{display:inline-flex;align-items:center;gap:6px;margin-top:9px;font-weight:800;font-size:12px;letter-spacing:.01em;color:var(--green);}
.wd-path-cue svg{transition:transform .15s ease;}
.wd-path:hover .wd-path-cue svg{transform:translateX(3px);}
.wd-path-img:first-child .wd-path-cue{color:var(--gold-deep,#7E5E13);}
.wd-path-dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px rgba(18,168,94,.16);}
.wd-path-img:first-child .wd-path-dot{box-shadow:0 0 0 3px rgba(176,133,38,.16);}
.wd-path-studio{width:100%;margin-top:10px;}
.wd-plan-line{text-align:center;margin:0 0 20px;}
@media(max-width:680px){.wd-hero-paths-row{grid-template-columns:1fr;}.wd-path-tx i,.wd-path-body i{white-space:normal;}.wd-hero-chips button{min-height:44px;display:inline-flex;align-items:center;}}
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
.wdl-tick.on{background:var(--green2);border-color:var(--green2);}
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
.wdw-review .rv-n{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:var(--green2);color:#fff;font-size:12px;font-weight:800;}
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
/* brand "about" live char counter — sits flush-right under the textarea */
.wb-count{text-align:right;font-size:11px;color:var(--ink2);margin:4px 2px 0;font-variant-numeric:tabular-nums;}
/* "(required)" marker on the one brand field the server insists on */
.wb-req{font-weight:700;font-size:11px;color:var(--green);letter-spacing:.01em;}
/* brand voice readout */
.wd-voice{margin:12px 0 2px;}
.wdv-quote{font-family:Poppins,sans-serif;font-weight:700;font-size:15px;color:var(--ink);margin-bottom:8px;}
.wdv-chips{display:flex;gap:8px;flex-wrap:wrap;}
.wdv-chip{font-size:12px;color:var(--ink2);background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-weight:600;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wdv-chip.tone{color:#0A3D26;background:#EAF6EF;border-color:#BFE2CD;max-width:min(260px,100%);}
/* Action-feedback toast — fixed top-center so confirmation/errors from any
   control on the page are seen, not stranded at the body top. Reuses the
   .wb-ok/.wb-err colours; this only repositions + adds the dismiss ✕. */
.wd-toast{position:fixed;top:calc(14px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:400;margin:0;width:max-content;max-width:min(520px,calc(100vw - 24px));display:flex;align-items:center;gap:10px;box-shadow:0 14px 36px rgba(20,32,26,.2);animation:wdToastIn .22s ease both}
@keyframes wdToastIn{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}
.wd-toast>span{flex:1 1 auto}
.wd-toast-x{flex:0 0 auto;border:0;background:none;cursor:pointer;color:inherit;opacity:.55;font-size:13px;line-height:1;padding:0;min-width:32px;min-height:32px;display:grid;place-items:center;border-radius:8px}
.wd-toast-x:hover{opacity:1}
@media(prefers-reduced-motion:reduce){.wd-toast{animation:none}}
/* ── 44px tap-target floor (mobile touch) ── */
.wdw-review{min-height:44px}
@media(max-width:620px){
  .wdl-x{min-width:44px;min-height:44px;display:grid;place-items:center;padding:0}
  .wd-toggle button{min-height:44px}
}
/* ═══ DARK CONSOLE HUB — owner 11-04: the launcher concept merged into the
   Dashboard (reskin dark, keep the content + the Helpurr opener, seamless).
   REVERTABLE: drop the wd-dark/wd-console/wd-wrap wrappers + the console JSX +
   this block, and un-gate /web in web.tsx + restore web.home.tsx. ═══ */
.wd-dark{--paper:#0a120e;--card:#131f18;--ink:#f1eee2;--ink2:#9db0a4;--line:#223429;--line2:#2a3f33;--green:#2cc67f;--green2:#34d98a;--gold:#f2dca0;--gold-deep:#ecd49e;--line-hi:#2e4638;--surface-hi:#17271e;
  --fdisp:"Bricolage Grotesque",Poppins,ui-sans-serif,system-ui,sans-serif;
  color:var(--ink);min-height:100vh;margin:0;padding:0;
  background:radial-gradient(120% 80% at 84% -12%,rgba(44,198,127,.16),transparent 58%),radial-gradient(90% 70% at 4% 2%,rgba(242,220,160,.06),transparent 52%),var(--paper);}
.wd-hd{max-width:1140px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px max(16px,env(safe-area-inset-left,0px)) 4px;}
.wd-hd-brand b{font-family:var(--fdisp);font-weight:800;font-size:19px;letter-spacing:.4px;color:var(--ink);}
.wd-hd-brand b span{color:var(--green);}
.wd-hd-tok{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:13px;color:var(--ink2);white-space:nowrap;}
.wd-hd-tok b{color:var(--ink);font-variant-numeric:tabular-nums;}
.wd-hd-dot{width:6px;height:6px;border-radius:50%;background:var(--green);}
.wd-console{max-width:1140px;margin:0 auto;padding:6px max(16px,env(safe-area-inset-left,0px)) 0;}
.wd-opener{text-align:center;padding:8px 0 2px;}
.wd-opener h1{font-family:var(--fdisp);font-weight:800;font-size:clamp(21px,3.4vw,32px);letter-spacing:-.4px;margin:4px 0 14px;color:var(--ink);text-wrap:balance;}
.wd-ask{display:flex;align-items:center;gap:8px;width:min(640px,100%);margin:0 auto;background:var(--card);border:1.5px solid var(--line);border-radius:999px;padding:7px 8px 7px 16px;box-shadow:0 12px 30px rgba(0,0,0,.4);transition:border-color .14s;}
.wd-ask:focus-within{border-color:var(--green);}
.wd-ask-spark{flex:0 0 auto;display:grid;place-items:center;color:var(--gold);}
.wd-ask input{flex:1;border:0;background:none;outline:none;font:inherit;font-size:16px;color:var(--ink);min-width:0;}
.wd-ask input::placeholder{color:#6f8176;}
.wd-ask-send{flex:0 0 auto;width:44px;height:44px;border-radius:50%;border:0;cursor:pointer;color:#06130c;display:grid;place-items:center;background:linear-gradient(135deg,#34d98a,#2cc67f);box-shadow:0 3px 10px rgba(44,198,127,.4);transition:filter .12s,transform .12s;}
.wd-ask-send:hover{filter:brightness(1.07);transform:translateY(-1px);}
.wd-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:13px;}
.wd-chips button{border:1px solid var(--line);background:var(--card);color:var(--ink2);font:inherit;font-weight:700;font-size:12.5px;cursor:pointer;padding:7px 14px;border-radius:999px;transition:border-color .14s,color .14s;min-height:38px;}
.wd-chips button:hover{border-color:var(--green);color:var(--ink);}
.lx-hero{position:relative;margin-top:20px;border-radius:22px;overflow:hidden;border:1px solid var(--line);background:var(--card);min-height:200px;display:flex;isolation:isolate;}
.lx-herobg{position:absolute;inset:0;z-index:0;animation:lxfade .5s ease;}
.lx-herobg::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,15,12,.88),rgba(8,15,12,.45) 58%,rgba(8,15,12,.08));}
@keyframes lxfade{from{opacity:0}to{opacity:1}}
.lx-heroinner{position:relative;z-index:2;padding:30px 34px;display:flex;flex-direction:column;justify-content:center;gap:11px;max-width:560px;}
.lx-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--hero-accent,var(--green));}
.lx-heroinner h2{font-family:var(--fdisp);font-weight:800;font-size:clamp(25px,3.4vw,38px);line-height:1.03;margin:0;letter-spacing:-.6px;color:var(--ink);text-wrap:balance;}
.lx-heroinner p{margin:0;color:var(--ink);opacity:.82;font-size:14.5px;line-height:1.5;max-width:44ch;}
.lx-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;}
.lx-btn{font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;padding:11px 18px;border-radius:12px;border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:transform .12s,filter .15s;}
.lx-btn:active{transform:translateY(1px);}
.lx-primary{background:linear-gradient(150deg,var(--hero-accent,var(--green)),color-mix(in srgb,var(--hero-accent,var(--green)) 64%,#000));color:#06130c;}
.lx-primary:hover{filter:brightness(1.07);}
.lx-ghost{background:rgba(241,238,226,.06);border-color:var(--line-hi);color:var(--ink);}
.lx-ghost:hover{background:rgba(241,238,226,.11);}
.lx-railhead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:22px 2px 11px;}
.lx-railhead h3{font-family:var(--fdisp);font-weight:700;font-size:14px;letter-spacing:.3px;margin:0;color:var(--ink);}
.lx-hint{font-size:12px;color:var(--ink2);}
.lx-rail{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.lx-tile{position:relative;text-align:left;cursor:pointer;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:15px;padding:14px;display:flex;align-items:center;gap:12px;transition:transform .15s,border-color .15s,background .15s;font-family:Poppins,sans-serif;}
.lx-tile:hover{transform:translateY(-3px);border-color:var(--line-hi);}
.lx-ticon{width:38px;height:38px;flex:none;border-radius:11px;display:grid;place-items:center;background:color-mix(in srgb,var(--t-accent,var(--green)) 15%,transparent);border:1px solid color-mix(in srgb,var(--t-accent,var(--green)) 32%,transparent);color:var(--t-accent,var(--green));}
.lx-tx{min-width:0;display:flex;flex-direction:column;}
.lx-th{font-family:var(--fdisp);font-weight:700;font-size:14.5px;letter-spacing:-.2px;}
.lx-tsub{font-size:11px;color:var(--ink2);line-height:1.3;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lx-tile[aria-selected="true"]{background:var(--surface-hi);border-color:var(--t-accent,var(--green));box-shadow:0 10px 26px rgba(0,0,0,.4);}
.lx-tile[aria-selected="true"] .lx-ticon{background:var(--t-accent,var(--green));border-color:var(--t-accent,var(--green));color:#06130c;}
.lx-tile:focus-visible{outline:2px solid var(--green);outline-offset:3px;}
.wd-wrap{max-width:1140px;margin:28px auto 0;padding:0 max(16px,env(safe-area-inset-left,0px)) 56px;}
@media(max-width:860px){.lx-rail{grid-template-columns:repeat(2,1fr);}}
@media(max-width:520px){.lx-heroinner{padding:24px 20px;}.lx-hero{min-height:176px;}}
/* ── dark overrides: flip the hardcoded-light surfaces the vars don't reach ── */
.wd-dark .wb-card{background:linear-gradient(178deg,#17271e,#111d16);border-color:var(--line);}
.wd-dark .wb-in,.wd-dark .wb-sel,.wd-dark .wb-ta{background:#0e1a13;color:var(--ink);border-color:var(--line);}
.wd-dark .wb-in::placeholder,.wd-dark .wb-ta::placeholder{color:#6f8176;}
.wd-dark .wb-btn.ghost{background:rgba(241,238,226,.05);border-color:var(--line-hi);color:var(--ink);}
.wd-dark .wb-err{background:rgba(214,88,64,.16);border-color:rgba(214,88,64,.42);color:#f0b4a8;}
.wd-dark .wb-ok{background:rgba(44,198,127,.15);border-color:rgba(44,198,127,.42);color:#8fe7b8;}
.wd-dark .wdl-bar{background:#0e1a13;}
.wd-dark .wdl-step{background:#0e1a13;border-color:var(--line);color:var(--ink);}
.wd-dark .wdl-step.next:hover{background:#15271d;}
.wd-dark .wdl-tick{background:#0e1a13;border-color:var(--line);}
.wd-dark .wdw-st,.wd-dark .wdw-tile{background:#0e1a13;border-color:var(--line);}
.wd-dark .wd-next{background:linear-gradient(165deg,#17271e,#111d16);border-color:rgba(44,198,127,.4);color:var(--ink);}
.wd-dark .wdn-kind{background:#0e1a13;border-color:var(--line);}
.wd-dark .wd-toggle{background:#0e1a13;border-color:var(--line);}
.wd-dark .wdv-chip{background:#0e1a13;border-color:var(--line);}
.wd-dark .wdv-chip.tone{background:rgba(44,198,127,.14);color:#8fe7b8;border-color:rgba(44,198,127,.3);}
.wd-dark .wdg-item{background:#0e1a13;border-color:var(--line);}
.wd-dark .wd-solo{background:linear-gradient(135deg,#17271e,#111d16);}
.wd-dark .wdr-code{background:rgba(242,220,160,.12);border-color:rgba(242,220,160,.4);color:var(--gold-deep);}
.wd-dark .wdn-tag{background:rgba(242,220,160,.14);border-color:rgba(242,220,160,.3);color:var(--gold-deep);}
.wd-dark .wb-note a,.wd-dark .wd-plan-line a{color:var(--green2);}
`;
