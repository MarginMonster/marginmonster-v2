/* Web front-door layout — the non-Shopify shell around dashboard, studio and
 * archive. Same engine, no Polaris/App Bridge; styled to match the landing. */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useNavigate, useSubmit } from "@remix-run/react";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { getWebIdentity } from "../lib/web-auth.server";
import { isAdminEmail } from "../lib/admin.server";
import { db } from "../db.server";
import { tokensRemainingLive, planTrialing, monthlyUsageSummary } from "../lib/tokens.server";
import { resolveTierKey, PLAN_BY_KEY, TOKEN_COST } from "../lib/plan-config";
import { normalizeContentLang } from "../lib/content-lang";
import { totalXpForLevel, ACHIEVEMENTS } from "../lib/achievements";
import { Ico } from "../lib/icons";
import { Familiar } from "../components/Familiar";
import { LangToggle } from "../components/LangToggle";
import { UI_LANG_NATIVE, readUiLang, tr } from "../lib/ui-i18n";
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
  const lang = readUiLang(request);
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
      planLabel: tier ? `${PLAN_BY_KEY[tier].name}${planTrialing(plan) ? " · " + tr(lang, "Trial") : ""}` : null,
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

  // The front door is now the DASHBOARD HERO (web._index.tsx) — the old
  // full-screen Creator/Social mode gate was retired and its art folded into
  // the hero's "…or drive it yourself" cards. Mode is chosen via the nav toggle
  // + those cards. (navigate stays — the mode toggle below uses it.)
  const navigate = useNavigate();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wb">
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
              {/* One consistent name — "Archive" — in BOTH sections; the page
                  labels itself "Creator Archive" / "Social Archive" and carries a
                  section toggle, so the two separate stores read as parallel
                  places instead of a Gallery-vs-Archive mismatch. */}
              <Link className={tab("/web/archive")} to={mode === "casual" ? "/web/archive?section=creator" : "/web/archive"}>{t("Archive")}</Link>
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
        <Buddy hud={hud} authed={authed} mode={mode} />
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
type MMPendingMake = { kind: "image" | "video" | "faceless" | "music" | "edit" | "create"; product: string; topic?: string; format?: string; voice?: string; sourceImageUrl?: string; editOp?: string; presenter: boolean; direction: string; cost: number; clean?: boolean; label: string };
type MMMsg = { role: "user" | "assistant"; content: string; actions?: MMAction[]; pending?: MMPending; media?: MMMedia[]; makes?: MMPendingMake[]; followups?: string[] };

