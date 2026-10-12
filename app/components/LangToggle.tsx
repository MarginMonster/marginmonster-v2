/* Language toggle — a compact pill (globe + 2-letter code + caret) that opens a
 * dropdown of native language names. Modeled on the clean store-header language
 * switchers (e.g. Magic Monster's), themed to the EASYMODE green-on-cream look.
 *
 * Presentational: the parent owns the value and decides what picking a language
 * means — on the landing it switches the marketing copy (client state); in the
 * app shell it sets the UI display language; by the Make button it sets the
 * content/output language.
 *
 * The open menu is rendered in a PORTAL to <body> with FIXED positioning, so it
 * can never be clipped by an ancestor's overflow:hidden (the Studio card) or
 * painted under a later sibling (the HUD pill). It auto-flips above the pill
 * when there isn't room below, and re-anchors on scroll/resize. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type LangToggleProps = {
  /** Current language code, e.g. "en". */
  value: string;
  /** code → native display name, e.g. { en: "English", es: "Español" }. */
  labels: Record<string, string>;
  onPick: (code: string) => void;
  /** Which edge the menu aligns to (default right). */
  align?: "left" | "right";
  /** Tooltip / accessible description of what the toggle controls. */
  title?: string;
};

const CSS = `
.lt{position:relative;display:inline-block;font-family:inherit;}
.lt-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:999px;
  border:1.5px solid var(--line,#E6E0CC);background:var(--card,#fff);color:var(--ink,#14201A);
  font:inherit;font-weight:800;font-size:12.5px;line-height:1;cursor:pointer;letter-spacing:.02em;
  transition:border-color .14s,box-shadow .14s;}
.lt-btn:hover,.lt-btn[aria-expanded="true"]{border-color:#0C7A46;box-shadow:0 2px 8px rgba(12,122,70,.12);}
.lt-btn svg{flex:0 0 auto;}
.lt-glyph{color:#0C7A46;}
.lt-caret{color:var(--ink2,#4A554E);transition:transform .14s;}
.lt-btn[aria-expanded="true"] .lt-caret{transform:rotate(180deg);}
/* Portalled, fixed-position menu — inline top/left/right set per open. */
.lt-menu{position:fixed;z-index:10050;margin:0;padding:5px;min-width:168px;
  list-style:none;background:var(--card,#fff);border:1px solid var(--line,#E6E0CC);border-radius:13px;
  box-shadow:0 14px 34px rgba(20,32,26,.18);animation:ltIn .13s ease both;}
@keyframes ltIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.lt-menu.up{animation:ltInUp .13s ease both;}
@keyframes ltInUp{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.lt-opt{display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border:0;background:none;
  border-radius:9px;font:inherit;font-size:14px;line-height:1.1;color:var(--ink,#14201A);cursor:pointer;
  text-align:left;white-space:nowrap;}
.lt-opt:hover,.lt-opt:focus-visible{background:#F0FAF4;outline:none;}
.lt-opt.on{font-weight:700;}
.lt-code{flex:0 0 auto;width:22px;font-weight:800;font-size:10px;color:#0C7A46;letter-spacing:.02em;}
.lt-nm{flex:1 1 auto;}
.lt-opt.on .lt-nm{color:#0C7A46;}
.lt-check{flex:0 0 auto;margin-left:6px;color:#0C7A46;}
@media (prefers-reduced-motion:reduce){.lt-menu{animation:none}.lt-caret{transition:none}}
`;

type MenuPos = { left?: number; right?: number; top?: number; bottom?: number; up: boolean };

export function LangToggle({ value, labels, onPick, align = "right", title }: LangToggleProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos>({ up: false });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const codes = Object.keys(labels);
  const current = labels[value] ? value : codes[0];

  // Anchor the fixed menu to the button, flipping above when there's no room
  // below. Called on open and whenever the page scrolls or resizes while open.
  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estH = Math.min(codes.length * 40 + 12, vh - 24);
    const below = vh - b.bottom;
    const up = below < estH + 12 && b.top > below;
    const next: MenuPos = { up };
    if (up) next.bottom = Math.round(vh - b.top + 6);
    else next.top = Math.round(b.bottom + 6);
    // Horizontal: anchor to the chosen edge, then CLAMP so the whole menu stays
    // on-screen. A right-aligned pill near the LEFT viewport edge (the app
    // shell's language pill on mobile) would otherwise push the fixed-width menu
    // off the left side and clip every label. Positioning by `left` with a
    // measured width lets us keep both edges inside the viewport.
    const mw = Math.min(menuRef.current?.getBoundingClientRect().width || 168, vw - 16);
    const anchored = align === "right" ? b.right - mw : b.left;
    next.left = Math.round(Math.max(8, Math.min(anchored, vw - mw - 8)));
    setPos(next);
  };

  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const reflow = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const menu = open && typeof document !== "undefined"
    ? createPortal(
        <ul
          ref={menuRef}
          className={`lt-menu${pos.up ? " up" : ""}`}
          role="listbox"
          aria-label={title || "Language"}
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right }}
        >
          {codes.map((c) => (
            <li key={c} role="option" aria-selected={c === current}>
              <button type="button" className={`lt-opt${c === current ? " on" : ""}`} onClick={() => { onPick(c); setOpen(false); }}>
                <span className="lt-code">{c.toUpperCase()}</span>
                <span className="lt-nm">{labels[c]}</span>
                {c === current && (
                  <svg className="lt-check" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )
    : null;

  return (
    <div className="lt" ref={wrapRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <button
        ref={btnRef}
        type="button" className="lt-btn" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)} title={title || "Language"}
      >
        <svg className="lt-glyph" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M3.2 9.4h17.6M3.2 14.6h17.6" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
        </svg>
        <span>{current.toUpperCase()}</span>
        <svg className="lt-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {menu}
    </div>
  );
}
