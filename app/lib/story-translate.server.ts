/* TELL A NARRATED STORY AGAIN IN ANOTHER LANGUAGE — the doing part (story-translate.ts decides).
 *
 * One finished narrated story of the signed-in shop → its narration translated (one text call, here, so a
 * failure is said at once) → an ordinary narrated-film render job that carries the translated words as its
 * approved story and the ORIGINAL pictures as its already-made pictures. The pipeline then only voices and
 * cuts: no picture is drawn again. It is a film like any other — same price (films are free while the
 * section is being finished), same daily cap (the caller checks it), and it lands in the Archive as its
 * own piece; the original is never touched.
 */
import path from "node:path";
import fs from "node:fs";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { enqueueJob } from "./job-queue.server";
import { refundTokens, spendTokens } from "./tokens.server";
import { estimateFilmTokens } from "./plan-config";
import { CONTENT_LANG_NATIVE, normalizeContentLang } from "./content-lang";
import { castCardsOf, castToken, placesOf } from "./story-picture";
import { canTellIn, isNarratedStory, storyLangOf, storyPicturesFrom, storyWordsToTranslate, toldFrom, translateAsk, translatedTreatment } from "./story-translate";

/** Why nothing was started. The caller owns the sentence (and the member's language). */
export type TellAgainFail = "gone" | "not-a-story" | "language" | "telling" | "no-pictures" | "write-failed" | "tokens" | "queue-failed";
export type TellAgainResult = { ok: true; lang: string; langName: string; cost: number } | { ok: false; code: TellAgainFail; error?: string };

/**
 * A finished narrated story's pictures AS THEY ARE ON OUR DISK — one for each scene, in order — and its
 * music bed's file; null when they cannot be found, or are no longer all there. The story's own record
 * (meta.pictures), or — for one made before that was kept — the job that rendered it.
 * Used by "Another language" (here) and "Edit story" (story-edit.server.ts): both make a new piece
 * over the SAME pictures.
 */
