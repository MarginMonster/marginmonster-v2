/* Mock the REDESIGNED landing pricing — Free + Creator lead pair, then the
 * marketing tiers under a "Selling a store?" divider — with the real _index.tsx
 * CSS, to eyeball it before deploy. */
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

const grid = card("Starter", 19, 190, 300, ["AI image ads built on famous formats", "SEO articles, ready to paste", "Auto-posted to TikTok, IG & Facebook", "AI product listings & ad copy"], false)
  + card("Studio", 39, 390, 900, ["Everything in Starter — plus EVERY video generator", "Avatar AI & Product Highlight", "Anthem + all 8 Cartoon styles", "Campaign Autopilot"], true)
  + card("Legend", 69, 690, "1,600", ["Every generator, nearly 2× the tokens", "Best price per generation", "Biggest Campaign Autopilot mixes", "Campaign discount on token costs"], false);

const efeats = (list) => list.map((f) => `<li>${f}</li>`).join("");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style></head>
<body><div class="lz"><section class="lz-price" id="pricing">
  <span class="lz-eyebrow">Pricing</span>
  <h2>Start free. Go unlimited for $6.99.</h2>
  <p class="lz-show-sub">Chat with Helpurr and make a couple of things a day, free — no card. Go unlimited on Creator, or add store marketing anytime.</p>
  <div class="lz-entry">
    <div class="lz-entry-card">
      <div class="lz-entry-name">Free</div>
      <div class="lz-entry-amt">$0<small>forever</small></div>
      <ul class="lz-entry-feats">${efeats(["Chat with Helpurr, free", "2 AI images a day", "Edit your own photos", "No card, no catch"])}</ul>
      <a class="lz-entry-cta ghost" href="#">Start free →</a>
    </div>
    <div class="lz-entry-card feat">
      <span class="lz-price-ribbon">Most popular</span>
      <div class="lz-entry-name">Creator</div>
      <div class="lz-entry-amt">$6.99<small>/mo</small></div>
      <div class="lz-entry-tag">Everything free — now unlimited.</div>
      <ul class="lz-entry-feats">${efeats(["Unlimited AI images", "AI videos, faceless clips & cartoons", "AI music from a prompt", "Top up with token packs anytime"])}</ul>
      <a class="lz-entry-cta" href="#">Start creating →</a>
    </div>
  </div>
  <div class="lz-price-split"><span>Selling a store? Add marketing.</span></div>
  <div class="lz-price-grid">${grid}</div>
  <div class="lz-price-note">Every plan starts with a 7-day free trial. Cancel anytime.</div>
</section></div></body></html>`;
fs.writeFileSync(REPO + "/public/_preview.html", html);
console.log("wrote redesigned landing pricing mock (CSS " + CSS.length + ")");
