// Direct Anthropic Messages API client via fetch — no SDK.
// The @anthropic-ai/sdk package doesn't bundle reliably in the Vite/Remix
// SSR build (its internal fetch shim throws a generic "Connection error"),
// so we call the HTTP API directly. This also surfaces real status codes.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export interface AnthropicOptions {
  model?: string;
  maxTokens?: number;
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

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
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
