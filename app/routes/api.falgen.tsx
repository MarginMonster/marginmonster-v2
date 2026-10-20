/* TEMPORARY dev route — real-engine (fal) i2v sample generator for the avatar
 * motion/realism bake-off (Kling 3 Pro vs Seedance 2.5). Key-gated, model-limited,
 * duration-capped. Spends fal credits only when called with the key. STRIP THIS
 * ROUTE after the samples are chosen (like api.voicedesign.tsx). Non-blocking:
 * submit returns a requestId; poll status separately so no request is held long. */
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { falVideoSubmit, falEnabled } from "../lib/fal-video.server";

const KEY = "falgen-7h2k9x4m-tmp";

export async function action({ request }: ActionFunctionArgs) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (String(body.key || "") !== KEY) return json({ error: "forbidden" }, { status: 403 });
  if (!falEnabled()) return json({ error: "FAL_KEY not set on this host" }, { status: 500 });
  const op = String(body.op || "");
  const model = String(body.model || "");
  if (!/^(fal-ai|bytedance|kwaivgi)\//.test(model)) return json({ error: "bad model" }, { status: 400 });
  const FK = process.env.FAL_KEY as string;
  try {
    if (op === "submit") {
      const id = await falVideoSubmit(model, {
        startImage: String(body.image || ""),
        prompt: String(body.prompt || ""),
        negativePrompt: body.negativePrompt ? String(body.negativePrompt) : undefined,
        durationSec: Math.max(5, Math.min(10, Number(body.durationSec) || 5)),
      });
      return json({ requestId: id });
    }
    if (op === "status") {
      const app = model.split("/").slice(0, 2).join("/");
      const rid = String(body.requestId || "");
      const s = await fetch(`https://queue.fal.run/${app}/requests/${rid}/status`, { headers: { Authorization: `Key ${FK}` } });
      const sj = (await s.json().catch(() => ({}))) as { status?: string };
      if (sj.status !== "COMPLETED") return json({ status: sj.status || "UNKNOWN" });
      const r = await fetch(`https://queue.fal.run/${app}/requests/${rid}`, { headers: { Authorization: `Key ${FK}` } });
      const rj = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      const v = rj.video as { url?: string } | undefined;
      const url = v?.url || (rj.video_url as string) || null;
      // DEBUG: when no url, hand back the raw result keys so we can see Seedance's schema / moderation.
      return json({ status: "COMPLETED", url, raw: url ? undefined : JSON.stringify(rj).slice(0, 600) });
    }
    return json({ error: "bad op" }, { status: 400 });
  } catch (e) {
    return json({ error: String((e as Error).message).slice(0, 300) }, { status: 500 });
  }
}

export const loader = () => json({ ok: false });
