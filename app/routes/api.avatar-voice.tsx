/* "My own voice" for the presenter voice picker (see app/lib/voice-clone.server.ts).
 *
 * A RESOURCE route (no component) so the picker — which lives inside two different Studio modals — can
 * use plain fetch() and get JSON:
 *
 *   POST intent=clone    multipart { audio, label?, gender?, consent=1 } → { id, seconds }
 *                        the clone itself runs in the background (the provider call can outlast a request)
 *   GET  ?id=<cloneId>                                                   → { status, voice?, error? }   (poll)
 *   POST intent=delete   { id }                                          → { ok }
 *
 * Gated like the presenter forge (active plan + the video capability). A clone is a real $3 provider
 * charge and has NO merchant price yet, so until the owner sets one it is switched on for admin accounts
 * only — canCloneVoice() is the single switch, and the Studio loader uses the same function to decide
 * whether to show the option at all.
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { getWebIdentity } from "../lib/web-auth.server";
import { externalOrigin } from "../lib/origin.server";
import { startVoiceClone, voiceCloneState, deleteVoiceClone, canCloneVoice } from "../lib/voice-clone.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const id = await getWebIdentity(request);
  if (!id) return json({ error: "Sign in first." }, { status: 401 });
  const cloneId = new URL(request.url).searchParams.get("id") || "";
  const state = cloneId ? await voiceCloneState(id.shop.id, cloneId) : null;
  if (!state) return json({ error: "That voice isn't here anymore." }, { status: 404 });
  return json(state, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  const id = await getWebIdentity(request);
  if (!id) return json({ error: "Sign in first." }, { status: 401 });

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: "Send the recording as a file." }, { status: 400 }); }
  const intent = String(form.get("intent") || "");

  // Removing your own voice is never gated — a lapsed merchant must still be able to take it down.
  if (intent === "delete") {
    const ok = await deleteVoiceClone(id.shop.id, String(form.get("id") || ""));
    return json(ok ? { ok: true } : { error: "That voice is already gone." }, { status: ok ? 200 : 404 });
  }

  if (intent !== "clone") return json({ error: "Unknown request." }, { status: 400 });
  if (!canCloneVoice(id.account, id.shop)) {
    return json({ error: "Using your own voice isn't switched on for this account yet." }, { status: 403 });
  }
  if (String(form.get("consent") || "") !== "1") {
    return json({ error: "Confirm it's your voice — or that you have permission to use it — first." }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!audio || typeof audio === "string" || audio.size === 0) return json({ error: "No recording in the upload." }, { status: 400 });
  if (audio.size > 20 * 1024 * 1024) return json({ error: "That recording is too big — keep it under 20 MB (about a minute is plenty)." }, { status: 400 });

  try {
    const started = await startVoiceClone({
      shopId: id.shop.id,
      audio: Buffer.from(await audio.arrayBuffer()),
      label: String(form.get("label") || ""),
      gender: String(form.get("gender") || ""),
      consent: true,
      base: externalOrigin(request),
    });
    return json(started);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't start that — mind trying again?" }, { status: 400 });
  }
}
