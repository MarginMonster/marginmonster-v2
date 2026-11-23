/* The cast's ID card.
 *
 * One member of the cast — a person, a cartoon character, a creature; the card does not care which —
 * as a badge: a thin strip in the colour of their kind, a stamped ID code, the name large, the line
 * that says who they are, a small grid of labelled facts, and their description.
 *
 * It is ONE card, shown two ways:
 *   - "full", in the character view of the Presenters section, beside (on a phone: under) the turning
 *     figure. The page hands it the rename pencil and the favourite star to sit after the name.
 *   - "mini", floating beside a cast card that is pointed at or holds the keyboard's focus, with the
 *     member's turning figure standing ON the card: useCastHover + CastHoverCard + CastFigure, below.
 *     Only where there is a mouse; on a phone a tap opens the character, and the same card is there.
 *   - and in the Movie Maker's cast pickers, where a tap PICKS a face: the same floating card for a
 *     mouse, and for a finger a press-and-hold (useCastPeek, at the end of this file) that opens it as a
 *     sheet the page draws.
 *
 * What a card SAYS is idCardOf, below: one mapping for every page that shows one.
 *
 * Nothing in this file knows about a route, a loader, or how a page keeps its cast. A page turns what
 * it has into the plain props below — text already in the viewer's language; the card translates only
 * its own labels — so the Movie Maker's cast pickers can use it as it is. A page that shows the turning
 * figure needs SPIN_STAGE_CSS beside CAST_ID_CSS in its stylesheet. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import type { Spin } from "../lib/presenter-kits";
import { SpinStage } from "./SpinStage";

/** What sort of character a cast member is — the three of CharacterKind in app/lib/avatars.ts, spelt
 *  out here so that the card depends on nothing but itself. */
export type CastKind = "person" | "cartoon" | "monster";

// No vowels, so a code can never spell a word; no 0 or 1, which read as O and I.
const CODE_LETTERS = "23456789BCDFGHJKLMNPQRSTVWXZ";

/** The code stamped on a member's card: "EM-" and four characters, made from their id and from nothing
 *  else — the same on the server and in the browser, today and next year. It is decoration, not a key:
 *  nothing looks a member up by it, and with 28 x 28 x 28 x 28 = 614,656 codes two members of one cast
 *  practically never share one. */
export function castIdCode(id: string): string {
  const s = String(id ?? "");
  // FNV-1a over the id, then murmur3's finishing scramble: two ids that differ in their last character
  // (one shop's own characters do) get codes with nothing in common
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  let n = h >>> 0;
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_LETTERS[n % CODE_LETTERS.length];
    n = Math.floor(n / CODE_LETTERS.length);
  }
  return `EM-${code}`;
}

export type CastHoverPlace = { left: number; top: number; side: "right" | "left" | "below" | "above" };

/** Where the floating card goes, in window coordinates: beside the cast card it describes — on the
 *  side asked for, or on the other one when that side has no room (a card in the last column) — level
 *  with its middle, and never off the top or the bottom of the window. A window too narrow to have room
 *  on either side gets it underneath, or on top. `anchor` is the cast card's box, `card` the floating
 *  card's size, `view` the window's. */
export function placeCastHover(
  anchor: { left: number; top: number; right: number; bottom: number },
  card: { w: number; h: number },
  view: { w: number; h: number },
  prefer: "right" | "left" = "right",
  gap = 12,
  edge = 8,
): CastHoverPlace {
  const within = (v: number, lo: number, hi: number) => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));
  const fits = { right: anchor.right + gap + card.w <= view.w - edge, left: anchor.left - gap - card.w >= edge };
  const side = fits[prefer] ? prefer : prefer === "right" ? "left" : "right";
  if (fits[side]) {
    return {
      side,
      left: Math.round(side === "right" ? anchor.right + gap : anchor.left - gap - card.w),
      top: within((anchor.top + anchor.bottom) / 2 - card.h / 2, edge, view.h - edge - card.h),
    };
  }
  const left = within((anchor.left + anchor.right) / 2 - card.w / 2, edge, view.w - edge - card.w);
  const roomBelow = anchor.bottom + gap + card.h <= view.h - edge;
  const roomAbove = anchor.top - gap - card.h >= edge;
  if (roomAbove && !roomBelow) return { side: "above", left, top: Math.round(anchor.top - gap - card.h) };
  return { side: "below", left, top: within(anchor.bottom + gap, edge, view.h - edge - card.h) };
}

