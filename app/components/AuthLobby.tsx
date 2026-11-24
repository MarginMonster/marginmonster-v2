/* THE LOBBY — the sign-in screens as the front of a cinema that is showing the app's own films.
 *
 * The owner, 2026-11-24, with a phone screenshot of /web/login: "Mobile login page looks 'Why do I even have
 * this app' when it should read holy shit this app is amazing. I'm assuming desktop has same problem. Needs
 * art and badass cinema". The screen was a cream card on a pale page, and nothing on it showed what the app
 * makes.
 *
 * ONE idea: you are standing outside a cinema at night.
 *
 *   THE SIGN     "Now showing", between two rails of marquee bulbs — one lit bulb runs along each
 *   THE WALL     the Movie Maker's nine posters (film-heroes.ts) drifting past like a marquee: each is a
 *                frame of a film the app made, under the name of its format; now and then one catches the light
 *   THE SCREEN   wide screens only: four of those films playing, one after another
 *   THE TICKET   the form itself — the same fields, on an admission ticket (stub, perforation, notches)
 *
 * It claims only what the pictures show: the formats, by their own names, and the Movie Maker's own line
 * ("Make a movie. Just describe it."). No numbers, no praise.
 *
 * Shared by all four doors (log in, sign up, forgot, reset): each keeps its own form, loader and action —
 * this is the room around them. The dark is put on the shell from here, by this component's own <style>,
 * so it arrives with the screen and leaves with it; web.tsx is not touched.
 *
 * THE PICTURES are the landing's own (public/landing: generated actors and cartoons only — see the note
 * above LOOP_V in web.film.tsx). Never a member's or the owner's presenters.
 *
 * NOT lazy, on purpose: the wall's posters come into view by a CSS transform, and a lazy picture inside a
 * clipped, transformed strip is not reliably asked for (Safari leaves it blank until something else moves
 * the page). All nine are shown within the minute, so all nine are fetched. The screen's stills ARE lazy:
 * a phone hides the screen, and a hidden lazy picture is never fetched. Its clips are added by the browser
 * only when the screen is wide, the visitor has not asked for less motion, and is not saving data.
 */

import { useEffect, useState, type ReactNode } from "react";
import { authLang } from "../lib/auth-i18n";
import { FILM_HEROES } from "../lib/film-heroes";
import { tr } from "../lib/ui-i18n";

/** The landing files' cache versions — the same numbers web.film.tsx serves them under (a test holds the
 *  two together, so a replaced file is bumped in both). */
const STILL_V = 8;
const LOOP_V = 5;
/** Formats whose poster has its own 4:5 picture (the other two are one wide picture, cropped). */
const TALL_STILLS = new Set(["kidstv", "kidsmusicvideo", "testmovie", "moral", "horrorstory", "shortstory", "moralstory"]);

/** The wall, in the order it passes: no two neighbours the same kind or the same colour. Keyed by a hero's
 *  `media` (film-heroes.ts), so a poster is always billed under the name the Movie Maker gives it. */
const WALL_ORDER = ["testmovie", "horrorstory", "musicvideo", "kidstv", "moral", "horror", "shortstory", "kidsmusicvideo", "moralstory"];
/** The screen's programme: a film, a music video, a story, a cartoon. */
const REEL_ORDER = ["testmovie", "musicvideo", "horrorstory", "kidstv"];

type Poster = { key: string; name: string; src: string; w: number; h: number };
const nameOf = (media: string) => FILM_HEROES.find((h) => h.media === media)?.name || "";
const WALL: Poster[] = WALL_ORDER.filter(nameOf).map((key) => (TALL_STILLS.has(key)
  ? { key, name: nameOf(key), src: `/landing/film-still-${key}-tall.jpg?v=${STILL_V}`, w: 608, h: 760 }
  : { key, name: nameOf(key), src: `/landing/film-still-${key}.jpg?v=${STILL_V}`, w: 760, h: 434 }));
const REEL = REEL_ORDER.filter(nameOf).map((key) => ({
  key,
  name: nameOf(key),
  still: `/landing/film-loop-${key}.jpg?v=${LOOP_V}`,
  clip: `/landing/film-loop-${key}.mp4?v=${LOOP_V}`,
}));