// Render a SAFE light-markdown subset — **bold**, •-bullets, `inline code`,
// ```fenced code```, and clickable http(s) links — as React nodes (NEVER
// dangerouslySetInnerHTML, so model text can't inject HTML; only http/https URLs
// become anchors, so no javascript:/data: ever). Robust on partial input (runs on
// every stream delta): an unclosed fence/backtick just stays plain text. The
// bubble's white-space:pre-wrap does the line breaks for inline text.
const MM_URL_RE = /\bhttps?:\/\/[^\s<>]+[^\s<>.,!?;:'"]/g;
function renderInline(s: string, kb: string): ReactNode {
  return s.split(/(`[^`\n]+`)/g).map((part, i) => {
    const code = /^`([^`\n]+)`$/.exec(part);
    if (code) return <code key={kb + "c" + i} className="mm-code">{code[1]}</code>;
    return part.split(/(\*\*[^*\n]+\*\*)/g).map((bp, j) => {
      const b = /^\*\*([^*\n]+)\*\*$/.exec(bp);
      if (b) return <strong key={kb + "b" + i + "-" + j}>{b[1]}</strong>;
      const out: ReactNode[] = []; let last = 0; let m: RegExpExecArray | null; MM_URL_RE.lastIndex = 0;
      while ((m = MM_URL_RE.exec(bp)) !== null) {
        if (m.index > last) out.push(bp.slice(last, m.index));
        out.push(<a key={kb + "a" + i + "-" + j + "-" + m.index} href={m[0]} target="_blank" rel="noreferrer noopener" className="mm-link">{m[0]}</a>);
        last = m.index + m[0].length;
      }
      if (last < bp.length) out.push(bp.slice(last));
      return <Fragment key={kb + "t" + i + "-" + j}>{out}</Fragment>;
    });
  });
}
function renderRich(text: string): ReactNode {
  return (text || "").split(/(```[\s\S]*?```)/g).map((blk, bi) => {
    const block = /^```[^\n]*\n([\s\S]*?)```\s*$/.exec(blk); // ```lang\n…\n``` → a code block
    if (block) return <pre key={"pre" + bi} className="mm-pre"><code>{block[1].replace(/\n+$/, "")}</code></pre>;
    const oneLine = /^```[ \t]*(.*?)[ \t]*```$/.exec(blk); // ```code``` on one line → inline code (not an empty box)
    if (oneLine && oneLine[1]) return <code key={"ic" + bi} className="mm-code">{oneLine[1]}</code>;
    return blk.split("\n").map((line, li) => {
      const withBullet = line.replace(/^(\s*)[-*•]\s+/, "$1• ");
      return <Fragment key={bi + "-" + li}>{li > 0 ? "\n" : ""}{renderInline(withBullet, bi + "-" + li)}</Fragment>;
    });
  });
}
function Buddy({ hud, authed, mode }: { hud: { name: string; ads: number; level: number }; authed: boolean; mode: "marketing" | "casual" }) {
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  // Maximized = the dedicated full-screen Helpurr surface (a "chat section"),
  // opened from the nav. Same chat, same logic — just a roomier layout with a
  // backdrop. The floating panel is the compact default.
  const [max, setMax] = useState(false);
  // The Google-style landing HOME is an EXPLICIT view (not just "a fresh thread"):
  // the maximized Helpurr opens ON it, a 🏠 button returns to it, and "new chat"
  // lands on it. Sending / entering a thread / tapping a home make leaves it for
  // the chat view. Only ever shown maximized.
  const [showHome, setShowHome] = useState(false);
  // Lock the page behind the maximized chat. On iOS the dashboard body stays
  // scrollable (tall page), so scrolling the message list rubber-bands the whole
  // page and iOS drags the fixed panel — header and × close included — off the
  // top of the screen, trapping the user in the chat. Freezing the body at its
  // current offset (the reliable iOS lock) keeps the header pinned.
  useEffect(() => {
    if (typeof document === "undefined" || !(open && max)) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open, max]);
  const [msgs, setMsgs] = useState<MMMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Streaming: a warm "Pulling your numbers…" line while a tool runs mid-reply,
  // and an AbortController so the Stop button can cut a reply short.
  const [streamStatus, setStreamStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  // A make-from-chat generation in flight — disables other "Make it" buttons so
  // one tap can't become two paid jobs. Chat stays usable (makes take minutes).
  const [making, setMaking] = useState(false);
  // Persistent memory: once the saved thread has loaded (or confirmed empty) the
  // greeting may fire. Starts false so we don't greet over a conversation that's
  // about to load back in from the server.
  const [histReady, setHistReady] = useState(false);
  // Chat tabs (projects). "main" is the default thread; others are created on
  // demand. Threads are per mode (marketing/casual keep separate sets).
  const [threads, setThreads] = useState<Array<{ id: string; title: string; ts?: number }>>([{ id: "main", title: "Main" }]);
  const [activeThreadId, setActiveThreadId] = useState("main");
  // A photo the user attached to send to Helpurr (uploaded on pick; url is the
  // /uploads path Helpurr edits). uploading = the free upload call is in flight.
  // Up to a handful of photos per message — Helpurr can SEE them all (compare,
  // caption, pick the best), like Gemini/ChatGPT. The FIRST is the subject of an
  // "edit". Was a single photo; a beta tester asked for multi-upload.
  const MAX_ATTACH = 6;
  const [attach, setAttach] = useState<{ url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  // The most recent photo sent this thread — kept so a follow-up ("now cartoonize
  // it") still resolves a subject after the attach chip is consumed. Cleared on a
  // new thread or when a new photo is attached.
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Threads this session has deleted — so the post-delete thread-list refetch (and
  // any later load) can't resurrect a just-deleted chat before the POST commits.
  const deletedIdsRef = useRef<Set<string>>(new Set());
  // A queued "ask + go" from the /web home hero, sent once the panel is ready.
  const pendingAskRef = useRef<string | null>(null);
  // The full-page (max) chat has a Claude-style left sidebar of chats; on phones
  // it's a drawer this toggles.
  const [sideOpen, setSideOpen] = useState(false);
  // Message actions: copy (which bubble shows "Copied"), edit-a-user-message, and
  // a re-send queue (pendingResend) that regenerate + edit both route through so
  // they re-run a turn on the TRUNCATED message list without duplicating send().
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [pendingResend, setPendingResend] = useState<string | null>(null);
  // Rename / delete a saved chat thread (from the home "Your chats" grid).
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const t = useT();

  // Flipping mode is a different project set — back to that mode's Main thread.
  useEffect(() => { setActiveThreadId("main"); }, [mode]);
  // Home only exists maximized — shrinking/closing (or opening compact) clears it,
  // so compact→expand restores the last chat instead of unexpectedly landing home.
  useEffect(() => { if (!max) setShowHome(false); }, [max]);

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
        const data = (await res.json().catch(() => ({ history: [] }))) as { history?: Array<{ role?: string; content?: string }>; proactive?: { reply?: string; pendingAction?: MMPending | null; makes?: MMPendingMake[] } | null; threads?: Array<{ id: string; title: string; ts?: number }> };
        if (cancelled) return;
        if (Array.isArray(data.threads) && data.threads.length) setThreads(data.threads.filter((th) => !deletedIdsRef.current.has(th.id)));
        const hist = (Array.isArray(data.history) ? data.history : [])
          .filter((m) => m && typeof m.content === "string" && m.content.trim())
          .map((m): MMMsg => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content as string }));
        // Proactive, store-grounded suggestion: the opener for a fresh thread, or
        // a fresh nudge at the end of an existing one. Not saved (transient). It can
        // carry a one-tap make queue (the performance→action loop: "your top piece
        // got the most clicks — want 3 more?").
        const nudge: MMMsg | null = data.proactive && data.proactive.reply
          ? { role: "assistant", content: data.proactive.reply, pending: data.proactive.pendingAction || undefined, makes: Array.isArray(data.proactive.makes) && data.proactive.makes.length ? data.proactive.makes : undefined }
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
  // On OPEN / thread switch, jump straight to the NEWEST message (the history can
  // be long — it used to open stranded at the oldest). The ref makes the next
  // render after one of those events force-scroll to the bottom once.
  const pinBottomRef = useRef(true);
  useEffect(() => { if (open) pinBottomRef.current = true; }, [open, activeThreadId]);
  // Then follow the conversation DOWN only when the user is already near the
  // bottom — never yank them away from an earlier message they scrolled up to read.
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    if (pinBottomRef.current) { el.scrollTop = el.scrollHeight; pinBottomRef.current = false; }
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, making]);
  // Move focus into the message box when the chat opens, so you can just type
  // (and keyboard users aren't stranded on the FAB). A soft focus; not on mobile
  // where it would pop the keyboard unprompted.
  useEffect(() => { if (open && !window.matchMedia("(max-width: 620px)").matches) { const id = window.setTimeout(() => inputRef.current?.focus(), 60); return () => window.clearTimeout(id); } }, [open]);
  // Let any page open the chat — the Creator home's "Ask Helpurr" card fires this.
  useEffect(() => {
    const h = (e: Event) => {
      setOpen(true);
      const detail = (e as CustomEvent<{ text?: string; max?: boolean; send?: boolean }>).detail;
      if (detail?.max) setMax(true);
      const prefill = detail?.text;
      if (typeof prefill === "string" && prefill.trim() && detail?.send) {
        // "Ask + go" from the home hero / a quick chip: drop into the chat and
        // auto-send once history has loaded (a chat turn spends nothing).
        pendingAskRef.current = prefill.trim();
        if (detail?.max) setShowHome(false);
      } else if (typeof prefill === "string" && prefill.trim()) {
        // Prefill the composer so the user just hits send (no auto-send).
        if (detail?.max) setShowHome(true);
        setInput(prefill);
      } else if (detail?.max) {
        // The nav "Helpurr" entry opens the full-screen surface straight into the
        // chat workspace (last thread, or a fresh composer) — the DASHBOARD hero
        // is the landing now, so re-showing an identical Helpurr home splash here
        // just duplicated it. 🏠 / Home is the explicit way to the chat list.
        setShowHome(false);
      }
    };
    window.addEventListener("helpurr:open", h);
    return () => window.removeEventListener("helpurr:open", h);
  }, []);
  // Fire a queued "ask + go" once the panel is open and its thread has loaded, so
  // the auto-sent message lands on the right conversation.
  useEffect(() => {
    if (open && histReady && !busy && pendingAskRef.current) { const text = pendingAskRef.current; pendingAskRef.current = null; void send(text); }
  }, [open, histReady, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Upload a picked photo to the FREE, tested frameUpload endpoint and hold the
  // returned /uploads URL so the next message carries it to Helpurr. No tokens.
  const pickPhoto = async (files: FileList | File[] | null | undefined) => {
    const list = files ? Array.from(files) : [];
    if (!list.length || uploading) return;
    const room = MAX_ATTACH - attach.length;
    if (room <= 0) { setMsgs((m) => [...m, { role: "assistant", content: t("That's the most I can take at once ({n}) — remove one to add another.", { n: MAX_ATTACH }) }]); if (fileRef.current) fileRef.current.value = ""; return; }
    setUploading(true);
    try {
      // Upload each (free, token-less resource route) and append as it lands, so a
      // bad file in the batch doesn't sink the good ones. Respect the cap.
      for (const file of list.slice(0, room)) {
        if (!/^image\//.test(file.type)) { setMsgs((m) => [...m, { role: "assistant", content: t("That doesn't look like an image — send a JPG, PNG or WebP.") }]); continue; }
        if (file.size > 8 * 1024 * 1024) { setMsgs((m) => [...m, { role: "assistant", content: t("That photo's a bit big — keep it under 8MB.") }]); continue; }
        try {
          const fd = new FormData();
          fd.set("productPhoto", file);
          const r = await fetch("/api/buddy-upload", { method: "POST", body: fd });
          const d = await r.json().catch(() => ({})) as { frameUrl?: string; error?: string };
          if (d.frameUrl) { const url = d.frameUrl; setAttach((a) => (a.length >= MAX_ATTACH ? a : [...a, { url, name: file.name }])); }
          else setMsgs((m) => [...m, { role: "assistant", content: d.error || t("Couldn't upload that photo — mind trying again?") }]);
        } catch {
          setMsgs((m) => [...m, { role: "assistant", content: t("Couldn't upload that photo — mind trying again?") }]);
        }
      }
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const removeAttach = (url: string) => setAttach((a) => a.filter((p) => p.url !== url));

  const send = async (text: string) => {
    const trimmed = text.trim();
    // Allow sending a photo on its own (no text), but never while busy/uploading.
    if ((!trimmed && !attach.length) || busy || uploading) return;
    setShowHome(false); // sending from the home hero/cards drops into the chat view
    const photos = attach;
    const carryPhoto = photos[0]?.url || lastPhoto; // first photo = subject for a follow-up edit
    const userMsg: MMMsg = { role: "user", content: trimmed || (photos.length ? t("Here's a photo") : ""), media: photos.length ? photos.map((p) => ({ url: p.url, type: "IMAGE_AD" as const, title: p.name })) : undefined };
    const next: MMMsg[] = [...msgs, userMsg];
    setMsgs(next); setInput(""); setAttach([]); setBusy(true);
    if (photos.length) setLastPhoto(photos[0].url);
    // Optimistically name a brand-new thread from the first message (the server
    // does the same; this just avoids a flash of "New chat" on the tab).
    const title = trimmed || t("Photo");
    if (activeThreadId !== "main") setThreads((ts) => ts.map((th) => (th.id === activeThreadId && th.title === "New chat" ? { ...th, title: title.slice(0, 42) } : th)));
    type ReplyData = { reply?: string; actions?: MMAction[]; pendingAction?: MMPending | null; media?: MMMedia[]; pendingMakes?: MMPendingMake[] | null; followups?: string[] };
    const finalize = (m: MMMsg[], d: ReplyData, content: string): MMMsg[] => { if (!m.length) return m; const copy = [...m]; const last = copy[copy.length - 1]; if (last.role !== "assistant") return m; copy[copy.length - 1] = { ...last, content, actions: Array.isArray(d.actions) ? d.actions : [], pending: d.pendingAction || undefined, media: Array.isArray(d.media) && d.media.length ? d.media : undefined, makes: Array.isArray(d.pendingMakes) && d.pendingMakes.length ? d.pendingMakes : undefined, followups: Array.isArray(d.followups) && d.followups.length ? d.followups : undefined }; return copy; };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
      const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next.slice(-40).map(({ role, content }) => ({ role, content })), path: loc.pathname, mode, threadId: activeThreadId, imageUrl: photos[0]?.url, imageUrls: photos.map((p) => p.url), lastPhotoUrl: carryPhoto || undefined, tz }), signal: controller.signal });
      if ((res.headers.get("content-type") || "").includes("text/event-stream") && res.body) {
        // STREAMING reply: append an empty assistant bubble and grow it as deltas
        // arrive; the terminal `done` frame carries actions/pending/media/followups.
        setMsgs((m) => [...m, { role: "assistant", content: "" }]);
        const patchLast = (content: string) => setMsgs((m) => { if (!m.length) return m; const copy = [...m]; const last = copy[copy.length - 1]; if (last.role !== "assistant") return m; copy[copy.length - 1] = { ...last, content }; return copy; });
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = ""; let acc = ""; let doneData: ReplyData | null = null;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let sep: number;
            while ((sep = buf.indexOf("\n\n")) !== -1) {
              const frame = buf.slice(0, sep); buf = buf.slice(sep + 2);
              const lines = frame.split("\n");
              const ev = (lines.find((l) => l.startsWith("event:")) || "").slice(6).trim();
              const dataLine = lines.find((l) => l.startsWith("data:"));
              if (!dataLine) continue;
              let d: { delta?: string; replace?: boolean; label?: string } & ReplyData;
              try { d = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
              if (ev === "text") { acc = d.replace ? (d.delta || "") : acc + (d.delta || ""); setStreamStatus(""); patchLast(acc); }
              else if (ev === "status") { setStreamStatus(d.label || ""); }
              else if (ev === "done") { doneData = d; }
            }
          }
        } catch { /* aborted (Stop) or a mid-stream drop — keep whatever streamed */ }
        setStreamStatus("");
        if (doneData) setMsgs((m) => finalize(m, doneData!, doneData!.reply || acc || "…"));
        else if (!acc) patchLast(t("Connection blipped — mind trying again?"));
      } else {
        // NON-STREAM (daily cap, not signed in, cap upsell): plain JSON as before.
        const data = await res.json().catch(() => ({ reply: "" })) as ReplyData;
        setMsgs((m) => [...m, { role: "assistant", content: data.reply || "…", actions: Array.isArray(data.actions) ? data.actions : [], pending: data.pendingAction || undefined, media: Array.isArray(data.media) && data.media.length ? data.media : undefined, makes: Array.isArray(data.pendingMakes) && data.pendingMakes.length ? data.pendingMakes : undefined, followups: Array.isArray(data.followups) && data.followups.length ? data.followups : undefined }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: t("Connection blipped — mind trying again?") }]);
    } finally { setBusy(false); setStreamStatus(""); abortRef.current = null; }
  };

  // Poll ONE enqueued make (job id + a time cursor; assets carry no jobId column, so
  // the server correlates the newest asset of this type since the cursor). Resolves
  // when the media lands / fails / times out, dropping its result inline. Shared by
  // single makes and the multi-make queue so every item streams in independently.
  const pollMake = (jobId: string, cursor: number, kind: string, spec: MMPendingMake, withReview: boolean) => new Promise<void>((resolve) => {
    // Faceless is the slowest (script→voice→captions→b-roll→music), then product video.
    const limit = (kind === "video" || kind === "faceless") ? 72 : kind === "music" ? 36 : 24; // ~6min / ~3min / ~2min at 5s
    let tries = 0;
    const tick = async () => {
      tries++;
      try {
        const r = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "makeStatus", jobId, cursor, kind, mode }) });
        const s = await r.json().catch(() => ({})) as { done?: boolean; media?: MMMedia[]; failed?: boolean; error?: string };
        if (s.failed) {
          setMsgs((m) => [...m, { role: "assistant", content: s.error || t("That one didn't come out right, so I refunded the tokens. Want to try again?") }]);
          resolve(); return;
        }
        if (s.done && Array.isArray(s.media) && s.media.length) {
          const media = s.media;
          setMsgs((m) => [...m, { role: "assistant", content: t("Here it is! 🎉 Tap to open it full-size."), media }]);
          // Helpurr takes an actual LOOK (images only) and gives one honest, grounded
          // line — the "views it like you do" pass. Only for a single make (a batch
          // would spam N reviews + N Redo buttons). Any failure just means no line.
          if (withReview && spec.kind === "image" && media[0]?.url) {
            try {
              const rv = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "review", imageUrl: media[0].url, product: spec.product, mode }) });
              const rd = await rv.json().catch(() => ({})) as { caption?: string; ok?: boolean };
              // If the result isn't good, offer a one-tap Redo of the SAME spec —
              // closed-loop self-correction, routed through the normal confirm→make
              // path (so it still spends on tap; no new money path).
              if (rd.caption) setMsgs((m) => [...m, { role: "assistant", content: rd.caption as string, makes: rd.ok === false ? [{ ...spec, label: t("Redo it") }] : undefined }]);
            } catch { /* the review is a nicety, never a blocker */ }
          }
          resolve(); return;
        }
      } catch { /* transient — keep polling */ }
      if (tries >= limit) {
        setMsgs((m) => [...m, { role: "assistant", content: t("Still cooking — it's taking longer than usual. Check your Gallery in a moment; it'll land there when it's done.") }]);
        resolve(); return;
      }
      window.setTimeout(tick, 5000);
    };
    window.setTimeout(tick, 5000);
  });

  // One-tap confirm on a Helpurr "Make it" / "Make all N" button: spend the tokens
  // and kick off the SAME tested job(s) the Studio enqueues, then poll each until the
  // media lands and drop it inline. A BATCH ("make 3 of these") enqueues every spec
  // on this one tap — each still spends + re-validates server-side, with the total
  // shown on the button — and each result streams in as it finishes. Chat stays
  // usable throughout (makes take minutes).
  const runMakes = async (specs: MMPendingMake[]) => {
    if (making || !specs.length) return;
    setMaking(true);
    // Remove the pending make(s) from every message so the button can't be tapped twice.
    setMsgs((m) => m.map((x) => (x.makes ? { ...x, makes: undefined } : x)));
    if (specs.length === 1) {
      const noun = specs[0].kind === "music" ? t("track") : (specs[0].kind === "video" || specs[0].kind === "faceless") ? t("video") : t("image");
      setMsgs((m) => [...m, { role: "assistant", content: t("On it — making your {noun} now. This takes a minute; keep chatting if you like and I'll drop it here when it's ready. 🎬", { noun }) }]);
    } else {
      setMsgs((m) => [...m, { role: "assistant", content: t("On it — making {n} now. Each takes a minute; keep chatting and I'll drop each one here as it lands. 🎬", { n: specs.length }) }]);
    }
    // Enqueue sequentially so the spend is ordered and a mid-batch "out of tokens"
    // stops cleanly; each returns its own job to poll.
    const jobs: { jobId: string; cursor: number; kind: string; spec: MMPendingMake }[] = [];
    let firstErr = ""; let upsell = false;
    for (const spec of specs) {
      try {
        const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "make", make: spec, mode }) });
        const data = await res.json().catch(() => ({})) as { jobId?: string; cursor?: number; kind?: string; error?: string; upsell?: string };
        if (data.jobId && typeof data.cursor === "number") {
          jobs.push({ jobId: data.jobId, cursor: data.cursor, kind: data.kind || spec.kind, spec });
        } else {
          if (!firstErr) firstErr = data.error || "";
          if (data.upsell) upsell = true;
        }
      } catch { if (!firstErr) firstErr = t("Connection blipped before I could start — mind trying again?"); }
    }
    if (!jobs.length) {
      // A free-tier wall (out of free makes / a paid-only kind) returns an upsell —
      // surface it as a tappable "See plans" button, not just text.
      const pending = upsell ? { label: t("See plans"), to: "/web#plans", cost: 0, kind: "plans" } : undefined;
      setMsgs((m) => [...m, { role: "assistant", content: firstErr || t("Couldn't start that one — mind trying again?"), pending }]);
      setMaking(false);
      return;
    }
    // Partial batch (ran out of tokens part-way) → say so once, honestly.
    if (jobs.length < specs.length) {
      setMsgs((m) => [...m, { role: "assistant", content: firstErr || t("I could only start {done} of the {total} — I'll bring those in as they land.", { done: jobs.length, total: specs.length }) }]);
    }
    const withReview = jobs.length === 1;
    await Promise.all(jobs.map((j) => pollMake(j.jobId, j.cursor, j.kind, j.spec, withReview)));
    setMaking(false);
  };

  // Create a fresh project/thread and switch to it (loads empty → proactive opener).
  const newThread = async () => {
    if (busy) return;
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "newThread", mode }) });
      const data = await res.json().catch(() => ({})) as { threadId?: string; title?: string };
      if (data.threadId) {
        setThreads((ts) => [...ts, { id: data.threadId as string, title: data.title || "New chat", ts: Date.now() }]);
        setActiveThreadId(data.threadId);
        setAttach([]); setLastPhoto(null); // a fresh thread starts photo-free
        if (max) setShowHome(true); // a new chat lands on the home (maximized)
      }
    } catch { /* ignore */ }
  };

  // Rename a saved thread (optimistic; "main" isn't renameable so it has no button).
  // Reverts the title if the server rejects, so the UI never silently diverges.
  const commitRename = async (threadId: string) => {
    const title = renameText.trim().slice(0, 42);
    setRenamingThreadId(null);
    const cur = threads.find((th) => th.id === threadId);
    if (!title || !cur || cur.title === title) return;
    const prevTitle = cur.title;
    setThreads((ts) => ts.map((th) => (th.id === threadId ? { ...th, title } : th)));
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "renameThread", threadId, title, mode }) });
      if (!res.ok) throw new Error("rename");
    } catch { setThreads((ts) => ts.map((th) => (th.id === threadId ? { ...th, title: prevTitle } : th))); }
  };
  // Delete a saved thread — armed-to-confirm so one tap can't nuke a chat. Optimistic,
  // but reverts (and un-marks the id) if the server rejects, so it can't come back a
  // ghost on reload after a real failure.
  const armDelete = (threadId: string) => { setArmedDeleteId(threadId); window.setTimeout(() => setArmedDeleteId((c) => (c === threadId ? null : c)), 3200); };
  const deleteThread = async (threadId: string) => {
    setArmedDeleteId(null);
    const prev = threads;
    deletedIdsRef.current.add(threadId);
    setThreads((ts) => ts.filter((th) => th.id !== threadId));
    if (activeThreadId === threadId) { setActiveThreadId("main"); if (max) setShowHome(true); }
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "deleteThread", threadId, mode }) });
      if (!res.ok) throw new Error("delete");
    } catch { deletedIdsRef.current.delete(threadId); setThreads(prev); }
  };

  // Auto-grow the composer textarea up to ~6 lines, then it scrolls. Runs on every
  // value change (typing, paste, prefill, reset) and when the composer swaps home↔chat.
  useEffect(() => {
    const el = inputRef.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 132) + "px";
  }, [input, open, showHome]);
  // regenerate()/saveEdit() truncate msgs then set pendingResend; this re-runs that
  // turn through the normal send(), which here closes over the truncated msgs.
  useEffect(() => {
    if (pendingResend !== null && !busy && !uploading) { const text = pendingResend; setPendingResend(null); void send(text); }
  }, [pendingResend, busy, uploading]); // eslint-disable-line react-hooks/exhaustive-deps
  // Enter sends; Shift+Enter is a newline (standard desktop chat composer). On
  // mobile, Enter inserts a newline and the ➤ button sends (phones have no easy
  // Shift+Enter, and you want to be able to type multi-line there too).
  const taKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey && !window.matchMedia("(max-width: 620px)").matches) { e.preventDefault(); void send(input); } };
  // Copy a message's text (minus the light-markdown markers) to the clipboard.
  const copyText = async (text: string, idx: number) => {
    const plain = (text || "").replace(/```[^\n]*\n([\s\S]*?)```/g, "$1").replace(/```[ \t]*([^\n]*?)[ \t]*```/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`\n]+)`/g, "$1");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(plain);
      else { const ta = document.createElement("textarea"); ta.value = plain; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
      setCopiedIdx(idx); window.setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500);
    } catch { /* clipboard blocked — no-op */ }
  };
  // Regenerate: drop the last reply (and its user turn) and re-run that user turn.
  const regenerate = () => {
    if (busy || making) return;
    let u = -1; for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") { u = i; break; }
    if (u < 0) return;
    const text = msgs[u].content;
    setMsgs(msgs.slice(0, u)); setPendingResend(text);
  };
  // Edit a user message: drop it + everything after, then re-send the edited text.
  const startEdit = (idx: number) => { if (busy || making) return; setEditingIdx(idx); setEditText(msgs[idx].content); };
  const saveEdit = () => {
    if (editingIdx === null) return;
    const text = editText.trim(); const i = editingIdx;
    setEditingIdx(null);
    if (!text) return;
    setMsgs(msgs.slice(0, i)); setPendingResend(text);
  };

  const go = (to: string) => { setOpen(false); if (to.startsWith("/web#")) { window.location.href = to; } else { nav(to); } };
  const chips = mode === "casual"
    ? [t("Edit one of my photos"), t("Make a fun post"), t("Turn this into a sticker")]
    : [t("Make me an ad"), t("Which format converts best?"), t("Give me an idea for a video")];
  // The HOME landing surface: a Google-homepage-style hero (wordmark + big ask bar +
  // quick-start cards + your saved chats) shown when the dedicated full-screen Helpurr
  // is open on a fresh thread (no questions asked yet). The moment a message is sent
  // it flips to the normal chat view. Compact/floating mode keeps the simple list.
  const atHome = max && authed && showHome;
  // The performance→action loop, surfaced on the home: the proactive OPENER may
  // carry a one-tap make queue ("your top piece got the most clicks — want 3
  // more?"). Only when the thread has no user turns yet — i.e. this really is the
  // proactive opener — so tapping 🏠 over an existing conversation can't resurface
  // some old un-run make as a fake "performance" banner.
  const perfMake = atHome && !msgs.some((m) => m.role === "user") ? msgs.find((m) => m.role === "assistant" && m.makes && m.makes.length) : undefined;
  const lastUserIdx = msgs.reduce((acc, m, idx) => (m.role === "user" ? idx : acc), -1);
  // Group the sidebar's chats into recency buckets (Today / Yesterday / …), sorted
  // newest-first, Claude-style. Computed each render from each thread's last-activity ts.
  const recencyGroups = (() => {
    const now = Date.now();
    const sot = new Date(); sot.setHours(0, 0, 0, 0); const sotMs = sot.getTime();
    const DAY = 86_400_000;
    const defs = [
      { key: "today", label: t("Today"), min: sotMs },
      { key: "yesterday", label: t("Yesterday"), min: sotMs - DAY },
      { key: "week", label: t("Previous 7 days"), min: now - 7 * DAY },
      { key: "month", label: t("Previous 30 days"), min: now - 30 * DAY },
      { key: "older", label: t("Older"), min: -Infinity },
    ];
    const out = defs.map((d) => ({ key: d.key, label: d.label, items: [] as typeof threads }));
    for (const th of [...threads].sort((a, b) => (b.ts || 0) - (a.ts || 0))) {
      const ts = th.ts || 0;
      const gi = defs.findIndex((d) => ts >= d.min);
      out[gi >= 0 ? gi : out.length - 1].items.push(th);
    }
    return out.filter((g) => g.items.length);
  })();
  // The active chat's title, shown in the full-page top bar (Claude-style).
  const activeTitle = threads.find((th) => th.id === activeThreadId)?.title || "";
  const homeCards = mode === "casual"
    ? [
        { icon: "🖼️", label: t("Edit a photo"), sub: t("Restyle · cut out · swap bg"), act: () => fileRef.current?.click() },
        { icon: "📱", label: t("Faceless video"), sub: t("A scripted 9:16 clip"), act: () => void send(t("Make me a faceless video")) },
        { icon: "🎵", label: t("Make a track"), sub: t("An original music clip"), act: () => void send(t("Make me a music track")) },
        { icon: "✨", label: t("Something to post"), sub: t("Ideas on tap"), act: () => void send(t("Make me something fun to post")) },
      ]
    : [
        { icon: "✨", label: t("Make an ad"), sub: t("An image ad for a product"), act: () => void send(t("Make me an ad")) },
        { icon: "🎬", label: t("Make a video"), sub: t("A product video"), act: () => void send(t("Make me a product video")) },
        { icon: "📱", label: t("Faceless video"), sub: t("A scripted 9:16 clip"), act: () => void send(t("Make me a faceless video")) },
        { icon: "🖼️", label: t("Edit a photo"), sub: t("Restyle · cut out · swap bg"), act: () => fileRef.current?.click() },
      ];

  // The dashboard home already leads with a big animated Helpurr (the hero) and a
  // Helpurr nav tab, so a third floating cat down in the corner is redundant and
  // reads as clutter. Keep the floating button only on the manual-work pages
  // (Studio, Campaigns, Channels, Archive…) where it's the quick way to ask a
  // question mid-project. (It still opens maximized from the hero/nav on home.)
  const onHome = loc.pathname === "/web" || loc.pathname === "/web/";
  return (
    <>
      {!onHome && (
        <button type="button" className={`mm-fab${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)} aria-label={t("Chat with Helpurr, your AI helper")}>
          <Familiar />
          {!open && <span className="mm-fab-dot" aria-hidden="true" />}
        </button>
      )}
      {open && max && <div className="mm-backdrop" onClick={() => setMax(false)} aria-hidden="true" />}
      {open && (
        <div className={`mm-panel${max ? " mm-max" : ""}${sideOpen ? " mm-side-open" : ""}`} role="dialog" aria-modal={max ? true : undefined} aria-label={t("Helpurr chat")} onKeyDown={(e) => { if (e.key === "Escape") { if (sideOpen) setSideOpen(false); else if (max) setMax(false); else setOpen(false); } }}>
          {max && authed && (
            <aside className="mm-side">
              <div className="mm-side-brand"><span className="mm-side-crest"><Familiar /></span><span className="mm-side-word">Easy<b>Mode</b></span></div>
              <button type="button" className="mm-side-new" onClick={() => { void newThread(); setSideOpen(false); }}>{t("+ New chat")}</button>
              <div className="mm-side-list">
                {recencyGroups.map((group) => (
                  <div key={group.key} className="mm-side-group">
                    <div className="mm-side-group-h">{group.label}</div>
                    {group.items.map((th) => (
                  <div key={th.id} className={`mm-side-chat${th.id === activeThreadId && !showHome ? " on" : ""}`}>
                    {renamingThreadId === th.id ? (
                      <input className="mm-side-chat-rename" value={renameText} autoFocus maxLength={42}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void commitRename(th.id); else if (e.key === "Escape") setRenamingThreadId(null); }}
                        onBlur={() => void commitRename(th.id)} aria-label={t("Rename chat")} />
                    ) : (
                      <>
                        <button type="button" className="mm-side-chat-main" onClick={() => { if (!busy) { setActiveThreadId(th.id); setShowHome(false); setAttach([]); setLastPhoto(null); setSideOpen(false); } }} title={th.title}>
                          <span className="mm-side-chat-tx">{th.title}</span>
                        </button>
                        {th.id !== "main" && (
                          <span className="mm-side-chat-acts">
                            <button type="button" className="mm-chat-act" onClick={() => { setRenamingThreadId(th.id); setRenameText(th.title); setArmedDeleteId(null); }} title={t("Rename")} aria-label={t("Rename chat")}>✎</button>
                            {armedDeleteId === th.id
                              ? <button type="button" className="mm-chat-act mm-chat-del" onClick={() => void deleteThread(th.id)} title={t("Tap to confirm")}>{t("Delete?")}</button>
                              : <button type="button" className="mm-chat-act" onClick={() => armDelete(th.id)} title={t("Delete")} aria-label={t("Delete chat")}>🗑</button>}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                    ))}
                  </div>
                ))}
              </div>
              <button type="button" className="mm-side-foot-btn" onClick={() => { setShowHome(true); setSideOpen(false); }}>⌂ {t("Home")}</button>
            </aside>
          )}
          {max && sideOpen && <div className="mm-side-scrim" onClick={() => setSideOpen(false)} aria-hidden="true" />}
          <div className="mm-maincol">
          <div className="mm-head">
            {max && authed && <button type="button" className="mm-side-toggle" onClick={() => setSideOpen((o) => !o)} aria-label={t("Your chats")} title={t("Your chats")}>☰</button>}
            <span className="mm-head-crest"><Familiar think={busy} /></span>
            <div className="mm-head-txt">
              <b>{max && !showHome && activeTitle ? activeTitle : "Helpurr"}</b>
              <span>{busy ? t("thinking…") : (max && !showHome && activeTitle ? "Helpurr" : t("your AI helper"))}</span>
            </div>
            <button type="button" className="mm-expand" onClick={() => setMax((m) => !m)} aria-label={max ? t("Shrink chat") : t("Expand chat")} title={max ? t("Shrink") : t("Expand")}>{max ? "⤡" : "⤢"}</button>
            {max && authed && !atHome && <button type="button" className="mm-homebtn" onClick={() => setShowHome(true)} aria-label={t("Helpurr home")} title={t("Home")}>🏠</button>}
            <button type="button" className="mm-x" onClick={() => { setOpen(false); setMax(false); setSideOpen(false); }} aria-label={t("Close chat")}>×</button>
          </div>
          {authed && !atHome && !max && (
            <div className="mm-tabs" role="tablist" aria-label={t("Your chats")}>
              {threads.map((th) => (
                <button key={th.id} type="button" role="tab" aria-selected={th.id === activeThreadId}
                  className={`mm-tab${th.id === activeThreadId ? " on" : ""}`}
                  onClick={() => { if (th.id !== activeThreadId && !busy) { setActiveThreadId(th.id); setAttach([]); setLastPhoto(null); } }} title={th.title}>
                  {th.title}
                </button>
              ))}
              <button type="button" className="mm-tab mm-tab-new" onClick={newThread} title={t("New chat")} aria-label={t("Start a new chat")}>+</button>
            </div>
          )}
          {atHome && (
            <div className="mm-home">
              {perfMake && (
                <div className="mm-home-perf">
                  <p className="mm-home-perf-tx">{renderRich(perfMake.content)}</p>
                  <button type="button" className="mm-make mm-make-go mm-home-perf-btn" disabled={making} onClick={() => { setShowHome(false); void runMakes(perfMake.makes!); }}>
                    {(() => { const specs = perfMake.makes!; const tot = specs.reduce((s, x) => s + (x.cost || 0), 0); const n = specs.length; return <><span>{making ? t("Working…") : (n > 1 ? t("✨ Make all {n}", { n }) : t("✨ {label}", { label: specs[0].label }))}</span><b>{tot > 0 ? t("{n} tokens →", { n: tot }) : t("Free →")}</b></>; })()}
                  </button>
                </div>
              )}
              <div className="mm-home-hero">
                {/* No EasyMode crest/wordmark splash here — the dashboard hero is the
                    branded front door; this surface (reached via 🏠 / Home) is the
                    chat workspace, so it leads straight with the composer + your chats. */}
                <p className="mm-home-sub mm-home-greet">{hud.name ? t("Hey {name} — what are we making today?", { name: hud.name.split(" ")[0] }) : t("What are we making today?")}</p>
                <form className="mm-home-ask" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => pickPhoto(e.target.files)} />
                  <button type="button" className="mm-home-clip" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label={t("Attach a photo")} title={t("Attach a photo")}>📎</button>
                  <textarea ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={taKeyDown} placeholder={t("Ask Helpurr anything…")} aria-label={t("Message Helpurr")} />
                  <button type="submit" className="mm-home-send" disabled={uploading || (!input.trim() && !attach.length)} aria-label={t("Send")}>➤</button>
                </form>
                {(attach.length > 0 || uploading) && (
                  <div className="mm-home-attach">
                    {attach.map((p) => (
                      <span key={p.url} className="mm-home-attach-item"><img src={p.url} alt={p.name} /><button type="button" onClick={() => removeAttach(p.url)} aria-label={t("Remove photo")}>×</button></span>
                    ))}
                    {uploading && <span className="mm-attach-up">{t("Uploading…")}</span>}
                  </div>
                )}
                <div className="mm-home-cards">
                  {homeCards.map((c) => (
                    <button key={c.label} type="button" className="mm-home-card" onClick={c.act} disabled={busy || uploading}>
                      <span className="mm-home-card-ic" aria-hidden="true">{c.icon}</span>
                      <span className="mm-home-card-tx"><b>{c.label}</b><i>{c.sub}</i></span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mm-home-recent">
                <div className="mm-home-recent-h"><span>{t("Your chats")}</span><button type="button" onClick={newThread}>+ {t("New chat")}</button></div>
                <div className="mm-home-chats">
                  {threads.map((th) => (
                    <div key={th.id} className={`mm-home-chat${th.id === activeThreadId ? " on" : ""}`}>
                      {renamingThreadId === th.id ? (
                        <input className="mm-home-chat-rename" value={renameText} autoFocus maxLength={42}
                          onChange={(e) => setRenameText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void commitRename(th.id); else if (e.key === "Escape") setRenamingThreadId(null); }}
                          onBlur={() => void commitRename(th.id)} aria-label={t("Rename chat")} />
                      ) : (
                        <>
                          <button type="button" className="mm-home-chat-main" onClick={() => { if (!busy) { setActiveThreadId(th.id); setShowHome(false); setAttach([]); setLastPhoto(null); } }} title={th.title}>
                            <span className="mm-home-chat-ic" aria-hidden="true">💬</span>
                            <span className="mm-home-chat-tx">{th.title}</span>
                          </button>
                          {th.id !== "main" && (
                            <span className="mm-home-chat-acts">
                              <button type="button" className="mm-chat-act" onClick={() => { setRenamingThreadId(th.id); setRenameText(th.title); setArmedDeleteId(null); }} title={t("Rename")} aria-label={t("Rename chat")}>✎</button>
                              {armedDeleteId === th.id
                                ? <button type="button" className="mm-chat-act mm-chat-del" onClick={() => void deleteThread(th.id)} title={t("Tap to confirm")}>{t("Delete?")}</button>
                                : <button type="button" className="mm-chat-act" onClick={() => armDelete(th.id)} title={t("Delete")} aria-label={t("Delete chat")}>🗑</button>}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mm-home-links">
                <button type="button" onClick={() => go("/web/studio")}>{t("Studio")}</button>
                <button type="button" onClick={() => go("/web/archive")}>{t("Gallery")}</button>
                <button type="button" onClick={() => go(mode === "casual" ? "/web" : "/web/channels")}>{mode === "casual" ? t("Home") : t("Social")}</button>
              </div>
            </div>
          )}
          {!atHome && (<>
          <div className="mm-list" ref={listRef} role="log" aria-live="polite" aria-relevant="additions">
            {msgs.map((m, i) => (
              <div key={i} className={`mm-row ${m.role}`}>
                {editingIdx === i && m.role === "user" ? (
                  <div className="mm-edit">
                    <textarea value={editText} autoFocus onChange={(e) => setEditText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } else if (e.key === "Escape") setEditingIdx(null); }} aria-label={t("Edit your message")} />
                    <div className="mm-edit-btns">
                      <button type="button" className="mm-edit-cancel" onClick={() => setEditingIdx(null)}>{t("Cancel")}</button>
                      <button type="button" className="mm-edit-save" onClick={saveEdit} disabled={!editText.trim()}>{t("Send")}</button>
                    </div>
                  </div>
                ) : (
                  <div className={`mm-msg ${m.role}`}>{m.role === "assistant" ? renderRich(m.content) : m.content}</div>
                )}
                {m.media && m.media.length > 0 && (
                  <div className="mm-media">
                    {m.media.map((md, j) => (
                      md.type === "VIDEO_AD"
                        ? <video key={j} src={md.url} className="mm-media-item" controls playsInline preload="metadata" />
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
                {m.makes && m.makes.length === 1 && (
                  <button type="button" className="mm-make mm-make-go" disabled={making} onClick={() => runMakes(m.makes!)}>
                    <span>{making ? t("Working…") : t("✨ {label}", { label: m.makes[0].label })}</span>
                    <b>{m.makes[0].cost > 0 ? t("{n} tokens →", { n: m.makes[0].cost }) : t("Free →")}</b>
                  </button>
                )}
                {m.makes && m.makes.length > 1 && (
                  <div className="mm-makeq">
                    <ul className="mm-makeq-list">{(() => { const specs = m.makes!; return specs.every((x) => x.label === specs[0].label) ? <li>{t("{label} ×{n}", { label: specs[0].label, n: specs.length })}</li> : specs.map((x, k) => <li key={k}>{x.label}</li>); })()}</ul>
                    <button type="button" className="mm-make mm-make-go" disabled={making} onClick={() => runMakes(m.makes!)}>
                      <span>{making ? t("Working…") : t("✨ Make all {n}", { n: m.makes.length })}</span>
                      <b>{(() => { const tot = m.makes!.reduce((s, x) => s + (x.cost || 0), 0); return tot > 0 ? t("{n} tokens →", { n: tot }) : t("Free →"); })()}</b>
                    </button>
                  </div>
                )}
                {m.actions && m.actions.length > 0 && (
                  <div className="mm-acts">{m.actions.map((a) => <button key={a.to + a.label} type="button" className="mm-act" onClick={() => go(a.to)}>{a.label}</button>)}</div>
                )}
                {/* Contextual next-step chips — only under the LATEST reply, and
                    only while idle, so old turns don't keep stale suggestions. */}
                {m.followups && m.followups.length > 0 && i === msgs.length - 1 && !busy && !making && (
                  <div className="mm-chips mm-followups">{m.followups.map((f) => <button key={f} type="button" onClick={() => send(f)}>{f}</button>)}</div>
                )}
                {/* Message actions — copy any reply, regenerate the last one, edit your last message. */}
                {m.role === "assistant" && m.content && editingIdx === null && (
                  <div className="mm-msgacts">
                    <button type="button" className="mm-msgact" onClick={() => copyText(m.content, i)}>{copiedIdx === i ? t("Copied ✓") : t("Copy")}</button>
                    {i === msgs.length - 1 && !busy && !making && <button type="button" className="mm-msgact" onClick={regenerate}>{t("↻ Try again")}</button>}
                  </div>
                )}
                {m.role === "user" && i === lastUserIdx && editingIdx === null && !busy && !making && (
                  <div className="mm-msgacts mm-msgacts-user">
                    <button type="button" className="mm-msgact" onClick={() => startEdit(i)}>{t("✎ Edit")}</button>
                  </div>
                )}
              </div>
            ))}
            {busy && (!msgs.length || msgs[msgs.length - 1].role !== "assistant" || !msgs[msgs.length - 1].content) && (
              streamStatus
                ? <div className="mm-msg assistant mm-status" aria-live="polite"><img className="mm-run-gif" src="/helpurr-run.gif?v=walk5" alt="" aria-hidden="true" /><span className="mm-status-tx">{streamStatus}</span></div>
                : <div className="mm-msg assistant mm-think-bubble" aria-label={t("Helpurr is thinking…")} aria-live="polite"><img className="mm-run-gif" src="/helpurr-run.gif?v=walk5" alt="" aria-hidden="true" /><span className="mm-typing" aria-hidden="true"><i /><i /><i /></span></div>
            )}
            {making && !busy && <div className="mm-making" aria-live="polite"><span className="mm-making-dots"><i /><i /><i /></span>{t("still working on it — hang tight…")}</div>}
            {msgs.length <= 1 && !busy && (
              <div className="mm-chips">{chips.map((c) => <button key={c} type="button" onClick={() => send(c)}>{c}</button>)}</div>
            )}
          </div>
          {(attach.length > 0 || uploading) && (
            <div className="mm-attach">
              {attach.map((p) => (
                <span key={p.url} className="mm-attach-item">
                  <img src={p.url} alt={p.name} className="mm-attach-thumb" />
                  <button type="button" className="mm-attach-x" onClick={() => removeAttach(p.url)} aria-label={t("Remove photo")}>×</button>
                </span>
              ))}
              {uploading && <span className="mm-attach-up">{t("Uploading…")}</span>}
            </div>
          )}
          <form className="mm-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => pickPhoto(e.target.files)} />
            <button type="button" className="mm-clip" onClick={() => fileRef.current?.click()} disabled={busy || uploading} aria-label={t("Attach a photo")} title={t("Attach a photo")}>📎</button>
            <textarea ref={inputRef} rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={taKeyDown} placeholder={attach.length ? t("Describe the edit, or just send…") : t("Ask Helpurr…")} aria-label={t("Message Helpurr")} />
            {busy
              ? <button type="button" className="mm-stop" onClick={() => abortRef.current?.abort()} aria-label={t("Stop")} title={t("Stop")}>■</button>
              : <button type="submit" disabled={uploading || (!input.trim() && !attach.length)} aria-label={t("Send")}>➤</button>}
          </form>
          </>)}
          </div>
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
@media (prefers-reduced-motion:reduce){.wb::before,.wb::after{animation:none}}
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
.wb a:focus-visible,.wb button:focus-visible,.wb input:focus-visible,.wb select:focus-visible,.wb textarea:focus-visible,.wb [tabindex]:focus-visible{
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
/* Content-type picker: fixed 4-col so the two flagship cards (span 2) make a
 * clean top row of 2 big + a row of 4 under — no empty "void" from 6 cards in
 * an auto-fill row. Mobile falls to 2-col below, where a flagship spans full. */
.ws-ctgrid{grid-template-columns:repeat(4,minmax(0,1fr));}
.ws-ctgrid .ws-tile-flag{grid-column:span 2;}
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
/* Content-type picker only: even, scannable cards. The description clamps to 2
 * lines AND reserves that height, so a long sub can't tower one card over its
 * row-mate (the old ragged grid). Scoped to .ws-ctgrid — format/style grids
 * keep their full-wrap descriptions. */
.ws-ctgrid .ws-tile-sub{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.9em;padding-bottom:2px;}
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
  /* Mobile: the two flagship cards do NOT span full-width. A full-width square
   * flagship (span 2 + 1:1 art) is a near-full-screen card, so two of them
   * stacked read as a doomscroll inside the picker's scroll box. On a phone all
   * six content types sit in an even 2-col grid (flagships still lead, by
   * position) — the span-2 "two big" treatment is a desktop-only enhancement. */
  .ws-ctgrid .ws-tile-flag{grid-column:span 1;}
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
/* FULL-PAGE Claude-style chat — a left sidebar of chats + a main column — that
   EMERGES from the home with a soft bloom. EasyMode cream + gold rosettes. */
.mm-panel.mm-max{top:0;left:0;right:0;bottom:0;margin:auto;width:min(1280px,96vw);height:min(94vh,980px);
  border-radius:20px;flex-direction:row;overflow:hidden;animation:mmEmerge .36s cubic-bezier(.2,.9,.3,1) both;}
@keyframes mmEmerge{from{opacity:0;transform:scale(.975)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.mm-panel.mm-max{animation:none}}
.mm-side{flex:0 0 266px;min-width:0;display:flex;flex-direction:column;min-height:0;position:relative;overflow:hidden;
  background:linear-gradient(180deg,#F6F2E6,#EFEBDC);border-right:1px solid var(--line2);}
.mm-side::before{content:"";position:absolute;top:-40px;right:-58px;width:252px;height:252px;pointer-events:none;opacity:.16;background:url(/gstyle-rosette.svg) center/contain no-repeat;}
.mm-side::after{content:"";position:absolute;bottom:-70px;left:-66px;width:214px;height:214px;pointer-events:none;opacity:.11;background:url(/gstyle-rosette.svg) center/contain no-repeat;}
.mm-side-brand{display:flex;align-items:center;gap:8px;padding:15px 16px 10px;position:relative;z-index:1;}
.mm-side-crest{width:30px;height:30px;}
.mm-side-word{font-family:Poppins,sans-serif;font-weight:800;font-size:17px;color:var(--ink);}
.mm-side-word b{color:var(--gold);}
.mm-side-new{margin:2px 12px 10px;padding:10px 13px;border:1px solid var(--green);border-radius:12px;background:var(--card);color:var(--green);font:inherit;font-weight:800;font-size:13px;cursor:pointer;text-align:left;position:relative;z-index:1;transition:background .14s,color .14s;}
.mm-side-new:hover{background:var(--green);color:#fff;}
.mm-side-list{flex:1;min-height:0;overflow-y:auto;padding:4px 8px;display:flex;flex-direction:column;gap:2px;position:relative;z-index:1;scrollbar-width:thin;}
.mm-side-group{display:flex;flex-direction:column;gap:2px;}
.mm-side-group + .mm-side-group{margin-top:9px;}
.mm-side-group-h{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2);opacity:.72;padding:4px 10px 3px;}
.mm-side-chat{display:flex;align-items:center;min-width:0;max-width:100%;border-radius:10px;transition:background .12s;}
.mm-side-chat:hover{background:rgba(12,122,70,.08);}
.mm-side-chat.on{background:rgba(12,122,70,.15);}
.mm-side-chat-main{flex:1;min-width:0;text-align:left;background:none;border:0;cursor:pointer;font:inherit;padding:9px 10px;}
.mm-side-chat-tx{display:block;font-size:12.5px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mm-side-chat-acts{display:flex;align-items:center;gap:1px;padding-right:5px;opacity:0;transition:opacity .12s;}
.mm-side-chat:hover .mm-side-chat-acts,.mm-side-chat:focus-within .mm-side-chat-acts{opacity:1;}
.mm-side-chat-rename{flex:1;min-width:0;margin:4px;padding:5px 8px;border:1.5px solid var(--green);border-radius:8px;font:inherit;font-size:12.5px;font-weight:600;color:var(--ink);background:#fff;outline:none;}
.mm-side-foot-btn{margin:8px 12px 12px;padding:8px 12px;border:1px solid var(--line2);border-radius:11px;background:var(--card);color:var(--ink2);font:inherit;font-weight:700;font-size:12.5px;cursor:pointer;text-align:left;position:relative;z-index:1;transition:border-color .14s,color .14s;}
.mm-side-foot-btn:hover{border-color:var(--green);color:var(--ink);}
.mm-maincol{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;background:linear-gradient(180deg,#FEFDF9,#F7F3E9);}
/* Full-page chrome is LIGHT so the header blends into the cream sidebar + chat
   instead of a dark-green bar that cuts off at the seam. Green stays an accent
   (New chat, active chat, send, user bubbles). */
.mm-panel.mm-max .mm-head{background:#FBF8EE;color:var(--ink);border-bottom:1px solid var(--line2);padding:12px 16px;}
.mm-panel.mm-max .mm-head-txt b{color:var(--ink);}
.mm-panel.mm-max .mm-head-txt span{color:var(--ink2);}
.mm-panel.mm-max .mm-expand,.mm-panel.mm-max .mm-homebtn,.mm-panel.mm-max .mm-x,.mm-panel.mm-max .mm-side-toggle{color:var(--ink2);}
.mm-panel.mm-max .mm-expand:hover,.mm-panel.mm-max .mm-homebtn:hover,.mm-panel.mm-max .mm-x:hover,.mm-panel.mm-max .mm-side-toggle:hover{color:var(--ink);background:rgba(20,32,26,.06);}
.mm-panel.mm-max .mm-input{background:#FBF8EE;border-top:1px solid var(--line2);}
.mm-panel.mm-max .mm-maincol .mm-list{padding-left:max(18px,calc((100% - 720px)/2));padding-right:max(18px,calc((100% - 720px)/2));}
.mm-panel.mm-max .mm-maincol .mm-input{padding-left:max(14px,calc((100% - 720px)/2));padding-right:max(14px,calc((100% - 720px)/2));}
.mm-panel.mm-max .mm-home-recent{display:none;} /* the sidebar lists the chats */
.mm-panel.mm-max .mm-head-crest{display:none;}   /* the sidebar carries the brand */
.mm-side-toggle{display:none;background:none;border:0;font-size:18px;line-height:1;cursor:pointer;color:rgba(244,234,200,.92);padding:2px 8px;border-radius:7px;margin-right:2px;}
.mm-side-scrim{display:none;}
/* Sidebar becomes a slide-in drawer when there isn't room for it beside the chat. */
@media(max-width:820px){
  /* Pin to the top-left and DROP the base rule's margin:auto + bottom:0. On iOS
     Safari that centering (an explicit height inside inset:0) pushes the fixed
     panel's top — the whole header, with the × close — above the visible
     viewport, leaving the user trapped in the chat with no way out. top:0 +
     bottom:auto + margin:0 keeps the header on screen; 100dvh fits the rest. */
  .mm-panel.mm-max{top:0;left:0;right:0;bottom:auto;margin:0;width:100vw;height:100vh;height:100dvh;border-radius:0;}
  .mm-side{position:absolute;top:0;bottom:0;left:0;z-index:4;width:272px;flex-basis:272px;transform:translateX(-102%);transition:transform .22s cubic-bezier(.2,.8,.3,1);box-shadow:0 0 44px rgba(10,20,14,.34);}
  .mm-panel.mm-side-open .mm-side{transform:none;}
  .mm-side-scrim{display:block;position:absolute;inset:0;z-index:3;background:rgba(10,20,14,.42);animation:mmFade .18s both;}
  .mm-side-toggle{display:inline-grid;place-items:center;}
  .mm-panel.mm-max .mm-maincol .mm-list,.mm-panel.mm-max .mm-maincol .mm-input{padding-left:14px;padding-right:14px;}
}
/* HOME — the dedicated Helpurr landing surface (Google-homepage energy, EasyMode
   skin): centered wordmark + big ask bar + quick-start cards + your saved chats.
   Fills the maximized panel under the header and scrolls if it needs to. */
.mm-home{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:22px;
  padding:clamp(20px,5vh,46px) clamp(16px,6%,56px) 28px;background:radial-gradient(130% 78% at 50% 0,#FEFDF9,#F2EFE4 80%);}
.mm-home-perf{width:min(560px,100%);align-self:center;display:flex;flex-direction:column;gap:10px;
  background:linear-gradient(135deg,rgba(18,168,94,.1),rgba(176,133,38,.1));border:1px solid rgba(12,122,70,.28);
  border-radius:16px;padding:14px 15px;box-shadow:0 6px 20px rgba(12,122,70,.1);}
.mm-home-perf-tx{margin:0;font-size:13.5px;line-height:1.4;color:var(--ink);font-weight:600;}
.mm-home-perf-btn{width:100%;}
.mm-home-hero{display:flex;flex-direction:column;align-items:center;text-align:center;}
.mm-home-crest{width:74px;height:74px;display:grid;place-items:center;filter:drop-shadow(0 7px 15px rgba(12,122,70,.22));}
.mm-home-word{font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(30px,6vw,44px);color:var(--ink);margin:6px 0 2px;letter-spacing:-.01em;line-height:1;}
.mm-home-word b{color:var(--gold);font-weight:800;}
.mm-home-sub{font-size:14px;color:var(--ink2);margin:0 0 20px;}
.mm-home-greet{font-family:Poppins,sans-serif;font-size:18px;font-weight:600;color:var(--ink);margin:2px 0 16px;}
.mm-home-ask{display:flex;align-items:flex-end;gap:8px;width:min(560px,100%);background:var(--card);
  border:1.5px solid var(--line2);border-radius:24px;padding:6px 7px 6px 15px;
  box-shadow:0 8px 26px rgba(12,122,70,.1),0 2px 6px rgba(20,32,26,.05);transition:border-color .14s,box-shadow .14s;}
.mm-home-ask:focus-within{border-color:var(--green);box-shadow:0 10px 30px rgba(12,122,70,.18);}
.mm-home-ask>textarea{flex:1;border:0;background:none;outline:none;font:inherit;font-size:16px;color:var(--ink);min-width:0;resize:none;line-height:1.4;max-height:120px;overflow-y:auto;padding:9px 0;display:block;}
.mm-home-ask>textarea::placeholder{color:#97a19a;}
.mm-home-clip{flex:0 0 auto;background:none;border:0;font-size:17px;cursor:pointer;opacity:.7;padding:4px;border-radius:8px;line-height:1;}
.mm-home-clip:hover:not(:disabled){opacity:1;background:rgba(12,122,70,.08);}
.mm-home-send{flex:0 0 auto;width:40px;height:40px;border-radius:50%;border:0;cursor:pointer;color:#fff;font-size:15px;
  background:linear-gradient(135deg,var(--green2) 40%,var(--green));box-shadow:0 3px 10px rgba(12,122,70,.3);transition:filter .12s,transform .12s;}
.mm-home-send:hover:not(:disabled){filter:brightness(1.07);transform:translateY(-1px);}
.mm-home-send:disabled{opacity:.42;cursor:default;}
.mm-home-attach{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-top:10px;font-size:12px;color:var(--ink2);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px;}
.mm-home-attach-item{position:relative;flex:0 0 auto;line-height:0;}
.mm-home-attach img{width:34px;height:34px;border-radius:7px;object-fit:cover;display:block;}
.mm-home-attach-item button{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:0;background:#4A554E;color:#fff;font-size:12px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.3);}
.mm-home-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:min(560px,100%);margin-top:22px;}
.mm-home-card{display:flex;align-items:center;gap:11px;min-width:0;text-align:left;cursor:pointer;
  background:var(--card);border:1px solid var(--line2);border-radius:15px;padding:12px 13px;transition:border-color .14s,transform .12s,box-shadow .14s;}
.mm-home-card:hover:not(:disabled){border-color:var(--green);transform:translateY(-2px);box-shadow:0 8px 20px rgba(12,122,70,.12);}
.mm-home-card:disabled{opacity:.55;cursor:default;}
.mm-home-card-ic{flex:0 0 auto;width:38px;height:38px;display:grid;place-items:center;border-radius:11px;font-size:19px;background:linear-gradient(140deg,rgba(18,168,94,.14),rgba(176,133,38,.14));}
.mm-home-card-tx{display:flex;flex-direction:column;gap:1px;min-width:0;}
.mm-home-card-tx b{font-weight:800;font-size:13.5px;color:var(--ink);}
.mm-home-card-tx i{font-style:normal;font-size:11.5px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mm-home-recent{width:min(560px,100%);margin:4px auto 0;}
.mm-home-recent-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;}
.mm-home-recent-h span{font-weight:800;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink2);}
.mm-home-recent-h button{border:0;background:none;color:var(--green);font-weight:800;font-size:12.5px;cursor:pointer;padding:4px 7px;border-radius:8px;}
.mm-home-recent-h button:hover{background:rgba(12,122,70,.08);}
.mm-home-chats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}
.mm-home-chat{display:flex;align-items:stretch;min-width:0;overflow:hidden;
  background:rgba(253,252,247,.7);border:1px solid var(--line);border-radius:12px;transition:border-color .14s,background .14s;}
.mm-home-chat:hover{border-color:var(--green);background:var(--card);}
.mm-home-chat.on{border-color:var(--green);background:var(--card);box-shadow:inset 0 0 0 1px rgba(12,122,70,.3);}
.mm-home-chat-main{flex:1;min-width:0;display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer;background:none;border:0;padding:9px 11px;font:inherit;}
.mm-home-chat-ic{flex:0 0 auto;font-size:14px;opacity:.75;}
.mm-home-chat-tx{font-weight:700;font-size:12.5px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mm-home-chat-acts{display:flex;align-items:center;gap:1px;padding-right:4px;opacity:.5;transition:opacity .12s;}
.mm-home-chat:hover .mm-home-chat-acts,.mm-home-chat:focus-within .mm-home-chat-acts{opacity:1;}
.mm-chat-act{border:0;background:none;cursor:pointer;font-size:12px;padding:5px 6px;border-radius:7px;color:var(--ink2);line-height:1;}
.mm-chat-act:hover{background:rgba(12,122,70,.12);}
.mm-chat-del{color:#B23B3B;font-size:10.5px;font-weight:800;white-space:nowrap;}
.mm-chat-del:hover{background:rgba(178,59,59,.13);}
.mm-home-chat-rename{flex:1;min-width:0;border:1.5px solid var(--green);border-radius:9px;margin:4px;padding:5px 8px;font:inherit;font-size:12.5px;font-weight:700;color:var(--ink);background:#fff;outline:none;}
.mm-home-links{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:2px;}
.mm-home-links button{border:1px solid var(--line2);background:var(--card);color:var(--ink2);font-weight:700;font-size:12.5px;cursor:pointer;padding:7px 15px;border-radius:999px;transition:border-color .14s,color .14s;}
.mm-home-links button:hover{border-color:var(--green);color:var(--ink);}
@media(max-width:620px){.mm-home{padding:24px 16px;gap:18px;}.mm-home-cards{grid-template-columns:1fr;}
  .mm-home-send,.mm-home-clip{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;}
  .mm-home-links button,.mm-home-recent-h button{min-height:44px;display:inline-flex;align-items:center;}
  .mm-chat-act{min-width:44px;min-height:44px;}}
.mm-expand{margin-left:auto;background:none;border:0;color:rgba(244,234,200,.82);font-size:15px;line-height:1;cursor:pointer;padding:3px 7px;border-radius:7px;}
.mm-expand:hover{color:#fff;background:rgba(255,255,255,.12);}
.mm-homebtn{background:none;border:0;font-size:14px;line-height:1;cursor:pointer;padding:3px 7px;border-radius:7px;opacity:.85;}
.mm-homebtn:hover{opacity:1;background:rgba(255,255,255,.12);}
.mm-head{display:flex;align-items:center;gap:10px;padding:13px 14px;background:linear-gradient(168deg,#0E5233,#0A3421);color:#F4EAC8;}
.mm-head-crest{width:42px;height:42px;flex:0 0 auto;overflow:visible;}
.mm-head-txt{display:flex;flex-direction:column;line-height:1.2;min-width:0;}
.mm-head-txt b{font-family:Poppins,sans-serif;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mm-head-txt span{font-size:11px;color:rgba(244,234,200,.72);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.mm-x{margin-left:2px;background:none;border:0;color:rgba(244,234,200,.85);font-size:23px;line-height:1;cursor:pointer;padding:2px 5px;}
.mm-x:hover{color:#fff;}
/* Chat tabs (projects) — a scrollable chip row under the header. */
.mm-tabs{display:flex;gap:5px;align-items:center;padding:7px 9px;background:#F3F0E4;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none;}
.mm-tabs::-webkit-scrollbar{display:none;}
.mm-tab{flex:0 0 auto;max-width:132px;font:inherit;font-size:11.5px;font-weight:700;color:var(--ink2);background:#fff;border:1px solid var(--line);border-radius:999px;padding:5px 11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s,color .12s,border-color .12s;}
.mm-tab:hover{border-color:var(--green2);}
.mm-tab.on{background:linear-gradient(135deg,#12A85E,#0B6B3E);color:#fff;border-color:transparent;}
.mm-tab-new{font-size:15px;font-weight:800;color:var(--green);padding:4px 10px;line-height:1;}
.mm-list{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 14px 24px;display:flex;flex-direction:column;gap:9px;scrollbar-width:thin;}
.mm-msg{max-width:84%;padding:9px 13px;border-radius:15px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;}
.mm-msg.assistant{align-self:flex-start;background:#fff;border:1px solid var(--line);color:var(--ink);border-bottom-left-radius:5px;}
.mm-msg.user{align-self:flex-end;background:linear-gradient(168deg,#12A85E,#0B6B3E);color:#fff;border-bottom-right-radius:5px;}
.mm-row{display:flex;flex-direction:column;gap:7px;}
.mm-row.user{align-items:flex-end;}
.mm-row.assistant{align-items:flex-start;}
/* Rich inline bits: clickable links, inline code, fenced code blocks. */
.mm-msg a.mm-link{color:var(--green);font-weight:700;text-decoration:underline;text-underline-offset:2px;overflow-wrap:anywhere;}
.mm-msg a.mm-link:hover{color:var(--green2);}
.mm-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;background:rgba(12,122,70,.08);border:1px solid rgba(12,122,70,.15);border-radius:5px;padding:1px 5px;overflow-wrap:anywhere;}
.mm-pre{margin:6px 0;background:#10201A;color:#EAF4EE;border-radius:11px;padding:11px 13px;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre;max-width:100%;}
.mm-pre code{font:inherit;background:none;border:0;padding:0;color:inherit;}
/* Per-message actions: copy any reply, regenerate the last, edit your last message. */
.mm-msgacts{display:flex;gap:3px;align-items:center;margin-top:-2px;opacity:.6;transition:opacity .12s;}
.mm-row:hover .mm-msgacts{opacity:1;}
.mm-msgacts-user{justify-content:flex-end;}
.mm-msgact{border:0;background:none;cursor:pointer;font:inherit;font-size:11px;font-weight:700;color:var(--ink2);padding:3px 8px;border-radius:8px;line-height:1;white-space:nowrap;}
.mm-msgact:hover{background:rgba(12,122,70,.1);color:var(--ink);}
.mm-edit{width:84%;align-self:flex-end;display:flex;flex-direction:column;gap:7px;}
.mm-edit textarea{width:100%;border:1.5px solid var(--green);border-radius:14px;padding:9px 12px;font:inherit;font-size:13.5px;line-height:1.45;color:var(--ink);background:#fff;outline:none;resize:vertical;min-height:62px;box-sizing:border-box;}
.mm-edit-btns{display:flex;gap:7px;justify-content:flex-end;}
.mm-edit-cancel,.mm-edit-save{border:0;cursor:pointer;font:inherit;font-size:12px;font-weight:800;padding:7px 14px;border-radius:10px;}
.mm-edit-cancel{background:rgba(20,32,26,.07);color:var(--ink2);}
.mm-edit-save{background:linear-gradient(135deg,var(--green2) 40%,var(--green));color:#fff;}
.mm-edit-save:disabled{opacity:.5;cursor:default;}
/* Inline media Helpurr shows (real creations from the Archive). */
.mm-media{display:flex;flex-wrap:wrap;gap:8px;max-width:92%;margin-top:2px;}
.mm-media-link{display:block;flex:0 0 auto;line-height:0;}
.mm-media-item{max-width:210px;max-height:260px;width:auto;height:auto;border-radius:12px;border:1px solid var(--line,#E4DFCF);display:block;}
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
.mm-makeq{display:flex;flex-direction:column;gap:7px;width:92%;}
.mm-makeq .mm-make{width:100%;}
.mm-makeq-list{list-style:none;margin:0;padding:8px 11px;display:flex;flex-direction:column;gap:3px;
  background:rgba(12,122,70,.06);border:1px solid rgba(12,122,70,.16);border-radius:11px;font-size:12px;color:#2A3B32;}
.mm-makeq-list li{display:flex;align-items:center;gap:7px;overflow-wrap:anywhere;}
.mm-makeq-list li::before{content:"✨";font-size:11px;flex:0 0 auto;opacity:.85;}
.mm-typing{display:flex;gap:4px;align-items:center;}
.mm-typing i{width:7px;height:7px;border-radius:50%;background:#9CCBB1;animation:mmBlink 1.2s infinite both;}
.mm-typing i:nth-child(2){animation-delay:.2s}.mm-typing i:nth-child(3){animation-delay:.4s}
@keyframes mmBlink{0%,60%,100%{opacity:.3}30%{opacity:1}}
@media (prefers-reduced-motion:reduce){.mm-typing i{animation:none;opacity:.6}}
/* THINKING = Helpurr RUNNING (a looping 4-frame side-profile run sprite, legs
   cycling) beside a soft dots cue — he's off doing it, not three dead dots. */
.mm-think-bubble{display:inline-flex;align-items:center;gap:9px;padding:7px 12px;}
.mm-run-gif{width:56px;height:auto;flex:0 0 auto;image-rendering:pixelated;}
.mm-status-tx{min-width:0;}
/* The "still making" line during the long make poll — so a 2-6 min render never
   looks frozen. A soft shimmer pill with the typing dots. */
.mm-making{display:flex;align-items:center;gap:8px;align-self:flex-start;max-width:92%;margin-top:2px;font-size:12.5px;color:var(--ink2);background:#F3F0E4;border:1px solid var(--line);border-radius:12px;padding:8px 12px;}
.mm-making-dots{display:flex;gap:4px;}
.mm-making-dots i{width:6px;height:6px;border-radius:50%;background:#12A85E;animation:mmBlink 1.2s infinite both;}
.mm-making-dots i:nth-child(2){animation-delay:.2s}.mm-making-dots i:nth-child(3){animation-delay:.4s}
@media (prefers-reduced-motion:reduce){.mm-making-dots i{animation:none;opacity:.6}}
.mm-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;}
.mm-chips button{font:inherit;font-size:12px;font-weight:600;color:var(--green);background:#EAF6EF;border:1px solid #BFE2CD;border-radius:999px;padding:6px 11px;cursor:pointer;}
.mm-chips button:hover{background:#DCF0E5;}
.mm-input{display:flex;gap:8px;padding:11px;border-top:1px solid var(--line);background:var(--card);align-items:flex-end;}
.mm-input textarea{flex:1;border:1px solid var(--line2);border-radius:18px;padding:8px 15px;font:inherit;font-size:16px;background:#fff;color:var(--ink);outline:none;resize:none;line-height:1.35;min-height:42px;max-height:132px;overflow-y:auto;box-sizing:border-box;scrollbar-width:thin;}
.mm-input textarea:focus{border-color:var(--green);}
.mm-input textarea::placeholder{color:#97a19a;}
.mm-input input:focus{border-color:var(--green2);}
.mm-input button{flex:0 0 auto;width:42px;height:42px;display:grid;place-items:center;border:0;border-radius:50%;background:linear-gradient(168deg,#12A85E,#0B6B3E);color:#fff;font-size:14px;cursor:pointer;}
.mm-input button:disabled{opacity:.4;cursor:not-allowed;}
/* Attach-a-photo: a flat icon button (overrides the green send circle) + a preview chip. */
.mm-input .mm-clip{width:38px;background:transparent;color:var(--ink2);font-size:18px;line-height:1;box-shadow:none;}
.mm-input .mm-clip:hover:not(:disabled){background:var(--paper2,#EFEBDD);color:var(--ink);}
.mm-input .mm-stop{background:var(--ink,#14201A);font-size:12px;}
.mm-status{font-style:italic;opacity:.92;display:inline-flex;align-items:center;gap:8px;}
.mm-status-dot{width:8px;height:8px;border-radius:50%;background:#12A85E;animation:mmBlink 1s infinite both;flex:0 0 auto;}
.mm-attach{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--line);background:#F3F0E4;}
.mm-attach-item{position:relative;flex:0 0 auto;line-height:0;}
.mm-attach-thumb{width:46px;height:46px;object-fit:cover;border-radius:9px;border:1px solid var(--line2);display:block;}
.mm-attach-name{font-size:12px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
.mm-attach-x{position:absolute;top:-7px;right:-7px;width:20px;height:20px;min-width:0;min-height:0;border:0;border-radius:50%;background:#4A554E;color:#fff;font-size:12px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.35);}
.mm-attach-x:hover{background:#2f3833;}
.mm-attach-up{font-size:12px;color:var(--ink2);font-style:italic;}
@media(max-width:620px){.mm-fab{bottom:30px;right:16px;width:56px;height:56px}.mm-panel{bottom:92px;right:16px;height:72vh}
  .mm-panel.mm-max{top:0;left:0;right:0;bottom:0;margin:0;width:100vw;height:100vh;height:100dvh;border-radius:0}
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
  .mm-expand{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center}
  .mm-attach-x{width:24px;height:24px}
  .mm-tab{min-height:44px;display:inline-flex;align-items:center}
  .mm-chips button{min-height:44px;display:inline-flex;align-items:center}
  .mm-act{min-height:44px;display:inline-flex;align-items:center}
  .mm-make{min-height:44px}
  .mm-input input{min-height:44px}
  .mm-input button{min-width:44px;min-height:44px}
}
`;
