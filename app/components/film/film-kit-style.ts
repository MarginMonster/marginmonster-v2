/* THE FILM KIT'S LOOK — one stylesheet for the Movie Maker's three new pieces: the scene BOARD
 * (SceneBoard.tsx), the length SLIDER (LengthSlider.tsx) and the starter NUDGES (StarterNudges.tsx).
 * Class prefix fk-; every piece's root also carries .fk, which holds the colours.
 *
 * TWO THEMES, AND WHAT EACH CHANGES. The Movie Maker's dark is "light cream cards over the dark" — what the
 * owner chose ("these cards even in dark should take on the lighter theme overlay like login right? To make
 * it flow"; routes/web.film.tsx → FS_THEATER): nothing a member works IN is repainted. So here too every
 * sheet, bubble, chip, the slider and the starter cards are the same cream and ink in both themes, and each
 * carries its OWN surface — none of them draws a word straight onto the page, so each reads the same on the
 * dark room, on the cream page, or inside one of the page's cream cards. What the theme changes is what is
 * AROUND them: the board's wall (a deep green pinboard / pale sage felt), the marks on it (gold / green),
 * and the edge and shadow of a card (a gold hairline and a deep drop / a sage hairline and a soft one).
 *   DARK is the stylesheet's own default — a piece with no theme round it is on the dark wall.
 *   LIGHT is any ancestor (or the piece itself) with data-theme="light" — the Movie Maker's root carries
 *   data-theme={theme}, so the kit follows the member's switch with nothing passed to it.
 *
 * A FINGER: every control is at least 44px to the touch (the small ones by an invisible ::after, never by
 * growing the drawing); anything typed into is 16px on a phone (a smaller box makes iOS zoom the page);
 * nothing is wider than its card, and the one row that scrolls sideways (the backdrops) scrolls inside
 * itself. LESS MOTION: every animation and transition here is off under prefers-reduced-motion, and a
 * sketch is simply there.
 *
 * WHAT THE SKETCHES NEED FROM THIS SHEET (lib/film-sketch.ts → "what the prompt cannot stop"): they are
 * shown in grey (one came back with a green lantern), laid onto the sheet's own paper with multiply (so the
 * white of a drawing is the paper, and a drawing that leaves half its page empty is a drawing on a sheet),
 * and the slate strip sits over the picture's lower edge, where a picture model signs its work.
 *
 * Plain text: nothing is interpolated into it, and it has no backslash to lose. tests/film-kit.test.ts
 * holds the rules that cannot be seen in a photograph. */
