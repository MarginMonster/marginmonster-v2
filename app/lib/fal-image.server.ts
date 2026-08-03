/* Product-in-hand frame composer — Seedream v4 edit on fal (multi-image
 * reference). Takes the presenter portrait + the product photo and returns
 * frames of the presenter HOLDING the product; HeyGen then animates that
 * frame, so the product stays in hand for the whole ad (Arcads-style).
 * ~$0.03-0.04 per frame on the same FAL_KEY as the video engine.
 *
 * Sync endpoint (images render in ~5-15s). Any failure throws — callers fall
 * back to the plain portrait so a bad compose never blocks a render. */

/** The compose engine. Overridable because "would a different model fix
 *  this?" is a question with a measurable answer, and swapping one should not
 *  need a code change to find out. Seedream v4 edit stays the default until
 *  something beats it on the harness. */
/** Masked inpainting — edits only what the mask exposes, leaves the rest byte-identical. */
const FILL_MODEL = "fal-ai/flux-pro/v1/fill";

/** Which engine composes frames. Read at CALL time, not import time: the
 *  harness's engine A/B loop flips COMPOSE_MODEL between rounds, and the old
 *  import-time constant forced a require-cache purge that crashed the bundled
 *  CI build (require.resolve has nothing to resolve inside a .cjs bundle) —
 *  the A/B was never actually runnable in CI until this. */
export function composeModel(): string {
  return process.env.COMPOSE_MODEL?.trim() || "fal-ai/nano-banana-pro/edit";
}

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
  // One clause, not a paragraph. The long version listed every kind of text
  // that must not appear, which is a list of things for the model to think
  // about drawing. Whether it obeyed is the gate's job to check, not the
  // prompt's job to enumerate.
  const noSourceText = ` Reproduce only the physical product; ignore any marketing text or watermark on the reference photo's background.`;
  // Fine print is where every otherwise-good frame died in the size-matrix
  // sweep: the model INVENTS letters it cannot resolve ("Cog Neodles"). A
  // real photograph solves this with optics — fine print smaller than the
  // lens can resolve goes soft, it doesn't go wrong. Ask for exactly that.
  const textRule = ` Copy all packaging lettering letter-for-letter from the reference photo. Any print too small to reproduce cleanly must appear softly out of focus, the way fine print looks in a real photograph — never invented, scrambled or rearranged letters.`;
  const integrity = `Keep the ${productTitle || "product"} exactly as it is in the second image — same shape, colours, materials, logos and printed text, at its true real-world size against the person.${sizing}`;
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
  // set it on the counter, stand behind it, and talk over the top of it.
  //
  // THE REAL PRODUCT IS BACK IN THE PROMPT. The blank stand-in solved the
  // garbled-packaging problem and created a worse one: whatever the paste
  // didn't cover stayed in the frame as a bright white box — a pedestal, a
  // carton, a slab — foreign in every shot it appeared in. The fix is not a
  // better white box, it is a backing object that CAMOUFLAGES. Let the
  // composer draw its approximation of the actual product; the exact
  // photograph gets pasted over it regardless, so its garbled lettering dies
  // under the paste — and any sliver that peeks out around the edges is
  // case-coloured, reading as depth and shadow instead of a foreign object.
  const showcasePrompt =
    `The exact person from the first image standing behind a kitchen counter or table, with the ${productTitle || "product"} from the second image resting on the surface in front of them, closer to the camera than they are — the COMPLETE item exactly as pictured, with every unit, box and panel it has. ` +
    `Its front is turned square-on to the camera and completely unobstructed: nothing overlaps it, no hands or fingers in front of it. ` +
    `The product sits LOW in the frame — its top edge around the presenter's mid-chest, the whole item inside the BOTTOM THIRD of the frame — and takes up a good part of the width. The presenter is behind and above it, visible from the waist up, their head near the TOP EDGE of the frame with just a little headroom, whole face clearly visible with a wide band of clear space between their chin and the top of the product. ` +
    `One hand rests flat on top of it or curls around its near top corner, in clear contact with it, relaxed and not lifting it. Exactly ONE of the product in the whole image.${sizing}${textRule} ` +
    `Exact same person — same face, same hairstyle, same outfit. ${bg} ` +
    `Filmed from a step further back across the counter so the whole scene fits — a WIDE half-body shot, not a close-up — the way a creator films an unboxing at home: soft window light from the side, shallow depth of field with the room falling off behind, warm and lived-in. NOT a selfie, no arm reaching toward the lens. ` +
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
      // SHORT ON PURPOSE.
      //
      // This prompt started the day at five clauses and ended it at eleven,
      // one per defect: count the fingers, not a selfie, elbows down, face
      // clear, framing, grip, no text. Each addition fixed the thing it named
      // and diluted everything else — the robot hands were the loudest
      // symptom, not the only one. Composition quality tracked prompt length
      // downward the whole way.
      //
      // What belongs here is a DESCRIPTION of the shot. What belongs in the
      // gate is every check about whether we got it. Two of today's additions
      // were genuinely descriptive and stay: the photo is taken by someone
      // else (a selfie needs a hand on the phone, which invents a third arm),
      // and the product sits below the chin. The rest is the gate's problem.
      // "The complete item" earns its place: cutting the prompt back lost it,
      // and three of four holds came back as a single small blind box in place
      // of a twelve-unit display case. That is a description of what to draw,
      // not a check on whether it worked.
      : `The person from the first image holding the ${productTitle || "product"} from the second image — the COMPLETE item exactly as pictured, with every unit, box and panel it has, not one piece of it. ` +
        `Product facing the camera and clearly visible, held in front of them at chest height and below the chin so their face stays visible. ` +
        `${integrity}${noSourceText}${textRule} Exact same person — same face, same hairstyle, same outfit. ${bg} ` +
        `Photographed by someone standing in front of them, not a selfie. ` +
        `Candid smartphone UGC style, vertical portrait, photorealistic, natural skin texture.`;
  const submit = await fetch(`https://queue.fal.run/${composeModel()}`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      // Only blank mode withholds the product photo now. Showcase hands it
      // over on purpose: the drawn approximation is the paste's camouflage.
      image_urls: mode === "blank" ? [portraitUrl] : [portraitUrl, productImageUrl],
      image_size: "portrait_4_3",
      // Fine-print experiment: more output pixels = more room for small
      // lettering to resolve instead of scramble. Opt-in per environment
      // (e.g. "4K" doubles Nano Banana Pro's per-edit price); engines that
      // don't know the field ignore it.
      ...(process.env.COMPOSE_RESOLUTION?.trim() ? { resolution: process.env.COMPOSE_RESOLUTION.trim() } : {}),
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
