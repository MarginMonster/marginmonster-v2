/* Earworm pipeline — an AI-SUNG ad with early-2000s commercial energy:
 *   1. LYRICS — Claude writes a short, catchy jingle (product name repeated,
 *               tagline close) in the brand's voice
 *   2. SONG   — minimax music-01 sings it (tolerant input variants, then a
 *               bark sing-song fallback) — the jingle IS the ad
 *   3. VISUAL — product keyframe → kling hero-motion clip (flux-dev paints
 *               the scene when there's no photo / service mode)
 *   4. ASSEMBLY — shared ffmpeg assembler: loop the clip under the song,
 *                 burn the lyrics as karaoke-style captions
 * Music models are the newest piece of the stack, so every failure path is
 * graceful: the job errors cleanly and the queue refunds the tokens. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { mirrorRender } from "./object-storage.server";
import {
  animateCreate,
  animatePoll,
  assemble,
  checkpointJob,
  download,
  downloadBuffer,
  ffprobeDuration,
  repCreate,
  repPoll,
  runFfmpeg,
} from "./ugc-ad-pipeline.server";
import { OUTFITS, type Avatar } from "./avatars";
import {
  CARTOON_RECIPES,
  checkpointUrlAlive,
  gateStylizedFrame,
  jobCheckpoints,
  resumablePrediction,
  type CartoonStyleKey,
} from "./cartoon-ad-pipeline.server";
import type { BrandProfile } from "@prisma/client";
import { langDirective } from "./content-lang";
import { withBrandFallback } from "./ad-copy-retry.server";

// EVERY Anthem lands at the same ad length, singer or not — and the cut ends
// on a between-line gap in the vocal (found via silencedetect), never mid-word.
const ANTHEM_SECONDS = 18; // target length; also keeps per-second lipsync billing tight
const ANTHEM_MIN_CUT = 12; // earliest acceptable line-gap cut

/** Where to cut the song: the LAST vocal gap inside the 12–18s window, so the
 *  anthem ends right after a sung line instead of chopping one in half. Falls
 *  back to the hard target when no gap is detectable. Deterministic — the
 *  lipsync trim and the assembly trim compute the same point independently. */
async function smartSongCut(file: string): Promise<number> {
  // ffprobe THROWS on a file it can't read. Uncaught, that escaped assembly and
  // terminal-failed an ad whose song and animation were already paid for — the
  // hard target is a perfectly good cut, so degrade instead of dying.
  let dur: number;
  try {
    dur = ffprobeDuration(file);
  } catch (e) {
    console.error("[anthem] couldn't probe the song — cutting at the target length:", e instanceof Error ? e.message.slice(0, 140) : e);
    return ANTHEM_SECONDS;
  }
  if (dur <= ANTHEM_SECONDS) return dur;
  try {
    const { stderr } = await runFfmpeg(["-i", file, "-af", "silencedetect=noise=-28dB:d=0.22", "-f", "null", "-"]);
    const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
    const inWindow = starts.filter((s) => s >= ANTHEM_MIN_CUT && s <= ANTHEM_SECONDS);
    if (inWindow.length) return Math.min(dur, inWindow[inWindow.length - 1] + 0.15);
  } catch { /* fall through to the hard target */ }
  return ANTHEM_SECONDS;
}

interface JingleAdParams {
  shopId: string;
  brandProfile: BrandProfile;
  productTitle: string;
  productDescription?: string;
  productImageUrl?: string;
  avatarId?: string; // the SINGER — lipsyncs the anthem on camera
  avatarVariant?: number;
  cartoonStyle?: string; // singer redrawn in a cartoon style first (optional)
  videoEngine?: string; // engine-picker key for the product-visual path
  direction?: string; // merchant's custom prompt
  serviceMode?: boolean;
  origin?: string;
  jobId?: string;
  resume?: {
    lyrics?: string;
    songUrl?: string;
    engine?: string; // which music engine actually sang the checkpointed song
    styledUrl?: string; // cartoon-styled singer frame
    omniPredictionId?: string; // re-attach to a live lipsync run — never re-buy it
    talkingUrl?: string;
    singEngine?: string;
    keyframeUrl?: string;
    klingPredictionId?: string; // re-attach to a live animate run — never re-buy it
    animUrl?: string;
  };
}

