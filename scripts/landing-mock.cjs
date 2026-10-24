/* Mock the landing PRICING section + the new Creator plan callout with the real
 * _index.tsx CSS, to eyeball the card before deploy. */
const fs = require("fs");
const REPO = "C:/Users/Magic/Downloads/Wholesalesite/marginmonster-remix";
const CSS = (fs.readFileSync(REPO + "/app/routes/_index.tsx", "utf8").match(/const CSS = `([\s\S]*?)`;/) || [])[1] || "";

const coin = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.6v8.8M9.7 9.9h3.5a1.9 1.9 0 0 1 0 3.8h-3.5"/></svg>`;
const card = (name, price, yr, tok, feats, feat) => `
<div class="lz-price-card${feat ? " feat" : ""}">
  ${feat ? '<span class="lz-price-ribbon">Most popular</span>' : ""}
  <div class="lz-price-name">${name}</div>
  <div class="lz-price-amt">$${price}<small>/mo</small></div>
  <div class="lz-price-alt">or $${yr}/yr — 2 months free</div>
  <div class="lz-price-tok">${coin}<span>${tok} tokens / month</span></div>
  <ul>${feats.map((f) => `<li>${f}</li>`).join("")}</ul>
  <a class="lz-price-cta" href="#">Start free →</a>
</div>`;

const grid = card("Starter", 19, 190, 300, ["AI image ads built on famous ad formats", "SEO articles, ready to paste", "Auto-posted to TikTok, IG & Facebook", "AI product listings & ad copy"], false)
  + card("Studio", 39, 390, 900, ["Everything in Starter — plus EVERY video generator", "Avatar AI & Product Highlight", "Anthem + all 8 Cartoon styles", "Campaign Autopilot"], true)
  + card("Legend", 69, 690, "1,600", ["Every generator, nearly 2× the tokens", "Best price per generation", "Biggest Campaign Autopilot mixes", "Campaign discount on token costs"], false);

const creator = `
<div class="lz-creatorplan">
  <div class="lz-cp-main">
    <span class="lz-cp-tag">No store? No problem.</span>
    <h3>Just here to create?</h3>
    <p>Make AI videos, images, faceless social clips and music — all from a prompt. No store, no marketing plan needed. For about half the people here, this is the whole point.</p>
    <ul class="lz-cp-feats">
      <li>AI videos — short clips, faceless social &amp; cartoons</li>
      <li>Image generator + photo editor</li>
      <li>AI music from a prompt</li>
      <li>Run low? Top up with token packs anytime</li>
    </ul>
  </div>
  <div class="lz-cp-buy">
    <div class="lz-cp-price">$6.99<small>/mo</small></div>
    <div class="lz-cp-tok">500 tokens / mo</div>
    <a class="lz-price-cta" href="#">Start creating →</a>
  </div>
</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style></head>
<body><div class="lz"><section class="lz-price" id="pricing">
  <span class="lz-eyebrow">Pricing</span>
  <h2>Three plans. Each unlocks more firepower.</h2>
  <p class="lz-show-sub">Your plan unlocks the generators; monthly tokens meter how much you make. Top up any time.</p>
  <div class="lz-price-grid">${grid}</div>
  <div class="lz-price-note">Every plan starts with a 7-day free trial. Cancel anytime.</div>
  ${creator}
</section></div></body></html>`;
fs.writeFileSync(REPO + "/public/_preview.html", html);
console.log("wrote landing pricing mock (CSS " + CSS.length + ")");
