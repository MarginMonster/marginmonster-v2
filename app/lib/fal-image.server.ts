/* Product-in-hand frame composer — Seedream v4 edit on fal (multi-image
 * reference). Takes the presenter portrait + the product photo and returns
 * frames of the presenter HOLDING the product; HeyGen then animates that
 * frame, so the product stays in hand for the whole ad (Arcads-style).
 * ~$0.03-0.04 per frame on the same FAL_KEY as the video engine.
 *
 * Sync endpoint (images render in ~5-15s). Any failure throws — callers fall
 * back to the plain portrait so a bad compose never blocks a render. */

const MODEL = "fal-ai/bytedance/seedream/v4/edit";
/** Masked inpainting — edits only what the mask exposes, leaves the rest byte-identical. */
const FILL_MODEL = "fal-ai/flux-pro/v1/fill";

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
  mode: "hold" | "wear" | "blank" | "showcase" = "hold",
  scene?: string,
  /** Concrete physical size brief (product-scale.server). "True real-world
   *  size" is an instruction a model can't follow off a white-background
   *  cutout; "roughly 40cm, needs both hands" is. */
  scaleHint?: string,
  /** blank mode only: width:height of the real product, so the stand-in has
   *  the right footprint for the photograph that replaces it. */
  aspect?: number
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
  // BLANK STAND-IN. Four attempts from one reference photo produced four
  // different objects — a 12-count display case came back as a single box, a
  // four-box strip, and a red metal lunchbox with clasps. Asking harder is
  // what produced the robot hands, so stop asking: have the model draw a
  // featureless box, which is the one thing it renders reliably, and paste
  // the merchant's actual photograph onto it afterwards. Nothing to
  // reinvent, nothing to misspell, and one unambiguous outline to paste onto.
  // A vague shape word got a squat box for a near-square product, and the
  // pasted photograph then had nowhere to go. Give the ratio as a number.
  const shape = !aspect
    ? "roughly square, about as wide as it is tall"
    : aspect >= 1.15
      ? `about ${aspect.toFixed(1)} times as WIDE as it is tall — a wide, letterbox-shaped front face`
      : aspect <= 0.87
        ? `about ${(1 / aspect).toFixed(1)} times as TALL as it is wide — an upright, portrait-shaped front face`
        : "square — the front face is as wide as it is tall";
  const blankPrompt =
    `The exact person from the first image holding a PLAIN UNMARKED BOX up to the camera at chest height. ` +
    `The box is a simple matte light-grey cardboard box whose front face is ${shape}, with completely blank faces — no printing, no text, no logo, no label, no artwork, no tape, no barcode, no branding of any kind. Smooth even surfaces and clean straight edges. ` +
    `Its front face is square-on to the camera and entirely unobstructed: no fingers, thumbs or hair cross in front of it, and nothing overlaps it. ` +
    `They are actually holding it — fingers gripping the left and right EDGES of the box, thumbs on the front edge only at the far left and far right corners, its weight resting in both hands. Only the presenter's own two hands are in the picture. ` +
    `Frame the shot from the top of the head down to the hips, with the head in the TOP THIRD of the picture. The box is held low, at the bottom of the ribcage, so the whole middle of the chest is visible empty between the chin and the top of the box. The presenter's face is entirely unobstructed — eyes, nose, mouth and chin all clearly visible with space to spare. ` +
    `Exactly ONE box in the whole image.${sizing} ` +
    `Exact same person — same face, same hairstyle, same outfit. ${bg} ` +
    `The photo is taken BY SOMEONE ELSE standing in front of them — NOT a selfie, no arm reaching toward the lens. ` +
    `Candid smartphone UGC style, vertical portrait, photorealistic, natural skin texture.`;

  // SHOWCASE — the shot creators actually post for anything bigger than a
  // hand. Nobody holds a twelve-count display case up to their own face; they
  // set it on the counter, stand behind it, and talk over the top of it. That
  // framing is also the only one where a large product and an unobstructed
  // face can both exist, which is why every attempt to shrink a case into a
  // chest-up hold ended with it over somebody's mouth.
  const showcasePrompt =
    `The exact person from the first image standing behind a kitchen counter or table, with a PLAIN UNMARKED BOX resting on the surface in front of them, closer to the camera than they are. ` +
    `The box is a simple matte light-grey cardboard box whose front face is ${shape}, with completely blank faces — no printing, no text, no logo, no label, no artwork, no tape, no barcode, no branding of any kind. Smooth even surfaces, clean straight edges. ` +
    `Its front face is turned square-on to the camera and completely unobstructed: nothing overlaps it, no hands or fingers in front of it. ` +
    `The box sits in the LOWER HALF of the frame and takes up a good part of the width. The presenter is behind and above it, head in the TOP THIRD, their whole face clearly visible with plenty of clear space between their chin and the top of the box — the box never rises past their shoulders. ` +
    `One hand rests lightly on the surface beside the box or gestures toward it, open and relaxed; they are NOT lifting it. Exactly ONE box in the whole image.${sizing} ` +
    `Exact same person — same face, same hairstyle, same outfit. ${bg} ` +
    `Shot from slightly above at chest height by someone standing across the counter, the way a creator films an unboxing at home: soft window light from the side, shallow depth of field with the room falling off behind, warm and lived-in. NOT a selfie, no arm reaching toward the lens. ` +
    `Candid smartphone UGC style, vertical portrait, photorealistic, natural skin texture.`;

  const prompt =
    mode === "showcase"
      ? showcasePrompt
      : mode === "blank"
      ? blankPrompt
      : mode === "wear"
      ? `The exact person from the first image WEARING the ${productTitle || "item"} from the second image — ` +
        `worn naturally on their body the way it is meant to be worn, realistic fit, drape and placement, replacing any conflicting garment. ` +
        `${integrity}${noSourceText} Same exact person: same face, same hairstyle, same skin tone. ${bg} ` +
        `Waist-up vertical portrait with a little clear headroom above the head, candid smartphone UGC style, photorealistic, natural skin texture, no distortion.`
      : `The person from the first image holding the ${productTitle || "product"} from the second image, ` +
        `product facing the camera and clearly visible — small items held up at chest height in one hand with a natural relaxed grip; ` +
        `large items held upright with both hands or stood beside them at full size. ` +
        // WE caused the robot hands. Chasing a six-finger frame, this grew into
        // four consecutive sentences of clinical finger anatomy — count the
        // digits, hide the thumb, never wooden — and a diffusion model renders
        // what the prompt dwells on. Told to treat fingers as countable
        // articulated parts, Seedream drew countable articulated parts:
        // segmented, jointed, doll-like. Every extra word about fingers made it
        // worse. So describe the GRIP, once, in plain language, and let the
        // model draw a hand the way it already knows how.
        // "Cupping it from the sides" got flat open palms held BESIDE the
        // product, not touching it — three of four presenters ended up
        // presenting a box that floats. Say where the hands make contact.
        `They are actually holding it: fingers over the front edges, thumbs underneath, its weight resting in both palms, the way anyone picks something up off a shelf. The hands touch the product. Only the presenter's own two hands are in the picture. ` +
        // The product is the pitch, but the presenter is the ad. A case held up
        // over the mouth is a frame with nobody talking in it.
        `The product is held at chest height, BELOW the chin — the presenter's whole face stays unobstructed, with eyes, nose and mouth fully visible above the product. Never raise the product in front of the face. ` +
        `${integrity}${noSourceText} Exact same person — same face, same hairstyle, same outfit. ${bg} ` +
        // NOT a selfie. A selfie needs a hand on the phone, so asking for one
        // while both hands hold the product forces the model to invent a third
        // arm reaching toward the lens. Someone else is taking this photo.
        `The photo is taken BY SOMEONE ELSE standing in front of them — this is NOT a selfie and the presenter is NOT holding the camera. ` +
        `Both arms stay bent with the elbows down and close to the body; no arm reaches out toward the lens or extends off-frame toward the camera. ` +
        `Candid smartphone UGC style, waist-up vertical portrait with a little clear headroom above the head, photorealistic, natural skin texture.`;
  const submit = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      // Blank mode deliberately withholds the product photo. Handing it over
      // is an invitation to redraw the packaging, which is the failure being
      // designed out.
      image_urls: mode === "blank" || mode === "showcase" ? [portraitUrl] : [portraitUrl, productImageUrl],
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


