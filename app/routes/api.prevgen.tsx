/* TEMPORARY dev route — presenter preview/lip-sync generator WITH SOUND:
 * designed voice (fal MiniMax TTS) -> HeyGen Avatar 4 (styled portrait + audio).
 * Key-gated. Used to regenerate the 21 "Watch {name} speak" previews from the new
 * styled photos. STRIP after. Non-blocking: submit returns requestId, poll status. */
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { falTts, submitAvatar, falQueueHandleFor, falEnabled } from "../lib/fal-video.server";
import AV from "../lib/avatar-voices.json";

const KEY = "prevgen-7h2k9x4m-tmp";

export async function action({ request }: ActionFunctionArgs) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body.key || "") !== KEY) return json({ error: "forbidden" }, { status: 403 });
  if (!falEnabled()) return json({ error: "FAL_KEY not set on this host" }, { status: 500 });
  const op = String(body.op || "");
  const FK = process.env.FAL_KEY as string;
  try {
    if (op === "submit") {
      const id = String(body.id || "");
      const line = String(body.line || "Hi there!").slice(0, 260);
      const v = (AV as Record<string, { voice: string; pitch?: number; speed?: number }>)[id];
      if (!v || !v.voice.startsWith("ttv-")) return json({ error: "no designed voice for " + id }, { status: 400 });
      const origin = new URL(request.url).origin;
      // optional custom seed (e.g. the presenter composited onto an EasyMode set
      // for the preview templates); default to the plain styled portrait.
      const image = body.image ? String(body.image) : `${origin}/avatars/${id}_0.jpg?v=3`;
      const audioUrl = await falTts(line, v.voice, v.speed ?? 1, { emotion: "happy", lang: null, pitch: v.pitch });
      const h = await submitAvatar(image, audioUrl);
      return json({ requestId: h.requestId, audioUrl });
    }
    if (op === "status") {
      const h = falQueueHandleFor(String(body.requestId || ""));
      const s = await fetch(h.statusUrl, { headers: { Authorization: `Key ${FK}` } });
      const sj = (await s.json().catch(() => ({}))) as { status?: string };
      if (sj.status !== "COMPLETED") return json({ status: sj.status || "UNKNOWN" });
      const r = await fetch(h.responseUrl, { headers: { Authorization: `Key ${FK}` } });
      const rj = (await r.json().catch(() => ({}))) as { video?: { url?: string } };
      const url = rj.video?.url || null;
      return json({ status: "COMPLETED", url, raw: url ? undefined : JSON.stringify(rj).slice(0, 500) });
    }
    return json({ error: "bad op" }, { status: 400 });
  } catch (e) {
    return json({ error: String((e as Error).message).slice(0, 300) }, { status: 500 });
  }
}

export const loader = () => json({ ok: false });