/** The screen is wide enough to be shown, and this visitor wants it moving. */
const SCREEN_MEDIA = "(min-width: 960px)";
function useScreenPlays(): boolean {
  const [plays, setPlays] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const wide = window.matchMedia(SCREEN_MEDIA);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const saving = !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    const decide = () => setPlays(wide.matches && !calm.matches && !saving);
    decide();
    if (!wide.addEventListener) return;
    wide.addEventListener("change", decide);
    calm.addEventListener("change", decide);
    return () => { wide.removeEventListener("change", decide); calm.removeEventListener("change", decide); };
  }, []);
  return plays;
}
/** A clip starts by itself (muted, inline); this only makes sure of it where the attribute alone is not believed. */
const startClip = (v: HTMLVideoElement | null) => {
  if (!v) return;
  v.muted = true;
  try { void v.play().catch(() => undefined); } catch { /* a very old browser's play() hands nothing back */ }
};

export function AuthLobby({ lang, children }: {
  /** The language the screen is being read in (the page's own `lang`: cookie, then the landing's pick, then the browser's). */
  lang: string;
  /** The door's own heading, form and links — unchanged. */
  children: ReactNode;
}) {
  const L = authLang(lang);
  const t = (source: string) => tr(L, source);
  const plays = useScreenPlays();
  return (
    <div className="lb">
      <style dangerouslySetInnerHTML={{ __html: AUTH_LOBBY_CSS }} />
      {/* one picture to a screen reader, said once: what is showing */}
      <div className="lb-stage" role="img" aria-label={`${t("Now showing")}: ${WALL.map((p) => t(p.name)).join(", ")}`}>
        <div className="lb-sign">
          <span className="lb-rail" />
          <span className="lb-sign-txt">{t("Now showing")}</span>
          <span className="lb-rail is-after" />
        </div>
        <div className="lb-screen">
          {REEL.map((c, k) => (
            <div className="lb-clip" key={c.key} style={{ ["--k" as string]: k }}>
              <img src={c.still} alt="" width={720} height={404} loading="lazy" decoding="async" />
              {plays && <video ref={startClip} src={c.clip} poster={c.still} muted loop playsInline autoPlay preload="metadata" aria-hidden="true" tabIndex={-1} />}
              <span className="lb-clip-tag"><i />{t(c.name)}</span>
            </div>
          ))}
        </div>
        <div className="lb-wall">
          {/* the nine, twice: the strip moves left by exactly one set and starts again, so it never ends */}
          <div className="lb-track">
            {[0, 1].map((set) => WALL.map((p, k) => (
              <div className="lb-poster" key={`${set}-${p.key}`} style={{ ["--k" as string]: k }}>
                <img src={p.src} alt="" width={p.w} height={p.h} decoding="async" />
                <b>{t(p.name)}</b>
              </div>
            )))}
          </div>
        </div>
      </div>
      <div className="lb-booth">
        <p className="lb-line">{t("Make a movie.")} <em>{t("Just describe it.")}</em></p>
        <div className="lb-ticket wb-auth wb-card">
          <span className="lb-wm" aria-hidden="true" />
          <div className="lb-stub" aria-hidden="true"><span>{t("Admit one")}</span><span className="lb-bars" /></div>
          {children}
        </div>
      </div>
    </div>
  );
}

/* One stylesheet for the four doors. It also carries the small things each of them used to repeat (the
 * password eye, the "(optional)" dimmer, the hint line, the button's busy dot).
 *
 * Worked out (not measured — see the TEST page, scratchpad mvfix/make-login-mock.cjs) for a 390 x 760 phone,
 * top to bottom: the shell's header 56 · the sign 34 · the wall 190 · the line 67 · then the ticket — its stub
 * 52, heading 32, welcome line 26 (46 if it wraps) — so the email field ends near 536 (556), the button near
 * 681, and both links are on the first screen. */
