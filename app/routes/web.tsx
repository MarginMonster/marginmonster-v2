/* Web front-door layout — the non-Shopify shell around dashboard, studio and
 * archive. Same engine, no Polaris/App Bridge; styled to match the landing. */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useNavigate, useSubmit } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { getWebIdentity } from "../lib/web-auth.server";
import { isAdminEmail } from "../lib/admin.server";
import { db } from "../db.server";
import { tokensRemainingLive, planTrialing, monthlyUsageSummary } from "../lib/tokens.server";
import { resolveTierKey, PLAN_BY_KEY, TOKEN_COST } from "../lib/plan-config";
import { normalizeContentLang } from "../lib/content-lang";
import { totalXpForLevel, ACHIEVEMENTS } from "../lib/achievements";
import { Ico } from "../lib/icons";
import { LangToggle } from "../components/LangToggle";
import { UI_LANG_NATIVE } from "../lib/ui-i18n";
import { useT, useUiLang } from "../lib/ui-lang";

const EMPTY_HUD = {
  name: "", email: "", level: 1, xpInto: 0, xpNeed: 40, xpPct: 0,
  tokens: 0, tokensMax: 0, tokensPct: 0, videos: 0, ads: 0,
  planLabel: null as string | null,
  // Value meter — what the plan includes each month, how much is used, and when
  // it refills. Zeroed/empty for an inactive plan.
  planActive: false, trialing: false, monthly: 0, used: 0, extra: 0,
  resetShort: null as string | null,
  // Achievement keys this shop has unlocked — the panel renders the full roster
  // (ACHIEVEMENTS) and marks these as earned.
  unlockedKeys: [] as string[],
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const id = await getWebIdentity(request);
  if (!id) return json({ authed: false, hud: EMPTY_HUD, isAdmin: false });
  const { account, shop } = id;
  const plan = shop.activePlan;
  const tier = plan?.active ? resolveTierKey(plan.type) : null;
  // Wallet ceiling = the plan's monthly allowance + purchased top-ups (mirrors
  // the embedded app's HUD math in app.tsx).
  const tokensMax = plan?.active
    ? Math.max(1, (tier ? PLAN_BY_KEY[tier].monthlyTokens : plan.tokensIncluded) + plan.tokensExtra)
    : 0;
  const tokens = tokensRemainingLive(plan);
  // XP inside the current level, same curve the embedded app plots.
  const cur = totalXpForLevel(shop.level);
  const next = totalXpForLevel(shop.level + 1);
  const xpInto = Math.max(0, shop.xp - cur);
  const xpNeed = Math.max(1, next - cur);
  // Value meter — monthly allowance, usage this cycle, and the refill date,
  // formatted server-side so SSR and client agree (no hydration flicker).
  const usage = monthlyUsageSummary(plan);
  const resetShort = usage.resetAt
    ? new Date(usage.resetAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  // The unlocked-achievement set, so the account panel can show the full roster
  // with earned ones lit. One small indexed read per shell load.
  const unlockedRows = await db.shopAchievement.findMany({ where: { shopId: shop.id }, select: { key: true } });
  return json({
    authed: true,
    isAdmin: isAdminEmail(account.email),
    hud: {
      name: account.name?.trim() || account.email.split("@")[0],
      email: account.email,
      level: shop.level,
      xpInto,
      xpNeed,
      xpPct: Math.max(0, Math.min(100, Math.round((xpInto / xpNeed) * 100))),
      tokens,
      tokensMax,
      tokensPct: tokensMax > 0 ? Math.max(0, Math.min(100, Math.round((tokens / tokensMax) * 100))) : 0,
      videos: Math.floor(tokens / TOKEN_COST.video),
      ads: Math.floor(tokens / TOKEN_COST.image),
      planLabel: tier ? `${PLAN_BY_KEY[tier].name}${planTrialing(plan) ? " · Trial" : ""}` : null,
      planActive: usage.active,
      trialing: usage.trialing,
      monthly: usage.monthly,
      used: usage.used,
      extra: usage.extra,
      resetShort,
      unlockedKeys: unlockedRows.map((r) => r.key),
    },
  });
};

/* The shell carries one action: the header content-language toggle. The toggle
 * lives in THIS layout, and a fetcher submitting to "/web" resolves to this
 * layout route (not the index child), so the setLang handler belongs here. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const id = await getWebIdentity(request);
  if (!id) return json({ ok: false });
  const form = await request.formData();
  if ((form.get("intent") as string) === "setLang") {
    const lang = normalizeContentLang((form.get("contentLang") as string) || "");
    await db.shop.update({ where: { id: id.shop.id }, data: { contentLang: lang } });
    return json({ ok: true, lang });
  }
  return json({ ok: false });
};

export default function WebLayout() {
  const { authed, hud, isAdmin } = useLoaderData<typeof loader>();
  const loc = useLocation();
  const tab = (p: string) => (loc.pathname === p ? "wb-tab on" : "wb-tab");
  // UI display language — the header pill. t() translates chrome; the pill
  // POSTs to /set-ui-lang, which sets the cookie and redirects back so every
  // loader re-runs and the whole app re-renders in the chosen language.
  const t = useT();
  const uiLang = useUiLang();
  const submitLang = useSubmit();

  // Creation mode — "marketing" (sell your products) vs "casual" (just make cool
  // stuff + edit photos). A pure front-end reframe: it swaps copy and hides the
  // merchant-only surfaces, never touching billing or capability gates. Read
  // after mount so SSR + first paint stay on the default 'marketing' and the
  // live paid experience never flips under a merchant mid-hydration. Persisted
  // per browser; see [emMode].
  const [mode, setMode] = useState<"marketing" | "casual">("marketing");
  useEffect(() => { try { const m = localStorage.getItem("emMode"); if (m === "casual" || m === "marketing") setMode(m); } catch { /* storage is a nicety */ } }, []);
  const chooseMode = (m: "marketing" | "casual") => { setMode(m); try { localStorage.setItem("emMode", m); } catch { /* ignore */ } };

  // THE FRONT DOOR — a dedicated path chooser (Marketing vs Creator) so an
  // arrival explicitly picks their side instead of silently landing in the
  // marketing Dashboard and wondering why they're looking at campaigns. Gated
  // on a PER-SESSION flag for now (owner: "make it the default landing even if
  // it's annoying") — it shows once each fresh visit, then lets them move
  // freely. To make it a true ONE-TIME choice later, swap `sessionStorage` +
  // `emChose` for a localStorage check on `emMode` being unset.
  const navigate = useNavigate();
  const [showChooser, setShowChooser] = useState(false);
  useEffect(() => {
    if (!authed) return;
    try { if (!sessionStorage.getItem("emChose")) setShowChooser(true); } catch { /* storage is a nicety */ }
  }, [authed]);
  const pickMode = (m: "marketing" | "casual") => {
    chooseMode(m);
    try { sessionStorage.setItem("emChose", "1"); } catch { /* ignore */ }
    setShowChooser(false);
    // Honor a deep link: the chooser is an overlay on top of the page the
    // visitor actually asked for, so once they pick a mode we just close it and
    // leave them there. Only from the /web home (which has no casual view) do we
    // route to the creator Studio. Previously this always jumped to /web/studio
    // or /web, so a shared /web/archive or /web/channels link was discarded.
    if (loc.pathname === "/web" && m === "casual") navigate("/web/studio");
  };
  // Skip the front door without choosing — closes the overlay and leaves them on
  // the page they landed on, in whatever mode they already had (default
  // marketing). Same session flag so it doesn't pop back up this visit.
  const dismissChooser = () => {
    try { sessionStorage.setItem("emChose", "1"); } catch { /* ignore */ }
    setShowChooser(false);
  };
  // A warm, time-aware greeting for the front door instead of a static line. Safe
  // to read the local hour at render: the chooser only ever renders client-side
  // (showChooser starts false and is flipped on in a mount effect), so there's no
  // SSR/UTC mismatch. The ternary evaluates just the one t() that's shown.
  const greetHour = new Date().getHours();
  const chooserGreeting =
    greetHour >= 22 || greetHour < 5 ? t("Burning the midnight oil? Let's make something.")
    : greetHour < 11 ? t("Morning — what are we making?")
    : greetHour < 17 ? t("What are we working on today?")
    : t("What are we making tonight?");

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wb">
        {authed && showChooser && (
          <div className="wb-chooser" role="dialog" aria-modal="true" aria-label={t("Choose where to start")}>
            {/* The chooser is a full-screen overlay, so the real header (language,
                account, log out) is hidden behind it — carry the essentials here,
                plus an X to skip straight into the app. */}
            <div className="wb-ch-top">
              <LangToggle
                value={uiLang}
                labels={UI_LANG_NATIVE}
                align="right"
                title={t("Display language — translates the app")}
                onPick={(c) => submitLang({ lang: c }, { method: "post", action: "/set-ui-lang" })}
              />
              {authed
                ? <AccountMenu hud={hud} />
                : <Link to="/web/login" className="wb-login">{t("Log in")}</Link>}
              <button type="button" className="wb-ch-skip" onClick={dismissChooser} aria-label={t("Skip into the app")} title={t("Skip into the app")}>✕</button>
            </div>
            <div className="wb-ch-panel">
              <div className="wb-ch-brand"><Crest size={30} /><span>Easy<b>Mode</b></span></div>
              <h1 className="wb-ch-h">{chooserGreeting}</h1>
              <p className="wb-ch-sub">{t("Jump into either — switch between them anytime from the toggle up top.")}</p>
              <div className="wb-ch-grid">
                <button type="button" className="wb-ch-card cr" onClick={() => pickMode("casual")}>
                  <span className="wb-ch-hero" style={{ backgroundImage: "url(/landing/creator-hero.jpg?v=2)" }} aria-hidden="true" />
                  <span className="wb-ch-body">
                    <span className="wb-ch-eyebrow">{t("Creator · Free roam")}</span>
                    <span className="wb-ch-title">{t("Create anything")}</span>
                    <span className="wb-ch-desc">{t("Turn any idea into an image, video or song — just describe it, and it’s yours.")}</span>
                    <span className="wb-ch-nav">{t("Studio · Gallery · Share")}</span>
                    <span className="wb-ch-go">{t("Enter creator")} <span aria-hidden="true">→</span></span>
                  </span>
                </button>
                <button type="button" className="wb-ch-card mk" onClick={() => pickMode("marketing")}>
                  <span className="wb-ch-hero" style={{ backgroundImage: "url(/landing/marketing-hero.jpg)" }} aria-hidden="true" />
                  <span className="wb-ch-body">
                    <span className="wb-ch-eyebrow">{t("Social")}</span>
                    <span className="wb-ch-title">{t("Grow on social")}</span>
                    <span className="wb-ch-desc">{t("AI reels, videos and ads — auto-posted to TikTok, Instagram & Facebook.")}</span>
                    <span className="wb-ch-nav">{t("Dashboard · Campaigns · Channels")}</span>
                    <span className="wb-ch-go">{t("Enter social")} <span aria-hidden="true">→</span></span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
        <header className="wb-nav">
          <Link to="/" className="wb-brand">
            <Crest size={30} />
            <span>Easy<b>Mode</b></span>
          </Link>
          {authed && (
            <nav className="wb-tabs">
              {/* Creator Home merged into the Studio — casual leads with Studio;
                  only Marketing keeps a separate Dashboard. */}
              {mode === "marketing" && <Link className={tab("/web")} to="/web">{t("Dashboard")}</Link>}
              <Link className={tab("/web/studio")} to="/web/studio">{t("Studio")}</Link>
              {/* Helpurr as a dedicated section: opens the chat maximized (full
                  surface), not just the floating bubble. Works in both modes. */}
              {authed && <button type="button" className="wb-tab wb-tab-btn wb-tab-helpurr" onClick={() => window.dispatchEvent(new CustomEvent("helpurr:open", { detail: { max: true } }))}>{t("Helpurr")}</button>}
              {/* Campaigns is a pure selling surface (scheduled ad runs) — hidden
                  in casual, where there's nothing being marketed. */}
              {mode === "marketing" && <Link className={tab("/web/campaigns")} to="/web/campaigns">{t("Campaigns")}</Link>}
              {/* Channels = the autopilot, now a Social surface. One nav entry; the
                  page carries a source switch (My products ↔ Trending topics) that
                  cross-links /web/product-channels and /web/channels. Keep Creator
                  simple (Studio · Gallery · Share) — faceless lives there only as a
                  Studio taste, the recurring autopilot moved to Social. */}
              {mode === "marketing" && <Link className={`${tab("/web/product-channels")}${loc.pathname === "/web/channels" ? " on" : ""}`} to="/web/product-channels">{t("Channels")}</Link>}
              <Link className={tab("/web/archive")} to={mode === "casual" ? "/web/archive?section=creator" : "/web/archive"}>{mode === "casual" ? t("Gallery") : t("Archive")}</Link>
              <Link className={tab("/web/connect")} to="/web/connect">{mode === "casual" ? t("Share") : t("Auto-posting")}</Link>
            </nav>
          )}
          <div className="wb-me">
            <LangToggle
              value={uiLang}
              labels={UI_LANG_NATIVE}
              align="right"
              title={t("Display language — translates the app")}
              onPick={(c) => submitLang({ lang: c }, { method: "post", action: "/set-ui-lang" })}
            />
            {authed && (
              <div className="wb-mode" role="group" aria-label={t("Creation mode")}>
                <button type="button" className={`wb-mode-opt${mode === "casual" ? " on" : ""}`} aria-pressed={mode === "casual"} onClick={() => { chooseMode("casual"); if (loc.pathname === "/web") navigate("/web/studio"); }} title={t("Create for yourself — images, videos & music, no store needed")}>{t("Creator")}</button>
                <button type="button" className={`wb-mode-opt${mode === "marketing" ? " on" : ""}`} aria-pressed={mode === "marketing"} onClick={() => chooseMode("marketing")} title={t("Grow on social — AI reels, videos & auto-posting")}>{t("Social")}</button>
              </div>
            )}
            {isAdmin && (
              <Link to="/admin/dashboard" className="wb-admin" title="Admin dashboard" aria-label="Admin dashboard">
                <Ico n="trend" />
              </Link>
            )}
            {authed
              ? <AccountMenu hud={hud} />
              : <Link to="/web/login" className="wb-login">{t("Log in")}</Link>}
          </div>
        </header>

        <main className="wb-main">
          <Outlet context={{ mode, setMode: chooseMode }} />
        </main>
        {!showChooser && <Buddy hud={hud} authed={authed} mode={mode} />}
      </div>
    </>
  );
}

