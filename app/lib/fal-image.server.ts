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
  mode: "hold" | "wear" = "hold",
  scene?: string,
  scaleHint?: string
): Promise<string[]> {
  if (!falImageEnabled()) throw new Error("FAL_KEY not set");

  // Worker-context path (campaign drips): no request deadline, poll up to 2 min.
  const q = await submitCompose(portraitUrl, productImageUrl, productTitle, numImages, mode, scene, scaleHint);
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
  mode: "hold" | "wear" = "hold",
  scene?: string,
  /** Concrete physical size brief (product-scale.server). "True real-world
   *  size" is an instruction a model can't follow off a white-background
   *  cutout; "roughly 40cm, needs both hands" is. */
  scaleHint?: string
): Promise<{ statusUrl: string; responseUrl: string }> {
  if (!falImageEnabled()) throw new Error("FAL_KEY not set");
  // Product-integrity guard — the #1 compose failure is the product getting
  // warped/restyled, and the #2 is it getting MINIATURIZED (a snowboard
  // shrunk into a hand-held tube). Lock identity AND true real-world scale.
  const sizing = scaleHint ? ` ${scaleHint}` : "";
  // Storefront photos routinely carry the shop's OWN marketing text and
  // watermark burned into the background ("CASE X12", "20 Booster Boxes", a
  // logo badge in the corner). The composer reproduces them faithfully, so
  // they land in the ad — doubled, garbled, and colliding with our own
  // headline. They are not part of the product; say so.
  const noSourceText = ` The reference photo may have the shop's own marketing text, captions, price flashes or a watermark logo sitting on its BACKGROUND — none of that is part of the product. Reproduce ONLY the physical product itself. Do NOT copy, redraw or invent any text, caption, badge or watermark that is not physically printed on the product's own packaging, and never duplicate packaging text. Printed packaging artwork and lettering must keep their EXACT original colors.`;
  const integrity = `Keep the ${productTitle || "product"} identical to the second image — same exact shape, colors, materials, logos and text; do not distort, warp, restyle, crop oddly or add any text. CRITICAL: keep the product at its TRUE real-world size relative to the person — never shrink, miniaturize or turn it into a smaller object. A large item (snowboard, ski, surfboard, chair, rug…) is held upright with both hands or stood on the ground beside the presenter, even if it extends past the frame.${sizing}`;
  // Scene: when the merchant gives a setting/action, put the presenter IN it
  // (drops the "same background" lock); otherwise keep their original backdrop.
  const s = (scene || "").trim().slice(0, 220);
  const bg = s ? `Setting: ${s}, with natural matching lighting.` : `Keep the same background and lighting as the first image.`;
  // Apparel → the presenter WEARS the garment (models it); everything else is
  // held up to camera. "wear" drops the "same outfit" lock so the item replaces
  // their top instead of being clutched on a hanger.
  const prompt =
    mode === "wear"
      ? `The exact person from the first image WEARING the ${productTitle || "item"} from the second image — ` +
        `worn naturally on their body the way it is meant to be worn, realistic fit, drape and placement, replacing any conflicting garment. ` +
        `${integrity}${noSourceText} Same exact person: same face, same hairstyle, same skin tone. ${bg} ` +
        `Waist-up vertical portrait with a little clear headroom above the head, candid smartphone UGC style, photorealistic, natural skin texture, no distortion.`
      : `The person from the first image holding the ${productTitle || "product"} from the second image, ` +
        `product facing the camera and clearly visible — small items held up at chest height in one hand with a natural relaxed grip; ` +
        `large items held upright with both hands or stood beside them at full size. ` +
        `Hands are anatomically correct: five fingers per hand, natural grip, no extra or missing fingers. EXACTLY TWO hands are visible in the whole image and both belong to the presenter — never add a third hand, a spare arm, or a disembodied hand holding the product. ` +
        `${integrity}${noSourceText} Exact same person — same face, same hairstyle, same outfit. ${bg} ` +
        `Candid smartphone selfie UGC style, waist-up vertical portrait with a little clear headroom above the head, photorealistic, natural skin texture.`;
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
