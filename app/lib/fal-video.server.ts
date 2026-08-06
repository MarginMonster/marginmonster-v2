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
  // A designed voice is the presenter's IDENTITY — losing it to one transient
  // 429/5xx makes the avatar sound like a different person, which is exactly
  // how "Tunde sounds like a wiener" happens. Both schema variants used to fire
  // in the same instant, so a rate-limit took them both and the pipeline
  // silently downgraded to a generic stock read. Retry with backoff first.
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, attempt * 4000));
    try {
      return await falTtsOnce(text, voiceId, speed);
    } catch (e) {
      lastErr = (e as Error).message;
      // a genuinely unknown voice_id will never succeed — don't burn 3 tries
      if (/not found|invalid voice|does not exist/i.test(lastErr)) break;
      console.log(`[fal:tts] attempt ${attempt + 1} failed for ${voiceId}: ${lastErr.slice(0, 160)}`);
    }
  }
  throw new Error(`fal tts failed after retries: ${lastErr}`);
}

async function falTtsOnce(text: string, voiceId: string, speed: number): Promise<string> {
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

/** Handle on a submitted (i.e. ALREADY BILLABLE) fal queue job. Submit and poll
 *  are separate so the caller can CHECKPOINT this before it starts waiting: a
 *  restart during the ~10 min poll used to abandon a fully-paid ~$1.50 render
 *  and pay for a brand-new one on the next attempt. */
export interface FalQueueHandle {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

/** Submit a portrait + narration for lip-sync. Takes HOSTED urls — fal routes
 *  this model to HeyGen's servers, which fetch the inputs by URL (data URIs
 *  bounce; that was the first live failure). Returns the queue handle; the
 *  render is running (and being billed) from this point on. */
export async function submitAvatar(imageUrl: string, audioUrl: string): Promise<FalQueueHandle> {
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
  if (!q.status_url || !q.response_url) throw new Error("fal: no status/response url");
  return { requestId: q.request_id || "", statusUrl: q.status_url, responseUrl: q.response_url };
}

/** fal's queue endpoints are addressable from the request id alone (the path
 *  keys off owner/app, not the full model subpath), so a resume that only has
 *  the checkpointed id can still re-attach. */
export function falQueueHandleFor(requestId: string): FalQueueHandle {
  const app = MODEL.split("/").slice(0, 2).join("/"); // "fal-ai/heygen"
  return {
    requestId,
    statusUrl: `https://queue.fal.run/${app}/requests/${requestId}/status`,
    responseUrl: `https://queue.fal.run/${app}/requests/${requestId}`,
  };
}

/** Wait on an already-submitted render (~10 min ceiling) and return the output
 *  video URL, or throw so the pipeline falls through to omni-human/kling. Safe
 *  to call on a re-attach: fal keeps the result for a completed request. */
export async function pollAvatar(h: FalQueueHandle): Promise<string> {
  if (!falEnabled()) throw new Error("FAL_KEY not set");
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await fetch(h.statusUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
    if (!s.ok) continue;
    const sj = (await s.json()) as { status?: string };
    if (sj.status === "COMPLETED") break;
    if (sj.status === "FAILED" || sj.status === "ERROR") {
      // pull the real failure detail so it lands in the checkpoint/logs
      const errBody = await fetch(h.responseUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } })
        .then((r) => r.text()).catch(() => "");
      throw new Error(`fal ${sj.status}: ${errBody.slice(0, 200)}`);
    }
    if (i === 119) throw new Error("fal: poll timeout");
  }

  const res = await fetch(h.responseUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
  if (!res.ok) throw new Error(`fal result ${res.status}`);
  const rj = (await res.json()) as { video?: { url?: string } };
  const url = rj.video?.url;
  if (!url) throw new Error("fal: no video url in result");
  return url;
}

/** Submit + poll in one call. `onSubmit` fires the moment the render is live so
 *  callers can checkpoint the request id BEFORE the long wait. */
export async function animateAvatar(
  imageUrl: string,
  audioUrl: string,
  onSubmit?: (h: FalQueueHandle) => void | Promise<void>
): Promise<string> {
  const h = await submitAvatar(imageUrl, audioUrl);
  if (onSubmit) await onSubmit(h);
  return pollAvatar(h);
}

/* ---- Generic fal image-to-video ------------------------------------------
 * Kling's current tiers (2.6 pro especially) are published on fal but not on
 * Replicate, and a same-keyframe bake-off across eight engines put 2.6 pro
 * clearly ahead for the job this product actually does: a real character
 * holding a real product and moving like a person. Submit/poll are split so a
 * prediction can be checkpointed and re-attached instead of re-bought. */

/** Submit an image-to-video job. Returns the request id; poll it with
 *  falVideoPoll(model, id). */
export async function falVideoSubmit(
  model: string,
  opts: { startImage: string; prompt: string; negativePrompt?: string; durationSec?: number }
): Promise<string> {
  if (!falEnabled()) throw new Error("FAL_KEY not set");
  const body: Record<string, unknown> = /veo/.test(model)
    ? { prompt: opts.prompt, image_url: opts.startImage, aspect_ratio: "9:16" }
    : {
        prompt: opts.prompt,
        image_url: opts.startImage,
        duration: String(opts.durationSec ?? 5),
        negative_prompt: opts.negativePrompt
          || "object disappearing, product vanishing, flickering, morphing, distortion, extra fingers, deformed hands, text, watermark",
      };
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST", headers: headers(), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fal video submit ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { request_id?: string };
  if (!j.request_id) throw new Error("fal video: no request id");
  return j.request_id;
}

/** Wait on a fal image-to-video job and return the output URL. Safe on a
 *  re-attach — fal keeps completed results. */
export async function falVideoPoll(model: string, requestId: string, maxMs = 12 * 60_000): Promise<string> {
  if (!falEnabled()) throw new Error("FAL_KEY not set");
  const app = model.split("/").slice(0, 2).join("/");
  const statusUrl = `https://queue.fal.run/${app}/requests/${requestId}/status`;
  const responseUrl = `https://queue.fal.run/${app}/requests/${requestId}`;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await fetch(statusUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
    if (!s.ok) continue; // a bad poll is not a failed prediction
    const sj = (await s.json()) as { status?: string };
    if (sj.status === "COMPLETED") break;
    if (sj.status === "FAILED" || sj.status === "ERROR") throw new Error(`fal video ${requestId}: failed in queue`);
  }
  const r = await fetch(responseUrl, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
  if (!r.ok) throw new Error(`fal video result ${r.status}`);
  const rj = (await r.json()) as { video?: { url?: string }; video_url?: string };
  const url = rj.video?.url || rj.video_url;
  if (!url) throw new Error("fal video: no output url");
  return url;
}
