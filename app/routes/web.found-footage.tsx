/* FOUND FOOTAGE — the builder. One screen: what happens, what it was shot on, the settings that apply to that
 * camera, one button; the take lands in the Archive.
 *
 * The owner, 2026-11-24: "Would be cool to also get a \"found Footage\" style pipeline, that would do blair witch
 * style creatives" — "make it easymode and selectable good UI interface" — "Found footage from house camera POVs
 * also" — "if we put it as a scene setting it would maximize easiness" — "What about body cam footage".
 *
 *   WHAT HAPPENS   the ready-made scares as picture cards (take.ts → FOOTAGE_SCARES: the handheld ones, the body
 *                  cam's, the house's), and "Describe your own".
 *   THE CAMERA     Phone · Camcorder · No overlay · House camera · Body cam — each card plays a few seconds of a
 *                  real take dressed as that camera. A scare is written for one kind of camera (held, worn, on the
 *                  wall): the LAST TAP WINS and the other choice follows (take.ts → pickScare / pickCamera), and the
 *                  button always names the pair it will film — never a card that cannot be pressed.
 *   SETTINGS       only where they apply: the house camera's Time-lapse (hours race by on its clock while the thing
 *                  stands still), Night vision, and — for an idea of your own — the room; the shape for the two
 *                  cameras that can shoot either (the shape follows the camera: phone tall, house and body cam wide).
 *   THE BUTTON     names the take, says how long it takes, and turns into a REC light once it is rolling.
 *
 * ADMIN-ONLY until the owner names and prices this tier (as the character shows were — web.channels.tsx): to
 * anybody else the page does not exist, and its action refuses. A take is not charged meanwhile.
 *
 * Light by default; in the dark theme the shell goes dark (lib/theater-shell.ts) and the cards stay the cream
 * cards they are, with a gold edge — the Movie Maker's rule. */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { db } from "../db.server";
import { requireWebIdentity } from "../lib/web-auth.server";
import { isAdminEmail } from "../lib/admin.server";
import { capabilitiesFor } from "../lib/capabilities.server";
import { enqueueJob } from "../lib/job-queue.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { useT } from "../lib/ui-lang";
import { Ico } from "../lib/icons";
import { CAMERA_LOOKS, cameraLookOf, type CameraLook } from "../lib/camera-dress";
import { HOUSE_ROOMS, houseScare } from "../lib/house-cam";
import { FOOTAGE_SHELVES, OWN_SCARE, familyOf, footageEta, footageJob, footageScare, pickCamera, pickScare, shapeChoosable, shapeFor, shelfScares, type FootagePick } from "../lib/take";
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = readUiLang(request);
  const { account, shop } = await requireWebIdentity(request);
  if (!isAdminEmail(account.email)) return json({ error: "Not found" }, { status: 404 });
  const form = await request.formData();
  if (String(form.get("intent") || "") !== "take") return json({ error: tr(lang, "Unknown action.") }, { status: 400 });
  if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan on the Dashboard first — film runs on tokens.") });
  if (!capabilitiesFor(shop.activePlan).has("creatorvideo")) return json({ error: tr(lang, "Your plan doesn't include video yet — upgrade to make films.") });
  const job = footageJob({ scare: form.get("scare"), own: form.get("own"), camera: form.get("camera"), aspect: form.get("aspect"), lapse: form.get("lapse"), ir: form.get("ir"), room: form.get("room") });
  if (!job.ok) return json({ error: tr(lang, job.error) }, { status: 400 });
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

