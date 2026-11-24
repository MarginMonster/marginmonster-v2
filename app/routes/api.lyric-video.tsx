/* THE LYRIC VIDEO'S DOOR (Movie Maker → Music videos → Lyric Video).
 *
 * A RESOURCE route (no component), so a plain fetch() gets JSON:
 *   intent=link   a song from a YouTube link (lyric-video.server.ts → songFromLink): fetched onto our disk where an
 *                 upload goes. Returns { songUrl, name, title, seconds, source } — the page then carries on as
 *                 after an upload.
 *   intent=make   queue a lyric video from a song we stored (an upload, api.film-song-upload, or a fetched link),
 *                 with the member's pasted lyrics if any, a look and a shape. Returns { ok, jobId }.
 *
 * WHOSE SONG IT IS. The owner, 2026-11-24: "use YouTube link but include regulatory things like 'you must have
 * permissions from song owner'". Both intents refuse unless the member has ticked RIGHTS_LINE ("I own this song,
 * or I have permission from its owner to use it") — checked HERE, not only on the page. The piece keeps the
 * confirmation (when, and the YouTube address), and /terms#songs says what it means.
 *
 * OPERATORS ONLY until the owner sets a price — the way character shows are opened (web.channels.tsx): anyone else
 * gets "Not found". No tokens are charged. */

import fs from "node:fs";
import path from "node:path";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { isAdminEmail } from "../lib/admin.server";
import { enqueueJob } from "../lib/job-queue.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { RIGHTS_ASK, lyricLookOf, lyricShapeOf, songFileOf, songTitleOf, youTubeId, youTubeWatch } from "../lib/lyric-video";

export async function action({ request }: ActionFunctionArgs) {
  const lang = readUiLang(request);
  const id = await getWebIdentity(request);
  if (!id) return json({ error: tr(lang, "Sign in first.") }, { status: 401 });
  if (!isAdminEmail(id.account.email)) return json({ error: "Not found" }, { status: 404 });

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: tr(lang, "Something went wrong — try again.") }, { status: 400 }); }
  const intent = String(form.get("intent") || "");
  if (intent !== "link" && intent !== "make") return json({ error: tr(lang, "Something went wrong — try again.") }, { status: 400 });

  // the member's word that the song is theirs, or that they have its owner's permission — before anything is
  // fetched, and before anything is made
  if (String(form.get("rights") || "") !== "yes") return json({ error: tr(lang, RIGHTS_ASK), needRights: true }, { status: 400 });

  if (intent === "link") {
    const { songFromLink } = await import("../lib/lyric-video.server");
    const got = await songFromLink(String(form.get("link") || "").trim().slice(0, 2000), { shopId: id.shop.id });
    // an operator also sees what the tool said (the route is operators-only today; the check stays for the day it opens)
    if (!got.ok) return json({ error: tr(lang, got.message), ...(isAdminEmail(id.account.email) && got.detail ? { detail: got.detail } : {}) });
    console.log(`[lyricvideo] shop ${id.shop.id} fetched ${got.source} (owner's permission confirmed)`);
    return json({ songUrl: `/renders/${path.basename(got.songPath)}`, name: got.name, title: got.title, seconds: got.seconds, source: got.source });
  }

  // only a song we stored, and still on the disk
  const file = songFileOf(String(form.get("songUrl") || ""));
  if (!file) return json({ error: tr(lang, "Drop your song in first.") }, { status: 400 });
  if (!fs.existsSync(path.join(process.cwd(), "data", "renders", file))) return json({ error: tr(lang, "That upload has gone — drop the song in again.") }, { status: 400 });
  const songName = String(form.get("songName") || "").replace(/[\r\n]+/g, " ").slice(0, 200);
  const title = (String(form.get("title") || "").replace(/\s+/g, " ").trim() || songTitleOf(songName)).slice(0, 80);
  // where the song came from: the YouTube address it was fetched from (written again from its id), or an upload
  const linkId = youTubeId(String(form.get("songLink") || ""));
  const jobId = await enqueueJob(id.shop.id, "GENERATE_VIDEO_AD", {
    contentType: "lyricvideo",
    section: "creator",
    lyricSongUrl: `/renders/${file}`,
    lyricSongName: songName,
    lyricTitle: title,
    lyricText: String(form.get("lyrics") || "").slice(0, 12_000),
    lyricLook: lyricLookOf(form.get("look")),
    lyricShape: lyricShapeOf(form.get("shape")),
    songRights: { confirmed: true, at: new Date().toISOString(), from: linkId ? "youtube" : "upload", ...(linkId ? { link: youTubeWatch(linkId) } : {}) },
    // what the Archive's tile says while it is being made
    productTitle: `Lyric Video — ${title || tr(lang, "your song")}`,
  });
  return json({ ok: true, jobId });
}
