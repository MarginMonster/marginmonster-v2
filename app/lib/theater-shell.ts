/* THE THEATER'S SHELL — the app's shell, repainted dark while a dark page is up.
 *
 * The app's shell (routes/web.tsx: the page's ground, the header, a phone's tab bar) is cream, and knows
 * nothing of a dark side. A page that is dark under the theme (lib/theme.ts) brings the dark with it: it
 * mounts THIS stylesheet — in a <style> of its own making, ahead of its own dark rules — while the theme is
 * dark, and only then. When the page leaves, or the light is chosen, the stylesheet leaves with it and the
 * shell is the cream it was. (The sign-in lobby does the same with a sheet of its own. The Movie Maker was
 * the first page inside the app to; these are its shell rules, moved here as they stood — not a declaration
 * changed — so that a second page can share its dark.)
 *
 * WHAT IT IS: a deep green room — a near-black green, a lighter green where the light falls from above, the
 * app's own green low in the far corner — the shell's two great rosettes in the gold cut, the header's words
 * in cream and gold, and a phone's tab bar in deep green glass. It only PAINTS the shell: no size, padding
 * or place of anything in it changes (the two 44px hit areas are the only things it positions).
 *
 * EVERY RULE NAMES THE SHELL (html, body, .wb …) and never a page: a page's own dark rules stay with the
 * page, under a class of the page's own. tests/film-theater.test.ts holds the list of these rules, and that
 * they only paint. Plain text: nothing is interpolated into it, and it has no escape to lose. */
export const THEATER_SHELL_CSS = `
/* ---- the shell goes dark while a dark page is up (these rules leave with the page) ----
   THE DARK IS A DEEP GREEN (the owner, of the first, brown-black lobby: "maybe we do a dark green background
   instead of the brown"): a near-black green for the room, a lighter green where the light falls from above,
   the app's own green low in the far corner. Gold stays gold; the cream cards stay cream. */
html,body{background:#0A1C13;}
html{scrollbar-color:#2A5A41 #0A1C13;}
/* (…the page's own bar only: the pickers inside the cream cards keep the bars they had) */
body{scrollbar-color:auto;}
html .wb{background:radial-gradient(1200px 520px at 50% -160px,rgba(36,120,78,.36),rgba(36,120,78,0) 70%),radial-gradient(900px 520px at 0% 100%,rgba(12,122,70,.2),rgba(12,122,70,0) 70%),#0A1C13;}
/* THE ROOM'S TWO GREAT ROSETTES. The shell keeps two of them — the app's own spinner — turning slowly behind
   every page (fixed, under everything, taking no tap; green on the cream). Here, as in the lobby, they are the
   gold cut, and they go on turning as a member walks from one dark room into the other. They are BEHIND the
   page (the shell puts its header and its page above them), so never over a word; the shell stops them for
   "reduce motion", and so does the last rule of this sheet. */
html .wb::before,html .wb::after{background-image:url(/gstyle-rosette.svg);}
html .wb::before{opacity:.14;}
html .wb::after{opacity:.11;}
.wb .wb-brand{position:relative;color:#FFFDF7;}
.wb .wb-brand b{color:#E7C879;}
.wb .wb-crest img{filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));}
.wb .lt-btn{position:relative;background:rgba(255,253,247,.07);border-color:rgba(231,200,121,.5);color:#FFFDF7;box-shadow:none;}
.wb .lt-btn:hover,.wb .lt-btn[aria-expanded="true"]{border-color:#E7C879;color:#FFFDF7;box-shadow:0 0 0 3px rgba(231,200,121,.16);}
.wb .lt-btn .lt-glyph{color:#E7C879;}
.wb .lt-btn .lt-caret{color:#D8CFBA;}
/* the logo and the language pill are 30 and 32 tall: 44 to the finger, nothing moved */
.wb .wb-brand::after,.wb .lt-btn::after{content:"";position:absolute;inset:-7px -3px;}
.wb .wb-tab:not(.on){color:#D8CFBA;}
.wb .wb-tab:hover:not(.on){color:#FFFDF7;background:rgba(255,253,247,.08);}
/* (the tab you are on, and your account chip, are cream on the dark already: they only get the gold edge) */
.wb .wb-tab.on{border-color:rgba(231,200,121,.7);box-shadow:0 0 0 3px rgba(231,200,121,.12);}
.wb .wb-chip{border-color:rgba(231,200,121,.7);box-shadow:none;}
.wb .wb-chip:hover,.wb .wb-chip.on{border-color:#E7C879;box-shadow:0 0 0 3px rgba(231,200,121,.16);}
.wb .wb-admin{color:#D8CFBA;opacity:.8;}
.wb .wb-admin:hover{background:rgba(255,253,247,.1);}
.wb .wb-nav a:focus-visible,.wb .wb-nav button:focus-visible{outline-color:#E7C879;}
/* a phone's tab bar: a white pill was the brightest thing in the room */
@media(max-width:760px){
  .wb .wb-bottom{background:#0F2A1C;border-color:rgba(231,200,121,.42);box-shadow:0 14px 34px rgba(0,0,0,.6);}
  .wb .wb-bt{color:#D8CFBA;}
  .wb .wb-bt.on{color:#E7C879;}
  .wb .wb-bt.on .wb-bt-ic{background:rgba(231,200,121,.16);}
  .wb .wb-bt-mid{color:#D8CFBA;}
  .wb .wb-bottom a:focus-visible{outline-color:#E7C879;}
}
/* ---- less motion: the room's two rosettes stand still (the shell stops them too) ---- */
@media(prefers-reduced-motion:reduce){
  html .wb::before,html .wb::after{animation:none;}
}
`;
