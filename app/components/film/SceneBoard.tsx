/* THE SCENE BOARD — an acted film's script as a storyboard you direct, not a form you fill.
 *
 * The owner, 2026-11-25, of the script editor this replaces: "Scene design also comes across as fucking
 * boring and a chore". It was a fieldset per place: a title input, a row of nine grey text chips, then a
 * text box per line with a seconds bar under every one. A rival's storyboard — a picture for every scene —
 * out-looked it. His bars: it must LOOK simple, easy and fun; phone-first; "make it look banging".
 *
 * So the same script, the same edits (lib/film-flow.ts — nothing here keeps a script of its own), shown as
 * what a director is handed:
 *
 *   EACH PLACE IS A SHEET   pinned to a board. Its top is the scene's PICTURE: a pencil sketch in the film's
 *                           shape (lib/film-sketch.ts), developing in when it arrives; until then a drawn
 *                           sheet of storyboard paper, never a grey box. Across its lower edge, a slate
 *                           strip: a clapper tag ("SC 1") and the place in the story's own words. Tap the
 *                           strip to retype the place, or to pick a backdrop from a row that is hidden
 *                           until asked for.
 *   THE LINES ARE PLAYED    each line a speech bubble beside its speaker's face, sides alternating like a
 *                           conversation. At rest it is TEXT. Tap a bubble and it edits in place; the
 *                           seconds meter is there only while you type, or as a quiet mark on a line that
 *                           runs long. Tap a face or a name: the next of the cast says it.
 *   DIRECTING IS ONE TAP    under the lines, the genre's four notes and "New take". The page asks the
 *                           writer (lib/film-rewrite.ts); meanwhile that sheet shimmers and its lines hold,
 *                           and the new ones settle in and glow for a second. Most people will never type.
 *   QUIET TOOLS             "+ line" and "close-up" at the foot; on the picture's corner, earlier / later /
 *                           remove (asked twice). Between sheets a cut mark, not a sentence. After the last,
 *                           a dashed "+ New scene".
 *
 * WHAT IS TYPED IS KEPT HERE WHILE IT IS TYPED. A line is "NAME: words" in the script, and the script hands
 * its words back trimmed — so a box fed straight from the script loses every space typed at the end of it
 * (the old editor did: a space, then the next word, came out as one word). The bubble, the place and the
 * close-up each hold their own text while they are open, send every change up, and show the script's again
 * when they close. For the same reason a place or a close-up is only sent when it is not empty: an emptied
 * place IS the place before it, and the sheet being typed in would vanish.
 *
 * This file knows nothing of the route, its fetchers or its state: every edit is a call the page answers.
 * A scene index is an index into the page's FLAT list of shots, a place index into `flow`. The look is
 * film-kit-style.ts (class prefix fk-); the page mounts that sheet once. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Ico } from "../../lib/icons";
import { backdropIs, filmClock, sideOf, type FlowLoc } from "../../lib/film-flow";

export type BoardBackdrop = { key: string; label: string; where?: string };
export type BoardNote = { key: string; label: string };
export type BoardAspect = "16:9" | "9:16" | "1:1";
type T = (source: string, params?: Record<string, string | number>) => string;

export type SceneBoardProps = {
  /** The script, grouped (flowOf(treatment.scenes)). */
  flow: FlowLoc[];
  /** Who speaks, in the order sides are dealt by (speakersOf). */
  speakers: string[];
  /** A speaker's picture, when they are cast. */
  faceOf: (name: string) => string | null;
  /** A speaker's name as the cast spells it. */
  displayName: (name: string) => string;
  /** The genre's places. `where` is what a tap writes into the scene (the label, when there is none). */
  backdrops: BoardBackdrop[];
  /** The genre's four one-tap notes ("New take" is the board's own). */
  notes: BoardNote[];
  /** One sketch (or none yet) per place, in the board's order. */
  sketches: (string | null)[];
  /** Sketches are being drawn. */
  sketching: boolean;
  /** The place the writer is rewriting, or null. */
  noting: number | null;
  /** The film's shape. */
  aspect: BoardAspect;
  title?: string;
  /** The whole film's spoken seconds. */
  totalSeconds: number;
  /** How long a line takes to say, and the longest one shot holds. */
  secondsOf: (text: string) => number;
  maxSeconds: number;
  onLine: (sceneIndex: number, text: string) => void;
  onSpeaker: (sceneIndex: number) => void;
  onAddLine: (sceneIndex: number) => void;
  onRemoveLine: (sceneIndex: number) => void;
  onCloseUp: (sceneIndex: number) => void;
  onAngleShot: (sceneIndex: number, text: string) => void;
  onRemoveAngle: (sceneIndex: number) => void;
  onWhere: (placeIndex: number, where: string) => void;
  onMove: (placeIndex: number, dir: -1 | 1) => void;
  onRemovePlace: (placeIndex: number) => void;
  onAddScene: () => void;
  onNote: (placeIndex: number, key: string) => void;
  /** "Rewrite all" — the page owns the asking-first; `rewriteArmed` is its "tap again" state. */
  onRewriteAll: () => void;
  rewriteArmed?: boolean;
  /** The whole script is being written again: every sheet holds. */
  busy?: boolean;
  t: T;
};

