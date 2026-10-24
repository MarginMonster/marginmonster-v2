/* Static mock of the finished forge modal + voice picker + manage modal, built
 * from the REAL shell CSS + WS_STYLE, to eyeball the new layout before deploy.
 * (Static — doesn't exercise the React audio/selection; it's a visual check.) */
const fs = require("fs");
const REPO = "C:/Users/Magic/Downloads/Wholesalesite/marginmonster-remix";
const CSS = (fs.readFileSync(REPO + "/app/routes/web.tsx", "utf8").match(/const CSS = `([\s\S]*?)`;/) || [])[1] || "";
const WS = (fs.readFileSync(REPO + "/app/routes/web.studio.tsx", "utf8").match(/const WS_STYLE = `([\s\S]*?)`;/) || [])[1] || "";
const IMG = "/ad-templates/ctcover-cartoon.jpg";

const MALE = [
  ["Trustworthy", "Warm and steady", true], ["Magnetic", "Bold and upbeat", false],
  ["Upbeat", "Young and energetic", false], ["Easygoing", "Calm and steady", false],
  ["Deep", "Mature and cinematic", false],
];
const FEM = [
  ["Friendly", "Warm and approachable", true], ["Confident", "Bold and upbeat", false],
  ["Playful", "Young and energetic", false], ["Calm", "Soft and soothing", false],
  ["Warm & wise", "Mature and reassuring", false],
];
const chips = (list) => list.map(([label, blurb, sel]) =>
  `<div class="ws-vp-chip${sel ? " sel" : ""}"><button class="ws-vp-pick"><b>${label}</b><em class="ws-vp-blurb">${blurb}</em>${sel ? '<i class="ws-vp-tick">✓</i>' : ""}</button><button class="ws-vp-play">▶</button></div>`
).join("");

const forge = `
<div class="ws-scrim mock">
  <div class="ws-forgem">
    <button class="ws-forgem-x">✕</button>
    <div class="ws-forgem-h"><span class="ws-forgem-crest">✦</span><div><b>Create your own presenter</b><span>Upload your logo, mascot or spokesperson — we forge them into a presenter with four outfits, ready to star in your videos. Yours alone.</span></div></div>
    <input class="wb-in ws-forgem-nm" placeholder="Presenter name (e.g. your mascot)" value="Magic Monster">
    <label class="ws-forgem-up has"><span class="ws-forgem-thumb" style="background-image:url(${IMG})"></span><span>Photo added — tap to change</span></label>
    <div class="ws-seg ws-forgem-seg"><button class="sel">He</button><button>She</button></div>
    <div class="ws-forgem-lbl">Voice<span>tap ▶ to hear it</span></div>
    <div class="ws-vp">${chips(MALE)}</div>
    <div class="ws-forgem-lbl">Vibe</div>
    <div class="ws-seg ws-forgem-seg"><button class="sel">Warm</button><button>Energetic</button><button>Chill</button></div>
    <textarea class="wb-in ws-forgem-desc" placeholder="Describe your character (optional) — e.g. a friendly green monster mascot"></textarea>
    <button class="wb-btn ws-forgem-go">✦ Forge my presenter · 20 tokens</button>
  </div>
</div>`;

const manage = `
<div class="ws-scrim mock">
  <div class="ws-managem">
    <button class="ws-forgem-x">✕</button>
    <div class="ws-forgem-h"><span class="ws-forgem-crest">⚙</span><div><b>Your presenters</b><span>Change a voice, or delete one to free a slot. You have 3 of 12.</span></div></div>
    <div class="ws-mp-list">
      <div class="ws-mp-row">
        <div class="ws-mp-head"><span class="ws-mp-img" style="background-image:url(${IMG})"></span><b class="ws-mp-nm">Magic Monster</b><button class="ws-mp-act on">🎤 Voice</button><button class="ws-mp-act danger">🗑</button></div>
        <div class="ws-mp-voice"><div class="ws-vp">${chips(FEM)}</div><button class="wb-btn ws-mp-save">Save voice</button></div>
      </div>
      <div class="ws-mp-row"><div class="ws-mp-head"><span class="ws-mp-img" style="background-image:url(${IMG})"></span><b class="ws-mp-nm">Bottle Bot</b><button class="ws-mp-act">🎤 Voice</button><button class="ws-mp-act danger">🗑</button></div></div>
      <div class="ws-mp-row">
        <div class="ws-mp-head"><span class="ws-mp-img" style="background-image:url(${IMG})"></span><b class="ws-mp-nm">Spark</b><button class="ws-mp-act">🎤 Voice</button><button class="ws-mp-act danger">Delete</button></div>
        <p class="ws-mp-warn">Delete Spark? This can't be undone. <button class="ws-mp-undo">Keep</button></p>
      </div>
    </div>
  </div>
</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style><style>${WS}</style>
<style>
body{margin:0;background:#2a2f2c;font-family:Poppins,system-ui,sans-serif}
.mf{max-width:430px;margin:0 auto;padding:14px}
.ws-scrim.mock{position:relative;inset:auto;background:transparent;backdrop-filter:none;display:block;padding:0;margin:0 0 22px}
.lbl{color:#cfe8d8;font:700 12px Poppins;margin:14px 2px 6px}
</style></head><body><div class="mf">
<div class="lbl">FORGE MODAL (create)</div>${forge}
<div class="lbl">MANAGE MODAL (voice editor open on row 1, delete armed on row 3)</div>${manage}
</div></body></html>`;
fs.writeFileSync(REPO + "/public/_preview.html", html);
console.log("wrote forge+manage mock (CSS " + CSS.length + ", WS " + WS.length + ")");
