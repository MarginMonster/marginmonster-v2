/* THE AD PACK, server half: a finished video's captions as an .srt file, and the headline + primary text
 * to run it with. Both are free to the merchant (a half-cent transcription, a short copy call) and both
 * are kept once made — the SRT beside the video on the render disk, the copy on the piece itself. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.server";
import { runFfmpeg, repPoll } from "./ugc-ad-pipeline.server";
import { createWhisperx, wordsFromWhisperx } from "./faceless-video.server";
import { srtCues, toSrt, fitCopy, AD_COPY_LIMITS } from "./ad-pack";
import { LISTEN_AUDIO } from "./lyric-sync";
import { anthropicText } from "./anthropic.server";
import { CLAIMS_GUARDRAIL, dropOrgEndorsementPossessive, stripPromoTag } from "./ad-claims";
import { tidyAdCopy } from "./ad-copy-tidy";
import { langDirective } from "./content-lang";

const RENDERS = () => path.join(process.cwd(), "data", "renders");
const SRC = /^\/renders\/([A-Za-z0-9._-]+)\.mp4$/;

export type SrtResult = { ok: true; url: string } | { ok: false; error: "not-local" | "missing" | "unreadable" | "listen" | "no-speech" };

/** The captions of a video on our render disk, as an SRT file kept beside it (`name.srt`). The words are
 *  what is HEARD (the model also hears which language it is), timed to the word. */
