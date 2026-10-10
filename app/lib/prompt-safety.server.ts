/* Pre-pipeline prompt safety screen for the Creator generators.
 *
 * Runs a fast, cheap Claude Haiku classifier over the user's creative prompt
 * BEFORE we spend a token or touch the generation pipeline. The goal is NOT to
 * be a prude — this is a creative tool, so horror/gore/edgy/mature-but-legal
 * art all pass — it's to catch the genuinely illegal/harmful cases and give the
 * user a clear "this is against our guidelines" message instead of letting the
 * model silently refuse and the job spin.
 *
 * It FAILS OPEN: if the classifier errors or is slow, the prompt proceeds — the
 * image model's own provider-side safety is the backstop, and we never want a
 * classifier outage to block paying users on legitimate prompts.
 */
import { anthropicText } from "./anthropic.server";

const SCREEN_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["allow", "block"] },
    reason: { type: "string" },
  },
  required: ["verdict"],
} as const;

const INSTRUCTIONS = `You screen prompts for a CONSUMER AI image/video/music generator, BEFORE generation. Output a verdict: "allow" or "block".

This is a creative tool — be PERMISSIVE. ALLOW (verdict "allow"):
- Horror, scary, creepy, gore, blood, monsters, death, dark or disturbing themes for art/fiction/Halloween
- Fantasy or stylized violence, weapons or battle scenes in an artistic/fictional context
- Mature, edgy, suggestive, or tasteful artistic nudity of clearly-ADULT, fictional subjects
- Satire, politics, memes, provocative or offensive-but-legal concepts
- Anything merely weird, gross, surreal, or in bad taste

BLOCK (verdict "block") ONLY when the prompt clearly seeks one of these:
- Sexual, nude, or suggestive depiction of a minor, or anyone described/implied as a child or underage (CSAM) — zero tolerance
- Sexual/intimate or nude imagery of a REAL, named or identifiable living person (non-consensual / deepfake)
- Realistic instructions or recipes to build weapons, explosives, bioweapons, or other tools of mass harm
- Content that promotes, celebrates, or instructs terrorism or mass violence against real people
- Extreme hateful content that dehumanizes people based on a protected trait (race, religion, etc.)

When uncertain, ALLOW. Only "block" the clearly-illegal or seriously-harmful cases above.`;

/** Classify a creator prompt. Resolves { ok:true } to proceed, or
 *  { ok:false, message } to refuse with a user-facing message. Fails open. */
export async function screenCreatePrompt(text: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const clean = (text || "").trim().slice(0, 1500);
  if (!clean) return { ok: true };
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
    return { ok: true };
  } catch (e) {
    // FAIL OPEN — provider-side model safety is the backstop; never block a
    // real prompt because the classifier timed out or errored.
    console.error("[prompt-safety] screen failed open:", e instanceof Error ? e.message : e);
    return { ok: true };
  }
}
