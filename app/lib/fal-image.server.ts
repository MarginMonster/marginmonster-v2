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
  numImages = 1
): Promise<string[]> {
  if (!falImageEnabled()) throw new Error("FAL_KEY not set");

  const prompt =
    `The person from the first image holding the ${productTitle || "product"} from the second image ` +
    `up at chest height in one hand, product facing the camera and clearly visible, natural relaxed grip, ` +
    `exact same person — same face, same hairstyle, same outfit, same background and lighting as the first image, ` +
    `candid smartphone selfie UGC style, waist-up vertical portrait, photorealistic, natural skin texture`;

  const r = await fetch(`https://fal.run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_urls: [portraitUrl, productImageUrl],
      image_size: "portrait_4_3",
      num_images: numImages,
      max_images: numImages,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`compose ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { images?: { url?: string }[] };
  const urls = (j.images || []).map((i) => i.url).filter((u): u is string => !!u);
  if (urls.length === 0) throw new Error("compose: no images in result");
  return urls;
}
