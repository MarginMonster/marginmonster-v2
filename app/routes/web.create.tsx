/* Create — a chat-driven free-roam creation surface (route /web/create).
 *
 * This REPLACES the old redirect-to-Studio stub. It's a Helpurr-driven image
 * hub: the user CHATS with Helpurr (left column) to make & edit images, and the
 * newest finished image is shown LARGE on a Stage canvas (right column, like the
 * Studio's Easel). The thread saves via the existing api.buddy backend.
 *
 * NON-DESTRUCTIVE: this file only. It REUSES api.buddy's backend as-is over
 * fetch — the exact same GET (history + proactive opener), POST chat (SSE),
 * intent:"make" (spend + enqueue) and intent:"makeStatus" (poll) contract the
 * floating Buddy in web.tsx uses. Nothing in web.studio.tsx, web.tsx's Buddy, or
 * api.buddy.tsx is touched. Uses mode "casual" (free-roam) and thread "main".
 *
 * The chat logic (SSE frame parsing, the make/poll flow, inline media rendering)
 * is ported — minimally and self-contained — from web.tsx's Buddy component. The
 * look mirrors web.studio.tsx's .ws-easel / .ws-stage CSS and the shell's
 * green-on-cream vars (injected here as a scoped CREATE_STYLE block). Helpurr
 * handles all the dials — there are deliberately NO Frame/Model/style pickers. */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useOutletContext } from "@remix-run/react";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { readUiLang } from "../lib/ui-i18n";
import { useT } from "../lib/ui-lang";
import { tokensRemainingLive } from "../lib/tokens.server";
import { resolveTierKey, PLAN_BY_KEY } from "../lib/plan-config";
import { Familiar } from "../components/Familiar";
import { Ico } from "../lib/icons";

