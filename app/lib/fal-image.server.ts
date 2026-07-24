/* Product-in-hand frame composer — Seedream v4 edit on fal (multi-image
 * reference). Takes the presenter portrait + the product photo and returns
 * frames of the presenter HOLDING the product; HeyGen then animates that
 * frame, so the product stays in hand for the whole ad (Arcads-style).
 * ~$0.03-0.04 per frame on the same FAL_KEY as the video engine.
 *
 * Sync endpoint (images render in ~5-15s). Any failure throws — callers fall
 * back to the plain portrait so a bad compose never blocks a render. */

const MODEL = "fal-ai/bytedance/seedream/v4/edit";

export function falImageEnabled(): boolean {
  return !!process.env.FAL_KEY;
}

export async function composeHoldingFrames(
  portraitUrl: string,
  productImageUrl: string,
  productTitle: string,
  numImages = 1,
  mode: "hold" | "wear" = "hold"
): Promise<string[]> {
  if (!falImageEnabled()) throw new Error("FAL_KEY not set");

  // Worker-context path (campaign drips): no request deadline, poll up to 2 min.
  const q = await submitCompose(portraitUrl, productImageUrl, productTitle, numImages, mode);
  for (let i = 0; i < 48; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const p = await pollCompose(q.statusUrl, q.responseUrl);
    if (p.done) return p.urls;
  }
  throw new Error("compose: timed out after 2 min");
}

function auth(): Record<string, string> {
  return { Authorization: `Key ${process.env.FAL_KEY}` };
}

/** Queue-URL guard — these round-trip through the browser between polls, so
 *  never let an arbitrary URL ride back in and get our API key attached. */
export function isFalQueueUrl(u: string): boolean {
  return u.startsWith("https://queue.fal.run/");
}

/** Kick off a compose job; returns the queue handles immediately (~1s). */
export async function submitCompose(
  portraitUrl: string,
  productImageUrl: string,
  productTitle: string,
  numImages = 2,
  mode: "hold" | "wear" = "hold"
): Promise<{ statusUrl: string; responseUrl: string }> {
  if (!falImageEnabled()) throw new Error("FAL_KEY not set");
  // Apparel → the presenter WEARS the garment (models it); everything else is
  // held up to camera. "wear" drops the "same outfit" lock so the item replaces
  // their top instead of being clutched on a hanger.
  const prompt =
    mode === "wear"
      ? `The exact person from the first image WEARING the ${productTitle || "item"} from the second image — ` +
        `worn naturally on their body the way it is meant to be worn, realistic fit, drape and placement, replacing any conflicting garment. ` +
        `Same exact person: same face, same hairstyle, same skin tone, same background and lighting as the first image. ` +
        `Waist-up vertical portrait, candid smartphone UGC style, photorealistic, natural skin texture, no distortion.`
      : `The person from the first image holding the ${productTitle || "product"} from the second image ` +
        `up at chest height in one hand, product facing the camera and clearly visible, natural relaxed grip, ` +
        `exact same person — same face, same hairstyle, same outfit, same background and lighting as the first image, ` +
        `candid smartphone selfie UGC style, waist-up vertical portrait, photorealistic, natural skin texture`;
  const submit = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_urls: [portraitUrl, productImageUrl],
      image_size: "portrait_4_3",
      num_images: numImages,
      max_images: numImages,
    }),
  });
  if (!submit.ok) {
    const body = (await submit.text()).slice(0, 200);
    // OUR provider balance is not the merchant's business — mask it, log it loud
    if (/locked|exhausted|balance|top up/i.test(body) || submit.status === 402) {
      console.error(`[compose] FAL BALANCE EXHAUSTED — top up at fal.ai/dashboard/billing (${submit.status}: ${body})`);
      throw new Error("The art engine is recharging — try again in a few minutes.");
    }
    throw new Error(`compose submit ${submit.status}: ${body.slice(0, 160)}`);
  }
  const q = (await submit.json()) as { status_url?: string; response_url?: string };
  if (!q.status_url || !q.response_url || !isFalQueueUrl(q.status_url) || !isFalQueueUrl(q.response_url)) {
    throw new Error("compose: no queue urls");
  }
  return { statusUrl: q.status_url, responseUrl: q.response_url };
}

/** One status check on an in-flight compose. done:false = still cooking. */
export async function pollCompose(
  statusUrl: string,
  responseUrl: string
): Promise<{ done: false } | { done: true; urls: string[] }> {
  if (!isFalQueueUrl(statusUrl) || !isFalQueueUrl(responseUrl)) throw new Error("compose: bad queue url");
  const s = await fetch(statusUrl, { headers: auth() });
  if (!s.ok) return { done: false };
  const sj = (await s.json()) as { status?: string };
  if (sj.status === "FAILED" || sj.status === "ERROR") throw new Error(`compose ${sj.status}`);
  if (sj.status !== "COMPLETED") return { done: false };
  const res = await fetch(responseUrl, { headers: auth() });
  if (!res.ok) throw new Error(`compose result ${res.status}`);
  const j = (await res.json()) as { images?: { url?: string }[] };
  const urls = (j.images || []).map((i) => i.url).filter((u): u is string => !!u);
  if (urls.length === 0) throw new Error("compose: no images in result");
  return { done: true, urls };
}
