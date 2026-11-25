/* A HOUSE CAMERA'S TAKE, MADE — one fifteen-second shot from a camera on the wall, start to Archive.
 *
 * What it is and why: house-cam.ts (the house, its rooms, its scares, its night) and take.ts (no words for the
 * engine). The steps that are the same as a handheld take's — the roll, the listening, the dressing — are
 * take.server.ts's own, used here. This file is what a house adds:
 *
 *   1. THE SCARE        a ready-made one, or the member's own written into the walk-in's shape — from the card
 *                       their words started from, when they changed a card's words (a writer that fails falls back
 *                       to that card as it is, else to the first ready-made one).
 *   2. THE ROOM         the shop's HOUSE is kept (the owner: "Found footage would need to remember rooms even
 *                       when panning to other cams in the house"): a room it has is used as it was drawn; a room
 *                       it has not is drawn now — the house's first from words, any other FROM the first — and
 *                       kept. Its camera's number is its place in the house.
 *   3. THE ROOM AS THE TAKE FINDS IT   drawn FROM the room: what the scare puts there before anything arrives
 *                       (somebody asleep) and, with the night vision off, the lamp. Nothing to add: the room.
 *   4. THE SCENE        drawn FROM that: the thing where it stops. A thing the house has seen before is drawn
 *                       from its first picture too, so the same one walks into every room.
 *   5. THE TAKE         started on the room as the take finds it, told to arrive at the scene ("exactly as in"),
 *                       the walk-in in full — listened to, rolled once more if the engine spoke.
 *   6. THE ROOM'S SOUND nobody is filming, so nobody speaks: the room lifted to a real level with the
 *                       microphone's hiss under it.
 *   7. THE CAMERA       the house look: the camera's name, its clock — the house's night, running on from the
 *                       last take — night vision, and the time-lapse over the stillness when the setting is on.
 *   8. THE PIECE        in the Archive — carrying the house as it now stands, which is where the next house take
 *                       finds it (keptHouseFor). No new table: a house is only ever as old as its footage, and a
 *                       Kept take keeps it for good.
 *
 * makeHouseTake is all of it but the database (a local run makes a take with it); generateHouseTake reads the
 * shop's house and writes the piece. */

import fs from "node:fs";
import path from "node:path";
import { db } from "../db.server";
import { anthropicText } from "./anthropic.server";
import { camDate, timeLapseOf, type HouseClock, type TimeLapse } from "./camera-dress";
import { EMPTY_HOUSE, HOUSE_SCARES, HOUSE_TAKE_SECONDS, camOf, houseNight, houseRoom, houseScare, houseScarePrompt, houseScenePrompt, houseSetPrompt, houseWriterBrief, keptHouseOf, parseHouseScare, playedSeconds, roomImg, roomPrompt, roomToDraw, thingImg, withRoom, withThing, type HouseNight, type HouseScare, type KeptHouse } from "./house-cam";
import { persistRemote, repRun } from "./image-generation.server";
import { mirrorRender } from "./object-storage.server";
import { TAKE_REF, betterRoll, rollFaulty } from "./take";
import { cutsIn, dressTake, heard, imageRef, keepRoll, renders, rerolls, rollTake, roomTake, secondsOf, sizeOf, stamp, wordsIn } from "./take.server";
import { checkpointJob } from "./ugc-ad-pipeline.server";

/** What a house take's record carries its house under — and how the newest one is found. */
export const HOUSE_NEEDLE = '"house":{"v":1';

/** THE SHOP'S HOUSE, as its newest house take left it — null when it has none yet. (The three newest are read,
 *  in case the newest was cut short before it could say.) */
export async function keptHouseFor(shopId: string): Promise<KeptHouse | null> {
  const rows = await db.asset.findMany({ where: { shopId, type: "VIDEO_AD", metaJson: { contains: HOUSE_NEEDLE } }, orderBy: { createdAt: "desc" }, take: 3, select: { metaJson: true } });
  for (const r of rows) {
    let house: KeptHouse | null = null;
    try { house = keptHouseOf((JSON.parse(r.metaJson || "{}") as { house?: unknown }).house); } catch { house = null; }
    if (house) return house;
  }
  return null;
}

