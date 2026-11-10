/* Bring-your-own-song upload for the Music Video (Film tab).
 *
 * A RESOURCE route (no component) so a plain fetch() gets JSON. Validates an incoming
 * AUDIO file and writes it to the durable data/renders disk (served by /renders/:file, the
 * same place the song segments live — so it needs no /uploads allowlist change), then hands
 * back the public URL. generateMusicVideo uses it as the song INSTEAD of generating one with
 * minimax. No tokens, no plan gate — it only stores a file; the paid render gates itself later.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { externalOrigin } from "../lib/origin.server";

const EXT: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/ogg": "ogg",
};

export async function action({ request }: ActionFunctionArgs) {
  const id = await getWebIdentity(request);
  if (!id) return json({ error: "Sign in first." }, { status: 401 });

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: "Send the song as a file." }, { status: 400 }); }
  const song = form.get("song");
  if (!song || typeof song === "string" || song.size === 0) return json({ error: "No song in the upload." }, { status: 400 });
  const ext = EXT[song.type] || (/\.(mp3|wav|m4a|aac|ogg)$/i.exec((song as File).name || "")?.[1]?.toLowerCase());
  if (!ext || !/^audio\//.test(song.type || "audio/mpeg")) {
    return json({ error: "That doesn't look like an audio file (use MP3, WAV, M4A or AAC)." }, { status: 400 });
  }
  if (song.size > 25 * 1024 * 1024) return json({ error: "That track's a bit big — keep it under 25MB." }, { status: 400 });

  const dir = path.join(process.cwd(), "data", "renders");
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Served by /renders/:file; the unguessable random name is the only access control, same as
    // every other /renders asset. Prefix marks it as a user-uploaded song.
    const name = `mvsong-${crypto.randomBytes(10).toString("hex")}.${ext}`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(await song.arrayBuffer()));
    return json({ songUrl: `${externalOrigin(request)}/renders/${name}`, name: (song as File).name || `song.${ext}` });
  } catch (e) {
    console.error("[film-song-upload] write failed:", e instanceof Error ? e.message.slice(0, 160) : e);
    return json({ error: "Couldn't save that track — mind trying again?" }, { status: 500 });
  }
}
