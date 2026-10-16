/* Helpurr's photo-upload endpoint.
 *
 * A RESOURCE route (no default component) so a plain fetch() from the chat widget
 * gets JSON back — a POST to a normal page route like /web/studio returns the full
 * HTML document instead, which is why the Studio reaches its frameUpload branch
 * through a Remix fetcher. This mirrors that same FREE, token-less persist: validate
 * an incoming image, write it to the durable /uploads disk under a shop-prefixed
 * name, and hand back the public URL for Helpurr to see + edit. No tokens, no brand
 * profile, no plan gate — it only stores a file; every paid step gates itself later.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { uploadFileName, type UploadExt } from "../lib/upload-names";

export async function action({ request }: ActionFunctionArgs) {
  const id = await getWebIdentity(request);
  if (!id) return json({ error: "Sign in first." }, { status: 401 });

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: "Send the photo as a file." }, { status: 400 }); }
  const photo = form.get("productPhoto");
  if (!photo || typeof photo === "string" || photo.size === 0) return json({ error: "No photo in the upload." }, { status: 400 });
  if (!/^image\//.test(photo.type)) return json({ error: "That doesn't look like an image." }, { status: 400 });
  if (photo.size > 8 * 1024 * 1024) return json({ error: "That photo's a bit big — keep it under 8MB." }, { status: 400 });

  const ext: UploadExt = /png/i.test(photo.type) ? "png" : /webp/i.test(photo.type) ? "webp" : "jpg";
  const dir = path.join(process.cwd(), "data", "renders", "uploads");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const name = uploadFileName(id.shop.id, crypto.randomBytes(8).toString("hex"), ext);
    fs.writeFileSync(path.join(dir, name), Buffer.from(await photo.arrayBuffer()));
    // Absolute on THIS request's origin — the same host safeEditSource rebuilds to,
    // and a host the image services can fetch. editImage requires an http(s) URL.
    const origin = new URL(request.url).origin;
    return json({ frameUrl: `${origin}/uploads/${name}` });
  } catch (e) {
    console.error("[buddy-upload] write failed:", e instanceof Error ? e.message.slice(0, 160) : e);
    return json({ error: "Couldn't save that photo — mind trying again?" }, { status: 500 });
  }
}
