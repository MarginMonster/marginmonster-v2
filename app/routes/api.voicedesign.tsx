/* TEMPORARY internal runner — designs custom MiniMax voices via fal.ai using
 * the server's FAL_KEY (key never leaves Render). Secret-gated, one voice per
 * call. Modes: design (prompt) or keepalive (voiceId only — TTS an existing
 * designed voice to lock it permanent). STRIP THIS ROUTE after the cast final. */

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
  if (!submit.ok) throw new Error(`submit ${submit.status}: ${(await submit.text()).slice(0, 400)}`);
  const q = (await submit.json()) as { status_url?: string; response_url?: string };
  if (!q.status_url || !q.response_url) throw new Error("no queue urls");
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await fetch(q.status_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
    if (!s.ok) continue;
    const sj = (await s.json()) as { status?: string };
    if (sj.status === "COMPLETED") break;
    if (sj.status === "FAILED" || sj.status === "ERROR") {
      const err = await fetch(q.response_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } })
        .then((r) => r.text()).catch(() => "");
      throw new Error(`${sj.status}: ${err.slice(0, 400)}`);
    }
    if (i === maxPolls - 1) throw new Error("poll timeout");
  }
  const res = await fetch(q.response_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`result ${res.status}: ${bodyText.slice(0, 400)}`);
  return JSON.parse(bodyText);
}

/** TTS with a designed voice — tries schema variants + a propagation delay so a
 *  fresh voice id that hasn't replicated yet doesn't fail the whole call. */
async function ttsWithVoice(voiceId: string, text: string): Promise<{ url: string | null; attempts: string[] }> {
  const attempts: string[] = [];
  const variants: Record<string, unknown>[] = [
    {
      text,
      voice_setting: { voice_id: voiceId, speed: 1, vol: 1 },
      audio_setting: { sample_rate: "32000", bitrate: "128000", format: "mp3", channel: "1" },
      output_format: "url",
    },
    { text, voice_setting: { voice_id: voiceId, speed: 1, vol: 1 }, output_format: "url" },
    { text, voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 0, emotion: "happy" }, output_format: "url" },
  ];
  for (let round = 0; round < 2; round++) {
    for (let v = 0; v < variants.length; v++) {
      try {
        const r = await falQueue("fal-ai/minimax/speech-02-hd", variants[v]);
        const url = r.audio?.url || null;
        if (url) { attempts.push(`round${round}/v${v}: OK`); return { url, attempts }; }
        attempts.push(`round${round}/v${v}: no url in ${JSON.stringify(r).slice(0, 160)}`);
      } catch (e) {
        attempts.push(`round${round}/v${v}: ${(e as Error).message.slice(0, 220)}`);
      }
    }
    // fresh voice ids can lag behind the design call — wait then re-try all
    await new Promise((r) => setTimeout(r, 12000));
  }
  return { url: null, attempts };
}

export async function action({ request }: ActionFunctionArgs) {
  const body = (await request.json().catch(() => ({}))) as {
    secret?: string; id?: string; prompt?: string; preview_text?: string;
    tts_text?: string; voiceId?: string;
    mode?: string; imageUrl?: string; audioUrl?: string; statusUrl?: string; responseUrl?: string;
  };
  if (body.secret !== RUN_SECRET) return json({ error: "not found" }, { status: 404 });
  if (!process.env.FAL_KEY) return json({ error: "FAL_KEY not set" }, { status: 500 });

  try {
    // talking-head sampler modes — HeyGen renders take minutes, so submit
    // returns the fal queue urls and the caller polls via animCheck.
    if (body.mode === "animSubmit") {
      if (!body.imageUrl || !body.audioUrl) return json({ error: "imageUrl, audioUrl required" }, { status: 400 });
      const submit = await fetch("https://queue.fal.run/fal-ai/heygen/avatar4/image-to-video", {
        method: "POST",
        headers: falHeaders(),
        body: JSON.stringify({
          image_url: body.imageUrl,
          audio_url: body.audioUrl,
          talking_style: "expressive",
          aspect_ratio: "9:16",
          resolution: "720p",
        }),
      });
      if (!submit.ok) return json({ error: `submit ${submit.status}: ${(await submit.text()).slice(0, 300)}` }, { status: 502 });
      const q = (await submit.json()) as { status_url?: string; response_url?: string };
      return json({ statusUrl: q.status_url, responseUrl: q.response_url });
    }
    if (body.mode === "animCheck") {
      if (!body.statusUrl || !body.responseUrl) return json({ error: "statusUrl, responseUrl required" }, { status: 400 });
      const s = await fetch(body.statusUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
      const sj = (await s.json().catch(() => ({}))) as { status?: string };
      if (sj.status === "COMPLETED") {
        const res = await fetch(body.responseUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
        const rj = (await res.json().catch(() => ({}))) as { video?: { url?: string } };
        return json({ status: "COMPLETED", videoUrl: rj.video?.url || null });
      }
      return json({ status: sj.status || "UNKNOWN" });
    }

    // keepalive mode: TTS an already-designed voice
    if (body.voiceId) {
      const tts = await ttsWithVoice(body.voiceId, body.tts_text || "Keepalive check, locking this voice in.");
      return json({ id: body.id || null, voiceId: body.voiceId, ttsUrl: tts.url, ttsAttempts: tts.attempts });
    }

    if (!body.id || !body.prompt || !body.preview_text) return json({ error: "id, prompt, preview_text required" }, { status: 400 });

    const design = await falQueue("fal-ai/minimax/voice-design", {
      prompt: body.prompt,
      preview_text: body.preview_text,
    });
    const voiceId: string | undefined = design.custom_voice_id || design.voice_id;
    const previewUrl: string | undefined = design.audio?.url;
    if (!voiceId) return json({ error: "no voice id in design result", raw: design }, { status: 502 });

    const tts = await ttsWithVoice(voiceId, body.tts_text || body.preview_text);
    return json({ id: body.id, voiceId, previewUrl, ttsUrl: tts.url, ttsAttempts: tts.attempts });
  } catch (e) {
    return json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function loader() {
  return json({ error: "not found" }, { status: 404 });
}
