// "My own voice" — a merchant records (or uploads) a short sample of their voice and gets a voice their
// custom presenters can speak with, everywhere a presenter speaks.
//
// Deliberately small: a clone belongs to the SHOP and shows up in the EXISTING voice picker next to the
// stock voices; choosing it stores its id in CustomAvatar.voiceId exactly like a stock voice, and
// castFor() already speaks whatever id is there. Nothing else in the app has to know a voice is a clone
// — except the two places that would otherwise silently swap it for a stock voice.
//
// Provider: Replicate's official `minimax/voice-cloning` (verified against the API 2026-11-16):
//   in  { voice_file (MP3/M4A/WAV, 10 s–5 min, <20 MB), model, need_noise_reduction, need_volume_normalization }
//   out { voice_id, preview, model }   — $3 per clone
// The returned voice_id is spoken by Replicate's `minimax/speech-02-hd|turbo`, the app's TTS for
// custom presenters. (It does NOT exist on fal's MiniMax account, where the stock cast's designed
// `ttv-` voices live.)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { repCreate, repPoll, download, runFfmpeg, ffprobeDuration } from "./ugc-ad-pipeline.server";
import { mirrorRender } from "./object-storage.server";
import { capabilitiesFor } from "./capabilities.server";
import { isAdminEmail } from "./admin.server";
import { AVATAR_VOICE_IDS, DEFAULT_AVATAR_VOICE, VOICE_SAMPLE_TEXT } from "./avatar-voice-catalog";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const rid = () => crypto.randomBytes(8).toString("hex");

/** Who may CREATE a voice right now — the one switch. Gated like the presenter forge (an active plan
 *  with the video capability), and — because a clone is a real $3 provider charge with no merchant price
 *  set yet — admin accounts only until the owner prices it. Existing voices keep working for everyone;
 *  this only governs making new ones. */
export function canCloneVoice(account: { email?: string | null }, shop: { activePlan?: Parameters<typeof capabilitiesFor>[0] }): boolean {
  if (!shop.activePlan?.active) return false;
  if (!capabilitiesFor(shop.activePlan).has("video")) return false;
  return isAdminEmail(account.email);
}

/** A shop may keep this many cloned voices (each one is a real $3 provider charge). */
export const MAX_VOICE_CLONES = 5;
/** MiniMax needs 10 s; ask for a little more so a breath at either end doesn't sink it. */
export const MIN_SAMPLE_SECONDS = 12;
const MAX_SAMPLE_SECONDS = 180;
const STALE_MS = 12 * 60_000; // a clone still "cloning" after this died with a restart

export type MyVoice = { id: string; voiceId: string; label: string; gender: "f" | "m"; preview: string };
export type VoiceCloneState = { id: string; status: "cloning" | "ready" | "failed"; error: string | null; voice: MyVoice | null };

/** Fields the merchant sees for a row — a public preview URL, never the files' disk paths. */
function toMyVoice(r: { id: string; voiceId: string | null; label: string; gender: string; previewFile: string | null }): MyVoice | null {
  if (!r.voiceId) return null;
  return { id: r.id, voiceId: r.voiceId, label: r.label, gender: r.gender === "f" ? "f" : "m", preview: r.previewFile ? `/renders/${r.previewFile}` : "" };
}

/** This shop's finished voices, newest first — what the voice picker lists under "My voices". */
export async function shopVoiceClones(shopId: string): Promise<MyVoice[]> {
  const rows = await db.voiceClone.findMany({ where: { shopId, status: "ready" }, orderBy: { createdAt: "desc" } });
  return rows.map(toMyVoice).filter((v): v is MyVoice => !!v);
}

/** The voice a presenter may be saved with: a stock catalog voice, or one of THIS shop's own clones.
 *  Anything else (a stale id, another shop's voice) falls back to the gender default — the same promise
 *  safeVoiceId() made, widened to the shop's own voices. */
export async function resolveVoiceChoice(shopId: string, id: string | null | undefined, gender: "f" | "m"): Promise<string> {
  const want = (id || "").trim();
  if (want && AVATAR_VOICE_IDS.has(want)) return want;
  if (want) {
    const mine = await db.voiceClone.findFirst({ where: { shopId, voiceId: want, status: "ready" }, select: { id: true } });
    if (mine) return want;
  }
  return DEFAULT_AVATAR_VOICE[gender];
}