export async function srtForVideo(srcRel: string, opts: { mirror?: (name: string, buf: Buffer) => Promise<unknown> } = {}): Promise<SrtResult> {
  const m = SRC.exec((srcRel || "").split("?")[0]);
  if (!m) return { ok: false, error: "not-local" };
  const src = path.join(RENDERS(), `${m[1]}.mp4`);
  if (!fs.existsSync(src)) return { ok: false, error: "missing" };
  const name = `${m[1]}.srt`;
  const out = path.join(RENDERS(), name);
  if (fs.existsSync(out) && fs.statSync(out).size > 10) return { ok: true, url: `/renders/${name}` };
  const id = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  const audioName = `srt-${id}.mp3`;
  const audio = path.join(RENDERS(), audioName);
  try {
    // (full rate: a 16 kHz copy lost whole stretches of a sung video — lyric-sync.ts LISTEN_AUDIO)
    const ex = await runFfmpeg(["-y", "-i", src, "-vn", ...LISTEN_AUDIO, audio]);
    if (ex.status !== 0 || !fs.existsSync(audio) || fs.statSync(audio).size < 1000) return { ok: false, error: "unreadable" };
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    if (!base) return { ok: false, error: "listen" };
    let words: ReturnType<typeof wordsFromWhisperx> = [];
    try {
      words = wordsFromWhisperx(await repPoll(await createWhisperx(`${base}/renders/${audioName}`, null), 4 * 60_000, "ad-srt"));
    } catch (e) {
      console.error(`[adpack] could not listen to ${m[1]}: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      return { ok: false, error: "listen" };
    }
    const cues = srtCues(words);
    if (!cues.length) return { ok: false, error: "no-speech" };
    const tmp = `${out}.tmp-${id}`;
    fs.writeFileSync(tmp, toSrt(cues), "utf8");
    fs.renameSync(tmp, out);
    try { await opts.mirror?.(name, fs.readFileSync(out)); } catch { /* the disk copy is served */ }
    console.log(`[adpack] ${name}: ${cues.length} cues from ${words.length} words`);
    return { ok: true, url: `/renders/${name}` };
  } finally {
    try { if (fs.existsSync(audio)) fs.unlinkSync(audio); } catch { /* best effort */ }
  }
}

export type AdCopy = { headline: string; primary: string };
export type AdCopyResult = { ok: true; copy: AdCopy } | { ok: false; error: "missing" | "write" };

const FILM_KINDS = new Set(["testmovie", "narrated", "musicvideo", "film", "avatardialogue", "enginetest", "faceless"]);
const MONEY = /(?:[$€£¥₹]\s?\d|\d[\d.,]*\s?(?:%|percent|dollars|USD|EUR|GBP)\b)/i;

/** A headline and primary text for a finished piece, grounded ONLY in what the piece and the store say
 *  (the shared claims guardrail; no invented price, spec, review or deal), in the store's own language and
 *  tone, held to the length each field shows in full. Kept on the piece; `fresh` writes another. */
export async function writeAdCopy(opts: { shopId: string; assetId: string; fresh?: boolean }): Promise<AdCopyResult> {
  const a = await db.asset.findFirst({ where: { id: opts.assetId, shopId: opts.shopId, type: { in: ["VIDEO_AD", "IMAGE_AD"] } }, select: { id: true, type: true, title: true, bodyJson: true, metaJson: true } });
  if (!a) return { ok: false, error: "missing" };
  const parse = (s: string | null): Record<string, unknown> => { try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" ? v as Record<string, unknown> : {}; } catch { return {}; } };
  const meta = parse(a.metaJson);
  const body = parse(a.bodyJson);
  const kept = meta.adCopy as Partial<AdCopy> | undefined;
  if (!opts.fresh && kept && typeof kept.headline === "string" && typeof kept.primary === "string" && kept.headline && kept.primary) {
    return { ok: true, copy: { headline: kept.headline, primary: kept.primary } };
  }
  const str = (v: unknown, n = 600) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const shop = await db.shop.findUnique({ where: { id: opts.shopId }, select: { contentLang: true, brandProfile: { select: { voiceJson: true } } } });
  const tone = str(parse(shop?.brandProfile?.voiceJson || "{}").tone, 80);
  const product = stripPromoTag(str(meta.productTitle, 160));
  const cat = product ? await db.catalogProduct.findFirst({ where: { shopId: opts.shopId, title: str(meta.productTitle, 160) }, select: { description: true, priceText: true } }) : null;
  const isFilm = FILM_KINDS.has(String(meta.kind || ""));
  const said = str(body.script) || str(body.lyrics) || str(body.prompt);
  const facts = [
    product && `Product: ${product}`,
    cat?.description && `Product details (the ONLY facts you may state): ${str(cat.description, 1200)}`,
    cat?.priceText && `Real price: ${str(cat.priceText, 40)}`,
    meta.serviceMode === true && "This is a service, not a physical product.",
    str(meta.topic) && `Topic: ${str(meta.topic, 300)}`,
    str(body.tagline) && `Tagline in the piece: ${str(body.tagline, 160)}`,
    said && `${a.type === "VIDEO_AD" ? "What the video says" : "The ad's words"}: ${said}`,
    str(meta.direction) && `The maker's direction: ${str(meta.direction, 300)}`,
    `Title: ${str(a.title, 160)}`,
  ].filter(Boolean).join("\n");
  const job = isFilm
    ? "This piece is a short film or story video, not a product ad. Write a headline that makes someone stop scrolling and a primary text that makes them want to watch it — about the story and its feeling. Make no claim about any product."
    : `This is ${a.type === "VIDEO_AD" ? "a video ad" : "an image ad"}. Write the copy that runs with it in an ad manager or a post: a headline that names the benefit, and a primary text that hooks in its first line and ends with a plain call to action.`;
  const prompt = [
    "You write ad copy for a small online store.",
    job,
    `Headline: at most ${AD_COPY_LIMITS.headline} characters. Primary text: at most ${AD_COPY_LIMITS.primary} characters, one or two short sentences.`,
    tone ? `The store's voice is ${tone}.` : "",
    "Here is everything you know — use nothing else:",
    facts,
    CLAIMS_GUARDRAIL,
    cat?.priceText ? "" : "You do NOT know a price: write no currency amount, percentage, discount or deal anywhere.",
    "Natural language a person would say, with correct apostrophes. No hashtags, at most one emoji in the primary text, no quotation marks.",
    langDirective(shop?.contentLang),
  ].filter(Boolean).join("\n");
  const allowedMoney = `${cat?.priceText || ""} ${cat?.description || ""} ${said}`;
  const moneyOk = (s: string) => !MONEY.test(s) || [...s.matchAll(new RegExp(MONEY.source, "gi"))].every((x) => allowedMoney.includes(x[0].replace(/\s/g, "")) || allowedMoney.includes(x[0]));
  let copy: AdCopy | null = null;
  for (let attempt = 0; attempt < 2 && !copy; attempt++) {
    try {
      const raw = await anthropicText(prompt + (attempt ? "\nYour last answer stated a price or deal you were not given. Write none." : ""), {
        model: "claude-sonnet-5", maxTokens: 300,
        jsonSchema: { name: "ad_copy", schema: { type: "object", properties: { headline: { type: "string" }, primary: { type: "string" } }, required: ["headline", "primary"] } },
      });
      const j = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]) as Partial<AdCopy>;
      const clean = (s: unknown, max: number) => fitCopy(dropOrgEndorsementPossessive(tidyAdCopy(String(s || "").replace(/["“”]/g, "").replace(/#\w+/g, ""))), max);
      const c = { headline: clean(j.headline, AD_COPY_LIMITS.headline), primary: clean(j.primary, AD_COPY_LIMITS.primary) };
      if (c.headline && c.primary && moneyOk(`${c.headline} ${c.primary}`)) copy = c;
    } catch (e) {
      console.error(`[adpack] copy for ${a.id}: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    }
  }
  if (!copy) return { ok: false, error: "write" };
  // kept on the piece — pinned to the row it was written from, so a change that landed meanwhile wins
  await db.asset.updateMany({
    where: { id: a.id, shopId: opts.shopId, metaJson: a.metaJson },
    data: { metaJson: JSON.stringify({ ...meta, adCopy: { ...copy, at: new Date().toISOString() } }) },
  });
  return { ok: true, copy };
}
