/* Mock the landing anon-chat section (empty state + a sample conversation) with
 * the real _index.tsx CSS, to eyeball the chat UI before deploy. Static — the
 * streaming/fetch doesn't run; this is a layout/style check. */
const fs = require("fs");
const REPO = "C:/Users/Magic/Downloads/Wholesalesite/marginmonster-remix";
const CSS = (fs.readFileSync(REPO + "/app/routes/_index.tsx", "utf8").match(/const CSS = `([\s\S]*?)`;/) || [])[1] || "";
const AVA = "/helpurr-head.png?v=4";

const empty = `
<section class="lz-chat">
  <span class="lz-eyebrow">Meet Helpurr</span>
  <h2>Chat free. No signup.</h2>
  <p class="lz-show-sub">Your AI creative buddy — ask anything, brainstorm, plan a post. When you want to actually make it, a free account takes two seconds.</p>
  <div class="lz-chatbox">
    <div class="lz-chat-stream">
      <div class="lz-chat-empty">
        <span class="lz-chat-ava"><img src="${AVA}" alt="Helpurr"></span>
        <p>Hey — I'm Helpurr. 🐾 What are you working on? Ask me anything, or tell me what you'd love to make.</p>
        <div class="lz-chat-chips">
          <button type="button">Give me a TikTok idea for my product</button>
          <button type="button">Write me a punchy ad caption</button>
          <button type="button">What should I post this week?</button>
        </div>
      </div>
    </div>
    <div class="lz-chat-in"><input placeholder="Message Helpurr…"><button type="button"><span class="lz-arr">→</span></button></div>
    <div class="lz-chat-foot">Free preview · <a href="#">Sign up</a> to save chats, start new ones &amp; make images</div>
  </div>
</section>`;

const cmsg = (role, html, ava) => `<div class="lz-cmsg ${role}">${role === "assistant" && ava ? `<span class="lz-chat-ava sm"><img src="${AVA}" alt=""></span>` : ""}<span class="lz-cmsg-tx">${html}</span></div>`;
const convo = `
<section class="lz-chat">
  <div class="lz-chatbox">
    <div class="lz-chat-stream">
      ${cmsg("user", "Give me a TikTok idea for my product")}
      ${cmsg("assistant", "Love it. Try a <b>3-second problem→product hook</b>: open on the annoying moment, cut to your product solving it, end on the price. Works because the scroll-stopper is the problem, not the pitch. Want a script?", true)}
      ${cmsg("user", "Can you make the video for me?")}
      ${cmsg("assistant", "That's exactly what EasyMode makes — you can start free, no card needed. 🐾", true)}
    </div>
    <div class="lz-chat-cap">
      <p>Loving it? Create a free account to keep chatting, save this &amp; start making — no card needed.</p>
      <a class="lz-navcta" href="#">Create a free account →</a>
    </div>
    <div class="lz-chat-foot">Free preview · <a href="#">Sign up</a> to save chats, start new ones &amp; make images</div>
  </div>
</section>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${CSS}</style></head><body><div class="lz">${empty}${convo}</div></body></html>`;
fs.writeFileSync(REPO + "/public/_preview.html", html);
console.log("wrote landing chat mock (CSS " + CSS.length + ")");