/* Helpurr — the AI helper. A floating sidekick with real character that
 * greets you by name, suggests what to make, and drops tappable buttons under
 * its replies that take you straight there. Talks to /api/buddy (Haiku behind a
 * hype persona). It can't click for you yet — the buttons are its hands. */
type MMAction = { label: string; to: string };
// A Phase-2 "set up a creation" proposal — rendered as a prominent confirm
// button that opens the task in the Studio pre-filled, where the user approves
// the actual spend. Helpurr never spends tokens itself.
type MMPending = { label: string; to: string; cost: number; kind: string };
type MMMedia = { url: string; type: string; title?: string };
type MMPendingMake = { kind: "image" | "video"; product: string; presenter: boolean; direction: string; cost: number; label: string };
type MMMsg = { role: "user" | "assistant"; content: string; actions?: MMAction[]; pending?: MMPending; media?: MMMedia[]; make?: MMPendingMake };
function Buddy({ hud, authed, mode }: { hud: { name: string; ads: number; level: number }; authed: boolean; mode: "marketing" | "casual" }) {
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  // Maximized = the dedicated full-screen Helpurr surface (a "chat section"),
  // opened from the nav. Same chat, same logic — just a roomier layout with a
  // backdrop. The floating panel is the compact default.
  const [max, setMax] = useState(false);
  const [msgs, setMsgs] = useState<MMMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // A make-from-chat generation in flight — disables other "Make it" buttons so
  // one tap can't become two paid jobs. Chat stays usable (makes take minutes).
  const [making, setMaking] = useState(false);
  // Persistent memory: once the saved thread has loaded (or confirmed empty) the
  // greeting may fire. Starts false so we don't greet over a conversation that's
  // about to load back in from the server.
  const [histReady, setHistReady] = useState(false);
  // Chat tabs (projects). "main" is the default thread; others are created on
  // demand. Threads are per mode (marketing/casual keep separate sets).
  const [threads, setThreads] = useState<Array<{ id: string; title: string }>>([{ id: "main", title: "Main" }]);
  const [activeThreadId, setActiveThreadId] = useState("main");
  const listRef = useRef<HTMLDivElement>(null);
  const t = useT();

  // Flipping mode is a different project set — back to that mode's Main thread.
  useEffect(() => { setActiveThreadId("main"); }, [mode]);

  // Load Helpurr's saved conversation for this mode when the chat opens, so it
  // continues where it left off instead of starting fresh each reload. Marketing
  // and casual keep separate threads; flipping mode loads the other one.
  useEffect(() => {
    if (!open || !authed) { if (!authed) setHistReady(true); return; }
    let cancelled = false;
    setHistReady(false);
    (async () => {
      try {
        // Cache-buster: the proactive suggestion is freshly randomised server-side,
        // so bypass the browser's GET cache to get a new one each open.
        const res = await fetch(`/api/buddy?mode=${mode}&thread=${activeThreadId}&_=${Date.now()}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({ history: [] }))) as { history?: Array<{ role?: string; content?: string }>; proactive?: { reply?: string; pendingAction?: MMPending | null } | null; threads?: Array<{ id: string; title: string }> };
        if (cancelled) return;
        if (Array.isArray(data.threads) && data.threads.length) setThreads(data.threads);
        const hist = (Array.isArray(data.history) ? data.history : [])
          .filter((m) => m && typeof m.content === "string" && m.content.trim())
          .map((m): MMMsg => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content as string }));
        // Proactive, store-grounded suggestion: the opener for a fresh thread, or
        // a fresh nudge at the end of an existing one. Not saved (transient).
        const nudge: MMMsg | null = data.proactive && data.proactive.reply
          ? { role: "assistant", content: data.proactive.reply, pending: data.proactive.pendingAction || undefined }
          : null;
        setMsgs(hist.length ? (nudge ? [...hist, nudge] : hist) : (nudge ? [nudge] : [])); // empty → the greeting effect fills it below
      } catch { if (!cancelled) setMsgs([]); }
      finally { if (!cancelled) setHistReady(true); }
    })();
    return () => { cancelled = true; };
  }, [open, authed, mode, activeThreadId]);

  useEffect(() => {
    // Fallback greeting only when the load effect left the chat empty — i.e. no
    // saved history AND no proactive suggestion (a guest, or a server hiccup).
    // Authed users get the store-grounded proactive opener from the load effect.
    if (open && histReady && msgs.length === 0) {
      const name = authed && hud.name ? hud.name.split(" ")[0] : null;
      const greet = mode === "casual"
        ? (name
            ? t("Hey {name}! I'm Helpurr, your AI helper — got {ads} images' worth of tokens to play with. Want to edit a photo or make something fun to post?", { name, ads: hud.ads })
            : t("Hey — I'm Helpurr your AI helper. Upload a photo and we'll restyle it, swap the background, or make something fun to share."))
        : (name
            ? t("Hey {name}! I'm Helpurr, your AI helper — you've got {ads} ads' worth of tokens in the tank. What are we making?", { name, ads: hud.ads })
            : t("Hey — I'm Helpurr your AI helper for ads & videos. Tell me what you're selling and let's make something scroll-stopping."));
      setMsgs([{ role: "assistant", content: greet }]);
    }
  }, [open, histReady, msgs.length, authed, hud.name, hud.ads, mode, t]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy]);
  // Let any page open the chat — the Creator home's "Ask Helpurr" card fires this.
  useEffect(() => {
    const h = (e: Event) => {
      setOpen(true);
      const detail = (e as CustomEvent<{ text?: string; max?: boolean }>).detail;
      // The nav "Helpurr" entry opens the dedicated full-screen surface.
      if (detail?.max) setMax(true);
      // The Creator home's Chat mode passes the typed prompt — prefill the box
      // so the user just hits send (we don't auto-send; let them confirm).
      const prefill = detail?.text;
      if (typeof prefill === "string" && prefill.trim()) setInput(prefill);
    };
    window.addEventListener("helpurr:open", h);
    return () => window.removeEventListener("helpurr:open", h);
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const next: MMMsg[] = [...msgs, { role: "user", content: trimmed }];
    setMsgs(next); setInput(""); setBusy(true);
    // Optimistically name a brand-new thread from the first message (the server
    // does the same; this just avoids a flash of "New chat" on the tab).
    if (activeThreadId !== "main") setThreads((ts) => ts.map((th) => (th.id === activeThreadId && th.title === "New chat" ? { ...th, title: trimmed.slice(0, 42) } : th)));
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next.slice(-24).map(({ role, content }) => ({ role, content })), path: loc.pathname, mode, threadId: activeThreadId }) });
      const data = await res.json().catch(() => ({ reply: "", actions: [] })) as { reply?: string; actions?: MMAction[]; pendingAction?: MMPending | null; media?: MMMedia[]; pendingMake?: MMPendingMake | null };
      setMsgs((m) => [...m, { role: "assistant", content: data.reply || "…", actions: Array.isArray(data.actions) ? data.actions : [], pending: data.pendingAction || undefined, media: Array.isArray(data.media) && data.media.length ? data.media : undefined, make: data.pendingMake || undefined }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: t("Connection blipped — mind trying again?") }]);
    } finally { setBusy(false); }
  };

  // One-tap confirm on a Helpurr "Make it" button: spend the tokens, kick off the
  // SAME tested job the Studio enqueues, then poll until the media lands and drop
  // it inline in the chat. Chat stays usable throughout (makes take minutes).
  const runMake = async (spec: MMPendingMake) => {
    if (making) return;
    setMaking(true);
    // Remove the pending make from every message so the button can't be tapped twice.
    setMsgs((m) => m.map((x) => (x.make ? { ...x, make: undefined } : x)));
    const noun = spec.kind === "video" ? t("video") : t("image");
    setMsgs((m) => [...m, { role: "assistant", content: t("On it — making your {noun} now. This takes a minute; keep chatting if you like and I'll drop it here when it's ready. 🎬", { noun }) }]);
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "make", make: spec, mode }) });
      const data = await res.json().catch(() => ({})) as { jobId?: string; cursor?: number; kind?: string; error?: string };
      if (!data.jobId || typeof data.cursor !== "number") {
        setMsgs((m) => [...m, { role: "assistant", content: data.error || t("Couldn't start that one — mind trying again?") }]);
        setMaking(false);
        return;
      }
      const { jobId, cursor } = data;
      const kind = data.kind || spec.kind;
      // Poll by job id + a time cursor (assets carry no jobId column; the server
      // correlates the newest asset of this type since the cursor). Video is slow.
      const limit = kind === "video" ? 60 : 24; // ~5min / ~2min at 5s
      let tries = 0;
      const tick = async () => {
        tries++;
        try {
          const r = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "makeStatus", jobId, cursor, kind, mode }) });
          const s = await r.json().catch(() => ({})) as { done?: boolean; media?: MMMedia[]; failed?: boolean; error?: string };
          if (s.failed) {
            setMsgs((m) => [...m, { role: "assistant", content: s.error || t("That one didn't come out right, so I refunded the tokens. Want to try again?") }]);
            setMaking(false);
            return;
          }
          if (s.done && Array.isArray(s.media) && s.media.length) {
            setMsgs((m) => [...m, { role: "assistant", content: t("Here it is! 🎉 Tap to open it full-size. Want a tweak, or should I make another?"), media: s.media }]);
            setMaking(false);
            return;
          }
        } catch { /* transient — keep polling */ }
        if (tries >= limit) {
          setMsgs((m) => [...m, { role: "assistant", content: t("Still cooking — it's taking longer than usual. Check your Gallery in a moment; it'll land there when it's done.") }]);
          setMaking(false);
          return;
        }
        window.setTimeout(tick, 5000);
      };
      window.setTimeout(tick, 5000);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: t("Connection blipped before I could start — mind trying again?") }]);
      setMaking(false);
    }
  };

  // Create a fresh project/thread and switch to it (loads empty → proactive opener).
  const newThread = async () => {
    if (busy) return;
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "newThread", mode }) });
      const data = await res.json().catch(() => ({})) as { threadId?: string; title?: string };
      if (data.threadId) {
        setThreads((ts) => [...ts, { id: data.threadId as string, title: data.title || "New chat" }]);
        setActiveThreadId(data.threadId);
      }
    } catch { /* ignore */ }
  };

  const go = (to: string) => { setOpen(false); if (to.startsWith("/web#")) { window.location.href = to; } else { nav(to); } };
  const chips = mode === "casual"
    ? [t("Edit one of my photos"), t("Make a fun post"), t("Turn this into a sticker")]
    : [t("Make me an ad"), t("Which format converts best?"), t("Give me an idea for a video")];

  return (
    <>
      <button type="button" className={`mm-fab${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-label={t("Chat with Helpurr, your AI helper")}>
        <Familiar />
        {!open && <span className="mm-fab-dot" aria-hidden="true" />}
      </button>
      {open && max && <div className="mm-backdrop" onClick={() => setMax(false)} aria-hidden="true" />}
      {open && (
        <div className={`mm-panel${max ? " mm-max" : ""}`} role="dialog" aria-label={t("Helpurr chat")}>
          <div className="mm-head">
            <span className="mm-head-crest"><Familiar think={busy} /></span>
            <div className="mm-head-txt"><b>Helpurr</b><span>{busy ? t("thinking…") : t("your AI helper")}</span></div>
            <button type="button" className="mm-expand" onClick={() => setMax((m) => !m)} aria-label={max ? t("Shrink chat") : t("Expand chat")} title={max ? t("Shrink") : t("Expand")}>{max ? "⤡" : "⤢"}</button>
            <button type="button" className="mm-x" onClick={() => { setOpen(false); setMax(false); }} aria-label={t("Close chat")}>×</button>
          </div>
          {authed && (
            <div className="mm-tabs" role="tablist" aria-label={t("Your chats")}>
              {threads.map((th) => (
                <button key={th.id} type="button" role="tab" aria-selected={th.id === activeThreadId}
                  className={`mm-tab${th.id === activeThreadId ? " on" : ""}`}
                  onClick={() => { if (th.id !== activeThreadId && !busy) setActiveThreadId(th.id); }} title={th.title}>
                  {th.title}
                </button>
              ))}
              <button type="button" className="mm-tab mm-tab-new" onClick={newThread} title={t("New chat")} aria-label={t("Start a new chat")}>+</button>
            </div>
          )}
          <div className="mm-list" ref={listRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`mm-row ${m.role}`}>
                <div className={`mm-msg ${m.role}`}>{m.content}</div>
                {m.media && m.media.length > 0 && (
                  <div className="mm-media">
                    {m.media.map((md, j) => (
                      md.type === "VIDEO_AD"
                        ? <video key={j} src={md.url} className="mm-media-item" controls muted playsInline preload="metadata" />
                        : md.type === "AUDIO"
                          ? <audio key={j} src={md.url} className="mm-media-aud" controls />
                          : <a key={j} href={md.url} target="_blank" rel="noreferrer" className="mm-media-link" title={md.title || ""}><img src={md.url} alt={md.title || ""} className="mm-media-item" loading="lazy" /></a>
                    ))}
                  </div>
                )}
                {m.pending && (
                  <button type="button" className="mm-make" onClick={() => go(m.pending!.to)}>
                    <span>✨ {m.pending.label}</span>
                    <b>{m.pending.cost > 0 ? t("~{n} tokens →", { n: m.pending.cost }) : "→"}</b>
                  </button>
                )}
                {m.make && (
                  <button type="button" className="mm-make mm-make-go" disabled={making} onClick={() => runMake(m.make!)}>
                    <span>{making ? t("Working…") : t("✨ {label}", { label: m.make.label })}</span>
                    <b>{m.make.cost > 0 ? t("{n} tokens →", { n: m.make.cost }) : "→"}</b>
                  </button>
                )}
                {m.actions && m.actions.length > 0 && (
                  <div className="mm-acts">{m.actions.map((a) => <button key={a.to + a.label} type="button" className="mm-act" onClick={() => go(a.to)}>{a.label}</button>)}</div>
                )}
              </div>
            ))}
            {busy && <div className="mm-msg assistant mm-typing"><i /><i /><i /></div>}
            {msgs.length <= 1 && !busy && (
              <div className="mm-chips">{chips.map((c) => <button key={c} type="button" onClick={() => send(c)}>{c}</button>)}</div>
            )}
          </div>
          <form className="mm-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("Ask Helpurr…")} aria-label={t("Message Helpurr")} />
            <button type="submit" disabled={busy || !input.trim()} aria-label={t("Send")}>➤</button>
          </form>
        </div>
      )}
    </>
  );
}

/* Helpurr the familiar — a smart emerald PIXEL-ART cat (open-eyes sprite at
 * /familiar-px.png, eyes-closed frame at /familiar-px-blink.png) brought to life
 * with CSS: it idly bobs and breathes, blinks on its own by swapping frames, and
 * bursts gold pixel-sparks when tapped. Each instance self-animates on its own
 * rAF; honours prefers-reduced-motion (stays still). */
const FAM = { open: "/familiar-px.png", blink: "/familiar-px-blink.png?v=2", pawup: "/familiar-px-pawup.png", lick: "/familiar-px-lick.png" };
function famBurst(el: HTMLElement) {
  const img = el.querySelector("img.mm-fam-img") as HTMLImageElement | null;
  if (img) img.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.4)" }, { filter: "brightness(1)" }], { duration: 400, easing: "ease-out" });
  const R = el.getBoundingClientRect();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, sp = document.createElement("span");
    sp.className = "mm-fam-spark";
    sp.style.left = R.width / 2 + "px"; sp.style.top = R.height * 0.45 + "px";
    el.appendChild(sp);
    const d = R.width * 0.52;
    sp.animate([{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d - 2}px, ${Math.sin(a) * d - 2}px) scale(.3)`, opacity: 0 }], { duration: 520 + Math.random() * 200, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => sp.remove();
  }
}
function Familiar({ think }: { think?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const img = el.querySelector("img.mm-fam-img") as HTMLImageElement | null;
    if (!img) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    [FAM.blink, FAM.pawup, FAM.lick].forEach((s) => { const im = new Image(); im.src = s; }); // preload frames
    const ph = Math.random() * 6.28;
    let raf = 0;
    const t0 = performance.now();
    let nextAction = 2000 + Math.random() * 3000;
    let steps: { src: string; dur: number }[] | null = null, idx = 0, stepStart = 0;
    const frame = (now: number) => {
      const t = now - t0;
      const bob = Math.sin(t / 640 + ph) * 2.3, br = 1 + Math.sin(t / 1250 + ph) * 0.02;
      img.style.transform = `translateY(${bob.toFixed(2)}px) scale(${br.toFixed(3)})`;
      if (steps) {
        if (now - stepStart >= steps[idx].dur) {
          idx++;
          if (idx >= steps.length) { steps = null; img.src = FAM.open; nextAction = t + 2600 + Math.random() * 4000; }
          else { stepStart = now; img.src = steps[idx].src; }
        }
      } else if (t >= nextAction) {
        steps = Math.random() < 0.65
          ? [{ src: FAM.blink, dur: 150 }]
          : [{ src: FAM.pawup, dur: 200 }, { src: FAM.lick, dur: 260 }, { src: FAM.pawup, dur: 150 }, { src: FAM.lick, dur: 260 }, { src: FAM.pawup, dur: 170 }];
        idx = 0; stepStart = now; img.src = steps[0].src;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className={`mm-fam${think ? " think" : ""}`} ref={ref} onClick={() => { if (ref.current) famBurst(ref.current); }}>
      <img className="mm-fam-img" src={FAM.open} alt="" draggable={false} />
    </span>
  );
}

/* The EasyMode mark — Helpurr's head. A clean pixel-art cutout (no tile, no
 * rim): just the cat, ears and glasses, floating on the page the way a mascot
 * mark should. Helpurr is the brand face everywhere the old gold "E" used to
 * sit. The account avatar (which a member can swap for their own photo) is a
 * SEPARATE thing — see AccountMenu. */
function Crest({ size }: { size: number }) {
  return (
    <span className="wb-crest" style={{ width: size, height: size }} aria-hidden="true">
      <img src="/helpurr-head.png?v=4" alt="" />
    </span>
  );
}

/* Account menu — the member's hub. Replaces BOTH the old "Log out" link and
 * the old full status bar: a compact chip (avatar · level · tokens) in the
 * header that drops a panel carrying everything that bar used to show — XP/level
 * progress (the rewards track), the achievement roster, the token wallet + value
 * meter, what the balance affords — plus plan management, a changeable avatar,
 * and log out.
 * The avatar personalises PER BROWSER (a downscaled data-URL in localStorage);
 * Helpurr stays the default and the brand mark is always Helpurr. A
 * server-backed avatar can replace the localStorage one later. */
function AccountMenu({ hud }: { hud: typeof EMPTY_HUD }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Personal avatar is a per-browser nicety — load after mount so SSR is stable.
  useEffect(() => { try { const a = localStorage.getItem("emAvatar"); if (a) setAvatar(a); } catch { /* ignore */ } }, []);
  // Close on outside-click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pickAvatar = () => fileRef.current?.click();
  const onFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ""; // allow re-selecting the same file
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Square-crop + downscale to 128px so the data URL stays tiny in storage.
        const S = 128, cv = document.createElement("canvas");
        cv.width = S; cv.height = S;
        const ctx = cv.getContext("2d"); if (!ctx) return;
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
        const url = cv.toDataURL("image/png");
        setAvatar(url);
        try { localStorage.setItem("emAvatar", url); } catch { /* ignore */ }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  const resetAvatar = () => { setAvatar(null); try { localStorage.removeItem("emAvatar"); } catch { /* ignore */ } };

  // Account avatar = the member's OWN face, not the brand. Default is an
  // initials monogram (first letter of the account name), so it reads as "you"
  // and doesn't add a third/fourth Helpurr to a page that already carries the
  // brand mark and the Helpurr helper. An uploaded photo overrides it.
  const initial = ((hud.name || hud.email || "?").trim().charAt(0) || "?").toUpperCase();
  const toNext = Math.max(0, hud.xpNeed - hud.xpInto);
  const unlocked = new Set(hud.unlockedKeys);
  const unlockedCount = ACHIEVEMENTS.reduce((n, a) => n + (unlocked.has(a.key) ? 1 : 0), 0);

  return (
    <div className="wb-acct" ref={wrapRef}>
      <button
        type="button"
        className={`wb-chip${open ? " on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu" aria-expanded={open}
        aria-label={t("Account menu — level {lvl}, {tokens} tokens", { lvl: hud.level, tokens: hud.tokens.toLocaleString() })}
      >
        <span className={`wb-chip-ava${avatar ? " photo" : " mono"}`}>{avatar ? <img src={avatar} alt="" /> : <span className="wb-ava-mono">{initial}</span>}</span>
        <span className="wb-chip-lvl">LVL {hud.level}</span>
        <span className="wb-chip-tok"><Ico n="coin" /> {hud.tokens.toLocaleString()}</span>
        <span className="wb-chip-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="wb-menu" role="menu">
          {/* Identity + changeable avatar */}
          <div className="wb-menu-id">
            <button type="button" className={`wb-menu-ava${avatar ? " photo" : " mono"}`} onClick={pickAvatar} title={t("Change your avatar")} aria-label={t("Change your avatar")}>
              {avatar ? <img src={avatar} alt="" /> : <span className="wb-ava-mono">{initial}</span>}
              <span className="wb-menu-cam" aria-hidden="true"><Ico n="camera" /></span>
            </button>
            <div className="wb-menu-idtxt">
              <b>{hud.name}</b>
              {hud.email && <span className="wb-menu-email">{hud.email}</span>}
            </div>
            {hud.planLabel
              ? <Link to="/web#plans" className="wb-menu-plan" onClick={() => setOpen(false)}>{hud.planLabel}</Link>
              : <Link to="/web#plans" className="wb-menu-plan off" onClick={() => setOpen(false)}>{t("No plan")}</Link>}
          </div>

          {/* XP / level — the rewards track: every level pays out free tokens */}
          <div className="wb-menu-sec">
            <div className="wb-menu-barlabel">
              <span>{t("XP · Level {n}", { n: hud.level })}</span>
              <span>{t("{left} to LVL {next}", { left: toNext.toLocaleString(), next: hud.level + 1 })}</span>
            </div>
            <div className="wb-menu-xp" title={t("{pct}% of the way to level {next}", { pct: hud.xpPct, next: hud.level + 1 })}><i style={{ width: `${hud.xpPct}%` }} /></div>
            <div className="wb-menu-hint"><Ico n="gift" /> {t("Every level pays out free tokens.")}</div>
          </div>

          {/* Achievements — the full roster, earned ones lit. Each pays a one-off
              XP/token bonus (see achievements.ts); a scrollable box keeps the
              panel compact and Log out reachable. */}
          <div className="wb-menu-sec">
            <div className="wb-menu-barlabel">
              <span>{t("Achievements")}</span>
              <span>{unlockedCount}/{ACHIEVEMENTS.length}</span>
            </div>
            <ul className="wb-ach-grid">
              {ACHIEVEMENTS.map((a) => {
                const got = unlocked.has(a.key);
                return (
                  <li key={a.key} className={`wb-ach${got ? " got" : ""}`}>
                    <span className="wb-ach-ic" aria-hidden="true">{a.icon}</span>
                    <span className="wb-ach-tx"><b>{t(a.label)}</b><em>{t(a.desc)}</em></span>
                    <span className="wb-ach-rw">
                      {got
                        ? <span className="wb-ach-done" aria-label={t("Unlocked")}>✓</span>
                        : a.tokens > 0
                          ? <span className="wb-ach-rew"><Ico n="coin" /> +{a.tokens}</span>
                          : <span className="wb-ach-rew">+{a.xp} XP</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Token wallet + value meter */}
          <div className="wb-menu-sec">
            <div className="wb-menu-barlabel"><span>{t("Token reserve")}</span><span>{hud.tokens.toLocaleString()} / {hud.tokensMax.toLocaleString()}</span></div>
            <div className="wb-menu-hp" title={t("{pct}% of your wallet remaining", { pct: hud.tokensPct })}><i style={{ width: `${hud.tokensPct}%` }} /></div>
            {hud.planActive && (
              <div className="wb-menu-meter">
                {hud.trialing
                  ? t("Trial · {monthly}/mo unlocks when your plan starts", { monthly: hud.monthly.toLocaleString() })
                  : t("{monthly} tokens included monthly · {used} used", { monthly: hud.monthly.toLocaleString(), used: hud.used.toLocaleString() })}
                {hud.planActive && !hud.trialing && hud.resetShort && <span className="wb-menu-meter-r"> · {t("↻ refills {date}", { date: hud.resetShort })}</span>}
              </div>
            )}
            {hud.planActive && !hud.trialing && hud.extra > 0 && (
              <div className="wb-menu-extra"><Ico n="coin" /> {t("+{extra} top-up tokens · never expire", { extra: hud.extra.toLocaleString() })}</div>
            )}
            <div className="wb-menu-affords">
              <span><Ico n="video" /> {hud.videos === 1 ? t("{n} video’s worth", { n: hud.videos }) : t("{n} videos’ worth", { n: hud.videos })}</span>
              <span><Ico n="image" /> {hud.ads === 1 ? t("{n} image’s worth", { n: hud.ads }) : t("{n} images’ worth", { n: hud.ads })}</span>
            </div>
            <Link to="/web#plans" className="wb-menu-topup" onClick={() => setOpen(false)}><Ico n="coin" /> {t("Add tokens")}</Link>
          </div>

          {/* Actions */}
          <div className="wb-menu-links">
            <button type="button" className="wb-menu-link" onClick={pickAvatar}><Ico n="camera" /> {t("Change avatar")}</button>
            {avatar && <button type="button" className="wb-menu-link" onClick={resetAvatar}><Ico n="refresh" /> {t("Remove photo")}</button>}
            <Link to="/web/logout" className="wb-menu-link danger">{t("Log out")}</Link>
          </div>

          <input ref={fileRef} type="file" accept="image/*" onChange={(e) => onFile(e.currentTarget)} hidden />
        </div>
      )}
    </div>
  );
}

const CSS = `
/* Font is linked from the document head (app/root.tsx). An @import here
   cost three sequential round trips before any text rendered in Poppins. */
*{box-sizing:border-box} html,body{margin:0;padding:0}
/* Theme tokens also live on :root so content portaled OUT of .wb (e.g. the
   archive fullscreen viewer, which renders to document.body to escape the
   .wb-main stacking context) still inherits the palette. Additive only — the
   .wb rule below keeps its own copy and its cream background/positioning. */
:root{--paper:#F4F1E6;--card:#FDFCF7;--ink:#14201A;--ink2:#4A554E;--line:#E1DECD;--line2:#D7DCCB;--green:#0C7A46;--green2:#12A85E;--gold:#B08526;--gold-deep:#7E5E13;}
.wb{--paper:#F4F1E6;--card:#FDFCF7;--ink:#14201A;--ink2:#4A554E;--line:#E1DECD;--line2:#D7DCCB;--green:#0C7A46;--green2:#12A85E;--gold:#B08526;--gold-deep:#7E5E13;
  position:relative;min-height:100vh;color:var(--ink);font-family:Inter,-apple-system,sans-serif;
  /* A green field instead of flat cream: three soft washes give the page a
     direction to read down. There WAS a diagonal hairline hatch here too, but
     two crossing diagonals make diamonds, and diamonds at this scale read as
     reptile scales. The rosettes below carry the texture instead. */
  background:
    radial-gradient(72% 52% at 50% -8%,rgba(15,145,82,.14),transparent 62%),
    radial-gradient(46% 34% at 4% 24%,rgba(12,122,70,.09),transparent 66%),
    radial-gradient(54% 40% at 98% 64%,rgba(176,133,38,.075),transparent 68%),
    var(--paper);}
/* Two ambient rosettes drifting behind everything — the same figure the buffer
   spins, in the green cut so it reads as a watermark on cream rather than
   disappearing. Fixed, so they sit still while the page scrolls past. */
.wb::before,.wb::after{content:"";position:fixed;z-index:0;pointer-events:none;
  background-repeat:no-repeat;background-position:center;background-size:contain;}
.wb::before{top:-190px;right:-240px;width:660px;height:660px;opacity:.075;
  background-image:url(/gstyle-rosette-green.svg);animation:wbDrift 210s linear infinite;}
.wb::after{bottom:-290px;left:-270px;width:620px;height:620px;opacity:.05;
  background-image:url(/gstyle-rosette-green.svg);animation:wbDriftBack 260s linear infinite;}
@keyframes wbDrift{to{transform:rotate(360deg)}}
@keyframes wbDriftBack{to{transform:rotate(-360deg)}}
@media (prefers-reduced-motion:reduce){.wb::before,.wb::after,.wb-chooser::before,.wb-chooser::after,.wb-ch-go::after{animation:none}}
/* Everything real sits above the ambient layer. The nav sits ABOVE the HUD and
   main so the language dropdown — which overflows the header downward — paints
   over them instead of being hidden behind the HUD pill (which also stole the
   taps meant for the lower menu items, so Chinese couldn't be selected). */
.wb-hud,.wb-main{position:relative;z-index:1;}
/* Two-tier header: brand (left) + account controls (lang · mode · account) on
   the TOP row at the RIGHT, with the nav tabs on their own row below. The
   account controls used to wrap UNDER the tabs on the left at desktop width —
   this pins them top-right and pushes the tabs to row two. */
/* Keyboard focus ring — the shell had no :focus-visible at all, so tabbing
   through it was invisible. One token-based ring for every focusable control
   (outline follows each element's own radius; no layout shift). */
.wb a:focus-visible,.wb button:focus-visible,.wb input:focus-visible,.wb select:focus-visible,.wb textarea:focus-visible,.wb [tabindex]:focus-visible,
.wb-chooser a:focus-visible,.wb-chooser button:focus-visible{
  outline:2px solid var(--green2,#12A85E);outline-offset:2px;
}
.wb-nav{position:relative;z-index:30;display:flex;align-items:center;gap:14px 18px;max-width:1080px;margin:0 auto;padding:18px 24px;flex-wrap:wrap;}
.wb-brand{order:1;display:flex;align-items:center;gap:8px;font-family:Poppins,sans-serif;font-weight:800;font-size:18px;color:var(--ink);text-decoration:none;}
.wb-brand b{color:var(--gold)}
.wb-tabs{order:3;flex-basis:100%;display:flex;gap:6px;margin-top:2px;}
.wb-tab{padding:8px 16px;border-radius:11px;text-decoration:none;font-weight:700;font-size:13.5px;color:var(--ink2);}
.wb-tab-btn{background:none;border:0;cursor:pointer;font-family:inherit;}
.wb-tab-helpurr{color:var(--brand,#0C7A46);} .wb-tab-helpurr:hover{color:#0A5C35;}
.wb-tab.on{background:var(--card);border:1px solid var(--line);color:var(--ink);box-shadow:0 2px 6px rgba(20,32,26,.06);}
.wb-me{order:2;margin-left:auto;display:flex;align-items:center;gap:12px;}
.wb-out{font-size:13px;color:var(--ink2);text-decoration:none;font-weight:600;padding:8px 12px;border-radius:10px;}
/* Discreet owner-only link to /admin/dashboard — muted, small, only rendered
   when the logged-in email is on ADMIN_EMAILS. */
.wb-admin{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:9px;color:var(--ink2);opacity:.55;transition:opacity .14s,background .14s;}
.wb-admin:hover{opacity:1;background:var(--card);}
.wb-admin svg{width:17px;height:17px;}
.wb-out:hover{color:var(--ink);background:rgba(20,32,26,.05);}
/* Logged-out "Log in" is a real target, not stray text floating in the bar. */
.wb-login{font-family:Poppins,sans-serif;font-weight:800;font-size:13px;text-decoration:none;color:var(--ink);
  padding:9px 18px;border-radius:11px;background:var(--card);border:1px solid var(--line);box-shadow:0 2px 6px rgba(20,32,26,.06);}
.wb-login:hover{border-color:var(--green2);color:var(--green);}
/* Creation-mode pill — flips the whole app between selling (Marketing) and
   just-for-fun (Casual). Lives in the bar on every page so it reads as a true,
   readily-available switch rather than a buried setting. */
.wb-mode{display:inline-flex;padding:3px;border-radius:999px;background:var(--paper,#F4F1E6);border:1px solid var(--line);flex:0 0 auto;}
.wb-mode-opt{border:0;background:none;padding:6px 13px;border-radius:999px;font:inherit;font-size:12px;font-weight:800;letter-spacing:.02em;color:var(--ink2);cursor:pointer;line-height:1;white-space:nowrap;}
.wb-mode-opt.on{background:linear-gradient(135deg,var(--green,#12A85E),var(--green2,#0C7A46));color:#fff;box-shadow:0 1px 4px rgba(12,122,70,.3);}
.wb-mode-opt:not(.on):hover{color:var(--ink);}
/* THE FRONT DOOR — full-screen path chooser shown on arrival (see WebLayout).
   Inside .wb so it inherits the theme tokens; fixed over everything. */
.wb-chooser{position:fixed;inset:0;z-index:200;display:flex;align-items:flex-start;justify-content:center;padding:calc(62px + env(safe-area-inset-top,0px)) 18px 20px;overflow-x:hidden;overflow-y:auto;
  background:radial-gradient(74% 54% at 50% -4%,rgba(15,145,82,.16),transparent 60%),radial-gradient(50% 36% at 98% 96%,rgba(176,133,38,.1),transparent 66%),var(--paper);}
/* EasyMode spinning rosette "flowers" behind the panel — the brand page-field
   motif (green) + the spinning-gold accent, the same wbDrift the HUD field uses.
   position:fixed so they anchor to the viewport and never add scroll. */
.wb-chooser::before,.wb-chooser::after{content:"";position:fixed;z-index:0;pointer-events:none;background-repeat:no-repeat;background-position:center;background-size:contain;}
.wb-chooser::before{top:-170px;right:-200px;width:560px;height:560px;opacity:.1;background-image:url(/gstyle-rosette-green.svg);animation:wbDrift 210s linear infinite;}
.wb-chooser::after{bottom:-200px;left:-200px;width:520px;height:520px;opacity:.08;background-image:url(/gstyle-rosette.svg);animation:wbDriftBack 240s linear infinite;}
.wb-ch-panel{position:relative;z-index:1;width:100%;max-width:640px;margin:auto;text-align:center;animation:wbChIn .3s ease both;}
/* Chooser top bar — the essentials the full-screen overlay otherwise hides. */
.wb-ch-top{position:absolute;top:calc(12px + env(safe-area-inset-top,0px));left:16px;right:16px;z-index:3;display:flex;align-items:center;justify-content:flex-end;gap:10px;}
.wb-ch-skip{width:40px;height:40px;border-radius:50%;border:1.5px solid var(--line);background:var(--card);color:var(--ink2);font-size:16px;line-height:1;cursor:pointer;display:grid;place-items:center;flex-shrink:0;transition:border-color .14s,color .14s;}
.wb-ch-skip:hover{border-color:var(--ink2);color:var(--ink);}
/* Desktop: the two cards were tiny marooned in the middle — give them room. */
@media(min-width:720px){
  .wb-ch-panel{max-width:900px;}
  .wb-ch-h{font-size:31px;}
  .wb-ch-sub{font-size:15px;margin-bottom:26px;}
  .wb-ch-grid{gap:22px;}
  .wb-ch-hero{height:212px;}
  .wb-ch-body{padding:20px 24px 22px;}
  .wb-ch-title{font-size:23px;}
  .wb-ch-desc{font-size:14.5px;}
  .wb-ch-nav{font-size:12px;margin-bottom:16px;}
  .wb-ch-go{font-size:14px;padding:12px 24px;}
}
@keyframes wbChIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.wb-ch-brand{display:inline-flex;align-items:center;gap:9px;font-family:Poppins,sans-serif;font-weight:800;font-size:19px;color:var(--ink);margin-bottom:14px;}
.wb-ch-brand b{color:var(--gold);}
.wb-ch-h{font-family:Poppins,sans-serif;font-weight:800;font-size:25px;color:var(--ink);margin:0 0 5px;line-height:1.14;}
.wb-ch-sub{font-size:13.5px;color:var(--ink2);margin:0 0 18px;}
.wb-ch-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;text-align:left;}
.wb-ch-card{display:flex;flex-direction:column;align-items:stretch;background:var(--card);border:1.5px solid var(--line);border-radius:16px;padding:0;overflow:hidden;cursor:pointer;font:inherit;text-align:left;transition:transform .14s,box-shadow .14s,border-color .14s;}
.wb-ch-card:hover{transform:translateY(-3px);box-shadow:0 20px 40px -18px rgba(20,32,26,.45);}
.wb-ch-card.mk:hover{border-color:var(--green2);}
.wb-ch-card.cr:hover{border-color:var(--gold);}
.wb-ch-hero{display:block;width:100%;height:138px;background:center/cover no-repeat;border-bottom:1px solid var(--line);}
.wb-ch-card.cr .wb-ch-hero{background-color:#E6EFDD;}
.wb-ch-card.mk .wb-ch-hero{background-color:#DCEBE0;}
.wb-ch-body{display:flex;flex-direction:column;align-items:flex-start;padding:14px 18px 16px;}
.wb-ch-eyebrow{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;}
.wb-ch-card.mk .wb-ch-eyebrow{color:var(--green);}
.wb-ch-card.cr .wb-ch-eyebrow{color:var(--gold-deep);}
.wb-ch-title{font-family:Poppins,sans-serif;font-weight:800;font-size:18px;color:var(--ink);margin:3px 0 6px;}
.wb-ch-desc{font-size:13px;line-height:1.45;color:var(--ink2);margin:0 0 10px;}
.wb-ch-nav{font-size:11px;font-weight:700;letter-spacing:.02em;color:var(--ink2);opacity:.72;margin-bottom:13px;}
/* CTA buttons carry the EasyMode treatment: guilloche hatch + the gold GStyle
   rosette peeking from the right + a gold inner hairline (same as the landing). */
.wb-ch-go{position:relative;overflow:hidden;isolation:isolate;display:inline-flex;align-items:center;gap:7px;font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#fff;border-radius:11px;padding:9px 18px;box-shadow:0 4px 12px -4px rgba(20,32,26,.3);}
.wb-ch-card.mk .wb-ch-go{background:repeating-linear-gradient(57deg,rgba(255,220,120,.16) 0 1px,transparent 1px 8px),repeating-linear-gradient(123deg,rgba(255,220,120,.11) 0 1px,transparent 1px 8px),linear-gradient(135deg,var(--green2),var(--green));}
.wb-ch-card.cr .wb-ch-go{background:repeating-linear-gradient(57deg,rgba(255,255,255,.18) 0 1px,transparent 1px 8px),repeating-linear-gradient(123deg,rgba(255,255,255,.12) 0 1px,transparent 1px 8px),linear-gradient(135deg,var(--gold),var(--gold-deep));}
.wb-ch-go::after{content:"";position:absolute;z-index:-1;top:50%;right:-12px;width:50px;height:50px;transform:translateY(-50%);pointer-events:none;background:#FFD24A;-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.32;animation:wbDrift 90s linear infinite;}
.wb-ch-card.cr .wb-ch-go::after{background:#FFF6DC;opacity:.36;}
.wb-ch-go::before{content:"";position:absolute;inset:4px;border:1px solid rgba(255,214,102,.5);border-radius:8px;pointer-events:none;z-index:1;}
.wb-ch-card.cr .wb-ch-go::before{border-color:rgba(255,248,224,.55);}
@media(max-width:560px){
  .wb-chooser{padding:calc(56px + env(safe-area-inset-top,0px)) 14px 16px}
  .wb-ch-brand{margin-bottom:10px;font-size:18px}
  .wb-ch-h{font-size:21px}
  .wb-ch-sub{margin-bottom:13px}
  .wb-ch-grid{grid-template-columns:1fr;gap:10px}
  .wb-ch-hero{height:clamp(104px,18vh,176px)}
  .wb-ch-body{padding:12px 15px 14px}
  .wb-ch-title{font-size:16px;margin:2px 0 4px}
  .wb-ch-desc{margin:0 0 9px}
  .wb-ch-nav{display:none}
  .wb-ch-go{padding:8px 14px}
}
/* The mark: Helpurr's head as a clean cutout — no tile, no rim. The pixel art
   is set a touch larger than its box so the ears reach the edges, and a soft
   drop-shadow lifts it off the cream. */
.wb-crest{position:relative;flex:0 0 auto;display:inline-grid;place-items:center;}
.wb-crest img{width:118%;height:118%;object-fit:contain;display:block;image-rendering:pixelated;
  filter:drop-shadow(0 1.5px 1.5px rgba(20,32,26,.22));}

/* ---- Account chip + dropdown (replaces the old Log-out link AND the big HUD) ---- */
.wb-acct{position:relative;flex:0 0 auto;}
.wb-chip{display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:5px 11px 5px 6px;border-radius:999px;
  background:var(--card);border:1px solid var(--line);box-shadow:0 1px 2px rgba(20,32,26,.06);font-family:inherit;color:var(--ink);
  transition:border-color .14s,box-shadow .14s;}
.wb-chip:hover,.wb-chip.on{border-color:var(--green2);box-shadow:0 2px 9px rgba(12,122,70,.15);}
.wb-chip-ava{width:30px;height:30px;flex:0 0 auto;display:inline-grid;place-items:center;}
.wb-chip-ava img{width:120%;height:120%;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 1px 1px rgba(20,32,26,.22));}
.wb-chip-ava.photo{border-radius:50%;box-shadow:0 0 0 2px var(--card),0 0 0 3px rgba(12,122,70,.38);}
.wb-chip-ava.photo img{width:100%;height:100%;object-fit:cover;border-radius:50%;image-rendering:auto;filter:none;}
/* Initials monogram — the default account avatar (an uploaded photo overrides it). */
.wb-ava-mono{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;line-height:1;
  background:linear-gradient(168deg,#12A85E,#0B6B3E);color:#fff;font-family:Poppins,sans-serif;font-weight:800;
  box-shadow:0 0 0 2px var(--card),0 0 0 3px rgba(12,122,70,.38);}
.wb-chip-ava.mono .wb-ava-mono{font-size:13.5px;}
.wb-menu-ava.mono .wb-ava-mono{font-size:21px;}
.wb-chip-lvl{font-family:Poppins,sans-serif;font-weight:800;font-size:10.5px;letter-spacing:.04em;color:#3A2A05;
  background:linear-gradient(168deg,#F6E6B4,#E7C879);padding:2px 7px;border-radius:999px;box-shadow:inset 0 0 0 1px rgba(176,133,38,.3);}
.wb-chip-tok{display:inline-flex;align-items:center;gap:4px;font-weight:800;font-size:12.5px;color:var(--gold-deep);font-variant-numeric:tabular-nums;}
.wb-chip-tok svg{width:14px;height:14px;}
.wb-chip-caret{font-size:9px;color:var(--ink2);margin-left:-3px;}
.wb-menu{position:absolute;top:calc(100% + 10px);right:0;z-index:60;width:min(322px,calc(100vw - 24px));
  background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden auto;max-height:min(78vh,660px);
  box-shadow:0 18px 46px rgba(20,32,26,.19),0 3px 10px rgba(20,32,26,.08);animation:wbMenuIn .14s ease;}
@keyframes wbMenuIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.wb-menu>*{padding-left:14px;padding-right:14px;}
.wb-menu-id{display:flex;align-items:center;gap:11px;padding-top:14px;padding-bottom:13px;border-bottom:1px solid var(--line);}
.wb-menu-ava{position:relative;width:46px;height:46px;flex:0 0 auto;border:0;background:none;padding:0;cursor:pointer;display:inline-grid;place-items:center;}
.wb-menu-ava img{width:124%;height:124%;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 1.5px 1.5px rgba(20,32,26,.22));}
.wb-menu-ava.photo img{width:100%;height:100%;object-fit:cover;border-radius:50%;image-rendering:auto;
  filter:none;box-shadow:0 0 0 2px var(--card),0 0 0 3px rgba(12,122,70,.38);}
.wb-menu-cam{position:absolute;right:-3px;bottom:-3px;width:19px;height:19px;border-radius:50%;display:grid;place-items:center;
  background:linear-gradient(168deg,#12A85E,#0B6B3E);box-shadow:0 1px 3px rgba(20,32,26,.3);}
.wb-menu-cam svg{width:11px;height:11px;color:#fff;}
.wb-menu-ava:hover .wb-menu-cam{filter:brightness(1.1);}
.wb-menu-idtxt{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px;}
.wb-menu-idtxt b{font-family:Poppins,sans-serif;font-size:14px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wb-menu-email{font-size:11px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.wb-menu-plan{align-self:flex-start;font-family:Poppins,sans-serif;font-weight:800;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;
  text-decoration:none;color:#3A2A05;background:linear-gradient(168deg,#F6E6B4,#E7C879);padding:4px 9px;border-radius:999px;
  box-shadow:inset 0 0 0 1px rgba(176,133,38,.3);white-space:nowrap;}
.wb-menu-plan.off{background:#DED9C7;color:#5A5347;box-shadow:none;}
.wb-menu-plan:hover{filter:brightness(1.05);}
.wb-menu-sec{padding-top:12px;padding-bottom:12px;border-bottom:1px solid var(--line);}
.wb-menu-barlabel{display:flex;justify-content:space-between;gap:10px;font-size:9.5px;font-weight:700;letter-spacing:.05em;
  text-transform:uppercase;color:var(--ink2);margin-bottom:6px;}
.wb-menu-barlabel span:last-child{color:var(--ink);letter-spacing:.02em;text-transform:none;font-variant-numeric:tabular-nums;}
.wb-menu-hp,.wb-menu-xp{height:8px;border-radius:99px;background:#E6E1D0;overflow:hidden;border:1px solid rgba(20,32,26,.07);}
.wb-menu-hp>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#0C7A46,#3FD186);transition:width .5s ease;}
.wb-menu-xp>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#B08526,#F3D98C);transition:width .5s ease;}
.wb-menu-hint{margin-top:7px;display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:var(--gold-deep);}
.wb-menu-hint svg{width:13px;height:13px;flex:0 0 auto;}
/* Achievements roster — full list, earned ones lit; own scroll box keeps the
   panel compact and the actions below reachable without scrolling past it. */
.wb-ach-grid{list-style:none;margin:9px 0 0;padding:0;display:flex;flex-direction:column;gap:5px;max-height:216px;overflow-y:auto;overscroll-behavior:contain;}
.wb-ach{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:10px;background:var(--paper);border:1px solid var(--line);opacity:.5;filter:grayscale(.65);}
.wb-ach.got{opacity:1;filter:none;background:#F0FAF4;border-color:#BFE2CD;}
.wb-ach-ic{flex:0 0 auto;width:22px;text-align:center;font-size:16px;line-height:1;}
.wb-ach-tx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;}
.wb-ach-tx b{font-family:Poppins,sans-serif;font-size:11.5px;font-weight:700;color:var(--ink);line-height:1.2;}
.wb-ach-tx em{font-size:10px;font-style:normal;color:var(--ink2);line-height:1.3;}
.wb-ach-rw{flex:0 0 auto;display:flex;align-items:center;}
.wb-ach-rew{display:inline-flex;align-items:center;gap:2px;font-size:10.5px;font-weight:800;color:var(--gold-deep);white-space:nowrap;font-variant-numeric:tabular-nums;}
.wb-ach-rew svg{width:11px;height:11px;flex:0 0 auto;}
.wb-ach-done{display:grid;place-items:center;width:19px;height:19px;border-radius:50%;background:var(--green);color:#fff;font-size:11px;font-weight:800;}
.wb-menu-meter{margin-top:8px;font-size:11.5px;color:var(--ink2);line-height:1.45;}
.wb-menu-meter-r{color:var(--gold-deep);font-weight:600;white-space:nowrap;}
.wb-menu-extra{margin-top:5px;display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--gold-deep);}
.wb-menu-extra svg{width:13px;height:13px;}
.wb-menu-affords{margin-top:9px;display:flex;gap:15px;font-size:11.5px;font-weight:700;color:var(--ink2);}
.wb-menu-affords span{display:inline-flex;align-items:center;gap:5px;}
.wb-menu-affords svg{width:14px;height:14px;}
.wb-menu-topup{margin-top:11px;display:flex;align-items:center;justify-content:center;gap:7px;text-decoration:none;
  font-family:Poppins,sans-serif;font-weight:800;font-size:12.5px;color:#fff;
  background:linear-gradient(168deg,#12A85E,#0B6B3E);padding:9px;border-radius:11px;box-shadow:0 2px 8px rgba(12,122,70,.25);}
.wb-menu-topup:hover{filter:brightness(1.06);}
.wb-menu-topup svg{width:15px;height:15px;}
.wb-menu-links{padding-top:9px;padding-bottom:9px;display:flex;flex-direction:column;gap:1px;}
.wb-menu-link{display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:0;background:none;cursor:pointer;
  font-family:inherit;font-size:13px;font-weight:600;color:var(--ink);padding:9px 8px;border-radius:9px;text-decoration:none;transition:background .12s;}
.wb-menu-link:hover{background:rgba(12,122,70,.07);}
.wb-menu-link svg{width:15px;height:15px;color:var(--ink2);flex:0 0 auto;}
.wb-menu-link.danger{color:#A23A2A;justify-content:flex-start;}
.wb-menu-link.danger:hover{background:rgba(162,58,42,.08);}
.wb-main{max-width:1080px;margin:0 auto;padding:10px 24px 70px;}

/* ---- Status HUD — the app's level/wallet status bar, GStyle for the web shell ---- */
.wb-hud{width:min(1080px,100% - 48px);margin:0 auto 6px;padding:13px 16px;border-radius:16px;position:relative;overflow:hidden;isolation:isolate;
  background:linear-gradient(168deg,#FDFCF7,#F2EEE0);border:1px solid var(--line);
  /* Gold hairline inside the border, the way the app rules its status card. */
  box-shadow:0 3px 12px rgba(20,32,26,.07),inset 0 0 0 1px rgba(231,200,121,.3),inset 0 1px 0 rgba(255,255,255,.7);}
/* The HUD gets the gold cut of the rosette bleeding off its right edge —
   this is the app's Autopilot card treatment, brought over. */
.wb-hud:not(.min)::after{content:"";position:absolute;z-index:-1;top:50%;right:-72px;width:238px;height:238px;margin-top:-119px;
  background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.16;pointer-events:none;
  animation:wbDrift 150s linear infinite;}
.wb-hud.min{padding:0;background:none;border:0;box-shadow:none;overflow:visible;}
.wb-hud-mini{display:inline-flex;align-items:center;gap:9px;cursor:pointer;padding:7px 14px;border-radius:999px;
  background:linear-gradient(168deg,#FDFCF7,#F2EEE0);border:1px solid var(--line);box-shadow:0 3px 12px rgba(20,32,26,.07);font:inherit;}
.wb-hud-mini-tok{font-weight:800;font-size:12.5px;color:var(--gold-deep);}
.wb-hud-caret{font-size:10px;color:var(--ink2);}
.wb-hud-top{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:9px;}
.wb-hud-name{font-family:Poppins,sans-serif;font-weight:800;font-size:14px;color:var(--ink);
  max-width:44vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wb-hud-lvl{font-family:Poppins,sans-serif;font-weight:800;font-size:11.5px;letter-spacing:.05em;color:#3A2A05;
  padding:4px 11px;border-radius:999px;background:linear-gradient(168deg,#F3D98C,#D8AE41);border:1px solid rgba(140,105,25,.35);}
.wb-hud-plan{font-family:Poppins,sans-serif;font-weight:800;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;
  color:#fff;text-decoration:none;padding:5px 13px;border-radius:999px;background:linear-gradient(168deg,#12A85E,#0B6B3E);
  box-shadow:0 2px 8px rgba(12,122,70,.26);}
.wb-hud-plan.off{background:#DED9C7;color:#5A5347;box-shadow:none;}
.wb-hud-plan:hover{filter:brightness(1.07)}
.wb-hud-toggle{margin-left:auto;border:1px solid var(--line);background:var(--card);color:var(--ink2);
  width:26px;height:26px;border-radius:8px;cursor:pointer;font-size:11px;line-height:1;}
.wb-hud-toggle:hover{color:var(--ink);border-color:var(--green2);}
.wb-hud-barlabel{display:flex;justify-content:space-between;gap:10px;font-size:10.5px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;color:var(--ink2);margin:8px 0 4px;}
.wb-hud-barlabel span:last-child{color:var(--ink);letter-spacing:.02em;text-transform:none;font-variant-numeric:tabular-nums;}
.wb-hud-hp,.wb-hud-xp{height:9px;border-radius:99px;background:#E6E1D0;overflow:hidden;border:1px solid rgba(20,32,26,.07);}
.wb-hud-hp>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#0C7A46,#3FD186);transition:width .5s ease;}
.wb-hud-xp>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#B08526,#F3D98C);transition:width .5s ease;}
.wb-hud-stats{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:11px;font-size:12px;font-weight:700;color:var(--ink2);}
.wb-hud-topup{display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:5px 6px 5px 11px;border-radius:999px;
  background:var(--card);border:1px solid var(--line);color:var(--gold-deep);font-weight:800;}
.wb-hud-topup b{font-size:11.5px;color:#fff;background:linear-gradient(168deg,#12A85E,#0B6B3E);padding:5px 11px;border-radius:999px;}
.wb-hud-topup:hover b{filter:brightness(1.07)}
.wb-hud-stat{white-space:nowrap;}
/* Value meter — a quiet benefit line under the reserve bar. */
.wb-hud-meter{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;
  margin-top:6px;font-size:11.5px;font-weight:600;color:var(--ink2);line-height:1.35;}
.wb-hud-meter b{color:var(--ink);font-weight:800;font-variant-numeric:tabular-nums;}
.wb-hud-meter-r{white-space:nowrap;color:var(--gold-deep);font-weight:700;}
.wb-hud-extra{margin-top:4px;display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--gold-deep);}

/* ---- Creator-mode HUD: a cleaner, calmer take (Marketing keeps the full
   HUD unchanged). Every element stays — this only slims the look:
   flat-white card, no gold-rosette glow, thinner bars, muted LVL badge,
   tighter spacing. LOGGED FOR REVERT: to restore the original, remove the
   wb-hud-lite class from the HUD div in WebLayout and delete this block;
   the pre-change version is git commit bfa35e9. ---- */
.wb-hud-lite{background:#fff;padding:11px 15px;
  box-shadow:0 1px 2px rgba(20,32,26,.05),0 12px 30px -18px rgba(20,32,26,.16);}
.wb-hud-lite::after{display:none;}
.wb-hud-lite .wb-hud-top{margin-bottom:8px;}
.wb-hud-lite .wb-hud-lvl{background:#F3F0E4;color:var(--gold-deep);border-color:rgba(176,133,38,.26);box-shadow:none;}
.wb-hud-lite .wb-hud-barlabel{margin:7px 0 3px;}
.wb-hud-lite .wb-hud-hp,.wb-hud-lite .wb-hud-xp{height:6px;}
.wb-hud-lite .wb-hud-stats{margin-top:9px;font-size:11.5px;}
.wb-hud-lite .wb-hud-toggle{border-color:var(--line);}

/* ---- Mobile header: nothing wraps into a second line of tabs, nothing
        overflows the viewport. The tab strip scrolls sideways instead. ---- */
@media(max-width:760px){
  .wb-nav{padding:12px 16px;gap:10px;}
  .wb-brand{font-size:16px;gap:7px;}
  /* WRAP, don't hidden-scroll. Marketing has 6 tabs that need ~540px — at phone
     width they used to overflow a scrollbar-less strip, so Archive/Auto-posting
     sat off-screen with no hint to scroll ("I don't see the archives"). Wrapping
     to a second line keeps every tab visible; Creator's 4 tabs still fit on one. */
  .wb-tabs{order:3;flex:1 0 100%;gap:5px;flex-wrap:wrap;margin-top:2px;}
  .wb-tab{flex:0 0 auto;white-space:nowrap;padding:7px 13px;font-size:12.5px;}
  .wb-me{margin-left:auto;gap:7px;}
  .wb-login{padding:8px 15px;font-size:12.5px;}
  /* Compact chip on phones: drop the LVL pill, keep avatar + balance + caret so
     the top row stays next to the brand without overflowing. */
  .wb-chip{padding:4px 9px 4px 5px;gap:6px;}
  .wb-chip-lvl{display:none;}
  .wb-chip-ava{width:27px;height:27px;}
  .wb-main{padding:10px 16px 70px;}
}
.wb-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em;margin:14px 0 6px;overflow-wrap:anywhere;}
.wb-sub{color:var(--ink2);font-size:14.5px;line-height:1.55;margin:0 0 24px;max-width:60ch;}
/* Cards were flat white inside a flat cream border. Now they carry a faint
   top-to-bottom warmth, a greener border line, and a hairline of white along
   the top edge — the thing that makes a panel read as a raised surface rather
   than a rectangle drawn on the page. */
.wb-card{background:linear-gradient(178deg,#FEFDF9,#F7F6EB);border:1px solid var(--line2);border-radius:18px;padding:22px;
  box-shadow:0 3px 12px rgba(20,32,26,.06),inset 0 1px 0 rgba(255,255,255,.8);}
.wb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;}
.wb-lbl{display:block;font-weight:700;font-size:12.5px;margin:14px 0 5px;color:var(--ink);}
/* 16px, not 14: iOS Safari auto-zooms the page on focus below 16px and
   never zooms back out, which broke signup and login on iPhone. */
.wb-in,.wb-sel,.wb-ta{width:100%;padding:12px 13px;border-radius:11px;border:1px solid var(--line);background:#fff;font:inherit;font-size:16px;color:var(--ink);}
.wb-ta{min-height:76px;resize:vertical}
/* Green buttons get the app's treatment: a gold hairline ruled inside the
   edge, and the engine-turned rosette turning slowly behind the label where it
   bleeds off the right. isolation + z-index:-1 keeps the rosette above the
   button's own gradient but under the text. */
.wb-btn{position:relative;isolation:isolate;overflow:hidden;display:inline-block;border:0;cursor:pointer;text-decoration:none;text-align:center;
  font-family:Poppins,sans-serif;font-weight:800;font-size:14px;color:#fff;padding:12px 24px;border-radius:12px;
  /* The right side darkens toward the rosette. In the app the rosette sits on
     a DARK green card, which is the only reason thin gold lines read as gold —
     on flat bright #12A85E the same gold has no contrast and turns into pale
     green scribble. This recreates the dark field locally. */
  background:
    linear-gradient(100deg,#12A85E 38%,#0A6A3D 78%,#075530),
    linear-gradient(165deg,#12A85E,#0B6B3E);
  box-shadow:0 4px 12px rgba(12,122,70,.28),inset 0 0 0 1px rgba(231,200,121,.34);}
/* ---- The gold rule, applied to EVERY green surface in one place ----
   This started as a .wb-btn-only treatment, which meant every other green
   button on the site (Studio tabs, Archive actions, the plans toggle) shipped
   bare and had to be chased down one at a time. Anything with the green
   gradient goes in these selector lists — that's the rule now. */
.ws-tab.on,.wa-vbtn,.wd-toggle button.on{position:relative;isolation:isolate;overflow:hidden;}
.wb-btn::before,.ws-tab.on::before,.wa-vbtn::before,.wd-toggle button.on::before{
  content:"";position:absolute;inset:4px;border:1px solid rgba(255,210,74,.42);border-radius:8px;pointer-events:none;}
/* The rosette is MASKED rather than drawn: the SVG's own stroke colour is
   fixed, and masking lets the gold be picked per surface. Pushed far enough
   right that its hollow centre clears the edge — parked closer in, the centre
   reads as a dark smudge on the button instead of etching. */
.wb-btn::after,.ws-tab.on::after,.wa-vbtn::after,.wd-toggle button.on::after{
  content:"";position:absolute;z-index:-1;top:50%;pointer-events:none;background:#FFD24A;
  -webkit-mask-image:url(/gstyle-rosette.svg);-webkit-mask-size:contain;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;
  mask-image:url(/gstyle-rosette.svg);mask-size:contain;mask-position:center;mask-repeat:no-repeat;
  animation:wbDrift 60s linear infinite;}
/* Wide CTAs carry the full medallion. */
.wb-btn::after{right:-96px;width:158px;height:158px;margin-top:-79px;opacity:.6;}
/* Compact buttons get a smaller one held further out, so it stays a corner
   flourish and never crosses a short label like "Video". */
.ws-tab.on::after,.wa-vbtn::after,.wd-toggle button.on::after{
  right:-74px;width:112px;height:112px;margin-top:-56px;opacity:.5;}
/* Scoped through .wb-main so this beats the child routes' own background
   declarations on specificity — child route <style> blocks render AFTER this
   one, so an equal-specificity rule here would silently lose. */
.wb-main .ws-tab.on,.wb-main .wa-vbtn,.wb-main .wd-toggle button.on{
  background:
    linear-gradient(100deg,#12A85E 58%,#0B7443 86%,#095F36),
    linear-gradient(165deg,#12A85E,#0B6B3E);}
/* Pill-shaped buttons need the inner rule to follow the pill, not a rounded
   rectangle sitting inside it. */
.wd-toggle button.on::before{inset:3px;border-radius:999px;}
.ws-tab.on::before{border-radius:9px;}
@media (prefers-reduced-motion:reduce){.ws-tab.on::after,.wa-vbtn::after,.wd-toggle button.on::after{animation:none}}
.wb-btn:hover{filter:brightness(1.06)}
/* Ghost + disabled buttons aren't gold-rule surfaces — strip the treatment. */
.wb-btn.ghost::before,.wb-btn.ghost::after{display:none}
.wb-btn[disabled]::after{opacity:.14}
@media (prefers-reduced-motion:reduce){.wb-btn::after{animation:none}}
.wb-btn.gold{background:linear-gradient(165deg,#C98F12,#8a6207);box-shadow:0 4px 12px rgba(176,133,38,.3);}
.wb-btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line);box-shadow:none;}
.wb-btn[disabled]{opacity:.5;cursor:not-allowed}
.wb-err{margin:14px 0;padding:12px 16px;border-radius:12px;background:#FBEDEA;border:1px solid #E8C4BC;color:#7A2E1D;font-size:13.5px;}
.wb-ok{margin:14px 0;padding:12px 16px;border-radius:12px;background:#EAF6EF;border:1px solid #BFE2CD;color:#0A3D26;font-size:13.5px;}
.wb-note{font-size:12.5px;color:var(--ink2);}
.wb-price-name{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;}
.wb-price-amt{font-family:Poppins,sans-serif;font-weight:800;font-size:30px;color:var(--green);margin:4px 0;}
.wb-price-amt small{font-size:13px;color:var(--ink2);font-weight:600;}
.wb-feats{list-style:none;margin:12px 0 16px;padding:0;display:flex;flex-direction:column;gap:7px;}
.wb-feats li{position:relative;padding-left:22px;font-size:13px;color:var(--ink2);line-height:1.4;}
.wb-feats li::before{content:"✓";position:absolute;left:0;color:var(--green2);font-weight:900;}
.wb-assets{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;}
.wb-asset{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;}
/* Tiles are PORTRAIT, because the content is. A fixed 220px-tall box is
 * landscape once a card goes full-width on a phone, and cover-cropping a 9:16
 * video into it threw away two thirds of the frame — you got a mouth and a
 * beard. At 4/5 the same video keeps ~70% of its height, and square ad images
 * keep 80% of their width, while every tile stays the same shape so the grid
 * doesn't go ragged. Cooking tiles and posters below match it exactly. */
.wb-asset video,.wb-asset img{width:100%;aspect-ratio:4/5;height:auto;object-fit:cover;display:block;background:#0b0f0d;}
/* Cooking tiles — live render placeholders with shimmer + ETA. */
.wb-cookimg{position:relative;aspect-ratio:4/5;height:auto;background-color:#101612;background-size:cover;background-position:center;display:grid;place-items:center;overflow:hidden;}
.wb-cookimg::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 32%,rgba(255,255,255,.13) 50%,transparent 68%);animation:wbShimmer 1.7s linear infinite;}
@keyframes wbShimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
.wb-bufwrap{position:relative;z-index:1;display:grid;place-items:center;gap:9px;}
/* GStyle buffer: the actual engine-turned rosette the embedded app spins in its
 * Autopilot card — the same hypotrochoid geometry, served from
 * /gstyle-rosette.svg. Conic gradients can only fake radial spokes; this figure
 * is built from overlapping petal loops, and that's what gives it the guilloche
 * shimmer. Nothing approximates it, so we reuse the real curve. */
.wb-bufwrap::before{content:"";position:absolute;width:210px;height:210px;border-radius:50%;pointer-events:none;
  background:radial-gradient(circle,rgba(6,10,8,.88),rgba(6,10,8,.66) 34%,rgba(6,10,8,.3) 54%,transparent 72%);}
.wb-spin{position:relative;z-index:1;width:104px;height:104px;display:block;
  background:url(/gstyle-rosette.svg) center / contain no-repeat;
  animation:wbRot 13s linear infinite;
  filter:drop-shadow(0 0 10px rgba(255,210,74,.3));}
/* A gold bead orbits the rim: the rosette turns too gracefully to signal
   activity on its own, and merchants need to see that it's still working. */
.wb-spin::after{content:"";position:absolute;inset:2px;border-radius:50%;animation:wbRot 1.7s linear infinite;
  background:radial-gradient(circle 3.5px at 50% 2%,#FFF6DA,rgba(255,210,74,.95) 45%,transparent 68%);}
@keyframes wbRot{to{transform:rotate(360deg)}}
.wb-eta{color:#fff;font-weight:800;font-size:12.5px;letter-spacing:.02em;text-shadow:0 1px 8px rgba(0,0,0,.6);}
.wb-failbadge{position:relative;z-index:1;font-size:30px;color:#E9897B;font-weight:800;}
@media (prefers-reduced-motion: reduce){.wb-cookimg::after{animation:none}.wb-spin,.wb-spin::before,.wb-spin::after{animation:none}}
.wb-asset .m{padding:10px 12px;font-size:13px;font-weight:600;}
.wb-asset .s{font-size:11.5px;color:var(--ink2);font-weight:500;}
.wb-auth{max-width:420px;margin:40px auto;}

/* ---- Web Studio: the embedded-app experience, GStyle ---- */
/* Centred: three equal choices read as a set, and left-hanging them under a
   centred page title left a lopsided gap on every width. */
.ws-tabs{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin:4px 0 16px;}
.ws-tab{display:inline-flex;align-items:center;gap:7px;padding:10px 20px;border-radius:12px;border:1px solid var(--line);background:var(--card);
  font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--ink2);cursor:pointer;}
.ws-tab.on{background:linear-gradient(165deg,#12A85E,#0B6B3E);border-color:transparent;color:#fff;box-shadow:0 4px 12px rgba(12,122,70,.25);}
/* Line art, not emoji — inherits the tab's colour so it flips white on select. */
.ws-tabi{flex:none;opacity:.62;}
.ws-tab.on .ws-tabi{opacity:1;}
/* The Studio form is the longest card on the site, so it gets its own drifting
   rosette in the bottom corner to break up the field behind the controls. */
.ws-card{overflow:hidden;position:relative;isolation:isolate;}
.ws-card::after{content:"";position:absolute;z-index:-1;bottom:-290px;right:-250px;width:520px;height:520px;
  background:url(/gstyle-rosette-green.svg) center/contain no-repeat;opacity:.085;pointer-events:none;
  animation:wbDrift 240s linear infinite;}
@media (prefers-reduced-motion:reduce){.wb-hud::after,.ws-card::after{animation:none}}
.ws-lbl{display:flex;align-items:baseline;gap:8px;font-family:Poppins,sans-serif;font-weight:700;font-size:13px;color:var(--ink);margin:16px 0 8px;}
.ws-lbl:first-child{margin-top:0}
.ws-opt{font-family:Inter,sans-serif;font-weight:500;font-size:11px;color:var(--ink2);}
.ws-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;}
/* minmax(0,…) not minmax(220px,…): a hard 220px floor on two columns needs
 * 454px of room, which a phone doesn't have — the first card got clipped. */
.ws-tiles.two{grid-template-columns:repeat(2,minmax(0,300px));justify-content:center;}
.ws-tiles.styles{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));}
.ws-tile{position:relative;text-align:left;border:1px solid var(--line);border-radius:16px;background:#fff;padding:0 0 12px;
  cursor:pointer;transition:transform .12s,border-color .12s,box-shadow .12s;overflow:hidden;}
.ws-tile:hover{transform:translateY(-3px);border-color:var(--green2);box-shadow:0 12px 30px rgba(12,122,70,.14);}
.ws-tile.sel{border-color:var(--green2);box-shadow:0 0 0 1px var(--green2),0 8px 22px rgba(12,122,70,.16);}
.ws-tile b{display:block;padding:10px 12px 0;font-family:Poppins,sans-serif;font-size:13.5px;color:var(--ink);}
.ws-tile-sub{display:block;padding:3px 12px 0;font-size:11.5px;color:var(--ink2);line-height:1.4;}
/* Every picker card shares the tall square art treatment — the art IS the
 * pitch, so no card gets a cropped little strip. */
.ws-tile-img{position:relative;display:block;height:auto;aspect-ratio:1/1;background-size:cover;background-position:center 25%;}
.ws-tiles.fmt{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;}
.ws-tile.fmt .ws-tile-img{background-position:center;}
.ws-tile.fmt b,.ws-tile b{font-size:14px;}
/* Expanded format library: contained, smooth-scrolling, staggered reveal —
 * the page never becomes a mile-long scroll. */
.ws-fmtbox{max-height:64vh;overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;padding:4px 16px 46px 4px;scrollbar-gutter:stable;
  -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 44px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 44px),transparent);}
.ws-fmtbox::-webkit-scrollbar{width:9px}
.ws-fmtbox::-webkit-scrollbar-thumb{background:#BFDCCB;border-radius:99px}
.ws-fmtbox::-webkit-scrollbar-thumb:hover{background:#9CCBB1}
.ws-fmtbox::-webkit-scrollbar-track{background:transparent}
@keyframes wsFadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.ws-fmtbox .ws-tile{animation:wsFadeUp .45s ease both}
@media (prefers-reduced-motion: reduce){.ws-fmtbox .ws-tile{animation:none}}
.ws-tile.lockd .ws-tile-img{filter:saturate(.35) brightness(.72);}
/* Post-generate celebration — same energy as the embedded app's modal. */
.ws-scrim{position:fixed;inset:0;z-index:10500;background:rgba(12,18,14,.55);backdrop-filter:blur(3px);
  display:grid;place-items:center;padding:24px;}
.ws-modal{position:relative;overflow:hidden;background:var(--card);border:1px solid var(--line);border-radius:22px;
  padding:34px 30px 26px;max-width:400px;width:100%;text-align:center;box-shadow:0 24px 70px rgba(10,20,14,.45);
  animation:wsPop .35s cubic-bezier(.2,1.4,.4,1) both;}
@keyframes wsPop{from{opacity:0;transform:scale(.86) translateY(14px)}to{opacity:1;transform:none}}
/* Sits high, so it fans out behind the crest rather than under the copy. */
.ws-mrose{position:absolute;top:-172px;left:50%;width:340px;height:340px;margin-left:-170px;pointer-events:none;
  background:url(/gstyle-rosette-green.svg) center/contain no-repeat;opacity:.15;
  animation:wsSpin 40s linear infinite;}
@keyframes wsSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.ws-mrose{animation:none}.ws-modal{animation:none}}
.ws-mi{position:relative;font-size:44px;margin-bottom:6px;}
/* ---- EasyMode flex: the brand lockup that fronts the celebration ---- */
.ws-flex{position:relative;display:flex;flex-direction:column;align-items:center;gap:9px;margin-bottom:14px;}
.ws-flex-crest{position:relative;width:56px;height:56px;border-radius:15px;overflow:hidden;display:grid;place-items:center;
  border:1.5px solid rgba(199,158,63,.85);
  box-shadow:0 4px 14px rgba(20,32,26,.22),0 0 0 4px rgba(231,200,121,.16),0 0 22px rgba(255,210,74,.3);
  animation:wsFlexIn .5s cubic-bezier(.2,1.5,.4,1) both;}
.ws-flex-crest img{width:100%;height:100%;object-fit:cover;display:block;image-rendering:pixelated;filter:brightness(1.16) saturate(1.06);}
.ws-flex-crest::after{content:"";position:absolute;inset:0;border-radius:inherit;
  background:linear-gradient(150deg,rgba(255,255,255,.28),transparent 52%);}
.ws-flex-word{font-family:Poppins,sans-serif;font-weight:800;font-size:25px;letter-spacing:-.02em;line-height:1;color:var(--ink);
  animation:wsFlexIn .5s .07s cubic-bezier(.2,1.5,.4,1) both;}
/* Gold on "Mode" — the same split the wordmark uses everywhere else, just
   turned up to a proper metallic gradient for the celebration. */
.ws-flex-word b{background:linear-gradient(100deg,#B08526,#F3D98C 45%,#B08526);-webkit-background-clip:text;background-clip:text;color:transparent;}
.ws-flex-rule{display:block;width:74px;height:2px;border-radius:2px;
  background:linear-gradient(90deg,transparent,rgba(199,158,63,.95),transparent);
  animation:wsFlexIn .5s .14s cubic-bezier(.2,1.5,.4,1) both;}
@keyframes wsFlexIn{from{opacity:0;transform:translateY(10px) scale(.9)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ws-flex-crest,.ws-flex-word,.ws-flex-rule{animation:none}}
.ws-mh{position:relative;display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:20px;color:var(--ink);}
.ws-mp{position:relative;color:var(--ink2);font-size:13.5px;line-height:1.55;margin:8px 0 18px;}
.ws-mcta{position:relative;display:block;width:100%;}
.ws-mclose{position:relative;margin-top:10px;background:none;border:0;cursor:pointer;font-weight:700;font-size:13px;color:var(--ink2);}
.ws-mclose:hover{color:var(--ink)}
.ws-tile.lockd:hover .ws-tile-img{filter:saturate(.6) brightness(.85);}
.ws-lock{position:absolute;top:8px;right:8px;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:800;
  color:#fff;background:rgba(10,14,12,.78);border:1px solid rgba(255,255,255,.35);}
.ws-chk{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;
  background:var(--green2);color:#fff;font-size:12px;font-weight:900;box-shadow:0 2px 6px rgba(0,0,0,.3);}
.ws-back{border:0;background:none;color:var(--green);font-weight:700;font-size:13px;cursor:pointer;padding:0;margin-bottom:6px;}
.ws-note{font-size:13px;color:var(--ink2);background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:11px 14px;margin:8px 0;}
.ws-cast{display:flex;gap:10px;overflow-x:auto;padding:4px 2px 12px;scrollbar-gutter:stable;}
.ws-face{flex:0 0 auto;width:76px;border:0;background:none;cursor:pointer;text-align:center;font-size:11px;color:var(--ink2);font-weight:600;}
.ws-face-img{position:relative;display:block;width:68px;height:68px;margin:0 auto 5px;border-radius:50%;background-size:cover;background-position:center 20%;
  border:2px solid var(--line);}
.ws-face-img.none{display:grid;place-items:center;font-size:18px;color:var(--ink2);background:var(--paper);}
.ws-face.sel .ws-face-img{border-color:var(--green2);box-shadow:0 0 0 2px rgba(18,168,94,.25);}
.ws-face-img b{position:absolute;bottom:-2px;right:-2px;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;
  background:var(--green2);color:#fff;font-size:11px;}
.ws-engines{display:flex;gap:8px;flex-wrap:wrap;}
/* Dimmed, not hidden: the merchant should still see the engines exist and
   why they aren't in play, rather than the row silently vanishing. */
.ws-engines.off{opacity:.45;}
.ws-enginenote{margin:0 0 8px;font-size:11.5px;line-height:1.45;color:var(--ink2);
  background:#FDF4E3;border:1px solid #E8D3A6;border-radius:9px;padding:8px 11px;}
.ws-engine{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:8px 13px;border-radius:11px;cursor:pointer;
  border:1px solid var(--line);background:#fff;}
.ws-engine b{font-size:12px;color:var(--ink);}
.ws-engine span{font-size:10px;color:var(--ink2);}
.ws-engine.sel{border-color:var(--green2);box-shadow:0 0 0 1px var(--green2);}
.ws-commercial{display:flex;align-items:center;gap:10px;margin:14px 0 2px;padding:11px 14px;border-radius:12px;
  border:1px solid var(--line);background:#fff;font-size:12.5px;color:var(--ink2);cursor:pointer;line-height:1.45;}
.ws-commercial input{accent-color:var(--green2);width:16px;height:16px;flex:0 0 auto;}
.ws-commercial b{color:var(--ink);}
.ws-upsell{margin-top:14px;padding:16px;border-radius:14px;background:var(--paper);border:1px solid var(--line);text-align:center;}
/* Trial cap escape hatch. Sits under the red spend error, so it reads as the
   answer to it rather than another upsell. */
.ws-trialout{margin-top:10px;padding:14px 16px;border-radius:14px;
  background:linear-gradient(168deg,#FBF4E2,#F5ECD4);border:1px solid rgba(176,133,38,.42);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.7);}
.ws-trialout b{display:block;font-family:Poppins,sans-serif;font-size:14px;color:#3A2A05;margin-bottom:4px;}
.ws-trialout p{margin:0 0 11px;font-size:12.5px;line-height:1.5;color:#6B5312;}

/* Catalogue import, in progress. Dark green panel on purpose: the gold cut of
   the rosette is invisible on cream, and this is the one place we badly need
   "it's alive" to read at a glance. */
.ws-catload{display:flex;align-items:center;gap:15px;margin-top:12px;padding:15px 17px;border-radius:16px;color:#EAF4EE;
  background:linear-gradient(160deg,#0E5233,#0A3421 58%,#072617);
  border:1px solid rgba(231,200,121,.34);box-shadow:0 12px 30px rgba(8,42,26,.28),inset 0 0 0 1px rgba(231,200,121,.16);}
.ws-catload-spin{flex:0 0 auto;width:52px;height:52px;display:block;
  background:url(/gstyle-rosette.svg) center/contain no-repeat;
  animation:wbRot 13s linear infinite;filter:drop-shadow(0 0 8px rgba(255,210,74,.32));}
.ws-catload-txt{min-width:0;display:flex;flex-direction:column;gap:3px;}
.ws-catload-txt b{font-family:Poppins,sans-serif;font-size:14px;color:#F4EAC8;}
.ws-catload-txt span{font-size:12.5px;color:rgba(220,240,225,.85);font-variant-numeric:tabular-nums;}
.ws-catload-txt i{font-style:normal;font-size:11.5px;color:rgba(220,240,225,.6);}
@media (prefers-reduced-motion:reduce){.ws-catload-spin{animation:none}}
@media(max-width:620px){
  .ws-catload{gap:12px;padding:13px 14px;}
  .ws-catload-spin{width:44px;height:44px;}
  .ws-catload-txt b{font-size:13.5px;}
  .ws-catload-txt span{font-size:12px;}
}

/* ---- Catalogue picker: the merchant's own storefront, mirrored ---- */
.ws-catsearch{margin-bottom:10px;}
.ws-catgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px;max-height:340px;overflow-y:auto;
  overscroll-behavior:contain;padding:2px 15px 26px 2px;scrollbar-gutter:stable;
  -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 26px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 26px),transparent);}
.ws-catgrid::-webkit-scrollbar{width:8px}
.ws-catgrid::-webkit-scrollbar-thumb{background:#BFDCCB;border-radius:99px}
.ws-cat{position:relative;text-align:left;border:1px solid var(--line2);border-radius:13px;background:#fff;padding:0 0 8px;
  cursor:pointer;overflow:hidden;transition:transform .12s,border-color .12s,box-shadow .12s;font:inherit;color:inherit;}
.ws-cat:hover{transform:translateY(-2px);border-color:var(--green2);box-shadow:0 8px 20px rgba(12,122,70,.12);}
.ws-cat.sel{border-color:var(--green2);box-shadow:0 0 0 1px var(--green2),0 6px 16px rgba(12,122,70,.16);}
.ws-cat-img{position:relative;display:grid;place-items:center;aspect-ratio:1/1;background:#F2F0E6 center/cover no-repeat;font-size:22px;color:#B6B0A0;}
.ws-cat b{display:block;padding:7px 9px 0;font-family:Inter,sans-serif;font-weight:600;font-size:11.5px;line-height:1.3;color:var(--ink);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.ws-cat-p{display:block;padding:2px 9px 0;font-size:11px;font-weight:700;color:var(--gold-deep);}
.ws-catfoot{display:flex;justify-content:flex-end;margin:-14px 0 4px;}
/* First run: no catalogue yet, so sell the idea before asking for the URL. */
.ws-connect{border:1px dashed rgba(176,133,38,.55);border-radius:14px;padding:15px 16px;background:rgba(231,200,121,.08);}
.ws-connect b{display:block;font-family:Poppins,sans-serif;font-size:14px;color:var(--ink);margin-bottom:5px;}
.ws-connect p{margin:0 0 11px;font-size:12.5px;line-height:1.5;color:var(--ink2);}
@media(max-width:620px){
  .ws-catgrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;max-height:300px;}
  .ws-cat b{font-size:10.5px;padding:6px 7px 0;}
  .ws-cat-p{font-size:10px;padding:1px 7px 0;}
}
/* Numbered step heads — the rule above each one is what actually segregates
   the form; the badge tells you how far in you are. */
.ws-stephead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:26px 0 14px;padding-top:20px;border-top:1px solid var(--line2);}
.ws-stephead:first-child{margin-top:4px;padding-top:0;border-top:0;}
.ws-stepn{flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;
  font-family:Poppins,sans-serif;font-weight:800;font-size:13px;color:#3A2A05;line-height:1;
  background:linear-gradient(168deg,#F3D98C,#D8AE41);border:1px solid rgba(140,105,25,.38);box-shadow:0 2px 6px rgba(140,105,25,.22);}
.ws-stephead b{font-family:Poppins,sans-serif;font-size:15.5px;color:var(--ink);letter-spacing:-.01em;}
.ws-stephint{font-size:11.5px;color:var(--ink2);font-weight:500;margin-left:auto;text-align:right;}
@media(max-width:620px){
  .ws-stephead{gap:8px;margin:20px 0 11px;padding-top:16px;}
  .ws-stephead b{font-size:14.5px;}
  .ws-stephint{flex:1 0 100%;margin-left:36px;text-align:left;}
}
.ws-offernote{font-size:11.5px;line-height:1.5;color:var(--ink2);margin:6px 0 2px;}
/* Size picker wraps — five options never fit one phone row. */
.ws-sizeseg{flex-wrap:wrap;}
.ws-sizeseg button{flex:0 1 auto;}
.ws-upsell b{font-family:Poppins,sans-serif;font-size:14px;color:var(--ink);}
.ws-upsell p{font-size:12.5px;color:var(--ink2);margin:6px 0 12px;}

/* ---- Mobile Studio: kill the doom scroll ----
 * One 200px-wide column per row meant every picker was a mile of thumbnails.
 * Two columns halves the height, and every picker gets the same contained,
 * inner-scrolling treatment the format library already had — so the page
 * stays a page and the choosing happens inside it. */
@media(max-width:620px){
  .ws-tiles,.ws-tiles.styles,.ws-tiles.fmt,.ws-tiles.two{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
  .ws-tile b{font-size:12.5px;padding:8px 9px 0;}
  .ws-tile.fmt b{font-size:12.5px;}
  .ws-tile-sub{font-size:10.5px;padding:2px 9px 0;line-height:1.35;}
  .ws-tile{padding-bottom:9px;border-radius:13px;}
  .ws-scrollbox{max-height:58vh;overflow-y:auto;overscroll-behavior:contain;scroll-behavior:smooth;
    /* Right gutter: the scroll thumb was riding on the tile art. */
    padding:3px 15px 34px 3px;scrollbar-gutter:stable;
    -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 34px),transparent);
    mask-image:linear-gradient(180deg,#000 calc(100% - 34px),transparent);}
  .ws-fmtbox{max-height:58vh;}
  .ws-tabs{gap:6px}
  .ws-tab{padding:9px 13px;font-size:12.5px;gap:6px;}
  .ws-lbl{margin:13px 0 7px}
  .ws-card{padding:16px}
  .ws-engines{gap:6px}
  .ws-engine{padding:7px 11px}
}
/* Two columns is already tight at 200px art — below that, don't shrink the
   text any further, just let the art carry it. */
@media(max-width:380px){
  .ws-tiles,.ws-tiles.styles,.ws-tiles.fmt,.ws-tiles.two{gap:8px;}
  .ws-tile-sub{display:none;}
}

/* ---- Helpurr — the AI helper (floating sidekick) ---- */
.mm-fab{position:fixed;z-index:10600;bottom:30px;right:20px;width:66px;height:66px;border:0;cursor:pointer;padding:0;background:transparent;transition:transform .15s;}
.mm-fab:hover{transform:translateY(-2px) scale(1.06);}
.mm-fab.open{transform:scale(.92);opacity:.95;}
/* Nudged up and out to the top-right corner — at top:4px/right:6px it sat on the
   cat's ear and read as an earring. Now it floats clear above the head as a badge. */
.mm-fab-dot{position:absolute;top:-2px;right:-3px;width:12px;height:12px;border-radius:50%;background:#F3D98C;border:2px solid #0B6B3E;pointer-events:none;z-index:4;box-shadow:0 1px 3px rgba(0,0,0,.25);}
/* ---- the familiar: a smart emerald pixel-art cat, floating + animated ---- */
.mm-fam{position:relative;display:grid;place-items:center;width:100%;height:100%;cursor:pointer;overflow:visible;}
.mm-fam-img{width:124%;height:124%;object-fit:contain;image-rendering:pixelated;will-change:transform;
  filter:drop-shadow(0 3px 4px rgba(10,40,26,.3));user-select:none;-webkit-user-drag:none;pointer-events:none;}
.mm-fam.think .mm-fam-img{filter:drop-shadow(0 3px 6px rgba(201,158,63,.55));}
.mm-fam-spark{position:absolute;width:5px;height:5px;border-radius:1px;background:#F3D98C;box-shadow:0 0 4px rgba(243,200,110,.9);pointer-events:none;z-index:3;}
@media (prefers-reduced-motion:reduce){.mm-fam-img{transform:none!important}}
.mm-panel{position:fixed;z-index:10600;bottom:94px;right:22px;width:min(360px,calc(100vw - 32px));height:min(520px,70vh);
  display:flex;flex-direction:column;border-radius:20px;overflow:hidden;background:linear-gradient(178deg,#FEFDF9,#F5F2E8);
  border:1px solid var(--line2);box-shadow:0 24px 60px rgba(10,20,14,.32),inset 0 1px 0 rgba(255,255,255,.8);
  animation:mmUp .28s cubic-bezier(.2,1.3,.4,1) both;}
@keyframes mmUp{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.mm-panel{animation:none}}
/* Maximized = the dedicated full-screen Helpurr surface (opened from the nav). */
.mm-backdrop{position:fixed;inset:0;z-index:10599;background:rgba(10,20,14,.46);animation:mmFade .2s both;}
@keyframes mmFade{from{opacity:0}to{opacity:1}}
.mm-panel.mm-max{inset:0;margin:auto;bottom:auto;right:auto;width:min(780px,94vw);height:min(86vh,900px);border-radius:22px;}
.mm-panel.mm-max .mm-list{padding-left:max(14px,calc((100% - 680px)/2));padding-right:max(14px,calc((100% - 680px)/2));}
.mm-panel.mm-max .mm-input{padding-left:max(10px,calc((100% - 680px)/2));padding-right:max(10px,calc((100% - 680px)/2));}
.mm-expand{margin-left:auto;background:none;border:0;color:rgba(244,234,200,.82);font-size:15px;line-height:1;cursor:pointer;padding:3px 7px;border-radius:7px;}
.mm-expand:hover{color:#fff;background:rgba(255,255,255,.12);}
.mm-head{display:flex;align-items:center;gap:10px;padding:13px 14px;background:linear-gradient(168deg,#0E5233,#0A3421);color:#F4EAC8;}
.mm-head-crest{width:42px;height:42px;flex:0 0 auto;overflow:visible;}
.mm-head-txt{display:flex;flex-direction:column;line-height:1.2;min-width:0;}
.mm-head-txt b{font-family:Poppins,sans-serif;font-size:14.5px;}
.mm-head-txt span{font-size:11px;color:rgba(244,234,200,.72);}
.mm-x{margin-left:2px;background:none;border:0;color:rgba(244,234,200,.85);font-size:23px;line-height:1;cursor:pointer;padding:2px 5px;}
.mm-x:hover{color:#fff;}
/* Chat tabs (projects) — a scrollable chip row under the header. */
.mm-tabs{display:flex;gap:5px;align-items:center;padding:7px 9px;background:#F3F0E4;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none;}
.mm-tabs::-webkit-scrollbar{display:none;}
.mm-tab{flex:0 0 auto;max-width:132px;font:inherit;font-size:11.5px;font-weight:700;color:var(--ink2);background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px 11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s,color .12s,border-color .12s;}
.mm-tab:hover{border-color:var(--green2);}
.mm-tab.on{background:linear-gradient(135deg,#12A85E,#0B6B3E);color:#fff;border-color:transparent;}
.mm-tab-new{font-size:15px;font-weight:800;color:var(--green);padding:4px 10px;line-height:1;}
.mm-list{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px;scrollbar-width:thin;}
.mm-msg{max-width:84%;padding:9px 13px;border-radius:15px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;}
.mm-msg.assistant{align-self:flex-start;background:#fff;border:1px solid var(--line);color:var(--ink);border-bottom-left-radius:5px;}
.mm-msg.user{align-self:flex-end;background:linear-gradient(168deg,#12A85E,#0B6B3E);color:#fff;border-bottom-right-radius:5px;}
.mm-row{display:flex;flex-direction:column;gap:7px;}
.mm-row.user{align-items:flex-end;}
.mm-row.assistant{align-items:flex-start;}
/* Inline media Helpurr shows (real creations from the Archive). */
.mm-media{display:flex;flex-wrap:wrap;gap:8px;max-width:92%;margin-top:2px;}
.mm-media-link{display:block;flex:0 0 auto;line-height:0;}
.mm-media-item{width:116px;height:116px;object-fit:cover;border-radius:12px;border:1px solid var(--line,#E4DFCF);background:#0b0f0d;display:block;}
video.mm-media-item{width:132px;height:176px;object-fit:cover;}
.mm-media-link:hover .mm-media-item{filter:brightness(1.05);}
.mm-media-aud{width:100%;max-width:260px;}
.mm-acts{display:flex;flex-wrap:wrap;gap:6px;max-width:92%;}
.mm-act{font:inherit;font-size:12.5px;font-weight:700;color:#fff;cursor:pointer;border:0;border-radius:999px;padding:8px 15px;
  background:linear-gradient(168deg,#12A85E,#0B6B3E);box-shadow:0 2px 8px rgba(12,122,70,.26),inset 0 0 0 1px rgba(231,200,121,.3);}
.mm-act:hover{filter:brightness(1.07);transform:translateY(-1px);}
/* Phase-2 "make it" confirm button — bigger + gold-trimmed so a creation stands
   apart from the small nav chips. Opens the task in the Studio to approve the spend. */
.mm-make{display:flex;align-items:center;justify-content:space-between;gap:10px;width:92%;cursor:pointer;border:0;text-align:left;
  font:inherit;font-weight:800;font-size:13px;color:#fff;border-radius:13px;padding:11px 14px;transition:filter .12s,transform .12s;
  background:linear-gradient(135deg,#12A85E 42%,#0B6B3E);box-shadow:0 3px 12px rgba(12,122,70,.3),inset 0 0 0 1px rgba(231,200,121,.42);}
.mm-make span{overflow-wrap:anywhere;}
.mm-make b{flex:0 0 auto;font-size:11.5px;font-weight:800;color:#F6E6B4;white-space:nowrap;}
.mm-make:hover{filter:brightness(1.06);transform:translateY(-1px);}
.mm-make-go{background:linear-gradient(135deg,#E7C879 38%,#C9A23F);box-shadow:0 3px 14px rgba(201,162,63,.34),inset 0 0 0 1px rgba(255,255,255,.3);color:#1A130A;}
.mm-make-go b{color:#4A3410;}
.mm-make-go:disabled{opacity:.6;cursor:default;filter:none;transform:none;}
.mm-typing{display:flex;gap:4px;align-items:center;}
.mm-typing i{width:7px;height:7px;border-radius:50%;background:#9CCBB1;animation:mmBlink 1.2s infinite both;}
.mm-typing i:nth-child(2){animation-delay:.2s}.mm-typing i:nth-child(3){animation-delay:.4s}
@keyframes mmBlink{0%,60%,100%{opacity:.3}30%{opacity:1}}
@media (prefers-reduced-motion:reduce){.mm-typing i{animation:none;opacity:.6}}
.mm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;}
.mm-chips button{font:inherit;font-size:12px;font-weight:600;color:var(--green);background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:6px 11px;cursor:pointer;}
.mm-chips button:hover{background:#DCF0E5;}
.mm-input{display:flex;gap:8px;padding:11px;border-top:1px solid var(--line);background:var(--card);}
.mm-input input{flex:1;border:1px solid var(--line2);border-radius:999px;padding:10px 15px;font:inherit;font-size:16px;background:#fff;color:var(--ink);outline:none;}
.mm-input input:focus{border-color:var(--green2);}
.mm-input button{flex:0 0 auto;width:42px;border:0;border-radius:50%;background:linear-gradient(168deg,#12A85E,#0B6B3E);color:#fff;font-size:14px;cursor:pointer;}
.mm-input button:disabled{opacity:.4;cursor:not-allowed;}
@media(max-width:620px){.mm-fab{bottom:30px;right:16px;width:56px;height:56px}.mm-panel{bottom:92px;right:16px;height:72vh}
  .mm-panel.mm-max{inset:0;margin:0;width:100vw;height:100vh;height:100dvh;border-radius:0}
  .mm-panel.mm-max .mm-list,.mm-panel.mm-max .mm-input{padding-left:14px;padding-right:14px}}
/* ── 44px tap-target floor (mobile touch). Appended so source order wins over
   the compact sizing above; icon glyph sizes are untouched, only hit boxes grow.
   Header controls use the 760px header breakpoint; Helpurr uses 620px. ── */
.wb-menu-plan{min-height:44px;display:inline-flex;align-items:center}
.wb-menu-topup{min-height:44px}
.wb-menu-link{min-height:44px}
.ws-mclose{min-height:44px;padding:0 16px;display:inline-flex;align-items:center;justify-content:center}
@media(max-width:760px){
  .wb-tab{min-height:44px;display:flex;align-items:center}
  .wb-admin{min-width:44px;min-height:44px}
  .wb-login{min-height:44px;display:inline-flex;align-items:center}
  .wb-chip{min-height:44px}
  .wb-mode-opt{min-height:44px;display:inline-flex;align-items:center}
  /* shared classes used by studio + archive marketing views */
  .ws-tab{min-height:44px}
  .ws-engine{min-height:44px}
}
@media(max-width:620px){
  .mm-x{min-width:44px;min-height:44px}
  .mm-tab{min-height:44px;display:inline-flex;align-items:center}
  .mm-chips button{min-height:44px;display:inline-flex;align-items:center}
  .mm-act{min-height:44px;display:inline-flex;align-items:center}
  .mm-make{min-height:44px}
  .mm-input input{min-height:44px}
  .mm-input button{min-width:44px;min-height:44px}
}
`;