/** The key the page is sent for the board's own note. (lib/film-rewrite.ts → NEW_TAKE has the same key.) */
export const NEW_TAKE_KEY = "newtake";

/* ---- small drawn things ------------------------------------------------------------------------------ */

const svg = (size: number, children: JSX.Element, extra?: CSSProperties) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "0 0 auto", ...extra }}>{children}</svg>
);
const Dice = ({ size = 15 }: { size?: number }) => svg(size, <><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.6" /><circle cx="8.6" cy="8.6" r=".9" fill="currentColor" /><circle cx="15.4" cy="15.4" r=".9" fill="currentColor" /><circle cx="12" cy="12" r=".9" fill="currentColor" /><circle cx="15.4" cy="8.6" r=".9" fill="currentColor" /><circle cx="8.6" cy="15.4" r=".9" fill="currentColor" /></>);
const Up = ({ size = 15 }: { size?: number }) => svg(size, <path d="M12 19V5.5M6 11l6-6 6 6" />);
const Down = ({ size = 15 }: { size?: number }) => svg(size, <path d="M12 5v13.5M6 13l6 6 6-6" />);
const Plus = ({ size = 14 }: { size?: number }) => svg(size, <path d="M12 5v14M5 12h14" />);

/* A backdrop's own small drawing — the chips were nine grey words. Keyed by the backdrop's key (the word of
 * the place it lights up for); a place nobody drew gets a map pin. Same grid and stroke as lib/icons. */
const HOUSE = <><path d="M4 11.2 12 4.6l8 6.6" /><path d="M6.2 9.8V19h11.6V9.8" /><path d="M10.4 19v-4.6h3.2V19" /></>;
const TREES = <><path d="M8 4.4 4.4 11h7.2z" /><path d="M8 11v8.6" /><path d="M16.4 7.2 13.2 13h6.4z" /><path d="M16.4 13v6.6" /></>;
const SHOP = <><path d="M4.2 9.6 5.6 5h12.8l1.4 4.6" /><path d="M4.2 9.6a2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0" /><path d="M5.6 12v7h12.8v-7" /></>;
const CUP = <><path d="M5.4 9h11v4.6a4.6 4.6 0 0 1-4.6 4.6h-1.8a4.6 4.6 0 0 1-4.6-4.6z" /><path d="M16.4 10.4h1.4a2.2 2.2 0 0 1 0 4.4h-1.6" /><path d="M9 6.4c0-1 .9-1 .9-2M12.4 6.4c0-1 .9-1 .9-2" /></>;
const DESK = <><rect x="4.6" y="4.6" width="14.8" height="14.8" rx="1.6" /><path d="M8.6 8.4h2M13.4 8.4h2M8.6 12h2M13.4 12h2M10.4 19.4v-3.6h3.2v3.6" /></>;
const BED = <><path d="M3.8 18.6V7.4M3.8 14.6h16.4v4" /><path d="M3.8 11h6.6a3 3 0 0 1 3 3v.6" /><path d="M20.2 14.6v-1.2a2.4 2.4 0 0 0-2.4-2.4h-4" /></>;
const ROAD = <><path d="M8.4 4.6 5 19.4M15.6 4.6 19 19.4" /><path d="M12 5.4v2.4M12 10.8v2.4M12 16.2v2.4" /></>;
const CROSS = <><path d="M6.4 19.4v-8.6a5.6 5.6 0 0 1 11.2 0v8.6" /><path d="M4.4 19.4h15.2" /><path d="M12 9.2v5M10 11.2h4" /></>;
const BACKDROP_GLYPHS: Record<string, JSX.Element> = {
  house: HOUSE, home: HOUSE, cabin: HOUSE, cottage: HOUSE, apartment: DESK, flat: DESK,
  woods: TREES, forest: TREES, park: <><circle cx="9" cy="8.6" r="4.2" /><path d="M9 12.8v6.8" /><path d="M13.6 19.4h6.2M14.8 19.4v-3.2h3.8v3.2" /></>, backyard: TREES, garden: TREES, jungle: TREES,
  shop: SHOP, market: SHOP, store: SHOP, bakery: SHOP, mall: SHOP,
  diner: CUP, cafe: CUP, restaurant: CUP, bar: <><path d="M6 4.8h12l-6 7.4z" /><path d="M12 12.2v7M8.6 19.4h6.8" /></>, tavern: CUP, pub: CUP,
  office: DESK, hotel: DESK, motel: <><path d="M4.4 19.4V8.2h15.2v11.2" /><path d="M4.4 12.4h15.2" /><path d="M8 15.6v3.8M12 15.6v3.8M16 15.6v3.8M9 4.6h6v3.6" /></>, hospital: <><rect x="4.6" y="5.4" width="14.8" height="14" rx="1.6" /><path d="M12 9.2v5.2M9.4 11.8h5.2" /></>, school: <><path d="M3.6 10 12 5.4l8.4 4.6-8.4 4.6z" /><path d="M7 12v4.4c1.4 1.4 3 2 5 2s3.6-.6 5-2V12" /></>, classroom: <><rect x="3.8" y="5" width="16.4" height="10.6" rx="1.4" /><path d="M8 19.4l1.6-3.8M16 19.4l-1.6-3.8M7.4 9h5.2M7.4 11.8h3" /></>, library: <><path d="M5 5h3.4v14.4H5zM10.4 5h3.4v14.4h-3.4z" /><path d="m15.6 6.4 3-.8 2.6 13-3 .8z" /></>,
  kitchen: <><path d="M6.4 11.4h11.2v3.4a4.4 4.4 0 0 1-4.4 4.4h-2.4a4.4 4.4 0 0 1-4.4-4.4z" /><path d="M4.4 11.4h15.2" /><path d="M9.6 8.2c0-1.1 1-1.1 1-2.2M13.4 8.2c0-1.1 1-1.1 1-2.2" /></>,
  living: <><path d="M5.4 12.4V9.2a2.6 2.6 0 0 1 2.6-2.6h8a2.6 2.6 0 0 1 2.6 2.6v3.2" /><path d="M3.8 12.6a1.8 1.8 0 0 1 3.6 0v2.2h9.2v-2.2a1.8 1.8 0 0 1 3.6 0v4.6H3.8z" /><path d="M6 17.2v2M18 17.2v2" /></>,
  bedroom: BED, attic: <><path d="M3.6 18.6 12 5.4l8.4 13.2z" /><circle cx="12" cy="13.6" r="2.2" /></>, basement: <><path d="M4.4 5.4h4.2v4.4h3.6v4.4h3.6v4.4h3.8" /><path d="M4.4 5.4v13.2h15.2" /></>, cellar: <><path d="M4.4 5.4h4.2v4.4h3.6v4.4h3.6v4.4h3.8" /><path d="M4.4 5.4v13.2h15.2" /></>,
  street: ROAD, road: ROAD, alley: ROAD, highway: ROAD, bridge: <><path d="M3.6 15.4h16.8" /><path d="M5.4 15.4c0-4.6 3-7.6 6.6-7.6s6.6 3 6.6 7.6" /><path d="M8.6 15.4v-4.2M12 15.4V7.8M15.4 15.4v-4.2M5.4 15.4v4M18.6 15.4v4" /></>,
  car: <><path d="M4.4 15.6v-3l1.8-4.2a1.6 1.6 0 0 1 1.5-1h8.6a1.6 1.6 0 0 1 1.5 1l1.8 4.2v3" /><path d="M3.8 15.6h16.4" /><circle cx="7.8" cy="16.2" r="1.7" /><circle cx="16.2" cy="16.2" r="1.7" /></>,
  bus: <><rect x="4.6" y="4.8" width="14.8" height="12.4" rx="2.2" /><path d="M4.6 11.2h14.8M8 17.2v2.2M16 17.2v2.2M8.2 14.2h.1M15.8 14.2h.1" /></>, train: <><rect x="5.6" y="4.4" width="12.8" height="12.6" rx="2.6" /><path d="M5.6 11h12.8M9 14h.1M15 14h.1M8 17l-2 2.6M16 17l2 2.6" /></>, station: <><path d="M3.8 9.4 12 4.8l8.2 4.6" /><path d="M5.6 9.4v10h12.8v-10" /><circle cx="12" cy="13" r="2.4" /><path d="M12 11.8V13l.9.6" /></>,
  warehouse: <><path d="M3.8 19.4V9.6L12 5l8.2 4.6v9.8" /><path d="M7.6 19.4v-6.2h8.8v6.2M7.6 16.2h8.8" /></>, garage: <><path d="M3.8 19.4V9.6L12 5l8.2 4.6v9.8" /><path d="M7.6 19.4v-6.2h8.8v6.2M7.6 16.2h8.8" /></>, factory: <><path d="M3.8 19.4V11l5 3v-3l5 3V6.6h4.4v12.8z" /></>,
  playground: <><path d="M5 19.4 9 5.4M13 19.4 9 5.4" /><path d="M9 9.6h9.4M15.4 9.6v5.2M18.4 9.6v5.2M14.6 14.8h4.6" /></>,
  beach: <><path d="M3.6 18.6c2-1.4 4-1.4 6 0s4 1.4 6 0 3.4-1.2 4.8-.4" /><path d="M11.6 15.4 14.4 6" /><path d="M7.6 9.8a7 7 0 0 1 13.2-1.2c-2-1.2-4-1-5.6.2-1.2-1.6-3.4-1.8-7.6 1z" /></>, sea: <><path d="M3.6 9.6c2-1.4 4-1.4 6 0s4 1.4 6 0 3.4-1.2 4.8-.4M3.6 14.6c2-1.4 4-1.4 6 0s4 1.4 6 0 3.4-1.2 4.8-.4" /></>, lake: <><path d="M3.6 9.6c2-1.4 4-1.4 6 0s4 1.4 6 0 3.4-1.2 4.8-.4M3.6 14.6c2-1.4 4-1.4 6 0s4 1.4 6 0 3.4-1.2 4.8-.4" /></>,
  farm: <><path d="M4.4 19.4v-8L8.6 6l4.2 5.4v8z" /><path d="M7 19.4v-4.2h3.2v4.2M12.8 13.6h6.8v5.8h-6.8M15.2 13.6v5.8M17.4 13.6v5.8" /></>, barn: <><path d="M4.4 19.4v-8L8.6 6l4.2 5.4v8z" /><path d="M7 19.4v-4.2h3.2v4.2" /></>,
  cemetery: CROSS, graveyard: CROSS, chapel: <><path d="M12 3.6v4.2M10.4 5.2h3.2" /><path d="M7 19.4v-7.2l5-4.4 5 4.4v7.2z" /><path d="M10.6 19.4v-3.4a1.4 1.4 0 0 1 2.8 0v3.4" /></>, church: <><path d="M12 3.6v4.2M10.4 5.2h3.2" /><path d="M7 19.4v-7.2l5-4.4 5 4.4v7.2z" /><path d="M10.6 19.4v-3.4a1.4 1.4 0 0 1 2.8 0v3.4" /></>,
  castle: <><path d="M4.6 19.4V6h2.6v2.4h2.4V6h4.8v2.4h2.4V6h2.6v13.4z" /><path d="M10.4 19.4v-4a1.6 1.6 0 0 1 3.2 0v4" /></>, lighthouse: <><path d="M9.4 19.4 10.6 9h2.8l1.2 10.4z" /><path d="M10 9V6.2h4V9M12 6.2V4.4M5 7l3 .8M19 7l-3 .8" /></>,
  rooftop: <><path d="M3.8 13.6h16.4M6 13.6v5.8M18 13.6v5.8" /><path d="M8.6 13.6V8.4h3v5.2M14.6 13.6V6h2.6v7.6" /></>, lab: <><path d="M9.6 4.6h4.8M10.4 4.6v5L5.6 18a1 1 0 0 0 .9 1.4h11a1 1 0 0 0 .9-1.4l-4.8-8.4v-5" /><path d="M8.2 14.6h7.6" /></>,
  ship: <><path d="M4 14.6h16l-2.2 4.4H6.2z" /><path d="M12 14.6V4.8l5.4 6.6H12" /></>, boat: <><path d="M4 14.6h16l-2.2 4.4H6.2z" /><path d="M12 14.6V4.8l5.4 6.6H12" /></>, spaceship: <><path d="M12 3.8c3 2.6 4.2 6.4 3.4 11H8.6c-.8-4.6.4-8.4 3.4-11z" /><circle cx="12" cy="9.6" r="1.6" /><path d="M8.6 14.8 6 18.2M15.4 14.8l2.6 3.4M12 17v3" /></>,
  desert: <><path d="M3.6 18.4c3-3.2 5.6-3.2 8.4 0 2.4-2.2 5-2.2 8.4 0" /><circle cx="16.8" cy="7.4" r="2.6" /></>, mountain: <><path d="M3.6 18.6 9.6 7l3.8 6.4 2.2-3 4.8 8.2z" /></>, cave: <><path d="M3.8 19.4c0-8.6 3.6-13.4 8.2-13.4s8.2 4.8 8.2 13.4z" /><path d="M9.4 19.4c0-3.2 1.2-5 2.6-5s2.6 1.8 2.6 5" /></>,
  gym: <><path d="M4.4 9v6M7.2 7.4v9.2M16.8 7.4v9.2M19.6 9v6M7.2 12h9.6" /></>, court: <><path d="M4 19.4h16M5.6 19.4V10M18.4 19.4V10M9.8 19.4V10M14.2 19.4V10M3.8 10 12 5l8.2 5z" /></>, theater: <><path d="M4.4 5.4h15.2v6.2a7.6 7.6 0 0 1-15.2 0z" /><path d="M8.6 9.4h.1M15.4 9.4h.1M9 13.4c1.8 1.6 4.2 1.6 6 0" /></>,
};
const PIN = <><path d="M12 20.4s6.2-5.8 6.2-10.2a6.2 6.2 0 0 0-12.4 0c0 4.4 6.2 10.2 6.2 10.2z" /><circle cx="12" cy="10.2" r="2.2" /></>;
const backdropGlyph = (key: string): JSX.Element => BACKDROP_GLYPHS[(key || "").toLowerCase()] || PIN;

/** A box that is as tall as what is typed in it (called with the box on every render it is in). */
const grow = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
};

