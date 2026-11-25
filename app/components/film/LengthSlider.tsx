/* THE LENGTH SLIDER — how long the film is, on a strip of film.
 *
 * The owner, 2026-11-25, of the Length step (five buttons: "≈ 10s · 2 shots" … "≈ 30s · 6 shots"): "The how
 * long can be adjusted to a sexy slider allowing up to 5 minutes with estimated final pricing for
 * generations".
 *
 * ONE control. Underneath it is a real <input type="range"> — a keyboard's arrows, Home and End, a screen
 * reader's "1:30, 18 shots, about 450 tokens" — and over it, what a member sees: a strip of film with its
 * sprocket holes, lit in the brand green up to a thumb that is a frame of it. Above, the length, large, and
 * the number of shots; below, one line that moves with it: what it will cost and how long it takes to
 * render. While films are free the line says so BESIDE the estimate, never instead of it — the price is
 * what he asked to see.
 *
 * THE POSITIONS ARE SHOT COUNTS (`stops`, from lib/film-length.ts: every shot up to a minute, coarser
 * after), so the strip is even in STEPS, not in seconds — a drag moves one stop at a time and the short end,
 * where most films are, is not squeezed into the first inch. The tick labels (0:30 · 1:00 · 2:00 · 3:00 ·
 * 5:00) are therefore placed by TIME: each sits where that length falls between the stops either side of it.
 *
 * NOTHING JUMPS: the figures are tabular and their boxes are as wide as the widest value they will show, so
 * the row does not shift as it moves; the thumb is drawn at the native thumb's own centre (22px in from
 * either end — the native thumb is the 44px a finger needs).
 *
 * Knows nothing of the route. The look is film-kit-style.ts (class prefix fk-). */

import { useId } from "react";
import type { CSSProperties } from "react";
import { filmClock } from "../../lib/film-flow";

type T = (source: string, params?: Record<string, string | number>) => string;

export type LengthSliderProps = {
  /** The slider's positions, as shot (or scene) counts, shortest first. */
  stops: number[];
  /** The count picked now (the nearest stop is shown if it is not one of them). */
  value: number;
  onChange: (shots: number) => void;
  /** What a count comes to: seconds of film, tokens, and the render's minutes as [from, to]. */
  secondsOf: (shots: number) => number;
  tokensOf: (shots: number) => number;
  minutesOf: (shots: number) => [number, number];
  /** An acted film counts shots; a told story, scenes. */
  unit: "shots" | "scenes";
  /** Films cost nothing while they are being finished: said beside the estimate. */
  free: boolean;
  /** Greyed and still (while something else is being asked). */
  disabled?: boolean;
  t: T;
};

/** The lengths the strip is labelled at, in seconds. */
export const LENGTH_TICKS = [30, 60, 120, 180, 300] as const;

/** Where a stop sits along the strip, 0…1. */
const fracOf = (i: number, n: number) => (n > 1 ? i / (n - 1) : 0);

/** Where a LENGTH sits along the strip, 0…1: between the two stops it falls between, in proportion — or
 *  null when the strip does not reach it. */
export function tickAt(seconds: number, stopSeconds: ReadonlyArray<number>): number | null {
  const n = stopSeconds.length;
  if (!n || seconds < stopSeconds[0] - 0.5 || seconds > stopSeconds[n - 1] + 0.5) return null;
  for (let i = 0; i < n - 1; i++) {
    const a = stopSeconds[i];
    const b = stopSeconds[i + 1];
    if (seconds >= a && seconds <= b) return fracOf(i + (b > a ? (seconds - a) / (b - a) : 0), n);
  }
  return seconds <= stopSeconds[0] ? 0 : 1;
}

/** The labels that fit: each where its length falls, none closer than `gap` of the strip to the one before
 *  it — and the last (the longest film there is) always kept. */
export function ticksFor(stopSeconds: ReadonlyArray<number>, gap = 0.11): Array<{ seconds: number; at: number }> {
  const all: Array<{ seconds: number; at: number }> = [];
  for (const seconds of LENGTH_TICKS) { const at = tickAt(seconds, stopSeconds); if (at !== null) all.push({ seconds, at }); }
  const out: Array<{ seconds: number; at: number }> = [];
  all.forEach((x, i) => {
    const last = i === all.length - 1;
    while (last && out.length && x.at - out[out.length - 1].at < gap) out.pop();
    if (last || !out.length || x.at - out[out.length - 1].at >= gap) out.push(x);
  });
  return out;
}