export type HouseTakeOptions = {
  shopId: string;
  /** a ready-made house scare (house-cam.ts → HOUSE_SCARES)… */
  scareKey?: string;
  /** …or the member's own idea, in a line, and the room it happens in */
  idea?: string;
  room?: string;
  /** the card the member's words started from (they changed its words in the builder's box) — its direction is
   *  where the writer starts */
  from?: string;
  /** the time-lapse setting (unset: the scare's own) */
  lapse?: boolean;
  /** night vision (unset: on) */
  ir?: boolean;
  section?: string;
  jobId?: string;
  resume?: { ckScare?: string; ckHouse?: string; ckSet?: string; ckScene?: string; ckRaw?: string; ckSpoke?: string; ckCut?: string };
};

export type MadeHouseTake = {
  /** the finished file on the renders disk, and the take as the engine made it */
  outName: string;
  rawName: string;
  dressed: boolean;
  scare: HouseScare & { title: string };
  /** the house as it stands after this take — the next take starts from it */
  house: KeptHouse;
  cam: string;
  clock: HouseClock;
  lapse: TimeLapse | null;
  ir: boolean;
  /** how long it plays */
  seconds: number;
  set: string;
  scene: string;
  host: string;
  rolls: number;
  spoke: Array<{ at: number; text: string }> | null;
  direction: string;
};

/** THE PICTURES OF A HOUSE TAKE — its scare, its room (drawn now if the house has not got it), the room as the
 *  take finds it, and the scene it arrives at — with the house as it stands after them. Steps 1–4 of a take;
 *  nothing here is the take itself. */
