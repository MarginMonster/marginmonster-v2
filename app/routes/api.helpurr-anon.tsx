/* Anonymous landing chat with Helpurr — the no-signup front door.
 *
 * TEXT ONLY, on purpose: no tools, no generation, no web search. That keeps the
 * cost bounded (pure chat tokens) and removes the free-LLM-proxy abuse surface
 * that an open, account-less sonnet endpoint would otherwise be. The thread is
 * EPHEMERAL and lives entirely on the client — nothing is persisted here; an
 * account is what unlocks saving, multiple chats, and actually MAKING things.
 *
 * Gates: a hard per-IP daily ceiling (the real abuse gate for an open endpoint)
 * plus a soft per-thread turn cap that routes an engaged visitor to a free
 * account. Sonnet-5 so the very first impression is the real Helpurr.
 */
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { anthropicToolLoopStream, type ChatMsg } from "../lib/anthropic.server";
import { rateLimit, clientIp } from "../lib/rate-limit.server";

const ANON_SYSTEM =
  "You are Helpurr — EASYMODE's friendly pixel-cat helper and a sharp, witty creative buddy — meeting someone for the FIRST TIME on the EasyMode landing page (they have NOT signed up). " +
  "EASYMODE turns any idea, product or photo into images, short videos, faceless social clips and music — 'on easy mode' — for creators AND stores. " +
  "VOICE: warm, smart and genuinely conversational — a clever creative partner, not a help widget. Tight by default (a sentence or three); go fuller when they want ideas, a plan or a real answer, in plain modern language — no fluff, no walls of text. Precise, lightly dry humor; an occasional single well-placed emoji, not every line. React to what they actually said and ask a sharp follow-up when it helps. " +
  "WHAT YOU DO HERE: have a real, genuinely helpful conversation — ideas, honest opinions, feedback, a quick plan, straight answers about EasyMode or about whatever's on their mind. You are good COMPANY first, not a signup funnel. " +
  "THE ONE LIMIT: in this free preview chat you CANNOT actually generate an image, video or song — that's what EasyMode itself does. When they clearly want to MAKE something (or ask you to), be warm about it: in ONE friendly line, say that's exactly what EasyMode makes and they can start free, no card. Do NOT push signup when they just want to talk, and never twice in a row. " +
  "NEVER invent EasyMode features, prices or facts; if you're unsure, say so plainly. Stay kind and appropriate. Light formatting only: **bold** for a key term, short '- ' bullets for a list — no headings, tables, links or code blocks.";

// ~40 messages/IP/day bounds worst-case cost to pennies and kills the proxy
// play; a real visitor never comes close. ~14 turns/thread is the soft nudge to
// a free account (the client caps sooner, this is the server backstop).
const IP_DAILY_CAP = 40;
const THREAD_TURN_CAP = 14;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, { status: 405 });

  const rl = rateLimit(`helpurranon:${clientIp(request)}`, IP_DAILY_CAP, 24 * 60 * 60_000);
  if (!rl.ok) {
    return json({ capped: true, note: "You've hit today's free preview limit — create a free account to keep chatting (no card needed)." }, { status: 429 });
  }

  let body: { messages?: Array<{ role?: string; content?: string }> };
  try { body = await request.json(); } catch { return json({ error: "bad request" }, { status: 400 }); }

  // Sanitise + bound the thread so nobody can stuff a huge context to run up our
  // cost or smuggle in a different system prompt: user/assistant turns only,
  // trimmed, length-capped, newest ~16 kept.
  const chat: ChatMsg[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    .slice(-16)
    .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 2000).trim() }))
    .filter((m) => m.content.length > 0);
  if (!chat.length || chat[chat.length - 1].role !== "user") {
    return json({ error: "no message" }, { status: 400 });
  }
  if (chat.filter((m) => m.role === "user").length > THREAD_TURN_CAP) {
    return json({ capped: true, note: "Great chat! Create a free account to keep going and save it — no card needed." }, { status: 429 });
  }

  const system = [{ type: "text" as const, text: ANON_SYSTEM, cache_control: { type: "ephemeral" as const } }];
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => { try { controller.enqueue(enc.encode(`data:${JSON.stringify(obj)}\n\n`)); } catch { /* client gone */ } };
      try {
        await anthropicToolLoopStream({
          system,
          messages: chat,
          tools: [],
          runTool: async () => "",
          model: "claude-sonnet-5",
          maxTokens: 700,
          maxRounds: 1,
          webSearchMaxUses: 0,
          onText: (delta) => send({ t: delta }),
        });
        send({ done: true });
      } catch (e) {
        console.error("[helpurr-anon] stream error:", e instanceof Error ? e.message.slice(0, 160) : e);
        send({ error: "Helpurr hit a snag — mind trying that again?" });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform stops proxies buffering; x-accel-buffering flushes through
      // Render's edge so tokens stream live, same as the signed-in chat.
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}

// POST-only streaming endpoint; a GET has nothing to render.
export const loader = () => json({ error: "not found" }, { status: 404 });