/** Masked inpaint — the merchant's product pixels stay FROZEN and only the
 *  region under the white mask is redrawn.
 *
 *  This is what the product-photography tools all do (Photoroom, Flair,
 *  Pebblely): never regenerate the product, isolate it and generate around
 *  it. We had been doing the opposite — asking a model to redraw the
 *  packaging and then grading how close it got. It got a red lunchbox.
 *
 *  Used to put fingers back over the edges of a pasted product so it reads as
 *  held rather than stuck on. Data URIs so a frame that only exists on our
 *  render disk can be edited without a public address. */
export async function inpaintFill(
  imageDataUri: string,
  maskDataUri: string,
  prompt: string
): Promise<string | undefined> {
  if (!falImageEnabled()) return undefined;
  const submit = await fetch(`https://queue.fal.run/${FILL_MODEL}`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, image_url: imageDataUri, mask_url: maskDataUri, num_images: 1 }),
  });
  if (!submit.ok) {
    console.warn(`[inpaint] submit ${submit.status}: ${(await submit.text()).slice(0, 160)}`);
    return undefined;
  }
  const q = (await submit.json()) as { status_url?: string; response_url?: string };
  if (!q.status_url || !q.response_url || !isFalQueueUrl(q.status_url) || !isFalQueueUrl(q.response_url)) return undefined;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const p = await pollCompose(q.status_url, q.response_url);
      if (p.done) return p.urls?.[0];
    } catch (e) {
      console.warn(`[inpaint] ${(e as Error).message.slice(0, 120)}`);
      return undefined;
    }
  }
  return undefined;
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
