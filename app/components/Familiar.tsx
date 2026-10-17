/* Helpurr, the pixel familiar — an idly-animated cat sprite (bob + occasional
 * blink / paw-lick) that bursts sparkles when tapped. Shared by the Helpurr
 * widget (web.tsx) and the dashboard hero (web._index.tsx) so both show the SAME
 * animated character instead of a static PNG. The .mm-fam* CSS lives in the
 * web.tsx layout <style>, which wraps every /web page, so no styles move here. */

import { useEffect, useRef } from "react";

const FAM = { open: "/familiar-px.png", blink: "/familiar-px-blink.png?v=2", pawup: "/familiar-px-pawup.png", lick: "/familiar-px-lick.png" };

function famBurst(el: HTMLElement) {
  const img = el.querySelector("img.mm-fam-img") as HTMLImageElement | null;
  if (img) img.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.4)" }, { filter: "brightness(1)" }], { duration: 400, easing: "ease-out" });
  const R = el.getBoundingClientRect();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, sp = document.createElement("span");
    sp.className = "mm-fam-spark";
    sp.style.left = R.width / 2 + "px"; sp.style.top = R.height * 0.45 + "px";
    el.appendChild(sp);
    const d = R.width * 0.52;
    sp.animate([{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d - 2}px, ${Math.sin(a) * d - 2}px) scale(.3)`, opacity: 0 }], { duration: 520 + Math.random() * 200, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => sp.remove();
  }
}

export function Familiar({ think }: { think?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const img = el.querySelector("img.mm-fam-img") as HTMLImageElement | null;
    if (!img) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    [FAM.blink, FAM.pawup, FAM.lick].forEach((s) => { const im = new Image(); im.src = s; }); // preload frames
    const ph = Math.random() * 6.28;
    let raf = 0;
    const t0 = performance.now();
    let nextAction = 2000 + Math.random() * 3000;
    let steps: { src: string; dur: number }[] | null = null, idx = 0, stepStart = 0;
    const frame = (now: number) => {
      const t = now - t0;
      const bob = Math.sin(t / 640 + ph) * 2.3, br = 1 + Math.sin(t / 1250 + ph) * 0.02;
      img.style.transform = `translateY(${bob.toFixed(2)}px) scale(${br.toFixed(3)})`;
      if (steps) {
        if (now - stepStart >= steps[idx].dur) {
          idx++;
          if (idx >= steps.length) { steps = null; img.src = FAM.open; nextAction = t + 2600 + Math.random() * 4000; }
          else { stepStart = now; img.src = steps[idx].src; }
        }
      } else if (t >= nextAction) {
        steps = Math.random() < 0.65
          ? [{ src: FAM.blink, dur: 150 }]
          : [{ src: FAM.pawup, dur: 200 }, { src: FAM.lick, dur: 260 }, { src: FAM.pawup, dur: 150 }, { src: FAM.lick, dur: 260 }, { src: FAM.pawup, dur: 170 }];
        idx = 0; stepStart = now; img.src = steps[0].src;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className={`mm-fam${think ? " think" : ""}`} ref={ref} onClick={() => { if (ref.current) famBurst(ref.current); }}>
      <img className="mm-fam-img" src={FAM.open} alt="" draggable={false} />
    </span>
  );
}
