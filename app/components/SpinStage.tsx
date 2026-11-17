/* A presenter you can turn around — the "examine your character" stage in the Presenters section.
 *
 * It plays a kit's rotation (N transparent frames of one full turn, see app/lib/presenter-kits.ts) on a
 * canvas: drag sideways and the presenter turns with your finger, let go and they coast to a stop.
 * On open they do one slow turn by themselves, so nobody has to be told it moves.
 *
 * Frames load coarse-to-fine — the first one, then every 16th, 8th, 4th… — so the figure appears at
 * once and can already be turned while the rest arrive; a frame that isn't in yet is drawn as its
 * nearest neighbour that is. */

import { useEffect, useRef, useState } from "react";
import { spinFrame, type Spin } from "../lib/presenter-kits";
import { nearestLoaded, spinLoadOrder } from "../lib/spin-frames";

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function SpinStage({ spin, name, label, hint, loadingLabel }: {
  spin: Spin;
  name: string;
  /** Accessible name of the control, e.g. "Turn Mei around". */
  label: string;
  /** The little prompt shown until the first touch, e.g. "Drag to turn". */
  hint: string;
  loadingLabel: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [count, setCount] = useState(0);
  const [touched, setTouched] = useState(false);
  const [painted, setPainted] = useState(false);
  const [angle, setAngle] = useState(0);
  const s = useRef({
    imgs: [] as (HTMLImageElement | null)[],
    pos: 0, vel: 0, drawn: -1, dragging: false, lastX: 0, lastT: 0,
    intro: null as null | { start: number; dur: number }, introDone: false, angle: 0, shown: 0,
  });

  useEffect(() => {
    const st = s.current;
    st.imgs = new Array(spin.n).fill(null);
    st.pos = 0; st.vel = 0; st.drawn = -1; st.dragging = false; st.intro = null; st.introDone = false; st.angle = 0; st.shown = 0;
    setCount(0); setTouched(false); setPainted(false); setAngle(0);
    let alive = true;
    let done = 0;
    const order = spinLoadOrder(spin.n);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // a few at a time, in order — so the coarse frames really do land before the fine ones
    let next = 0;
    const pump = () => {
      if (!alive || next >= order.length) return;
      const i = order[next++];
      const img = new Image();
      img.decoding = "async";
      const settle = (ok: boolean) => {
        if (!alive) return;
        if (ok) st.imgs[i] = img;
        done++;
        setCount(done);
        // one unprompted turn, as soon as there are enough frames for it to read as a turn
        if (!st.introDone && !st.intro && !reduce && done >= Math.min(spin.n, Math.ceil(spin.n / 4) + 1)) {
          st.intro = { start: performance.now() + 250, dur: 5200 };
        }
        pump();
      };
      img.onload = () => settle(true);
      img.onerror = () => settle(false);
      img.src = spinFrame(spin, i);
    };
    for (let k = 0; k < 6; k++) pump();

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (st.intro && !st.dragging) {
        const x = (now - st.intro.start) / st.intro.dur;
        if (x >= 1) { st.pos = 0; st.intro = null; st.introDone = true; }
        else if (x > 0) st.pos = spin.dir * spin.n * ease(x);
      } else if (!st.dragging && Math.abs(st.vel) > 0.0004) {
        st.pos += st.vel * dt;
        st.vel *= Math.pow(0.94, dt / 16);
      }
      const idx = nearestLoaded(st.pos, st.imgs, spin.n);
      const cv = canvasRef.current;
      if (cv && idx >= 0 && idx !== st.drawn) {
        const ctx = cv.getContext("2d");
        const img = st.imgs[idx];
        if (ctx && img) {
          ctx.clearRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          st.drawn = idx;
          setPainted(true);
          st.angle = Math.round((idx / spin.n) * 360);
        }
      }
      // tell assistive tech where the turn came to rest — not sixty times a second on the way there
      if (!st.dragging && !st.intro && Math.abs(st.vel) <= 0.0004 && st.angle !== st.shown) { st.shown = st.angle; setAngle(st.angle); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [spin.base, spin.q, spin.n, spin.dir]); // eslint-disable-line react-hooks/exhaustive-deps

  const grab = () => {
    const st = s.current;
    if (st.intro) { st.intro = null; }
    st.introDone = true;
    setTouched(true);
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const st = s.current;
    grab();
    st.dragging = true; st.vel = 0; st.lastX = e.clientX; st.lastT = performance.now();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable — the drag still works inside the stage */ }
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = s.current;
    if (!st.dragging) return;
    const now = performance.now();
    const dx = e.clientX - st.lastX;
    const width = wrapRef.current?.clientWidth || 320;
    // one stage-width of drag ≈ four fifths of a turn
    const d = dx * (spin.n / (width * 1.25)) * spin.dir;
    st.pos += d;
    const dt = Math.max(1, now - st.lastT);
    st.vel = st.vel * 0.4 + (d / dt) * 0.6;
    st.lastX = e.clientX; st.lastT = now;
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = s.current;
    if (!st.dragging) return;
    st.dragging = false;
    if (performance.now() - st.lastT > 90) st.vel = 0; // they stopped before letting go — no coasting
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    grab();
    const st = s.current;
    st.vel = 0;
    st.pos += (e.key === "ArrowRight" ? 1 : -1) * spin.dir * Math.max(1, Math.round(spin.n / 24));
  };

  const loading = count < spin.n;
  return (
    <div
      ref={wrapRef}
      className={`spin${touched ? " touched" : ""}`}
      role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={359} aria-valuenow={angle} aria-valuetext={`${angle}°`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
    >
      <span className="spin-floor" aria-hidden="true" />
      <span className="spin-fig" style={{ aspectRatio: `${spin.w} / ${spin.h}` }}>
        {/* the first frame as a plain image: there before any script runs, and under the canvas until it paints */}
        {!painted && <img className="spin-poster" src={spinFrame(spin, 0)} alt={name} draggable={false} />}
        <canvas ref={canvasRef} width={spin.w} height={spin.h} className="spin-cv" />
      </span>
      <span className={`spin-tip${loading ? " busy" : ""}`} aria-hidden="true">
        {loading ? (
          <><i className="spin-tip-bar"><i style={{ width: `${Math.round((count / spin.n) * 100)}%` }} /></i>{loadingLabel}</>
        ) : (
          <><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 3.5 0 0 0 18 0a9 3.5 0 0 0-18 0" /><path d="M8 9.5l-3 2.5 3 2.5" /><path d="M16 9.5l3 2.5-3 2.5" /></svg>{hint}</>
        )}
      </span>
    </div>
  );
}

export const SPIN_STAGE_CSS = `
.spin{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none;outline:none;border-radius:inherit}
.spin:active{cursor:grabbing}
.spin:focus-visible{box-shadow:inset 0 0 0 3px var(--green2,#1FA463)}
.spin-fig{position:relative;z-index:1;display:block;height:86%;margin-bottom:7%;pointer-events:none}
.spin-cv,.spin-poster{position:absolute;inset:0;width:100%;height:100%;display:block}
.spin-poster{object-fit:contain}
.spin-floor{position:absolute;z-index:0;left:50%;bottom:4.2%;width:58%;aspect-ratio:5/1;transform:translateX(-50%);border-radius:50%;background:radial-gradient(closest-side,rgba(20,32,26,.30),rgba(20,32,26,.12) 55%,rgba(20,32,26,0) 100%);pointer-events:none}
.spin-tip{position:absolute;z-index:2;left:50%;bottom:10px;transform:translateX(-50%);display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:rgba(20,32,26,.62);color:#fff;font-size:11.5px;font-weight:700;white-space:nowrap;pointer-events:none;transition:opacity .35s;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
.spin.touched .spin-tip:not(.busy){opacity:0}
.spin-tip-bar{display:block;width:46px;height:4px;border-radius:2px;background:rgba(255,255,255,.28);overflow:hidden}
.spin-tip-bar i{display:block;height:100%;background:#fff;border-radius:2px;transition:width .2s}
`;
