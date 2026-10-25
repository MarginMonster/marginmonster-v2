/* Mock Helpurr's "Make it" confirm buttons (the redesigned .mm-make/.mm-make-go)
 * with the real web.tsx CSS, to check the new crafted-pill look vs the old blob. */
const fs = require("fs");
const REPO = "C:/Users/Magic/Downloads/Wholesalesite/marginmonster-remix";
const CSS = (fs.readFileSync(REPO + "/app/routes/web.tsx", "utf8").match(/const CSS = `([\s\S]*?)`;/) || [])[1] || "";

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style>
<style>body{margin:0;background:#2a2f2c;font-family:Poppins,system-ui,sans-serif}
.chat{max-width:400px;margin:0 auto;padding:20px}
.mm-msg{background:#13201A;border:1px solid rgba(231,200,121,.14);border-radius:16px;padding:14px 15px;margin-bottom:14px;color:#EAF4EE;font-size:14px;line-height:1.5;display:flex;flex-direction:column;gap:12px;align-items:flex-start}
.lbl{color:#9fb3a8;font:700 11px Poppins;margin:16px 2px 6px}</style></head>
<body><div class="chat">
  <div class="lbl">FREE image make (gold confirm)</div>
  <div class="mm-msg">
    <span>On the house 🐾 — here's a cozy cabin at sunset coming up.</span>
    <button type="button" class="mm-make mm-make-go"><span>✨ Make this image</span><b>Free →</b></button>
  </div>
  <div class="lbl">PAID make (gold confirm, cost chip)</div>
  <div class="mm-msg">
    <span>Want me to make an ad for your Blue Ceramic Mug? One tap:</span>
    <button type="button" class="mm-make mm-make-go"><span>✨ Make an ad for Blue Ceramic Mug</span><b>5 tokens →</b></button>
  </div>
  <div class="lbl">SUGGESTION (green, opens Studio)</div>
  <div class="mm-msg">
    <span>That one's a faceless video — I'll set it up in the Studio for you.</span>
    <button type="button" class="mm-make"><span>✨ Set up a faceless video</span><b>→</b></button>
  </div>
  <div class="lbl">MULTI make (queue + Make all)</div>
  <div class="mm-msg">
    <span>I can whip up all three at once:</span>
    <div class="mm-makeq">
      <ul class="mm-makeq-list"><li>Image ad — Blue Mug</li><li>Image ad — Green Bottle</li><li>Image ad — Travel Tumbler</li></ul>
      <button type="button" class="mm-make mm-make-go"><span>✨ Make all 3</span><b>15 tokens →</b></button>
    </div>
  </div>
</div></body></html>`;
fs.writeFileSync(REPO + "/public/_preview.html", html);
console.log("wrote make-button mock (CSS " + CSS.length + ")");
