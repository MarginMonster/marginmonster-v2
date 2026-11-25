/* FOUND FOOTAGE — the builder. Say what was caught on camera, pick the camera and how many moments, read the
 * footage the writer makes of it, change anything, roll it; it lands in the Archive.
 *
 * The owner, 2026-11-24: "Would be cool to also get a \"found Footage\" style pipeline, that would do blair witch
 * style creatives" — "make it easymode and selectable good UI interface" — "Found footage from house camera POVs
 * also" — "if we put it as a scene setting it would maximize easiness" — "What about body cam footage".
 * And 2026-11-25: "Found footage needs redone … It currently appears to pipeline singular events But needs to be
 * more like \"Found Footage\" House cam, Body cam, phone or cam recording, with describe events flow like the
 * others - make it look banging and not limited".
 *
 * So it is built the way the Movie Maker's story builder is (routes/web.film.tsx — say what it is about, a few step
 * cards with smart defaults, "write it — free", look it over, make it), in its own recovered-tape skin:
 *
 *   WHAT WAS CAUGHT  ONE BOX, first and always there (the owner, on the cards alone: "These found footage options
 *   ON CAMERA?       leave zero room for creativity, it's just what happens"). Write it your way — or tap a card
 *                    (take.ts → FOOTAGE_SCARES) and its own words arrive in the box to change. The cards are the
 *                    nudges: left as they are, the take is the ready-made one; changed, it is the member's own,
 *                    written FROM that card (take.ts → cardUnchanged — asked here, and again by the server).
 *   THE STEP CARDS   each says what it is set to, a tap opens it (the Movie Maker's .mm-card, here .ff-step):
 *                    THE CAMERA — House camera · Body cam · Phone · Camcorder · No overlay, in the order he named
 *                    them, each with a few seconds of a real take dressed as that camera; THE CUT — how many
 *                    moments, one ("One take", today's) to eight, with the film's length and how long it takes
 *                    to make, on one strip of film under a thumb; THE SETTINGS — only what this camera has.
 *   ONE MOMENT       the button is today's: one take, queued exactly as it always was (intent "take").
 *   TWO OR MORE      "Write the footage — free" (intent "outline": footage-film.server.ts → writeFootageOutline)
 *                    → THE REEL: the film laid out as recovered footage, every moment a frame in its camera's own
 *                    viewfinder with its card above it — every word of it the member's to change, any moment
 *                    written again on a tap (intent "rewrite" → rewriteFootageMoment) — then "Roll the footage"
 *                    (intent "film": footage-film.ts → footageFilmJob). What is rolled is the reel as they left
 *                    it; the server cleans it again and never trusts it.
 *
 * ADMIN-ONLY until the owner names and prices this tier (as the character shows were — web.channels.tsx): to
 * anybody else the page does not exist, and its action refuses. Nothing is charged meanwhile — not a take, not a
 * film, not the writer.
 *
 * Light by default; in the dark theme the shell goes dark (lib/theater-shell.ts) and the cards stay the cream
 * cards they are, with a gold edge — the Movie Maker's rule. The reel is tape in both: black. */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type TextareaHTMLAttributes } from "react";
import { db } from "../db.server";
import { requireWebIdentity } from "../lib/web-auth.server";
import { isAdminEmail } from "../lib/admin.server";
import { capabilitiesFor } from "../lib/capabilities.server";
import { enqueueJob } from "../lib/job-queue.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { useT } from "../lib/ui-lang";
import { Ico } from "../lib/icons";
import { CAMERA_LOOKS, cameraLookOf, type CameraLook, type HouseClock } from "../lib/camera-dress";
import { HOUSE_ROOMS, HOUSE_TAKE_SECONDS, houseScare } from "../lib/house-cam";
import { FOOTAGE_SHELVES, OWN_SCARE, TAKE_SECONDS, cardUnchanged, familyOf, fits, footageEta, footageJob, footageScare, pickCamera, pickScare, shapeChoosable, shapeFor, shelfScares, type FootagePick } from "../lib/take";
import {
  FOOTAGE_LIMITS, FOOTAGE_MAX_MOMENTS, FOOTAGE_OUTLINE_UNREADABLE, camStamp, cardWords, cleanFootageOutline, footageClocks, footageFilmEta, footageFilmJob, footageOutlineAsk,
  footageSeconds, momentSeconds, type FootageMoment, type FootageOutline,
} from "../lib/footage-film";
import { themeOf } from "../lib/theme";
import { useTheme } from "../lib/use-theme";
import { THEATER_SHELL_CSS } from "../lib/theater-shell";

export const meta: MetaFunction = ({ matches }) => {
  const shell = matches.find((m) => m.id === "routes/web")?.data as { theme?: unknown } | undefined;
  return [{ title: "Found Footage · EasyMode" }, ...(themeOf(shell?.theme) === "dark" ? [{ name: "theme-color", content: "#0A1C13" }] : [])];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  if (!isAdminEmail(account.email)) throw new Response("Not found", { status: 404 });
  // THE SHOP'S HOUSE: which rooms its cameras have already seen (a room it has is used as it was drawn)
  let kept: string[] = [];
  try {
    const { keptHouseFor } = await import("../lib/house-take.server");
    kept = ((await keptHouseFor(shop.id))?.rooms || []).map((r) => r.key);
  } catch (e) { console.error(`[found-footage] the house could not be read: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
  return json({
    hasPlan: !!shop.activePlan?.active,
    canFilm: !!shop.activePlan?.active && capabilitiesFor(shop.activePlan).has("creatorvideo"),
    kept,
  });
};

/** WHAT THIS PAGE ASKS FOR (2026-11-25): "take" — ONE moment, today's take, queued exactly as it always was;
 *  "outline" — write the moments of a film (free); "rewrite" — another take on one moment of it (free); "film" —
 *  roll the moments the member approved. */
const INTENTS = ["take", "outline", "rewrite", "film"];

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = readUiLang(request);
  const { account, shop } = await requireWebIdentity(request);
  if (!isAdminEmail(account.email)) return json({ error: "Not found" }, { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  if (!INTENTS.includes(intent)) return json({ error: tr(lang, "Unknown action.") }, { status: 400 });
  if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan on the Dashboard first — film runs on tokens.") });
  if (!capabilitiesFor(shop.activePlan).has("creatorvideo")) return json({ error: tr(lang, "Your plan doesn't include video yet — upgrade to make films.") });

  // THE WRITER, FREE: the moments of a film, from the same choices one press would film (footage-film.ts →
  // footageOutlineAsk) — or another take on one moment of the outline the member is editing (cleaned first: a page
  // is never trusted). Its refusals are words the page can show; anything else it throws is "try again".
  if (intent === "outline" || intent === "rewrite") {
    const writer = await import("../lib/footage-film.server");
    const said = (e: unknown) => {
      const m = e instanceof Error ? e.message : "";
      console.error(`[found-footage] the writer (${intent}) did not answer: ${m.slice(0, 160)}`);
      return tr(lang, [writer.FOOTAGE_WRITER_BUSY, writer.FOOTAGE_NEEDS_IDEA, FOOTAGE_OUTLINE_UNREADABLE].includes(m) ? m : writer.FOOTAGE_WRITER_BUSY);
    };
    if (intent === "outline") {
      const ask = footageOutlineAsk({ scare: form.get("scare"), own: form.get("own"), camera: form.get("camera"), aspect: form.get("aspect"), lapse: form.get("lapse"), ir: form.get("ir"), room: form.get("room"), moments: form.get("moments") }, (s) => tr(lang, s));
      if (!ask.ok) return json({ error: ask.error }, { status: 400 });
      try { return json({ ok: true as const, outline: await writer.writeFootageOutline(ask) }); }
      catch (e) { return json({ error: said(e) }); }
    }
    const outline = cleanFootageOutline(form.get("outline"));
    const index = Number(form.get("index"));
    if (!outline || !Number.isInteger(index) || index < 0 || index >= outline.moments.length) return json({ error: tr(lang, FOOTAGE_OUTLINE_UNREADABLE) }, { status: 400 });
    try { return json({ ok: true as const, index, moment: await writer.rewriteFootageMoment({ outline, index, note: String(form.get("note") || "").slice(0, 300) }) }); }
    catch (e) { return json({ error: said(e) }); }
  }

  // QUEUED: one take, or a film — either is ONE job (and counts as one of the three a shop may have in the making)
  const roll = async (job: { name: string; payload: Record<string, unknown> }) => {
    // (three takes in the making at once is plenty — a fourth press is a slip of the finger)
    const making = await db.job.count({ where: { shopId: shop.id, type: "GENERATE_VIDEO_AD", status: { in: ["PENDING", "IN_PROGRESS"] }, payload: { contains: '"contentType":"take"' } } });
    if (making >= 3) return json({ error: tr(lang, "Three takes are already being made — wait for one to land in your Archive.") });
    try {
      const jobId = await enqueueJob(shop.id, "GENERATE_VIDEO_AD", job.payload);
      return json({ ok: true as const, jobId, name: job.name });
    } catch (e) {
      console.error("[found-footage] the take could not be queued:", e instanceof Error ? e.message : e);
      return json({ error: tr(lang, "Couldn't start the render — try again in a moment.") });
    }
  };
  if (intent === "film") {
    // A FILM: the outline the member approved, as they left it — cleaned again here (footage-film.ts → footageFilmJob)
    const film = footageFilmJob({ scare: form.get("scare"), own: form.get("own"), camera: form.get("camera"), aspect: form.get("aspect"), lapse: form.get("lapse"), ir: form.get("ir"), room: form.get("room"), outline: form.get("outline") }, (s) => tr(lang, s));
    if (!film.ok) return json({ error: film.error }, { status: 400 });
    return roll(film);
  }
  // ONE TAKE, exactly as it was. (a card's words are compared as the member was shown them — in their own language —
  // as well as in English)
  const job = footageJob({ scare: form.get("scare"), own: form.get("own"), camera: form.get("camera"), aspect: form.get("aspect"), lapse: form.get("lapse"), ir: form.get("ir"), room: form.get("room") }, (s) => tr(lang, s));
  if (!job.ok) return json({ error: tr(lang, job.error) }, { status: 400 });
  return roll(job);
};

/** A camera card's screen: its loop plays while it can be seen (a mouse: while pointed at; reduced motion: the
 *  still). The clip is fetched the first time it is needed. */
function CamScreen({ cam }: { cam: CameraLook }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const start = () => { if (!v.getAttribute("src")) v.src = `/landing/ff-cam-${cam}.mp4`; v.muted = true; v.play().catch(() => undefined); };
    const stop = () => v.pause();
    if (typeof IntersectionObserver === "undefined") { start(); return; }
    const io = new IntersectionObserver((es) => { for (const e of es) (e.isIntersecting ? start : stop)(); }, { threshold: 0.5 });
    io.observe(v);
    return () => io.disconnect();
  }, [cam]);
  return <video ref={ref} className="ff-screen-vid" poster={`/landing/ff-cam-${cam}.jpg`} muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />;
}

/** THE HERO'S REC LIGHT: a red dot that blinks and the seconds this page has been "recording" (its own little
 *  component, so the counting redraws nothing else). */
function RecLight() {
  const [secs, setSecs] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setSecs((s) => s + 1), 1000); return () => window.clearInterval(id); }, []);
  const tc = [Math.floor(secs / 3600), Math.floor(secs / 60) % 60, secs % 60].map((n) => String(n).padStart(2, "0")).join(":");
  return <span className="ff-rec" aria-hidden="true"><i />REC <b>{tc}</b></span>;
}

/** A switch: one tap turns it over. */
function Switch({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`ff-sw${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <span className="ff-sw-txt"><b>{label}</b><span>{sub}</span></span>
      <span className="ff-sw-knob" aria-hidden="true"><i /></span>
    </button>
  );
}

/* ---- THE FILM: moments, cards, the reel ---- */

type T = (source: string, params?: Record<string, string | number>) => string;

/** The cameras, in the order the owner named them (2026-11-25: "House cam, Body cam, phone or cam recording"). */
const CAM_ORDER: readonly CameraLook[] = ["house", "bodycam", "phone", "camcorder", "bare"];
const CAMERAS = CAM_ORDER.map((k) => CAMERA_LOOKS.find((c) => c.key === k)).filter((c): c is (typeof CAMERA_LOOKS)[number] => !!c);
const camLook = (k: CameraLook) => CAMERA_LOOKS.find((c) => c.key === k) || CAMERA_LOOKS[0];

/** A film's length as people read it on a player: 0:58, 1:42. */
const clockOf = (sec: number): string => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
/** A camera's clock: 02:14:07. */
const hms = (sec: number): string => { const s = ((Math.floor(sec) % 86400) + 86400) % 86400; return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":"); };
/** A line that can be filmed: four letters or figures at least (footage-film.ts → cleanMoment leaves any other out). */
const filmable = (line: string): boolean => line.replace(/[^\p{L}\p{N}]+/gu, "").length >= 4;
/** One take's length on this camera (a house take is the walk-in's fifteen seconds). */
const oneTake = (camera: CameraLook): number => (camera === "house" ? HOUSE_TAKE_SECONDS : TAKE_SECONDS);
/** Before anything is written, a film of `n` moments as the cut reckons it: each at its camera's usual length. */
const standIn = (camera: CameraLook, n: number): FootageMoment[] => Array.from({ length: n }, () => ({ when: "", line: "", seconds: momentSeconds(camera, undefined) }));
/** How long a moment may be on this camera (footage-film.ts → momentSeconds: 6–12 held or worn; 10–15 on a wall). */
const secondsSpan = (camera: CameraLook): [number, number] => (camera === "house" ? [10, HOUSE_TAKE_SECONDS] : [6, 12]);

/** THE REEL — the outline as the page holds it: every moment with a key of its own (so a moment being written
 *  again is found again after the member has moved it). The key never leaves the page: cleanFootageOutline keeps
 *  only what a moment is. */
type ReelMoment = FootageMoment & { key: string };
type Reel = Omit<FootageOutline, "moments"> & { moments: ReelMoment[] };
let keys = 0;
const newKey = () => `m${Date.now().toString(36)}${(keys++).toString(36)}`;
const reelOf = (o: FootageOutline): Reel => ({ ...o, moments: o.moments.map((m) => ({ ...m, key: newKey() })) });
/** WHAT IS POSTED: the reel as the member left it — every moment with a line, in their order, on the camera now
 *  picked. The server cleans it again (cleanFootageOutline) and films exactly that. */
const outlineOf = (r: Reel, camera: CameraLook, aspect: "9:16" | "16:9"): FootageOutline => ({
  v: 1, title: r.title, camera, aspect, kind: r.kind, place: r.place, thing: r.thing,
  moments: r.moments.filter((m) => filmable(m.line)).map(({ key: _key, ...m }) => m),
});
/** A moment the writer is asked to fill in ("+ Add a moment"): its line says only where it sits. */
const NEW_MOMENT = "A new moment, between the one before it and the one after it.";

/** A die — "another take". */
function Dice() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" className="ff-dice">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.2" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="8.6" cy="8.6" r="1.55" fill="currentColor" /><circle cx="12" cy="12" r="1.55" fill="currentColor" /><circle cx="15.4" cy="15.4" r="1.55" fill="currentColor" />
    </svg>
  );
}

