/* WHOSE VOICE a cast member sings a featured verse in (mv-feature.ts).
 *
 * Decided HERE, on the server, from the cast member's own picture — never from a voice id the page
 * sends (a voice could be another shop's clone):
 *
 *   - a BUILT-IN presenter: the voice the shop gave them (Presenters → Voice) if it gave one, else the
 *     voice they were cast with — the one their talking ads are read in, at its own pitch;
 *   - one of the shop's OWN presenters: the voice picked for them in the forge;
 *   - a face that was only uploaded or drawn: nobody's voice — they cannot be given a verse.
 *
 * A character voice (a monster, a cartoon) is made by a different engine and is not a singing voice. */

import { AVATAR_BY_ID, type Avatar } from "./avatars";
import { castFor } from "./ugc-ad-pipeline.server";
import { customCastFor, stockVoicesFor } from "./custom-avatars.server";
import { isCharacterVoice } from "./character-voices";

export type SingVoice = { voiceId: string; /** the speaking signature it is cast at (MiniMax semitones) */ pitch: number; gender: "m" | "f" };

const bare = (u: string | null | undefined): string => (u || "").split("?")[0].split("#")[0].replace(/^https?:\/\/[^/]+/i, "");

/** The built-in presenter a picture belongs to (`/avatars/<id>_<n>.jpg`), if it is one. */
export function builtInOf(img: string | null | undefined): Avatar | null {
  const m = /^\/avatars\/([a-z0-9-]+)_\d+\.(?:jpe?g|png|webp)$/i.exec(bare(img));
  return (m && AVATAR_BY_ID[m[1]]) || null;
}

/** Can the person in this picture be given a verse? (For the page: a yes/no, no voice ids.) */
export function builtInCanSing(a: Avatar): boolean {
  const v = castFor(a).voice;
  return !!v && !isCharacterVoice(v);
}

/** The voice the person in `img` sings in, or null when they have none of their own. */
export async function singVoiceForImg(shopId: string, img: string): Promise<SingVoice | null> {
  const a = builtInOf(img);
  if (a) {
    const own = (await stockVoicesFor(shopId))[a.id];
    if (own && !isCharacterVoice(own)) return { voiceId: own, pitch: 0, gender: a.gender };
    const cast = castFor(a);
    return cast.voice && !isCharacterVoice(cast.voice) ? { voiceId: cast.voice, pitch: cast.pitch || 0, gender: a.gender } : null;
  }
  const mine = (await customCastFor(shopId)).find((c) => !!c.img && bare(c.img) === bare(img));
  if (mine && mine.voiceId && !isCharacterVoice(mine.voiceId)) return { voiceId: mine.voiceId, pitch: 0, gender: mine.gender === "f" ? "f" : "m" };
  return null;
}