/* ---- the picture -------------------------------------------------------------------------------------- */

/** A sketch DEVELOPS in: it is there, blurred and faint, and comes sharp — once, when its picture has loaded
 *  (also when it was already in the browser's cache, which fires no load event the page can hear).
 *  A sketch that will not load (a /renders file gone after a disk change, a network drop) is NOT shown as a
 *  broken picture: the sheet goes back to its drawn blank (`fallback`) — review of 2026-11-25. */
function Sketch({ url, alt, fallback }: { url: string; alt: string; fallback: JSX.Element }) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setReady(false); setFailed(false); const el = ref.current; if (el && el.complete && el.naturalWidth > 0) setReady(true); }, [url]);
  if (failed) return fallback;
  return <img ref={ref} className={`fk-sketch${ready ? " is-in" : ""}`} src={url} alt={alt} loading="lazy" decoding="async" draggable={false} onLoad={() => setReady(true)} onError={() => setFailed(true)} />;
}

/** The sheet before its sketch: storyboard paper with the frame ruled in thirds, the scene's number, and —
 *  when the place is one of the genre's backdrops — that backdrop's drawing in pencil. While sketches are
 *  being drawn, a pencil line draws itself across the foot of the frame. */
function BlankSheet({ n, glyph, drawing, t }: { n: number; glyph: JSX.Element | null; drawing: boolean; t: T }) {
  return (
    <div className={`fk-blank${drawing ? " is-drawing" : ""}`}>
      <svg className="fk-blank-rule" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M53.3 0v90M106.7 0v90M0 30h160M0 60h160" />
      </svg>
      <span className="fk-blank-n" aria-hidden="true">{n}</span>
      <svg className="fk-blank-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{glyph || <><path d="M2.6 16.8h18.8" /><circle cx="9" cy="10.4" r="1.9" /><path d="M5.8 16.8c0-2.2 1.4-3.6 3.2-3.6s3.2 1.4 3.2 3.6" /><circle cx="15.6" cy="11" r="1.7" /><path d="M12.8 16.8c0-2 1.2-3.2 2.8-3.2s2.8 1.2 2.8 3.2" /></>}</svg>
      <svg className="fk-blank-line" viewBox="0 0 160 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M4 7c10-6 16 5 26 0s14-5 24 0 16 5 26 0 14-5 24 0 16 5 26 0 14-4 22-1" pathLength={100} />
      </svg>
      {drawing && <span className="fk-blank-say">{t("Sketching…")}</span>}
    </div>
  );
}

