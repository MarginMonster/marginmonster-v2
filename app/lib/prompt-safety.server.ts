/* Pre-pipeline prompt safety screen + mature-content router for the Creator
 * generators.
 *
 * A fast, cheap Claude Haiku pass classifies the prompt into three lanes BEFORE
 * we spend a token or touch the pipeline:
 *   - "block"  → refuse outright (illegal, OR the brand limits: sexual/nude and
 *                extreme/gratuitous gore — we are NOT an adult or shock-gore app)
 *   - "mature" → ALLOWED, but edgy enough that a mainstream model (nano-banana)
 *                usually refuses — horror, monsters, a bloody demon, a gory
 *                zombie — so route it to the permissive engine (flux-dev)
 *   - "allow"  → everything else → the premium engine as normal
 *
 * It FAILS OPEN to { ok:true, permissive:false }: if the classifier errors or is
 * slow, the prompt proceeds on the premium engine, and the generation layer's
 * own safety-refusal fallback (premium → flux-dev) still catches a mature prompt
 * that the premium model then refuses. Never block a real user on a classifier
 * outage.
 */
import { anthropicText } from "./anthropic.server";

const SCREEN_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["block", "mature", "allow"] },
    reason: { type: "string" },
  },
  required: ["verdict"],
} as const;

const INSTRUCTIONS = `You screen prompts for a CONSUMER AI image/video/music generator, BEFORE generation. Output a verdict: "block", "mature", or "allow".

BLOCK (verdict "block") — refuse these outright:
- Any sexual, nude, or suggestive depiction of a minor, or anyone described/implied as underage (CSAM) — zero tolerance
- Sexual/intimate or nude imagery of a REAL, named or identifiable living person (non-consensual / deepfake)
- Realistic instructions or recipes for weapons, explosives, bioweapons, or other mass harm; content promoting or instructing terrorism or mass violence against real people
- Extreme hateful content that dehumanizes people based on a protected trait
- EXPLICIT SEXUAL or pornographic content, or nudity of anyone — this platform is NOT an adult/NSFW tool
- EXTREME or GRATUITOUS gore: torture, realistic mutilation or dismemberment, graphic real-looking suffering, or depiction of a real atrocity

MATURE (verdict "mature") — these are ALLOWED, but edgy enough that a mainstream model often refuses, so we route them to a more permissive engine:
- Horror: monsters, zombies, demons, devils, ghosts, skeletons, vampires, creepy/scary/eerie imagery, Halloween
- MODERATE, horror-movie-style blood and gore (a bloody demon, a gory zombie, a monster covered in blood, a haunted bloody scene)
- Fantasy, stylized, or action violence; weapons used in a clearly fictional or artistic context; battles, war scenes
- Dark, disturbing, macabre, frightening, or grotesque themes

ALLOW (verdict "allow") — everything else: ordinary, benign, cute, artistic, professional, satirical, or merely weird prompts.

RULES OF THUMB:
- "a scary zombie", "a terrifying bloody demon", "a creepy haunted house", "a gory werewolf" → MATURE. NEVER block these — they are exactly what we want to allow.
- Tasteful/horror-movie blood in a scary context is MATURE. Torture, mutilation, or realistic shock-gore is BLOCK.
- ANY sexual or nude content is BLOCK (we are not an adult platform), even if framed as art.
- When unsure between "allow" and "mature", choose "mature". Only use "block" for the clearly-prohibited cases above.`;

export type ScreenResult = { ok: true; permissive: boolean } | { ok: false; message: string };

/** Classify a creator prompt. Resolves { ok:true, permissive } to proceed
 *  (permissive=true routes to the lenient engine), or { ok:false, message } to
 *  refuse with a user-facing message. Fails open to allow (non-permissive). */
export async function screenCreatePrompt(text: string): Promise<ScreenResult> {
  const clean = (text || "").trim().slice(0, 1500);
  if (!clean) return { ok: true, permissive: false };
  try {
    const raw = await Promise.race([
      anthropicText(
        `${INSTRUCTIONS}\n\nPROMPT TO SCREEN:\n"""\n${clean}\n"""\n\nReturn your verdict.`,
        { jsonSchema: { name: "screen", schema: SCREEN_SCHEMA }, maxTokens: 150 }
      ),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("screen timeout")), 7000)),
    ]);
    const v = JSON.parse(raw || "{}") as { verdict?: string };
    if (v.verdict === "block") {
      return {
        ok: false,
        message: "Sorry — this one looks like it touches on something unsafe, so we weren't able to create it (and you weren't charged). No worries at all — tweak the wording or try a different idea and we'll get right on it.",
      };
    }
    return { ok: true, permissive: v.verdict === "mature" };
  } catch (e) {
    // FAIL OPEN — provider-side model safety + the generation-layer fallback are
    // the backstops; never block a real prompt on a classifier hiccup.
    console.error("[prompt-safety] screen failed open:", e instanceof Error ? e.message : e);
    return { ok: true, permissive: false };
  }
}
