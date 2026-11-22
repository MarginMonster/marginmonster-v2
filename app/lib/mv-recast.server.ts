/* A scene's words, rewritten for who is in it now (see mv-recast.ts for why, and for every rule).
 * The writer model does the language; the plain rewrite stands behind it. Never throws, never waits long:
 * the scene is about to be drawn, and words that merely keep an odd pronoun are better than no picture. */
import { anthropicText } from "./anthropic.server";
import { recastAccept, recastNeeded, recastPrompt, recastVisual, type Recast } from "./mv-recast";

/** How long the writer gets before the plain rewrite is used instead. */
const RECAST_WAIT_MS = 12_000;

export async function recastSceneText(visual: string, who: Recast, performing: boolean): Promise<{ visual: string; by: "kept" | "writer" | "rule" }> {
  if (!recastNeeded(visual, who)) return { visual, by: "kept" };
  const plain = recastVisual(visual, who);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      anthropicText(recastPrompt(visual, who, performing), { model: "claude-sonnet-5", maxTokens: 220 }),
      new Promise<string>((_, no) => { timer = setTimeout(() => no(new Error("recast: the writer took too long")), RECAST_WAIT_MS); }),
    ]);
    const ok = recastAccept(raw, visual, who);
    if (ok) return { visual: ok, by: "writer" };
    console.warn(`[mv-recast] the writer's answer was not usable — the plain rewrite is used ("${String(raw).replace(/\s+/g, " ").slice(0, 160)}")`);
  } catch (e) {
    console.warn(`[mv-recast] no answer from the writer — the plain rewrite is used (${e instanceof Error ? e.message.slice(0, 140) : String(e)})`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { visual: plain, by: "rule" };
}
