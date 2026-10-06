/* Magic Monster — the AI companion.
 *
 * A small, friendly assistant that lives in the corner of the web app. It knows
 * who it's talking to, roughly where they are, and what EASYMODE does, and it
 * answers in a short, warm, encouraging voice. Backend only: the widget lives in
 * app/routes/web.tsx and POSTs the running conversation here; we prepend a
 * persona + light context and let Haiku (fast + cheap) reply. No actions are
 * taken on the user's behalf yet — it guides, it doesn't click. */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { tokensRemainingLive } from "../lib/tokens.server";
import { resolveTierKey, PLAN_BY_KEY } from "../lib/plan-config";
import { anthropicText } from "../lib/anthropic.server";

const PERSONA =
  "You are Magic Monster — the hype creative sidekick who lives inside EASYMODE. You've got big main-character energy: confident, quick-witted, a little cheeky, and ALWAYS in the user's corner. You genuinely love making scroll-stopping ads and videos and you make the person feel like a creative genius. EASYMODE turns any store's products into image ads and short product videos, 'on easy mode'. " +
  "VOICE: short and punchy — 1 to 3 sentences, max. Talk like a real person who's gassed to help, not a support bot. React to what they actually say. Use the occasional well-placed emoji (not every line). NEVER corporate, never a wall of text, never bullet lists. " +
  "WHAT YOU DO: hype them up, fire off concrete ideas, answer platform questions, and always point to ONE next move. When they're unsure what to make, don't lecture — just pick something for them ('Ooh — Callouts ad on your best seller. Trust me, let's go.'). Don't repeat the exact same suggestion twice in a row; keep it fresh. " +
  "PLATFORM: the Studio makes one image ad or video by hand; Campaigns runs content hands-off on a schedule; the Archive holds everything made; Auto-posting pushes to TikTok/Facebook. Image ads cost 5 tokens, videos more; tokens come with a plan and can be topped up. The ad 'formats' are proven layouts (Callouts, Us-vs-Them, Number Flex, Big Offer, etc.) — the copy is written for the product and a vision check rejects garbled text. " +
  "LIMITS: you can't click or generate for them yet — but tappable buttons appear under your messages to take them straight there, so talk like you're sending them there ('Hitting the Studio for you — pick a product and smash generate 👇'). Never invent features or facts; if unsure, say so warmly. " +
  "Write PLAIN TEXT only — no markdown, asterisks, headings or bullet characters.";

// The buttons that appear under a reply — the buddy's hands. Picked from what the
// person just asked so "let's make an ad" comes with an actual way in.
function suggestActions(lastUserMsg: string): Array<{ label: string; to: string }> {
  const s = lastUserMsg.toLowerCase();
  const acts: Array<{ label: string; to: string }> = [];
  if (/\b(make|create|ad|image|video|poster|callout|offer|generate|start|design|content|studio|idea)\b/.test(s)) acts.push({ label: "✨ Open the Studio", to: "/web/studio" });
  if (/\b(campaign|schedule|auto|hands.?off|set.?and.?forget|ongoing)\b/.test(s)) acts.push({ label: "Set up a Campaign", to: "/web/campaigns" });
  if (/\b(archive|made|history|download|post|share|library)\b/.test(s)) acts.push({ label: "See my Archive", to: "/web/archive" });
  if (/\b(token|plan|price|pricing|upgrade|cost|buy|subscri|trial)\b/.test(s)) acts.push({ label: "Plans & tokens", to: "/web#plans" });
  return acts.slice(0, 2);
}

function contextLine(id: Awaited<ReturnType<typeof getWebIdentity>>, path: string): string {
  const where = /\/studio/.test(path) ? "in the Studio right now"
    : /\/campaigns/.test(path) ? "on the Campaigns page"
    : /\/archive/.test(path) ? "looking at their Archive"
    : /\/connect/.test(path) ? "on the Auto-posting page"
    : "on their dashboard";
  if (!id) return `You're talking to a guest exploring EASYMODE, ${where}.`;
  let plan = "no plan yet (great candidate for a trial)";
  let tokens = 0;
  try {
    const p = id.shop.activePlan;
    const tier = p?.active ? resolveTierKey(p.type) : null;
    plan = tier ? PLAN_BY_KEY[tier].name : plan;
    tokens = tokensRemainingLive(p);
  } catch { /* context is best-effort */ }
  const name = id.account.name?.trim() || id.account.email.split("@")[0];
  return `You're talking to ${name}, level ${id.shop.level}, plan: ${plan}, about ${tokens.toLocaleString()} tokens left, ${where}.`;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ error: "method" }, { status: 405 });
  let body: { messages?: Array<{ role?: string; content?: string }>; path?: string };
  try { body = await request.json(); } catch { return json({ reply: "Hmm, I didn't catch that — try again?" }); }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const path = typeof body.path === "string" ? body.path : "";

  const id = await getWebIdentity(request);
  const convo = messages
    .slice(-10)
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .map((m) => `${m.role === "assistant" ? "Magic Monster" : "User"}: ${(m.content || "").trim().slice(0, 600)}`)
    .join("\n");
  if (!convo) return json({ reply: "Hey! I'm Magic Monster 👾 — what are we making today?" });

  const prompt = `${PERSONA}\n\n${contextLine(id, path)}\n\nConversation so far:\n${convo}\n\nReply as Magic Monster (short and warm):`;
  try {
    const reply = await anthropicText(prompt, { model: "claude-haiku-4-5-20251001", maxTokens: 240 });
    // Belt-and-braces: strip any markdown emphasis the model slips in, since the
    // bubble renders plain text and "**Studio**" would show the asterisks.
    const clean = (reply || "").trim().replace(/\*\*/g, "").replace(/(^|\s)[*_](\S)/g, "$1$2").replace(/(\S)[*_](\s|$)/g, "$1$2");
    const lastUser = [...messages].reverse().find((m) => m.role !== "assistant")?.content || "";
    return json({ reply: clean || "I'm here — tell me what you're working on!", actions: suggestActions(lastUser) });
  } catch {
    // Never leave the chat hanging on an outage.
    return json({ reply: "My brain hiccuped for a sec — mind trying that again?" });
  }
}
