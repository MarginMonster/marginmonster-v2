/* TEMPORARY internal runner — designs custom MiniMax voices via fal.ai using
 * the server's FAL_KEY (key never leaves Render). Secret-gated, one voice per
 * call. STRIP THIS ROUTE after the voice cast is finalized. */

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

const RUN_SECRET = "em-vd-x9k27qmw84zh51tpva36";

function falHeaders(): Record<string, string> {
  return { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" };
}

async function falQueue(model: string, input: Record<string, unknown>, maxPolls = 60): Promise<any> {
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify(input),
  });
  if (!submit.ok) throw new Error(`fal submit ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const q = (await submit.json()) as { status_url?: string; response_url?: string };
  if (!q.status_url || !q.response_url) throw new Error("fal: no queue urls");
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await fetch(q.status_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
    if (!s.ok) continue;
    const sj = (await s.json()) as { status?: string };
    if (sj.status === "COMPLETED") break;
    if (sj.status === "FAILED" || sj.status === "ERROR") {
      const err = await fetch(q.response_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } })
        .then((r) => r.text()).catch(() => "");
      throw new Error(`fal ${sj.status}: ${err.slice(0, 300)}`);
    }
    if (i === maxPolls - 1) throw new Error("fal: poll timeout");
  }
  const res = await fetch(q.response_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
  if (!res.ok) throw new Error(`fal result ${res.status}`);
  return res.json();
}

export async function action({ request }: ActionFunctionArgs) {
  const body = (await request.json().catch(() => ({}))) as {
    secret?: string; id?: string; prompt?: string; preview_text?: string; tts_text?: string;
  };
  if (body.secret !== RUN_SECRET) return json({ error: "not found" }, { status: 404 });
  if (!process.env.FAL_KEY) return json({ error: "FAL_KEY not set" }, { status: 500 });
  if (!body.id || !body.prompt || !body.preview_text) return json({ error: "id, prompt, preview_text required" }, { status: 400 });

  try {
    // 1) design the voice from the text description
    const design = await falQueue("fal-ai/minimax/voice-design", {
      prompt: body.prompt,
      preview_text: body.preview_text,
    });
    const voiceId: string | undefined = design.custom_voice_id || design.voice_id;
    const previewUrl: string | undefined = design.audio?.url;
    if (!voiceId) return json({ error: "no voice id in design result", raw: design }, { status: 502 });

    // 2) keepalive TTS with the designed voice — locks it permanent AND proves
    // the design->tts handshake; returns the audition mp3 url
    let ttsUrl: string | null = null;
    let ttsError: string | null = null;
    try {
      const tts = await falQueue("fal-ai/minimax/speech-02-hd", {
        text: body.tts_text || body.preview_text,
        voice_setting: { voice_id: voiceId, speed: 1, vol: 1 },
        audio_setting: { sample_rate: "32000", bitrate: "128000", format: "mp3", channel: "1" },
        output_format: "url",
      });
      ttsUrl = tts.audio?.url || null;
    } catch (e) {
      ttsError = (e as Error).message;
    }

    return json({ id: body.id, voiceId, previewUrl, ttsUrl, ttsError });
  } catch (e) {
    return json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function loader() {
  return json({ error: "not found" }, { status: 404 });
}