export const FILM_KIT_CSS = `
/* ---- the colours. Dark first; the light theme changes only what is AROUND the cards. ---- */
.fk{--fk-green:#0C7A46;--fk-green2:#1FA463;--fk-ink:#14201A;--fk-ink2:#4A554E;--fk-ink3:#75827A;--fk-cream:#FDFCF7;--fk-line:#E4DFCF;--fk-mint:#EAF6EF;--fk-gold:#E7C879;--fk-paper:#F4EFE1;
  --fk-wall:#0C2217;--fk-wall-lit:radial-gradient(900px 360px at 50% -140px,rgba(36,120,78,.34),rgba(36,120,78,0) 70%);--fk-wall-edge:rgba(231,200,121,.36);--fk-on-wall:#FFFDF7;--fk-on-wall2:#C9C2AE;--fk-mark:#E7C879;--fk-mark-ink:#14201A;
  --fk-edge:rgba(231,200,121,.62);--fk-drop:0 3px 5px rgba(0,0,0,.42),0 20px 32px -18px rgba(0,0,0,.72);--fk-pin:#E7C879;--fk-pin-deep:#9A7420;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fk-ink);box-sizing:border-box;-webkit-text-size-adjust:100%;}
[data-theme="light"] .fk,.fk[data-theme="light"]{--fk-wall:#EDF3EC;--fk-wall-lit:none;--fk-wall-edge:#CFE3D6;--fk-on-wall:#14201A;--fk-on-wall2:#5B6A61;--fk-mark:#0C7A46;--fk-mark-ink:#FFFDF7;
  --fk-edge:#C9DDD0;--fk-drop:0 2px 4px rgba(20,32,26,.05),0 16px 28px -18px rgba(20,32,26,.26);--fk-pin:#1FA463;--fk-pin-deep:#0A5A34;}
.fk *,.fk *::before,.fk *::after{box-sizing:border-box;}
.fk button,.fk input,.fk textarea{font-family:inherit;-webkit-tap-highlight-color:transparent;}
.fk button{cursor:pointer;}
.fk button:disabled{cursor:default;}
.fk :focus-visible{outline:2px solid var(--fk-green);outline-offset:2px;}
.fk-num{font-variant-numeric:tabular-nums;}

/* =====================================================================================================
   THE BOARD
   ===================================================================================================== */
.fk-board{container-type:inline-size;container-name:fkboard;background:var(--fk-wall-lit),var(--fk-wall);border:1px solid var(--fk-wall-edge);border-radius:22px;padding:12px;}

/* ---- the film's slate, across the top: black board, chalk words, the clapper's stripes ---- */
.fk-slate{position:relative;background:#14201A;color:#FFFDF7;border-radius:13px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,253,247,.1);}
.fk-slate-sticks{display:block;height:11px;background:repeating-linear-gradient(-58deg,#FFFDF7 0 13px,#14201A 13px 26px);border-bottom:2px solid #14201A;animation:fk-snap .42s cubic-bezier(.3,1.7,.5,1) .1s 1 backwards;}
.fk-slate-row{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"ttl ttl" "meta rw";align-items:center;gap:8px 12px;padding:10px 12px 11px 14px;}
.fk-slate-ttl{grid-area:ttl;min-width:0;display:flex;flex-direction:column;gap:3px;}
.fk-slate-ttl i{font:normal 800 9.5px/1 Poppins,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#E7C879;}
.fk-slate-ttl b{font:800 17px/1.22 Poppins,sans-serif;overflow-wrap:anywhere;}
.fk-slate-meta{grid-area:meta;font:700 12.5px/1.2 Poppins,sans-serif;color:#D8CFBA;}
.fk-slate-rw{grid-area:rw;position:relative;min-height:36px;display:inline-flex;align-items:center;gap:6px;border:1.5px solid rgba(255,253,247,.4);background:transparent;color:#FFFDF7;border-radius:999px;padding:0 13px;font:800 12px/1 Poppins,sans-serif;transition:background .14s,border-color .14s;}
.fk-slate-rw::after{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}
.fk-slate-rw.is-arm{background:#FFF7E3;border-color:#E7C879;color:#7A5A12;}
.fk-slate-rw:disabled{opacity:.5;}
.fk-slate :focus-visible{outline-color:#E7C879;}
@container fkboard (min-width:620px){
  .fk-slate-row{grid-template-columns:minmax(0,1fr) auto auto;grid-template-areas:"ttl meta rw";gap:16px;padding:12px 14px 13px 18px;}
  .fk-slate-ttl b{font-size:19px;}
}

/* ---- the wall: one column on a phone; two, then three (never more) as the board widens. The board
   measures ITSELF (a container query), so it is right wherever the page puts it: two columns from a board
   780px wide (a 900px window, less the page's gutters), three from 1240px (a 1400px window). A browser too
   old to measure a container goes by the window instead. ---- */
.fk-wall{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:2px 16px;align-items:start;grid-template-columns:minmax(0,1fr);}
@container fkboard (min-width:780px){.fk-wall{grid-template-columns:repeat(2,minmax(0,1fr));}}
@container fkboard (min-width:1240px){.fk-wall{grid-template-columns:repeat(3,minmax(0,1fr));}}
@supports not (container-type:inline-size){
  @media(min-width:900px){.fk-wall{grid-template-columns:repeat(2,minmax(0,1fr));}}
  @media(min-width:1400px){.fk-wall{grid-template-columns:repeat(3,minmax(0,1fr));}}
}
.fk-cell{min-width:0;}
.fk-cut{display:flex;align-items:center;gap:8px;height:32px;color:var(--fk-mark);font:800 10px/1 Poppins,sans-serif;letter-spacing:.24em;white-space:nowrap;}
.fk-cut span{flex:1;border-top:1.5px dashed currentColor;opacity:.42;}

/* ---- a sheet: the picture, the slate strip over its lower edge, the lines, the notes ---- */
.fk-frame{position:relative;background:var(--fk-cream);border-radius:16px;box-shadow:0 0 0 1px var(--fk-edge),var(--fk-drop);transition:box-shadow .2s;}
/* (it is PINNED to the board: one pin, half on the wall and half on the sheet — brass on the dark, green on the light) */
.fk-frame::before{content:"";position:absolute;z-index:2;left:50%;top:-6px;width:13px;height:13px;margin-left:-6.5px;border-radius:50%;background:radial-gradient(circle at 36% 30%,#FFF9E2 0 14%,var(--fk-pin) 46%,var(--fk-pin-deep) 100%);box-shadow:0 2px 3px rgba(0,0,0,.42),0 5px 6px -3px rgba(0,0,0,.4);pointer-events:none;}
.fk-pic{position:relative;aspect-ratio:16/9;margin-bottom:24px;}
.fk-board[data-aspect="9:16"] .fk-pic{aspect-ratio:1/1;}
.fk-board[data-aspect="1:1"] .fk-pic{aspect-ratio:4/3;}
.fk-sheet{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;border-radius:16px 16px 0 0;background:radial-gradient(120% 90% at 28% 16%,#FBF7EC,#EDE6D3);}
.fk-panel{position:relative;height:100%;max-width:100%;aspect-ratio:16/9;overflow:hidden;}
/* (a tall or a square film's panel is ruled onto the wider sheet, as a storyboard pad prints its boxes) */
.fk-board[data-aspect="9:16"] .fk-panel{aspect-ratio:9/16;box-shadow:0 0 0 1px rgba(20,32,26,.3);}
.fk-board[data-aspect="1:1"] .fk-panel{aspect-ratio:1/1;box-shadow:0 0 0 1px rgba(20,32,26,.3);}
/* THE SKETCH DEVELOPS: there, soft and faint, then sharp — once. Grey, and laid on the paper (multiply). */
.fk-sketch{display:block;width:100%;height:100%;object-fit:cover;mix-blend-mode:multiply;filter:grayscale(1) contrast(1.3) blur(14px);opacity:0;transform:scale(1.05);transition:filter .9s ease,opacity .5s ease,transform 1.1s cubic-bezier(.2,.7,.2,1);}
.fk-sketch.is-in{filter:grayscale(1) contrast(1.3);opacity:1;transform:none;}
/* the sheet before its sketch: ruled in thirds, its number, the place's own drawing in pencil */
.fk-blank{position:absolute;inset:0;display:grid;place-items:center;color:#8E8672;}
.fk-blank-rule{position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:#B4AB93;stroke-width:1;stroke-dasharray:3 4;vector-effect:non-scaling-stroke;opacity:.6;}
.fk-blank-rule path{vector-effect:non-scaling-stroke;}
.fk-blank-n{position:absolute;left:12px;top:2px;font:800 56px/1 Poppins,sans-serif;color:rgba(20,32,26,.07);}
.fk-blank-glyph{width:30%;max-width:104px;height:auto;aspect-ratio:1;margin-bottom:20px;fill:none;stroke:#A39B85;stroke-width:.55;stroke-linecap:round;stroke-linejoin:round;}
.fk-blank-line{position:absolute;left:10%;bottom:36px;width:80%;height:12px;fill:none;stroke:#7F7763;stroke-width:1.6;stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:100;opacity:0;}
.fk-blank-line path{vector-effect:non-scaling-stroke;}
.fk-blank.is-drawing .fk-blank-line{opacity:1;animation:fk-draw 1.9s ease-in-out infinite;}
.fk-blank.is-drawing .fk-blank-glyph{animation:fk-breathe 1.9s ease-in-out infinite;}
.fk-blank-say{position:absolute;left:0;right:0;top:14px;text-align:center;font:800 10px/1 Poppins,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#7F7763;}

/* the corner: earlier, later, remove (asked twice). 32px drawn, 44px to the finger, 12px apart */
.fk-tools{position:absolute;top:8px;inset-inline-end:8px;display:flex;gap:12px;}
.fk-tool{position:relative;height:32px;min-width:32px;display:inline-flex;align-items:center;justify-content:center;gap:5px;border:0;border-radius:10px;padding:0;background:rgba(20,32,26,.56);color:#FFFDF7;font:800 11.5px/1 Poppins,sans-serif;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);transition:background .14s,opacity .14s;}
.fk-tool::after{content:"";position:absolute;inset:-6px;}
.fk-tool:disabled{opacity:.34;}
.fk-tool:focus-visible{outline-color:#E7C879;}
.fk-rm.is-arm{padding:0 10px;background:#C0392B;}
/* (side by side on a wide board, "earlier" is to the left) */
@container fkboard (min-width:800px){.fk-mv svg{transform:rotate(-90deg);}}

/* the slate strip: a plate across the picture's lower edge — the clapper tag, the place, a pencil */
.fk-strip{position:absolute;left:10px;right:10px;bottom:-22px;min-height:46px;display:flex;align-items:center;gap:10px;border:0;border-radius:11px;padding:7px 10px 7px 9px;background:#14201A;color:#FFFDF7;text-align:start;box-shadow:0 8px 16px -6px rgba(20,32,26,.5),inset 0 0 0 1px rgba(255,253,247,.1);transition:box-shadow .14s;}
.fk-strip:focus-visible{outline-color:#E7C879;}
.fk-tag{flex:none;position:relative;align-self:center;display:inline-flex;align-items:center;height:22px;margin-top:6px;padding:0 7px;border-radius:0 0 5px 5px;background:#FFFDF7;color:#14201A;font:800 11px/1 Poppins,sans-serif;letter-spacing:.06em;white-space:nowrap;}
.fk-tag i{position:absolute;left:0;right:0;top:-7px;height:7px;border-radius:3px 3px 0 0;background:repeating-linear-gradient(-58deg,#FFFDF7 0 5px,#14201A 5px 10px);box-shadow:0 0 0 1px #FFFDF7;transform-origin:0 100%;animation:fk-clap .5s cubic-bezier(.3,1.7,.5,1) .25s 1 backwards;}
/* (two lines of the place: a third would cover the picture it names — all of it is there to read, and to
   change, when the strip is tapped) */
.fk-place{flex:1;min-width:0;font:700 12.5px/1.32 Poppins,sans-serif;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;}
.fk-strip-ic{flex:none;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:rgba(255,253,247,.12);color:#E7C879;}
.fk-frame.is-open .fk-strip-ic{background:#1FA463;color:#fff;}

/* the place, retyped — and the backdrops, a row that scrolls sideways inside the sheet */
.fk-where{padding:10px 12px 0;}
.fk-where-in{display:block;width:100%;min-height:44px;margin:0;resize:none;overflow:hidden;border:1.5px solid var(--fk-green);border-radius:12px;padding:10px 12px;font:600 14px/1.35 Inter,sans-serif;color:var(--fk-ink);background:#fff;box-shadow:0 0 0 3px rgba(12,122,70,.12);}
/* (a box being typed in is lit by its own border: the page-wide focus ring on top of it was a second ring) */
.fk .fk-where-in:focus-visible,.fk .fk-bubble-in:focus-visible,.fk .fk-cam-in:focus-visible{outline:0;}
.fk-bds{display:flex;gap:8px;margin:0 -12px;padding:10px 12px 4px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scroll-padding-inline:12px;scrollbar-width:none;-webkit-overflow-scrolling:touch;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 30px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 30px),transparent);}
.fk-bds::-webkit-scrollbar{display:none;}
[dir=rtl] .fk-bds{-webkit-mask-image:linear-gradient(270deg,#000 calc(100% - 30px),transparent);mask-image:linear-gradient(270deg,#000 calc(100% - 30px),transparent);}
.fk-bd{flex:none;scroll-snap-align:start;min-width:70px;min-height:60px;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;border:1.5px solid var(--fk-line);border-radius:13px;padding:8px 10px;background:#fff;color:var(--fk-ink2);font:700 11px/1.1 Poppins,sans-serif;white-space:nowrap;transition:border-color .14s,background .14s,color .14s,transform .12s;}
.fk-bd:active{transform:scale(.96);}
.fk-bd.on{border-color:var(--fk-green);background:var(--fk-mint);color:#0F6E56;}

/* ---- the lines: the scene being played ---- */
.fk-lines{position:relative;display:flex;flex-direction:column;gap:12px;padding:14px 12px 4px;}
.fk-angle{display:flex;flex-direction:column;gap:12px;}
.fk-line{position:relative;display:flex;align-items:flex-end;gap:8px;}
.fk-line.right{flex-direction:row-reverse;}
.fk-face{flex:none;position:relative;width:38px;height:38px;border:0;border-radius:50%;padding:0;background:#E3F3EA center/cover no-repeat;box-shadow:0 0 0 2px #fff,0 0 0 3.5px #9CCBB1;display:grid;place-items:center;color:#0F6E56;font:800 14px/1 Poppins,sans-serif;transition:transform .14s;}
.fk-line.right .fk-face{background-color:#F6EBD0;box-shadow:0 0 0 2px #fff,0 0 0 3.5px #E0C58A;color:#7A5A12;}
.fk-face::after{content:"";position:absolute;inset:-3px;}
.fk-face:disabled{opacity:1;}
.fk-say{min-width:0;flex:0 1 auto;display:flex;flex-direction:column;align-items:flex-start;gap:3px;}
.fk-line.right .fk-say{align-items:flex-end;}
.fk-line.is-edit .fk-say{flex:1 1 auto;align-items:stretch;}
.fk-who{border:0;background:none;padding:0 5px;color:var(--fk-green);font:800 10.5px/1.2 Poppins,sans-serif;letter-spacing:.07em;text-transform:uppercase;}
.fk-line.right .fk-who{color:#8A6A1C;}
.fk-line.is-edit.right .fk-who{align-self:flex-end;}
.fk-who:disabled{opacity:1;}
/* a bubble at rest is TEXT (a button that looks like speech); typed in, it is the same bubble, lit */
.fk-bubble{display:block;max-width:100%;min-height:44px;margin:0;border:1.5px solid var(--fk-line);border-radius:16px;border-end-start-radius:5px;padding:9px 13px;background:#fff;color:var(--fk-ink);font:500 14px/1.45 Inter,sans-serif;text-align:start;white-space:pre-wrap;overflow-wrap:anywhere;cursor:text;transition:border-color .14s,box-shadow .14s,background .3s;}
.fk-line.right .fk-bubble{background:var(--fk-mint);border-color:#B7DCC8;border-radius:16px;border-end-end-radius:5px;}
.fk-bubble:disabled{color:var(--fk-ink);cursor:default;}
.fk-bubble-in{width:100%;min-height:42px;resize:none;overflow:hidden;border-color:var(--fk-green);box-shadow:0 0 0 3px rgba(12,122,70,.14);outline:0;}
.fk-line.right .fk-bubble-in{border-color:var(--fk-green);}
.fk-x{flex:none;align-self:center;position:relative;width:26px;height:26px;border:0;border-radius:50%;padding:0;background:transparent;color:#B9B29E;display:grid;place-items:center;transition:color .14s,background .14s;}
.fk-x::after{content:"";position:absolute;inset:-9px;}
.fk-x:disabled{opacity:.4;}
/* the seconds: a meter only while typing; at rest, a quiet mark on a line that runs long */
.fk-meter{display:flex;align-items:center;gap:8px;padding:1px 4px 0;}
.fk-meter-bar{position:relative;flex:1;max-width:150px;height:4px;border-radius:3px;background:#E7EFEA;overflow:hidden;}
.fk-meter-bar i{position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--fk-green2);transition:width .12s ease;}
.fk-meter-num{font:700 10.5px/1 Poppins,sans-serif;color:#6A8577;white-space:nowrap;font-variant-numeric:tabular-nums;}
.fk-meter.warn .fk-meter-bar i{background:#D59A2A;}
.fk-meter.warn .fk-meter-num{color:#B07D16;}
.fk-meter.over .fk-meter-bar i{background:#D6563F;}
.fk-meter.over .fk-meter-num{color:#C0392B;}
.fk-long{display:inline-flex;align-items:center;gap:5px;padding:0 5px;font:700 10.5px/1.2 Poppins,sans-serif;color:#B07D16;font-variant-numeric:tabular-nums;}
.fk-long i{flex:none;width:7px;height:7px;border-radius:50%;background:currentColor;}
.fk-long.over{color:#C0392B;}
.fk-line.over .fk-bubble:not(.fk-bubble-in){border-color:#E9B4A8;}
/* a shot nobody speaks in */
.fk-line.is-unsaid{justify-content:center;align-items:center;}
.fk-unsaid{position:relative;min-height:36px;display:inline-flex;align-items:center;gap:7px;border:1.5px dashed #C9C2AE;border-radius:999px;padding:0 14px;background:transparent;color:var(--fk-ink2);font:700 12px/1 Poppins,sans-serif;}
.fk-unsaid::after{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}
.fk-line.is-unsaid .fk-x{position:absolute;inset-inline-end:0;}
/* a close-up: a small camera tag between the bubbles */
.fk-cam{align-self:center;max-width:100%;display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:3px 4px 3px 11px;background:#14201A;color:#FFFDF7;font:700 11.5px/1 Poppins,sans-serif;}
.fk-cam > svg{color:#E7C879;}
.fk-cam-txt{position:relative;min-width:0;min-height:26px;border:0;background:none;padding:0 2px;color:inherit;font:inherit;text-align:start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fk-cam-txt::after{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}
.fk-cam-txt:disabled{opacity:1;}
.fk-cam-in{width:170px;max-width:46vw;min-height:26px;border:0;border-bottom:1px dashed rgba(255,253,247,.6);border-radius:0;padding:0 2px;background:transparent;color:#FFFDF7;font:inherit;outline:0;}
.fk-cam-in::placeholder{color:rgba(255,253,247,.55);}
.fk-cam-x{flex:none;position:relative;width:24px;height:24px;border:0;border-radius:50%;padding:0;background:rgba(255,253,247,.14);color:#FFFDF7;display:grid;place-items:center;}
.fk-cam-x::after{content:"";position:absolute;inset:-10px;}
.fk-cam :focus-visible{outline-color:#E7C879;}

/* ---- directing is one tap ---- */
.fk-notes{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;padding:12px 12px 2px;border-top:1px dashed var(--fk-line);}
.fk-notes-ic{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#14201A;color:#E7C879;}
.fk-note{position:relative;min-height:36px;display:inline-flex;align-items:center;gap:6px;border:1.5px solid #CDE8DA;border-radius:999px;padding:0 13px;background:#F3F9F4;color:var(--fk-green);font:800 12.5px/1 Poppins,sans-serif;white-space:nowrap;transition:transform .12s,background .14s,border-color .14s,box-shadow .14s,opacity .14s;}
/* (an ::after is measured from inside the border: 33px of chip + 6 above and below is the 44 a finger needs) */
.fk-note::after{content:"";position:absolute;inset:-6px -2px;}
.fk-note:active:not(:disabled){transform:scale(.96);}
.fk-note-dice{background:#14201A;border-color:#14201A;color:#FFFDF7;}
.fk-note-dice svg{transition:transform .2s;}
.fk-note:disabled{opacity:.45;}
.fk-note.is-on{opacity:1;background:var(--fk-green);border-color:var(--fk-green);color:#fff;animation:fk-pulse 1.1s ease-in-out infinite;}
.fk-status{margin:0;padding:8px 14px 0;font:700 11.5px/1.2 Poppins,sans-serif;color:var(--fk-green);}
.fk-status:empty{display:none;}
/* while the writer has a sheet: it shimmers, its lines hold */
.fk-frame.is-noting{box-shadow:0 0 0 2px var(--fk-green2),var(--fk-drop);}
.fk-frame.is-noting .fk-lines{pointer-events:none;}
.fk-frame.is-noting .fk-line{opacity:.62;}
.fk-frame.is-noting .fk-lines::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,rgba(253,252,247,0) 32%,rgba(253,252,247,.9) 50%,rgba(253,252,247,0) 68%);background-size:240% 100%;animation:fk-shimmer 1.35s linear infinite;}
/* …and the new lines settle in, one after another, and glow for a second */
.fk-frame.is-fresh .fk-line{animation:fk-settle .46s cubic-bezier(.2,.9,.3,1.2) calc(var(--k,0) * 80ms) backwards;}
.fk-frame.is-fresh .fk-bubble{animation:fk-glow 1.5s ease-out calc(var(--k,0) * 80ms) 1 backwards;}

/* ---- quiet tools at the foot ---- */
.fk-foot{display:flex;align-items:center;gap:4px;padding:6px 6px 10px;}
.fk-quiet{position:relative;min-height:36px;display:inline-flex;align-items:center;gap:5px;border:0;border-radius:9px;padding:0 9px;background:transparent;color:var(--fk-ink2);font:700 12px/1 Poppins,sans-serif;transition:background .14s,color .14s;}
.fk-quiet::after{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}
.fk-quiet:disabled{opacity:.45;}
.fk-foot-len{margin-inline-start:auto;padding-inline-end:8px;font:800 11.5px/1 Poppins,sans-serif;color:var(--fk-ink3);}

/* ---- after the last sheet: a dashed frame to step into ---- */
.fk-new{width:100%;aspect-ratio:16/9;min-height:150px;max-height:230px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:2px dashed var(--fk-wall-edge);border-radius:16px;background:transparent;color:var(--fk-on-wall);transition:background .16s,border-color .16s;}
.fk-new b{font:800 15px/1.2 Poppins,sans-serif;}
.fk-new small{font:500 12px/1.3 Inter,sans-serif;color:var(--fk-on-wall2);}
.fk-new-plus{width:46px;height:46px;margin-bottom:7px;border-radius:50%;display:grid;place-items:center;background:var(--fk-mark);color:var(--fk-mark-ink);transition:transform .2s;}
.fk-new:focus-visible{outline-color:var(--fk-mark);}
.fk-new:disabled{opacity:.5;}
.fk-board.is-busy .fk-slate-rw{opacity:1;}

/* =====================================================================================================
   THE LENGTH SLIDER — a strip of film
   ===================================================================================================== */
.fk-len{container-type:inline-size;container-name:fklen;background:linear-gradient(180deg,#fff,#FBF8EF);border-radius:16px;box-shadow:0 0 0 1px var(--fk-edge);padding:14px 16px 13px;}
.fk-len.is-off{opacity:.55;}
.fk-len-read{display:flex;align-items:center;gap:12px;}
.fk-len-time{display:inline-block;min-width:var(--clock,4ch);font:800 46px/1 Poppins,sans-serif;letter-spacing:-.01em;color:var(--fk-ink);}
.fk-len-count{display:inline-block;min-width:calc(var(--count,9ch) + 24px);text-align:center;border:1px solid #CDE8DA;border-radius:999px;padding:6px 11px;background:var(--fk-mint);color:var(--fk-green);font:800 13.5px/1 Poppins,sans-serif;white-space:nowrap;}
/* the strip reads left to right in every language, as a film does */
.fk-len-strip,.fk-len-ticks{direction:ltr;}
.fk-len-strip{position:relative;height:56px;margin-top:10px;touch-action:pan-y;}
/* the film: sprocket holes along both edges, frames between them */
.fk-len-film{position:absolute;left:0;right:0;top:6px;height:44px;border-radius:7px;overflow:hidden;box-shadow:0 2px 5px rgba(20,32,26,.28);
  background:
    repeating-linear-gradient(90deg,transparent 0 5px,#F4EFE1 5px 11px,transparent 11px 16px) 0 5px / 100% 5px no-repeat,
    repeating-linear-gradient(90deg,transparent 0 5px,#F4EFE1 5px 11px,transparent 11px 16px) 0 34px / 100% 5px no-repeat,
    repeating-linear-gradient(90deg,rgba(255,253,247,.13) 0 1.5px,transparent 1.5px 32px) 0 13px / 100% 18px no-repeat,
    linear-gradient(#27392F,#27392F) 0 13px / 100% 18px no-repeat,
    #17241D;}
/* …lit, in the brand green, as far as the thumb's centre */
.fk-len-lit{position:absolute;left:0;top:13px;height:18px;width:calc(var(--p,0) * (100% - 44px) + 22px);background:repeating-linear-gradient(90deg,rgba(0,0,0,.22) 0 1.5px,transparent 1.5px 32px),linear-gradient(180deg,#2BC27A,#0C7A46);box-shadow:0 0 12px rgba(31,164,99,.6);}
/* the real control: invisible, the whole strip, with a thumb as wide as a finger */
.fk-len-in{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;opacity:0;cursor:grab;-webkit-appearance:none;appearance:none;background:transparent;touch-action:pan-y;}
.fk-len-in:active{cursor:grabbing;}
.fk-len-in:disabled{cursor:default;}
.fk-len-in::-webkit-slider-runnable-track{height:56px;background:transparent;}
.fk-len-in::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:44px;height:56px;border:0;background:transparent;}
.fk-len-in::-moz-range-track{height:56px;background:transparent;}
.fk-len-in::-moz-range-thumb{width:44px;height:56px;border:0;border-radius:0;background:transparent;}
/* the thumb a member sees: one frame of the film, held up to the light */
.fk-len-thumb{position:absolute;top:0;left:calc(var(--p,0) * (100% - 44px) + 22px);width:34px;height:56px;margin-left:-17px;border:3px solid #FFFDF7;border-radius:9px;background:linear-gradient(180deg,rgba(64,214,142,.5),rgba(12,122,70,.5));box-shadow:0 0 0 1.5px #C79A3A,0 8px 16px -4px rgba(20,32,26,.55);pointer-events:none;transition:left .07s linear,transform .12s;}
.fk-len-thumb i{position:absolute;inset:0;margin:auto;width:9px;height:14px;border-inline:2px solid rgba(255,253,247,.95);}
.fk-len-in:active + .fk-len-thumb{transform:scale(1.07);}
.fk-len-in:focus-visible + .fk-len-thumb{outline:2px solid var(--fk-green);outline-offset:3px;}
.fk-len-ticks{position:relative;height:22px;margin-top:1px;}
.fk-len-ticks span{position:absolute;top:8px;left:calc(var(--at,0) * (100% - 44px) + 22px);transform:translateX(-50%);font:700 10.5px/1 Poppins,sans-serif;color:var(--fk-ink3);white-space:nowrap;}
.fk-len-ticks span::before{content:"";position:absolute;left:50%;top:-7px;width:1.5px;height:5px;margin-left:-.75px;background:#B9B29E;}
/* what it costs, how long it takes — and, beside them, that it is free for now. ALWAYS THE SAME HEIGHT: on
   a narrow strip it is two rows whatever it says (the cost and "free" / how long it takes) — as one wrapping
   line it was two rows at 0:20 and three at 5:00, and everything under the slider moved 42px on the way;
   where there is room (the slider measures itself) it is the one line. */
.fk-len-est{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"cost free" "takes takes";align-items:center;gap:5px 9px;margin:10px 0 0;font:500 12.5px/1.35 Inter,sans-serif;color:var(--fk-ink2);}
.fk-len-cost{grid-area:cost;font:800 13.5px/1.2 Poppins,sans-serif;color:var(--fk-ink);white-space:nowrap;}
.fk-len-takes{grid-area:takes;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fk-len-dot{display:none;color:#B9B29E;}
.fk-len-free{grid-area:free;justify-self:start;border:1px solid #EBD9A8;border-radius:999px;padding:3px 8px;background:#FBEFD0;color:#7A5A12;font:800 9.5px/1.2 Poppins,sans-serif;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;}
@container fklen (min-width:600px){
  .fk-len-est{display:flex;flex-wrap:nowrap;gap:8px;}
  .fk-len-dot{display:inline;}
}
@media(max-width:480px){
  .fk-len{padding:13px 13px 12px;}
  .fk-len-time{font-size:42px;}
}

/* =====================================================================================================
   THE STARTER NUDGES
   ===================================================================================================== */
.fk-nudge{margin-top:12px;}
.fk-nudge-head{display:flex;align-items:center;justify-content:space-between;gap:10px;}
.fk-nudge-q{display:inline-flex;align-items:center;gap:6px;border:1px solid #CDE8DA;border-radius:999px;padding:6px 11px;background:var(--fk-mint);color:var(--fk-green);font:800 12.5px/1 Poppins,sans-serif;white-space:nowrap;}
.fk-nudge-more{position:relative;min-height:36px;display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--fk-line);border-radius:999px;padding:0 13px;background:#fff;color:var(--fk-ink);font:800 12px/1 Poppins,sans-serif;white-space:nowrap;transition:border-color .14s,background .14s;}
.fk-nudge-more::after{content:"";position:absolute;left:0;right:0;top:50%;height:44px;transform:translateY(-50%);}
.fk-nudge-more svg{transition:transform .2s;}
.fk-nudge-more:disabled{opacity:.5;}
.fk-nudge-hint{margin:10px 0 0;border:1px solid #EBD9A8;border-radius:11px;padding:9px 12px;background:#FFF7E3;color:#7A5A12;font:600 13px/1.4 Inter,sans-serif;}
.fk-nudge-list{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));}
.fk-nudge-list li{min-width:0;display:flex;}
.fk-nudge-card{width:100%;min-height:64px;display:flex;flex-direction:column;justify-content:space-between;gap:9px;border:1.5px solid var(--fk-line);border-inline-start:4px solid var(--fk-green2);border-radius:13px;padding:11px 13px 10px 12px;background:#fff;color:var(--fk-ink);font:500 13.5px/1.46 Inter,sans-serif;text-align:start;overflow-wrap:anywhere;transition:transform .14s,border-color .14s,box-shadow .14s,background .2s;}
.fk-nudge-card:active:not(:disabled){transform:scale(.985);}
.fk-nudge-card:disabled{opacity:.55;}
.fk-nudge-use{display:inline-flex;align-items:center;gap:5px;color:var(--fk-green);font:800 11px/1 Poppins,sans-serif;}
.fk-nudge-card.is-on{background:var(--fk-mint);border-color:var(--fk-green);}
.fk-nudge-list.is-dealt li{animation:fk-deal .42s cubic-bezier(.2,.8,.3,1.15) calc(var(--i,0) * 80ms) backwards;}
.fk-nudge.is-urge .fk-nudge-list li{animation:fk-stir .5s ease calc(var(--i,0) * 70ms) 1 backwards;}

/* ---- a pointer that can hover. (A finger's tap leaves :hover stuck on what it touched: a note that had
   just been carried out still looked pressed.) ---- */
@media(hover:hover){
  .fk-slate-rw:hover:not(:disabled){background:rgba(255,253,247,.1);border-color:#FFFDF7;}
  .fk-tool:hover:not(:disabled){background:#14201A;}
  .fk-rm.is-arm:hover:not(:disabled){background:#A93226;}
  .fk-strip:hover:not(:disabled){box-shadow:0 8px 16px -6px rgba(20,32,26,.5),inset 0 0 0 1.5px #E7C879;}
  .fk-bd:hover{border-color:#9CCBB1;color:var(--fk-ink);}
  .fk-face:hover:not(:disabled){transform:scale(1.07);}
  .fk-bubble:hover:not(:disabled):not(.fk-bubble-in){border-color:#8FC3A6;box-shadow:0 0 0 3px rgba(12,122,70,.07);}
  .fk-x:hover:not(:disabled){color:#C2410C;background:#FBEAE3;}
  .fk-unsaid:hover:not(:disabled){border-color:var(--fk-green);color:var(--fk-green);}
  .fk-cam-x:hover:not(:disabled){background:#C0392B;}
  .fk-note:hover:not(:disabled){background:var(--fk-mint);border-color:var(--fk-green);transform:translateY(-1px);box-shadow:0 6px 12px -6px rgba(12,122,70,.5);}
  .fk-note-dice:hover:not(:disabled){background:#23352B;border-color:#23352B;box-shadow:0 6px 12px -6px rgba(20,32,26,.6);}
  .fk-note-dice:hover:not(:disabled) svg{transform:rotate(18deg);}
  .fk-quiet:hover:not(:disabled){background:#F1EEE2;color:var(--fk-ink);}
  .fk-new:hover:not(:disabled){border-color:var(--fk-mark);background:rgba(127,160,140,.1);}
  .fk-new:hover:not(:disabled) .fk-new-plus{transform:rotate(90deg);}
  .fk-nudge-more:hover:not(:disabled){border-color:var(--fk-green);background:#F3F9F4;}
  .fk-nudge-more:hover:not(:disabled) svg{transform:rotate(18deg);}
  .fk-nudge-card:hover:not(:disabled){border-color:var(--fk-green);transform:translateY(-2px);box-shadow:0 12px 18px -14px rgba(12,122,70,.6);}
}

/* ---- a phone: what is typed into is 16px (a smaller box makes iOS zoom the page) ---- */
@media(max-width:640px){
  /* (a line at rest is 15px there, so it barely moves when it opens — and the box it opens into is named
     with .fk in front, so that this 15 can never win over its 16: it did, the first time it was measured) */
  .fk-bubble{font-size:15px;}
  .fk .fk-where-in,.fk .fk-bubble-in,.fk .fk-cam-in{font-size:16px;}
  .fk-board{padding:10px;border-radius:20px;}
}
/* ---- words whose letters join (Urdu): no letter-spacing ---- */
[dir=rtl] .fk-cut,[dir=rtl] .fk-slate-ttl i,[dir=rtl] .fk-who,[dir=rtl] .fk-tag,[dir=rtl] .fk-blank-say,[dir=rtl] .fk-len-free{letter-spacing:0;}

@keyframes fk-snap{from{transform:translateY(-9px);}to{transform:none;}}
@keyframes fk-clap{from{transform:rotate(-26deg);}to{transform:none;}}
@keyframes fk-draw{0%{stroke-dashoffset:100;opacity:1;}62%{stroke-dashoffset:0;opacity:1;}100%{stroke-dashoffset:0;opacity:0;}}
@keyframes fk-breathe{0%,100%{opacity:.55;}50%{opacity:1;}}
@keyframes fk-pulse{0%,100%{box-shadow:0 0 0 0 rgba(31,164,99,.5);}50%{box-shadow:0 0 0 6px rgba(31,164,99,0);}}
@keyframes fk-shimmer{from{background-position:120% 0;}to{background-position:-120% 0;}}
@keyframes fk-settle{from{opacity:0;transform:translateY(9px);}to{opacity:1;transform:none;}}
@keyframes fk-glow{0%{box-shadow:0 0 0 0 rgba(31,164,99,.7);background-color:#C9EDD9;border-color:#1FA463;}30%{box-shadow:0 0 0 6px rgba(31,164,99,.3);background-color:#D9F2E4;border-color:#1FA463;}100%{box-shadow:0 0 0 0 rgba(31,164,99,0);}}
@keyframes fk-deal{from{opacity:0;transform:translateY(12px) rotate(-1.6deg) scale(.97);}to{opacity:1;transform:none;}}
@keyframes fk-stir{0%,100%{transform:none;}30%{transform:translateY(-4px);}60%{transform:translateY(1px);}}

/* ---- less motion: nothing here moves, and a sketch is simply there ---- */
@media(prefers-reduced-motion:reduce){
  .fk *,.fk *::before,.fk *::after{animation:none!important;transition:none!important;}
  .fk-sketch{filter:grayscale(1) contrast(1.3);opacity:1;transform:none;}
  .fk-blank.is-drawing .fk-blank-line{stroke-dashoffset:0;}
}
`;