const KIND_ICON: Record<CastKind, string> = { person: "presenter", cartoon: "felt", monster: "moon" };

/* ---- what a card says: ONE mapping, for the Presenters section and the Movie Maker alike ---- */

type Tr = (source: string, params?: Record<string, string | number>) => string;

/** Under the card's own "Energy" label, so the words are the Refine chips' ("High energy" there would
 *  say it twice). */
export const CAST_ENERGY = { hype: "Upbeat", warm: "Warm", calm: "Calm" } as const;

/** What a page knows about a cast member that their card shows — plain text and counts, no pictures:
 *  the Movie Maker's loader sends exactly this for each face it offers. */
export type CastCardSource = {
  id: string; name: string; kind: CastKind;
  /** one the shop made itself: its `vibe` is one of the few stock words ("Your creature"), translated */
  custom: boolean;
  vibe: string; about: string; age: string; energy: keyof typeof CAST_ENERGY;
  /** the voice's name ("" = none chosen); `voiceOwn` = one the shop recorded (a name it gave it, never
   *  translated); `signature` = a voice designed for this stock presenter */
  voice: string; voiceOwn: boolean; signature: unknown;
  outfits: number; has3d: boolean;
};

/** The name of the voice a member speaks with, as their cast card and their ID card give it. */
export const castVoiceWord = (c: Pick<CastCardSource, "voice" | "voiceOwn" | "signature">, t: Tr): string =>
  (c.voiceOwn ? c.voice : c.voice ? t(c.voice) : c.signature ? t("Signature") : t("Automatic"));

/** What a member's ID card says — the same in the character view, on the card that floats beside a cast
 *  card, and in the Movie Maker. Whoever they are: a person, a cartoon character, a creature. */
export const idCardOf = (c: CastCardSource, t: Tr) => ({
  id: c.id, name: c.name, kind: c.kind,
  role: c.custom ? t(c.vibe) : c.vibe,
  age: c.age, energy: t(CAST_ENERGY[c.energy] || CAST_ENERGY.warm), voice: castVoiceWord(c, t),
  outfits: c.outfits, has3d: c.has3d,
  about: c.about,
});

const DECADE: Record<string, string> = { twenties: "20s", thirties: "30s", forties: "40s", fifties: "50s", sixties: "60s", seventies: "70s" };
/** "a gentle East Asian woman in her mid twenties with…" → "Mid 20s". Only an age the description
 *  states — a guessed band reads as a fact ("30s–40s" on an ogre mascot). */
