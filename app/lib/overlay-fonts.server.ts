/* The phone look's two faces, on the disk (see overlay-fonts.ts for what they are and why).
 *
 * `overlayFonts()` answers at once with whatever is there: the fetched face where it is on the disk and
 * really a font, Poppins where it is not — and, when one is missing, starts ONE fetch for it in the
 * background so the next take has it. A take is never held up by a font and never fails for one. */

import fs from "node:fs";
import path from "node:path";
import { OVERLAY_FACES, looksLikeFace, type OverlayFace } from "./overlay-fonts";

const poppins = () => path.join(process.cwd(), "public", "fonts", "Poppins-Bold.ttf");
const fontDir = () => path.join(process.cwd(), "data", "renders", "fonts");

function kept(face: OverlayFace): string | null {
  const f = path.join(fontDir(), face.file);
  try {
    if (!fs.existsSync(f) || fs.statSync(f).size < face.minBytes) return null;
    const head = Buffer.alloc(4);
    const fd = fs.openSync(f, "r");
    try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
    return looksLikeFace(face, { length: fs.statSync(f).size, 0: head[0], 1: head[1], 2: head[2], 3: head[3] }) ? f : null;
  } catch { return null; }
}

const fetching = new Map<string, Promise<void>>();
/** One fetch at a time per face, however many takes ask at once. Written beside the file and moved into
 *  place, so a half-written download is never taken for the font. */
function fetchFace(face: OverlayFace): Promise<void> {
  const running = fetching.get(face.key);
  if (running) return running;
  const job = (async () => {
    let why = "no source";
    try { fs.mkdirSync(fontDir(), { recursive: true }); } catch { /* the write below says why */ }
    for (const url of face.sources) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) { why = `${r.status} from ${new URL(url).host}`; continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (!looksLikeFace(face, buf)) { why = `not a font (${buf.length} bytes) from ${new URL(url).host}`; continue; }
        const f = path.join(fontDir(), face.file), part = `${f}.${process.pid}.part`;
        fs.writeFileSync(part, buf);
        fs.renameSync(part, f);
        console.log(`[overlay-fonts] ${face.file} fetched (${buf.length} bytes) from ${new URL(url).host}`);
        return;
      } catch (e) { why = e instanceof Error ? e.message.slice(0, 120) : String(e); }
    }
    console.error(`[overlay-fonts] ${face.file} could not be fetched — the phone look is drawn with Poppins: ${why}`);
  })().finally(() => { fetching.delete(face.key); });
  fetching.set(face.key, job);
  return job;
}

/** The faces a take is dressed with, now. `wait` (milliseconds) lets a first take give a missing face a
 *  moment to arrive — it is two small files — before settling for Poppins. */
export async function overlayFonts(wait = 0): Promise<{ font: string; thin: string; mono: string; fetched: { thin: boolean; mono: boolean } }> {
  const missing = OVERLAY_FACES.filter((f) => !kept(f));
  if (missing.length) {
    const all = Promise.all(missing.map(fetchFace));
    if (wait > 0) await Promise.race([all, new Promise((r) => setTimeout(r, wait))]);
    else void all;
  }
  const at = (key: "thin" | "mono") => kept(OVERLAY_FACES.find((f) => f.key === key) as OverlayFace);
  const thin = at("thin"), mono = at("mono");
  return { font: poppins(), thin: thin || poppins(), mono: mono || thin || poppins(), fetched: { thin: !!thin, mono: !!mono } };
}
