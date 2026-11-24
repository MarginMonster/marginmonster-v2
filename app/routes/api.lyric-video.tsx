/* THE LYRIC VIDEO'S DOOR (Movie Maker → Music videos → Lyric Video).
 *
 * A RESOURCE route (no component), so a plain fetch() gets JSON:
 *   intent=make   queue a lyric video from a song the member uploaded (api.film-song-upload), with their pasted
 *                 lyrics if any, a look and a shape. Returns { ok, jobId }.
 *   intent=link   a song from a web address — handed to the one place links go (lyric-video.server.ts →
 *                 songFromLink), which today answers that links are coming (the owner's word on fetching songs
 *                 from YouTube is still to come).
 *
 * OPERATORS ONLY until the owner sets a price — the way character shows are opened (web.channels.tsx): anyone else
 * gets "Not found". No tokens are charged. Any song may go in (the owner, 2026-11-24): nothing here asks whose. */

import fs from "node:fs";
import path from "node:path";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { isAdminEmail } from "../lib/admin.server";
import { enqueueJob } from "../lib/job-queue.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { lyricLookOf, lyricShapeOf, songFileOf, songTitleOf } from "../lib/lyric-video";

export async function action({ request }: ActionFunctionArgs) {
  const lang = readUiLang(request);
  const id = await getWebIdentity(request);
  if (!id) return json({ error: tr(lang, "Sign in first.") }, { status: 401 });
  if (!isAdminEmail(id.account.email)) return json({ error: "Not found" }, { status: 404 });

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: tr(lang, "Something went wrong — try again.") }, { status: 400 }); }
  const intent = String(form.get("intent") || "");

  if (intent === "link") {
    const { songFromLink } = await import("../lib/lyric-video.server");
    const got = await songFromLink(String(form.get("link") || "").trim().slice(0, 2000));
    if (!got.ok) return json({ error: tr(lang, got.message) });
    // (the day links work: the fetched song is on the renders disk, and the page carries on as after an upload)
    return json({ songUrl: `/renders/${path.basename(got.songPath)}`, name: got.name });
  }

  if (intent !== "make") return json({ error: tr(lang, "Something went wrong — try again.") }, { status: 400 });
  // only a song we stored, and still on the disk
  const file = songFileOf(String(form.get("songUrl") || ""));
  if (!file) return json({ error: tr(lang, "Drop your song in first.") }, { status: 400 });
  if (!fs.existsSync(path.join(process.cwd(), "data", "renders", file))) return json({ error: tr(lang, "That upload has gone — drop the song in again.") }, { status: 400 });
  const songName = String(form.get("songName") || "").replace(/[\r\n]+/g, " ").slice(0, 200);
  const title = (String(form.get("title") || "").replace(/\s+/g, " ").trim() || songTitleOf(songName)).slice(0, 80);
  const jobId = await enqueueJob(id.shop.id, "GENERATE_VIDEO_AD", {
    contentType: "lyricvideo",
    section: "creator",
    lyricSongUrl: `/renders/${file}`,
    lyricSongName: songName,
    lyricTitle: title,
    lyricText: String(form.get("lyrics") || "").slice(0, 12_000),
    lyricLook: lyricLookOf(form.get("look")),
    lyricShape: lyricShapeOf(form.get("shape")),
    // what the Archive's tile says while it is being made
    productTitle: `Lyric Video — ${title || tr(lang, "your song")}`,
  });
  return json({ ok: true, jobId });
}