export function castAgeText(desc: string): string {
  const m = /\b(early|mid|late)\s+(twenties|thirties|forties|fifties|sixties|seventies)\b/i.exec(desc || "");
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${DECADE[m[2].toLowerCase()]}` : "";
}
/** The cast's descriptions were written as prompts: "a photorealistic friendly ogre" is a note to the
 *  picture model, not something to say about them. */
export const castSentence = (s: string) => {
  const x = (s || "").trim().replace(/\.$/, "").replace(/^(an?) photorealistic /i, "$1 ");
  return x ? `${x[0].toUpperCase()}${x.slice(1)}.` : "";
};

export function CastIdCard({ id, name, kind, role, age, energy, voice, outfits, has3d, about, size = "full", lead, figure, nameSlot, actions, children }: {
  /** The member's id: what the ID code is made from. */
  id: string;
  name: string;
  kind: CastKind;
  /** The line under the name — who they are, in a few words. Already in the viewer's language, as are
   *  `age`, `energy`, `voice` and `about`; a fact with nothing to say is left off the card. */
  role?: string;
  age?: string;
  energy?: string;
  /** The name of the voice they speak with. */
  voice?: string;
  /** How many outfits they have… */
  outfits?: number;
  /** …and whether at least one of them can be turned around. */
  has3d?: boolean;
  about?: string;
  /** "full" in a character view; "mini" is the card that floats beside a cast card. */
  size?: "full" | "mini";
  /** The star of the brand: a gold strip. */
  lead?: boolean;
  /** Who stands on the card (a CastFigure) — the floating card's turning figure. */
  figure?: ReactNode;
  /** In place of the name: a rename form. */
  nameSlot?: ReactNode;
  /** After the name, on its line: a rename pencil, a favourite star. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const t = useT();
  const mini = size === "mini";
  const Name = mini ? "div" : "h2";
  const what: CastKind = kind === "cartoon" || kind === "monster" ? kind : "person";
  const facts: Array<{ k: string; icon: string; label: string; value: ReactNode }> = [
    { k: "kind", icon: KIND_ICON[what], label: t("Kind"), value: what === "cartoon" ? t("Cartoon") : what === "monster" ? t("Creature") : t("Presenter") },
  ];
  if (age) facts.push({ k: "age", icon: "hourglass", label: t("Age"), value: age });
  if (energy) facts.push({ k: "energy", icon: "bolt", label: t("Energy"), value: energy });
  if (outfits || has3d) {
    facts.push({
      k: "outfits", icon: "shirt", label: t("Outfits"),
      value: <>{outfits || null}{has3d ? <span className="pc-id-3d" title={t("3D view")}><Ico n="sphere" size={11} /> {mini ? t("3D") : t("3D view")}</span> : null}</>,
    });
  }
  if (voice) facts.push({ k: "voice", icon: "mic", label: t("Voice"), value: voice });
  return (
    <div className={`pc-id ${mini ? "mini" : "full"} k-${what}${lead ? " lead" : ""}`}>
      {/* the stamp is decoration — a screen reader goes straight to the name */}
      <div className="pc-id-top" aria-hidden="true">
        <span>{t("Cast ID")}</span>
        <span className="pc-id-code" dir="ltr">{castIdCode(id)}</span>
      </div>
      <div className="pc-id-body">
        {figure}
        <div className="pc-id-main">
          {nameSlot || <Name className="pc-id-name">{name}{actions}</Name>}
          {role ? <p className="pc-id-role">{role}</p> : null}
          <dl className="pc-id-facts">
            {facts.map((f) => (
              <div className="pc-id-fact" key={f.k}>
                <dt><Ico n={f.icon} size={12} /> {f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {about ? <p className="pc-id-about">{about}</p> : null}
      {children}
    </div>
  );
}

/** Who stands on the card: their figure, turning, when they have a 3D view — and their picture when
 *  they do not. (SpinStage stands still by itself for a viewer who asked for less motion.) */
export function CastFigure({ spin, img, name }: { spin: Spin | null | undefined; img: string; name: string }) {
  return (
    <div className="pc-id-fig" style={spin ? ({ "--pc-id-ar": String(spin.w / spin.h) } as CSSProperties) : undefined}>
      {spin
        ? <SpinStage spin={spin} name={name} label={name} hint="" loadingLabel="" />
        : <img className="pc-id-pic" src={img} alt="" draggable={false} />}
    </div>
  );
}

/** A card that floats belongs to a mouse — a device that can hover AND point precisely. A phone or a
 *  tablet gets nothing floating: a tap opens the character, and the same card is there. */
export const CAST_HOVER_MEDIA = "(hover:hover) and (pointer:fine)";
/** How long a cast card must be pointed at (or hold the keyboard's focus) before its ID card comes up:
 *  long enough that sweeping the mouse across the grid shows nothing at all. */
export const CAST_HOVER_DELAY_MS = 250;

const canHover = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(CAST_HOVER_MEDIA).matches;

type HoverAt = { id: string; anchor: HTMLElement };

/** Which cast card's ID card is up — at most ONE at a time, so at most one turning figure (sixty frames
 *  each) is ever loaded for it. Spread `bind(id)` on the element that wraps a cast card and render one
 *  <CastHoverCard anchor={at.anchor}> while `at` is set.
 *
 *  It comes up after CAST_HOVER_DELAY_MS of being pointed at with a mouse, or of holding focus that
 *  arrived by the Tab key (focus handed back by a closing dialog, or put there by a click, is not
 *  somebody looking at that card). It goes on leave, blur, any press, Escape, and whenever the cast card
 *  moves under it — a scroll, a resize — coming back once the page has settled if that card is still
 *  the one pointed at. It takes no part in the click: nothing here prevents or stops an event.
 *  `enabled: false` (a dialog is open over the cast) takes it down and keeps it down. */
export function useCastHover(enabled = true) {
  const [at, setAt] = useState<HoverAt | null>(null);
  // who is pointed at or focused right now — whether or not their card is up yet…
  const want = useRef<(HoverAt & { by: "pointer" | "focus" }) | null>(null);
  // …and where their cast card was when it was last looked at
  const seen = useRef<{ anchor: HTMLElement; left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabAt = useRef(-1e9);

  const look = (anchor: HTMLElement) => { const r = anchor.getBoundingClientRect(); seen.current = { anchor, left: r.left, top: r.top }; };
  const down = () => setAt((cur) => (cur ? null : cur));
  const wait = () => {
    if (timer.current) clearTimeout(timer.current);
    if (want.current) look(want.current.anchor);
    timer.current = setTimeout(() => {
      timer.current = null;
      const w = want.current;
      if (!w) return;
      // still on the page, and still pointed at — or still holding the focus?
      if (!w.anchor.isConnected || !(w.by === "pointer" ? w.anchor.matches(":hover") : w.anchor.contains(document.activeElement))) {
        want.current = null;
        seen.current = null;
        return;
      }
      look(w.anchor);
      setAt((cur) => (cur && cur.id === w.id && cur.anchor === w.anchor ? cur : { id: w.id, anchor: w.anchor }));
    }, CAST_HOVER_DELAY_MS);
  };
  // gone, and not coming back by itself
  const drop = () => {
    want.current = null;
    seen.current = null;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    down();
  };

  useEffect(() => {
    if (!enabled) { drop(); return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") tabAt.current = performance.now();
      else if (e.key === "Escape") drop();
    };
    // The ID card is pinned to the window; the cast card it belongs to is not. When that card moves, the
    // ID card goes at once, and comes back when the page has settled if it is still wanted. (A scroll
    // somewhere else — the assistant's chat filling up — moves nothing here and changes nothing.)
    const onMove = (e: Event) => {
      const s = seen.current;
      if (!s) return;
      if (e.type === "scroll") {
        const r = s.anchor.getBoundingClientRect();
        if (r.left === s.left && r.top === s.top) return;
      }
      down();
      if (want.current) wait(); else seen.current = null;
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onMove, { capture: true, passive: true });
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const bind = (id: string) => ({
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || e.pointerType === "touch" || !canHover()) return;
      want.current = { id, anchor: e.currentTarget, by: "pointer" };
      wait();
    },
    onPointerLeave: () => { if (want.current?.by === "pointer") drop(); },
    // a press is a click on its way — the character opening, a star, a voice: out of its way
    onPointerDown: drop,
    onFocus: (e: ReactFocusEvent<HTMLElement>) => {
      if (!enabled || !canHover() || performance.now() - tabAt.current > 500) return;
      if (want.current?.id === id) return;
      want.current = { id, anchor: e.currentTarget, by: "focus" };
      wait();
    },
    onBlur: (e: ReactFocusEvent<HTMLElement>) => {
      // focus stepping between the controls of one cast card is not a blur
      if (want.current?.by === "focus" && !e.currentTarget.contains(e.relatedTarget as Node | null)) drop();
    },
  });

  return { at: enabled ? at : null, bind, hide: drop };
}

/** The floating ID card: `children` (a mini CastIdCard) beside `anchor`, inside the window.
 *
 *  It is an extra for the eye, so it is kept out of everybody's way: `aria-hidden` and `inert` (the
 *  turning figure inside is a slider — nothing may tab into it or read it out; the same card, reachable
 *  by everyone, is in the character view the cast card opens), and `pointer-events:none`, so it can
 *  never be what a click or the mouse lands on. Portaled to <body>: a cast card clips what is inside
 *  it, lifts on hover (a transform would re-anchor anything fixed inside), and sits under the site's
 *  header. */
export function CastHoverCard({ anchor, children }: { anchor: HTMLElement; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<CastHoverPlace | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute("inert", "");
    setPlace(placeCastHover(
      anchor.getBoundingClientRect(),
      { w: el.offsetWidth, h: el.offsetHeight },
      { w: document.documentElement.clientWidth, h: window.innerHeight },
      getComputedStyle(anchor).direction === "rtl" ? "left" : "right",
    ));
  }, [anchor]);
  // it slides in from the cast card's side
  const from = place ? { right: ["-8px", "0px"], left: ["8px", "0px"], below: ["0px", "-8px"], above: ["0px", "8px"] }[place.side] : null;
  const style = (place && from
    ? { left: place.left, top: place.top, "--pc-id-dx": from[0], "--pc-id-dy": from[1] }
    : { visibility: "hidden" }) as CSSProperties;
  return createPortal(
    <div ref={ref} className="pc-id-float" aria-hidden="true" data-side={place?.side} style={style}>{children}</div>,
    document.body,
  );
}

export const CAST_ID_CSS = `
/* ---- the cast's ID card (app/components/CastIdCard.tsx) ---- */
.pc-id{--pc-id-accent:var(--green,#0C7A46);container-type:inline-size;position:relative;box-sizing:border-box;min-width:0;border:1px solid var(--line,#E1DECD);border-radius:16px;background:#fff;overflow:hidden;color:var(--ink,#14201A);text-align:start;box-shadow:0 1px 2px rgba(20,32,26,.04),0 14px 28px -22px rgba(20,32,26,.32);}
/* the thin strip along the top says what kind of cast member this is — the colours the cast cards' own kind badges use */
.pc-id.k-cartoon{--pc-id-accent:#FFD45C;}
.pc-id.k-monster{--pc-id-accent:#2B2140;}
.pc-id.lead{--pc-id-accent:#D3A63A;}
.pc-id::before{content:"";display:block;height:5px;background:var(--pc-id-accent);}
.pc-id-top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px 0;font-size:11px;font-weight:800;line-height:1.3;letter-spacing:.09em;text-transform:uppercase;color:var(--ink2,#4A554E);}
.pc-id-code{direction:ltr;unicode-bidi:isolate;padding:2px 8px;border-radius:7px;background:var(--paper,#F4F1E6);font-family:Poppins,sans-serif;font-size:12px;font-weight:800;letter-spacing:.1em;color:var(--ink,#14201A);white-space:nowrap;}
.pc-id-body{display:flex;gap:12px;padding:8px 14px 14px;}
.pc-id-main{flex:1 1 auto;min-width:0;}
.pc-id-name{display:flex;align-items:center;gap:8px;margin:0;font-family:Poppins,sans-serif;font-weight:800;font-size:27px;line-height:1.1;letter-spacing:-.02em;color:var(--ink,#14201A);overflow-wrap:anywhere;}
.pc-id-role{margin:4px 0 0;font-size:14px;font-weight:700;line-height:1.35;color:var(--green,#0C7A46);}
/* the facts: two across on a narrow card, three on a roomy one; the last takes what is left of its row */
.pc-id-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;margin:12px 0 0;padding:0;}
.pc-id-fact{min-width:0;}
.pc-id-fact dt{display:flex;align-items:center;gap:4px;margin:0;font-size:11px;font-weight:800;line-height:1.3;letter-spacing:.07em;text-transform:uppercase;color:var(--ink2,#4A554E);}
.pc-id-fact dt svg{color:var(--green,#0C7A46);}
.pc-id-fact dd{display:flex;align-items:center;flex-wrap:wrap;gap:3px 6px;margin:2px 0 0;font-size:14px;font-weight:700;line-height:1.3;color:var(--ink,#14201A);overflow-wrap:anywhere;}
.pc-id-fact:last-child:nth-child(odd){grid-column:1/-1;}
.pc-id-3d{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:999px;background:#E3F3EA;color:var(--green,#0C7A46);font-size:11px;font-weight:800;line-height:1.3;letter-spacing:.02em;white-space:nowrap;}
.pc-id-about{margin:0 14px 14px;padding:12px 0 0;border-top:1px dashed var(--line2,#D7DCCB);font-size:13.5px;line-height:1.5;color:var(--ink2,#4A554E);}
[dir="rtl"] .pc-id-top,[dir="rtl"] .pc-id-fact dt{letter-spacing:0;}
@container (min-width:440px){
  .pc-id-top{padding:11px 18px 0;}
  .pc-id-body{padding:8px 18px 16px;}
  .pc-id-name{font-size:32px;line-height:1.08;}
  .pc-id-facts{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 14px;margin-top:14px;}
  .pc-id-fact:last-child:nth-child(odd){grid-column:auto;}
  .pc-id-fact:last-child:nth-child(3n+1){grid-column:1/-1;}
  .pc-id-fact:last-child:nth-child(3n+2){grid-column:span 2;}
  .pc-id-about{margin:0 18px 16px;padding-top:13px;}
}
/* who stands on the card — on the studio wall every presenter stands on (.ph-bd in the Presenters section) */
.pc-id-fig{position:relative;flex:0 0 136px;align-self:flex-start;aspect-ratio:3/4;border-radius:12px;overflow:hidden;container-type:size;background:radial-gradient(125% 95% at 50% 22%,#EDF1E8 0%,#D9E1D4 55%,#C2CDBE 100%);}
.pc-id-pic{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 18%;display:block;}
.pc-id-fig .spin{cursor:default;}
.pc-id-fig .spin-tip{display:none;}
.pc-id-fig .spin-fig{height:84%;margin-bottom:6%;}
/* a cartoon pup is nearly as wide as it is tall: as tall as the frame allows, and never wider than it */
@supports (height:1cqh){.pc-id-fig .spin-fig{height:min(84cqh,calc(90cqw / var(--pc-id-ar,.4)));}}
/* ---- the card that floats beside a cast card ---- */
.pc-id.mini{width:348px;border-radius:18px;box-shadow:0 2px 6px rgba(20,32,26,.1),0 28px 56px -20px rgba(20,32,26,.5);}
.pc-id.mini .pc-id-top{padding:8px 12px 0;}
.pc-id.mini .pc-id-body{padding:8px 12px 12px;}
.pc-id.mini .pc-id-name{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:19px;line-height:1.15;letter-spacing:-.01em;}
.pc-id.mini .pc-id-role{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;margin-top:2px;font-size:12.5px;}
.pc-id.mini .pc-id-facts{gap:8px 10px;margin-top:10px;}
.pc-id.mini .pc-id-fact dd{font-size:13px;}
.pc-id.mini .pc-id-about{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;margin:0 12px 12px;padding-top:10px;font-size:12.5px;line-height:1.45;}
.pc-id-float{position:fixed;z-index:10400;left:0;top:0;pointer-events:none;-webkit-user-select:none;user-select:none;font-family:Inter,-apple-system,sans-serif;animation:pcidin .18s cubic-bezier(.2,.8,.2,1) both;}
@keyframes pcidin{from{opacity:0;transform:translate(var(--pc-id-dx,0px),var(--pc-id-dy,0px)) scale(.97);}}
@media not all and (hover:hover) and (pointer:fine){.pc-id-float{display:none;}}
@media(prefers-reduced-motion:reduce){.pc-id-float{animation:none;}}
`;

/* ---- a finger: press and hold ---- */

/** How long a finger must rest on a face before its card opens: a tap (which picks) never gets there. */
export const CAST_HOLD_MS = 500;
/** How far the finger may drift meanwhile, in CSS pixels: further is a scroll, or a swipe along a row. */
export const CAST_HOLD_SLOP = 10;

type Press = { id: string; anchor: HTMLElement; x: number; y: number; pointer: number };

/** For the Movie Maker's cast pickers, where a tap PICKS a face (in the Presenters section a tap opens
 *  the character, so there is nothing to hold there). One hook for every picker on the page; spread
 *  `bind(key)` on each face that has a card.
 *    - A mouse: useCastHover, as it is. `at` is the face whose card floats beside it.
 *    - A finger (or a pen) resting CAST_HOLD_MS on a face: `held` is that face, and the page shows its
 *      card as a sheet. Drifting more than CAST_HOLD_SLOP, lifting, the browser taking the touch for a
 *      scroll (pointercancel), or a scroll anywhere — and it was an ordinary tap, or a swipe.
 *  A HOLD IS NOT ALSO A PICK: the one click the browser may send when that finger lifts is swallowed —
 *  only that one (the next press starts clean; a keyboard's click, detail 0, is never touched). The
 *  phone's own long-press menu is refused while a finger rests on a face — on Android the "contextmenu"
 *  that a long press raises opens the card at once instead. Text selection and the iOS callout are
 *  stopped by the page's CSS, on [data-cast-hold]. `enabled: false` (something open over the pickers)
 *  closes both. */
export function useCastPeek(enabled = true) {
  const [held, setHeld] = useState<HoverAt | null>(null);
  const hover = useCastHover(enabled && !held);
  const press = useRef<Press | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallow = useRef(false);

  const cancel = () => {
    press.current = null;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };
  const open = () => {
    const p = press.current;
    cancel();
    if (!p || !p.anchor.isConnected) return;
    swallow.current = true;
    setHeld({ id: p.id, anchor: p.anchor });
  };
  const close = () => { swallow.current = false; setHeld(null); };

  useEffect(() => {
    if (!enabled) { cancel(); close(); return; }
    // a scroll anywhere — the page, a row of faces — is not a hold
    const onScroll = () => cancel();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => { window.removeEventListener("scroll", onScroll, true); cancel(); };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const bind = (id: string) => {
    const h = hover.bind(id);
    return {
      ...h,
      "data-cast-hold": "",
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        h.onPointerDown();
        swallow.current = false;
        cancel();
        if (!enabled || e.pointerType === "mouse" || !e.isPrimary) return;
        press.current = { id, anchor: e.currentTarget, x: e.clientX, y: e.clientY, pointer: e.pointerId };
        timer.current = setTimeout(open, CAST_HOLD_MS);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const p = press.current;
        if (p && p.pointer === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > CAST_HOLD_SLOP) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
        if (!swallow.current || e.detail === 0) return;
        swallow.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
      onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
        if (press.current?.id === id) { e.preventDefault(); open(); }
        else if (swallow.current) e.preventDefault();
      },
    };
  };

  return { at: enabled && !held ? hover.at : null, held: enabled ? held : null, bind, close, hide: hover.hide };
}