/** Community models can't use the official-models endpoint repCreate posts
 *  to — they need /v1/predictions with a pinned version hash. */
async function repCreateVersion(version: string, input: Record<string, unknown>): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("[jingle] REPLICATE_API_TOKEN not set");
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ version, input }),
  });
  if (!res.ok) throw new Error(`[jingle] versioned create ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { id: string };
  return j.id;
}

/** Music model outputs vary: bare url string, array, or an object keyed
 *  audio/audio_out/audio_url. Normalize to a url or throw. */
function audioUrlOf(raw: unknown, stage: string): string {
  if (typeof raw === "string" && raw) return raw;
  const o = raw as { audio_out?: string; audio?: string | { url?: string }; audio_url?: string } | null;
  const url = o?.audio_out || o?.audio_url || (typeof o?.audio === "string" ? o.audio : o?.audio?.url);
  if (url) return url;
  throw new Error(`[jingle:${stage}] no audio url in result`);
}

// suno-ai/bark is a community model — pinned to its long-stable version.
const BARK_VERSION = "b76242b40d67c76ab6742e987628a2a9ac019e11d56ab96c4e91ce03b79b2787";

/** Sing the lyrics. Engine chain: minimax music-1.5 (text-to-music with
 *  vocals, no reference audio needed) → music-01 → bark's ♪-wrapped sing-song
 *  read of the hook (lo-fi, but fits the retro-commercial brief). Every step
 *  is schema-drift tolerant; total failure throws and the queue refunds.
 *  The vocal GENDER matches the cast singer — a male presenter lipsyncing a
 *  female vocal (or vice versa) breaks the illusion instantly. */
async function singJingle(
  lyrics: string,
  singerGender?: "f" | "m",
  // The song is the priciest un-idempotent stage in this pipeline and it is
  // BILLED at create: a restart mid-poll must re-attach to the prediction that
  // is already running, never buy a second one.
  resume?: { priorId?: string; priorEngine?: string; save?: (id: string, engine: string) => Promise<void> }
): Promise<{ url: string; engine: string }> {
  const errors: string[] = [];
  if (resume?.priorId) {
    try {
      const raw = (await repPoll(resume.priorId, 6 * 60_000, "jingle-music(resumed)")) as unknown;
      const url = audioUrlOf(raw, "music");
      // An hours-old prediction hands back an already-expired delivery url.
      if (await checkpointUrlAlive(url)) return { url, engine: resume.priorEngine || "minimax-music-1.5" };
      errors.push("resumed song url expired");
    } catch (e) {
      errors.push(`resume: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  const vocalist = singerGender === "m" ? "a clear energetic MALE vocalist (male voice)" : singerGender === "f" ? "a clear energetic FEMALE vocalist (female voice)" : "bright cheerful vocals";
  const style = `upbeat catchy retro TV-commercial jingle, early 2000s advertising energy, sung by ${vocalist}, short and punchy`;
  const attempts: { model: string; input: Record<string, unknown>; engine: string }[] = [
    { model: "minimax/music-1.5", input: { lyrics, prompt: style }, engine: "minimax-music-1.5" },
    { model: "minimax/music-1.5", input: { lyrics }, engine: "minimax-music-1.5" },
    { model: "minimax/music-01", input: { lyrics }, engine: "minimax-music-01" },
  ];
  for (const a of attempts) {
    try {
      const id = await repCreate(a.model, a.input);
      await resume?.save?.(id, a.engine); // billed from here — checkpoint before polling
      const raw = (await repPoll(id, 6 * 60_000, "jingle-music")) as unknown;
      return { url: audioUrlOf(raw, "music"), engine: a.engine };
    } catch (e) {
      errors.push((e as Error).message.slice(0, 120));
    }
  }
  try {
    const hook = lyrics.split("\n").filter(Boolean).slice(0, 3).join(". ");
    const id = await repCreateVersion(BARK_VERSION, {
      prompt: `♪ ${hook} ♪`,
      history_prompt: singerGender === "f" ? "en_speaker_9" : "announcer",
      text_temp: 0.7,
    });
    await resume?.save?.(id, "bark");
    const raw = (await repPoll(id, 6 * 60_000, "jingle-bark")) as unknown;
    return { url: audioUrlOf(raw, "bark"), engine: "bark" };
  } catch (e) {
    errors.push((e as Error).message.slice(0, 120));
  }
  throw new Error(`[jingle:music] every engine failed: ${errors.join(" | ")}`);
}

