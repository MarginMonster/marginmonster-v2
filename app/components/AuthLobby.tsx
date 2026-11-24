/* THE LOBBY — the sign-in screens as the front of a cinema that is showing what the app makes.
 *
 * The owner, 2026-11-24, with a phone screenshot of /web/login: "Mobile login page looks 'Why do I even have
 * this app' when it should read holy shit this app is amazing. I'm assuming desktop has same problem. Needs
 * art and badass cinema". The screen was a cream card on a pale page, and nothing on it showed what the app
 * makes.
 *
 * ONE idea: you are standing outside a cinema at night.
 *
 *   THE SIGN     "Now showing", between two lamp rails: tungsten bulbs in a dark channel, a pulse running along them
 *   THE WALL     cards drifting past like a marquee, and every one of them PLAYS while it is in view
 *   THE SCREEN   wide screens only: four pieces playing, one after another
 *   THE TICKET   the form itself — the same fields, on an admission ticket (stub, perforation, notches)
 *   …and, in the dark behind it all, the app's own gold rosettes turning slowly
 *
 * The same day, with the first version live on his phone, four more things:
 *   "The cheap shimmer on the covers here also need to go - and they should be playing the video as a bigger
 *    flex, not just a still"            → no light crosses a card any more; each card plays its own clip
 *   "the Admit one light cream card over the dark is extremely attractive"   → the ticket is not touched
 *   "it kinda makes the app appear to only do movies 'make a movie' needs others flexed I think also
 *    (presenter with product in the now showing cards)"   and   "visualize the app having 'Main Houses'
 *    Film, ads, creation"               → the wall and the screen show EVERY house, not films alone: an ad
 *    (a presenter holding a product), a Creator piece, the cast, auto-posting — each billed under its
 *    house's name the way a film is billed under its format; and the line says films, ads, anything.
 *    (The houses, as he named them: Film, Ads, Creation, Cast, Auto-post. The Archive is "a given".)
 *   "the flashing lights in the login potentially being more realistic lights like a movie theater may be
 *    an attractive look"                → the sign's bulbs are lamps now: glass, a hot centre, a bloom, a channel
 *   "I think we still need some gold spinners in there for asthetic"
 *                                       → the shell's two ambient rosettes turn here too, in gold
 *
 * It claims only what the pictures show: formats and houses by their own names. No numbers, no praise.
 *
 * Shared by all four doors (log in, sign up, forgot, reset): each keeps its own form, loader and action —
 * this is the room around them. The dark is put on the shell from here, by this component's own <style>,
 * so it arrives with the screen and leaves with it; web.tsx is not touched.
 *
 * THE PICTURES are the app's own showcase art and nothing else: public/landing (the Movie Maker's stills and
 * loops, the sections' hero clips — generated actors and cartoons only, see the note above LOOP_V in
 * web.film.tsx — and the lobby's own ad, lobby-ad.*: a commercial with the stock presenter Desmond). Never a
 * member's or the owner's presenters, never an upload.
 *
 * WHAT A PHONE IS SENT. Every card's still (when it has one light enough) comes with the page, and is NOT
 * lazy on purpose: a card comes into view by a CSS transform, and a lazy picture inside a clipped,
 * transformed strip is not reliably asked for (Safari leaves it blank). Two houses' only stills are the
 * 1344px section heroes (268 and 466 KB) — too heavy for a 136px card, so those two cards show their house's
 * icon until their clip plays. A CLIP is fetched the first time its card is in view, plays only while it is
 * in view, and stops when it leaves or the tab is hidden; with "reduce motion" or "save data" on, no clip is
 * ever added and the stills stand. The screen's stills ARE lazy: a phone hides the screen, and a hidden lazy
 * picture is never fetched.
 */