export async function storyPicturesOnDisk(
  shopId: string,
  asset: { metaJson: string | null; createdAt: Date },
  scenes: number,
): Promise<{ pictures: string[]; musicFile: string } | null> {
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(asset.metaJson || "{}"); } catch { /* empty */ }
  let payloads: string[] = [];
  if (!Array.isArray(meta.pictures)) {
    try {
      const at = asset.createdAt.getTime();
      const jobs = await db.job.findMany({
        where: { shopId, type: "GENERATE_VIDEO_AD", status: "COMPLETED", processedAt: { gte: new Date(at - 2 * 60_000), lte: new Date(at + 10 * 60_000) } },
        select: { payload: true },
        take: 6,
      });
      payloads = jobs.map((j) => j.payload);
    } catch { /* none found */ }
  }
  const found = storyPicturesFrom(asset.metaJson, payloads, scenes);
  if (!found) return null;
  const renders = path.join(process.cwd(), "data", "renders");
  // (a picture is named by its /renders path; one stored with a site address in front of it is the same
  //  file — the render itself looks every picture up by its file name on our disk)
  const local = (u: string) => u.replace(/^https?:\/\/[^/]+/i, "");
  const onDisk = (u: string) => local(u).startsWith("/renders/") && fs.existsSync(path.join(renders, path.basename(local(u).split("?")[0])));
  if (!found.pictures.every(onDisk)) return null;
  const musicFile = found.music ? path.join(renders, path.basename(found.music)) : "";
  return { pictures: found.pictures, musicFile: musicFile && fs.existsSync(musicFile) ? musicFile : "" };
}
/** `fromFirst` is this function's own: set when it has already stepped back to the story first told. */
export async function tellStoryAgain(opts: { shopId: string; assetId: string; lang: string; fromFirst?: boolean }): Promise<TellAgainResult> {
  const { shopId } = opts;
  const asset = await db.asset.findFirst({
    where: { id: opts.assetId, shopId, type: "VIDEO_AD", status: { not: "FAILED" } },
    select: { id: true, title: true, metaJson: true, bodyJson: true, createdAt: true, shop: { select: { contentLang: true } } },
  });
  if (!asset) return { ok: false, code: "gone" };
  if (!isNarratedStory(asset.metaJson)) return { ok: false, code: "not-a-story" };
  let meta: Record<string, unknown> = {};
  let body: Record<string, unknown> = {};
  try { meta = JSON.parse(asset.metaJson || "{}"); } catch { /* empty */ }
  try { body = JSON.parse(asset.bodyJson || "{}"); } catch { /* empty */ }
  const words = storyWordsToTranslate(asset.bodyJson);
  const treatment = body.treatment as { title?: string; scenes: Array<Record<string, unknown>> } | undefined;
  if (!words || !treatment) return { ok: false, code: "not-a-story" };

  const from = storyLangOf(asset.metaJson, asset.shop?.contentLang);
  const lang = normalizeContentLang(opts.lang);
  if (!canTellIn(opts.lang, from)) return { ok: false, code: "language" };

  // ONE FAMILY (story-translate.ts → tellChoices). A telling of a telling is told from the story FIRST
  // told, while that is still here: one translation away from the writer's own words, not two — and
  // every telling then points at the same first story.
  const first = toldFrom(asset.metaJson);
  if (first && first !== asset.id && !opts.fromFirst) {
    const root = await db.asset.findFirst({
      where: { id: first, shopId, type: "VIDEO_AD", status: { not: "FAILED" } },
      select: { id: true, metaJson: true, shop: { select: { contentLang: true } } },
    });
    if (root && isNarratedStory(root.metaJson) && canTellIn(opts.lang, storyLangOf(root.metaJson, root.shop?.contentLang))) {
      return tellStoryAgain({ shopId, assetId: root.id, lang: opts.lang, fromFirst: true });
    }
  }
  // …and never twice at once: a telling in this language that is already on its way is the one.
  // (A second tap inside the minute it takes used to make a second copy.)
  try {
    const onItsWay = await db.job.findFirst({
      where: {
        shopId, type: "GENERATE_VIDEO_AD", status: { in: ["PENDING", "IN_PROGRESS"] },
        AND: [{ payload: { contains: `"filmTranslatedFrom":"${asset.id}"` } }, { payload: { contains: `"filmLang":"${lang}"` } }],
      },
      select: { id: true },
    });
    if (onItsWay) return { ok: false, code: "telling" };
  } catch { /* the look is a courtesy: never the reason a story is not told */ }

  // THE PICTURES — found, and still on our disk (storyPicturesOnDisk): a story is never told over a
  // picture that is not there
  const found = await storyPicturesOnDisk(shopId, asset, words.captions.length);
  if (!found) return { ok: false, code: "no-pictures" };
  const musicFile = found.musicFile;

  // THE WORDS
  let told: typeof treatment;
  try {
    const raw = await anthropicText(translateAsk(words.title, words.captions, lang), {
      model: "claude-sonnet-5",
      maxTokens: 2400,
      jsonSchema: { name: "story_translation", schema: { type: "object", properties: { title: { type: "string" }, captions: { type: "array", items: { type: "string" } } }, required: ["title", "captions"], additionalProperties: false } },
    });
    told = translatedTreatment(treatment, JSON.parse(raw));
  } catch (e) {
    return { ok: false, code: "write-failed", error: e instanceof Error ? e.message.slice(0, 160) : String(e) };
  }

  // THE RENDER — a narrated film job, charged as one (the queue refunds a prepaid job that fails for good)
  const scenes = told.scenes.length;
  const cost = estimateFilmTokens(scenes);
  let fromExtra = 0;
  if (cost > 0) {
    try { fromExtra = (await spendTokens(shopId, cost)).fromExtra; }
    catch (e) { return { ok: false, code: "tokens", error: e instanceof Error ? e.message.slice(0, 160) : String(e) }; }
  }
  try {
    await enqueueJob(shopId, "GENERATE_VIDEO_AD", {
      section: typeof meta.section === "string" ? meta.section : "creator",
      contentType: "film",
      filmTemplate: typeof meta.template === "string" ? meta.template : "testmovie",
      filmMode: "narrated",
      filmTopic: typeof body.prompt === "string" ? body.prompt : "",
      filmScenes: scenes,
      approvedTreatment: JSON.stringify(told),
      // the pictures the story already has, as the render's already-made pictures: none is drawn again
      ckImages: JSON.stringify(found.pictures),
      ...(musicFile ? { ckMusic: musicFile } : {}),
      ...(typeof meta.narrator === "string" && meta.narrator ? { filmNarrator: meta.narrator } : {}),
      ...(typeof meta.captions === "string" && meta.captions ? { filmCaptions: meta.captions } : {}),
      ...(typeof meta.aspect === "string" && meta.aspect ? { filmAspect: meta.aspect } : {}),
      ...(Array.isArray(meta.cast) && meta.cast.length ? { cast: meta.cast } : {}),
      // …and the story's OWN cast (story-picture.ts): the telling in another language has the same people in
      // it — it says so in the Archive, and a scene redrawn from it later is drawn from the same portraits
      ...(castToken(castCardsOf(meta), placesOf(meta)) ? { filmCastRef: castToken(castCardsOf(meta), placesOf(meta)) } : {}),
      // (a story made over still pictures is told again over still pictures — story-motion.ts)
      ...(meta.pictures === "still" ? { filmPictures: "still" } : {}),
      filmLang: lang,
      filmTranslatedFrom: asset.id,
      productTitle: (told.title || asset.title || "A story").slice(0, 60),
      prePaid: true, chargedTokens: cost, chargedFromExtra: fromExtra, initiator: "web",
    });
  } catch (e) {
    if (cost > 0) { try { await refundTokens(shopId, cost, fromExtra); } catch { /* the owed-refund path logs inside */ } }
    return { ok: false, code: "queue-failed", error: e instanceof Error ? e.message.slice(0, 160) : String(e) };
  }
  return { ok: true, lang, langName: CONTENT_LANG_NATIVE[lang] || lang, cost };
}
