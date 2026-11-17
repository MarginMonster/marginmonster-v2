/* The moving picture in a section's header band.
 *
 * Every section header had a still (/landing/<name>-hero.jpg) while a short clip of the very same
 * picture sat beside it on the disk (/landing/<name>-hero.mp4 — the Dashboard's tiles play it on
 * hover). The owner, 2026-11-17: "Need live hero videos for section headers not stills".
 *
 * The still stays as the poster, so the header is complete before a byte of video arrives and for
 * anyone who asked for less motion (their clip never starts). The clip is muted, inline and looping —
 * the only kind a phone will start by itself. */

import { useEffect, useRef } from "react";

export function HeroVideo({ name, still, clip, className }: {
  /** The asset's base name under /landing: "creator" → creator-hero.jpg / creator-hero.mp4. */
  name: string;
  /** Cache versions of the two files (bump when one is replaced). */
  still: number;
  clip: number;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    v.muted = true;
    const start = () => { v.play().catch(() => undefined); };
    start();
    // a phone pauses background video when the tab is hidden and does not always resume it
    const onShow = () => { if (document.visibilityState === "visible") start(); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [name]);
  return (
    <video ref={ref} key={name} className={className} muted loop playsInline preload="metadata" poster={`/landing/${name}-hero.jpg?v=${still}`} aria-hidden="true" tabIndex={-1}>
      <source src={`/landing/${name}-hero.mp4?v=${clip}`} type="video/mp4" />
    </video>
  );
}