/** The narrator pickers (faceless videos, channels) carry one of the shop's own voices as
 *  "own:<voiceId>" next to the four stock keys. Returns the voice id when it is STILL one of this
 *  shop's ready voices — checked at render, because a channel keeps posting long after the voice was
 *  picked — else null, and the caller falls back to a stock narrator. */
export const OWN_VOICE_KEY = "own:";
export async function ownNarratorVoice(shopId: string, voiceKey: string | null | undefined): Promise<string | null> {
  const key = (voiceKey || "").trim();
  if (!key.startsWith(OWN_VOICE_KEY)) return null;
  const want = key.slice(OWN_VOICE_KEY.length);
  if (!want) return null;
  const mine = await db.voiceClone.findFirst({ where: { shopId, voiceId: want, status: "ready" }, select: { voiceId: true } });
  return mine?.voiceId || null;
}

/** Poll target for the picker while a clone is being made. Shop-scoped. */
export async function voiceCloneState(shopId: string, id: string): Promise<VoiceCloneState | null> {
  const r = await db.voiceClone.findFirst({ where: { id, shopId } });
  if (!r) return null;
  // The work runs in this process; a deploy or restart mid-clone leaves the row "cloning" forever.
  if (r.status === "cloning" && Date.now() - r.createdAt.getTime() > STALE_MS) {
    await db.voiceClone.update({ where: { id: r.id }, data: { status: "failed", error: "interrupted" } }).catch(() => null);
    return { id: r.id, status: "failed", error: "interrupted", voice: null };
  }
  return { id: r.id, status: r.status === "ready" ? "ready" : r.status === "failed" ? "failed" : "cloning", error: r.error, voice: r.status === "ready" ? toMyVoice(r) : null };
}

/** Turn whatever the browser recorded or the merchant uploaded (webm/ogg from MediaRecorder, mp4/m4a
 *  from Safari, mp3, wav…) into the clean mono MP3 the cloning model accepts, and report its length.
 *  Returns the file NAME inside /renders. Throws a merchant-readable message when it's unusable. */
async function prepareSample(buf: Buffer): Promise<{ name: string; seconds: number }> {
  fs.mkdirSync(RENDERS(), { recursive: true });
  const raw = path.join(RENDERS(), `voiceraw-${rid()}.bin`);
  const name = `voicesrc-${rid()}.mp3`;
  const out = path.join(RENDERS(), name);
  fs.writeFileSync(raw, buf);
  try {
    // mono 44.1 kHz, trimmed to the model's comfortable maximum, levels evened out (a quiet phone
    // recording clones noticeably worse than a normalised one)
    const r = await runFfmpeg(["-y", "-i", raw, "-vn", "-ac", "1", "-ar", "44100", "-t", String(MAX_SAMPLE_SECONDS),
      "-af", "highpass=f=70,loudnorm=I=-18:TP=-2:LRA=11", "-c:a", "libmp3lame", "-b:a", "160k", out]);
    if (r.status !== 0 || !fs.existsSync(out)) throw new Error("That file couldn't be read as audio — try an MP3, M4A or WAV, or record it here.");
    let seconds = 0;
    try { seconds = ffprobeDuration(out); } catch { seconds = 0; }
    if (!(seconds >= MIN_SAMPLE_SECONDS)) {
      try { fs.rmSync(out, { force: true }); } catch { /* nothing to clean */ }
      throw new Error(`That's only ${Math.max(0, Math.round(seconds))} seconds — we need at least ${MIN_SAMPLE_SECONDS} seconds of you talking.`);
    }
    return { name, seconds };
  } finally {
    try { fs.rmSync(raw, { force: true }); } catch { /* best-effort */ }
  }
}

/** The background half: clone, speak one line with the new voice (that line is the picker's ▶ preview,
 *  and a real TTS call is also what stops MiniMax reaping an unused voice after 7 days), mark ready. */
