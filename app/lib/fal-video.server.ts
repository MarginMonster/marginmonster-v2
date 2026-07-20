/* Premium talking-avatar engine via fal.ai — HeyGen Avatar 4 (image-to-video).
 * Self-serve: sign up at fal.ai, add credits, drop FAL_KEY in the env and this
 * lights up. $0.10/output second (~$1.50 per 15s ad — cheaper than omni-human,
 * far more realistic). Takes our EXACT existing inputs (flux portrait + MiniMax
 * TTS mp3) so it slots straight into the pipeline where omni-human was.
 *
 * Provider-neutral surface: swapping to another engine only touches this file.
 * Env-gated — no key = pipeline uses omni-human/kling exactly as before. */

const MODEL = "fal-ai/heygen/avatar4/image-to-video";

export function falEnabled(): boolean {
  return !!process.env.FAL_KEY;
}

function headers(): Record<string, string> {
  return { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" };
}

/** TTS through fal's MiniMax speech-02-hd — REQUIRED for custom designed
 *  voices (ttv-voice-*): they live on the fal MiniMax account and do not
 *  resolve on Replicate's. Returns a hosted mp3 url. Tries the full schema,
 *  then a minimal variant (fal has 422'd on audio_setting before). */
export async function falTts(text: string, voiceId: string, speed = 1): Promise<string> {
  if (!falEnabled()) throw new Error("FAL_KEY not set");
  const variants: Record<string, unknown>[] = [
    {
      text,
      voice_setting: { voice_id: voiceId, speed, vol: 1 },
      audio_setting: { sample_rate: "32000", bitrate: "128000", format: "mp3", channel: "1" },
      output_format: "url",
    },
    { text, voice_setting: { voice_id: voiceId, speed, vol: 1 }, output_format: "url" },
  ];
  let lastErr = "";
  for (const input of variants) {
    try {
      const submit = await fetch("https://queue.fal.run/fal-ai/minimax/speech-02-hd", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(input),
      });
      if (!submit.ok) throw new Error(`fal tts submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
      const q = (await submit.json()) as { status_url?: string; response_url?: string };
      if (!q.status_url || !q.response_url) throw new Error("fal tts: no queue urls");
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await fetch(q.status_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
        if (!s.ok) continue;
        const sj = (await s.json()) as { status?: string };
        if (sj.status === "COMPLETED") break;
        if (sj.status === "FAILED" || sj.status === "ERROR") throw new Error(`fal tts ${sj.status}`);
        if (i === 59) throw new Error("fal tts: poll timeout");
      }
      const res = await fetch(q.response_url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
      if (!res.ok) throw new Error(`fal tts result ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const rj = (await res.json()) as { audio?: { url?: string } };
      if (rj.audio?.url) return rj.audio.url;
      throw new Error("fal tts: no audio url");
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new Error(`fal tts failed: ${lastErr}`);
}

/** Animate a portrait into a lip-synced talking video. Takes HOSTED urls —
 *  fal routes this model to HeyGen's servers, which fetch the inputs by URL
 *  (data URIs bounce; that was the first live failure). Uses the async queue
 *  API since video gen is slow; polls up to ~10 min. Returns the output video
 *  URL, or throws so the pipeline falls through to omni-human/kling. */
export async function animateAvatar(imageUrl: string, audioUrl: string): Promise<string> {
  if (!falEnabled()) throw new Error("FAL_KEY not set");

  const submit = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      image_url: imageUrl,
      audio_url: audioUrl,
      talking_style: "expressive",
      // NATIVE vertical at full res — the default is 16:9 LANDSCAPE 720p, which
      // forced assembly to crop a narrow strip and upscale it (the softness on
      // the first heygen takes). 9:16 1080p = zero crop, zero upscale, same $/s.
      aspect_ratio: "9:16",
      resolution: "1080p",
    }),
  });
  if (!submit.ok) throw new Error(`fal submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const q = (await submit.json()) as { status_url?: string; response_url?: string; request_id?: string };
  const statusUrl = q.status_url;
  const responseUrl = q.response_url;
  if (!statusUrl || !responseUrl) throw new Error("fal: no status/response url");

  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await fetch(statusUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
    if (!s.ok) continue;
    const sj = (await s.json()) as { status?: string };
    if (sj.status === "COMPLETED") break;
    if (sj.status === "FAILED" || sj.status === "ERROR") {
      // pull the real failure detail so it lands in the checkpoint/logs
      const errBody = await fetch(responseUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } })
        .then((r) => r.text()).catch(() => "");
      throw new Error(`fal ${sj.status}: ${errBody.slice(0, 200)}`);
    }
    if (i === 119) throw new Error("fal: poll timeout");
  }

  const res = await fetch(responseUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
  if (!res.ok) throw new Error(`fal result ${res.status}`);
  const rj = (await res.json()) as { video?: { url?: string } };
  const url = rj.video?.url;
  if (!url) throw new Error("fal: no video url in result");
  return url;
}
