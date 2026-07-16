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

  // Queue API, not sync — a held-open fal.run request can outlive request
  // timeouts (the first live test died exactly that way). Submit, poll fast
  // (images land in ~10-25s), bail with a friendly error at ~45s.
  const auth = { Authorization: `Key ${process.env.FAL_KEY}` };
  const submit = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      image_urls: [portraitUrl, productImageUrl],
      image_size: "portrait_4_3",
      num_images: numImages,
      max_images: numImages,
    }),
  });
  if (!submit.ok) throw new Error(`compose submit ${submit.status}: ${(await submit.text()).slice(0, 160)}`);
  const q = (await submit.json()) as { status_url?: string; response_url?: string };
  if (!q.status_url || !q.response_url) throw new Error("compose: no queue urls");

  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const s = await fetch(q.status_url, { headers: auth });
    if (!s.ok) continue;
    const sj = (await s.json()) as { status?: string };
    if (sj.status === "COMPLETED") break;
    if (sj.status === "FAILED" || sj.status === "ERROR") throw new Error(`compose ${sj.status}`);
    if (i === 17) throw new Error("compose is taking longer than usual — tap again in a moment");
  }

  const res = await fetch(q.response_url, { headers: auth });
  if (!res.ok) throw new Error(`compose result ${res.status}`);
  const j = (await res.json()) as { images?: { url?: string }[] };
  const urls = (j.images || []).map((i) => i.url).filter((u): u is string => !!u);
  if (urls.length === 0) throw new Error("compose: no images in result");
  return urls;
}