export const AUTH_LOBBY_CSS = `
/* ---- the shell goes dark while a door is up (these rules leave with the screen) ---- */
html,body{background:#130E0B;}
html{scrollbar-color:#3D3024 #130E0B;}
html .wb{background:radial-gradient(120% 56% at 50% -12%,rgba(231,200,121,.22),rgba(231,200,121,0) 60%),radial-gradient(64% 42% at -6% 104%,rgba(12,122,70,.22),rgba(12,122,70,0) 70%),#130E0B;}
html .wb::before,html .wb::after{display:none;}
.wb .wb-main{padding:0;}
.wb .wb-brand{position:relative;color:#FFFDF7;}
.wb .wb-brand b{color:#E7C879;}
.wb .wb-crest img{filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));}
.wb .lt-btn,.wb .wb-login{position:relative;background:rgba(255,253,247,.07);border-color:rgba(231,200,121,.5);color:#FFFDF7;box-shadow:none;}
.wb .lt-btn:hover,.wb .lt-btn[aria-expanded="true"],.wb .wb-login:hover{border-color:#E7C879;color:#FFFDF7;box-shadow:0 0 0 3px rgba(231,200,121,.16);}
.wb .lt-btn .lt-glyph{color:#E7C879;}
.wb .lt-btn .lt-caret{color:#D8CFBA;}
/* the logo and the language pill are 30 and 32 tall: 44 to the finger, nothing moved (and the pill's list of
   languages, which opens over the page, gets 44px rows on a phone) */
.wb .wb-brand::after,.wb .lt-btn::after,.wb .wb-login::after{content:"";position:absolute;inset:-7px -3px;}
@media(max-width:640px){.lt-menu .lt-opt{min-height:44px;}}
.wb .wb-nav a:focus-visible,.wb .wb-nav button:focus-visible{outline-color:#E7C879;}
/* (a reset link can be opened by someone who is still signed in: their tabs must read on the dark too) */
.wb .wb-tab:not(.on){color:#D8CFBA;}
.wb .wb-tab:hover:not(.on){color:#FFFDF7;background:rgba(255,253,247,.08);}
.wb .wb-admin{color:#D8CFBA;opacity:.8;}
.wb .wb-admin:hover{background:rgba(255,253,247,.1);}
/* Helpurr floats 97px up on a phone to clear a tab bar that a visitor does not have — over a full-width
   ticket that put it on the password's eye. Here it stands at the foot of the page, under the ticket.
   (Signed in, the tab bar is there, and Helpurr stays where the shell puts it.) */
@media(max-width:620px){
  .wb .mm-fab{position:absolute;bottom:calc(14px + env(safe-area-inset-bottom,0px));}
  .wb .wb-bottom ~ .mm-fab{position:fixed;bottom:calc(97px + env(safe-area-inset-bottom,0px));}
}

/* ---- the lobby ---- */
.lb{--pw:136px;position:relative;padding:4px 0 40px;color:#FFFDF7;}
/* a phone's posters are sized by the HEIGHT it has (the small viewport: its bars showing): 136 wide on a
   760-tall screen, down to 116 on a short one so the form's button is not pushed off it, up to 150 on a tall one */
@supports (height:1svh){@media(max-width:599px){.lb{--pw:clamp(116px,calc(20svh - 16px),150px);}}}
@media(max-width:620px){.lb{padding-bottom:calc(86px + env(safe-area-inset-bottom,0px));}}
.lb-stage{min-width:0;}

/* THE SIGN: a dim bulb every 18px, and one lit bulb in three that steps along them — left to right, through
   the words. Each rail's bulbs are counted from the words outward, so none is cut in half beside them. */
.lb-sign{direction:ltr;display:flex;align-items:center;gap:12px;height:20px;margin:0 16px 10px;}
.lb-rail{flex:1 1 0;min-width:0;height:14px;background:radial-gradient(circle at center,#FFF3CF 0,#FFF3CF 2.3px,rgba(231,200,121,.9) 3.1px,rgba(231,200,121,.26) 5px,rgba(231,200,121,0) 7px) 100% 0/54px 14px repeat-x,radial-gradient(circle at center,rgba(231,200,121,.38) 0,rgba(231,200,121,.38) 2.7px,rgba(231,200,121,0) 3.5px) 100% 0/18px 14px repeat-x;-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0),#000 26px);mask-image:linear-gradient(90deg,rgba(0,0,0,0),#000 26px);animation:lbChaseA 1.05s steps(3) infinite;}
.lb-rail.is-after{background-position:0 0,0 0;-webkit-mask-image:linear-gradient(270deg,rgba(0,0,0,0),#000 26px);mask-image:linear-gradient(270deg,rgba(0,0,0,0),#000 26px);animation-name:lbChaseB;}
@keyframes lbChaseA{to{background-position:calc(100% + 54px) 0,100% 0}}
@keyframes lbChaseB{to{background-position:54px 0,0 0}}
.lb-sign-txt{flex:0 0 auto;padding-left:.3em;font-family:Poppins,sans-serif;font-weight:800;font-size:12px;line-height:20px;letter-spacing:.3em;text-transform:uppercase;white-space:nowrap;color:#E7C879;text-shadow:0 0 14px rgba(231,200,121,.6);}
[dir=rtl] .lb-sign-txt{padding-left:0;letter-spacing:0;font-size:13.5px;}

/* THE WALL: the posters pass, right to left, and the strip fades out at both ends */
.lb-wall{direction:ltr;overflow:hidden;padding:4px 0 16px;-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0),#000 7%,#000 93%,rgba(0,0,0,0));mask-image:linear-gradient(90deg,rgba(0,0,0,0),#000 7%,#000 93%,rgba(0,0,0,0));}
.lb-track{display:flex;width:max-content;animation:lbDrift 64s linear infinite;}
@keyframes lbDrift{to{transform:translate3d(-50%,0,0)}}
.lb-poster{position:relative;isolation:isolate;flex:0 0 auto;width:var(--pw);height:calc(var(--pw) * 1.25);margin-right:12px;border-radius:12px;overflow:hidden;background:#241B15;box-shadow:0 0 0 1px rgba(231,200,121,.5),0 14px 22px -14px #000;}
.lb-poster img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}
/* (the shade a name stands on: dark enough under three lines of it — 46% up — even where the picture is white) */
.lb-poster::after{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(0deg,rgba(10,7,5,.95) 0%,rgba(10,7,5,.86) 22%,rgba(10,7,5,.62) 46%,rgba(10,7,5,.28) 62%,rgba(10,7,5,0) 78%);}
/* a poster catches the light: one after another down the row, then again every nine seconds */
.lb-poster::before{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:linear-gradient(105deg,rgba(255,255,255,0) 40%,rgba(255,255,255,.36) 50%,rgba(255,255,255,0) 60%);transform:translateX(-130%);animation:lbShine 9s ease-out calc(.7s + var(--k,0) * .22s) infinite backwards;}
@keyframes lbShine{0%{transform:translateX(-130%)}13%{transform:translateX(130%)}100%{transform:translateX(130%)}}
.lb-poster b{position:absolute;z-index:3;left:10px;right:10px;bottom:9px;font-family:Poppins,sans-serif;font-weight:800;font-size:14px;line-height:1.12;letter-spacing:-.015em;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.8),0 1px 2px rgba(0,0,0,.7);overflow-wrap:anywhere;-webkit-hyphens:auto;hyphens:auto;}
[dir=rtl] .lb-poster b{direction:rtl;text-align:right;letter-spacing:0;line-height:1.5;}

/* THE SCREEN is for wide screens (below): a phone shows the wall alone, and fetches no film */
.lb-screen{display:none;}

/* ---- the box office ---- */
.lb-booth{min-width:0;padding:0 16px;}
.lb-line{max-width:440px;margin:0 auto 12px;text-align:center;font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(21px,6.2vw,26px);line-height:1.14;letter-spacing:-.02em;color:#FFFDF7;overflow-wrap:anywhere;}
.lb-line em{display:block;font-style:normal;color:#E7C879;}
[dir=rtl] .lb-line{letter-spacing:0;line-height:1.5;}

/* THE TICKET: cream paper under the marquee's light; the form on it is the form it always was */
.lb .lb-ticket{position:relative;isolation:isolate;max-width:440px;margin:0 auto;padding:0 22px 12px;border:0;border-radius:18px;color:var(--ink,#14201A);background:linear-gradient(176deg,#FFFDF7,#F7F0DE);box-shadow:0 0 0 1px rgba(231,200,121,.6),0 34px 60px -30px #000;animation:lbTicketIn .55s cubic-bezier(.2,.7,.2,1) .05s backwards;}
@keyframes lbTicketIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
/* the two notches where the stub tears off (the lobby's own colour, with the ticket's gold edge carried round) */
.lb .lb-ticket::before,.lb .lb-ticket::after{content:"";position:absolute;z-index:2;top:30px;width:18px;height:18px;border-radius:50%;background:#130E0B;}
.lb .lb-ticket::before{left:-9px;box-shadow:inset -1px 0 0 rgba(231,200,121,.6);}
.lb .lb-ticket::after{right:-9px;box-shadow:inset 1px 0 0 rgba(231,200,121,.6);}
.lb-stub{display:flex;align-items:center;justify-content:space-between;gap:12px;height:40px;margin:0 -22px 12px;padding:0 22px;border-bottom:2px dashed rgba(107,79,14,.5);border-radius:18px 18px 0 0;background:linear-gradient(180deg,rgba(231,200,121,.34),rgba(231,200,121,.14));font-family:Poppins,sans-serif;font-weight:800;font-size:10.5px;letter-spacing:.26em;text-transform:uppercase;color:#6B4F0E;}
.lb-stub span:first-child{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;line-height:1.7;}
[dir=rtl] .lb-stub{letter-spacing:0;font-size:12px;}
.lb-bars{flex:0 0 auto;width:66px;height:16px;opacity:.7;background:repeating-linear-gradient(90deg,#14201A 0,#14201A 2px,rgba(20,32,26,0) 2px,rgba(20,32,26,0) 3px,#14201A 3px,#14201A 4px,rgba(20,32,26,0) 4px,rgba(20,32,26,0) 7px,#14201A 7px,#14201A 10px,rgba(20,32,26,0) 10px,rgba(20,32,26,0) 11px,#14201A 11px,#14201A 12px,rgba(20,32,26,0) 12px,rgba(20,32,26,0) 15px);}
/* the paper's watermark: the brand's rosette, turning slowly in the corner, under the print */
.lb-wm{position:absolute;inset:0;z-index:-1;border-radius:18px;overflow:hidden;pointer-events:none;}
.lb-wm::after{content:"";position:absolute;right:-92px;bottom:-104px;width:260px;height:260px;background:#0C7A46;opacity:.16;-webkit-mask-image:url(/gstyle-rosette.svg);-webkit-mask-size:contain;-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;mask-image:url(/gstyle-rosette.svg);mask-size:contain;mask-position:center;mask-repeat:no-repeat;animation:lbTurn 180s linear infinite;}
@keyframes lbTurn{to{transform:rotate(360deg)}}
.lb .lb-ticket .wb-h1{margin-bottom:4px;font-size:23px;line-height:1.2;}
.lb .lb-ticket .wb-sub{max-width:none;font-size:13.5px;line-height:1.5;}
.lb .lb-ticket .wb-lbl{margin:13px 0 5px;}
.lb .lb-ticket .wb-in{min-height:46px;}
.lb .lb-ticket form{margin-bottom:2px;}
.lb .lb-ticket .wb-btn{display:block;width:100%;min-height:48px;padding:13px 20px;font-size:15px;}
/* (full width, its words sit mid-button — where the shell's green is at its palest, 3.3:1 under white. Here
   the button starts from the brand's deep green instead: 5.4:1 at its lightest.) */
.lb .lb-ticket .wb-btn:not(.ghost){background:linear-gradient(100deg,#0C7A46 30%,#0A6A3D 72%,#075530);}
.lb .lb-ticket :focus-visible{outline-color:#0C7A46;}
/* a link under the form is a row of its own, 44px to the finger; the small print's links reach as far */
.lb .lb-row{display:flex;flex-wrap:wrap;align-items:center;column-gap:.32em;min-height:44px;margin:0;font-size:13.5px;}
.lb .lb-row a{display:inline-flex;align-items:center;min-height:44px;margin-block:0;padding-block:0;font-weight:600;}
.lb .lb-fine{margin:16px 0 14px;font-size:12.5px;line-height:1.6;}
@media(max-width:640px){.lb .lb-fine a{padding-block:14px;}}

/* what each door used to carry by itself */
.wb-opt{font-weight:600;font-size:11.5px;color:var(--ink2);}
.wb-pw{position:relative;}
.wb-pw .wb-in{padding-right:50px;}
.wb-pw-eye{position:absolute;top:0;right:0;height:100%;width:46px;display:grid;place-items:center;border:0;background:none;cursor:pointer;color:var(--ink2);border-radius:0 11px 11px 0;}
.wb-pw-eye:hover{color:var(--green);}
[dir=rtl] .wb-pw .wb-in{padding-right:13px;padding-left:50px;}
[dir=rtl] .wb-pw-eye{right:auto;left:0;border-radius:11px 0 0 11px;}
.wb-hint{margin-top:6px;font-size:12.5px;color:#7A2E1D;}
.wb-busy{display:inline-flex;align-items:center;gap:8px;}
.wb-busy-dot{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:wbBusySpin .7s linear infinite;}
.wb-busy-dot-dark{border-color:rgba(20,32,26,.25);border-top-color:var(--ink);}
@keyframes wbBusySpin{to{transform:rotate(360deg)}}

/* ---- a tablet: the same column, with more room ---- */
@media(min-width:600px) and (max-width:959px){
  .lb{--pw:150px;padding-top:10px;}
  .lb-sign{margin-bottom:14px;}
  .lb-wall{padding-bottom:22px;}
  .lb-line{margin-bottom:18px;font-size:28px;}
}
/* a phone on its side: smaller posters, so the form is not a screen away */
@media(max-height:520px) and (max-width:959px){.lb{--pw:104px;}}

/* ---- a wide screen: the art on one side, the box office on the other ---- */
@media(min-width:960px){
  /* (100px on the right keeps the ticket clear of Helpurr, who floats in that corner) */
  .lb{--pw:112px;display:grid;grid-template-columns:minmax(0,1fr) 420px;column-gap:clamp(36px,5vw,72px);align-items:center;max-width:1300px;min-height:calc(100vh - 68px);margin:0 auto;padding:8px 100px 40px clamp(24px,3vw,56px);}
  /* never taller than the window: the screen gives way first */
  .lb-stage{justify-self:center;width:100%;max-width:clamp(380px,calc((100vh - 330px) * 1.7778),680px);}
  .lb-sign{margin:0 0 12px;}
  .lb-sign-txt{font-size:13px;}
  .lb-screen{display:block;position:relative;aspect-ratio:16/9;border-radius:16px;overflow:hidden;isolation:isolate;background:#0A0705;box-shadow:0 0 0 1px rgba(231,200,121,.45),0 0 0 6px rgba(231,200,121,.07),0 44px 90px -44px #000,0 0 130px -34px rgba(231,200,121,.36);}
  .lb-screen::after{content:"";position:absolute;inset:0;z-index:3;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 70px rgba(0,0,0,.5);}
  /* four clips, five seconds each: one fades up as the last one fades away */
  .lb-clip{position:absolute;inset:0;opacity:0;animation:lbReel 20s linear infinite;animation-delay:calc(var(--k,0) * 5s);}
  .lb-clip img,.lb-clip video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}
  .lb-clip-tag{position:absolute;z-index:2;left:14px;bottom:13px;display:inline-flex;align-items:center;gap:7px;padding:6px 12px 6px 10px;border:1px solid rgba(255,255,255,.24);border-radius:999px;background:rgba(10,7,5,.74);color:#fff;font-size:12px;font-weight:600;line-height:1.2;}
  .lb-clip-tag i{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:#FF6B5E;box-shadow:0 0 0 3px rgba(255,107,94,.28);}
  .lb-wall{margin-top:16px;}
  .lb-track{animation-duration:58s;}
  .lb-poster b{left:9px;right:9px;bottom:8px;font-size:12.5px;}
  .lb-booth{padding:0;}
  .lb-line{max-width:none;margin:0 0 16px;text-align:start;font-size:28px;line-height:1.12;}
  .lb .lb-ticket{max-width:none;margin:0;}
  .lb .lb-row,.lb .lb-row a{min-height:36px;}
}
@keyframes lbReel{0%{opacity:0}3.5%{opacity:1}25%{opacity:1}29%{opacity:0}100%{opacity:0}}

/* ---- less motion: everything stands still, and the screen holds its first frame ---- */
@media(prefers-reduced-motion:reduce){
  .lb-rail,.lb-rail.is-after,.lb-track,.lb-poster::before,.lb-clip,.lb-wm::after,.lb .lb-ticket,.wb-busy-dot{animation:none;}
  .lb-poster::before{display:none;}
  .lb-clip:first-child{opacity:1;}
}
`;
