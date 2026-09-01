/* One icon set for the whole web surface.
 *
 * The app was drawn in emoji — 65 of them across /web/*. Emoji render as a
 * different picture on every OS and browser (Apple's 🎬 is a clapperboard,
 * Google's is a film strip, Windows' is flat orange), they sit on a different
 * baseline than the text beside them, they cannot take the brand colour, and
 * next to a competitor's drawn set they read as a hobby project. This is the
 * same 24-grid, single stroke weight, currentColor set the landing page uses.
 *
 * Usage: <Ico n="coin" /> or <Ico n="video" size={18} />
 */

type Paths = JSX.Element;

const I: Record<string, Paths> = {
  /* ── wallet + content kinds ─────────────────────────────────────── */
  coin: <><circle cx="12" cy="12" r="8.4" /><path d="M12 7.6v8.8M9.7 9.9h3.5a1.9 1.9 0 0 1 0 3.8h-3.5" /></>,
  video: <><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="m10 9.5 5 2.5-5 2.5z" /></>,
  image: <><rect x="3" y="4.5" width="18" height="15" rx="2.6" /><circle cx="8.4" cy="9.6" r="1.5" /><path d="m4 16.5 4.6-4.2 3.3 3 3-2.4 5.1 4.2" /></>,
  article: <><path d="M5.5 3.5h9L19 8v12.5H5.5z" /><path d="M14 3.6V8.2h4.6" /><path d="M8.6 12.4h6.8M8.6 16h4.6" /></>,

  /* ── actions + status ───────────────────────────────────────────── */
  trash: <><path d="M4.5 6.5h15M9.5 6.5V4.6h5v1.9" /><path d="M6.6 6.5 7.5 20h9l.9-13.5" /><path d="M10.3 10v6.4M13.7 10v6.4" /></>,
  link: <><path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.9-2.9a3.6 3.6 0 0 0-5.1-5.1l-1.3 1.3" /><path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.9 2.9a3.6 3.6 0 0 0 5.1 5.1l1.3-1.3" /></>,
  bolt: <><path d="M13.2 2.6 4.8 13.4h6L10.6 21.4 19 10.6h-6z" /></>,
  sliders: <><path d="M4 7.5h10M18 7.5h2M4 16.5h4M12 16.5h8" /><circle cx="16" cy="7.5" r="2.1" /><circle cx="10" cy="16.5" r="2.1" /></>,
  warning: <><path d="M12 3.6 21.2 20H2.8z" /><path d="M12 9.6v4.6M12 17.1v.1" /></>,
  lock: <><rect x="4.6" y="10.2" width="14.8" height="10.2" rx="2.4" /><path d="M8.2 10.2V7.6a3.8 3.8 0 0 1 7.6 0v2.6" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12.2 2.7 2.7L16 9.6" /></>,
  trend: <><path d="M3.5 16.6 9 11l3.6 3.6L20.5 6.8" /><path d="M15.4 6.8h5.1v5.1" /></>,
  rocket: <><path d="M12 3.2c3.4 2.3 5.2 5.6 5.2 9.3l-2.6 3.1H9.4l-2.6-3.1c0-3.7 1.8-7 5.2-9.3z" /><circle cx="12" cy="10" r="1.8" /><path d="M9.4 15.6 7 20l3.4-1.1M14.6 15.6 17 20l-3.4-1.1" /></>,
  star: <><path d="m12 3.6 2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 10l6-.8z" /></>,
  play: <><circle cx="12" cy="12" r="9" /><path d="m10 8.6 6 3.4-6 3.4z" /></>,
  sound: <><path d="M4.5 9.4h3.2L12 5.8v12.4l-4.3-3.6H4.5z" /><path d="M15.4 9.4a3.7 3.7 0 0 1 0 5.2M17.9 7a7.2 7.2 0 0 1 0 10" /></>,
  music: <><path d="M9 17.4V6.2l9-1.8v11.2" /><circle cx="6.8" cy="17.6" r="2.4" /><circle cx="15.8" cy="15.6" r="2.4" /></>,
  camera: <><rect x="2.8" y="6.8" width="18.4" height="13" rx="2.6" /><path d="M8.6 6.8 10 4.4h4l1.4 2.4" /><circle cx="12" cy="13.3" r="3.5" /></>,
  palette: <><path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.3 0 1.8-.9 1.4-1.9-.5-1.2.3-2.3 1.6-2.3h1.4a4.2 4.2 0 0 0 4.2-4.6A8.7 8.7 0 0 0 12 3.4z" /><circle cx="8" cy="10.4" r="1.1" /><circle cx="12" cy="7.9" r="1.1" /><circle cx="15.9" cy="10.2" r="1.1" /></>,
  box: <><path d="m12 3.2 8.4 4.2v9.2L12 20.8 3.6 16.6V7.4z" /><path d="M3.6 7.4 12 11.6l8.4-4.2M12 11.6v9.2" /></>,
  shirt: <><path d="M8.6 3.6 4.2 6l1.6 4 2-.6v11h8.4v-11l2 .6 1.6-4-4.4-2.4a3.4 3.4 0 0 1-6.8 0z" /></>,
  wave: <><path d="M2.8 9.4c1.6-1.8 3.2-1.8 4.8 0s3.2 1.8 4.8 0 3.2-1.8 4.8 0 3.2 1.8 4.8 0" /><path d="M2.8 15.4c1.6-1.8 3.2-1.8 4.8 0s3.2 1.8 4.8 0 3.2-1.8 4.8 0 3.2 1.8 4.8 0" /></>,
  burst: <><path d="m12 2.6 2.3 4.1 4.6-1.2-1.2 4.6 4.1 2.3-4.1 2.3 1.2 4.6-4.6-1.2L12 21.4l-2.3-4.1-4.6 1.2 1.2-4.6L2.2 12.4l4.1-2.3-1.2-4.6 4.6 1.2z" /></>,
  film: <><rect x="2.5" y="4.6" width="19" height="14.8" rx="2.4" /><path d="M7.6 4.6v14.8M16.4 4.6v14.8M2.5 12h19" /></>,

  /* ── cartoon styles ─────────────────────────────────────────────── */
  leaf: <><path d="M20 4.4C10.6 4 4.6 8.2 4.6 14.4a5 5 0 0 0 5 5c6 0 10.2-6 10.4-15z" /><path d="M17.4 7.2C12.6 9.2 9 13 7.4 18" /></>,
  figure: <><circle cx="12" cy="5.6" r="2.4" /><path d="M12 8.4v7M12 15.4 8.8 21M12 15.4 15.2 21M7.8 11h8.4" /></>,
  paper: <><path d="M4.4 8.2 12 4.2l7.6 4-7.6 4z" /><path d="m4.4 13 7.6 4 7.6-4" /><path d="m4.4 17.4 7.6 4 7.6-4" /></>,
  sphere: <><circle cx="12" cy="12" r="8.6" /><path d="M12 3.4c-3 2.4-3 14.2 0 17.2" /><path d="M8.4 7.6a3 3 0 0 0 1.6 1.4" /></>,
  cassette: <><rect x="2.6" y="6" width="18.8" height="12" rx="2.2" /><circle cx="8.6" cy="12" r="2.2" /><circle cx="15.4" cy="12" r="2.2" /><path d="M8.6 14.2h6.8" /></>,
  tent: <><path d="M3 20.4 12 4l9 16.4z" /><path d="M12 4v16.4M7.4 20.4c1.6-4 2.8-8 4.6-11.4M16.6 20.4c-1.6-4-2.8-8-4.6-11.4" /></>,
  felt: <><rect x="4" y="4.6" width="16" height="14.8" rx="4.4" /><path d="M7.4 8.4h.1M16.6 8.4h.1M7.4 15.6h.1M16.6 15.6h.1M9.4 12.4a3.4 3.4 0 0 0 5.2 0" /></>,
  clay: <><path d="M6 20.2c-2.4-2-2.8-6 .2-8.6C8.6 9.4 8 6.4 10.6 4.6c2.6-1.8 6 .2 6.6 3.2.6 3.2 3.2 3.8 2.6 7-.6 3-3.6 5.4-6.8 5.4z" /><path d="M10 12.6a4 4 0 0 1 4.4 2.4" /></>,

  /* ── blog angles ────────────────────────────────────────────────── */
  clipboard: <><rect x="5" y="4.6" width="14" height="15.8" rx="2.2" /><path d="M9.2 4.6a2.8 2.8 0 0 1 5.6 0" /><path d="M8.8 11.4h6.4M8.8 15h4.2" /></>,
  wrench: <><path d="M15.6 3.6a5.2 5.2 0 0 0-5 8.2L4.2 18.2a2 2 0 0 0 2.8 2.8l6.4-6.4a5.2 5.2 0 0 0 6.4-7.2l-2.8 2.8-2.6-.6-.6-2.6z" /></>,
  question: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.6 2.6 0 0 1 4.9 1.1c0 1.7-2.5 2-2.5 3.6" /><path d="M12 17.4v.1" /></>,
  book: <><path d="M4.4 4.6h5.2A2.6 2.6 0 0 1 12 7v13a2.2 2.2 0 0 0-2.2-2.2H4.4z" /><path d="M19.6 4.6h-5.2A2.6 2.6 0 0 0 12 7v13a2.2 2.2 0 0 1 2.2-2.2h5.4z" /></>,
  gift: <><rect x="3.4" y="9" width="17.2" height="4" rx="1.2" /><path d="M4.8 13v7.4h14.4V13M12 9v11.4" /><path d="M12 9C10.6 5.6 8.8 4 7.4 4.6 5.8 5.2 6.2 8 9 9M12 9c1.4-3.4 3.2-5 4.6-4.4 1.6.6 1.2 3.4-1.6 4.4" /></>,
};

export type IcoName = keyof typeof I;

export function Ico({ n, size = 16, className, style }: { n: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const g = I[n];
  if (!g) return null;
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      className={className}
      style={{ flex: "0 0 auto", verticalAlign: "-0.15em", ...style }}
    >
      {g}
    </svg>
  );
}

export const hasIco = (n: string) => Object.prototype.hasOwnProperty.call(I, n);