/* ---- the board ---------------------------------------------------------------------------------------- */

export function SceneBoard(props: SceneBoardProps) {
  const { flow, speakers, faceOf, displayName, backdrops, notes, sketches, sketching, noting, aspect, title, totalSeconds, secondsOf, maxSeconds, t } = props;
  const busy = !!props.busy;
  // the bubble being typed in (its scene index), and its text while it is
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const was = useRef("");
  const box = useRef<HTMLTextAreaElement | null>(null);
  // the sheet whose slate is open (its place being retyped, its backdrops out)
  const [openPlace, setOpenPlace] = useState<number | null>(null);
  const [whereDraft, setWhereDraft] = useState("");
  // the close-up being retyped
  const [angleAt, setAngleAt] = useState<number | null>(null);
  const [angleDraft, setAngleDraft] = useState("");
  // "remove this scene", asked twice
  const [armed, setArmed] = useState<number | null>(null);
  // the note a sheet is being rewritten to, and the sheet whose new lines just arrived
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const taken = useRef<{ place: number; lines: string; back: number } | null>(null);

  const total = flow.reduce((a, l) => a + l.angles.reduce((b, g) => b + g.beats.length, 0), 0);
  const linesOf = (loc: FlowLoc | undefined) => (loc ? loc.angles.map((g) => g.beats.map((b) => `${b.speaker}:${b.line}`).join("\n")).join("\n") : "");

  /* THE NEW LINES GLOW — for a second, when the writer hands a sheet back and its lines are not the ones it
   * took. The page may put the new lines into the script a render AFTER it stops saying "rewriting" (it
   * learns both from one fetcher), so the sheet's lines are remembered when it goes to the writer and looked
   * at again on every render for a moment after it comes back. A rewrite that failed changes nothing, and
   * nothing glows. */
  useEffect(() => {
    if (noting !== null) { taken.current = { place: noting, lines: linesOf(flow[noting]), back: 0 }; return; }
    if (taken.current) taken.current.back = Date.now();
    setNoteKey(null);
    // (only WHICH sheet is with the writer matters here; its lines are read as they are at that moment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noting]);
  useEffect(() => {
    const was = taken.current;
    if (!was || noting !== null) return;
    if (linesOf(flow[was.place]) !== was.lines) { taken.current = null; setFresh(was.place); }
    else if (was.back && Date.now() - was.back > 1200) taken.current = null;
  });
  useEffect(() => {
    if (fresh === null) return;
    const id = setTimeout(() => setFresh(null), 1600);
    return () => clearTimeout(id);
  }, [fresh]);

  // a bubble opened for typing takes the cursor, at the end of its words, and is as tall as they are
  useEffect(() => {
    const el = box.current;
    if (editing === null || !el) return;
    try { el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); } catch { /* a nicety */ }
  }, [editing]);
  useLayoutEffect(() => { if (editing !== null) grow(box.current); }, [editing, draft]);

  // "remove?" forgets it was asked
  useEffect(() => {
    if (armed === null) return;
    const id = setTimeout(() => setArmed(null), 3800);
    return () => clearTimeout(id);
  }, [armed]);

  // while the writer has a sheet (or the whole script) nothing is open: what was being typed is already in
  // the script, and what comes back must not be met by a box still holding the old words
  const held = busy || noting !== null;
  useEffect(() => { if (held) { setEditing(null); setOpenPlace(null); setAngleAt(null); setArmed(null); } }, [held]);

  const openLine = (idx: number, line: string) => { was.current = line; setDraft(line); setEditing(idx); };
  /* A NEW LINE OPENS READY TO TYPE. "+ line", "close-up" and "+ New scene" each add one empty line, at a
   * place in the script this board can name before the page has added it; when the script next grows and
   * that line is there, and empty, it opens. (Asked for and not added within a second: forgotten.) */
  const wanted = useRef<{ idx: number; at: number } | null>(null);
  const openWhenAdded = (idx: number) => { wanted.current = { idx, at: Date.now() }; };
  useEffect(() => {
    const w = wanted.current;
    if (!w) return;
    wanted.current = null;
    if (Date.now() - w.at > 1000) return;
    const beat = flow.flatMap((l) => l.angles.flatMap((g) => g.beats)).find((b) => b.idx === w.idx);
    if (beat && !beat.line) openLine(w.idx, "");
    // (only the script growing matters; the line is looked up as the script is at that moment)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);
  const typeLine = (idx: number, text: string) => { setDraft(text); props.onLine(idx, text); };
  const closeLine = () => setEditing(null);
  const lineKeys = (e: ReactKeyboardEvent<HTMLTextAreaElement>, idx: number) => {
    // Enter is "done" (a line is one spoken line, not a paragraph); Escape puts back what was there
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); closeLine(); }
    // (…only when something WAS typed: a shot with no line that is opened and left alone is never touched)
    else if (e.key === "Escape") { e.preventDefault(); if (draft !== was.current) props.onLine(idx, was.current); closeLine(); }
  };

  const sendWhere = (li: number) => {
    const next = whereDraft.replace(/\s+/g, " ").trim();
    if (next && flow[li] && next !== flow[li].where) props.onWhere(li, next);
  };
  const toggleSlate = (li: number) => {
    // (one thing open at a time: a bubble or a close-up being typed in closes — what was typed is already sent)
    setEditing(null); setAngleAt(null);
    if (openPlace === li) { sendWhere(li); setOpenPlace(null); return; }
    if (openPlace !== null) sendWhere(openPlace);
    setWhereDraft(flow[li]?.where || "");
    setOpenPlace(li);
  };
  const pickBackdrop = (li: number, bd: BoardBackdrop) => {
    const where = (bd.where || t(bd.label)).trim();
    setWhereDraft(where);
    if (where && where !== flow[li]?.where) props.onWhere(li, where);
  };
  const sendAngle = (idx: number) => {
    const next = angleDraft.replace(/\s+/g, " ").trim();
    if (next) props.onAngleShot(idx, next);
    setAngleAt(null);
  };
  // (a structural edit moves the indexes everything open is kept by: close what is open first)
  const settle = () => { if (openPlace !== null) sendWhere(openPlace); setOpenPlace(null); setEditing(null); setAngleAt(null); setArmed(null); };
  const note = (li: number, key: string) => { settle(); setNoteKey(key); props.onNote(li, key); };
  const removePlace = (li: number) => {
    if (armed !== li) { setArmed(li); return; }
    settle();
    props.onRemovePlace(li);
  };

  const sceneCount = flow.length === 1 ? t("1 scene") : t("{n} scenes", { n: flow.length });

  return (
    <section className={`fk fk-board${busy ? " is-busy" : ""}`} data-aspect={aspect} aria-label={t("Storyboard")}>
      {/* THE SLATE: the film's own, across the top of the board */}
      <header className="fk-slate">
        <span className="fk-slate-sticks" aria-hidden="true" />
        <div className="fk-slate-row">
          <div className="fk-slate-ttl">
            <i>{t("Production")}</i>
            <b>{title && title.trim() ? title : t("Untitled film")}</b>
          </div>
          <div className="fk-slate-meta">{sceneCount} <span aria-hidden="true">·</span> <span className="fk-num" title={t("Estimated spoken length of the whole film")}>≈ {filmClock(totalSeconds)}</span></div>
          <button type="button" className={`fk-slate-rw${props.rewriteArmed ? " is-arm" : ""}`} onClick={() => { settle(); props.onRewriteAll(); }} disabled={held}>
            <Ico n="refresh" size={13} /> {props.rewriteArmed ? t("Tap again to rewrite") : t("Rewrite all")}
          </button>
        </div>
      </header>

      <ol className="fk-wall">
        {flow.map((loc, li) => {
          const isNoting = noting === li;
          const isOpen = openPlace === li && !held;
          const sketch = sketches[li] || null;
          const lit = backdrops.find((bd) => backdropIs(loc.where, bd.key));
          const secs = loc.angles.reduce((a, g) => a + g.beats.reduce((b, x) => b + secondsOf(x.line), 0), 0);
          const lastAngle = loc.angles[loc.angles.length - 1];
          return (
            <li className="fk-cell" key={li}>
              <div className="fk-cut" aria-hidden="true">
                <span />{li === 0 ? <><Ico n="play" size={12} /> {t("FADE IN")}</> : <><Ico n="scissors" size={12} /> {t("CUT TO")}</>}<span />
              </div>
              <article className={`fk-frame${isNoting ? " is-noting" : ""}${busy ? " is-noting" : ""}${fresh === li ? " is-fresh" : ""}${isOpen ? " is-open" : ""}`} aria-busy={isNoting || busy} aria-label={t("Scene {n}: {where}", { n: li + 1, where: loc.where })}>
                <div className="fk-pic">
                  <div className="fk-sheet">
                    <div className="fk-panel">
                      {sketch
                        ? <Sketch key={sketch} url={sketch} alt={t("Storyboard sketch of scene {n}", { n: li + 1 })} fallback={<BlankSheet n={li + 1} glyph={lit ? backdropGlyph(lit.key) : null} drawing={false} t={t} />} />
                        : <BlankSheet n={li + 1} glyph={lit ? backdropGlyph(lit.key) : null} drawing={sketching} t={t} />}
                    </div>
                  </div>
                  {flow.length > 1 && (
                    <div className="fk-tools">
                      {li > 0 && <button type="button" className="fk-tool fk-mv" onClick={() => { settle(); props.onMove(li, -1); }} disabled={held} aria-label={t("Move scene {n} earlier", { n: li + 1 })} title={t("Earlier")}><Up /></button>}
                      {li < flow.length - 1 && <button type="button" className="fk-tool fk-mv" onClick={() => { settle(); props.onMove(li, 1); }} disabled={held} aria-label={t("Move scene {n} later", { n: li + 1 })} title={t("Later")}><Down /></button>}
                      <button type="button" className={`fk-tool fk-rm${armed === li ? " is-arm" : ""}`} onClick={() => removePlace(li)} disabled={held} aria-label={armed === li ? t("Tap again to remove scene {n} and its lines", { n: li + 1 }) : t("Remove scene {n}", { n: li + 1 })}>
                        <Ico n="trash" size={14} />{armed === li && <span>{t("Remove?")}</span>}
                      </button>
                    </div>
                  )}
                  <button type="button" className="fk-strip" onClick={() => toggleSlate(li)} disabled={held} aria-expanded={isOpen} title={t("Change where this scene happens")}>
                    <span className="fk-tag"><i aria-hidden="true" />{t("SC {n}", { n: li + 1 })}</span>
                    <span className="fk-place" dir="auto">{loc.where}</span>
                    <span className="fk-strip-ic" aria-hidden="true"><Ico n={isOpen ? "check" : "pencil"} size={14} /></span>
                  </button>
                </div>

                {isOpen && (
                  <div className="fk-where">
                    {/* (the WHOLE place, on as many lines as it takes: the strip above shows two of them) */}
                    <textarea className="fk-where-in" dir="auto" ref={grow} rows={1} value={whereDraft} maxLength={120} autoFocus aria-label={t("Where does this scene happen?")} placeholder={t("Where does this scene happen?")}
                      onFocus={(e) => { const n = e.currentTarget.value.length; try { e.currentTarget.setSelectionRange(n, n); } catch { /* a nicety */ } }}
                      onChange={(e) => setWhereDraft(e.target.value.replace(/[\r\n]+/g, " "))} onBlur={() => sendWhere(li)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendWhere(li); setOpenPlace(null); } else if (e.key === "Escape") { e.preventDefault(); setOpenPlace(null); } }} />
                    {backdrops.length > 0 && (
                      <div className="fk-bds" role="group" aria-label={t("Backdrop")}>
                        {backdrops.map((bd) => (
                          <button type="button" key={bd.key} className={`fk-bd${backdropIs(loc.where, bd.key) ? " on" : ""}`} aria-pressed={backdropIs(loc.where, bd.key)} onMouseDown={(e) => e.preventDefault()} onClick={() => pickBackdrop(li, bd)}>
                            {svg(18, backdropGlyph(bd.key))}<span>{t(bd.label)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="fk-lines">
                  {loc.angles.map((ang, ai) => (
                    <div className="fk-angle" key={ai}>
                      {ai > 0 && (
                        <div className="fk-cam">
                          <Ico n="video" size={13} />
                          {angleAt === ang.beats[0].idx
                            ? <input className="fk-cam-in" dir="auto" value={angleDraft} maxLength={60} autoFocus aria-label={t("What the close-up is on")} placeholder={t("close-up on …")}
                                onChange={(e) => setAngleDraft(e.target.value)} onBlur={() => sendAngle(ang.beats[0].idx)}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendAngle(ang.beats[0].idx); } else if (e.key === "Escape") { e.preventDefault(); setAngleAt(null); } }} />
                            : <button type="button" className="fk-cam-txt" dir="auto" onClick={() => { setAngleDraft(ang.shot); setAngleAt(ang.beats[0].idx); }} disabled={held} title={t("Change what the close-up is on")}>{ang.shot}</button>}
                          <button type="button" className="fk-cam-x" onClick={() => { settle(); props.onRemoveAngle(ang.beats[0].idx); }} disabled={held} aria-label={t("Remove this angle change")}><Ico n="x" size={12} /></button>
                        </div>
                      )}
                      {ang.beats.map((b, bi) => {
                        const isEdit = editing === b.idx && !held;
                        const text = isEdit ? draft : b.line;
                        const s = secondsOf(text);
                        const state = s > maxSeconds ? "over" : s > maxSeconds * 0.92 ? "warn" : "";
                        const face = faceOf(b.speaker);
                        const name = b.speaker ? displayName(b.speaker) : "";
                        // A SHOT WITH NO LINE IS SEEN, NOT SAID — and the board says so, because that is how it is filmed:
                        // a horror film ends on one (acted-staging.ts), and a line somebody added and never typed is
                        // one too. It is not an empty box asking to be filled in; a tap gives it a line.
                        if (!b.line && !isEdit) {
                          return (
                            <div className="fk-line is-unsaid" key={b.idx} style={{ ["--k" as string]: bi }}>
                              <button type="button" className="fk-unsaid" onClick={() => openLine(b.idx, "")} disabled={held} title={t("Tap to give this shot a line")}><Ico n="eye" size={14} /> {t("Seen, not said")}</button>
                              {total > 1 && <button type="button" className="fk-x" onClick={() => { settle(); props.onRemoveLine(b.idx); }} disabled={held} aria-label={t("Remove this shot")}><Ico n="x" size={13} /></button>}
                            </div>
                          );
                        }
                        const swap = speakers.length > 1 && !held;
                        return (
                          <div className={`fk-line ${sideOf(b.speaker, speakers)}${isEdit ? " is-edit" : ""}${state ? ` ${state}` : ""}`} key={b.idx} style={{ ["--k" as string]: bi }}>
                            <button type="button" className="fk-face" onClick={() => props.onSpeaker(b.idx)} disabled={!swap} style={face ? { backgroundImage: `url(${JSON.stringify(face)})` } : undefined}
                              aria-label={swap ? t("{name} says this — tap for the next speaker", { name: name || "?" }) : name || "?"} title={swap ? t("Tap to switch who speaks") : name}>
                              {!face && <span aria-hidden="true">{(name || "?").slice(0, 1).toUpperCase()}</span>}
                            </button>
                            <div className="fk-say">
                              {name && <button type="button" className="fk-who" onClick={() => props.onSpeaker(b.idx)} disabled={!swap} tabIndex={-1} aria-hidden="true">{name}</button>}
                              {isEdit ? (
                                <textarea ref={box} className="fk-bubble fk-bubble-in" dir="auto" rows={1} value={draft} maxLength={400} placeholder={t("What do they say?")} aria-label={t("What {name} says", { name: name || "?" })}
                                  onChange={(e) => typeLine(b.idx, e.target.value)} onBlur={closeLine} onKeyDown={(e) => lineKeys(e, b.idx)} />
                              ) : (
                                <button type="button" className="fk-bubble" dir="auto" onClick={() => openLine(b.idx, b.line)} disabled={held} title={t("Tap to edit this line")}>
                                  {b.line}
                                </button>
                              )}
                              {isEdit ? (
                                <div className={`fk-meter ${state}`} title={t("How long this line takes to say — one shot holds about {n} seconds.", { n: maxSeconds })}>
                                  <span className="fk-meter-bar"><i style={{ width: `${Math.min(100, (s / Math.max(1, maxSeconds)) * 100)}%` }} /></span>
                                  <span className="fk-meter-num">{s.toFixed(1)}s / {maxSeconds}s</span>
                                </div>
                              ) : state ? (
                                <span className={`fk-long ${state}`} title={t("How long this line takes to say — one shot holds about {n} seconds.", { n: maxSeconds })}>
                                  <i aria-hidden="true" />{state === "over" ? t("{s}s — too long for one shot", { s: Math.round(s) }) : t("{s}s — nearly a full shot", { s: s.toFixed(1) })}
                                </span>
                              ) : null}
                            </div>
                            {total > 1 && <button type="button" className="fk-x" onClick={() => { settle(); props.onRemoveLine(b.idx); }} disabled={held} aria-label={t("Remove this line")}><Ico n="x" size={13} /></button>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* DIRECTING IS ONE TAP */}
                <div className="fk-notes" role="group" aria-label={t("Direct this scene")}>
                  <span className="fk-notes-ic" aria-hidden="true"><Ico n="megaphone" size={15} /></span>
                  {notes.map((n) => (
                    <button type="button" key={n.key} className={`fk-note${isNoting && noteKey === n.key ? " is-on" : ""}`} onClick={() => note(li, n.key)} disabled={held}>{t(n.label)}</button>
                  ))}
                  <button type="button" className={`fk-note fk-note-dice${isNoting && noteKey === NEW_TAKE_KEY ? " is-on" : ""}`} onClick={() => note(li, NEW_TAKE_KEY)} disabled={held}><Dice /> {t("New take")}</button>
                </div>
                <p className="fk-status" role="status" aria-live="polite">{isNoting ? t("Rewriting scene {n}…", { n: li + 1 }) : ""}</p>

                <div className="fk-foot">
                  <button type="button" className="fk-quiet" onClick={() => { settle(); openWhenAdded(lastAngle.lastIdx + 1); props.onAddLine(lastAngle.lastIdx); }} disabled={held}><Plus /> {t("line")}</button>
                  <button type="button" className="fk-quiet" onClick={() => { settle(); openWhenAdded(loc.lastIdx + 1); props.onCloseUp(loc.lastIdx); }} disabled={held}><Ico n="video" size={13} /> {t("close-up")}</button>
                  <span className="fk-foot-len fk-num" title={t("Estimated spoken length of this scene")}>≈ {filmClock(secs)}</span>
                </div>
              </article>
            </li>
          );
        })}
        <li className="fk-cell fk-cell-new">
          <div className="fk-cut" aria-hidden="true"><span /><Ico n="scissors" size={12} /> {t("CUT TO")}<span /></div>
          <button type="button" className="fk-new" onClick={() => { settle(); openWhenAdded(total); props.onAddScene(); }} disabled={held}>
            <span className="fk-new-plus" aria-hidden="true"><Plus size={20} /></span>
            <b>{t("New scene")}</b>
            <small>{t("They go somewhere else")}</small>
          </button>
        </li>
      </ol>
    </section>
  );
}

export default SceneBoard;
