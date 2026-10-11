/* Language toggle — a compact pill (globe + 2-letter code + caret) that opens a
 * dropdown of native language names. Modeled on the clean store-header language
 * switchers (e.g. Magic Monster's), themed to the EASYMODE green-on-cream look.
 *
 * Presentational: the parent owns the value and decides what picking a language
 * means — on the landing it switches the marketing copy (client state); in the
 * app shell it sets the shop's content-generation language (a fetcher POST). */
import { useEffect, useRef, useState } from "react";

export type LangToggleProps = {
  /** Current language code, e.g. "en". */
  value: string;
  /** code → native display name, e.g. { en: "English", es: "Español" }. */
  labels: Record<string, string>;
  onPick: (code: string) => void;
  /** Where the menu opens from (default right-aligned under the pill). */
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
.lt-menu{position:absolute;top:calc(100% + 6px);z-index:400;margin:0;padding:4px;
  list-style:none;background:var(--card,#fff);border:1px solid var(--line,#E6E0CC);border-radius:12px;
  box-shadow:0 8px 20px rgba(20,32,26,.13);animation:ltIn .13s ease both;}
.lt-menu.right{right:0;}.lt-menu.left{left:0;}
@keyframes ltIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.lt-opt{display:flex;align-items:center;gap:8px;width:100%;padding:6px 9px;border:0;background:none;
  border-radius:8px;font:inherit;font-size:13px;line-height:1.1;color:var(--ink,#14201A);cursor:pointer;
  text-align:left;white-space:nowrap;}
.lt-opt:hover{background:#F0FAF4;}
.lt-opt.on{font-weight:700;}
.lt-code{flex:0 0 auto;width:20px;font-weight:800;font-size:10px;color:#0C7A46;letter-spacing:.02em;}
.lt-nm{flex:0 0 auto;}
.lt-opt.on .lt-nm{color:#0C7A46;}
.lt-check{flex:0 0 auto;margin-left:5px;color:#0C7A46;}
@media (prefers-reduced-motion:reduce){.lt-menu{animation:none}.lt-caret{transition:none}}
`;

export function LangToggle({ value, labels, onPick, align = "right", title }: LangToggleProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const codes = Object.keys(labels);
  const current = labels[value] ? value : codes[0];

  return (
    <div className="lt" ref={ref}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <button
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
      {open && (
        <ul className={`lt-menu ${align}`} role="listbox" aria-label={title || "Language"}>
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
        </ul>
      )}
    </div>
  );
}