export async function houseTakePictures(o: HouseTakeOptions & { house: KeptHouse | null }, ckpt: (patch: Record<string, unknown>) => Promise<void>): Promise<{ scare: HouseScare & { title: string }; house: KeptHouse; cam: string; set: string; scene: string }> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const resume = o.resume || {};
  const ir = o.ir !== false;
  fs.mkdirSync(renders(), { recursive: true });
  const draw = async (prompt: string, refs: string[]): Promise<string> =>
    persistRemote(await repRun("google/nano-banana", { prompt, ...(refs.length ? { image_input: refs.map((r) => imageRef(base, r)) } : {}), aspect_ratio: "16:9", output_format: "jpg" }), "jpg");

  // 1) the scare
  let scare: HouseScare & { title: string };
  const ready = houseScare(o.scareKey);
  if (resume.ckScare) scare = JSON.parse(resume.ckScare);
  else if (ready) scare = { ...ready, title: ready.name };
  else {
    // (the card their words started from — a written scare's starting point, and what a failed writer falls back to)
    const from = houseScare(o.from);
    const room = houseRoom(o.room) || (from ? houseRoom(from.room) : undefined) || houseRoom("living");
    let written: (HouseScare & { title: string }) | null = null;
    try {
      if (room) {
        written = parseHouseScare(await anthropicText(houseWriterBrief(o.idea || "", room, from), {
          maxTokens: 1200,
          jsonSchema: { name: "house_take", schema: { type: "object", additionalProperties: false, required: ["title", "who", "thing", "set", "door", "stands", "waits", "acts", "sound"], properties: { title: { type: "string" }, who: { type: "string", enum: ["he", "she", "it"] }, thing: { type: "string" }, set: { type: "string" }, door: { type: "string" }, stands: { type: "string" }, waits: { type: "string" }, acts: { type: "string" }, sound: { type: "string" } } } },
        }), room.key);
      }
    } catch (e) { console.error(`[house-take] the writer did not answer — a ready-made scare is used: ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
    const fallback = from || HOUSE_SCARES[0];
    scare = written || { ...fallback, title: fallback.name };
  }
  await ckpt({ ckScare: JSON.stringify(scare) });

  // 2) the room: kept, or drawn now and kept (the house's first from words; any other FROM the first)
  let house: KeptHouse = (resume.ckHouse ? keptHouseOf(resume.ckHouse) : null) || o.house || EMPTY_HOUSE;
  const plan = roomToDraw(house, scare.room);
  const room = houseRoom(scare.room);
  if (plan && room) {
    house = withRoom(house, room.key, await draw(roomPrompt(room, plan.first), plan.from ? [plan.from] : []));
    await ckpt({ ckHouse: JSON.stringify(house) });
  }
  const roomPic = roomImg(house, scare.room);
  if (!roomPic) throw new Error("[house-take] the room could not be drawn");
  const cam = camOf(house, scare.room);

  // 3) the room as the take finds it
  let set = resume.ckSet || "";
  if (!set) {
    const p = houseSetPrompt(scare, { ir });
    set = p ? await draw(p, [roomPic]) : roomPic;
    await ckpt({ ckSet: set });
  }

  // 4) the scene it arrives at — with the thing the house has already seen, when it has
  const known = thingImg(house, scare.thing.key);
  let scene = resume.ckScene || "";
  if (!scene) {
    scene = await draw(houseScenePrompt(scare, { kept: !!known, ir }), known ? [set, known] : [set]);
    await ckpt({ ckScene: scene });
  }
  if (!known && scare.thing.key) {
    house = withThing(house, scare.thing.key, scene);
    await ckpt({ ckHouse: JSON.stringify(house) });
  }
  return { scare, house, cam, set, scene };
}

/** MAKE ONE — everything but the database: the house comes in (null: a shop with none yet) and goes out as it
 *  now stands; every step is checkpointed through `ckpt`, so a stopped job resumes where it was. */
export async function makeHouseTake(o: HouseTakeOptions & { house: KeptHouse | null }, ckpt: (patch: Record<string, unknown>) => Promise<void>): Promise<MadeHouseTake> {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  const resume = o.resume || {};
  const ir = o.ir !== false;
  const dir = renders();
  const pictures = await houseTakePictures(o, ckpt);
  const { scare, cam, set, scene } = pictures;
  let house = pictures.house;

  // 5) the take — and no words: listened to, rolled once more if the engine spoke
  let rawName = resume.ckRaw && fs.existsSync(path.join(dir, resume.ckRaw)) ? resume.ckRaw : "";
  let host = "";
  let rolls = 0;
  const direction = (ref: string) => houseScarePrompt(scare, ref, { ir });
  const roll = async (): Promise<string> => {
    const rolled = await rollTake({ first: imageRef(base, set), scene: imageRef(base, scene), direction, aspect: "16:9", seconds: HOUSE_TAKE_SECONDS });
    host = rolled.host; rolls++;
    return keepRoll(rolled.url);
  };
  let spoke: Array<{ at: number; text: string }> | null = resume.ckSpoke ? JSON.parse(resume.ckSpoke) : null;
  // (and A CUT — a camera screwed to the wall never cuts: a roll that does is rolled again in the same one extra roll,
  //  the better kept — take.ts → betterRoll. Never trimmed: the house's clock runs from the take's first frame)
  const said = (s: typeof spoke) => (s === null ? null : wordsIn(s));
  let cuts: number[] = [];
  if (!rawName) {
    rawName = await roll();
    await ckpt({ ckRaw: rawName });
    spoke = await heard(base, rawName);
    cuts = await cutsIn(path.join(dir, rawName));
    for (let again = 0; again < rerolls() && rollFaulty({ cuts: cuts.length, words: said(spoke) }, true); again++) {
      console.log(`[house-take] ${cuts.length ? `the take cuts (at ${cuts.join("s, ")}s)` : `the engine spoke (${wordsIn(spoke)} words)`} — rolled again`);
      try {
        const next = await roll();
        const nextSpoke = await heard(base, next);
        const nextCuts = await cutsIn(path.join(dir, next));
        if (betterRoll({ cuts: nextCuts.length, words: said(nextSpoke) }, { cuts: cuts.length, words: said(spoke) }, true)) { rawName = next; spoke = nextSpoke; cuts = nextCuts; await ckpt({ ckRaw: rawName }); }
      } catch (e) { console.error(`[house-take] the second roll failed — the first is kept: ${e instanceof Error ? e.message.slice(0, 140) : e}`); break; }
    }
    await ckpt({ ckSpoke: JSON.stringify(spoke) });
  }

  // 6) the room's own sound
  const roomed = await roomTake(rawName);
  const soundName = roomed || rawName;

  // 7) the camera: its clock — the house's night, running on — night vision, and the time-lapse when it is on
  const soundPath = path.join(dir, soundName);
  const rawSeconds = (await secondsOf(soundPath)) || HOUSE_TAKE_SECONDS;
  const lapse = (o.lapse ?? scare.lapseOn) ? timeLapseOf(scare.lapse, rawSeconds) : null;
  let cut: { clock: HouseClock; night: HouseNight };
  if (resume.ckCut) cut = JSON.parse(resume.ckCut);
  else {
    const now = new Date();
    cut = houseNight({ prev: house.night, seconds: rawSeconds, lapse, today: camDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()), seed: parseInt(stamp().slice(-6), 16) });
    await ckpt({ ckCut: JSON.stringify(cut) });
  }
  house = { ...house, night: cut.night };
  const size = await sizeOf(soundPath);
  const dressed = await dressTake(soundPath, { look: "house", w: size.w || 1280, h: size.h || 720, clock: cut.clock, timelapse: lapse, seconds: rawSeconds, camName: cam, ir });
  const outPath = dressed || soundPath;
  const outName = path.basename(outPath);
  if (outName !== rawName) { try { await mirrorRender(outName, fs.readFileSync(outPath)); } catch { /* non-fatal */ } }
  if (dressed && roomed) fs.rmSync(path.join(dir, roomed), { force: true });

  return {
    outName, rawName, dressed: !!dressed, scare, house, cam, clock: cut.clock, lapse, ir,
    seconds: Math.round(playedSeconds(rawSeconds, lapse) * 100) / 100,
    set, scene, host, rolls, spoke, ...(cuts.length ? { cuts } : {}), direction: direction(TAKE_REF.replicate),
  };
}

/** Make one house-camera take for a shop. Returns the new piece's id. */
export async function generateHouseTake(opts: HouseTakeOptions): Promise<string> {
  const ckpt = async (patch: Record<string, unknown>) => { if (opts.jobId) await checkpointJob(opts.jobId, patch); };
  const m = await makeHouseTake({ ...opts, house: await keptHouseFor(opts.shopId) }, ckpt);
  const roomName = houseRoom(m.scare.room)?.name || "Room";
  const asset = await db.asset.create({
    data: {
      shopId: opts.shopId,
      type: "VIDEO_AD",
      status: "PENDING",
      title: `Found Footage — ${String(m.scare.title || "House camera").slice(0, 44)} · ${m.cam}`,
      bodyJson: JSON.stringify({ style: "TAKE", videoUrl: `/renders/${m.outName}`, prompt: opts.idea || m.scare.title || "", script: "" }),
      metaJson: JSON.stringify({
        kind: "take", template: "foundfootage", section: opts.section || "creator", aspect: "16:9", seconds: m.seconds,
        // the job that made it (what waits for "my piece" asks for exactly this)
        ...(opts.jobId ? { jobId: opts.jobId } : {}),
        // what it was made from, so a take can be looked into (and rolled again) later
        take: { ...(m.scare.key !== "own" ? { idea: m.scare.key } : {}), ...(opts.from && opts.idea ? { from: opts.from } : {}), camera: "house", dressed: m.dressed, host: m.host, rolls: m.rolls, room: m.scare.room, roomName, cam: m.cam, set: m.set, still: m.scene, raw: `/renders/${m.rawName}`, ir: m.ir, lapse: m.lapse, clock: m.clock, direction: m.direction.slice(0, 2400) },
        // THE HOUSE as it now stands — its rooms, the things seen in it, its night: the next house take starts here
        house: m.house,
        // nobody is filming: nothing is laid on
        lines: null,
        // what the listening model heard in the take AS THE ENGINE MADE IT — it is given no words, so this
        // should be empty (null = it could not be heard)
        spoke: m.spoke,
      }),
    },
  });
  return asset.id;
}