async function runClone(rowId: string, sampleName: string, base: string): Promise<void> {
  try {
    const out = (await repPoll(await repCreate("minimax/voice-cloning", {
      voice_file: `${base}/renders/${sampleName}`,
      model: "speech-02-hd",
      need_noise_reduction: true,
      need_volume_normalization: true,
    }), 8 * 60_000, "voice-clone")) as unknown as { voice_id?: string } | null;
    const voiceId = out && typeof out === "object" ? String(out.voice_id || "") : "";
    if (!voiceId) throw new Error("the voice model returned no voice");

    let previewFile: string | null = null;
    try {
      const url = await repPoll(await repCreate("minimax/speech-02-hd", { text: VOICE_SAMPLE_TEXT, voice_id: voiceId, emotion: "happy" }), 3 * 60_000, "voice-clone-preview");
      if (typeof url === "string" && /^https?:\/\//.test(url)) {
        previewFile = `voiceprev-${rid()}.mp3`;
        await download(url, path.join(RENDERS(), previewFile));
        try { await mirrorRender(previewFile, fs.readFileSync(path.join(RENDERS(), previewFile))); } catch { /* non-fatal */ }
      }
    } catch (e) {
      // the voice exists and is usable — a missing preview only costs the ▶ button
      console.error(`[voice-clone] preview line failed for ${rowId}: ${e instanceof Error ? e.message.slice(0, 140) : e}`);
    }
    await db.voiceClone.update({ where: { id: rowId }, data: { status: "ready", voiceId, previewFile, error: null } });
    console.log(`[voice-clone] ${rowId} ready`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[voice-clone] ${rowId} failed: ${msg.slice(0, 200)}`);
    await db.voiceClone.update({ where: { id: rowId }, data: { status: "failed", error: msg.slice(0, 300) } }).catch(() => null);
  }
}

/** Start a clone from an uploaded / recorded sample. Validates and converts the audio in-request (fast,
 *  so a bad file gets an immediate, readable answer), then clones in the background and returns the row
 *  id for the picker to poll — the provider call can outlast a request. `consent` MUST be true: the
 *  merchant has confirmed the voice is theirs or that they have the speaker's permission. */
export async function startVoiceClone(opts: {
  shopId: string; audio: Buffer; label?: string; gender?: string; consent: boolean; base: string;
}): Promise<{ id: string; seconds: number }> {
  if (!opts.consent) throw new Error("Confirm it's your voice (or that you have permission) first.");
  if (!opts.base) throw new Error("Voice cloning isn't available right now.");
  const [ready, running] = await Promise.all([
    db.voiceClone.count({ where: { shopId: opts.shopId, status: "ready" } }),
    db.voiceClone.count({ where: { shopId: opts.shopId, status: "cloning", createdAt: { gte: new Date(Date.now() - STALE_MS) } } }),
  ]);
  if (running > 0) throw new Error("Your last voice is still being made — give it a minute.");
  if (ready >= MAX_VOICE_CLONES) throw new Error(`You already have ${MAX_VOICE_CLONES} voices — remove one to add another.`);

  const sample = await prepareSample(opts.audio);
  try { await mirrorRender(sample.name, fs.readFileSync(path.join(RENDERS(), sample.name))); } catch { /* non-fatal */ }
  const row = await db.voiceClone.create({
    data: {
      shopId: opts.shopId,
      label: (opts.label || "").trim().slice(0, 30) || "My voice",
      gender: opts.gender === "f" ? "f" : "m",
      sampleFile: sample.name,
      consentAt: new Date(),
    },
  });
  void runClone(row.id, sample.name, opts.base);
  return { id: row.id, seconds: Math.round(sample.seconds) };
}

/** Remove one of the shop's voices: the row, its files, and any presenter or channel still using it
 *  goes back to the stock default for its gender (so nothing is left pointing at a voice that no
 *  longer exists). */
export async function deleteVoiceClone(shopId: string, id: string): Promise<boolean> {
  const row = await db.voiceClone.findFirst({ where: { id, shopId } });
  if (!row) return false;
  if (row.voiceId) {
    const users = await db.customAvatar.findMany({ where: { shopId, voiceId: row.voiceId }, select: { id: true, gender: true } });
    for (const u of users) {
      await db.customAvatar.update({ where: { id: u.id }, data: { voiceId: DEFAULT_AVATAR_VOICE[u.gender === "f" ? "f" : "m"] } });
    }
    // a channel narrated by this voice goes back to the stock narrator of the same gender
    await db.creatorSeries.updateMany({
      where: { shopId, voiceKey: `${OWN_VOICE_KEY}${row.voiceId}` },
      data: { voiceKey: row.gender === "f" ? "f-warm" : "m-warm" },
    });
  }
  for (const f of [row.sampleFile, row.previewFile]) {
    if (f) { try { fs.rmSync(path.join(RENDERS(), f), { force: true }); } catch { /* cache file — non-fatal */ } }
  }
  await db.voiceClone.delete({ where: { id: row.id } });
  return true;
}