/** A box that grows with its words — never one to scroll inside. Measured again whenever its WIDTH changes too (a
 *  frame that turns from wide to tall when the camera is changed: seen at 390 px, a line cut off at its fifth row). */
function GrowArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let w = -1;
    const fit = () => { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; w = el.clientWidth; };
    fit();
    document.fonts?.ready.then(fit).catch(() => undefined);
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit); }
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) fit(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}

/** THE CUT — how many moments, on ONE control: a strip of film, eight frames, lit up to the one the thumb is on.
 *  Under it a real <input type="range"> (arrows, Home and End; a screen reader hears "3 moments, about 0:34, ready
 *  in about 10 to 19 minutes"), as the Movie Maker's length slider is built (components/film/LengthSlider.tsx). One
 *  is today's single take; two to eight is a film. */
function CutStrip({ value, onChange, camera, written, t }: { value: number; onChange: (n: number) => void; camera: CameraLook; written?: readonly FootageMoment[]; t: T }) {
  const id = useId();
  const n = Math.max(1, Math.min(FOOTAGE_MAX_MOMENTS, value));
  // (a reel of this many moments: its own seconds — else each at its camera's usual length)
  const ms = written && written.length === n ? [...written] : standIn(camera, n);
  const secs = n === 1 ? oneTake(camera) : footageSeconds({ moments: ms });
  const [lo, hi] = n === 1 ? footageEta(camera) : footageFilmEta({ camera, moments: ms });
  const count = n === 1 ? t("One take · {s} s", { s: secs }) : t("{n} moments", { n });
  const ready = t("ready in ~{lo}–{hi} min", { lo, hi });
  return (
    <div className="ff-cut" style={{ ["--n" as string]: n } as CSSProperties}>
      <div className="ff-cut-read">
        <output htmlFor={id} className="ff-cut-count">{count}</output>
        <span className="ff-cut-est">{n > 1 ? <>≈ {clockOf(secs)} · </> : null}{ready}</span>
      </div>
      <div className="ff-cut-strip">
        <span className="ff-cut-film" aria-hidden="true">
          {Array.from({ length: FOOTAGE_MAX_MOMENTS }, (_, k) => <i key={k} className={`${k < n ? "lit" : ""}${k === n - 1 ? " at" : ""}`}><b>{k + 1}</b></i>)}
        </span>
        <input id={id} className="ff-cut-in" type="range" min={1} max={FOOTAGE_MAX_MOMENTS} step={1} value={n}
          aria-label={t("How many moments?")} aria-valuetext={`${count} · ${n > 1 ? `≈ ${clockOf(secs)} · ` : ""}${ready}`}
          onChange={(e) => onChange(Math.max(1, Math.min(FOOTAGE_MAX_MOMENTS, Math.round(Number(e.target.value)) || 1)))} />
      </div>
      <div className="ff-cut-ends" aria-hidden="true"><span>{t("One take")}</span><span>{t("A film · up to {n} moments", { n: FOOTAGE_MAX_MOMENTS })}</span></div>
    </div>
  );
}

/** A MOMENT'S FRAME, IN ITS CAMERA'S OWN VIEWFINDER — drawn here (CSS, not a picture), with the marks that camera
 *  burns into its takes (camera-dress.ts): the house camera's date and clock top left and its CAM bottom left; the
 *  body cam's stamp top right and its AI DRAMATIZATION mark; the camcorder's REC, battery, tape counter and the
 *  date in its corner; the phone's red timer and its stop button; nothing at all on "No overlay". The clock is the
 *  one this moment's CARD gives it (footage-film.ts → footageClocks), and it runs — through the moment's own
 *  seconds, round and round — unless the member asked for less motion. */
function Viewfinder({ camera, tall, clock, seconds, cam, osd, children }: { camera: CameraLook; tall: boolean; clock: HouseClock; seconds: number; cam?: string; osd?: string; children?: ReactNode }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setS((x) => (x + 1) % Math.max(1, seconds)), 1000);
    return () => window.clearInterval(id);
  }, [seconds]);
  const stamp = camStamp(clock);
  return (
    // (the screen is drawn behind; the line sits IN the frame's flow, between its top marks and its bottom ones — a
    //  long line makes the frame taller rather than hiding a mark: seen at 390 px, the body cam's stamp under a
    //  five-line caption)
    <div className={`ff-vf is-${camera}${tall ? " is-tall" : ""}`}>
      <span className="ff-vf-screen" aria-hidden="true"><i className="ff-vf-pic" /><i className="ff-vf-grain" /><i className="ff-vf-scan" /></span>
      <span className="ff-vf-hud" aria-hidden="true">
        {camera === "house" && <><b className="tl">{clock.date} {hms(clock.start + s)}</b>{cam ? <b className="bl">{cam}</b> : null}</>}
        {camera === "bodycam" && <><b className="tr">{clock.date.slice(0, 10)} T{hms(clock.start + s)} -0500<br />BODYCAM 412</b><b className="bl dim">AI DRAMATIZATION</b></>}
        {camera === "camcorder" && <>
          <i className="ff-vf-corners" />
          <b className="tl"><i className="ff-vf-dot" />REC</b>
          <b className="tr ff-vf-batt"><i /><i /><i /></b>
          <b className="bl">SP {hms(s)}</b>
          <b className="br ff-vf-date">{stamp.date}<br />{stamp.time}</b>
        </>}
        {camera === "phone" && <><b className="tc ff-vf-timer">{hms(s)}</b><i className="ff-vf-stop" /></>}
      </span>
      {osd ? <span className="ff-vf-osd" aria-hidden="true">{osd}</span> : null}
      {children}
    </div>
  );
}