import { useEffect, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { authLang } from "../lib/auth-i18n";
import { FILM_HEROES } from "../lib/film-heroes";
import { Ico } from "../lib/icons";
import { tr } from "../lib/ui-i18n";

/** The landing files' cache versions — the same numbers web.film.tsx serves them under (a test holds the
 *  two together, so a replaced file is bumped in both). */
const STILL_V = 8;
const LOOP_V = 5;
/** Formats whose poster has its own 4:5 picture (the other two are one wide picture, cropped). */
const TALL_STILLS = new Set(["kidstv", "kidsmusicvideo", "testmovie", "moral", "horrorstory", "shortstory", "moralstory"]);

/** The houses a card can come from, besides the Movie Maker. Their names are the nav's own (web.tsx). */
type House = "ad" | "creator" | "cast" | "autopost";

/** One card of the wall. */
type Card = {
  key: string;
  /** a film is billed under its format (film-heroes.ts)… */
  name: string;
  /** …and a piece from another house under that house's name */
  house?: House;
  /** its picture, when it has one light enough to send to a phone with the page */
  still?: { src: string; w: number; h: number };
  /** …else its house's own icon (the nav's) stands in until the clip plays */
  icon?: string;
  /** its loop: fetched the first time the card is in view */
  clip: string;
  /** where to look, for a picture that is not 4:5 (object-position) */
  at?: string;
  /** a little closer, to leave a picture's own black bars outside the card */
  zoom?: number;
};

const nameOf = (media: string) => FILM_HEROES.find((h) => h.media === media)?.name || "";
/** A film's card: the Movie Maker's own poster, and the 4:5 loop its format card plays on a phone. */
const film = (key: string): Card => ({
  key,
  name: nameOf(key),
  still: TALL_STILLS.has(key)
    ? { src: `/landing/film-still-${key}-tall.jpg?v=${STILL_V}`, w: 608, h: 760 }
    : { src: `/landing/film-still-${key}.jpg?v=${STILL_V}`, w: 760, h: 434 },
  clip: `/landing/film-loop-${key}-tall.mp4?v=${LOOP_V}`,
});
/** The other houses' cards. The section clips are the Dashboard's own doors (same files, same ?v= — a
 *  visitor who signs in has them already); the ad is a commercial made with the stock presenter Desmond. */
const HOUSE_CARDS: Record<House, Card> = {
  ad: { key: "ad", house: "ad", name: "Ad Maker", still: { src: "/landing/lobby-ad.jpg?v=1", w: 540, h: 960 }, clip: "/landing/lobby-ad.mp4?v=1", at: "50% 45%" },
  creator: { key: "creator", house: "creator", name: "Creator", icon: "palette", clip: "/landing/creator-hero.mp4?v=5", at: "70% 50%" },
  cast: { key: "cast", house: "cast", name: "Presenters", icon: "presenter", clip: "/landing/presenter-hero.mp4?v=5", at: "12% 50%", zoom: 1.15 },
  autopost: { key: "autopost", house: "autopost", name: "Auto-post", still: { src: "/landing/autopost-hero.jpg?v=1", w: 1344, h: 768 }, clip: "/landing/autopost-hero.mp4?v=5", at: "18% 50%" },
};
const isHouse = (k: string): k is House => k in HOUSE_CARDS;

/** The wall, in the order it passes. A phone's first three are a film, an ad, a film — then Creator; the
 *  other houses are spread so that no more than three films ever pass in a row, and no two neighbours are
 *  the same colour.
 *  (The first six — all a wide screen shows when the page opens — are cards whose clip begins on the very
 *  picture their still shows, or that have no still. Three formats' covers are a different picture from
 *  their loop — Music Video, Horror Film, Kids Music Video, in the Movie Maker too — and those come later,
 *  entering at the strip's fading edge with their clip already starting.) */
const WALL_ORDER = ["testmovie", "ad", "horrorstory", "creator", "kidstv", "moral", "musicvideo", "cast", "shortstory", "horror", "autopost", "kidsmusicvideo", "moralstory"];
const WALL: Card[] = WALL_ORDER.map((k) => (isHouse(k) ? HOUSE_CARDS[k] : film(k))).filter((c) => c.name);

/** The screen's programme: a film, an ad, a music video, a Creator piece — each a 16:9 clip. A film's still
 *  is its loop's own first frame; the two section clips have none light enough, and stand on their icon. */
type Reel = { key: string; name: string; house?: House; still?: string; icon?: string; clip: string };
const screenFilm = (key: string): Reel => ({ key, name: nameOf(key), still: `/landing/film-loop-${key}.jpg?v=${LOOP_V}`, clip: `/landing/film-loop-${key}.mp4?v=${LOOP_V}` });
const SCREEN_HOUSES: Partial<Record<House, Reel>> = {
  ad: { key: "ad", house: "ad", name: "Ad Maker", icon: "megaphone", clip: "/landing/marketing-hero.mp4?v=5" },
  creator: { key: "creator", house: "creator", name: "Creator", icon: "palette", clip: "/landing/creator-hero.mp4?v=5" },
};
const REEL_ORDER = ["testmovie", "ad", "musicvideo", "creator"];
const REEL: Reel[] = REEL_ORDER.map((k) => (isHouse(k) ? SCREEN_HOUSES[k] : screenFilm(k))).filter((c): c is Reel => !!c && !!c.name);
/** (The bill, for the TEST page and its checks: what is on the wall and on the screen, and from which files.) */
export const LOBBY_BILL = { wall: WALL, reel: REEL };

/** The lamps of one rail of the sign — as many as the longest rail holds (a tablet's, in a language whose
 *  two words are short: about 420px, a lamp every 16). A rail shows the ones that fit, counted from the
 *  words outward; the rest are out of sight (and on a phone, whose rails are short, not drawn at all). */
const LAMPS = Array.from({ length: 28 }, (_, i) => i);

/** What moves, for this visitor: the wall's clips unless they asked for less motion or are saving data —
 *  and the screen's too, where the screen is wide enough to be shown. Nothing, until the page is in a browser. */
const SCREEN_MEDIA = "(min-width: 960px)";
function useLobbyMotion(): { live: boolean; plays: boolean } {
  const [motion, setMotion] = useState({ live: false, plays: false });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const wide = window.matchMedia(SCREEN_MEDIA);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    // ("save data" is the visitor's own switch; a 2G line is the same wish, said by the network)
    const line = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const saving = !!line?.saveData || /2g$/.test(line?.effectiveType || "");
    const decide = () => { const live = !calm.matches && !saving; setMotion({ live, plays: live && wide.matches }); };
    decide();
    if (!wide.addEventListener) return;
    wide.addEventListener("change", decide);
    calm.addEventListener("change", decide);
    return () => { wide.removeEventListener("change", decide); calm.removeEventListener("change", decide); };
  }, []);
  return motion;
}

