// Direct Anthropic Messages API client via fetch — no SDK.
// The @anthropic-ai/sdk package doesn't bundle reliably in the Vite/Remix
// SSR build (its internal fetch shim throws a generic "Connection error"),
// so we call the HTTP API directly. This also surfaces real status codes.

import { fetchRetry } from "./http-retry.server";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface AnthropicOptions {
  model?: string;
  maxTokens?: number;
}

/** claude-sonnet-5 runs ADAPTIVE THINKING by default when the request has no
 *  `thinking` field, and max_tokens caps thinking + visible text TOGETHER. At
 *  our small budgets the model was spending most of the budget thinking and
 *  the visible answer came out empty (looked like a refusal) or truncated
 *  mid-sentence — the "Every t." two-word ad script, the water-bottle scripts
 *  that "refused" four times, and the original truncated-JSON gate verdicts
 *  were all this one default. Our calls are short structured outputs (30-word
 *  scripts, JSON verdicts); they don't need thinking, they need the budget.
 *  Sonnet 5 accepts an explicit disabled; other models we use keep their
 *  default behaviour, so only sonnet-5 gets the field. */
function thinkingFieldFor(model: string): Record<string, unknown> {
  return model.startsWith("claude-sonnet-5") ? { thinking: { type: "disabled" } } : {};
}

export async function anthropicText(
  prompt: string,
  opts: AnthropicOptions = {}
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Server is missing ANTHROPIC_API_KEY. Add it in Render → Environment, then redeploy."
    );
  }
  // Guard against a masked/hidden value being pasted (bullets, smart quotes,
  // etc.) — API keys are plain ASCII. This produces a clear message instead of
  // a cryptic ByteString error.
  if (!/^[\x20-\x7E]+$/.test(key)) {
    throw new Error(
      "ANTHROPIC_API_KEY contains non-standard characters (it looks like the masked •••• value was copied). " +
        "Go to console.anthropic.com/settings/keys, copy the REAL key, and paste it into Render → Environment."
    );
  }

  const model = opts.model || "claude-haiku-4-5-20251001";
  const maxTokens = opts.maxTokens || 1024;

  // Retried: this is the FIRST step of every paid pipeline (the script), and a
  // single 429/529/5xx here terminal-failed a pre-paid job before a cent of
  // provider spend had bought anything. fetchRetry honours retry-after and
  // returns the final response, so the error formatting below is unchanged.
  let res: Response;
  try {
    res = await fetchRetry(
      ANTHROPIC_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...thinkingFieldFor(model),
          messages: [{ role: "user", content: prompt }],
        }),
      },
      { label: "anthropic", attempts: 5, totalCapMs: 90_000 }
    );
  } catch (e) {
    throw new Error(
      `Network error reaching Anthropic: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${bodyText.slice(0, 400)}`);
  }

  let json: { content?: Array<{ type: string; text?: string }> };
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error("Anthropic returned invalid JSON");
  }

  const block = json.content?.find((c) => c.type === "text");
  return block?.text || "";
}

/** Shopify CDN serves ORIGINALS — routinely past the API's 8000px image
 *  limit — and a ten-product sweep lost three products to 400s because of it.
 *  Worse, the production gate swallows that 400 as a QA outage and passes the
 *  frame, so any merchant with big product photos was silently ungated. The
 *  CDN resizes on request; ask it for a vision-sized rendition. */
function visionSafeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)cdn\.shopify\.com$/i.test(u.hostname) && !u.searchParams.has("width")) {
      u.searchParams.set("width", "1568");
      return u.toString();
    }
  } catch { /* not a URL we can improve */ }
  return url;
}

/** Vision call — same raw-fetch client, with image URLs attached. Used by the
 *  image-ad QA gate to score product fidelity before a still ships.
 *
 *  Accepts `data:image/...;base64,...` alongside http(s) URLs. Frames we build
 *  ourselves — an ffmpeg composite, say — live on the render disk before they
 *  have a public address, and outside production there may be no public
 *  address at all. Those still have to be gradeable, so they go up inline. */
export async function anthropicVision(
  prompt: string,
  imageUrls: string[],
  opts: AnthropicOptions = {}
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const model = opts.model || "claude-haiku-4-5-20251001";
  const content: unknown[] = imageUrls.map((url) => {
    const inline = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(url);
    if (inline) {
      return { type: "image", source: { type: "base64", media_type: inline[1].toLowerCase(), data: inline[2] } };
    }
    return { type: "image", source: { type: "url", url: visionSafeUrl(url) } };
  });
  content.push({ type: "text", text: prompt });
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens || 500,
      ...thinkingFieldFor(model),
      messages: [{ role: "user", content }],
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${bodyText.slice(0, 300)}`);
  const json = JSON.parse(bodyText) as { content?: Array<{ type: string; text?: string }> };
  return json.content?.find((c) => c.type === "text")?.text || "";
}