export const meta = () => [{ title: "Create · EasyMode" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Auth (redirect to /web/login if not signed in) — mirrors web.studio.tsx's loader top.
  const { account, shop } = await requireWebIdentity(request);
  readUiLang(request); // keep the loader cookie-aware like the other /web routes
  const plan = shop.activePlan;
  // Derive the plan's display name the same way api.buddy's contextLine does
  // (there's no shared planTierName helper).
  const tier = plan?.active ? resolveTierKey(plan.type) : null;
  const tierName = tier ? PLAN_BY_KEY[tier].name : "";
  const name = account.name?.trim() || account.email.split("@")[0];
  return json({
    name,
    firstName: name.split(" ")[0],
    tokens: tokensRemainingLive(plan),
    hasPlan: !!plan?.active,
    tierName,
  });
};

// ── Mirrors of the api.buddy shapes the Buddy widget uses (kept local so this
// route is fully self-contained). ────────────────────────────────────────────
type CAction = { label: string; to: string };
type CPending = { label: string; to: string; cost: number; kind: string };
type CMedia = { url: string; type: string; title?: string };
type CMake = {
  kind: "image" | "video" | "faceless" | "music" | "edit" | "create";
  product: string; topic?: string; format?: string; voice?: string;
  sourceImageUrl?: string; editOp?: string; presenter: boolean; direction: string;
  cost: number; clean?: boolean; label: string;
};
type CMsg = {
  role: "user" | "assistant"; content: string;
  actions?: CAction[]; pending?: CPending; media?: CMedia[]; makes?: CMake[]; followups?: string[];
};

// The newest image on the Stage (hero). We hold the url + an aspect ratio string
// ("w / h") captured from the loaded image, so the frame sizes responsively.
type Hero = { url: string; type: string; title?: string; aspect?: string };

// Light-markdown bubble rendering — a trimmed port of web.tsx's renderRich:
// **bold**, `inline code`, bullet lines, and bare URLs → safe anchors. Enough
// for Helpurr's replies here; code fences are left as plain text (rare in chat).
const URL_RE = /\bhttps?:\/\/[^\s<>]+[^\s<>.,!?;:'"]/g;
function renderInline(s: string, kb: string): ReactNode {
  return s.split(/(`[^`\n]+`)/g).map((part, i) => {
    const code = /^`([^`\n]+)`$/.exec(part);
    if (code) return <code key={kb + "c" + i} className="cc-code">{code[1]}</code>;
    return part.split(/(\*\*[^*\n]+\*\*)/g).map((bp, j) => {
      const b = /^\*\*([^*\n]+)\*\*$/.exec(bp);
      if (b) return <strong key={kb + "b" + i + "-" + j}>{b[1]}</strong>;
      const out: ReactNode[] = []; let last = 0; let m: RegExpExecArray | null; URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(bp)) !== null) {
        if (m.index > last) out.push(bp.slice(last, m.index));
        out.push(<a key={kb + "a" + i + "-" + j + "-" + m.index} href={m[0]} target="_blank" rel="noreferrer noopener" className="cc-link">{m[0]}</a>);
        last = m.index + m[0].length;
      }
      if (last < bp.length) out.push(bp.slice(last));
      return <Fragment key={kb + "t" + i + "-" + j}>{out}</Fragment>;
    });
  });
}
function renderRich(text: string): ReactNode {
  return (text || "").split("\n").map((line, li) => {
    const withBullet = line.replace(/^(\s*)[-*•]\s+/, "$1• ");
    return <Fragment key={li}>{li > 0 ? "\n" : ""}{renderInline(withBullet, String(li))}</Fragment>;
  });
}

const isTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export default function Create() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  // Mirror the other /web routes: read mode from the shell outlet. This surface
  // is free-roam, so it talks to api.buddy in CASUAL mode regardless (the dials
  // are Helpurr's job); we still read the context for parity.
  useOutletContext<{ mode: "marketing" | "casual"; setMode: (m: "marketing" | "casual") => void }>();
  const CHAT_MODE: "casual" = "casual";
  // Client-only mount gate: this JS-heavy chat surface renders a stable shell on
  // the server + the first client paint, then swaps in the live UI after mount —
  // so server and client render the SAME thing during hydration (kills the
  // "Root did not complete" bail this new route was hitting).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [msgs, setMsgs] = useState<CMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);
  const [streamStatus, setStreamStatus] = useState("");
  const [histReady, setHistReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // The Stage hero (newest finished image) + a making/thinking flag for the
  // canvas spinner.
  const [hero, setHero] = useState<Hero | null>(null);

  // Threads — load "main" on mount; show the list as a simple rail. New chat +
  // switch. (Rename/delete are deferred for v1; the floating Buddy owns those.)
  const [threads, setThreads] = useState<Array<{ id: string; title: string; ts?: number }>>([{ id: "main", title: "Main" }]);
  const [activeThreadId, setActiveThreadId] = useState("main");
  const [threadsOpen, setThreadsOpen] = useState(false); // the tidy chats dropdown

  // Photo attach — reuses the SAME free, token-less upload endpoint the Buddy
  // widget uses (/api/buddy-upload → { frameUrl }). Single photo for v1.
  const [attach, setAttach] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const dispTitle = (title: string) => (title === "Main" ? t("Main") : title === "New chat" ? t("New chat") : title);
  const activeThread = threads.find((x) => x.id === activeThreadId);

  // This surface IS the Creator — strip any assistant link that would bounce the
  // user OUT to the old Studio/Create route (e.g. the proactive "Open the Studio"
  // button). Plan/gallery/other links are kept. Everything happens right here.
  const keepLink = (to?: string) => !!to && !/^\/web\/(studio|create)\b/.test(to);

  // Concrete starters shown on a fresh thread — these ARE the instructions. A
  // "make" starter sends a complete prompt (Helpurr then proposes a priced
  // "Make it" button — no surprise spend); "Edit a photo" opens the picker.
  const STARTERS: Array<{ ico: string; label: string; send?: string; pick?: boolean }> = [
    { ico: "image", label: t("Make an image"), send: t("Make an image of a cozy minimalist coffee shop with warm morning light") },
    { ico: "video", label: t("Make a video"), send: t("Make a short 9:16 video of ocean waves rolling in at sunset") },
    { ico: "scissors", label: t("Edit a photo"), pick: true },
    { ico: "bulb", label: t("What can you do?"), send: t("What can you make for me — images, videos, edits?") },
  ];

  // Promote a media array's first IMAGE to the Stage hero. Videos/audio stay in
  // chat only (the canvas is an IMAGE hero). Aspect is captured on <img> load.
  const heroFromMedia = useCallback((media: CMedia[] | undefined) => {
    if (!media || !media.length) return;
    const img = media.find((m) => m.type !== "VIDEO_AD" && m.type !== "AUDIO");
    if (img) setHero({ url: img.url, type: img.type, title: img.title });
  }, []);

  // LOAD the active thread's saved history + the proactive opener, exactly like
  // the Buddy widget: GET /api/buddy?mode=casual&thread=<id>&_=<ts>.
  useEffect(() => {
    let cancelled = false;
    setHistReady(false);
    (async () => {
      try {
        const res = await fetch(`/api/buddy?mode=${CHAT_MODE}&thread=${activeThreadId}&_=${Date.now()}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({ history: [] }))) as {
          history?: Array<{ role?: string; content?: string }>;
          proactive?: { reply?: string; pendingAction?: CPending | null; makes?: CMake[] } | null;
          threads?: Array<{ id: string; title: string; ts?: number }>;
        };
        if (cancelled) return;
        if (Array.isArray(data.threads) && data.threads.length) setThreads(data.threads);
        const hist = (Array.isArray(data.history) ? data.history : [])
          .filter((m) => m && typeof m.content === "string" && m.content.trim())
          .map((m): CMsg => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content as string }));
        const nudge: CMsg | null = data.proactive && data.proactive.reply
          ? { role: "assistant", content: data.proactive.reply, pending: data.proactive.pendingAction || undefined, makes: Array.isArray(data.proactive.makes) && data.proactive.makes.length ? data.proactive.makes : undefined }
          : null;
        setMsgs(hist.length ? (nudge ? [...hist, nudge] : hist) : (nudge ? [nudge] : []));
        // Seed the Stage with the most recent image already in the loaded thread,
        // so returning to a conversation re-shows its latest make on the canvas.
        if (!cancelled) {
          const withMedia = [...(hist as CMsg[])].reverse().find((m) => m.media && m.media.some((x) => x.type !== "VIDEO_AD" && x.type !== "AUDIO"));
          if (withMedia) heroFromMedia(withMedia.media);
        }
      } catch { if (!cancelled) setMsgs([]); }
      finally { if (!cancelled) setHistReady(true); }
    })();
    return () => { cancelled = true; };
  }, [activeThreadId, heroFromMedia]);

  // Fallback greeting if the thread loaded empty (no history + no opener).
  useEffect(() => {
    if (histReady && msgs.length === 0) {
      const greet = d.firstName
        ? t("Hey {name}! I'm Helpurr 🐾 — tell me what to make, or drop a photo to edit. I'll handle the settings.", { name: d.firstName })
        : t("Hey — I'm Helpurr 🐾. Tell me what to make, or drop a photo to edit.");
      setMsgs([{ role: "assistant", content: greet }]);
    }
  }, [histReady, msgs.length, d.firstName, t]);

  // Keep the message list pinned to newest as it grows (only when near bottom).
  const pinBottomRef = useRef(true);
  useEffect(() => { pinBottomRef.current = true; }, [activeThreadId]);
  useEffect(() => {
    const el = listRef.current; if (!el) return;
    if (pinBottomRef.current) { el.scrollTop = el.scrollHeight; pinBottomRef.current = false; }
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, making]);

  // Upload a picked photo to the FREE buddy-upload endpoint; hold the /uploads
  // URL for the next message. No tokens. (Same mechanism as the Buddy widget.)
  const pickPhoto = async (files: FileList | File[] | null | undefined) => {
    const list = files ? Array.from(files) : [];
    const file = list[0];
    if (!file || uploading) return;
    if (!/^image\//.test(file.type)) { setMsgs((m) => [...m, { role: "assistant", content: t("That doesn't look like an image — send a JPG, PNG or WebP.") }]); if (fileRef.current) fileRef.current.value = ""; return; }
    if (file.size > 8 * 1024 * 1024) { setMsgs((m) => [...m, { role: "assistant", content: t("That photo's a bit big — keep it under 8MB.") }]); if (fileRef.current) fileRef.current.value = ""; return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("productPhoto", file);
      const r = await fetch("/api/buddy-upload", { method: "POST", body: fd });
      const data = (await r.json().catch(() => ({}))) as { frameUrl?: string; error?: string };
      if (data.frameUrl) setAttach({ url: data.frameUrl, name: file.name });
      else setMsgs((m) => [...m, { role: "assistant", content: data.error || t("Couldn't upload that photo — mind trying again?") }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: t("Couldn't upload that photo — mind trying again?") }]);
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  // SEND a chat message — ported from Buddy: POST /api/buddy, read SSE frames
  // (text / status / done) or fall back to plain JSON. The done frame carries
  // actions/pendingAction/media/pendingMakes/followups.
  const send = async (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && !attach) || busy || uploading) return;
    const photo = attach;
    const carryPhoto = photo?.url || lastPhoto;
    const userMsg: CMsg = {
      role: "user",
      content: trimmed || (photo ? t("Here's a photo") : ""),
      media: photo ? [{ url: photo.url, type: "IMAGE_AD", title: photo.name }] : undefined,
    };
    const next: CMsg[] = [...msgs, userMsg];
    setMsgs(next); setInput(""); setAttach(null); setBusy(true);
    if (photo) setLastPhoto(photo.url);

    type ReplyData = { reply?: string; actions?: CAction[]; pendingAction?: CPending | null; media?: CMedia[]; pendingMakes?: CMake[] | null; followups?: string[] };
    const finalize = (m: CMsg[], data: ReplyData, content: string): CMsg[] => {
      if (!m.length) return m;
      const copy = [...m]; const last = copy[copy.length - 1];
      if (last.role !== "assistant") return m;
      copy[copy.length - 1] = {
        ...last, content,
        actions: Array.isArray(data.actions) ? data.actions : [],
        pending: data.pendingAction || undefined,
        media: Array.isArray(data.media) && data.media.length ? data.media : undefined,
        makes: Array.isArray(data.pendingMakes) && data.pendingMakes.length ? data.pendingMakes : undefined,
        followups: Array.isArray(data.followups) && data.followups.length ? data.followups : undefined,
      };
      return copy;
    };

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
      const res = await fetch("/api/buddy", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(-40).map(({ role, content }) => ({ role, content })),
          path: "/web/create", mode: CHAT_MODE, threadId: activeThreadId,
          imageUrl: photo?.url, imageUrls: photo ? [photo.url] : undefined,
          lastPhotoUrl: carryPhoto || undefined, tz,
        }),
        signal: controller.signal,
      });
      if ((res.headers.get("content-type") || "").includes("text/event-stream") && res.body) {
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
              let payload: { delta?: string; replace?: boolean; label?: string } & ReplyData;
              try { payload = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
              if (ev === "text") { acc = payload.replace ? (payload.delta || "") : acc + (payload.delta || ""); setStreamStatus(""); patchLast(acc); }
              else if (ev === "status") { setStreamStatus(payload.label || ""); }
              else if (ev === "done") { doneData = payload; }
            }
          }
        } catch { /* aborted or a mid-stream drop — keep whatever streamed */ }
        setStreamStatus("");
        if (doneData) {
          const dd = doneData;
          setMsgs((m) => finalize(m, dd, dd.reply || acc || "…"));
          heroFromMedia(dd.media); // show_work etc. can return media → promote to the Stage
        } else if (!acc) {
          patchLast(t("Connection blipped — mind trying again?"));
        }
      } else {
        const data = (await res.json().catch(() => ({ reply: "" }))) as ReplyData;
        setMsgs((m) => [...m, {
          role: "assistant", content: data.reply || "…",
          actions: Array.isArray(data.actions) ? data.actions : [],
          pending: data.pendingAction || undefined,
          media: Array.isArray(data.media) && data.media.length ? data.media : undefined,
          makes: Array.isArray(data.pendingMakes) && data.pendingMakes.length ? data.pendingMakes : undefined,
          followups: Array.isArray(data.followups) && data.followups.length ? data.followups : undefined,
        }]);
        heroFromMedia(data.media);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: t("Connection blipped — mind trying again?") }]);
    } finally { setBusy(false); setStreamStatus(""); abortRef.current = null; }
  };

  const stop = () => { try { abortRef.current?.abort(); } catch { /* */ } };

  // POLL one enqueued make until the media lands/fails/times out — ported from
  // Buddy's pollMake. A completed IMAGE is dropped inline AND promoted to the
  // Stage hero. (No review pass here; v1 keeps the canvas flow simple.)
  const pollMake = (jobId: string, cursor: number, kind: string, spec: CMake) => new Promise<void>((resolve) => {
    const limit = (kind === "video" || kind === "faceless") ? 72 : kind === "music" ? 36 : 24;
    let tries = 0;
    const tick = async () => {
      tries++;
      try {
        const r = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "makeStatus", jobId, cursor, kind, mode: CHAT_MODE }) });
        const s = (await r.json().catch(() => ({}))) as { done?: boolean; media?: CMedia[]; failed?: boolean; error?: string };
        if (s.failed) { setMsgs((m) => [...m, { role: "assistant", content: s.error || t("That one didn't come out right, so I refunded the tokens. Want to try again?") }]); resolve(); return; }
        if (s.done && Array.isArray(s.media) && s.media.length) {
          const media = s.media;
          setMsgs((m) => [...m, { role: "assistant", content: t("Here it is! 🎉 It's up on the canvas — tap to open full-size."), media }]);
          heroFromMedia(media);
          resolve(); return;
        }
      } catch { /* transient — keep polling */ }
      if (tries >= limit) { setMsgs((m) => [...m, { role: "assistant", content: t("Still cooking — it's taking longer than usual. It'll land in your Gallery when it's done.") }]); resolve(); return; }
      window.setTimeout(tick, 5000);
    };
    window.setTimeout(tick, 5000);
  });

  // RUN the tapped "Make it" / "Make all N" confirm — ported from Buddy's
  // runMakes: spend + enqueue each spec (intent:"make"), then poll each. The
  // canvas shows a making spinner while anything is in flight (via `making`).
  const runMakes = async (specs: CMake[]) => {
    if (making || !specs.length) return;
    setMaking(true);
    setMsgs((m) => m.map((x) => (x.makes ? { ...x, makes: undefined } : x)));
    if (specs.length === 1) {
      const noun = specs[0].kind === "music" ? t("track") : (specs[0].kind === "video" || specs[0].kind === "faceless") ? t("video") : t("image");
      setMsgs((m) => [...m, { role: "assistant", content: t("On it — making your {noun} now. This takes a minute; keep chatting and I'll drop it here and on the canvas. 🎬", { noun }) }]);
    } else {
      setMsgs((m) => [...m, { role: "assistant", content: t("On it — making {n} now. Each takes a minute; I'll drop each one here as it lands. 🎬", { n: specs.length }) }]);
    }
    const jobs: { jobId: string; cursor: number; kind: string; spec: CMake }[] = [];
    let firstErr = ""; let upsell = false;
    for (const spec of specs) {
      try {
        const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "make", make: spec, mode: CHAT_MODE }) });
        const data = (await res.json().catch(() => ({}))) as { jobId?: string; cursor?: number; kind?: string; error?: string; upsell?: string };
        if (data.jobId && typeof data.cursor === "number") jobs.push({ jobId: data.jobId, cursor: data.cursor, kind: data.kind || spec.kind, spec });
        else { if (!firstErr) firstErr = data.error || ""; if (data.upsell) upsell = true; }
      } catch { if (!firstErr) firstErr = t("Connection blipped before I could start — mind trying again?"); }
    }
    if (!jobs.length) {
      const pending = upsell ? { label: t("See plans"), to: "/web#plans", cost: 0, kind: "plans" } : undefined;
      setMsgs((m) => [...m, { role: "assistant", content: firstErr || t("Couldn't start that one — mind trying again?"), pending }]);
      setMaking(false); return;
    }
    if (jobs.length < specs.length) setMsgs((m) => [...m, { role: "assistant", content: firstErr || t("I could only start {done} of the {total} — I'll bring those in as they land.", { done: jobs.length, total: specs.length }) }]);
    await Promise.all(jobs.map((j) => pollMake(j.jobId, j.cursor, j.kind, j.spec)));
    setMaking(false);
  };

  // New chat — create a thread via api.buddy and switch to it (loads empty →
  // proactive opener). Minimal for v1 (no rename/delete here).
  const newThread = async () => {
    if (busy) return;
    try {
      const res = await fetch("/api/buddy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "newThread", mode: CHAT_MODE }) });
      const data = (await res.json().catch(() => ({}))) as { threadId?: string; title?: string };
      if (data.threadId) {
        setThreads((ts) => [...ts, { id: data.threadId as string, title: data.title || "New chat", ts: Date.now() }]);
        setActiveThreadId(data.threadId);
        setAttach(null); setLastPhoto(null); setHero(null);
      }
    } catch { /* ignore */ }
  };

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Desktop: Enter sends, Shift+Enter newline. Touch: Enter = newline (the
    // on-screen send button sends) — matches the Buddy composer behavior.
    if (e.key === "Enter" && !e.shiftKey && !isTouch()) { e.preventDefault(); void send(input); }
  };

  const busyOrMaking = busy || making;

  // The page subtitle (shared by the shell + the live UI so they match).
  const SUB = t("Chat with Helpurr — make images & videos, edit photos or clips. The newest shows on the canvas, and it all lands in your ");

  // SSR + first client paint = this deterministic shell (no browser APIs, same
  // strings both sides), so hydration matches exactly; the full UI mounts next.
  if (!mounted) {
    return (
      <div className="cc-wrap">
        <style dangerouslySetInnerHTML={{ __html: CREATE_STYLE }} />
        <h1 className="wb-h1">{t("Create")}</h1>
        <p className="wb-sub">{SUB}<Link to="/web/archive?section=creator">{t("gallery")}</Link>.</p>
        <div className="cc-grid"><section className="cc-chat" aria-label={t("Chat with Helpurr")} /><section className="cc-stage" aria-label={t("Canvas")} /></div>
      </div>
    );
  }
  return (
    <div className="cc-wrap">
      <style dangerouslySetInnerHTML={{ __html: CREATE_STYLE }} />
      <h1 className="wb-h1">{t("Create")}</h1>
      <p className="wb-sub">{SUB}<Link to="/web/archive?section=creator">{t("gallery")}</Link>.</p>
      {!d.hasPlan && (
        <div className="wb-err">{t("You're on the free tier — a few makes a day are on the house. Pick a ")}<Link to="/web#plans">{t("plan")}</Link>{t(" for more.")}</div>
      )}

      <div className="cc-grid">
        {/* ── CHAT COLUMN (left) ─────────────────────────────────────────── */}
        <section className="cc-chat" aria-label={t("Chat with Helpurr")}>
          {/* Helpurr hero — the stationary mascot + a plain-language pitch of what
              it can do (the old thread-chip wall lived here and read as debug
              output). Threads now live in a tidy dropdown on the right. */}
          <div className="cc-hero">
            <span className="cc-hero-fam"><Familiar think={busyOrMaking} /></span>
            <div className="cc-hero-say">
              <div className="cc-hero-top">
                <b className="cc-hero-name">Helpurr</b>
                <div className="cc-hero-threads">
                  <button type="button" className="cc-thread-new" onClick={() => void newThread()} disabled={busy}>+ {t("New chat")}</button>
                  <div className="cc-threadwrap">
                    <button type="button" className="cc-threadbtn" aria-haspopup="listbox" aria-expanded={threadsOpen}
                      onClick={() => setThreadsOpen((o) => !o)} title={t("Your chats")}>
                      <Ico n="paw" size={13} />
                      <span className="cc-threadbtn-t">{dispTitle(activeThread?.title || "Main")}</span>
                      <svg className="cc-threadcaret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9.5 12 15l6-5.5" /></svg>
                    </button>
                    {threadsOpen && (
                      <>
                        <button type="button" className="cc-threadback" aria-label={t("Close")} onClick={() => setThreadsOpen(false)} />
                        <div className="cc-threadpop" role="listbox" aria-label={t("Your chats")}>
                          {threads.map((th) => (
                            <button key={th.id} type="button" role="option" aria-selected={th.id === activeThreadId}
                              className={`cc-threadopt${th.id === activeThreadId ? " on" : ""}`}
                              onClick={() => { setThreadsOpen(false); if (!busy && th.id !== activeThreadId) { setActiveThreadId(th.id); setAttach(null); setLastPhoto(null); } }}
                              title={dispTitle(th.title)}>
                              <span className="cc-threadopt-t">{dispTitle(th.title)}</span>
                              {th.id === activeThreadId && <Ico n="check" size={14} />}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <p className="cc-hero-pitch">{t("Make images & videos, edit photos, even trim & caption clips — all from chat. Just tell me what you want. 🐾")}</p>
            </div>
          </div>

          <div className="cc-list" ref={listRef} role="log" aria-live="off">
            {msgs.map((m, i) => (
              <div key={i} className={`cc-row ${m.role}`}>
                <div className={`cc-msg ${m.role}`}>{m.role === "assistant" ? renderRich(m.content) : m.content}</div>
                {m.media && m.media.length > 0 && (
                  <div className="cc-media">
                    {m.media.map((md, j) => (
                      md.type === "VIDEO_AD"
                        ? <span key={j} className="cc-media-wrap"><video src={md.url} className="cc-media-item" controls playsInline preload="metadata" /></span>
                        : md.type === "AUDIO"
                          ? <span key={j} className="cc-media-wrap"><audio src={md.url} className="cc-media-aud" controls /></span>
                          // Clicking a past image re-loads it to the Stage hero (and the link still opens full-size).
                          : <a key={j} href={md.url} target="_blank" rel="noreferrer" className="cc-media-link" title={md.title || t("Show on canvas")}
                              onClick={(e) => { e.preventDefault(); setHero({ url: md.url, type: md.type, title: md.title }); }}>
                              <img src={md.url} alt={md.title || ""} className="cc-media-item" loading="lazy" />
                            </a>
                    ))}
                  </div>
                )}
                {m.pending && keepLink(m.pending.to) && (
                  <a className="cc-make" href={m.pending.to}>
                    <span>✨ {m.pending.label}</span>
                    <b>{m.pending.cost > 0 ? t("~{n} tokens →", { n: m.pending.cost }) : "→"}</b>
                  </a>
                )}
                {m.makes && m.makes.length === 1 && (
                  <button type="button" className="cc-make cc-make-go" disabled={making} onClick={() => runMakes(m.makes!)}>
                    <span>{making ? t("Working…") : t("✨ {label}", { label: m.makes[0].label })}</span>
                    <b>{m.makes[0].cost > 0 ? t("{n} tokens →", { n: m.makes[0].cost }) : t("Free →")}</b>
                  </button>
                )}
                {m.makes && m.makes.length > 1 && (
                  <div className="cc-makeq">
                    <ul className="cc-makeq-list">
                      {(() => { const specs = m.makes!; return specs.every((x) => x.label === specs[0].label) ? <li>{t("{label} ×{n}", { label: specs[0].label, n: specs.length })}</li> : specs.map((x, k) => <li key={k}>{x.label}</li>); })()}
                    </ul>
                    <button type="button" className="cc-make cc-make-go" disabled={making} onClick={() => runMakes(m.makes!)}>
                      <span>{making ? t("Working…") : t("✨ Make all {n}", { n: m.makes.length })}</span>
                      <b>{(() => { const tot = m.makes!.reduce((s, x) => s + (x.cost || 0), 0); return tot > 0 ? t("{n} tokens →", { n: tot }) : t("Free →"); })()}</b>
                    </button>
                  </div>
                )}
                {m.actions && m.actions.filter((a) => keepLink(a.to)).length > 0 && (
                  <div className="cc-acts">{m.actions.filter((a) => keepLink(a.to)).map((a) => <a key={a.to + a.label} className="cc-act" href={a.to}>{a.label}</a>)}</div>
                )}
                {m.followups && m.followups.length > 0 && i === msgs.length - 1 && !busyOrMaking && (
                  <div className="cc-chips">{m.followups.map((f) => <button key={f} type="button" onClick={() => void send(f)}>{f}</button>)}</div>
                )}
              </div>
            ))}
            {/* Empty-state starters — concrete, clickable examples that double as
                the instructions. Shown only on a fresh thread (just the opener). */}
            {histReady && !busyOrMaking && msgs.length <= 1 && (
              <div className="cc-starts">
                <div className="cc-starts-h">{t("Try one of these")}</div>
                <div className="cc-starts-grid">
                  {STARTERS.map((s) => (
                    <button key={s.label} type="button" className="cc-start"
                      onClick={() => { if (s.pick) fileRef.current?.click(); else if (s.send) void send(s.send); }}>
                      <Ico n={s.ico} size={16} /> {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {streamStatus && <div className="cc-status">{streamStatus}</div>}
            {busy && !streamStatus && <div className="cc-status">{t("Helpurr is thinking…")}</div>}
          </div>

          {/* COMPOSER */}
          <div className="cc-composer">
            {attach && (
              <div className="cc-attach">
                <img src={attach.url} alt="" />
                <button type="button" onClick={() => setAttach(null)} aria-label={t("Remove photo")}>×</button>
              </div>
            )}
            <div className="cc-composer-row">
              <button type="button" className="cc-attach-btn" onClick={() => fileRef.current?.click()} disabled={uploading || busy} title={t("Attach a photo")} aria-label={t("Attach a photo")}>
                {uploading ? <span className="cc-attach-load" aria-hidden="true" /> : <Ico n="image" size={19} />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pickPhoto(e.target.files)} />
              <textarea
                ref={inputRef}
                className="cc-input"
                value={input}
                rows={1}
                placeholder={t("Describe what you want to make — or tell Helpurr to change it")}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onComposerKey}
                disabled={busy}
                aria-label={t("Message Helpurr")}
              />
              {busy ? (
                <button type="button" className="cc-send cc-stop" onClick={stop} title={t("Stop")}>■</button>
              ) : (
                <button type="button" className="cc-send" onClick={() => void send(input)} disabled={(!input.trim() && !attach) || uploading} title={t("Send")} aria-label={t("Send")}>↑</button>
              )}
            </div>
          </div>
        </section>

        {/* ── CANVAS / STAGE (right) — the proper easel (echoes web.studio.tsx's
            .ws-stage-frame): a dashed easel that doubles as a tap/drop target to
            edit a photo, a rose spinner while making, and a dark frame on a
            result. The newest image lands here, big. ───────────────────────── */}
        <section className="cc-stage" aria-label={t("Canvas")}>
          <div className={`cc-stage-frame${hero && !making ? " has-result" : ""}`}
            style={hero?.aspect ? ({ ["--stage-ar" as string]: hero.aspect } as React.CSSProperties) : undefined}>
            {making ? (
              <div className="cc-easelph making">
                <span className="cc-easel-mark" aria-hidden="true"><span className="cc-rose" /></span>
                <div className="cc-easel-cap">{t("Making…")}</div>
                <div className="cc-easel-sub">{t("This takes a minute — keep chatting if you like, it'll land right here.")}</div>
              </div>
            ) : hero ? (
              <a className="cc-heromedia" href={hero.url} target="_blank" rel="noreferrer" title={t("Open full-size")}>
                <img src={hero.url} alt={hero.title || ""}
                  onLoad={(e) => { const el = e.currentTarget; if (el.naturalWidth && el.naturalHeight) setHero((h) => (h && h.url === hero.url && !h.aspect ? { ...h, aspect: `${el.naturalWidth} / ${el.naturalHeight}` } : h)); }} />
              </a>
            ) : attach ? (
              <div className="cc-easel-photo">
                <img src={attach.url} alt="" />
                <button type="button" className="cc-easel-clear" onClick={() => setAttach(null)} aria-label={t("Remove photo")}><Ico n="x" size={15} /></button>
                <div className="cc-easel-photocap">{t("Tell Helpurr how to edit this")} →</div>
              </div>
            ) : (
              <div className="cc-easelph cc-easelph-drop" role="button" tabIndex={0}
                aria-label={t("Upload a photo to edit")}
                onClick={() => { if (!uploading) fileRef.current?.click(); }}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !uploading) { e.preventDefault(); fileRef.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drag"); }}
                onDragLeave={(e) => e.currentTarget.classList.remove("drag")}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("drag"); void pickPhoto(e.dataTransfer.files); }}>
                <span className="cc-easel-mark" aria-hidden="true">
                  <span className="cc-dropplus"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5.4v13.2M5.4 12h13.2" /></svg></span>
                </span>
                <div className="cc-easel-cap">{t("Your canvas")}</div>
                <div className="cc-easel-sub">{t("Make something in chat and it shows here, big — or tap to drop a photo to edit.")}</div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// Scoped styles — mirrors web.studio.tsx's WS_STYLE injection pattern and uses
// the shell's green-on-cream vars (--green/--ink/--line/--card/--paper), with a
// cc- prefix so nothing collides with the Studio's ws-/mm- rules. The Stage
// frame echoes .ws-stage-frame (dashed easel border → solid dark frame on a
// result). Two columns on desktop, stacked (canvas on top) on mobile.
const CREATE_STYLE = `
.cc-wrap{--green:#0C7A46;--green2:#12A85E;--ink:#14201A;--ink2:#4A554E;--line:#E1DECD;--card:#FDFCF7;--paper:#F4F1E6;--gold:#B08526;}
.cc-grid{display:grid;grid-template-columns:380px minmax(0,1fr);gap:18px;align-items:start;margin-top:8px}
@media (max-width:900px){.cc-grid{grid-template-columns:1fr}.cc-stage{order:-1}}

/* CHAT COLUMN */
.cc-chat{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden;height:min(78vh,760px)}
/* Shell (mount-gate) reserves the column heights so there's no layout jump. */
.cc-chat:empty{display:block;height:min(78vh,760px)}
.cc-stage:empty{display:block;min-height:470px;border:1px dashed #DED7C2;border-radius:20px;background:radial-gradient(90% 80% at 50% 35%,#FFFEF9,#F6F1E4)}

/* HELPURR HERO — stationary mascot + capability pitch + tidy thread control */
.cc-hero{display:flex;align-items:center;gap:13px;padding:13px 14px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(12,122,70,.055),rgba(12,122,70,.015))}
.cc-hero-fam{flex:none;width:58px;height:58px;display:grid;place-items:center;filter:drop-shadow(0 5px 11px rgba(12,122,70,.20))}
.cc-hero-say{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.cc-hero-top{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.cc-hero-name{font-family:Poppins,system-ui,sans-serif;font-weight:800;font-size:16px;color:var(--ink);line-height:1}
.cc-hero-pitch{margin:0;font-size:12.5px;line-height:1.5;color:var(--ink2)}
.cc-hero-threads{margin-left:auto;display:flex;align-items:center;gap:7px}
.cc-thread-new{font:inherit;font-weight:700;font-size:12px;color:var(--green);background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer;white-space:nowrap}
.cc-thread-new:hover{background:rgba(12,122,70,.07);border-color:var(--green)}
.cc-thread-new:disabled{opacity:.5;cursor:default}
.cc-threadwrap{position:relative;display:flex}
.cc-threadbtn{display:inline-flex;align-items:center;gap:6px;max-width:150px;font:inherit;font-weight:600;font-size:12px;color:var(--ink2);background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 10px;cursor:pointer}
.cc-threadbtn:hover{border-color:var(--green);color:var(--green)}
.cc-threadbtn-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:86px}
.cc-threadcaret{flex:none;opacity:.7}
.cc-threadback{position:fixed;inset:0;z-index:40;background:transparent;border:0;cursor:default}
.cc-threadpop{position:absolute;top:calc(100% + 6px);right:0;z-index:41;width:236px;max-width:calc(100vw - 40px);max-height:306px;overflow-y:auto;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 36px rgba(20,32,26,.17);padding:6px}
.cc-threadopt{display:flex;align-items:center;gap:8px;width:100%;font:inherit;font-size:13px;color:var(--ink);background:transparent;border:0;border-radius:8px;padding:8px 10px;cursor:pointer;text-align:left}
.cc-threadopt:hover{background:rgba(12,122,70,.07)}
.cc-threadopt.on{color:var(--green)}
.cc-threadopt .svg,.cc-threadopt svg{flex:none;color:var(--green)}
.cc-threadopt-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.cc-list{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.cc-row{display:flex;flex-direction:column;gap:7px;max-width:100%}
.cc-row.user{align-items:flex-end}
.cc-row.assistant{align-items:flex-start}
.cc-msg{white-space:pre-wrap;word-break:break-word;line-height:1.5;font-size:14px;padding:10px 13px;border-radius:14px;max-width:88%}
.cc-msg.user{background:var(--green);color:#fff;border-bottom-right-radius:5px}
.cc-msg.assistant{background:#F3EFE2;color:var(--ink);border-bottom-left-radius:5px}
.cc-msg.assistant strong{font-weight:700}
.cc-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;background:rgba(0,0,0,.06);padding:1px 5px;border-radius:5px}
.cc-link{color:var(--green);text-decoration:underline;word-break:break-all}
.cc-media{display:flex;flex-wrap:wrap;gap:8px;max-width:88%}
.cc-media-link,.cc-media-wrap{display:block;border-radius:12px;overflow:hidden;border:1px solid var(--line);max-width:180px}
.cc-media-link{cursor:zoom-in}
.cc-media-item{display:block;width:100%;height:auto;max-height:180px;object-fit:cover}
.cc-media-aud{width:230px;max-width:100%}

.cc-make{display:inline-flex;align-items:center;gap:12px;justify-content:space-between;width:fit-content;max-width:88%;font:inherit;font-weight:700;font-size:13.5px;text-align:left;cursor:pointer;color:#2a1e00;background:linear-gradient(135deg,#FFE9A8,#F6C85A);border:1px solid #E7B84d;border-radius:12px;padding:10px 14px;text-decoration:none}
.cc-make:hover{filter:brightness(1.03)}
.cc-make:disabled{opacity:.6;cursor:default}
.cc-make b{font-weight:800;white-space:nowrap;opacity:.8}
.cc-make-go{background:linear-gradient(135deg,#12A85E,#0C7A46);color:#fff;border-color:#0A6A3D}
.cc-makeq{display:flex;flex-direction:column;gap:7px;max-width:88%}
.cc-makeq-list{margin:0;padding-left:18px;font-size:12.5px;color:var(--ink2);line-height:1.5}
.cc-acts,.cc-chips{display:flex;flex-wrap:wrap;gap:7px;max-width:88%}
.cc-act,.cc-chips button{font:inherit;font-size:12.5px;font-weight:600;color:var(--green);background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer;text-decoration:none}
.cc-act:hover,.cc-chips button:hover{background:rgba(12,122,70,.06)}
.cc-status{font-size:12.5px;color:var(--ink2);font-style:italic;padding:2px 4px}

/* EMPTY-STATE STARTERS — the instructions, as tappable examples */
.cc-starts{margin-top:4px;display:flex;flex-direction:column;gap:9px}
.cc-starts-h{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--ink2);opacity:.72}
.cc-starts-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cc-start{display:inline-flex;align-items:center;gap:8px;font:inherit;font-weight:600;font-size:13px;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:12px;padding:11px 12px;cursor:pointer;text-align:left;line-height:1.2}
.cc-start:hover{border-color:var(--green);background:rgba(12,122,70,.05);color:var(--green)}
.cc-start svg{flex:none;color:var(--green)}

/* COMPOSER */
.cc-composer{border-top:1px solid var(--line);padding:11px 12px;background:var(--card)}
.cc-attach{position:relative;width:64px;height:64px;margin-bottom:9px;border-radius:10px;overflow:hidden;border:1px solid var(--line)}
.cc-attach img{width:100%;height:100%;object-fit:cover;display:block}
.cc-attach button{position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(20,32,26,.8);color:#fff;font-size:14px;line-height:1;cursor:pointer}
.cc-composer-row{display:flex;align-items:flex-end;gap:8px}
.cc-attach-btn{flex:none;width:38px;height:38px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink2);cursor:pointer;display:grid;place-items:center}
.cc-attach-btn:hover{border-color:var(--green);color:var(--green)}
.cc-attach-btn:disabled{opacity:.5;cursor:default}
.cc-attach-load{width:16px;height:16px;border-radius:50%;border:2px solid rgba(12,122,70,.25);border-top-color:var(--green);animation:ccspin .7s linear infinite}
.cc-input{flex:1;resize:none;font:inherit;font-size:14px;line-height:1.45;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 12px;max-height:140px;min-height:40px}
.cc-input:focus{outline:2px solid var(--green2);outline-offset:-1px}
.cc-input:disabled{opacity:.6}
.cc-send{flex:none;width:40px;height:40px;border-radius:50%;border:none;background:var(--green);color:#fff;font-size:18px;font-weight:700;cursor:pointer;display:grid;place-items:center}
.cc-send:hover{background:var(--green2)}
.cc-send:disabled{opacity:.4;cursor:default}
.cc-stop{background:#C0392B}
.cc-stop:hover{background:#D64534}

/* CANVAS / STAGE — echoes .ws-stage-frame */
.cc-stage{position:sticky;top:14px;min-width:0}
.cc-stage-frame{position:relative;width:100%;min-height:470px;display:grid;place-items:center;border-radius:20px;overflow:hidden;border:1px dashed #DED7C2;background:repeating-linear-gradient(135deg,rgba(12,122,70,.018) 0 2px,transparent 2px 22px),radial-gradient(90% 80% at 50% 35%,#FFFEF9,#F6F1E4)}
.cc-stage-frame::after{content:"";position:absolute;inset:10px;border-radius:14px;border:1px solid rgba(199,154,46,.18);pointer-events:none}
.cc-stage-frame.has-result{border-style:solid;border-color:var(--line);background:var(--ink);min-height:0;width:100%;max-width:min(100%,620px);margin-inline:auto}
.cc-stage-frame.has-result::after{display:none}
/* Easel placeholder — mirrors .ws-easelph / .ws-easelph-drop in the Studio. */
.cc-easelph{display:flex;flex-direction:column;align-items:center;gap:13px;text-align:center;padding:26px}
.cc-easelph-drop{cursor:pointer;width:100%;height:100%;justify-content:center;border-radius:20px;transition:background .14s}
.cc-easelph-drop:hover{background:rgba(12,122,70,.04)}
.cc-easelph-drop:focus-visible{outline:2px solid var(--green2);outline-offset:-8px}
.cc-easelph-drop.drag{background:rgba(12,122,70,.08);outline:2px dashed var(--green2);outline-offset:-12px}
.cc-easel-mark{position:relative;display:grid;place-items:center;width:62px;height:62px}
.cc-rose{position:absolute;inset:0;width:62px;height:62px;border-radius:50%;opacity:0;background:conic-gradient(from 0deg,#0A6A3D,#12A85E 30%,#FFD24A 52%,#12A85E 74%,#0A6A3D)}
.cc-easelph.making .cc-rose{opacity:1;animation:ccspin 2.4s linear infinite}
.cc-dropplus{display:grid;place-items:center;width:62px;height:62px;border-radius:50%;color:var(--green);background:rgba(12,122,70,.08);border:1.5px solid rgba(12,122,70,.25);transition:transform .14s}
.cc-easelph-drop:hover .cc-dropplus{transform:scale(1.07)}
.cc-easel-cap{font-size:15px;font-weight:700;color:var(--ink);font-family:Poppins,system-ui,sans-serif}
.cc-easel-sub{font-size:12.5px;color:var(--ink2);max-width:32ch;line-height:1.5}
.cc-easel-photo{position:relative;width:100%;display:flex;flex-direction:column;align-items:center;padding:14px}
.cc-easel-photo img{display:block;width:100%;height:auto;max-height:64vh;object-fit:contain;border-radius:14px}
.cc-easel-clear{position:absolute;top:22px;right:22px;width:30px;height:30px;border-radius:50%;border:none;background:rgba(20,32,26,.72);color:#fff;cursor:pointer;display:grid;place-items:center}
.cc-easel-clear:hover{background:rgba(20,32,26,.9)}
.cc-easel-photocap{margin-top:12px;font-size:13px;font-weight:700;color:var(--green)}
.cc-heromedia{display:block;width:100%}
.cc-heromedia img{display:block;width:100%;height:auto;max-height:74vh;object-fit:contain}
@keyframes ccspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.cc-easelph.making .cc-rose,.cc-attach-load{animation:none}}
@media (max-width:900px){.cc-stage{position:static}.cc-stage-frame{min-height:300px}.cc-stage-frame.has-result{aspect-ratio:var(--stage-ar,1/1);max-height:min(62vh,460px)}.cc-chat{height:min(74vh,660px)}.cc-chat:empty{height:min(74vh,660px)}.cc-starts-grid{grid-template-columns:1fr}.cc-hero-threads{width:100%;margin-left:0;margin-top:2px;justify-content:flex-start}}
`;