/** Minutes as people say them: "45 min", "1 h 5 min", "2 h". Past an hour nobody means the minute: it is
 *  said to the nearest five ("3 h 5 min", not "3 h 3 min"). */
function span(mins: number, t: T): string {
  const raw = Math.max(1, Math.round(mins));
  const m = raw < 60 ? raw : Math.round(raw / 5) * 5;
  if (m < 60) return t("{n} min", { n: m });
  const h = Math.floor(m / 60);
  return m % 60 ? t("{h} h {m} min", { h, m: m % 60 }) : t("{h} h", { h });
}

export function LengthSlider({ stops, value, onChange, secondsOf, tokensOf, minutesOf, unit, free, disabled, t }: LengthSliderProps) {
  const id = useId();
  const list = stops.length ? stops : [value];
  // the stop the picked count is (or is nearest to)
  let at = 0;
  list.forEach((s, i) => { if (Math.abs(s - value) < Math.abs(list[at] - value)) at = i; });
  const shots = list[at];
  const secs = secondsOf(shots);
  const tokens = Math.max(0, Math.round(tokensOf(shots)));
  const [lo, hi] = minutesOf(shots);
  const count = unit === "scenes"
    ? (shots === 1 ? t("1 scene") : t("{n} scenes", { n: shots }))
    : (shots === 1 ? t("1 shot") : t("{n} shots", { n: shots }));
  const cost = t("≈ {n} tokens", { n: tokens.toLocaleString("en-US") });
  const takes = Math.round(lo) >= Math.round(hi)
    ? t("renders in about {a}", { a: span(hi, t) })
    : hi < 60
      ? t("renders in about {a}–{b} min", { a: Math.max(1, Math.round(lo)), b: Math.round(hi) })
      : t("renders in about {a} – {b}", { a: span(lo, t), b: span(hi, t) });
  const stopSeconds = list.map((s) => secondsOf(s));
  const ticks = ticksFor(stopSeconds);
  // the widest things the two figures will ever show, so their boxes never change size
  const longest = list[list.length - 1];
  const widestClock = filmClock(stopSeconds[stopSeconds.length - 1] || 0).length;
  const widestCount = (unit === "scenes" ? t("{n} scenes", { n: longest }) : t("{n} shots", { n: longest })).length;
  const style = { ["--p" as string]: fracOf(at, list.length), ["--clock" as string]: `${widestClock}ch`, ["--count" as string]: `${widestCount + 1}ch` } as CSSProperties;

  return (
    <div className={`fk fk-len${disabled ? " is-off" : ""}`} style={style}>
      <div className="fk-len-read">
        <output className="fk-len-time fk-num" htmlFor={id}>{filmClock(secs)}</output>
        <span className="fk-len-count fk-num">{count}</span>
      </div>
      <div className="fk-len-strip">
        <span className="fk-len-film" aria-hidden="true"><i className="fk-len-lit" /></span>
        <input
          id={id} className="fk-len-in" type="range" min={0} max={list.length - 1} step={1} value={at} disabled={disabled}
          aria-label={t("How long?")}
          aria-valuetext={`${filmClock(secs)} · ${count} · ${cost}`}
          onChange={(e) => { const i = Math.max(0, Math.min(list.length - 1, Number(e.target.value) || 0)); if (list[i] !== value) onChange(list[i]); }}
        />
        <span className="fk-len-thumb" aria-hidden="true"><i /></span>
      </div>
      <div className="fk-len-ticks" aria-hidden="true">
        {ticks.map((k) => <span key={k.seconds} className="fk-num" style={{ ["--at" as string]: k.at } as CSSProperties}>{filmClock(k.seconds)}</span>)}
      </div>
      {/* (not a live region: the slider's own value text already says the length, the count and the cost) */}
      <p className="fk-len-est">
        <span className="fk-len-cost fk-num">{cost}</span>
        <span className="fk-len-dot" aria-hidden="true">·</span>
        <span className="fk-len-takes fk-num">{takes}</span>
        {free && <span className="fk-len-free">{t("free while we finish films")}</span>}
      </p>
    </div>
  );
}

export default LengthSlider;
