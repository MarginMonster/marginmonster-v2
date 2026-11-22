/** The FIRST complete JSON object in a model's answer — or null.
 *
 * A reader asked for "ONLY this JSON" sometimes answers, then writes "Wait, let me re-read…" and a second
 * block (seen on the real reader, 2026-11-22: its first answer was the right one). Taking everything from
 * the first "{" to the last "}" then parses nothing at all; so does a fenced ```json block followed by
 * prose that mentions a brace. This walks from the first "{" to the brace that closes it — strings and
 * escapes respected — and parses just that. */
export function firstJson(raw: string | null | undefined): Record<string, unknown> | null {
  const text = String(raw || "");
  const a = text.indexOf("{");
  if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === "\"") inStr = false; continue; }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try { const j = JSON.parse(text.slice(a, i + 1)); return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null; } catch { return null; }
    }
  }
  return null;
}