export async function generateJingleAd(params: JingleAdParams): Promise<string> {
  const voiceJson = JSON.parse(params.brandProfile.voiceJson || "{}");
  const resume = params.resume || {};
  const ckpt = (patch: Record<string, unknown>) =>
    params.jobId ? checkpointJob(params.jobId, patch) : Promise.resolve();
  // Paid-prediction ids the queue doesn't map into `resume` (music, styled
  // singer frame, gate repairs, keyframe) — read straight off the job payload
  // so a restart re-attaches to a running prediction instead of re-buying it.
  const ck = await jobCheckpoints(params.jobId);

  // 1) LYRICS — short and sticky. ≤45 words so the whole lyric fits the
  // caption budget and the song stays ad-length.
  let lyrics = resume.lyrics || "";
  const contentLang = (await db.shop.findUnique({ where: { id: params.shopId }, select: { contentLang: true } }))?.contentLang;
  if (!lyrics) {
    const buildLyricsPrompt = (productRef: string, debranded: boolean) => [
      `You write short advertising JINGLES — early-2000s TV-commercial energy, the kind that gets stuck in your head.${langDirective(contentLang)}`,
      params.serviceMode
        ? `The offer (a service, not a physical product): "${productRef}". Sing the RESULT the customer gets.`
        : `The product: "${productRef}".`,
      debranded ? `Sing about what the item IS and how owning it feels. Do not name any brand, franchise or character.` : "",
      params.productDescription ? `Context: ${params.productDescription.slice(0, 250)}` : "",
      voiceJson.tone ? `Brand voice/tone: ${voiceJson.tone}.` : "",
      params.direction ? `Merchant direction (follow it): ${params.direction}` : "",
      ``,
      `Rules: 5 or 6 SHORT lines, 45 words maximum total. Simple rhymes, a`,
      `bouncy singable rhythm, and the product name sung at least twice. The`,
      `last line is a tagline that lands like a hook. No emoji, no hashtags,`,
      `no quotes, no stage directions — output ONLY the lyric lines, one per line.`,
      ``,
      // Listing titles are stuffed with SKUs, pack sizes and region tags, and a
      // jingle that chants one of those fragments sounds broken ("GROW,
      // S-CHINESE"). Sing what a person would actually call the thing.
      `Name it the way a customer would say it out loud — a short natural name`,
      `for what it IS. Never sing a fragment of the listing title, a SKU, a size`,
      `or count, or a region/language tag ("S-Chinese", "2-Pack", "OEM", "V2").`,
      `If the title has no sayable name in it, sing the plain product category.`,
    ]
      .filter(Boolean)
      .join("\n");
    // A branded title can be refused outright — retry, then drop the brand and
    // sing the category. See ad-copy-retry.server.ts.
    lyrics = await withBrandFallback(async (productRef, debranded) =>
      ((await anthropicText(buildLyricsPrompt(productRef, debranded), { model: "claude-sonnet-5", maxTokens: 250 })) || "")
        .replace(/["“”]+/g, "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 6)
        .join("\n")
        .trim(),
      params.productTitle, "jingle:lyrics", params.productDescription);
    const words = lyrics.split(/\s+/);
    if (words.length > 48) lyrics = words.slice(0, 48).join(" ");
    await ckpt({ ckLyrics: lyrics });
  }

  // 2) SONG — the vocal gender matches the cast singer, so the lipsync
  // reads true. A resumed job keeps the TRUE engine of the checkpointed song.
  // Resolved through the shared presenter seam, which knows this shop's CUSTOM
  // presenters ("cav…") as well as the public cast. AVATAR_BY_ID knows only the
  // public cast, so a custom singer resolved to undefined — and undefined is
  // the same value as "chose nobody", which is a legitimate mode that ships a
  // product clip with the song playing over it. So a merchant who forged their
  // own singer, picked them, and paid for an Anthem received one with no
  // performer in it: billed in full, marked successful, silent about why.
  //
  // A presenter that cannot be resolved throws rather than degrading, so the
  // queue refunds instead of delivering an ad missing what they chose.
  const singerVariant = Math.max(0, Math.min(OUTFITS.length - 1, params.avatarVariant ?? 0));
  let singer: Avatar | undefined;
  let singerPortraitFile = "";
  let singerPortraitUrl = "";
  if (params.avatarId) {
    const { resolvePresenter } = await import("./custom-avatars.server");
    const resolved = await resolvePresenter(params.shopId, params.avatarId, singerVariant);
    singer = resolved.avatar;
    singerPortraitFile = resolved.portraitFile;
    const singerBase = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    singerPortraitUrl = singerBase ? `${singerBase}${resolved.portraitPublicPath}` : "";
  }
  let songUrl = resume.songUrl || "";
  let engine = (songUrl && resume.engine) || "minimax-music-1.5";
  // The checkpoint outlives the URL: provider delivery links die after ~1h, and
  // the queue retries immediately, so an expired song would fail all three
  // attempts identically (assembly's download throws on the same dead link).
  if (songUrl && !(await checkpointUrlAlive(songUrl))) {
    console.log("[anthem] checkpointed song URL has expired — re-singing");
    songUrl = "";
    // The prediction that produced it hands back the SAME dead link — drop it.
    delete ck.ckMusicId;
    await ckpt({ ckSongUrl: "", ckMusicId: "" });
  }
  if (!songUrl) {
    const sung = await singJingle(lyrics, singer?.gender, {
      priorId: ck.ckMusicId,
      priorEngine: ck.ckMusicEngine,
      save: (id, eng) => ckpt({ ckMusicId: id, ckMusicEngine: eng }),
    });
    songUrl = sung.url;
    engine = sung.engine;
    await ckpt({ ckSongUrl: songUrl, ckEngine: engine });
  }

  // 3) VISUAL — the cast singer LIPSYNCS the anthem on camera (photoreal, or
  // redrawn in a cartoon style first). No singer → hero-motion product clip
  // with the song over it, as before. Singing failure falls back gracefully.
  let talkingUrl = resume.talkingUrl || "";
  let singEngine = (talkingUrl && resume.singEngine) || "";
  // Did the performer end up actually holding the product? Survives a resume
  // that skips the whole visual block because the lipsync was checkpointed.
  let heldProduct = ck.ckHeldOk === "1";
  // Same poison-pill as the song: a checkpointed lipsync URL expires in ~1h and
  // assembly's download would then fail on every retry. Re-perform instead.
  if (talkingUrl && !(await checkpointUrlAlive(talkingUrl))) {
    console.log("[anthem] checkpointed lipsync URL has expired — re-performing");
    talkingUrl = "";
    singEngine = "";
    delete ck.ckOmniId;
    await ckpt({ ckTalkingUrl: "", ckOmniId: "" });
  }
  if (singer && !talkingUrl) {
    let tmpSing: string | null = null;
    try {
      const variant = singerVariant;
      const portraitFile = singerPortraitFile;
      const portraitPublicUrl = singerPortraitUrl;

      // Cartoon singer: stylize the portrait mid-note before lipsyncing it.
      let frameUrl = resume.styledUrl || "";
      if (frameUrl && !(await checkpointUrlAlive(frameUrl))) {
        console.log("[anthem] checkpointed styled singer frame has expired — restyling");
        frameUrl = "";
        delete ck.ckStyleId;
        await ckpt({ ckStyledUrl: "", ckStyleId: "" });
      }
      const recipe = params.cartoonStyle ? CARTOON_RECIPES[params.cartoonStyle as CartoonStyleKey] : undefined;
      if (!frameUrl && recipe && portraitPublicUrl) {
        // The raw frame is checkpointed BEFORE the gate: an interrupted gate
        // must never throw away a paid kontext render.
        let raw = ck.ckRawStyledUrl || "";
        const resumedRaw = !!raw && (await checkpointUrlAlive(raw));
        if (!resumedRaw) {
          raw = await resumablePrediction({
            priorId: ck.ckStyleId,
            create: () => repCreate("black-forest-labs/flux-kontext-pro", {
              prompt: `Redraw this exact person as a ${recipe.look}. Same person — same hairstyle, friendly stylized likeness — joyfully SINGING straight to camera like a pop star mid-note, expressive and delighted. If any packaging or box art appears it displays ONLY the text "${params.productTitle}" spelled exactly — never invented words or gibberish. Head-and-shoulders framing, vertical 9:16 composition, no caption text, no watermark.`,
              input_image: portraitPublicUrl,
              aspect_ratio: "9:16",
              output_format: "jpg",
            }),
            save: (id) => ckpt({ ckStyleId: id }),
            maxMs: 5 * 60_000,
            stage: "anthem-style",
          });
          delete ck.ckGateFixId;
          delete ck.ckGateStripId;
          await ckpt({ ckRawStyledUrl: raw, ckStyledUrl: "", ckGateFixId: "", ckGateStripId: "" });
        }
        // Same no-gibberish gate as cartoon keyframes — check, repair, strip.
        // NO product reference: this is a head-and-shoulders SINGER portrait
        // with no product in it, so a product photo made the gate fail on
        // "product unrecognizable" and on lettering not reading the title —
        // burning two nano-banana edits and two vision calls, then lipsyncing
        // a needlessly repaired frame, on essentially every styled anthem.
        frameUrl = await gateStylizedFrame(raw, params.productTitle, undefined, "anthem", {
          fixId: resumedRaw ? ck.ckGateFixId : undefined,
          stripId: resumedRaw ? ck.ckGateStripId : undefined,
          save: ckpt,
        });
        await ckpt({ ckStyledUrl: frameUrl });
      }
      // PRODUCT IN HAND — an anthem where the singer never touches the product
      // is a music video, not an ad. Compose the product into the performer's
      // hands BEFORE the lipsync, so it's on screen for the whole song instead
      // of flashing past in a cutaway at the end. The style survives because
      // the ALREADY-styled singer frame is the first reference: nano-banana is
      // matching it, not re-inventing it.
      let heldUrl = ck.ckHeldUrl || "";
      if (heldUrl && !(await checkpointUrlAlive(heldUrl))) {
        console.log("[anthem] checkpointed in-hand frame has expired — recomposing");
        heldUrl = "";
        delete ck.ckHoldId;
        await ckpt({ ckHeldUrl: "", ckHoldId: "" });
      }
      const singerRefUrl = frameUrl || portraitPublicUrl;
      const canHold = !params.serviceMode && !!params.productImageUrl && /^https?:\/\//.test(params.productImageUrl || "");
      if (!heldUrl && canHold && singerRefUrl) {
        try {
          heldUrl = await resumablePrediction({
            priorId: ck.ckHoldId,
            create: () => repCreate("google/nano-banana", {
              prompt:
                `Keep the FIRST image's person exactly as they are — same face, same hairstyle, same outfit, same art style, ` +
                `same lighting and same background — and put the SECOND image's product in their hands, held up at chest ` +
                `height, facing the camera and clearly visible. They stay mid-song: mouth open singing, joyful and ` +
                `expressive, looking straight down the lens. The product stays identical to its photo — same shape, colors, ` +
                `materials, logos and text, never restyled or relettered — and at its TRUE real-world size next to the ` +
                `person; never shrink or miniaturize it. A large item (board, chair, rug…) is held upright with both hands ` +
                `or stood on the ground beside them, even if it runs past the frame. Hands are anatomically correct: five ` +
                `fingers, natural grip. Waist-up vertical 9:16 framing with clear headroom above the head. ` +
                `No added text, no captions, no watermark.`,
              image_input: [singerRefUrl, params.productImageUrl],
              output_format: "jpg",
            }),
            save: (id) => ckpt({ ckHoldId: id }),
            maxMs: 5 * 60_000,
            stage: "anthem-hold",
          });
          await ckpt({ ckHeldUrl: heldUrl });
        } catch (e) {
          console.error("[anthem] product-in-hand compose failed — singer performs without it:", e instanceof Error ? e.message.slice(0, 160) : e);
          heldUrl = "";
        }
      }

      // The composed frame only wins if it actually downloads. A dead or
      // truncated link must never cost the merchant the whole performance —
      // fall back to the plain singer frame and let assembly cut the product in.
      let frameDataUri = "";
      if (heldUrl) {
        try {
          const held = await downloadBuffer(heldUrl);
          if (held.length > 10_000) {
            frameDataUri = "data:image/jpeg;base64," + held.toString("base64");
            heldProduct = true;
            await ckpt({ ckHeldOk: "1" });
          }
        } catch { /* fall through to the plain singer frame */ }
      }
      if (!frameDataUri) {
        frameDataUri = frameUrl
          ? "data:image/jpeg;base64," + (await downloadBuffer(frameUrl)).toString("base64")
          : "data:image/jpeg;base64," + fs.readFileSync(portraitFile).toString("base64");
      }

      // Lipsync audio = the song up to the smart line-gap cut, faded out.
      tmpSing = fs.mkdtempSync(path.join(os.tmpdir(), "anthem-"));
      const rawSong = path.join(tmpSing, "song-raw.audio");
      await download(songUrl, rawSong);
      const singPath = path.join(tmpSing, "sing.mp3");
      const cut = await smartSongCut(rawSong);
      const trim = await runFfmpeg(["-y", "-i", rawSong, "-t", String(cut), "-af", `afade=t=out:st=${Math.max(0, cut - 1.2).toFixed(2)}:d=1.2`, "-c:a", "libmp3lame", "-b:a", "160k", singPath]);
      const audioFile = trim.status === 0 && fs.existsSync(singPath) ? singPath : rawSong;
      const audioDataUri = "data:audio/mpeg;base64," + fs.readFileSync(audioFile).toString("base64");

      if (resume.omniPredictionId && ck.ckOmniId) {
        try {
          const resumed = await repPoll(resume.omniPredictionId, 12 * 60_000, "anthem-omni(resumed)");
          // An hours-old prediction hands back an already-dead delivery url —
          // re-buying the lipsync beats shipping a video that won't download.
          talkingUrl = (await checkpointUrlAlive(resumed)) ? resumed : "";
        } catch { /* fresh run below */ }
      }
      if (!talkingUrl) {
        const omniId = await repCreate("bytedance/omni-human", { image: frameDataUri, audio: audioDataUri });
        await ckpt({ ckOmniId: omniId });
        talkingUrl = await repPoll(omniId, 12 * 60_000, "anthem-omni");
      }
      singEngine = "omni-human";
      await ckpt({ ckTalkingUrl: talkingUrl, ckSingEngine: singEngine });
    } catch (e) {
      console.error("[anthem] singing performance failed — product visual instead:", e instanceof Error ? e.message.slice(0, 180) : e);
      talkingUrl = "";
      singEngine = "";
    } finally {
      if (tmpSing) { try { fs.rmSync(tmpSing, { recursive: true, force: true }); } catch { /* tidy */ } }
    }
  }

  let keyframeUrl = resume.keyframeUrl || "";
  // Only matters when we're about to animate: a checkpointed flux frame dies
  // in ~1h, and kling would be handed the same dead image on every retry.
  if (!talkingUrl && keyframeUrl && !(await checkpointUrlAlive(keyframeUrl))) {
    console.log("[anthem] checkpointed keyframe URL has expired — repainting");
    keyframeUrl = "";
    delete ck.ckJingleKeyId;
    await ckpt({ ckKeyframeUrl: "", ckJingleKeyId: "" });
  }
  if (!talkingUrl && !keyframeUrl) {
    if (!params.serviceMode && params.productImageUrl) {
      keyframeUrl = params.productImageUrl; // the real photo IS the keyframe
    } else {
      const prompt =
        `Bright joyful retro TV-commercial scene for "${params.productTitle}"` +
        `${params.serviceMode ? " (a service — show the happy outcome, delighted people)" : ""}, ` +
        `sunny saturated colors, clean advertising composition, nostalgic early-2000s optimism, ` +
        `vertical 9:16, no text, no watermark.`;
      keyframeUrl = await resumablePrediction({
        priorId: ck.ckJingleKeyId,
        create: () => repCreate("black-forest-labs/flux-dev", {
          prompt,
          num_inference_steps: 30,
          guidance: 3,
          aspect_ratio: "9:16",
          output_format: "jpg",
          output_quality: 92,
        }),
        save: (id) => ckpt({ ckJingleKeyId: id }),
        maxMs: 5 * 60_000,
        stage: "jingle-keyframe",
      });
    }
    await ckpt({ ckKeyframeUrl: keyframeUrl });
  }

  // Hosted URLs (Shopify CDN photo or replicate.delivery frame) go straight
  // to kling — no multi-MB base64 body, no size floor to trip on small legit
  // images. Restarts mid-poll re-attach to the SAME paid prediction.
  let animUrl = resume.animUrl || "";
  if (!talkingUrl && !animUrl && resume.klingPredictionId) {
    try {
      animUrl = await animatePoll(resume.klingPredictionId, 12 * 60_000, "jingle-animate(resumed)");
      await ckpt({ ckAnimUrl: animUrl });
    } catch { /* old prediction died — fall through to a fresh one */ }
  }
  // One probe covers both resume paths — checkpointed url and re-attached
  // prediction hand back the same expiring link, and assembly downloads it.
  if (!talkingUrl && animUrl && !(await checkpointUrlAlive(animUrl))) {
    console.log("[anthem] checkpointed animation URL has expired — re-animating");
    animUrl = "";
    await ckpt({ ckAnimUrl: "", ckKlingId: "" });
  }
  if (!talkingUrl && !animUrl) {
    const { id: animId } = await animateCreate(params.videoEngine, {
      startImage: keyframeUrl,
      prompt: `Upbeat retro TV-commercial hero shot: the product stays the clear star, slow confident camera push-in, gentle sparkle and shine sweeps, bright cheerful energy, vertical video.`,
      negativePrompt: "morphing, distortion, extra objects, people appearing, text, watermark, blur, style change",
    });
    await ckpt({ ckKlingId: animId });
    animUrl = await animatePoll(animId, 12 * 60_000, "jingle-animate");
    await ckpt({ ckAnimUrl: animUrl });
  }

  // 4) ASSEMBLY — trim long songs to ad length (with a fade), then loop the
  // clip under the song and burn the lyrics as captions.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jingle-"));
  try {
    const animPath = path.join(tmp, "anim.mp4");
    await download(talkingUrl || animUrl, animPath);
    const rawSongPath = path.join(tmp, "song-raw.audio");
    await download(songUrl, rawSongPath);

    // A truncated/empty song file makes a SILENT ad — and the jingle is the ad.
    // Re-sing once (the cartoon pipeline applies the same floor to its TTS).
    const songBytes = fs.existsSync(rawSongPath) ? fs.statSync(rawSongPath).size : 0;
    if (songBytes < 20_000) {
      console.error(`[anthem] song file implausibly small (${songBytes}B) — re-singing`);
      const resung = await singJingle(lyrics, singer?.gender, {
        save: (id, eng) => ckpt({ ckMusicId: id, ckMusicEngine: eng }),
      });
      songUrl = resung.url;
      engine = resung.engine;
      await ckpt({ ckSongUrl: songUrl, ckEngine: engine });
      await download(songUrl, rawSongPath);
    }

    // Same standardized cut for BOTH paths (singer or product visual) — the
    // smart cut is deterministic, so this reproduces the exact trim the
    // lipsync audio used and assemble's truncation-recovery lines up.
    let songPath = rawSongPath;
    // ffprobe throws on an unreadable file; uncaught it terminal-failed an ad
    // whose song, lipsync and animation were all already bought. 0 = "unknown",
    // which the trim and caption-share maths below already handle.
    let songDur = 0;
    try {
      songDur = ffprobeDuration(rawSongPath);
    } catch (e) {
      console.error("[anthem] couldn't probe the song — shipping it untrimmed:", e instanceof Error ? e.message.slice(0, 140) : e);
    }
    const cap = await smartSongCut(rawSongPath);
    if (songDur > cap) {
      const trimmed = path.join(tmp, "song.mp3");
      const fade = 1.2;
      const run = await runFfmpeg([
        "-y", "-i", rawSongPath,
        "-t", String(cap),
        "-af", `afade=t=out:st=${(cap - fade).toFixed(2)}:d=${fade}`,
        "-c:a", "libmp3lame", "-b:a", "192k",
        trimmed,
      ]);
      if (run.status === 0 && fs.existsSync(trimmed)) songPath = trimmed;
      else console.error(`[anthem] trim failed — shipping full-length song (${Math.round(songDur)}s): ${(run.stderr || "").slice(-200)}`);
    }

    // Captions cover only the lyric lines that actually made the cut — whole
    // lines, proportional to how much of the song survived — so the burned
    // captions end on a complete line and track what's audibly sung.
    const allLines = lyrics.split("\n").map((l) => l.trim()).filter(Boolean);
    const sungShare = songDur > 0 ? Math.min(1, cap / songDur) : 1;
    const sungLines = allLines.slice(0, Math.max(1, Math.round(allLines.length * sungShare)));
    const captionFeed = sungLines.join(" ");

    // Product b-roll. When the singer ISN'T holding it, this cutaway is how the
    // viewer first sees the product, so it lands mid-song. When they ARE, it
    // reveals nothing and interrupting the performance for it reads cheap —
    // so it becomes a short closing beat and the last line of the anthem lands
    // on a clean shot instead.
    let productImagePath: string | null = null;
    if (talkingUrl && params.productImageUrl) {
      try {
        productImagePath = path.join(tmp, "product.img");
        await download(params.productImageUrl, productImagePath);
      } catch { productImagePath = null; }
    }

    const rendersDir = path.join(process.cwd(), "data", "renders");
    fs.mkdirSync(rendersDir, { recursive: true });
    const fileName = `jingle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const outPath = path.join(rendersDir, fileName);

    await assemble({
      jobId: params.jobId,
      talkingPath: animPath,
      audioPath: songPath,
      productImagePath,
      script: captionFeed, // karaoke-style captions — only the sung lines
      outPath,
      lipSynced: !!talkingUrl, // omni bakes the sung audio in; kling loops under the song
      productCutAt: heldProduct ? "end" : "mid",
    });

    try { await mirrorRender(fileName, fs.readFileSync(outPath)); } catch { /* non-fatal */ }

    const asset = await db.asset.create({
      data: {
        shopId: params.shopId,
        type: "VIDEO_AD",
        status: "PENDING",
        title: `Anthem — ${params.productTitle}`,
        bodyJson: JSON.stringify({
          style: "JINGLE",
          engine,
          singEngine: singEngine || null,
          singerId: singer?.id || null,
          cartoonStyle: params.cartoonStyle || null,
          videoUrl: `/renders/${fileName}`,
          lyrics,
          prompt: lyrics,
          script: lyrics,
        }),
        metaJson: JSON.stringify({
          style: "JINGLE",
          productTitle: params.productTitle,
          avatarId: singer?.id || null,
          avatarVariant: singer ? (params.avatarVariant ?? 0) : null,
          cartoonStyle: params.cartoonStyle || null,
          heldProduct, // did the singer perform WITH the product in hand?
          direction: params.direction || null,
          origin: params.origin || null,
          productImageUrl: params.productImageUrl || null,
          serviceMode: !!params.serviceMode,
        }),
      },
    });
    return asset.id;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
