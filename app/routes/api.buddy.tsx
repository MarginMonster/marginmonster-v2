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
  "You are Magic Monster, the friendly AI companion that lives inside EASYMODE. " +
  "EASYMODE makes marketing content — scroll-stopping image ads and short product videos — for any store, 'on easy mode'. " +
  "You are warm, upbeat, a little playful, and genuinely helpful, like a creative friend who's great at this. " +
  "RULES: Keep replies SHORT — 1 to 3 sentences, conversational, no corporate tone, no bullet lists unless asked. " +
  "Help people make content, suggest concrete ideas, answer questions about the platform, and cheer them on. " +
  "When someone's unsure what to make, offer ONE specific next step (e.g. 'Head to the Studio, pick a product, and try a Callouts ad first — it's the highest-converting one.'). " +
  "The main places are: the Studio (make a single image ad or video by hand), Campaigns (hands-off content on a schedule), the Archive (everything you've made), and Auto-posting (push to TikTok/Facebook). " +
  "Image ads cost 5 tokens, videos cost more; tokens come with a plan and can be topped up. " +
  "You cannot click buttons or generate things yourself yet — you guide the person to do it. Never invent features or make up facts; if you're not sure, say so warmly and point them to the right place.";

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
    return json({ reply: (reply || "").trim() || "I'm here — tell me what you're working on!" });
  } catch {
    // Never leave the chat hanging on an outage.
    return json({ reply: "My brain hiccuped for a sec — mind trying that again?" });
  }
}