export default function FoundFootage() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  const theme = useTheme();
  const fetcher = useFetcher<typeof action>();
  // A LINK CAN OPEN IT ON A SCARE OR A CAMERA (?scare=overbed, ?camera=bodycam — a card elsewhere in the app
  // that leads here): read through the same rules as a tap, so a link can never pick a pair that cannot be filmed.
  // With no scare asked for, no card is picked: the box is empty, waiting for words or a tap
  const [params] = useSearchParams();
  const [pick, setPick] = useState<FootagePick>(() => {
    let p: FootagePick = { scare: OWN_SCARE, camera: "phone" };
    const cam = cameraLookOf(params.get("camera"));
    if (cam) p = pickCamera(p, cam);
    const asked = (params.get("scare") || "").trim().toLowerCase();
    if (asked) p = pickScare(p, asked, cam && familyOf(cam) === "hand" ? cam : "phone");
    return p;
  });
  // THE BOX — what happens, in words. A card tapped puts its own words in it, as the member reads them (their
  // language); changed, the take is theirs, written from that card
  const [own, setOwn] = useState(() => { const s = footageScare(pick.scare); return s ? t(s.premise) : ""; });
  // the hand-held camera last in hand — a hand-held scare goes back to it after a house or body-cam one
  const [lastHand, setLastHand] = useState<CameraLook>("phone");
  const [wide, setWide] = useState<"9:16" | "16:9">("16:9");
  // (null: the scare's own — "Over the bed" starts with its time-lapse on; a film's starts off: footageFilmJob)
  const [lapse, setLapse] = useState<boolean | null>(null);
  const [ir, setIr] = useState(true);
  // (the room a take of their own words is in — a house card tapped starts it in that card's room)
  const [room, setRoom] = useState<string>(() => houseScare(pick.scare)?.room || d.kept[0] || "living");
  // THE CUT: how many moments — a film of three unless they say (one is today's single take)
  const [count, setCount] = useState(3);
  const film = count > 1;
  // which step card is open (one at a time, none to start: the defaults are made to be breezed through)
  const [open, setOpen] = useState<"camera" | "cut" | "set" | null>(null);
  const tap = (k: "camera" | "cut" | "set") => setOpen((o) => (o === k ? null : k));

  const scare = footageScare(pick.scare);
  // A CARD IS A STARTER: its words changed, the take is the member's own — written from it (take.ts → cardUnchanged)
  const edited = !!scare && !cardUnchanged(own, scare.premise, t);
  // the writer writes it: their own words, with no card or from one
  const written = !scare || edited;
  const house = pick.camera === "house";
  const houseCard = house && scare ? houseScare(scare.key) : undefined;
  // (a ready-made house scare, as it is: its own room)
  const hs = edited ? undefined : houseCard;
  const lapseOn = lapse ?? (film ? false : !!houseCard?.lapseOn);
  const roomKey = hs ? hs.room : room;
  // (the room is picked here for ONE take of their own words; a film's moments each have theirs, on the reel)
  const roomPick = written && !film;
  const camName = camLook(pick.camera).name;
  const aspect = shapeFor(pick.camera, wide);
  const camOfRoom = (key: string) => { const i = d.kept.indexOf(key); return `CAM ${(i >= 0 ? i : d.kept.length) + 1}`; };

  // the box grows with its words (a card's run to a few lines on a phone) — never a box to scroll inside
  const boxIn = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const fit = () => { const el = boxIn.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight + 3}px`; };
    fit();
    // (a web font that arrives after the first measure lays the words out taller — measured again once it has)
    document.fonts?.ready.then(fit).catch(() => undefined);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [own]);
  const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // a card tapped with the box out of sight above it: the page comes up to the box, so its words are seen arriving
  const what = useRef<HTMLElement | null>(null);
  const showBox = () => window.requestAnimationFrame(() => {
    const el = what.current;
    if (!el || el.getBoundingClientRect().top >= 0) return;
    el.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  // THEIR WORDS ARE KEPT: a card tapped while the box holds the member's own words (written from a card, or from
  // nothing) puts the card's words in the box — and theirs stay one tap away ("Bring back your words") until they type
  // again. (The first build replaced them for good: a stray tap on a shelf lost a paragraph.)
  const [kept, setKept] = useState<{ words: string; pick: FootagePick } | null>(null);
  const write = (v: string) => {
    const words = v.replace(/[\r\n]+/g, " ");
    setOwn(words);
    setKept(null);
    // (the box emptied: no card is picked any more — what is written next is their own)
    if (!words.trim() && scare) setPick((p) => ({ ...p, scare: OWN_SCARE }));
  };
  const bringBack = () => { if (!kept) return; setPick(kept.pick); setOwn(kept.words); setKept(null); };
  const chooseScare = (key: string) => {
    const s = footageScare(key);
    if (!s) return;
    // (the card being changed, tapped again, keeps their words — "Undo" puts the card's back)
    if (!(pick.scare === key && edited)) {
      if (written && own.trim().length >= 8) setKept({ words: own, pick });
      setPick((p) => pickScare(p, key, lastHand));
      setOwn(t(s.premise));
      setLapse(null);
      const h = houseScare(key);
      if (h) setRoom(h.room);
    }
    showBox();
  };
  const undo = () => { if (scare) setOwn(t(scare.premise)); };
  const chooseCamera = (cam: CameraLook) => {
    if (familyOf(cam) === "hand") setLastHand(cam);
    setLapse(null);
    // THEIR WORDS ARE NEVER THROWN AWAY: a card being changed that this camera cannot film becomes their own idea
    if (edited && !fits(pick.scare, cam)) { setPick({ scare: OWN_SCARE, camera: cam }); return; }
    const next = pickCamera(pick, cam);
    setPick(next);
    // (the camera brought another card with it: that card's words take the box)
    const s = next.scare !== pick.scare ? footageScare(next.scare) : undefined;
    if (s) { setOwn(t(s.premise)); const h = houseScare(s.key); if (h) setRoom(h.room); }
  };

  /* ---- THE REEL: the footage the writer wrote, as the member is changing it ---- */
  const writer = useFetcher<typeof action>();
  const retake = useFetcher<typeof action>();
  const writing = writer.state !== "idle";
  const [reel, setReel] = useState<Reel | null>(null);
  // what the reel was written FROM (the card and the words in the box) — when that changes, the reel says so
  const ideaSig = JSON.stringify([pick.scare, own.trim()]);
  const [reelFrom, setReelFrom] = useState("");
  const sentIdea = useRef("");
  // a camera carried another way (the house's rooms cannot be walked through with a phone): written again, or not at all
  const otherCam = !!reel && familyOf(reel.camera) !== familyOf(pick.camera);
  const ideaMoved = !!reel && !otherCam && reelFrom !== ideaSig;
  const countMoved = !!reel && !otherCam && film && count !== reel.moments.length;
  // THE LAST TAP WINS: a phone's moments can be filmed on a camcorder — the frames turn into that camera's at once
  const shown: Reel | null = reel && !otherCam ? { ...reel, camera: pick.camera, aspect } : reel;
  const reelRef = useRef<HTMLElement | null>(null);
  const [armAgain, setArmAgain] = useState(false);
  const [armDel, setArmDel] = useState<string | null>(null);
  useEffect(() => { if (!armAgain) return; const id = window.setTimeout(() => setArmAgain(false), 3500); return () => window.clearTimeout(id); }, [armAgain]);
  useEffect(() => { if (!armDel) return; const id = window.setTimeout(() => setArmDel(null), 3500); return () => window.clearTimeout(id); }, [armDel]);

  // the writer's answer: the reel (and the cut follows it), brought into view
  const wrote = useRef<unknown>(null);
  useEffect(() => {
    const r = writer.data as { ok?: true; outline?: FootageOutline; error?: string } | undefined;
    if (writer.state !== "idle" || !r || wrote.current === r) return;
    wrote.current = r;
    if (!r.ok || !r.outline) return;
    setReel(reelOf(r.outline));
    setReelFrom(sentIdea.current);
    setCount(r.outline.moments.length);
    setArmAgain(false);
    setOpen(null);
    window.requestAnimationFrame(() => reelRef.current?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" }));
  }, [writer.state, writer.data]);

  // ANOTHER TAKE ON ONE MOMENT: the writer is shown the whole reel as it stands and writes that one again — found
  // afterwards by its key, wherever the member has moved it meanwhile. One at a time.
  const [retakeKey, setRetakeKey] = useState<string | null>(null);
  const [retakeErr, setRetakeErr] = useState<{ key: string; error: string } | null>(null);
  const retaking = retake.state !== "idle" || !!retakeKey;
  const askAgain = (r: Reel, key: string) => {
    if (retake.state !== "idle") return;
    // (a moment with no words yet is left out of what is posted — except this one, which says where it sits)
    const list = r.moments.filter((m) => m.key === key || filmable(m.line));
    const index = list.findIndex((m) => m.key === key);
    if (index < 0) return;
    const posted = { ...outlineOf(r, pick.camera, aspect), moments: list.map(({ key: k, ...m }) => (k === key && !filmable(m.line) ? { ...m, line: NEW_MOMENT } : m)) };
    setRetakeKey(key);
    setRetakeErr(null);
    retake.submit({ intent: "rewrite", outline: JSON.stringify(posted), index: String(index) }, { method: "post" });
  };
  const took = useRef<unknown>(null);
  useEffect(() => {
    const r = retake.data as { ok?: true; moment?: FootageMoment; error?: string } | undefined;
    if (retake.state !== "idle" || !r || took.current === r) return;
    took.current = r;
    const key = retakeKey;
    setRetakeKey(null);
    if (!key) return;
    if (r.ok && r.moment) {
      const m = r.moment;
      setReel((x) => (x ? { ...x, moments: x.moments.map((y) => (y.key === key ? { ...m, key } : y)) } : x));
    } else setRetakeErr({ key, error: r.error || t("The writer didn't answer — try again in a moment.") });
  }, [retake.state, retake.data]);

  const change = (key: string, patch: Partial<FootageMoment>) => setReel((x) => (x ? { ...x, moments: x.moments.map((m) => (m.key === key ? { ...m, ...patch } : m)) } : x));
  const move = (i: number, by: -1 | 1) => setReel((x) => {
    if (!x) return x;
    const j = i + by;
    if (j < 0 || j >= x.moments.length) return x;
    const ms = [...x.moments];
    [ms[i], ms[j]] = [ms[j], ms[i]];
    return { ...x, moments: ms };
  });
  const remove = (key: string) => {
    if (armDel !== key) { setArmDel(key); return; }
    setArmDel(null);
    if (!reel || reel.moments.length <= 2) return;
    const next = { ...reel, moments: reel.moments.filter((m) => m.key !== key) };
    setReel(next);
    setCount(next.moments.length);
  };
  // + ADD A MOMENT: one more step of the build, just before the payoff (the last moment stays the last) — and the
  // writer fills it in, free; the member can change every word of it after
  const addMoment = () => {
    if (!shown || !reel || reel.moments.length >= FOOTAGE_MAX_MOMENTS || retaking) return;
    const at = Math.max(0, reel.moments.length - 1);
    const m: ReelMoment = { key: newKey(), when: "", line: "", seconds: momentSeconds(shown.camera, undefined), ...(shown.camera === "house" ? { room: reel.moments[at]?.room || "living" } : {}) };
    const next = { ...reel, moments: [...reel.moments.slice(0, at), m, ...reel.moments.slice(at)] };
    setReel(next);
    setCount(next.moments.length);
    askAgain(next, m.key);
  };
  const keepReel = () => { setReelFrom(ideaSig); if (reel) setCount(reel.moments.length); };

  // what Roll posts: the reel, every word as they left it
  const posted = film && shown && !otherCam ? JSON.stringify(outlineOf(shown, pick.camera, aspect)) : "";
  const blank = shown ? shown.moments.findIndex((m) => !filmable(m.line)) : -1;

  // THE REC LIGHT: once a take is rolling the button says so — until a choice changes and another can be made
  const sig = JSON.stringify([pick, own.trim(), aspect, house ? [lapseOn, ir, roomKey] : 0, film ? posted : 0]);
  const [sentSig, setSentSig] = useState<string | null>(null);
  const data = fetcher.data as { ok?: true; name?: string; error?: string } | undefined;
  const busy = fetcher.state !== "idle";
  const rolling = !!data?.ok && !busy && sentSig === sig;
  const ownReady = !written || own.trim().length >= 8;
  const canGo = d.canFilm && ownReady && !busy && !rolling;
  const canWrite = d.canFilm && ownReady && !writing && !busy;
  const canRoll = d.canFilm && !!posted && blank < 0 && !retaking && !writing && !busy && !rolling;

  const heroVid = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = heroVid.current;
    if (!v || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    v.muted = true; v.play().catch(() => undefined);
  }, []);

  const settings = house || shapeChoosable(pick.camera);
  const goLabel = written ? t("Film it · {camera}", { camera: t(camName) }) : t("Film “{name}” · {camera}", { name: t(scare?.name || ""), camera: t(camName) });
  // how long it plays and how long it takes: one take's; the reel's; or the film the cut asks for, before it is written
  const plan = film ? (shown && !otherCam ? shown.moments : standIn(pick.camera, count)) : [];
  const [lo, hi] = film ? footageFilmEta({ camera: pick.camera, moments: plan }) : footageEta(pick.camera);
  const secs = film ? footageSeconds({ moments: plan }) : oneTake(pick.camera);
  const roomName = (key?: string) => t(HOUSE_ROOMS.find((r) => r.key === key)?.name || "Living room");
  // the settings card: the one that shows most (the house's night vision, else the shape), and under it the rest
  const setName = house ? (ir ? t("Night vision") : t("Lamp lit")) : aspect === "9:16" ? t("Tall") : t("Wide");
  const setSum = house ? [lapseOn ? t("Time-lapse on") : t("Time-lapse off"), roomPick ? roomName(roomKey) : ""].filter(Boolean).join(" · ") : aspect;

  // EACH FRAME'S CLOCK, from its card (the server works the film's out the same way — footage-film.ts → footageClocks)
  const today = useMemo(() => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; }, []);
  // (while the writer writes, the frames tracking are consecutive nights — what a card that says nothing gets)
  const whens = shown ? shown.moments.map((m) => m.when).join("\n") : Array.from({ length: count }, () => "").join("\n");
  const clocks = useMemo(() => footageClocks(whens.split("\n"), today, 7), [whens, today]);
  // a house camera's CAM numbers: the shop's own rooms first, then each new room in the order the film comes to it
  const houseCams = shown ? [...new Set([...d.kept, ...shown.moments.map((m) => m.room || "living")])] : d.kept;
  // (a reel written for a camera carried another way keeps its own frames until it is written again)
  const tall = (shown ? shown.aspect : aspect) === "9:16";
  const [loS, hiS] = secondsSpan(shown ? shown.camera : pick.camera);

  // THE WRITER'S FORM: what one press would film — the card, the words, the camera, how many moments
  const writeFields = (
    <>
      <input type="hidden" name="intent" value="outline" />
      <input type="hidden" name="scare" value={pick.scare} />
      <input type="hidden" name="camera" value={pick.camera} />
      <input type="hidden" name="aspect" value={aspect} />
      {own.trim() ? <input type="hidden" name="own" value={own} /> : null}
      {house && <input type="hidden" name="lapse" value={lapseOn ? "1" : "0"} />}
      {house && <input type="hidden" name="ir" value={ir ? "1" : "0"} />}
      <input type="hidden" name="moments" value={count} />
    </>
  );
  const writeErr = (writer.data as { error?: string } | undefined)?.error;

  return (
    <div className={`ff-wrap${theme === "dark" ? " ff-dark" : ""}`} data-theme={theme}>
      <style dangerouslySetInnerHTML={{ __html: FF_STYLE }} />
      {theme === "dark" && <style dangerouslySetInnerHTML={{ __html: THEATER_SHELL_CSS + FF_DARK }} />}

      <header className="ff-hero">
        <video ref={heroVid} className="ff-hero-vid" src="/landing/ff-cam-house.mp4" poster="/landing/ff-cam-house.jpg" muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
        <span className="ff-hero-scrim" aria-hidden="true" />
        <Link to="/web/film" className="ff-back"><span aria-hidden="true">‹</span> {t("Movie Maker")}</Link>
        <RecLight />
        <div className="ff-hero-copy">
          <span className="ff-eyebrow"><Ico n="camera" size={13} /> {t("Found footage")}</span>
          <b>{t("Caught on camera.")}</b>
          <span>{t("Write what happens, pick what it was shot on — we film it.")}</span>
        </div>
      </header>

      {/* 1 · WHAT WAS CAUGHT ON CAMERA? — ONE BOX, first: write it your way, or tap a card on its shelf (someone filming,
          the body cam — a scare, or a police drama — the house) and its own words arrive in the box to change. Left as
          they are: the ready-made take. Changed: the member's own, written from that card */}
      <section className="ff-card ff-what" aria-labelledby="ff-what" ref={what}>
        <h2 className="ff-lbl" id="ff-what"><span className="ff-n">1</span> <label htmlFor="ff-own-in">{t("What was caught on camera?")}</label></h2>
        <textarea id="ff-own-in" ref={boxIn} className={`ff-own-in${edited ? " is-yours" : ""}`} rows={3} maxLength={400} value={own} onChange={(e) => write(e.target.value)}
          placeholder={t("Anything a camera could catch — a haunting, the dog raiding the fridge, a meteor over the road. Or tap a card below.")} />
        {/* whose take the words make: the card's as it is, the member's version of it, or their own */}
        <div className={`ff-own-state${edited ? " is-yours" : scare ? " is-card" : ""}`}>
          <span role="status">
            {edited ? <><Ico n="pencil" size={13} /> {t("Your version of “{name}”", { name: t(scare?.name || "") })}</>
              : scare ? <><Ico n="check" size={13} /> {t("Ready-made. Change any words to make it yours.")}</>
              : t("Slow and still is what frightens. It never speaks — nobody's words are put in its mouth.")}
          </span>
          {edited && <button type="button" className="ff-undo" onClick={undo}><Ico n="refresh" size={12} /> {t("Undo")}</button>}
          {!edited && kept && <button type="button" className="ff-undo" onClick={bringBack}><Ico n="refresh" size={12} /> {t("Bring back your words")}</button>}
        </div>
        <div role="radiogroup" aria-labelledby="ff-what">
          {FOOTAGE_SHELVES.map((sh) => (
            <div className={`ff-shelf is-${sh.family}`} key={sh.family}>
              <div className="ff-shelf-h"><b>{t(sh.name)}</b><span>{t(sh.line)}</span></div>
              <div className="ff-row">
                {shelfScares(sh.family).map((s) => {
                  const on = pick.scare === s.key;
                  return (
                    <button type="button" role="radio" aria-checked={on} key={s.key} className={`ff-scare${on ? " on" : ""}`} onClick={() => chooseScare(s.key)}>
                      <span className="ff-cover">
                        <img src={s.img} alt="" loading="lazy" decoding="async" />
                        {sh.family === "worn" && <span className={`ff-tag${s.genre === "drama" ? " is-drama" : ""}`}><i aria-hidden="true" />{s.genre === "drama" ? t("Drama") : t("Horror")}</span>}
                        {/* (the card picked: a check — a pencil once its words are the member's own) */}
                        {on && <span className="ff-check" aria-hidden="true"><Ico n={edited ? "pencil" : "check"} size={13} /></span>}
                        <span className="ff-cover-name">{t(s.name)}</span>
                      </span>
                      <span className="ff-line">{t(s.line)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* THE STEP CARDS — the Movie Maker's: each says what it is set to, a tap opens it under its row */}
      <div className="ff-steps">
        {/* 2 · THE CAMERA — its card plays the camera picked */}
        <button type="button" style={{ order: 1 }} className={`ff-step ff-step-cam${open === "camera" ? " on" : ""}`} aria-expanded={open === "camera"} aria-controls="ff-p-cam" onClick={() => tap("camera")}>
          <span className="ff-step-n" aria-hidden="true">2</span>
          {/* (a new camera is a new screen: a loop keeps the clip it first fetched) */}
          <span className="ff-step-screen"><CamScreen key={pick.camera} cam={pick.camera} /></span>
          <span className="ff-step-ttl"><span className="ff-step-kick">{t("The camera")}</span><b>{t(camName)}</b><span className="ff-step-val">{t(camLook(pick.camera).line)}</span></span>
        </button>
        {open === "camera" && (
          <div className="ff-panel" id="ff-p-cam" style={{ order: 2 }}>
            <div className="ff-row" role="radiogroup" aria-label={t("The camera")}>
              {CAMERAS.map((c) => {
                const on = pick.camera === c.key;
                return (
                  <button type="button" role="radio" aria-checked={on} key={c.key} className={`ff-cam${on ? " on" : ""}`} onClick={() => chooseCamera(c.key)}>
                    <span className="ff-screen">
                      <CamScreen cam={c.key} />
                      {on && <span className="ff-check" aria-hidden="true"><Ico n="check" size={13} /></span>}
                    </span>
                    <b className="ff-cam-name">{t(c.name)}</b>
                    <span className="ff-line">{t(c.line)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {/* 3 · THE CUT — one take, or a film of up to eight moments */}
        <button type="button" style={{ order: 3 }} className={`ff-step${settings ? "" : " ff-step-wide"}${open === "cut" ? " on" : ""}`} aria-expanded={open === "cut"} aria-controls="ff-p-cut" onClick={() => tap("cut")}>
          <span className="ff-step-n" aria-hidden="true">3</span>
          <span className="ff-step-top">
            <span className="ff-step-face ff-step-counter" aria-hidden="true">{film ? `×${count}` : "×1"}</span>
            <span className="ff-step-ttl"><span className="ff-step-kick">{t("The cut")}</span><b>{film ? t("{n} moments", { n: count }) : t("One take")}</b></span>
          </span>
          <span className="ff-step-val">≈ {clockOf(secs)} · {t("ready in ~{lo}–{hi} min", { lo, hi })}</span>
        </button>
        {/* 4 · THE SETTINGS — only what this camera has */}
        {settings && (
          <button type="button" style={{ order: 4 }} className={`ff-step${open === "set" ? " on" : ""}`} aria-expanded={open === "set"} aria-controls="ff-p-set" onClick={() => tap("set")}>
            <span className="ff-step-n" aria-hidden="true">4</span>
            <span className="ff-step-top">
              <span className="ff-step-face ff-step-ico" aria-hidden="true"><Ico n={house ? "moon" : "expand"} size={19} /></span>
              <span className="ff-step-ttl"><span className="ff-step-kick">{t("The settings")}</span><b>{setName}</b></span>
            </span>
            <span className="ff-step-val">{setSum}</span>
          </button>
        )}
        {open === "cut" && (
          <div className="ff-panel" id="ff-p-cut" style={{ order: 5 }}>
            <CutStrip value={count} onChange={setCount} camera={pick.camera} written={shown && !otherCam ? shown.moments : undefined} t={t} />
            <p className="ff-panel-note">{t("One take is one moment, as it always was. Two or more is a film from the same camera: a card on black before each moment — NIGHT 2 · 3:07 AM — and each one closer than the last.")}</p>
          </div>
        )}
        {open === "set" && settings && (
          <div className="ff-panel" id="ff-p-set" style={{ order: 5 }}>
            {house ? (
              <div className="ff-sets">
                <Switch on={lapseOn} onChange={setLapse} label={t("Time-lapse")} sub={t("Hours race by on its clock while it stands there.")} />
                <Switch on={ir} onChange={setIr} label={t("Night vision")} sub={ir ? t("The camera's infrared: grey, grainy, eyes that catch the light.") : t("Off: one small lamp is lit, in colour.")} />
                {roomPick ? (
                  <div className="ff-rooms" role="radiogroup" aria-label={t("Room")}>
                    <span className="ff-sets-cap">{t("Room")}</span>
                    <div className="ff-chips">
                      {HOUSE_ROOMS.map((r) => (
                        <button type="button" role="radio" aria-checked={roomKey === r.key} key={r.key} className={`ff-chip${roomKey === r.key ? " on" : ""}${d.kept.includes(r.key) ? " kept" : ""}`} onClick={() => setRoom(r.key)}>
                          {t(r.name)}{d.kept.includes(r.key) && <em>{camOfRoom(r.key)}</em>}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <p className="ff-house-note">
                  <Ico n="eye" size={13} /> {film
                    ? t("Every moment is in a room of your house — the writer picks it and you can change it on the reel. A room is drawn once and kept.")
                    : d.kept.includes(roomKey)
                    ? t("Your house's {room}, as its camera saw it before — {cam}.", { room: t(HOUSE_ROOMS.find((r) => r.key === roomKey)?.name || ""), cam: camOfRoom(roomKey) })
                    : t("Your house gets a {room} — drawn once and kept, so every take there is the same room ({cam}).", { room: t(HOUSE_ROOMS.find((r) => r.key === roomKey)?.name || ""), cam: camOfRoom(roomKey) })}
                </p>
              </div>
            ) : (
              <div className="ff-shape">
                <span className="ff-sets-cap">{t("Shape")}</span>
                <div className="ff-seg" role="radiogroup" aria-label={t("Shape")}>
                  <button type="button" role="radio" aria-checked={aspect === "9:16"} className={aspect === "9:16" ? "on" : ""} onClick={() => setWide("9:16")}><i className="ff-shape-ico tall" aria-hidden="true" />{t("Tall")}<small>9:16</small></button>
                  <button type="button" role="radio" aria-checked={aspect === "16:9"} className={aspect === "16:9" ? "on" : ""} onClick={() => setWide("16:9")}><i className="ff-shape-ico wide" aria-hidden="true" />{t("Wide")}<small>16:9</small></button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* THE REEL — the film as recovered footage, laid out to check: a strip of moments, each a frame in its camera's
          own viewfinder with its card above it; every word the member's to change. While the writer writes it, the
          tape is tracking. */}
      {film && writing && (
        <section className="ff-reel is-writing" aria-busy="true" aria-label={t("Writing the footage…")}>
          <div className="ff-tape">
            <span className="ff-tape-stamp">{t("Recovered footage")}</span>
            <b className="ff-tape-name">{t("Writing the footage…")}</b>
            <span className="ff-tape-sum">{t("{n} moments · about half a minute", { n: count })}</span>
          </div>
          <ol className="ff-strip">
            {Array.from({ length: count }, (_, i) => (
              <li className="ff-mo" key={i} style={{ ["--i" as string]: i } as CSSProperties}>
                <div className="ff-mo-card is-blank" aria-hidden="true"><span>— · —</span></div>
                <Viewfinder camera={pick.camera} tall={aspect === "9:16"} clock={clocks[i] || clocks[0]} seconds={1} osd="◀◀ TRACKING" />
              </li>
            ))}
          </ol>
        </section>
      )}
      {film && !writing && shown && (
        <section className={`ff-reel${otherCam ? " is-other" : ""}`} ref={reelRef} aria-labelledby="ff-reel-h">
          <h2 className="ff-sr" id="ff-reel-h">{t("The footage")}</h2>
          {/* the tape's own label: what it is called, and what it comes to */}
          <div className="ff-tape">
            <span className="ff-tape-stamp">{t("Recovered footage")}</span>
            <GrowArea className="ff-tape-title" value={shown.title} maxLength={FOOTAGE_LIMITS.title} aria-label={t("Title")}
              onChange={(e) => { const v = e.target.value.replace(/[\r\n]+/g, " "); setReel((x) => (x ? { ...x, title: v } : x)); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} />
            <span className="ff-tape-sum">
              {t("{n} moments", { n: shown.moments.length })} · ≈ {clockOf(footageSeconds(shown))} · {t("ready in ~{lo}–{hi} min", { lo, hi })}
            </span>
          </div>
          {/* THE PLACE AND THE THING, said once: drawn from these words in every moment */}
          <div className="ff-case">
            <label><span>{t("The place")}</span>
              <GrowArea value={shown.place} maxLength={FOOTAGE_LIMITS.place} onChange={(e) => { const v = e.target.value.replace(/[\r\n]+/g, " "); setReel((x) => (x ? { ...x, place: v } : x)); }} />
            </label>
            <label><span>{t("Who or what")}</span>
              <GrowArea value={shown.thing} maxLength={FOOTAGE_LIMITS.thing} placeholder={t("Nothing recurs")} onChange={(e) => { const v = e.target.value.replace(/[\r\n]+/g, " "); setReel((x) => (x ? { ...x, thing: v } : x)); }} />
            </label>
          </div>
          <ol className="ff-strip">
            {shown.moments.map((m, i) => {
              const mine = retakeKey === m.key;
              const err = retakeErr?.key === m.key ? retakeErr.error : "";
              const clock = clocks[i] || clocks[0];
              const n = i + 1;
              return (
                <li className={`ff-mo${mine ? " is-retaking" : ""}`} key={m.key}>
                  <div className="ff-mo-bar">
                    <span className="ff-mo-n">{t("Moment {n}", { n })}{i === shown.moments.length - 1 ? <em> · {t("the payoff")}</em> : null}</span>
                    <span className="ff-mo-moves">
                      <button type="button" className="ff-ico-btn" onClick={() => move(i, -1)} disabled={i === 0 || mine} aria-label={t("Move moment {n} earlier", { n })}>↑</button>
                      <button type="button" className="ff-ico-btn" onClick={() => move(i, 1)} disabled={i === shown.moments.length - 1 || mine} aria-label={t("Move moment {n} later", { n })}>↓</button>
                      <button type="button" className={`ff-ico-btn ff-del${armDel === m.key ? " is-arm" : ""}`} onClick={() => remove(m.key)} disabled={shown.moments.length <= 2 || mine}
                        aria-label={armDel === m.key ? t("Tap again to remove moment {n}", { n }) : t("Remove moment {n}", { n })}>
                        {armDel === m.key ? t("Remove?") : <Ico n="x" size={14} />}
                      </button>
                    </span>
                  </div>
                  {/* ITS CARD, as the film shows it: white on black — tap to retype */}
                  <label className="ff-mo-card">
                    <span className="ff-sr">{t("The card before moment {n}", { n })}</span>
                    <input value={m.when} maxLength={FOOTAGE_LIMITS.when} placeholder={`NIGHT ${n}`} disabled={mine}
                      onChange={(e) => change(m.key, { when: e.target.value.toUpperCase() })}
                      onBlur={(e) => change(m.key, { when: cardWords(e.target.value) || `NIGHT ${n}` })} />
                  </label>
                  {/* ITS FRAME — the line set in it like a caption on evidence: tap it to rewrite it */}
                  <Viewfinder camera={shown.camera} tall={tall} clock={clock} seconds={m.seconds} cam={shown.camera === "house" ? `CAM ${houseCams.indexOf(m.room || "living") + 1}` : undefined} osd={mine ? "◀◀ REWIND" : undefined}>
                    <GrowArea className="ff-vf-line" value={m.line} maxLength={FOOTAGE_LIMITS.line} disabled={mine} aria-label={t("What the camera catches in moment {n}", { n })}
                      placeholder={t("What the camera catches…")} onChange={(e) => change(m.key, { line: e.target.value.replace(/[\r\n]+/g, " ") })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} />
                  </Viewfinder>
                  <div className="ff-mo-tools">
                    <button type="button" className="ff-dicebtn" onClick={() => reel && askAgain(reel, m.key)} disabled={retaking || writing || otherCam}>
                      <Dice /> {mine ? t("Rewinding…") : t("Another take")}
                    </button>
                    <span className="ff-secs" role="group" aria-label={t("Seconds of moment {n}", { n })}>
                      <button type="button" onClick={() => change(m.key, { seconds: Math.max(loS, m.seconds - 1) })} disabled={m.seconds <= loS || mine} aria-label={t("Shorter")}>−</button>
                      <b>{t("{n} s", { n: m.seconds })}</b>
                      <button type="button" onClick={() => change(m.key, { seconds: Math.min(hiS, m.seconds + 1) })} disabled={m.seconds >= hiS || mine} aria-label={t("Longer")}>+</button>
                    </span>
                    {shown.camera === "house" && (
                      <select className="ff-room-pick" value={m.room || "living"} disabled={mine} aria-label={t("Room of moment {n}", { n })} onChange={(e) => change(m.key, { room: e.target.value })}>
                        {HOUSE_ROOMS.map((r) => <option key={r.key} value={r.key}>{t(r.name)}</option>)}
                      </select>
                    )}
                  </div>
                  {err && <p className="ff-mo-err" role="alert">{err}</p>}
                </li>
              );
            })}
          </ol>
          {shown.moments.length < FOOTAGE_MAX_MOMENTS && !otherCam && (
            <button type="button" className="ff-add" onClick={addMoment} disabled={retaking || writing}>
              <b>+ {t("Add a moment")}</b><small>{t("just before the payoff · the writer fills it in, free")}</small>
            </button>
          )}
        </section>
      )}

      {/* THE BUTTON — one take: today's, exactly. A film: write it (free), then roll the reel as it stands */}
      <section className="ff-card ff-go-card">
        {!film ? (
          <fetcher.Form method="post" onSubmit={() => setSentSig(sig)}>
            <input type="hidden" name="intent" value="take" />
            <input type="hidden" name="scare" value={pick.scare} />
            <input type="hidden" name="camera" value={pick.camera} />
            <input type="hidden" name="aspect" value={aspect} />
            {/* the words in the box, always — the server decides whether they are still the card's (footageJob) */}
            {own.trim() ? <input type="hidden" name="own" value={own} /> : null}
            {house && <input type="hidden" name="lapse" value={lapseOn ? "1" : "0"} />}
            {house && <input type="hidden" name="ir" value={ir ? "1" : "0"} />}
            {house && <input type="hidden" name="room" value={roomKey} />}
            <button type="submit" className={`ff-go${rolling ? " is-rolling" : ""}`} disabled={!canGo}>
              {busy ? <>… {t("Starting your take")}</>
                : rolling ? <><i className="ff-go-dot" aria-hidden="true" /> {t("REC — rolling. It lands in your Archive.")}</>
                : <><i className="ff-go-dot" aria-hidden="true" /> {goLabel}</>}
            </button>
          </fetcher.Form>
        ) : !shown || otherCam ? (
          // A FILM, NOT YET WRITTEN: the writer writes the moments — free; nothing is filmed until the reel is rolled
          <writer.Form method="post" onSubmit={() => { sentIdea.current = ideaSig; }}>
            {writeFields}
            <button type="submit" className="ff-go ff-go-write" disabled={!canWrite}>
              {writing ? <>… {t("Writing the footage…")}</> : <><Ico n="pencil" size={17} /> {t("Write the footage — free")}</>}
            </button>
          </writer.Form>
        ) : (
          // THE REEL, ROLLED: the outline as the member left it — the server cleans it again (footageFilmJob)
          <fetcher.Form method="post" onSubmit={() => setSentSig(sig)}>
            <input type="hidden" name="intent" value="film" />
            <input type="hidden" name="scare" value={pick.scare} />
            <input type="hidden" name="camera" value={pick.camera} />
            <input type="hidden" name="aspect" value={aspect} />
            {own.trim() ? <input type="hidden" name="own" value={own} /> : null}
            {house && <input type="hidden" name="lapse" value={lapseOn ? "1" : "0"} />}
            {house && <input type="hidden" name="ir" value={ir ? "1" : "0"} />}
            <input type="hidden" name="outline" value={posted} />
            <button type="submit" className={`ff-go${rolling ? " is-rolling" : ""}`} disabled={!canRoll}>
              {busy ? <>… {t("Starting your take")}</>
                : rolling ? <><i className="ff-go-dot" aria-hidden="true" /> {t("REC — rolling. It lands in your Archive.")}</>
                : <><i className="ff-go-dot" aria-hidden="true" /> {t("Roll the footage · {n} moments", { n: shown.moments.length })}</>}
            </button>
          </fetcher.Form>
        )}
        <div className="ff-eta"><span aria-hidden="true">⏱</span> {t("Est. render time")} <b>{t("~{lo}–{hi} min", { lo, hi })}</b> · {aspect}</div>
        {/* a reel that is no longer what the box and the cut say: say so — written again (it replaces the reel), or kept */}
        {film && reel && otherCam && <p className="ff-stale" role="status">{t("These moments were written for the {camera} — write them again for this camera.", { camera: t(camLook(reel.camera).name) })}</p>}
        {film && shown && !otherCam && !rolling && (
          <div className={`ff-again${ideaMoved || countMoved ? " is-moved" : ""}`}>
            {(ideaMoved || countMoved) && (
              <p role="status">
                {ideaMoved ? t("Your idea has changed since this reel was written.") : null}{ideaMoved && countMoved ? " " : null}
                {countMoved ? t("The reel has {n} moments — the cut says {m}.", { n: shown.moments.length, m: count }) : null}
              </p>
            )}
            <writer.Form method="post" onSubmit={() => { sentIdea.current = ideaSig; setArmAgain(false); }}>
              {writeFields}
              <button type={armAgain ? "submit" : "button"} className={`ff-again-btn${armAgain ? " is-arm" : ""}`} disabled={!canWrite} onClick={() => { if (!armAgain) setArmAgain(true); }}>
                <Ico n="refresh" size={13} /> {armAgain ? t("Tap again — this replaces the reel") : t("Write it again — free")}
              </button>
              {(ideaMoved || countMoved) && <button type="button" className="ff-again-btn" onClick={keepReel}><Ico n="check" size={13} /> {t("Keep this reel")}</button>}
            </writer.Form>
          </div>
        )}
        {rolling ? (
          <p className="ff-ok"><Ico n="check" size={14} /> {t("Rolling! It lands in your Archive when it's done — you can keep working.")} <Link to="/web/archive">{t("Open the Archive")}</Link></p>
        ) : film && !shown ? (
          <p className="ff-note">{t("Free: we write the moments and you check every one — nothing is filmed until you roll it.")}</p>
        ) : (
          <p className="ff-note">{t("Free while we build it. Only you can see this page until it has a name and a price.")}</p>
        )}
        {!d.hasPlan && <p className="ff-err">{t("Pick a plan on the Dashboard first — film runs on tokens.")}</p>}
        {d.hasPlan && !d.canFilm && <p className="ff-err">{t("Your plan doesn't include video yet — upgrade to make films.")}</p>}
        {written && !ownReady && <p className="ff-hint ff-hint-c">{t("Say what happens, in a few words.")}</p>}
        {film && shown && !otherCam && blank >= 0 && <p className="ff-hint ff-hint-c">{t("Moment {n} has no words yet — write what the camera catches, or remove it.", { n: blank + 1 })}</p>}
        {film && writeErr && !writing && <p className="ff-err" role="alert">{writeErr}</p>}
        {data?.error && <p className="ff-err" role="alert">{data.error}</p>}
      </section>
    </div>
  );
}

/* ---- THE PAGE'S LOOK: the Movie Maker's cream cards and green, with the footage in black screens ---- */
const FF_STYLE = `
.ff-wrap{max-width:760px;margin:0 auto;--ff-rec:#E5483A;--ff-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-family:Inter,-apple-system,sans-serif;color:var(--ink,#14201A);}
.ff-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}
/* the hero: a house camera's few seconds, the REC light, and the page's name */
.ff-hero{position:relative;overflow:hidden;height:176px;border-radius:20px;margin:0 0 14px;background:#0B0D0C;box-shadow:0 20px 44px -26px rgba(8,62,39,.6);isolation:isolate;}
.ff-hero-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 70%;filter:saturate(.8);}
.ff-hero-scrim{position:absolute;inset:0;background:linear-gradient(0deg,rgba(6,10,8,.92) 0%,rgba(6,10,8,.55) 42%,rgba(6,10,8,.12) 72%,rgba(6,10,8,.35) 100%);}
.ff-back{position:absolute;z-index:2;top:12px;left:12px;display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:0 12px;border-radius:999px;background:rgba(255,253,247,.12);border:1px solid rgba(255,253,247,.32);color:#FFFDF7;font:700 12.5px/1 Poppins,sans-serif;text-decoration:none;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
.ff-back::after{content:"";position:absolute;inset:-6px -4px;}
.ff-back:hover{background:rgba(255,253,247,.2);}
.ff-rec{position:absolute;z-index:2;top:14px;right:14px;display:inline-flex;align-items:center;gap:6px;font:700 12px/1 var(--ff-mono);letter-spacing:.06em;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.7);}
.ff-rec i{width:9px;height:9px;border-radius:50%;background:var(--ff-rec);box-shadow:0 0 8px rgba(229,72,58,.8);animation:ffblink 1.2s steps(1,end) infinite;}
.ff-rec b{font-weight:700;opacity:.92;}
@keyframes ffblink{0%{opacity:1}58%{opacity:.15}}
.ff-hero-copy{position:absolute;z-index:2;left:16px;right:16px;bottom:14px;display:flex;flex-direction:column;gap:3px;color:#FFFDF7;}
.ff-eyebrow{display:inline-flex;align-items:center;gap:6px;font:800 10.5px/1 Poppins,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#E7C879;}
.ff-hero-copy b{font:800 23px/1.12 Poppins,sans-serif;letter-spacing:-.02em;}
.ff-hero-copy>span:last-child{font-size:13px;line-height:1.4;color:#D8D4C6;max-width:440px;}
/* the cards */
.ff-card{background:linear-gradient(180deg,#fff,#FDFCF8);border:1px solid var(--line,#E4DFCF);border-radius:20px;padding:14px 14px 16px;margin:0 0 12px;box-shadow:0 2px 4px rgba(20,32,26,.03),0 14px 32px rgba(20,32,26,.05);}
.ff-lbl{display:flex;align-items:center;gap:9px;margin:0 0 11px;font:800 15px/1.2 Poppins,sans-serif;letter-spacing:-.01em;color:var(--ink,#14201A);}
.ff-n{display:inline-grid;place-items:center;width:25px;height:25px;border-radius:999px;background:linear-gradient(135deg,var(--green,#0C7A46),var(--green2,#1FA463));color:#fff;font-size:13px;box-shadow:0 3px 9px rgba(12,122,70,.3);}
/* the shelves of "What was caught on camera?" — the cards that start a take: one per way a camera is carried */
.ff-shelf{margin:0 0 8px;}
.ff-shelf-h{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 8px;margin:0 2px 7px;}
.ff-shelf-h b{font:800 11.5px/1.2 Poppins,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:var(--ink,#14201A);}
.ff-shelf-h span{font-size:11.5px;line-height:1.3;color:var(--ink2,#4A554E);}
/* a row that scrolls sideways, a card at a time */
.ff-row{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;padding:2px 2px 8px;margin:0 -2px;scrollbar-width:thin;}
@media(hover:none) and (pointer:coarse){.ff-row{scrollbar-width:none;}.ff-row::-webkit-scrollbar{display:none;}}
.ff-scare,.ff-cam{position:relative;flex:0 0 128px;scroll-snap-align:start;display:flex;flex-direction:column;gap:7px;text-align:left;padding:0;border:0;background:none;font:inherit;color:inherit;cursor:pointer;}
.ff-cover{position:relative;display:block;aspect-ratio:4/5;border-radius:14px;overflow:hidden;background:#151A17;border:1.5px solid var(--line,#E4DFCF);transition:transform .16s,box-shadow .16s,border-color .16s;}
.ff-cover img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .4s cubic-bezier(.2,.7,.2,1);}
.ff-cover::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(6,14,10,.92) 0%,rgba(6,14,10,.5) 26%,transparent 56%);pointer-events:none;}
.ff-scare:hover .ff-cover{transform:translateY(-2px);box-shadow:0 12px 24px -14px rgba(20,32,26,.4);}
.ff-scare:hover .ff-cover img{transform:scale(1.05);}
.ff-scare.on .ff-cover,.ff-cam.on .ff-screen{border-color:var(--green,#0C7A46);box-shadow:0 0 0 2px var(--green,#0C7A46),0 16px 30px -18px rgba(12,122,70,.6);}
.ff-cover-name{position:absolute;z-index:2;left:9px;right:9px;bottom:8px;font:800 14.5px/1.12 Poppins,sans-serif;letter-spacing:-.015em;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.7);}
.ff-tag{position:absolute;z-index:2;top:7px;left:7px;display:inline-flex;align-items:center;gap:4px;padding:3px 7px 3px 6px;border-radius:6px;background:rgba(8,10,9,.62);color:#F2EFE6;font:700 10.5px/1.1 var(--ff-mono);letter-spacing:.04em;text-transform:uppercase;}
.ff-tag i{width:6px;height:6px;border-radius:50%;background:var(--ff-rec);}
.ff-tag.is-drama i{background:#4C8DFF;}
.ff-check{position:absolute;z-index:3;top:7px;right:7px;width:23px;height:23px;border-radius:50%;background:var(--green,#0C7A46);color:#fff;display:grid;place-items:center;box-shadow:0 4px 10px -3px rgba(0,0,0,.5);}
.ff-line{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:11.5px;font-weight:600;line-height:1.36;color:var(--ink2,#4A554E);padding:0 2px;}
/* 1 · the box: what was caught, in words — first, always there; a card's own words arrive in it (16px: a phone never
   zooms in on it) */
.ff-what{scroll-margin-top:12px;}
.ff-own-in{display:block;width:100%;box-sizing:border-box;min-height:84px;border:1.5px solid var(--line,#E4DFCF);border-radius:14px;padding:11px 13px;font:inherit;font-size:16px;line-height:1.45;color:var(--ink,#14201A);background:#fff;resize:none;box-shadow:inset 0 1px 2px rgba(20,32,26,.05);transition:border-color .15s,box-shadow .15s,background .15s;}
.ff-own-in::placeholder{color:#7E8882;}
.ff-own-in:focus{outline:none;border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ff-own-in.is-yours{border-color:#BFE3CC;background:#F7FCF9;}
/* whose take the words make: the card's as it is, the member's version of it, or their own */
.ff-own-state{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin:8px 2px 14px;min-height:24px;font-size:12px;line-height:1.4;color:var(--ink2,#4A554E);}
.ff-own-state>span{flex:1 1 200px;min-width:0;display:inline-flex;align-items:center;gap:6px;}
.ff-own-state svg{flex:none;color:var(--green,#0C7A46);}
.ff-own-state.is-card>span{font-weight:600;}
.ff-own-state.is-yours>span{font-weight:700;color:var(--green,#0C7A46);}
.ff-undo{position:relative;flex:none;display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:0 12px;border:1.5px solid var(--line,#E4DFCF);border-radius:999px;background:#fff;font:700 12px/1 Poppins,sans-serif;color:var(--ink,#14201A);cursor:pointer;}
.ff-undo::after{content:"";position:absolute;inset:-6px -3px;}
.ff-undo:hover{border-color:var(--green,#0C7A46);color:var(--green,#0C7A46);}
.ff-hint{font-size:12px;line-height:1.4;color:var(--ink2,#4A554E);}
.ff-hint-c{text-align:center;margin:6px 0 0;}
/* THE STEP CARDS — the Movie Maker's .mm-card, two to a row; a card opens its panel under its row */
.ff-steps{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 12px;}
.ff-step{position:relative;display:flex;flex-direction:column;justify-content:space-between;min-width:0;min-height:100px;text-align:left;cursor:pointer;background:linear-gradient(180deg,#fff,#FDFCF8);border:1.5px solid var(--line,#E4DFCF);border-radius:18px;padding:13px 14px;font:inherit;color:inherit;box-shadow:0 1px 2px rgba(20,32,26,.04),0 12px 26px -20px rgba(20,32,26,.25);transition:transform .16s cubic-bezier(.2,.7,.2,1),box-shadow .16s,border-color .16s;}
.ff-step:hover{border-color:var(--green2,#1EA85C);box-shadow:0 10px 26px -18px rgba(20,32,26,.3);}
.ff-step.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 14px 30px -20px rgba(12,122,70,.4);}
.ff-step-cam,.ff-step-wide{grid-column:1 / -1;}
.ff-step-cam{flex-direction:row;align-items:center;justify-content:flex-start;gap:13px;min-height:0;padding:11px 44px 11px 11px;}
.ff-step-n{position:absolute;top:11px;right:11px;width:25px;height:25px;border-radius:50%;background:#EFF1EE;color:var(--ink3,#7E8882);font:800 12.5px/1 Poppins,sans-serif;display:grid;place-items:center;}
.ff-step.on .ff-step-n{background:var(--green,#0C7A46);color:#fff;}
.ff-step-screen{position:relative;flex:none;width:118px;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#050605;box-shadow:0 8px 18px -10px rgba(0,0,0,.6);}
.ff-step-top{display:flex;flex-direction:column;align-items:flex-start;gap:9px;min-width:0;}
.ff-step-wide .ff-step-top{flex-direction:row;align-items:center;gap:11px;padding-right:30px;}
.ff-step-face{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;box-shadow:0 6px 14px -6px rgba(0,0,0,.45);}
.ff-step-counter{background:#121412;color:#E7C879;font:800 14px/1 var(--ff-mono);letter-spacing:-.02em;box-shadow:inset 0 0 0 1px rgba(231,200,121,.35),0 6px 14px -6px rgba(0,0,0,.45);}
.ff-step-ico{background:linear-gradient(135deg,#3E6FB0,#274C86);color:#fff;}
.ff-step-ico svg{stroke:#fff;}
.ff-step-ttl{display:flex;flex-direction:column;min-width:0;}
.ff-step-kick{display:block;font:800 10.5px/1.2 Poppins,sans-serif;color:var(--ink3,#7E8882);text-transform:uppercase;letter-spacing:.06em;}
.ff-step-ttl b{display:block;font:800 15.5px/1.15 Poppins,sans-serif;letter-spacing:-.01em;color:var(--ink,#14201A);overflow-wrap:break-word;}
.ff-step-val{display:block;margin:9px 0 0;font-size:12.5px;line-height:1.38;color:var(--ink2,#4A554E);text-wrap:balance;}
.ff-step-cam .ff-step-val{margin:3px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.ff-panel{grid-column:1 / -1;min-width:0;background:var(--panel,#FDFBF4);border:1.5px solid var(--green,#0C7A46);border-radius:18px;padding:14px;box-shadow:0 0 0 1px rgba(12,122,70,.12),0 16px 36px -24px rgba(12,122,70,.4);}
.ff-panel .ff-row{margin-bottom:-6px;}
.ff-panel-note{margin:12px 2px 0;font-size:12px;line-height:1.45;color:var(--ink2,#4A554E);}
/* a camera's card: a little black screen with its own few seconds in it, in its own shape */
.ff-cam{flex-basis:132px;}
.ff-screen{position:relative;display:block;height:104px;border-radius:12px;overflow:hidden;background:#050605;border:1.5px solid var(--line,#E4DFCF);transition:box-shadow .16s,border-color .16s;}
.ff-screen-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;}
.ff-step-screen .ff-screen-vid{object-fit:cover;}
.ff-cam:hover .ff-screen{box-shadow:0 12px 24px -14px rgba(20,32,26,.45);}
.ff-cam-name{font:800 13.5px/1.15 Poppins,sans-serif;color:var(--ink,#14201A);padding:0 2px;}
.ff-cam .ff-line{-webkit-line-clamp:2;}
/* THE CUT: a strip of film, eight frames, lit to the thumb — a real range input over it, the size of a finger */
.ff-cut-read{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;margin:0 2px 10px;}
.ff-cut-count{font:800 21px/1.1 Poppins,sans-serif;letter-spacing:-.02em;color:var(--ink,#14201A);font-variant-numeric:tabular-nums;}
.ff-cut-est{font:700 12.5px/1.3 Inter,sans-serif;color:var(--ink2,#4A554E);font-variant-numeric:tabular-nums;}
.ff-cut-strip{position:relative;height:66px;}
.ff-cut-film{position:absolute;inset:0;display:grid;grid-template-columns:repeat(8,1fr);gap:4px;padding:13px 4px;border-radius:10px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='8'%3E%3Crect x='4' y='1.5' width='8' height='5' rx='1.6' fill='%23EDE6D2' fill-opacity='.85'/%3E%3C/svg%3E") repeat-x 0 2px/16px 8px,url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='8'%3E%3Crect x='4' y='1.5' width='8' height='5' rx='1.6' fill='%23EDE6D2' fill-opacity='.85'/%3E%3C/svg%3E") repeat-x 0 calc(100% - 2px)/16px 8px,#141614;box-shadow:inset 0 0 0 1px rgba(0,0,0,.4),0 10px 22px -14px rgba(0,0,0,.7);}
.ff-cut-film i{position:relative;display:block;border-radius:3px;background:#262A27;transition:background .18s,box-shadow .18s,transform .18s;}
.ff-cut-film i b{position:absolute;left:4px;bottom:3px;font:700 9.5px/1 var(--ff-mono);color:#6B716C;}
.ff-cut-film i.lit{background:linear-gradient(160deg,#F7EBC4,#E7C879 55%,#C8973A);}
.ff-cut-film i.lit b{color:#5A4512;}
.ff-cut-film i.at{box-shadow:0 0 0 2px var(--ff-rec),0 0 16px rgba(229,72,58,.55);transform:scale(1.06);}
.ff-cut-film i.at::after{content:"";position:absolute;top:4px;right:4px;width:6px;height:6px;border-radius:50%;background:var(--ff-rec);animation:ffblink 1.2s steps(1,end) infinite;}
.ff-cut-in{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;-webkit-appearance:none;appearance:none;background:transparent;}
.ff-cut-in::-webkit-slider-thumb{-webkit-appearance:none;width:44px;height:66px;}
.ff-cut-in::-moz-range-thumb{width:44px;height:66px;border:0;}
.ff-cut-strip:has(.ff-cut-in:focus-visible) .ff-cut-film{outline:3px solid rgba(12,122,70,.45);outline-offset:3px;}
.ff-cut-ends{display:flex;justify-content:space-between;gap:10px;margin:7px 2px 0;font:700 11px/1.2 Poppins,sans-serif;color:var(--ink3,#7E8882);}
/* settings */
.ff-sets{display:flex;flex-direction:column;gap:8px;}
.ff-sw{display:flex;align-items:center;gap:12px;width:100%;min-height:58px;padding:9px 12px;border:1.5px solid var(--line,#E4DFCF);border-radius:14px;background:#fff;text-align:left;font:inherit;color:inherit;cursor:pointer;transition:border-color .15s,background .15s;}
.ff-sw.on{border-color:#BFE3CC;background:#F4FBF6;}
.ff-sw-txt{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}
.ff-sw-txt b{font:800 14px/1.2 Poppins,sans-serif;color:var(--ink,#14201A);}
.ff-sw-txt span{font-size:12px;line-height:1.35;color:var(--ink2,#4A554E);}
.ff-sw-knob{flex:none;position:relative;width:46px;height:28px;border-radius:999px;background:#D9D6CB;transition:background .18s;}
.ff-sw-knob i{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 2px 5px rgba(0,0,0,.25);transition:transform .18s cubic-bezier(.2,.8,.2,1);}
.ff-sw.on .ff-sw-knob{background:var(--green,#0C7A46);}
.ff-sw.on .ff-sw-knob i{transform:translateX(18px);}
.ff-sets-cap{display:block;margin:2px 2px 6px;font:800 12px/1 Poppins,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2,#4A554E);}
.ff-chips{display:flex;flex-wrap:wrap;gap:6px;}
.ff-chip{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border-radius:999px;border:1.5px solid var(--line,#E4DFCF);background:#fff;font:800 13px/1 Poppins,sans-serif;color:var(--ink,#14201A);cursor:pointer;}
.ff-chip em{font:700 10.5px/1 var(--ff-mono);font-style:normal;letter-spacing:.04em;color:var(--green,#0C7A46);background:var(--mint,#EAF6EF);border-radius:5px;padding:3px 5px;}
.ff-chip.on{background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);color:#fff;}
.ff-chip.on em{background:rgba(255,255,255,.2);color:#fff;}
.ff-house-note{display:flex;align-items:flex-start;gap:7px;margin:2px 2px 0;font-size:12px;line-height:1.42;color:var(--ink2,#4A554E);}
.ff-house-note svg{flex:none;margin-top:2px;color:var(--green,#0C7A46);}
.ff-shape{display:flex;flex-direction:column;}
.ff-seg{display:inline-flex;align-self:flex-start;gap:6px;background:#F3EFE2;border:1px solid var(--line,#E4DFCF);border-radius:12px;padding:4px;}
.ff-seg button{display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 16px;border:0;border-radius:9px;background:transparent;font:800 13.5px/1 Poppins,sans-serif;color:var(--ink,#14201A);cursor:pointer;}
.ff-seg button small{font:700 10.5px/1 Inter,sans-serif;color:var(--ink2,#6B756E);}
.ff-seg button.on{background:#fff;color:var(--green,#0C7A46);box-shadow:0 1px 3px rgba(20,32,26,.14),inset 0 0 0 1px rgba(12,122,70,.5);}
.ff-shape-ico{display:inline-block;border:2px solid currentColor;border-radius:3px;}
.ff-shape-ico.tall{width:10px;height:16px;}
.ff-shape-ico.wide{width:18px;height:11px;}
/* THE REEL — recovered tape: black in both themes. Its label, the place and the thing, and a strip of frames with
   sprocket holes down both edges */
.ff-reel{position:relative;margin:0 0 12px;padding:16px 0 14px;border-radius:20px;background:radial-gradient(120% 60% at 50% 0%,#1B1E1C,#0C0E0D 70%);color:#EDE9DD;box-shadow:0 26px 50px -30px rgba(0,0,0,.85),inset 0 0 0 1px rgba(255,255,255,.04);scroll-margin-top:12px;overflow:hidden;}
.ff-reel.is-other{opacity:.55;}
.ff-tape{position:relative;margin:0 14px;padding:12px 14px 11px;border-radius:6px;background:repeating-linear-gradient(180deg,transparent 0 23px,rgba(70,92,140,.16) 23px 24px),linear-gradient(180deg,#F5EEDA,#EDE3C8);color:#1D1B15;transform:rotate(-.5deg);box-shadow:0 10px 22px -12px rgba(0,0,0,.9),inset 0 0 0 1px rgba(0,0,0,.06);}
.ff-tape::before{content:"";position:absolute;top:-7px;left:50%;width:64px;height:15px;margin-left:-32px;background:rgba(245,238,218,.55);transform:rotate(2deg);box-shadow:0 1px 2px rgba(0,0,0,.25);}
.ff-tape-stamp{display:inline-block;padding:3px 7px;border:1.5px solid #B3261E;border-radius:3px;color:#B3261E;font:800 10.5px/1 var(--ff-mono);letter-spacing:.16em;text-transform:uppercase;transform:rotate(-2deg);opacity:.9;}
.ff-tape-title,.ff-tape-name{display:block;width:100%;box-sizing:border-box;margin:7px 0 3px;padding:3px 0;border:0;border-bottom:1.5px dashed rgba(29,27,21,.28);background:transparent;font:800 20px/1.2 Poppins,sans-serif;letter-spacing:-.015em;color:#1D1B15;border-radius:0;resize:none;overflow:hidden;}
.ff-tape-title{min-height:44px;padding:9px 0 7px;}
.ff-tape-title:focus{outline:none;border-bottom-color:#B3261E;}
.ff-tape-sum{display:block;font:700 12.5px/1.35 var(--ff-mono);color:#4C473A;font-variant-numeric:tabular-nums;}
.ff-case{display:grid;gap:10px;margin:14px 14px 0;}
.ff-case label{display:block;min-width:0;}
.ff-case label>span{display:block;margin:0 0 5px;font:800 10.5px/1 var(--ff-mono);letter-spacing:.16em;text-transform:uppercase;color:#E7C879;}
.ff-case textarea{display:block;width:100%;box-sizing:border-box;min-height:44px;resize:none;overflow:hidden;padding:8px 10px;border:1px solid rgba(237,233,221,.16);border-radius:8px;background:rgba(255,255,255,.04);color:#EDE9DD;font:500 16px/1.42 Inter,sans-serif;}
.ff-case textarea::placeholder{color:rgba(237,233,221,.45);}
.ff-case textarea:focus{outline:none;border-color:rgba(231,200,121,.7);background:rgba(255,255,255,.07);}
.ff-strip{position:relative;list-style:none;margin:16px 0 0;padding:4px 24px;background:#151715;}
.ff-strip::before,.ff-strip::after{content:"";position:absolute;top:0;bottom:0;width:14px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='24'%3E%3Crect x='2' y='6' width='10' height='12' rx='2.6' fill='%23E9E2CE' fill-opacity='.82'/%3E%3C/svg%3E") repeat-y 0 0/14px 24px;pointer-events:none;}
.ff-strip::before{left:5px;}
.ff-strip::after{right:5px;}
.ff-mo{position:relative;padding:14px 0 16px;border-bottom:1px solid rgba(237,233,221,.1);}
.ff-mo:last-child{border-bottom:0;}
.ff-mo-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 6px;}
.ff-mo-n{font:800 11px/1.2 var(--ff-mono);letter-spacing:.12em;text-transform:uppercase;color:#E7C879;}
.ff-mo-n em{font-style:normal;color:#F08A7E;}
.ff-mo-moves{display:flex;gap:4px;}
.ff-ico-btn{display:inline-grid;place-items:center;min-width:44px;height:44px;padding:0 8px;border:1px solid rgba(237,233,221,.18);border-radius:10px;background:rgba(255,255,255,.05);color:#EDE9DD;font:800 16px/1 Inter,sans-serif;cursor:pointer;}
.ff-ico-btn:hover:not(:disabled){border-color:rgba(231,200,121,.7);color:#fff;}
.ff-ico-btn:disabled{opacity:.3;cursor:default;}
.ff-ico-btn svg{stroke:currentColor;}
.ff-del.is-arm{background:#B3261E;border-color:#B3261E;color:#fff;font:800 12.5px/1 Poppins,sans-serif;}
/* ITS CARD — as the film shows it: white capitals on black, in the camera's mono face */
.ff-mo-card{display:block;margin:0 0 6px;border-radius:5px;background:#000;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);}
.ff-mo-card input{display:block;width:100%;box-sizing:border-box;height:54px;padding:0 10px;border:0;border-radius:5px;background:transparent;color:#fff;text-align:center;font:700 17px/1 var(--ff-mono);letter-spacing:.12em;text-transform:uppercase;}
.ff-mo-card input::placeholder{color:rgba(255,255,255,.35);}
.ff-mo-card input:focus{outline:1.5px dashed rgba(255,255,255,.45);outline-offset:-7px;}
.ff-mo-card.is-blank{display:grid;place-items:center;height:54px;color:rgba(255,255,255,.35);font:700 15px/1 var(--ff-mono);letter-spacing:.2em;}
/* ITS FRAME, in its camera's own viewfinder (the marks each camera burns in: camera-dress.ts) */
/* (its shape is a MINIMUM: the line sits in the frame's flow, between the camera's top marks and its bottom ones — a
   long line makes the frame taller rather than covering a mark) */
.ff-vf{position:relative;display:flex;flex-direction:column;justify-content:flex-end;width:100%;box-sizing:border-box;aspect-ratio:16/9;padding:8% 4% 7%;border-radius:4px;background:#0B0C0B;isolation:isolate;container-type:inline-size;}
.ff-vf.is-tall{aspect-ratio:9/16;width:min(100%,216px);margin:0 auto;padding:21% 5% 27%;}
.ff-vf.is-bodycam{padding-top:13%;}
.ff-vf.is-camcorder{padding-top:10%;padding-bottom:14%;}
.ff-vf.is-bare{padding:4%;}
.ff-vf-screen{position:absolute;inset:0;z-index:0;overflow:hidden;border-radius:inherit;pointer-events:none;}
.ff-vf-screen i{position:absolute;inset:0;display:block;}
.is-house .ff-vf-pic{background:radial-gradient(70% 55% at 56% 62%,rgba(222,228,224,.3),rgba(222,228,224,0) 70%),radial-gradient(120% 100% at 50% 50%,#4A4F4C 0%,#262A28 50%,#0D0F0E 100%);}
.is-bodycam .ff-vf-pic{background:radial-gradient(34% 44% at 60% 58%,rgba(255,244,214,.5),rgba(255,244,214,.08) 60%,rgba(255,244,214,0) 75%),linear-gradient(180deg,#12151B,#07080A);}
.is-camcorder .ff-vf-pic{background:radial-gradient(90% 80% at 45% 52%,#47392A 0%,#1D1812 60%,#0B0907 100%);filter:saturate(1.1);}
.is-phone .ff-vf-pic{background:radial-gradient(80% 60% at 50% 58%,#343A37 0%,#151817 62%,#08090A 100%);}
.is-bare .ff-vf-pic{background:radial-gradient(100% 85% at 50% 50%,#38352F,#0E0D0B);}
.ff-vf-screen .ff-vf-grain{inset:-60%;opacity:.2;mix-blend-mode:screen;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .7 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E") 0 0/140px 140px;animation:ffgrain .6s steps(3) infinite;}
.is-phone .ff-vf-screen .ff-vf-grain{opacity:.07;}
@keyframes ffgrain{0%{transform:translate(0,0)}33%{transform:translate(-7%,4%)}66%{transform:translate(5%,-6%)}100%{transform:translate(0,0)}}
.ff-vf-scan{background:repeating-linear-gradient(0deg,rgba(0,0,0,.2) 0 1px,transparent 1px 3px);}
.is-phone .ff-vf-scan{background:none;}
.ff-vf-scan::after{content:"";position:absolute;left:0;right:0;top:-25%;height:25%;background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.045),rgba(255,255,255,0));animation:ffroll 7s linear infinite;}
@keyframes ffroll{to{transform:translateY(500%)}}
.ff-vf-hud{position:absolute;inset:0;z-index:3;pointer-events:none;color:#fff;font:700 clamp(9px,3.3cqi,14px)/1.2 var(--ff-mono);letter-spacing:.02em;text-shadow:0 0 2px #000,0 1px 1px #000;}
.ff-vf-hud b{position:absolute;font-weight:700;white-space:nowrap;}
.ff-vf-hud .tl{top:5%;left:4%;}
.ff-vf-hud .tr{top:5%;right:4%;text-align:right;}
.ff-vf-hud .bl{bottom:5%;left:4%;}
.ff-vf-hud .br{bottom:5%;right:4%;text-align:right;}
.ff-vf-hud .tc{top:4%;left:50%;transform:translateX(-50%);}
.ff-vf-hud .dim{opacity:.72;font-size:.82em;}
.is-house .ff-vf-hud{font-size:clamp(9px,3.6cqi,15px);}
.ff-vf-dot{display:inline-block;width:.62em;height:.62em;margin:0 .35em .05em 0;border-radius:50%;background:var(--ff-rec);vertical-align:baseline;animation:ffblink 1.2s steps(1,end) infinite;}
.ff-vf-batt{display:flex;gap:2px;padding:2px 3px;border:1.5px solid #fff;border-radius:2px;}
.ff-vf-batt::after{content:"";position:absolute;right:-4px;top:30%;width:2px;height:40%;background:#fff;}
.ff-vf-batt i{display:block;width:.42em;height:.7em;background:#fff;}
.ff-vf-date{color:#FFC15A;}
.is-camcorder .ff-vf-hud .tl,.is-camcorder .ff-vf-hud .bl{left:7%;}
.is-camcorder .ff-vf-hud .tr,.is-camcorder .ff-vf-hud .br{right:7%;}
.is-camcorder .ff-vf-hud .tl,.is-camcorder .ff-vf-hud .tr{top:7.5%;}
.is-camcorder .ff-vf-hud .bl,.is-camcorder .ff-vf-hud .br{bottom:7.5%;}
.ff-vf-corners{position:absolute;inset:3.5%;border:0;}
.ff-vf-corners::before,.ff-vf-corners::after{content:"";position:absolute;inset:0;border:2px solid rgba(255,255,255,.9);clip-path:polygon(0 0,9% 0,9% 2px,2px 2px,2px 12%,0 12%,0 0,100% 0,100% 12%,calc(100% - 2px) 12%,calc(100% - 2px) 2px,91% 2px,91% 0);}
.ff-vf-corners::after{transform:scaleY(-1);}
.ff-vf-timer{padding:.22em .55em;border-radius:5px;background:#E5483A;color:#fff;text-shadow:none;}
.ff-vf-stop{position:absolute;left:50%;bottom:3.5%;width:13cqi;height:13cqi;max-width:44px;max-height:44px;margin-left:-6.5cqi;border-radius:50%;border:2px solid rgba(255,255,255,.92);box-sizing:border-box;}
.ff-vf-stop::after{content:"";position:absolute;inset:26%;border-radius:3px;background:#E5483A;}
.ff-vf-osd{position:absolute;z-index:5;top:50%;left:50%;transform:translate(-50%,-50%);padding:.35em .6em;background:rgba(10,26,140,.55);color:#fff;font:800 clamp(11px,4.4cqi,18px)/1 var(--ff-mono);letter-spacing:.12em;white-space:nowrap;animation:ffblink 1.1s steps(1,end) infinite;}
/* the line, set in the frame like a caption on evidence — a box to write in, the moment it is tapped */
.ff-vf-line{position:relative;z-index:4;display:block;width:100%;box-sizing:border-box;resize:none;overflow:hidden;margin:0;padding:6px 9px;border:1px solid transparent;border-radius:3px;background:rgba(0,0,0,.6);color:#F6F2E6;font:600 16px/1.35 var(--ff-mono);letter-spacing:-.02em;cursor:text;transition:background .15s,border-color .15s;}
.is-tall .ff-vf-line{letter-spacing:-.04em;}
.ff-vf-line:hover{border-color:rgba(255,255,255,.22);}
.ff-vf-line:focus{outline:none;background:rgba(0,0,0,.82);border-color:rgba(231,200,121,.85);box-shadow:0 0 0 3px rgba(231,200,121,.2);}
.ff-vf-line::placeholder{color:rgba(246,242,230,.5);}
.ff-mo.is-retaking .ff-vf-line{opacity:.25;}
/* the moment's own tools: another take, its seconds, its room */
.ff-mo-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:9px 0 0;}
.ff-dicebtn{display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 14px;border:1px solid rgba(231,200,121,.5);border-radius:12px;background:rgba(231,200,121,.08);color:#F3DFA6;font:800 13.5px/1 Poppins,sans-serif;cursor:pointer;}
.ff-dicebtn:hover:not(:disabled){background:rgba(231,200,121,.16);}
.ff-dicebtn:hover:not(:disabled) .ff-dice{transform:rotate(-18deg);}
.ff-dicebtn:disabled{opacity:.4;cursor:default;}
.ff-dice{transition:transform .25s cubic-bezier(.2,.8,.2,1);}
.ff-mo.is-retaking .ff-dice{animation:ffroll2 .7s linear infinite;}
@keyframes ffroll2{to{transform:rotate(360deg)}}
.ff-secs{display:inline-flex;align-items:center;margin-left:auto;border:1px solid rgba(237,233,221,.18);border-radius:12px;overflow:hidden;}
.ff-secs button{width:44px;height:44px;border:0;background:rgba(255,255,255,.05);color:#EDE9DD;font:800 18px/1 Inter,sans-serif;cursor:pointer;}
.ff-secs button:disabled{opacity:.3;cursor:default;}
.ff-secs b{min-width:46px;text-align:center;font:700 14px/1 var(--ff-mono);color:#fff;font-variant-numeric:tabular-nums;}
.ff-room-pick{flex:1 1 100%;min-height:44px;padding:0 10px;border:1px solid rgba(237,233,221,.18);border-radius:12px;background:#1C1F1D;color:#EDE9DD;font:600 16px/1 Inter,sans-serif;}
.ff-mo-err{margin:8px 0 0;font-size:12.5px;font-weight:600;color:#F08A7E;}
.ff-add{display:flex;flex-direction:column;align-items:center;gap:4px;width:calc(100% - 28px);margin:12px 14px 0;min-height:60px;padding:10px 12px;border:1.5px dashed rgba(231,200,121,.5);border-radius:14px;background:transparent;color:#F3DFA6;cursor:pointer;font:inherit;}
.ff-add b{font:800 14.5px/1.2 Poppins,sans-serif;}
.ff-add small{font-size:11.5px;color:rgba(237,233,221,.6);}
.ff-add:hover:not(:disabled){background:rgba(231,200,121,.07);}
.ff-add:disabled{opacity:.4;cursor:default;}
.ff-reel.is-writing .ff-mo{animation:ffin .5s ease-out both;animation-delay:calc(var(--i,0) * 140ms);}
@keyframes ffin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
/* the button */
.ff-go-card{border-color:transparent;box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 18px 40px rgba(12,122,70,.12);}
.ff-go{position:relative;overflow:hidden;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:56px;padding:14px 16px;border:0;border-radius:15px;background:linear-gradient(135deg,#0C7A46,#15B165 55%,#1EA85C);color:#fff;font:800 16px/1.25 Poppins,sans-serif;letter-spacing:-.01em;text-align:center;cursor:pointer;box-shadow:0 14px 30px -14px rgba(12,122,70,.7),inset 0 1px 0 rgba(255,255,255,.25);}
.ff-go::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.42),transparent);transform:skewX(-18deg);animation:ffsheen 4.5s ease-in-out infinite;pointer-events:none;}
@keyframes ffsheen{0%,55%{left:-60%}100%{left:130%}}
.ff-go:disabled{filter:grayscale(.55) brightness(.92);opacity:.75;cursor:default;box-shadow:none;}
.ff-go:disabled::after{display:none;}
.ff-go-dot{flex:none;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.28);}
.ff-go svg{stroke:#fff;}
/* rolling: the button is the camera's own REC light */
.ff-go.is-rolling:disabled{filter:none;opacity:1;background:#141816;color:#F4F1E8;box-shadow:inset 0 0 0 1.5px rgba(229,72,58,.55);}
.ff-go.is-rolling .ff-go-dot{background:var(--ff-rec);box-shadow:0 0 10px rgba(229,72,58,.85);animation:ffblink 1.2s steps(1,end) infinite;}
.ff-eta{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px;margin:9px 0 0;font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E);}
.ff-eta b{font-weight:800;color:var(--ink,#14201A);}
.ff-note{margin:6px 0 0;text-align:center;font-size:12px;line-height:1.4;color:var(--ink2,#4A554E);}
.ff-ok{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;margin:9px 0 0;font-size:13px;font-weight:700;color:var(--green,#0C7A46);text-align:center;}
.ff-ok a{color:var(--green,#0C7A46);text-decoration:underline;text-underline-offset:2px;}
.ff-err{margin:8px 0 0;text-align:center;font-size:12.5px;font-weight:600;color:#B3421E;}
.ff-stale{margin:9px 0 0;text-align:center;font-size:12.5px;font-weight:700;line-height:1.4;color:#9A5B12;}
/* the reel written again (it replaces the reel: a second tap), or kept as it is */
.ff-again{margin:10px 0 0;text-align:center;}
.ff-again p{margin:0 0 7px;font-size:12.5px;font-weight:700;line-height:1.4;color:#9A5B12;}
.ff-again form{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;}
.ff-again-btn{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border:1.5px solid var(--line,#E4DFCF);border-radius:999px;background:#fff;font:800 12.5px/1 Poppins,sans-serif;color:var(--ink,#14201A);cursor:pointer;}
.ff-again-btn svg{stroke:currentColor;}
.ff-again-btn:hover:not(:disabled){border-color:var(--green,#0C7A46);color:var(--green,#0C7A46);}
.ff-again-btn.is-arm{border-color:#B3261E;background:#FFF3F1;color:#B3261E;}
.ff-again-btn:disabled{opacity:.5;cursor:default;}
.ff-again.is-moved .ff-again-btn:first-child{border-color:var(--green,#0C7A46);color:var(--green,#0C7A46);}
.ff-scare:focus-visible .ff-cover,.ff-cam:focus-visible .ff-screen,.ff-sw:focus-visible,.ff-chip:focus-visible,.ff-seg button:focus-visible,.ff-undo:focus-visible,.ff-go:focus-visible,.ff-step:focus-visible,.ff-again-btn:focus-visible{outline:3px solid rgba(12,122,70,.4);outline-offset:2px;}
.ff-ico-btn:focus-visible,.ff-dicebtn:focus-visible,.ff-secs button:focus-visible,.ff-add:focus-visible,.ff-room-pick:focus-visible{outline:3px solid rgba(231,200,121,.75);outline-offset:2px;}
@media(min-width:640px){.ff-hero{height:210px;}.ff-hero-copy b{font-size:28px;}.ff-card{padding:18px 20px;}.ff-scare{flex-basis:150px;}.ff-cam{flex-basis:150px;}.ff-screen{height:116px;}.ff-step-screen{width:150px;}.ff-reel{padding:20px 0 18px;}.ff-tape,.ff-case{margin-left:22px;margin-right:22px;}.ff-case{grid-template-columns:1fr 1fr;}.ff-strip{padding:6px 44px;}.ff-vf:not(.is-tall){width:min(100%,560px);margin:0 auto;}.ff-vf.is-tall{width:min(100%,290px);}.ff-mo-card{max-width:560px;margin-left:auto;margin-right:auto;}.ff-mo-bar,.ff-mo-tools{max-width:560px;margin-left:auto;margin-right:auto;}.ff-add{width:calc(100% - 44px);margin-left:22px;margin-right:22px;}.ff-room-pick{flex:0 1 200px;}}
@media(prefers-reduced-motion:reduce){.ff-rec i,.ff-go.is-rolling .ff-go-dot,.ff-cut-film i.at::after,.ff-vf-dot,.ff-vf-osd,.ff-vf-grain,.ff-vf-scan::after,.ff-mo.is-retaking .ff-dice,.ff-reel.is-writing .ff-mo{animation:none;}.ff-go::after{animation:none;display:none;}.ff-cover,.ff-cover img,.ff-sw-knob i,.ff-cut-film i,.ff-dice,.ff-step{transition:none;}}
`;

/* ---- THE DARK: the shell's (lib/theater-shell.ts) goes dark; every card here stays the cream card it is and
   gets the gold edge the Movie Maker's cards have. The reel is tape, black in either. Every rule names this page
   (.ff-dark). ---- */
const FF_DARK = `
.ff-dark .ff-hero{box-shadow:0 0 0 1px rgba(231,200,121,.45),0 0 0 6px rgba(231,200,121,.07),0 34px 64px -34px #000;}
.ff-dark .ff-back{border-color:rgba(231,200,121,.5);}
.ff-dark .ff-card{box-shadow:0 0 0 1px rgba(231,200,121,.5),0 22px 40px -28px #000;}
.ff-dark .ff-go-card{box-shadow:0 0 0 1.5px #E7C879,0 22px 40px -28px #000;}
.ff-dark .ff-step{border-color:rgba(231,200,121,.55);box-shadow:0 22px 40px -28px #000;}
.ff-dark .ff-step.on{border-color:#E7C879;box-shadow:0 0 0 1.5px #E7C879,0 22px 40px -28px #000;}
.ff-dark .ff-panel{border-color:#E7C879;box-shadow:0 22px 40px -28px #000;}
.ff-dark .ff-reel{box-shadow:0 0 0 1px rgba(231,200,121,.45),0 30px 56px -30px #000;}
.ff-dark .ff-back:focus-visible{outline:2px solid #E7C879;outline-offset:2px;}
.ff-dark .ff-step:focus-visible{outline:3px solid #E7C879;outline-offset:2px;}
`;
