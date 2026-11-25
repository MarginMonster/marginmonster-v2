/* STARTER NUDGES — the writer is never handed nothing.
 *
 * The owner, 2026-11-25: "the \"write your dialogue\" button generates a random scene and dialogue, atleast
 * need a starter \"nudge\" couple sentences to hand to the writer". The idea box said "…or leave blank and
 * we'll surprise you", and a blank box got exactly that: a film about nothing the member had in mind.
 *
 * So under the idea box: "Need a nudge?" and three starters for the genre they are in (lib/film-genres.ts
 * deals them). Each is shown WHOLE — a sentence or two is the point; a starter cut off with "…" is a
 * starter nobody can judge. A tap puts it IN the box (the page's box; this only says which), where it is
 * theirs to change. "More ideas" deals three others, and they are dealt: one after another, like cards.
 *
 * `nudgeHint` is the line for a press of "write" on an empty box. The page can also pass `urge` to show it
 * here, above the cards, with the cards stirring once — the answer to an empty box is right under it.
 *
 * Knows nothing of the route. The look is film-kit-style.ts (class prefix fk-). */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Ico } from "../../lib/icons";

type T = (source: string, params?: Record<string, string | number>) => string;

/** What an empty idea box is told when "write" is pressed. (An English source string: say it with t().) */
export const nudgeHint = "Give the writer a sentence or two — or tap a starter";

export type StarterNudgesProps = {
  /** The starters on the table (the first three are shown). */
  starters: string[];
  /** A starter was tapped: put this text in the idea box. */
  onPick: (text: string) => void;
  /** "More ideas": deal three others. */
  onMore: () => void;
  /** Say `nudgeHint` above the cards (the member pressed "write" on an empty box). */
  urge?: boolean;
  disabled?: boolean;
  t: T;
};

export function StarterNudges({ starters, onPick, onMore, urge, disabled, t }: StarterNudgesProps) {
  const shown = starters.slice(0, 3);
  // which card was just taken (it says so for a moment), and how many times the cards were dealt
  const [taken, setTaken] = useState<string | null>(null);
  const [deal, setDeal] = useState(0);
  const first = useRef(true);
  const key = shown.join(" | ");
  useEffect(() => {
    // (the cards a member arrives to are simply there; only the ones they ASK for are dealt)
    if (first.current) { first.current = false; return; }
    setDeal((d) => d + 1);
    setTaken(null);
  }, [key]);
  useEffect(() => {
    if (!taken) return;
    const id = setTimeout(() => setTaken(null), 1400);
    return () => clearTimeout(id);
  }, [taken]);
  if (!shown.length) return null;
  return (
    <div className={`fk fk-nudge${urge ? " is-urge" : ""}`}>
      <div className="fk-nudge-head">
        <span className="fk-nudge-q"><Ico n="bulb" size={14} /> {t("Need a nudge?")}</span>
        <button type="button" className="fk-nudge-more" onClick={onMore} disabled={disabled}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "0 0 auto" }}>
            <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="3.6" /><circle cx="8.6" cy="8.6" r=".9" fill="currentColor" /><circle cx="15.4" cy="15.4" r=".9" fill="currentColor" /><circle cx="12" cy="12" r=".9" fill="currentColor" />
          </svg> {t("More ideas")}
        </button>
      </div>
      {urge && <p className="fk-nudge-hint" role="status">{t(nudgeHint)}</p>}
      <ul className={`fk-nudge-list${deal ? " is-dealt" : ""}`} key={deal}>
        {shown.map((s, i) => {
          const text = t(s);
          const on = taken === s;
          return (
            <li key={s} style={{ ["--i" as string]: i } as CSSProperties}>
              <button type="button" className={`fk-nudge-card${on ? " is-on" : ""}`} onClick={() => { setTaken(s); onPick(text); }} disabled={disabled}>
                <span className="fk-nudge-txt" dir="auto">{text}</span>
                <span className="fk-nudge-use">{on ? <><Ico n="check" size={13} /> {t("In your box — make it yours")}</> : <><Ico n="pencil" size={12} /> {t("Use this")}</>}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default StarterNudges;
