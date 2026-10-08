// Standalone AI Music generator (Creator section) — "describe a track, get a
// song." Mirrors createImage(): validate → run the model → persist → write ONE
// Asset row (type AUDIO) → return its id. Billed at TOKEN_COST.music (10) at
// enqueue in the route; the queue refunds on terminal failure.
import { db } from "../db.server";
import { repPoll } from "./ugc-ad-pipeline.server";
import { persistRemoteAudio } from "./image-generation.server";

// meta/musicgen is a VERSIONED community model — it 404s on the versionless
// /models/{owner}/{name}/predictions endpoint, so it MUST be run via the
// /predictions endpoint with a pinned version. (Verified live: the models
// endpoint returns 404.) Pin bumps are a one-line change.
const MUSICGEN_VERSION = "671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb";

/** Start a musicgen prediction by version. Returns the prediction id. Mirrors
 *  the rate-limit tolerance of the repo's other create helpers. */
async function createMusicgen(input: Record<string, unknown>): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set");
  for (let a = 0; a < 6; a++) {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ version: MUSICGEN_VERSION, input }),
    });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 12_000)); continue; }
    if (!res.ok) throw new Error(`musicgen create ${res.status}: ${(await res.text()).slice(0, 180)}`);
    return ((await res.json()) as { id: string }).id;
  }
  throw new Error("musicgen: rate-limited too long");
}

/** Music models can hand back a bare url, an array, or an object keyed
 *  audio/audio_out/audio_url. repPoll already unwraps string|string[]; this
 *  catches the object shapes too. Returns a url or throws. */
function audioUrlOf(raw: unknown, stage: string): string {
  if (typeof raw === "string" && raw) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  const o = raw as { audio_out?: string; audio?: string | { url?: string }; audio_url?: string } | null;
  const url = o?.audio_out || o?.audio_url || (typeof o?.audio === "string" ? o.audio : o?.audio?.url);
  if (url) return url;
  throw new Error(`[music:${stage}] no audio url in result`);
}

/** Generate a music track from a free-text prompt and persist it as an AUDIO
 *  asset. Returns the new asset id. Throws on total engine failure (→ refund). */
export async function generateMusic(opts: {
  shopId: string;
  prompt: string;
  title?: string;
}): Promise<string> {
  const prompt = (opts.prompt || "").trim();
  if (!prompt) throw new Error("Describe the music you want.");

  // meta/musicgen — text → instrumental track, prompt-native, no lyrics, cheap.
  // stereo-large is pure text-to-music (no melody conditioning); a second config
  // (plain large) covers a schema/capacity hiccup. Total failure → queue refund.
  const attempts: Record<string, unknown>[] = [
    { prompt, duration: 12, output_format: "mp3", normalization_strategy: "peak", model_version: "stereo-large" },
    { prompt, duration: 10, output_format: "mp3", model_version: "large" },
  ];
  const errors: string[] = [];
  let remoteUrl = "";
  for (const input of attempts) {
    try {
      const id = await createMusicgen(input);
      const raw = (await repPoll(id, 5 * 60_000, "music")) as unknown;
      remoteUrl = audioUrlOf(raw, "musicgen");
      break;
    } catch (e) {
      errors.push((e as Error).message.slice(0, 180));
    }
  }
  if (!remoteUrl) throw new Error(`[music] every engine failed: ${errors.join(" | ")}`);

  const audioUrl = await persistRemoteAudio(remoteUrl);
  const title = (opts.title || prompt).slice(0, 80);
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "AUDIO",
      status: "PENDING",
      title,
      bodyJson: JSON.stringify({ audioUrl, prompt, engine: "musicgen" }),
      metaJson: JSON.stringify({ kind: "song", section: "creator", engine: "musicgen" }),
    },
  });
  return asset.id;
}