export default function FoundFootage() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  const theme = useTheme();
  const fetcher = useFetcher<typeof action>();
  // A LINK CAN OPEN IT ON A SCARE OR A CAMERA (?scare=overbed, ?camera=bodycam — a card elsewhere in the app
  // that leads here): read through the same rules as a tap, so a link can never pick a pair that cannot be filmed
  const [params] = useSearchParams();
  const [pick, setPick] = useState<FootagePick>(() => {
    let p: FootagePick = { scare: "smile", camera: "phone" };
    const cam = cameraLookOf(params.get("camera"));
    if (cam) p = pickCamera(p, cam);
    const asked = (params.get("scare") || "").trim().toLowerCase();
    if (asked) p = pickScare(p, asked, cam && familyOf(cam) === "hand" ? cam : "phone");
    return p;
  });
  // the hand-held camera last in hand — a hand-held scare goes back to it after a house or body-cam one
  const [lastHand, setLastHand] = useState<CameraLook>("phone");
  const [own, setOwn] = useState("");
  const [wide, setWide] = useState<"9:16" | "16:9">("16:9");
  // (null: the scare's own — "Over the bed" starts with its time-lapse on)
  const [lapse, setLapse] = useState<boolean | null>(null);
  const [ir, setIr] = useState(true);
  const [room, setRoom] = useState<string>(d.kept[0] || "living");

  const scare = footageScare(pick.scare);
  const isOwn = pick.scare === OWN_SCARE;
  const house = pick.camera === "house";
  const hs = house && scare ? houseScare(scare.key) : undefined;
  const lapseOn = lapse ?? !!hs?.lapseOn;
  const roomKey = hs ? hs.room : room;
  const camName = CAMERA_LOOKS.find((c) => c.key === pick.camera)?.name || "Phone";
  const aspect = shapeFor(pick.camera, wide);
  const [lo, hi] = footageEta(pick.camera);
  const camOfRoom = (key: string) => { const i = d.kept.indexOf(key); return `CAM ${(i >= 0 ? i : d.kept.length) + 1}`; };

  const chooseScare = (key: string) => { setPick((p) => pickScare(p, key, lastHand)); setLapse(null); };
  const chooseCamera = (cam: CameraLook) => {
    if (familyOf(cam) === "hand") setLastHand(cam);
    setPick((p) => pickCamera(p, cam));
    setLapse(null);
  };

  // THE REC LIGHT: once a take is rolling the button says so — until a choice changes and another can be made
  const sig = JSON.stringify([pick, isOwn ? own.trim() : "", aspect, house ? [lapseOn, ir, roomKey] : 0]);
  const [sentSig, setSentSig] = useState<string | null>(null);
  const data = fetcher.data as { ok?: true; name?: string; error?: string } | undefined;
  const busy = fetcher.state !== "idle";
  const rolling = !!data?.ok && !busy && sentSig === sig;
  const ownReady = !isOwn || own.trim().length >= 8;
  const canGo = d.canFilm && ownReady && !busy && !rolling;

  const heroVid = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = heroVid.current;
    if (!v || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    v.muted = true; v.play().catch(() => undefined);
  }, []);

  const settings = house || shapeChoosable(pick.camera);
  const goLabel = isOwn ? t("Film it · {camera}", { camera: t(camName) }) : t("Film “{name}” · {camera}", { name: t(scare?.name || ""), camera: t(camName) });

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
          <span>{t("Pick what happens and what it was shot on — we film it.")}</span>
        </div>
      </header>

      {/* 1 · WHAT HAPPENS — on its shelves: someone filming, the body cam (a scare, or a police drama), the house */}
      <section className="ff-card" aria-labelledby="ff-what">
        <h2 className="ff-lbl" id="ff-what"><span className="ff-n">1</span> {t("What happens")}</h2>
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
                        {on && <span className="ff-check" aria-hidden="true"><Ico n="check" size={13} /></span>}
                        <span className="ff-cover-name">{t(s.name)}</span>
                      </span>
                      <span className="ff-line">{t(s.line)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {/* your own idea: any camera — one wide button under the shelves */}
          <button type="button" role="radio" aria-checked={isOwn} className={`ff-own${isOwn ? " on" : ""}`} onClick={() => chooseScare(OWN_SCARE)}>
            <span className="ff-own-ico" aria-hidden="true"><Ico n="pencil" size={18} /></span>
            <span className="ff-own-txt"><b>{t("Describe your own")}</b><span>{t("Any camera. We write it the way the scares that work are written.")}</span></span>
            {isOwn && <span className="ff-check ff-check-in" aria-hidden="true"><Ico n="check" size={13} /></span>}
          </button>
        </div>
        {isOwn && (
          <div className="ff-own-box">
            <label htmlFor="ff-own-in">{t("What happens?")}</label>
            <textarea id="ff-own-in" className="ff-own-in" rows={2} maxLength={400} value={own} onChange={(e) => setOwn(e.target.value.replace(/[\r\n]+/g, " "))}
              placeholder={t("e.g. my sister sleepwalks into the kitchen — but it isn't her")} />
            <span className="ff-hint">{t("Slow and still is what frightens. It never speaks — nobody's words are put in its mouth.")}</span>
          </div>
        )}
      </section>

      {/* 2 · THE CAMERA */}
      <section className="ff-card" aria-labelledby="ff-cam">
        <h2 className="ff-lbl" id="ff-cam"><span className="ff-n">2</span> {t("The camera")}</h2>
        <div className="ff-row" role="radiogroup" aria-labelledby="ff-cam">
          {CAMERA_LOOKS.map((c) => {
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
      </section>

      {/* 3 · SCENE SETTINGS — only the ones this camera has */}
      {settings && (
        <section className="ff-card" aria-labelledby="ff-set">
          <h2 className="ff-lbl" id="ff-set"><span className="ff-n">3</span> {t("Scene settings")}</h2>
          {house ? (
            <div className="ff-sets">
              <Switch on={lapseOn} onChange={setLapse} label={t("Time-lapse")} sub={t("Hours race by on its clock while it stands there.")} />
              <Switch on={ir} onChange={setIr} label={t("Night vision")} sub={ir ? t("The camera's infrared: grey, grainy, eyes that catch the light.") : t("Off: one small lamp is lit, in colour.")} />
              {isOwn ? (
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
                <Ico n="eye" size={13} /> {d.kept.includes(roomKey)
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
        </section>
      )}

      {/* THE BUTTON */}
      <section className="ff-card ff-go-card">
        <fetcher.Form method="post" onSubmit={() => setSentSig(sig)}>
          <input type="hidden" name="intent" value="take" />
          <input type="hidden" name="scare" value={pick.scare} />
          <input type="hidden" name="camera" value={pick.camera} />
          <input type="hidden" name="aspect" value={aspect} />
          {isOwn && <input type="hidden" name="own" value={own} />}
          {house && <input type="hidden" name="lapse" value={lapseOn ? "1" : "0"} />}
          {house && <input type="hidden" name="ir" value={ir ? "1" : "0"} />}
          {house && <input type="hidden" name="room" value={roomKey} />}
          <button type="submit" className={`ff-go${rolling ? " is-rolling" : ""}`} disabled={!canGo}>
            {busy ? <>… {t("Starting your take")}</>
              : rolling ? <><i className="ff-go-dot" aria-hidden="true" /> {t("REC — rolling. It lands in your Archive.")}</>
              : <><i className="ff-go-dot" aria-hidden="true" /> {goLabel}</>}
          </button>
        </fetcher.Form>
        <div className="ff-eta"><span aria-hidden="true">⏱</span> {t("Est. render time")} <b>{t("~{lo}–{hi} min", { lo, hi })}</b> · {aspect}</div>
        {rolling ? (
          <p className="ff-ok"><Ico n="check" size={14} /> {t("Rolling! It lands in your Archive when it's done — you can keep working.")} <Link to="/web/archive">{t("Open the Archive")}</Link></p>
        ) : (
          <p className="ff-note">{t("Free while we build it. Only you can see this page until it has a name and a price.")}</p>
        )}
        {!d.hasPlan && <p className="ff-err">{t("Pick a plan on the Dashboard first — film runs on tokens.")}</p>}
        {d.hasPlan && !d.canFilm && <p className="ff-err">{t("Your plan doesn't include video yet — upgrade to make films.")}</p>}
        {isOwn && !ownReady && <p className="ff-hint ff-hint-c">{t("Say what happens, in a few words.")}</p>}
        {data?.error && <p className="ff-err" role="alert">{data.error}</p>}
      </section>
    </div>
  );
}

/* ---- THE PAGE'S LOOK: the Movie Maker's cream cards and green, with the footage in black screens ---- */
const FF_STYLE = `
.ff-wrap{max-width:760px;margin:0 auto;--ff-rec:#E5483A;font-family:Inter,-apple-system,sans-serif;color:var(--ink,#14201A);}
/* the hero: a house camera's few seconds, the REC light, and the page's name */
.ff-hero{position:relative;overflow:hidden;height:176px;border-radius:20px;margin:0 0 14px;background:#0B0D0C;box-shadow:0 20px 44px -26px rgba(8,62,39,.6);isolation:isolate;}
.ff-hero-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 70%;filter:saturate(.8);}
.ff-hero-scrim{position:absolute;inset:0;background:linear-gradient(0deg,rgba(6,10,8,.92) 0%,rgba(6,10,8,.55) 42%,rgba(6,10,8,.12) 72%,rgba(6,10,8,.35) 100%);}
.ff-back{position:absolute;z-index:2;top:12px;left:12px;display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:0 12px;border-radius:999px;background:rgba(255,253,247,.12);border:1px solid rgba(255,253,247,.32);color:#FFFDF7;font:700 12.5px/1 Poppins,sans-serif;text-decoration:none;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
.ff-back::after{content:"";position:absolute;inset:-6px -4px;}
.ff-back:hover{background:rgba(255,253,247,.2);}
.ff-rec{position:absolute;z-index:2;top:14px;right:14px;display:inline-flex;align-items:center;gap:6px;font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.06em;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.7);}
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
/* the shelves of "What happens": one per way a camera is carried */
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
.ff-tag{position:absolute;z-index:2;top:7px;left:7px;display:inline-flex;align-items:center;gap:4px;padding:3px 7px 3px 6px;border-radius:6px;background:rgba(8,10,9,.62);color:#F2EFE6;font:700 10.5px/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em;text-transform:uppercase;}
.ff-tag i{width:6px;height:6px;border-radius:50%;background:var(--ff-rec);}
.ff-tag.is-drama i{background:#4C8DFF;}
.ff-check{position:absolute;z-index:3;top:7px;right:7px;width:23px;height:23px;border-radius:50%;background:var(--green,#0C7A46);color:#fff;display:grid;place-items:center;box-shadow:0 4px 10px -3px rgba(0,0,0,.5);}
.ff-line{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:11.5px;font-weight:600;line-height:1.36;color:var(--ink2,#4A554E);padding:0 2px;}
/* describe your own: one wide button under the shelves */
.ff-own{position:relative;display:flex;align-items:center;gap:12px;width:100%;min-height:58px;margin:4px 0 0;padding:9px 12px;border:1.5px dashed var(--green,#0C7A46);border-radius:14px;background:linear-gradient(160deg,#F3FAF5,#E3F2E9);text-align:left;font:inherit;color:inherit;cursor:pointer;}
.ff-own.on{border-style:solid;box-shadow:0 0 0 1.5px var(--green,#0C7A46);}
.ff-own-ico{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#fff;color:var(--green,#0C7A46);box-shadow:0 5px 12px -6px rgba(12,122,70,.45);}
.ff-own-txt{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}
.ff-own-txt b{font:800 14px/1.2 Poppins,sans-serif;color:var(--green,#0C7A46);}
.ff-own-txt span{font-size:11.5px;line-height:1.35;color:var(--ink2,#4A554E);}
.ff-check.ff-check-in{position:static;flex:none;}
.ff-own-box{display:flex;flex-direction:column;gap:6px;margin-top:10px;}
.ff-own-box label{font:800 13px/1.2 Poppins,sans-serif;color:var(--ink,#14201A);}
.ff-own-in{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:12px;padding:10px 12px;font:inherit;font-size:14.5px;line-height:1.45;color:var(--ink,#14201A);background:#fff;resize:vertical;}
.ff-own-in:focus{outline:none;border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ff-hint{font-size:12px;line-height:1.4;color:var(--ink2,#4A554E);}
.ff-hint-c{text-align:center;margin:6px 0 0;}
/* a camera's card: a little black screen with its own few seconds in it, in its own shape */
.ff-cam{flex-basis:132px;}
.ff-screen{position:relative;display:block;height:104px;border-radius:12px;overflow:hidden;background:#050605;border:1.5px solid var(--line,#E4DFCF);transition:box-shadow .16s,border-color .16s;}
.ff-screen-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;}
.ff-cam:hover .ff-screen{box-shadow:0 12px 24px -14px rgba(20,32,26,.45);}
.ff-cam-name{font:800 13.5px/1.15 Poppins,sans-serif;color:var(--ink,#14201A);padding:0 2px;}
.ff-cam .ff-line{-webkit-line-clamp:2;}
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
.ff-chip{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:999px;border:1.5px solid var(--line,#E4DFCF);background:#fff;font:800 13px/1 Poppins,sans-serif;color:var(--ink,#14201A);cursor:pointer;}
.ff-chip em{font:700 10.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-style:normal;letter-spacing:.04em;color:var(--green,#0C7A46);background:var(--mint,#EAF6EF);border-radius:5px;padding:3px 5px;}
.ff-chip.on{background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);color:#fff;}
.ff-chip.on em{background:rgba(255,255,255,.2);color:#fff;}
.ff-house-note{display:flex;align-items:flex-start;gap:7px;margin:2px 2px 0;font-size:12px;line-height:1.42;color:var(--ink2,#4A554E);}
.ff-house-note svg{flex:none;margin-top:2px;color:var(--green,#0C7A46);}
.ff-shape{display:flex;flex-direction:column;}
.ff-seg{display:inline-flex;align-self:flex-start;gap:6px;background:#F3EFE2;border:1px solid var(--line,#E4DFCF);border-radius:12px;padding:4px;}
.ff-seg button{display:inline-flex;align-items:center;gap:7px;min-height:42px;padding:0 16px;border:0;border-radius:9px;background:transparent;font:800 13.5px/1 Poppins,sans-serif;color:var(--ink,#14201A);cursor:pointer;}
.ff-seg button small{font:700 10.5px/1 Inter,sans-serif;color:var(--ink2,#6B756E);}
.ff-seg button.on{background:#fff;color:var(--green,#0C7A46);box-shadow:0 1px 3px rgba(20,32,26,.14),inset 0 0 0 1px rgba(12,122,70,.5);}
.ff-shape-ico{display:inline-block;border:2px solid currentColor;border-radius:3px;}
.ff-shape-ico.tall{width:10px;height:16px;}
.ff-shape-ico.wide{width:18px;height:11px;}
/* the button */
.ff-go-card{border-color:transparent;box-shadow:0 0 0 1.5px var(--green,#0C7A46),0 18px 40px rgba(12,122,70,.12);}
.ff-go{position:relative;overflow:hidden;width:100%;display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:56px;padding:14px 16px;border:0;border-radius:15px;background:linear-gradient(135deg,#0C7A46,#15B165 55%,#1EA85C);color:#fff;font:800 16px/1.25 Poppins,sans-serif;letter-spacing:-.01em;text-align:center;cursor:pointer;box-shadow:0 14px 30px -14px rgba(12,122,70,.7),inset 0 1px 0 rgba(255,255,255,.25);}
.ff-go::after{content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.42),transparent);transform:skewX(-18deg);animation:ffsheen 4.5s ease-in-out infinite;pointer-events:none;}
@keyframes ffsheen{0%,55%{left:-60%}100%{left:130%}}
.ff-go:disabled{filter:grayscale(.55) brightness(.92);opacity:.75;cursor:default;box-shadow:none;}
.ff-go:disabled::after{display:none;}
.ff-go-dot{flex:none;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.28);}
/* rolling: the button is the camera's own REC light */
.ff-go.is-rolling:disabled{filter:none;opacity:1;background:#141816;color:#F4F1E8;box-shadow:inset 0 0 0 1.5px rgba(229,72,58,.55);}
.ff-go.is-rolling .ff-go-dot{background:var(--ff-rec);box-shadow:0 0 10px rgba(229,72,58,.85);animation:ffblink 1.2s steps(1,end) infinite;}
.ff-eta{display:flex;align-items:center;justify-content:center;gap:6px;margin:9px 0 0;font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E);}
.ff-eta b{font-weight:800;color:var(--ink,#14201A);}
.ff-note{margin:6px 0 0;text-align:center;font-size:12px;line-height:1.4;color:var(--ink2,#4A554E);}
.ff-ok{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;margin:9px 0 0;font-size:13px;font-weight:700;color:var(--green,#0C7A46);text-align:center;}
.ff-ok a{color:var(--green,#0C7A46);text-decoration:underline;text-underline-offset:2px;}
.ff-err{margin:8px 0 0;text-align:center;font-size:12.5px;font-weight:600;color:#B3421E;}
.ff-scare:focus-visible .ff-cover,.ff-cam:focus-visible .ff-screen,.ff-sw:focus-visible,.ff-chip:focus-visible,.ff-seg button:focus-visible,.ff-go:focus-visible{outline:3px solid rgba(12,122,70,.4);outline-offset:2px;}
@media(min-width:640px){.ff-hero{height:210px;}.ff-hero-copy b{font-size:28px;}.ff-card{padding:18px 20px;}.ff-scare{flex-basis:150px;}.ff-cam{flex-basis:150px;}.ff-screen{height:116px;}}
@media(prefers-reduced-motion:reduce){.ff-rec i,.ff-go.is-rolling .ff-go-dot{animation:none;}.ff-go::after{animation:none;display:none;}.ff-cover,.ff-cover img,.ff-sw-knob i{transition:none;}}
`;

/* ---- THE DARK: the shell's (lib/theater-shell.ts) goes dark; every card here stays the cream card it is and
   gets the gold edge the Movie Maker's cards have. Every rule names this page (.ff-dark). ---- */
const FF_DARK = `
.ff-dark .ff-hero{box-shadow:0 0 0 1px rgba(231,200,121,.45),0 0 0 6px rgba(231,200,121,.07),0 34px 64px -34px #000;}
.ff-dark .ff-back{border-color:rgba(231,200,121,.5);}
.ff-dark .ff-card{box-shadow:0 0 0 1px rgba(231,200,121,.5),0 22px 40px -28px #000;}
.ff-dark .ff-go-card{box-shadow:0 0 0 1.5px #E7C879,0 22px 40px -28px #000;}
.ff-dark .ff-back:focus-visible{outline:2px solid #E7C879;outline-offset:2px;}
`;
