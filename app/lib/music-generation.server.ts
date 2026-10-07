// Standalone AI Music generator (Creator section) — "describe a track, get a
// song." Mirrors the createImage() shape: validate → run the model → persist →
// write ONE Asset row (type AUDIO) → return its id. Billed at TOKEN_COST.music
// (10) at enqueue in the route; the queue refunds on terminal failure.
//
// Distinct from the anthem/jingle SINGING VIDEO (jingle-ad-pipeline), which is
// a 150-token VIDEO_AD with lyrics + lipsync. This is audio-only, prompt-native
// and cheap (musicgen COGS ~$0.05-0.15).
import { db } from "../db.server";
import { repCreate, repPoll } from "./ugc-ad-pipeline.server";
import { persistRemoteAudio } from "./image-generation.server";

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

  // Engine chain — meta/musicgen (text → instrumental track, prompt-native, no
  // lyrics, cheap). Two configs so a schema/capacity hiccup on the first still
  // renders; total failure throws and the queue refunds the merchant.
  const attempts: { input: Record<string, unknown>; engine: string }[] = [
    { input: { prompt, duration: 15, output_format: "mp3", normalization_strategy: "peak" }, engine: "musicgen" },
    { input: { prompt, duration: 12, output_format: "mp3" }, engine: "musicgen" },
  ];
  const errors: string[] = [];
  let remoteUrl = "";
  let engine = "";
  for (const a of attempts) {
    try {
      const id = await repCreate("meta/musicgen", a.input);
      const raw = (await repPoll(id, 5 * 60_000, "music")) as unknown;
      remoteUrl = audioUrlOf(raw, a.engine);
      engine = a.engine;
      break;
    } catch (e) {
      errors.push((e as Error).message.slice(0, 160));
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
      bodyJson: JSON.stringify({ audioUrl, prompt, engine }),
      metaJson: JSON.stringify({ kind: "song", section: "creator", engine }),
    },
  });
  return asset.id;
}