/** How much of a card must be inside the strip before its clip is asked for (a sliver under the fade at the
 *  strip's edge is not "in view"). Once playing, a clip plays until its card is wholly gone. */
const IN_VIEW = 0.12;
/** How often the wall is looked at. */
const LOOK_MS = 400;
/** Never more clips at once than this, however many cards a wide strip shows (a phone upright shows four;
 *  a phone on its side, or a tablet, would show up to nine). The rest stand as stills until one leaves. */
const MOST_AT_ONCE = 6;

/** ONE LOOK AT THE WALL: a clip plays only while its card is in view.
 *
 * Measured, not observed. An IntersectionObserver is told about scrolling and layout, but the cards move by
 * a CSS animation the browser runs off the main thread — not every engine re-checks an observer for that
 * (the same reason the stills are not lazy). A card's box, asked for now, is always where the card is.
 *
 *   · the page is not being looked at (tab hidden), or the wall is scrolled away: every clip stops
 *   · a card wholly outside the strip: its clip stops (it keeps its place, and its bytes — fetched once)
 *   · a card far enough in: its clip is fetched (the first time) and played — while fewer than six are
 *   · a clip that failed, or that the browser will not start by itself, is left alone: the still stands
 */
export function tendWall(box: HTMLElement, clips: HTMLVideoElement[], awake: boolean, viewHeight: number): void {
  const strip = box.getBoundingClientRect();
  const showing = awake && strip.bottom > 0 && strip.top < viewHeight;
  const waiting: { at: number; v: HTMLVideoElement }[] = [];
  let playing = 0;
  for (const v of clips) {
    const card = (v.parentElement || v).getBoundingClientRect();
    const inside = showing ? Math.min(card.right, strip.right) - Math.max(card.left, strip.left) : 0;
    if (inside <= 0) { if (!v.paused) v.pause(); continue; }
    if (!v.paused) { playing++; continue; }
    if (!v.dataset.off && inside >= card.width * IN_VIEW) waiting.push({ at: card.left, v });
  }
  // (when the wall is full, the card that has waited longest — the leftmost — is next: none passes unplayed)
  waiting.sort((a, b) => a.at - b.at);
  for (const { v } of waiting.slice(0, Math.max(0, MOST_AT_ONCE - playing))) {
    if (!v.getAttribute("src")) v.src = v.dataset.clip || "";
    v.muted = true;
    try {
      // (stopped before it began — its card left, the tab was hidden — is not a failure; anything else is)
      void v.play().catch((e: unknown) => { if ((e as { name?: string } | null)?.name !== "AbortError") v.dataset.off = "1"; });
    } catch { v.dataset.off = "1"; }
  }
}
function useWallClips(wall: RefObject<HTMLDivElement>, live: boolean): void {
  useEffect(() => {
    const box = wall.current;
    if (!live || !box) return;
    const clips = Array.from(box.querySelectorAll("video"));
    const look = () => tendWall(box, clips, document.visibilityState === "visible", window.innerHeight);
    look();
    const timer = window.setInterval(look, LOOK_MS);
    document.addEventListener("visibilitychange", look);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", look); for (const v of clips) v.pause(); };
  }, [wall, live]);
}
/** A card's clip is drawn over its still only once it is really playing — so one that never starts is never seen. */
const showClip = (e: SyntheticEvent<HTMLVideoElement>) => { e.currentTarget.classList.add("is-on"); };
const dropClip = (e: SyntheticEvent<HTMLVideoElement>) => { e.currentTarget.dataset.off = "1"; };
/** A clip of the screen starts by itself (muted, inline); this only makes sure of it where the attribute alone is not believed. */
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
  const { live, plays } = useLobbyMotion();
  const wall = useRef<HTMLDivElement>(null);
  useWallClips(wall, live);
  // a film is billed under its format, a piece from another house under the house's own name (the nav's)
  const houses: Record<House, string> = { ad: t("Ad Maker"), creator: t("Creator"), cast: t("Presenters"), autopost: t("Auto-post") };
  const billed = (c: { name: string; house?: House }) => (c.house ? houses[c.house] : t(c.name));
  // the line, and what it comes down to: one string, so each language can make its two halves agree
  const [lead, tail] = t("Films. Ads. Anything.|Just describe it.").split("|");
  return (
    <div className="lb">
      <style dangerouslySetInnerHTML={{ __html: AUTH_LOBBY_CSS }} />
      {/* one picture to a screen reader, said once: what is showing */}
      <div className="lb-stage" role="img" aria-label={`${t("Now showing")}: ${WALL.map(billed).join(", ")}`}>
        <div className="lb-sign">
          <span className="lb-rail">{LAMPS.map((i) => <i key={i} />)}</span>
          <span className="lb-sign-txt">{t("Now showing")}</span>
          <span className="lb-rail is-after">{LAMPS.map((i) => <i key={i} />)}</span>
        </div>
        <div className="lb-screen">
          {REEL.map((c, k) => (
            <div className="lb-clip" key={c.key} style={{ ["--k" as string]: k }}>
              {c.still
                ? <img src={c.still} alt="" width={720} height={404} loading="lazy" decoding="async" />
                : <span className="lb-ico"><Ico n={c.icon || "film"} size={64} /></span>}
              {plays && <video ref={startClip} src={c.clip} poster={c.still} muted loop playsInline autoPlay preload="metadata" aria-hidden="true" tabIndex={-1} />}
              <span className="lb-clip-tag"><i />{billed(c)}</span>
            </div>
          ))}
        </div>
        <div className="lb-wall" ref={wall}>
          {/* each card is ONE element: it crosses the strip, and comes round again out of sight */}
          <div className="lb-track" style={{ ["--n" as string]: WALL.length }}>
            {WALL.map((c, k) => {
              const fit = c.at || c.zoom ? { objectPosition: c.at, transform: c.zoom ? `scale(${c.zoom})` : undefined } : undefined;
              return (
                <div className="lb-poster" key={c.key} style={{ ["--k" as string]: k }}>
                  {c.still
                    ? <img src={c.still.src} alt="" width={c.still.w} height={c.still.h} decoding="async" style={fit} />
                    : <span className="lb-ico"><Ico n={c.icon || "film"} size={40} /></span>}
                  {live && <video data-clip={c.clip} poster={c.still?.src} muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} style={fit} onPlaying={showClip} onError={dropClip} />}
                  <b>{billed(c)}</b>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="lb-booth">
        <p className="lb-line">{tail ? `${lead} ` : lead}{tail ? <em>{tail}</em> : null}</p>
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
 * top to bottom: the shell's header 56 · the sign 36 · the wall 188 · the line 67 · then the ticket — its stub
 * 52, heading 32, welcome line 26 (46 if it wraps) — so the email field ends near 536 (556), the button near
 * 681, and both links are on the first screen. */
export const AUTH_LOBBY_CSS = `
/* ---- the shell goes dark while a door is up (these rules leave with the screen) ---- */
html,body{background:#130E0B;}
html{scrollbar-color:#3D3024 #130E0B;}
html .wb{background:radial-gradient(120% 56% at 50% -12%,rgba(231,200,121,.22),rgba(231,200,121,0) 60%),radial-gradient(64% 42% at -6% 104%,rgba(12,122,70,.22),rgba(12,122,70,0) 70%),#130E0B;}
/* THE GOLD SPINNERS. The shell already keeps two great rosettes — the app's own spinner — turning slowly
   behind every page (fixed, under everything, taking no tap; green on the cream). In the lobby they are the
   gold cut, glowing faintly out of the dark: one behind the wall, one low in the far corner. They are
   BEHIND the page, so never over a word of the ticket; the shell stops them for "reduce motion", and so
   does the last rule of this sheet. */
html .wb::before,html .wb::after{background-image:url(/gstyle-rosette.svg);}
html .wb::before{opacity:.2;}
html .wb::after{opacity:.15;}
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

/* THE SIGN: two lamp rails, like the ones that run round a cinema's sign.
   A LAMP is tungsten behind glass: a hot centre a little off the middle, amber toward the rim, and a soft
   bloom round it (two shadows: a tight one, a wide faint one). It sits in a dark CHANNEL — a trough with a
   shadowed top lip and a thin gold line along its lower one.
   THE CHASE is a four-circuit chaser, the kind a real marquee has: every fourth lamp is on one circuit, and
   the circuits take the pulse in turn, .6s apart — so it runs left to right along one rail, through the
   words, and on along the other. No lamp ever goes out (a sign, not a casino): each burns at a little over
   half and swells to full — up fast, down slowly, as a filament does.
   Each rail's lamps are counted from the words outward, so none is cut in half beside them; the far end of
   a rail fades into the dark. */
.lb-sign{direction:ltr;display:flex;align-items:center;gap:10px;height:24px;margin:0 16px 8px;}
.lb-rail{position:relative;flex:1 1 0;min-width:0;height:24px;display:flex;flex-direction:row-reverse;align-items:center;gap:8px;padding:0 7px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0),#000 30px);mask-image:linear-gradient(90deg,rgba(0,0,0,0),#000 30px);}
.lb-rail.is-after{flex-direction:row;-webkit-mask-image:linear-gradient(270deg,rgba(0,0,0,0),#000 30px);mask-image:linear-gradient(270deg,rgba(0,0,0,0),#000 30px);}
.lb-rail::before{content:"";position:absolute;left:0;right:0;top:50%;height:14px;margin-top:-7px;border-radius:7px;background:linear-gradient(180deg,#050302,#1C150E);box-shadow:inset 0 1px 2px #000,inset 0 -1px 0 rgba(231,200,121,.16);}
.lb-rail i{position:relative;flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 42% 36%,#FFFDF2 0,#FFF1BD 22%,#FFC95A 50%,#E08A1E 78%,#9A5410 100%);box-shadow:0 0 5px 1px rgba(255,190,90,.8),0 0 12px 3px rgba(255,160,50,.34);animation:lbLamp 2.4s linear infinite;}
@keyframes lbLamp{0%{opacity:.56}6%{opacity:1}26%{opacity:1}54%{opacity:.56}100%{opacity:.56}}
/* (a lamp begun x seconds into the turn swells again 2.4 − x seconds on. Before the words the lamps are
   counted right to left, so the nearest swells last; after them, left to right, the nearest swells first.) */
.lb-rail i:nth-child(4n+1){animation-delay:-.6s;}
.lb-rail i:nth-child(4n+2){animation-delay:-1.2s;}
.lb-rail i:nth-child(4n+3){animation-delay:-1.8s;}
.lb-rail.is-after i:nth-child(4n+1){animation-delay:0s;}
.lb-rail.is-after i:nth-child(4n+2){animation-delay:-1.8s;}
.lb-rail.is-after i:nth-child(4n+3){animation-delay:-1.2s;}
.lb-rail.is-after i:nth-child(4n){animation-delay:-.6s;}
/* (a phone's rails are never longer than fourteen lamps) */
@media(max-width:599px){.lb-rail i:nth-child(n+15){display:none;}}
.lb-sign-txt{flex:0 0 auto;padding-left:.3em;font-family:Poppins,sans-serif;font-weight:800;font-size:12px;line-height:24px;letter-spacing:.3em;text-transform:uppercase;white-space:nowrap;color:#E7C879;text-shadow:0 0 14px rgba(231,200,121,.6);}
[dir=rtl] .lb-sign-txt{padding-left:0;letter-spacing:0;font-size:13.5px;}

/* THE WALL: the cards pass, right to left, and the strip fades out at both ends.
   Each card is ONE element (there is no second copy of the row): it stands at its own place — card k at
   k steps — and the same animation carries every card from the last place to one step off the left edge,
   each begun as far along as its place; arrived, it starts again from the last place, which is always out
   of sight to the right (the row is far longer than the strip). So nothing ever jumps where it can be seen,
   and a card's clip is one player, not two. */
.lb-wall{direction:ltr;overflow:hidden;padding:4px 0 14px;-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0),#000 7%,#000 93%,rgba(0,0,0,0));mask-image:linear-gradient(90deg,rgba(0,0,0,0),#000 7%,#000 93%,rgba(0,0,0,0));}
.lb-track{position:relative;height:calc(var(--pw) * 1.25);--step:calc(var(--pw) + 12px);}
.lb-poster{position:absolute;top:0;left:0;isolation:isolate;width:var(--pw);height:calc(var(--pw) * 1.25);border-radius:12px;overflow:hidden;background:#241B15;box-shadow:0 0 0 1px rgba(231,200,121,.5),0 14px 22px -14px #000;transform:translate3d(calc(var(--k,0) * var(--step)),0,0);animation:lbPass calc(var(--n,13) * 6.6s) linear infinite;animation-delay:calc((var(--n,13) - 1 - var(--k,0)) * -6.6s);}
@keyframes lbPass{from{transform:translate3d(calc((var(--n,13) - 1) * var(--step)),0,0)}to{transform:translate3d(calc(var(--step) * -1),0,0)}}
.lb-poster img,.lb-poster video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}
/* a card's clip lies over its still, unseen until it is really playing (a clip that never starts is never seen) */
.lb-poster video{opacity:0;transition:opacity .45s ease;}
.lb-poster video.is-on{opacity:1;}
/* a card with no still light enough to send: its house's own icon, gold on the dark, until its clip plays */
.lb-ico{position:absolute;inset:0;display:grid;place-items:start center;padding-top:20%;color:#E7C879;background:radial-gradient(circle at 50% 34%,rgba(231,200,121,.22),rgba(231,200,121,0) 66%);}
/* (the shade a name stands on: dark enough under three lines of it — 46% up — even where the picture is white) */
.lb-poster::after{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(0deg,rgba(10,7,5,.95) 0%,rgba(10,7,5,.86) 22%,rgba(10,7,5,.62) 46%,rgba(10,7,5,.28) 62%,rgba(10,7,5,0) 78%);}
.lb-poster b{position:absolute;z-index:3;left:10px;right:10px;bottom:9px;font-family:Poppins,sans-serif;font-weight:800;font-size:14px;line-height:1.12;letter-spacing:-.015em;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.8),0 1px 2px rgba(0,0,0,.7);overflow-wrap:anywhere;-webkit-hyphens:auto;hyphens:auto;}
[dir=rtl] .lb-poster b{direction:rtl;text-align:right;letter-spacing:0;line-height:1.5;}

/* THE SCREEN is for wide screens (below): a phone shows the wall alone */
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
  .lb-stage{justify-self:center;width:100%;max-width:clamp(380px,calc((100vh - 334px) * 1.7778),680px);}
  .lb-sign{gap:12px;margin:0 0 12px;}
  .lb-sign-txt{font-size:13px;}
  .lb-rail{gap:10px;}
  .lb-rail::before{height:16px;margin-top:-8px;border-radius:8px;}
  .lb-rail i{width:9px;height:9px;}
  .lb-screen{display:block;position:relative;aspect-ratio:16/9;border-radius:16px;overflow:hidden;isolation:isolate;background:#0A0705;box-shadow:0 0 0 1px rgba(231,200,121,.45),0 0 0 6px rgba(231,200,121,.07),0 44px 90px -44px #000,0 0 130px -34px rgba(231,200,121,.36);}
  .lb-screen::after{content:"";position:absolute;inset:0;z-index:3;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 70px rgba(0,0,0,.5);}
  /* four clips, five seconds each: one fades up as the last one fades away */
  .lb-clip{position:absolute;inset:0;opacity:0;animation:lbReel 20s linear infinite;animation-delay:calc(var(--k,0) * 5s);}
  .lb-clip img,.lb-clip video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}
  .lb-clip .lb-ico{place-items:center;padding-top:0;background:radial-gradient(circle at 50% 50%,rgba(231,200,121,.2),rgba(231,200,121,0) 58%);}
  .lb-clip-tag{position:absolute;z-index:2;left:14px;bottom:13px;display:inline-flex;align-items:center;gap:7px;padding:6px 12px 6px 10px;border:1px solid rgba(255,255,255,.24);border-radius:999px;background:rgba(10,7,5,.74);color:#fff;font-size:12px;font-weight:600;line-height:1.2;}
  .lb-clip-tag i{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:#FF6B5E;box-shadow:0 0 0 3px rgba(255,107,94,.28);}
  .lb-wall{margin-top:16px;}
  .lb-poster b{left:9px;right:9px;bottom:8px;font-size:12.5px;}
  .lb-booth{padding:0;}
  .lb-line{max-width:none;margin:0 0 16px;text-align:start;font-size:28px;line-height:1.12;}
  .lb .lb-ticket{max-width:none;margin:0;}
  .lb .lb-row,.lb .lb-row a{min-height:36px;}
}
@keyframes lbReel{0%{opacity:0}3.5%{opacity:1}25%{opacity:1}29%{opacity:0}100%{opacity:0}}

/* ---- less motion: everything stands still — every lamp steadily lit, each card at its own place, the
   rosettes at rest, the screen on its first frame; and no clip is ever added (the component does not draw one) ---- */
@media(prefers-reduced-motion:reduce){
  .lb-rail i,.lb-poster,.lb-clip,.lb-wm::after,.lb .lb-ticket,.wb-busy-dot,html .wb::before,html .wb::after{animation:none;}
  .lb-poster video{transition:none;}
  .lb-clip:first-child{opacity:1;}
}
`;
