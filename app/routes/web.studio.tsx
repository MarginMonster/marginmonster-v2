/* Web Studio — the SAME experience as the embedded Content Studio, minus
 * Shopify: big content-type tiles with live renders, per-presenter cartoon
 * style grids, presenter cards with voice previews, tier lock badges, the
 * engine picker, Commercial look, service mode, hold/wear, Advanced
 * prompting, Brand Face and import-by-URL. Same token costs, same
 * server-side capability gates, same worker pipelines. Product input =
 * name + photo (upload, URL, or scraped from any store's product page). */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { trimToWord } from "../lib/text-trim";
import { Form, Link, useActionData, useLoaderData, useNavigation, useOutletContext, useRevalidator, useSearchParams, useSubmit } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Ico } from "../lib/icons";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { planTrialing, refundTokens, spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { enqueueJob } from "../lib/job-queue.server";
import { TOKEN_COST } from "../lib/plan-config";
import { uploadFileName, type UploadExt } from "../lib/upload-names";
import { assertCapability, capabilitiesFor, videoCapabilityFor } from "../lib/capabilities.server";
import { LIVE_AVATARS, avatarImg, DESIGNED_VOICES, privateCastFor } from "../lib/avatars";
import { AD_TEMPLATES, AD_TEMPLATE_BY_KEY } from "../lib/ad-templates";
import { AD_FORMATS, AD_FORMAT_BY_KEY, FORMAT_GROUPS, type AdFormat } from "../lib/ad-formats";
import { CREATE_STYLES } from "../lib/create-styles";
import { MUSIC_STYLES, MUSIC_STYLE_BY_KEY } from "../lib/music-styles";
import { VIDEO_ENGINES, engineSurcharge, normalizeEngineKey } from "../lib/video-engines";
import { resolveImageOrPage, scrapeProductPage } from "../lib/product-scrape.server";
import { CATALOG_CAP, storeOrigin } from "../lib/catalog-import.server";
import { SIZE_CHOICES } from "../lib/product-scale";

// Merchants keep several of these open at once; an untitled tab is just a URL.
export const meta = () => [{ title: "Studio · EasyMode" }];

// Mirrors the embedded Studio's pickers (same keys, names, live art routes).
const CONTENT_TYPES = [
  { key: "avatar", name: "Avatar AI", cover: "/style-tiles/avatarcover.jpg?v=4", sub: "A real-looking presenter talks it up", cap: "video", tier: "Studio", price: 39 },
  { key: "highlight", name: "Product Highlight", cover: "/ad-templates/phcover.jpg?v=1", sub: "Cinematic motion, no presenter", cap: "video", tier: "Studio", price: 39 },
  { key: "cartoon", name: "Cartoon Avatar", cover: "/style-tiles/cover.jpg?v=4", sub: "Your presenter & product, redrawn viral-style", cap: "cartoon", tier: "Studio", price: 39 },
  { key: "jingle", name: "Anthem", cover: "/style-tiles/anthemcover.jpg?v=4", sub: "A stuck-in-your-head theme song — iconic 2000s commercial energy", cap: "anthem", tier: "Studio", price: 39 },
  { key: "commercial", name: "Commercial", cover: "/showcase/commercial-cover.jpg?v=2", sub: "A cinematic multi-scene story ad with a big-budget commercial feel", cap: "video", tier: "Studio", price: 39 },
  { key: "review", name: "Creator Demo", cover: "/ad-templates/ctcover-review.jpg?v=1", sub: "A creator's phone-shot product demo — social-feed real", cap: "video", tier: "Studio", price: 39 },
  { key: "unboxing", name: "Unboxing", cover: "/ad-templates/ctcover-unboxing.jpg?v=1", sub: "The box opens on camera — first impressions, real reactions", cap: "video", tier: "Studio", price: 39 },
  { key: "asmr", name: "Satisfying Close-Up", cover: "/ad-templates/ctcover-asmr.jpg?v=1", sub: "Macro textures in slow motion — the loop nobody scrolls past", cap: "video", tier: "Studio", price: 39 },
] as const;

// The three PRESET types ride the avatar/highlight pipelines with a baked-in
// creative direction — translated at submit so the queue, the capability
// gate and the pipelines never learn new keys.
/* BURST — make several at once instead of tapping generate over and over.
 * It gives the merchant a set of usable variations to post or test in one go,
 * not "pick one, bin the rest" — every take should be good. Caps differ because
 * the money does — an image is 5 tokens, a video is 60+, so a ten-video burst
 * would empty most wallets on a single tap. Shared by the picker UI and the
 * action that charges. */
const MAX_BURST = { image: 10, video: 3 } as const;
const BURST_STEPS = { image: [1, 3, 5, 10], video: [1, 2, 3] } as const;
/** Stagger a burst across the queue instead of dropping ten jobs in at once.
 *  Every item is a full pipeline making several provider calls, and ten of
 *  them starting together is how a compose gets rate-limited into falling
 *  back to a plain product still — which is what a merchant reported. 25s
 *  apart costs the merchant nothing they'd notice and keeps each render on
 *  the good path. The first one runs immediately. */
function burstRunAt(i: number): Date | undefined {
  return i === 0 ? undefined : new Date(Date.now() + i * 25_000);
}

function burstCount(form: FormData, max: number): number {
  const n = parseInt((form.get("burst") as string) || "1", 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : 1;
}

const CT_PRESETS: Record<string, { base: "avatar" | "highlight"; direction: string }> = {
  review: { base: "avatar", direction: "Film it like a creator's phone-shot product demo for social: casual selfie framing, natural light, upbeat first-person walkthrough of what the product does and why it's cool — organic UGC energy, not a polished ad. Do NOT claim to be a customer or to have bought or owned it." },
  unboxing: { base: "avatar", direction: "An excited first-impressions unboxing: they open the package on camera, lift the product out, react genuinely, and show it close to the lens." },
  asmr: { base: "highlight", direction: "An oddly-satisfying ASMR-style macro edit: extreme close-ups, slow luxurious motion, rich textures, droplets and light play — a mesmerizing loop that stops the scroll." },
};
// What a preset key renders AS — everything downstream keys off the base.
const baseOf = (ct: string | null | undefined) => (ct && CT_PRESETS[ct] ? CT_PRESETS[ct].base : ct);

const CARTOON_STYLES = [
  { key: "dreamanime", name: "Dream Anime", tint: "#6FAF7C", blurb: "Your presenter as a soft painterly anime character — the style the whole internet shares" },
  { key: "toyfigure", name: "Boxed Figure", tint: "#F4B400", blurb: "Presenter & product as a collectible figure in the pack — the viral format" },
  { key: "papercut", name: "Paper Craft", tint: "#E58A4E", blurb: "A handmade layered-paper diorama — the craft style feeds fall in love with" },
  { key: "pixar", name: "3D Toon", tint: "#34C3E7", blurb: "Big-studio 3D character film — glossy and cinematic" },
  { key: "retroanime", name: "Retro Anime", tint: "#E5397D", blurb: "90s VHS anime — sunset palettes and speed lines" },
  { key: "vintagetoon", name: "Vintage Toon", tint: "#E7A33C", blurb: "Playful vintage 2D — hand-inked, storybook warmth" },
  { key: "puppet", name: "Felt Puppet", tint: "#8E5BD9", blurb: "Fuzzy felt and googly eyes — puppet-show charm" },
  { key: "clay", name: "Claymation", tint: "#B08526", blurb: "Hand-molded stop-motion, cozy and tactile" },
];

// Wearable products should be modeled (worn) by the presenter, not held.
const APPAREL_RE = /\b(shirt|tee|t-shirt|top|blouse|hoodie|sweat(er|shirt)?|jacket|coat|dress|skirt|pant|trouser|jean|short|legging|activewear|apparel|clothing|clothes|hat|cap|beanie|scarf|sock|jersey|uniform|robe|gown|cardigan|blazer|vest|romper|jumpsuit|swimsuit|bikini|lingerie|underwear|bra|glove|wear|outfit|garment|tank|polo)\b/i;
function isApparel(text: string): boolean { return APPAREL_RE.test(text); }

// One-tap blog angles — the picker that standardizes what kind of article you get.
const BLOG_ANGLES: { icon: string; label: string; prompt: string }[] = [
  { icon: "clipboard", label: "Buyer's Guide", prompt: "a practical buyer's guide that helps a shopper choose the right option — what to look for, common mistakes to avoid, and why this product fits" },
  { icon: "wrench", label: "How-To", prompt: "a step-by-step how-to that helps the reader get the most out of the product, with clear numbered steps and pro tips" },
  { icon: "star", label: "Best-Of List", prompt: "a curated best-of listicle ranking top picks or use-cases, positioning this product as the standout choice" },
  { icon: "question", label: "FAQ", prompt: "an FAQ-style post answering the real questions shoppers ask before buying, each answer building confidence to purchase" },
  { icon: "book", label: "Brand Story", prompt: "a short brand-story feature connecting the product to a relatable customer moment and the values behind it" },
  { icon: "gift", label: "Gift Guide", prompt: "a gift-guide angle framing the product as the perfect gift for specific people and occasions" },
];

const decodeEntities = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const { customCastFor } = await import("../lib/custom-avatars.server");
  const custom = await customCastFor(shop.id);
  const cast = [
    ...custom.filter((c) => c.status === "ready").map((c) => ({ id: c.id, name: c.name, img: c.img, designed: false })),
    ...[...privateCastFor(account.email, shop.id, shop.domain), ...LIVE_AVATARS].map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), designed: DESIGNED_VOICES.has(a.id) })),
  ];
  const forgingAvatars = custom
    .filter((c) => c.status !== "ready")
    .map((c) => ({ name: c.name, status: c.status, startedAt: c.createdAt.toISOString() }));
  const brandFaceId = shop.brandAvatarId && cast.some((c) => c.id === shop.brandAvatarId) ? shop.brandAvatarId : null;
  // The merchant's own catalogue, mirrored by the importer. Present = the
  // Studio can offer a picker instead of asking for a link every single time.
  const [catalog, catalogCount, syncing] = await Promise.all([
    db.catalogProduct.findMany({
      where: { shopId: shop.id },
      orderBy: { position: "asc" },
      take: 400,
      select: { id: true, title: true, url: true, imageUrl: true, priceText: true },
    }),
    db.catalogProduct.count({ where: { shopId: shop.id } }),
    // THE LAST IMPORT, WHATEVER HAPPENED TO IT.
    //
    // This asked only for a LIVE import, so a failed one was invisible: the
    // merchant saw "Import queued — your products will appear here shortly",
    // then a spinner that says it updates itself, then nothing — an empty
    // catalogue and no explanation anywhere in the product. Meanwhile
    // catalog-import throws messages written FOR them ("Double-check the
    // address — or keep pasting individual product links, which always
    // works"), which reached a server log and stopped there.
    //
    // Taking the most recent job of any status makes this self-clearing: a
    // later successful import is a newer row, so the error goes away on its
    // own rather than nagging forever.
    db.job.findFirst({
      where: { shopId: shop.id, type: "IMPORT_CATALOG" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, status: true, lastError: true },
    }),
  ]);
  return json({
    catalog,
    catalogCount,
    // Said next to the count, because the count on its own reads as "your
    // catalogue is here" when the import stopped at the ceiling.
    catalogTruncated: !!shop.catalogTruncatedAt,
    catalogSyncing: syncing?.status === "PENDING" || syncing?.status === "IN_PROGRESS",
    // Only when the MOST RECENT attempt is the failed one.
    catalogFailed: syncing?.status === "FAILED" ? syncing.lastError || "That import didn't complete." : null,
    // Real start time, so the elapsed counter survives a reload instead of
    // restarting at zero and making a long import look stuck.
    catalogSyncStartedAt:
      syncing?.status === "PENDING" || syncing?.status === "IN_PROGRESS"
        ? syncing.createdAt.toISOString()
        : null,
    // A trial that's out of tokens shouldn't strand the merchant until day 7.
    trialing: planTrialing(shop.activePlan),
    hasBrand: !!shop.brandProfile,
    hasPlan: !!shop.activePlan?.active,
    tokens: tokensRemainingLive(shop.activePlan),
    caps: [...capabilitiesFor(shop.activePlan)] as string[],
    cast,
    brandFaceId,
    forgingAvatars,
    templates: AD_TEMPLATES.map((t) => ({ key: t.key, name: t.name, emoji: t.emoji, blurb: t.blurb, kind: t.kind })),
    costs: { video: TOKEN_COST.video, image: TOKEN_COST.image, blog: TOKEN_COST.blog, music: TOKEN_COST.music, faceless: TOKEN_COST.faceless },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  // Crown a presenter as the Brand Face (no plan/brand gate needed).
  if (intent === "setBrandFace") {
    const id = ((form.get("avatarId") as string) || "").trim() || null;
    await db.shop.update({ where: { id: shop.id }, data: { brandAvatarId: id, brandAvatarVariant: 0 } });
    return json({ brandFaceSet: true });
  }

  // Out of trial tokens and ready to go? Bill now rather than making them wait
  // out the clock. Stripe closes the trial and raises the first invoice.
  if (intent === "endTrial") {
    const { endTrialNow } = await import("../lib/stripe.server");
    const { account } = await requireWebIdentity(request);
    const r = await endTrialNow(account.id);
    return r.ok
      ? json({ trialEnded: "You're on the full plan — your whole allowance just unlocked." })
      : json({ error: r.error });
  }

  // Mirror the merchant's whole storefront so they can pick from a grid instead
  // of pasting a link every time. Queued, never inline: a sitemap-crawled store
  // is hundreds of fetches against their own server.
  if (intent === "importCatalog") {
    const storeUrl = ((form.get("storeUrl") as string) || "").trim();
    try {
      storeOrigin(storeUrl); // validates + blocks private hosts before queueing
    } catch (e) {
      return json({ catalogError: e instanceof Error ? e.message : "That doesn't look like a web address." });
    }
    // A second submission usually means the merchant spotted a typo in the
    // first one. This used to answer "queued!" and silently drop the new URL,
    // so the wrong address kept importing, the corrected one never ran, and
    // re-submitting did nothing until the bad crawl finished — with no hint
    // anywhere that the address they were looking at was being ignored.
    const running = await db.job.findMany({
      where: { shopId: shop.id, type: "IMPORT_CATALOG", status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true, status: true, payload: true },
      orderBy: { createdAt: "desc" },
    });
    const sameUrl = (p: string) => {
      try { return ((JSON.parse(p) as { storeUrl?: string }).storeUrl || "") === storeUrl; } catch { return false; }
    };
    // Already importing this exact address — nothing to do.
    if (running.some((j) => sameUrl(j.payload))) return json({ catalogQueued: true });

    // A CRAWL IS EXPENSIVE AND THIS PAGE IS REACHABLE WITHOUT A PLAN.
    //
    // Importing a catalogue is hundreds of fetches against someone else's
    // server, queued on a worker that runs one job at a time for every tenant.
    // It sits above the "pick a plan first" gate on purpose — a new merchant
    // has to be able to connect their store before they subscribe — so the
    // bound has to come from somewhere else. The dedupe below only catches the
    // same address twice; varying the URL walked straight past it.
    //
    // Correcting a typo takes a couple of goes. Six an hour is generous for
    // that and useless as an amplifier.
    const crawls = await db.job.count({
      where: {
        shopId: shop.id,
        type: "IMPORT_CATALOG",
        createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
      },
    });
    if (crawls >= 6) {
      return json({ catalogError: "That's a lot of imports in one hour — give the last one time to finish and try again shortly." });
    }

    // Re-point anything still waiting: it has not started, so it can simply
    // carry the corrected address instead.
    const pending = running.filter((j) => j.status === "PENDING");
    if (pending.length > 0) {
      await db.job.updateMany({
        where: { id: { in: pending.map((j) => j.id) }, status: "PENDING" },
        data: { payload: JSON.stringify({ storeUrl, cap: CATALOG_CAP }) },
      });
    } else {
      // Only an in-flight crawl of the old address exists. It cannot be
      // redirected mid-run, so queue the correction behind it — the worker is
      // serial, and the good import lands second and wins.
      await enqueueJob(shop.id, "IMPORT_CATALOG", { storeUrl, cap: CATALOG_CAP });
    }
    // Store the NORMALIZED origin, never the raw field. The placeholder reads
    // "yourstore.com" and the button is type="button", so type="url" never
    // validates — a merchant typing exactly what is shown saved a schemeless
    // value. catalog-import rewrites it the same way, but only AFTER a
    // successful discoverCatalog(), so every merchant whose import failed kept
    // it forever: lp.$slug blanked the buy button (a paid landing page with
    // nothing to click) and both /go turnstiles threw on new URL() and sent
    // their shoppers to easymodeapp.com instead of the merchant's store.
    await db.shop.update({ where: { id: shop.id }, data: { storeUrl: storeOrigin(storeUrl).origin } }).catch(() => { /* column is optional */ });
    return json({ catalogQueued: true });
  }

  // Import a product by URL — scrapes any storefront's page for a title +
  // image (JSON-LD → og: → <title>), with a Shopify /products/*.js shortcut.
  if (intent === "importUrl") {
    try {
      const p = await scrapeProductPage((form.get("url") as string) || "");
      // GROUND THE ONE-OFF PRODUCT, TOO. A pasted single URL never reached the
      // catalogue, so generateImageAd's by-title lookup (description, price,
      // buy-link) all missed and the copywriter fell back to invented specs.
      // Mirror this one product exactly as importCatalog mirrors each (keyed by
      // shopId_url) so the existing by-title grounding just works — no new field
      // threaded through the generate payload. Best-effort: a failed mirror must
      // never break the import the merchant actually asked for.
      if (p.title) {
        try {
          const data = {
            title: p.title.slice(0, 200),
            imageUrl: p.image || null,
            priceText: p.price || null,
            description: p.description || null,
            lastSeenAt: new Date(),
          };
          await db.catalogProduct.upsert({
            where: { shopId_url: { shopId: shop.id, url: p.url } },
            create: { shopId: shop.id, url: p.url, ...data },
            update: data,
          });
        } catch (e) {
          console.warn("[studio] single-URL catalogue mirror failed (non-fatal):", e instanceof Error ? e.message.slice(0, 120) : e);
        }
      }
      return json({ imported: { title: p.title || "", image: p.image || null, url: p.url } });
    } catch (e) {
      return json({ importError: e instanceof Error ? e.message : "Couldn't import from that URL." });
    }
  }

  // "Turn your brand mascot into a marketing tool" — forge a private
  // presenter from an uploaded reference. Queued: four renders take ~90s.
  if (intent === "forgeAvatar") {
    if (!shop.activePlan?.active) return json({ avatarError: "Pick a plan first — the forge runs on tokens." });
    const name = ((form.get("avatarName") as string) || "").trim().slice(0, 40);
    if (!name) return json({ avatarError: "Give your presenter a name." });
    const gender = form.get("avatarGender") === "f" ? "f" : "m";
    const ref = form.get("avatarPhoto");
    if (!ref || typeof ref === "string" || ref.size === 0) return json({ avatarError: "Upload a photo of your mascot or spokesperson." });
    if (!/^image\//.test(ref.type)) return json({ avatarError: "That file isn't an image — use a JPG, PNG or WebP." });
    if (ref.size > 8 * 1024 * 1024) return json({ avatarError: "Image too large — keep it under 8 MB." });
    const [fsMod, pathMod, crypto] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto")]);
    const ext = ref.type === "image/png" ? "png" : ref.type === "image/webp" ? "webp" : "jpg";
    const dir = pathMod.join(process.cwd(), "data", "renders", "uploads");
    fsMod.mkdirSync(dir, { recursive: true });
    // Built by the same module that allowlists it — see app/lib/upload-names.ts.
    const fileName = uploadFileName(shop.id, crypto.randomBytes(8).toString("hex"), ext as UploadExt, "mascot");
    fsMod.writeFileSync(pathMod.join(dir, fileName), Buffer.from(await ref.arrayBuffer()));
    // THE FORGE COSTS US FOUR RENDERS AND CHARGED FOR NONE.
    //
    // The guard above already tells the merchant "the forge runs on tokens",
    // and then nothing took any: no spendTokens, no in-flight guard, no cap on
    // how many presenters a shop could forge. Every submit queued a job that
    // renders one portrait per outfit — four paid generations, in parallel —
    // so pressing the button repeatedly was free to the merchant and billed to
    // us, without limit.
    const running = await db.job.count({
      where: { shopId: shop.id, type: "FORGE_CUSTOM_AVATAR", status: { in: ["PENDING", "IN_PROGRESS"] } },
    });
    if (running > 0) {
      return json({ avatarError: "Your last presenter is still being forged — give it a minute." });
    }
    const MAX_CUSTOM_PRESENTERS = 12;
    const owned = await db.customAvatar.count({ where: { shopId: shop.id } });
    if (owned >= MAX_CUSTOM_PRESENTERS) {
      return json({ avatarError: `You already have ${MAX_CUSTOM_PRESENTERS} presenters — delete one to forge another.` });
    }

    let forgeFromExtra = 0;
    try {
      forgeFromExtra = (await spendTokens(shop.id, TOKEN_COST.avatarForge)).fromExtra;
    } catch (e) {
      return json({ avatarError: e instanceof Error ? e.message : "Not enough tokens to forge a presenter." });
    }

    // The spend above is committed, so everything after it has to either queue
    // the work or give the tokens back. Unguarded, a failure here escaped the
    // action as a 500 error page with the forge fee gone and no job to refund
    // it — refundPrepaidOnce needs a job row, and there is none until the
    // enqueue below succeeds.
    try {
      const row = await db.customAvatar.create({
        data: {
          shopId: shop.id, name, gender,
          desc: ((form.get("avatarDesc") as string) || "").trim().slice(0, 200) || `${name}, the brand's own presenter character`,
          refFile: fileName,
        },
      });
      await enqueueJob(shop.id, "FORGE_CUSTOM_AVATAR", {
        customAvatarId: row.id,
        prePaid: true,
        chargedTokens: TOKEN_COST.avatarForge,
        chargedFromExtra: forgeFromExtra,
      });
      return json({ avatarQueued: name });
    } catch (e) {
      try {
        await refundTokens(shop.id, TOKEN_COST.avatarForge, forgeFromExtra);
        console.warn(`[studio] forge failed before queueing — refunded ${TOKEN_COST.avatarForge} tokens to shop ${shop.id}`);
      } catch (re) {
        console.error(
          `[studio] FORGE REFUND FAILED — shop ${shop.id} is owed ${TOKEN_COST.avatarForge} tokens: `,
          re instanceof Error ? re.message.slice(0, 200) : re,
        );
      }
      return json({ avatarError: e instanceof Error ? e.message : "Couldn't start the forge — your tokens were returned." });
    }
  }

  // The Creator section (casual mode) is its own entitlement — gate it here.
  const casualMode = form.get("mode") === "casual";
  // Creators don't need a brand voice (that's a marketing concept); only
  // marketing generation requires it. Editing never did.
  if (!shop.brandProfile && intent !== "edit" && !casualMode) return json({ error: "Set your brand voice on the Dashboard first." });
  if (!shop.activePlan?.active) return json({ error: "Pick a plan on the Dashboard first — content runs on tokens." });
  // Creator section = the $6.99 Creator entitlement (standalone plan, the +add-on,
  // Legend, or a trial). Without it, send them to unlock it rather than generate.
  // Photo EDITS are a Creator feature too — gate them on the entitlement itself,
  // not just the client-supplied mode flag (a marketing-mode POST can't bypass it).
  if ((casualMode || intent === "edit" || intent === "create" || intent === "music") && !capabilitiesFor(shop.activePlan).has("creator")) {
    return json({ error: "Creator is included on every plan — pick one on the Plans page to make images, edit photos and generate music (or get the standalone Creator plan for $6.99/mo)." });
  }

  const productTitle = ((form.get("productTitle") as string) || "").trim();
  const urlField = ((form.get("productImageUrl") as string) || "").trim() || undefined;
  // THE LINK THE STUDIO PROMISES TWICE.
  //
  // The catalogue picker submits productUrl and the page says, in two places,
  // that "the product page rides along to the post, so shoppers land straight
  // on the buy page". The action never read it. The go turnstile then fell
  // back to matching the title against the mirrored catalogue, and when that
  // missed — a hand-typed title, anything added by URL, any service — it
  // reached for the shop's domain, which for a web account is synthetic and
  // dead. Carried on the payload now so the asset can keep it.
  const productUrlRaw = ((form.get("productUrl") as string) || "").trim();
  const productUrl =
    productUrlRaw && /^https?:\/\//i.test(productUrlRaw) && productUrlRaw.length <= 600
      ? productUrlRaw
      : undefined;
  // The input carries maxLength={300}, which is a courtesy to the merchant and
  // nothing to the server: this string is interpolated straight into the image
  // and video prompts, ahead of the fidelity clauses that keep the product
  // looking like the product. A pasted brief pushes those to the tail of a very
  // long prompt, where models weight them least. 500 leaves room for the
  // composed presets on top of a full-length direction and stops a novel.
  // trimToWord, not slice: this text is read by a model, so it must not end
  // mid-word.
  const direction = trimToWord((form.get("direction") as string) || "", 500) || undefined;
  // casualMode (above) is authoritative on the SERVER: even if a merchant-only
  // hidden field leaks from a stale client, casual never honors service/offer/
  // ad-format selections. This is the real guard; client-side hiding is only UX.
  // Which SECTION this piece belongs to — casual = the Creator gallery, marketing
  // = the Marketing archive. Carried on every job so the Archive can split them.
  const genSection = casualMode ? "creator" : "marketing";
  const service = !casualMode && form.get("service") === "1"; // intangible offering — sell the outcome
  const wear = form.get("wear") === "1";
  const scene = ((form.get("scene") as string) || "").trim() || undefined;
  // Creator flows carry their own title (the prompt): photo edits, text-to-image
  // "create", and music never ask for a product name — only the product-based ad
  // flows do. (Masked until Creator became free on every plan — now reachable.)
  if (!productTitle && intent !== "edit" && intent !== "create" && intent !== "music" && intent !== "faceless") return json({ error: "Give the product a name." });
  if (urlField && !/^https?:\/\//.test(urlField)) return json({ error: "The product image must be a full https:// URL." });

  // Uploaded photo beats the URL field — not everyone has a hosted image.
  // Stored on the persistent disk and served publicly at /uploads/* so the
  // render engines can fetch it like any other product URL.
  let productImageUrl = urlField;
  let uploadedPhoto = false;
  const photo = form.get("productPhoto");
  if (photo && typeof photo !== "string" && photo.size > 0) {
    if (!/^image\//.test(photo.type)) return json({ error: "That file isn't an image — use a JPG, PNG or WebP." });
    if (photo.size > 8 * 1024 * 1024) return json({ error: "Image too large — keep it under 8 MB." });
    const [fsMod, pathMod, crypto] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto")]);
    const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
    const dir = pathMod.join(process.cwd(), "data", "renders", "uploads");
    fsMod.mkdirSync(dir, { recursive: true });
    const name = uploadFileName(shop.id, crypto.randomBytes(8).toString("hex"), ext as UploadExt);
    fsMod.writeFileSync(pathMod.join(dir, name), Buffer.from(await photo.arrayBuffer()));
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    if (!base) return json({ error: "Photo uploads aren't configured on this server yet — paste an image URL instead." });
    productImageUrl = `${base}/uploads/${name}`;
    uploadedPhoto = true;
  }

  // RESOLVE WHAT THEY PASTED — merchants paste product PAGE links, not .jpg
  // files, because that's the natural thing to do. A page URL used to fail the
  // render three minutes later ("input was invalid") with the tokens already
  // spent. Now: direct images pass through, product pages get scraped for
  // their hero image, and only a genuinely unusable link is refused — before
  // any charge, with a message that says what to do.
  if (productImageUrl && !uploadedPhoto) {
    const resolved = await resolveImageOrPage(productImageUrl);
    if (!resolved.image) {
      return json({ error: `We couldn't get a product image from that link — ${resolved.why || "it isn't an image and has no product photo on the page"}. Paste a direct image link, or upload the photo.` });
    }
    productImageUrl = resolved.image;
  }

  // HARD REQUIREMENT: no product photo = the engines invent a product from
  // the title and the merchant pays for generic AI art. Services are the one
  // legitimate exception (there is nothing to photograph).
  if ((intent === "video" || intent === "image") && !service && !productImageUrl) {
    return json({ error: "Add a product photo — upload one or paste an image URL. Without it we'd be inventing a product from the name. Promoting a service? Switch to “Service / offer”." });
  }

  // TOKENS CHARGED BUT NOT YET BACKED BY A QUEUED JOB.
  //
  // Every branch below spends FIRST and enqueues after, which is the right
  // order — it is what makes the spend atomic and the burst share recordable
  // per piece. But if a db.job.create threw between the two (a pool timeout,
  // the connection drop that follows a deploy), the catch returned an error and
  // the debit stayed: there is no job row for refundPrepaidOnce to find, so
  // nothing anywhere gives those tokens back. A Veo x3 burst is 675 tokens.
  //
  // Tracked here rather than in each branch so a new branch cannot forget it:
  // charge sets the debt, each successful enqueue retires its share, and the
  // catch refunds whatever is left.
  let unbackedTokens = 0;
  let unbackedFromExtra = 0;
  const charged = (total: number, fromExtra: number) => { unbackedTokens = total; unbackedFromExtra = fromExtra; };
  const backed = (tokens: number, fromExtra: number) => {
    unbackedTokens = Math.max(0, unbackedTokens - tokens);
    unbackedFromExtra = Math.max(0, unbackedFromExtra - fromExtra);
  };

  try {
    if (intent === "video") {
      let contentType = ((form.get("contentType") as string) || "").trim() || undefined;
      // Casual never renders the ad-coded content types — coerce the two most
      // ad-shaped (a story Commercial, a Creator Demo) to a neutral Product
      // Highlight even if a stale client submits them. The picker already hides
      // them in casual; this is the server guard.
      if (casualMode && (contentType === "commercial" || contentType === "review")) contentType = "highlight";
      // Preset translation: the picker key becomes its base pipeline type and
      // its baked-in direction rides ahead of whatever the merchant typed.
      const preset = contentType ? CT_PRESETS[contentType] : undefined;
      const videoDirection = preset ? [preset.direction, direction].filter(Boolean).join(" ") : direction;
      if (preset) contentType = preset.base;
      const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
      const cartoonStyle = ((form.get("cartoonStyle") as string) || "").trim() || undefined;
      const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
      const videoEngine = normalizeEngineKey((form.get("videoEngine") as string) || "");
      const commercial = !casualMode && form.get("commercial") === "1"; // the packshot endcard reads "ad" — never in casual
      const breakout = form.get("breakout") === "1";
      assertCapability(shop.activePlan, videoCapabilityFor(contentType));
      // Pre-charge validation: a presenter has to have something to hold —
      // fail BEFORE tokens are spent, not in the pipeline.
      const presenterVideo = !!avatarId && contentType !== "cartoon" && contentType !== "jingle";
      if (presenterVideo && !productImageUrl && !service) {
        return json({ error: "Add a product photo — the presenter needs something to hold. (Promoting a service? Flip to ✨ Service / offer.)" });
      }
      // The engine picker drives an IMAGE-TO-VIDEO render. A presenter ad does
      // not use one: it goes through the lipsync chain (HeyGen/omni-human), so
      // generateUgcAd never even receives videoEngine — and a cartoon with a
      // presenter now lipsyncs too. Charging the Seedance or Veo surcharge on
      // those was billing for an engine that never ran.
      // Commercial renders one clip PER BEAT (up to 5) for a SINGLE engine
      // surcharge, so a premium engine there loses money on every spot (and
      // every burst multiplies it). Pin Commercial to the default animator:
      // no surcharge billed, default-engine COGS stays inside the flat price.
      const engineDrivesRender = !avatarId && contentType !== "commercial";
      const effectiveEngine = engineDrivesRender ? videoEngine : "auto";
      const each = TOKEN_COST.video + engineSurcharge(effectiveEngine);
      // Video bursts cap lower than image bursts — one video is 60+ tokens, so
      // a ten-pack would empty most wallets on a single tap. Three is enough
      // to pick from without being a decision the merchant regrets.
      const n = burstCount(form, MAX_BURST.video);
      // Split the burst spend across its pieces so each job records the
      // bucket ITS share came from — a burst can straddle allowance and
      // top-up, and a single failed piece must refund only its own share.
      const burstFromExtra = (await spendTokens(shop.id, each * n)).fromExtra;
      const perPieceFromExtra = Math.floor(burstFromExtra / n);
      charged(each * n, burstFromExtra);
      for (let i = 0; i < n; i++) {
        // Services: the presenter explains the offer to camera — nothing to hold.
        await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
          section: genSection,
          productTitle, productImageUrl, productUrl, customPrompt: videoDirection, productDescription: direction,
          style: presenterVideo ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT",
          contentType, cartoonStyle,
          avatarId, avatarVariant,
          holdProduct: !!avatarId && !service,
          productSize: ((form.get("productSize") as string) || "").trim() || undefined,
          wearProduct: !!avatarId && wear && !service,
          serviceMode: service, scene,
          videoEngine: effectiveEngine, commercial, breakout, chargedTokens: each, chargedFromExtra: perPieceFromExtra, prePaid: true, initiator: "web",
        }, burstRunAt(i));
        backed(each, perPieceFromExtra);
      }
      return json({ ok: true, queued: "video", count: n });
    }
    if (intent === "image") {
      assertCapability(shop.activePlan, "image");
      const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
      const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
      if (avatarId && !productImageUrl && !service) {
        return json({ error: "Add a product photo — the presenter needs something to hold." });
      }
      // Ad templates & formats are marketing constructs — never applied in
      // casual, so a casual image is a clean styled still, not an ad layout.
      const rawTemplate = ((form.get("templateKey") as string) || "").trim();
      const templateKey = !casualMode && AD_TEMPLATE_BY_KEY[rawTemplate] ? rawTemplate : undefined;
      const rawFormat = ((form.get("formatKey") as string) || "").trim();
      const formatKey = !casualMode && AD_FORMAT_BY_KEY[rawFormat] ? rawFormat : undefined;
      const n = burstCount(form, MAX_BURST.image);
      // Charge the WHOLE burst in one call. spendTokens throws a plain
      // "needs X, you have Y" before anything is queued, so a burst the
      // merchant can't afford costs them nothing and says so — far better
      // than queueing four and failing the fifth mid-run.
      // Capture the split, like the video path above. spendTokens draws from
      // the expiring allowance first and the purchased top-up only after it
      // runs out, and the job carries that split so a terminal failure refunds
      // to the same place. Discarding it meant an image paid for with bought,
      // never-expiring tokens came back as allowance and expired at the next
      // period roll — the merchant paid cash for those.
      const imgFromExtra = (await spendTokens(shop.id, TOKEN_COST.image * n)).fromExtra;
      const imgPerPieceFromExtra = Math.floor(imgFromExtra / n);
      charged(TOKEN_COST.image * n, imgFromExtra);
      // A burst exists to give the merchant a SPREAD to choose from, so when
      // they haven't pinned a template or format, walk the format list instead
      // of rendering the same composition n times. Pin one and every shot in
      // the burst honours it — the variation then comes from the render.
      // Casual never walks the ad-format list — its spread stays empty so every
      // shot is a clean scene still, not a rotation of ad layouts.
      const spread = !casualMode && !templateKey && !formatKey && !avatarId && !service
        ? AD_FORMATS.slice(0, n).map((f) => f.key)
        : [];
      for (let i = 0; i < n; i++) {
        // Services skip the presenter-hold and product photo → outcome scene.
        await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
          section: genSection,
          // ALWAYS FRESH FROM THE STUDIO.
          //
          // This was `n > 1`: a burst composed fresh, a single press reused the
          // Shot Library’s frozen composite for the pair. That was sound while
          // presenter stills carried a copy overlay — same composite, different
          // headline, different ad. Then presenter stills started shipping
          // CLEAN (see the “NO POSTER TEXT ON A PRESENTER SHOT” note in
          // image-generation.server.ts) and nobody reconnected the two, so the
          // reuse has nothing left to vary: the frozen shot IS the deliverable.
          //
          // The wardrobe variant is part of the shot key and the client rotates
          // it 0→1→2→3, so ads 1-4 differ and ad 5 comes back byte-identical to
          // ad 1, at full price, forever. This Archive has a pair with eight
          // assets pointing at one render.
          //
          // A merchant pressing Generate is asking for another one, so they get
          // another one. The library still serves every other caller.
          freshShot: true,
          productTitle, productImageUrl, productUrl, stylePrompt: direction,
          styleMode: direction ? "scene" : "backdrop",
          templateKey: avatarId || service ? undefined : templateKey,
          formatKey: avatarId || service ? undefined : (spread[i] || formatKey),
          // Only a merchant-declared promotion ever puts an offer on an ad — and
          // never in casual, where there's nothing being sold.
          merchantOffer: casualMode ? undefined : (((form.get("merchantOffer") as string) || "").trim().slice(0, 40) || undefined),
          productSize: ((form.get("productSize") as string) || "").trim() || undefined,
          avatarId: service ? undefined : avatarId, avatarVariant,
          wear: !!avatarId && wear && !service,
          serviceMode: service, scene, prePaid: true,
          chargedTokens: TOKEN_COST.image, chargedFromExtra: imgPerPieceFromExtra,
        }, burstRunAt(i));
        backed(TOKEN_COST.image, imgPerPieceFromExtra);
      }
      return json({ ok: true, queued: "image", count: n });
    }
    if (intent === "edit") {
      // Casual "edit a photo" — transform the user's own uploaded/linked photo.
      // Same 5-token image cost + spend/refund discipline; the worker routes it
      // to editImage() (no brand profile or ad ladder). A source photo is
      // REQUIRED — img2img can't invent one from a title.
      assertCapability(shop.activePlan, "image");
      // Primary flow is DeepAI-style: upload a photo + "describe your changes".
      // When no quick-action chip is picked we default to the free-text
      // "describe" edit, so the description alone is enough.
      const pickedOp = ((form.get("editOp") as string) || "").trim();
      const editOp = pickedOp || ((direction || "").trim() ? "describe" : "");
      if (!["restyle", "cartoonize", "bgremove", "bgswap", "colorize", "upscale", "replace", "describe"].includes(editOp)) {
        return json({ error: "Upload a photo and describe the changes you want — or tap a quick action." });
      }
      if ((editOp === "describe" || editOp === "replace") && !(direction || "").trim()) {
        return json({ error: "Describe the changes you want — e.g. 'make the shirt a purple hoodie'." });
      }
      if (!productImageUrl) {
        return json({ error: "Add a photo to edit — upload one or paste an image URL." });
      }
      const editFromExtra = (await spendTokens(shop.id, TOKEN_COST.image)).fromExtra;
      charged(TOKEN_COST.image, editFromExtra);
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        section: "creator",
        editOp, sourceImageUrl: productImageUrl, editPrompt: direction,
        // Carried only so the Archive "cooking" tile has a thumbnail + label
        // while the edit runs (the worker's edit path ignores them).
        productImageUrl, productTitle: productTitle || "Photo edit",
        prePaid: true, chargedTokens: TOKEN_COST.image, chargedFromExtra: editFromExtra,
      });
      backed(TOKEN_COST.image, editFromExtra);
      return json({ ok: true, queued: "image", count: 1 });
    }
    if (intent === "create") {
      // Creator "Make an image" — text-to-image in an art style. No product.
      assertCapability(shop.activePlan, "image");
      const createPrompt = trimToWord((form.get("createPrompt") as string) || (direction || ""), 500);
      if (!createPrompt) return json({ error: "Describe what you want to make." });
      const createStyle = ((form.get("createStyle") as string) || "").trim() || undefined;
      const createFromExtra = (await spendTokens(shop.id, TOKEN_COST.image)).fromExtra;
      charged(TOKEN_COST.image, createFromExtra);
      await enqueueJob(shop.id, "GENERATE_IMAGE_AD", {
        createImage: true, createPrompt, createStyle, section: "creator",
        productTitle: createPrompt.slice(0, 60),
        prePaid: true, chargedTokens: TOKEN_COST.image, chargedFromExtra: createFromExtra,
      });
      backed(TOKEN_COST.image, createFromExtra);
      return json({ ok: true, queued: "image", count: 1 });
    }
    if (intent === "music") {
      // Creator "Make music" — text-to-song. No product, no photo.
      assertCapability(shop.activePlan, "music");
      const musicBase = trimToWord((form.get("musicPrompt") as string) || (direction || ""), 500);
      if (!musicBase) return json({ error: "Describe the music you want." });
      // Fold the picked genre/mood preset into the prompt (DeepAI-style style
      // selection on top of the free-text prompt). Unknown keys are ignored.
      const musicStyleKey = ((form.get("musicStyle") as string) || "").trim();
      const musicStyle = MUSIC_STYLE_BY_KEY[musicStyleKey];
      const musicPrompt = musicStyle ? `${musicBase}. Style: ${musicStyle.prompt}` : musicBase;
      const musicFromExtra = (await spendTokens(shop.id, TOKEN_COST.music)).fromExtra;
      charged(TOKEN_COST.music, musicFromExtra);
      await enqueueJob(shop.id, "GENERATE_SONG", {
        section: "creator", musicPrompt,
        productTitle: musicBase.slice(0, 60),
        prePaid: true, chargedTokens: TOKEN_COST.music, chargedFromExtra: musicFromExtra,
      });
      backed(TOKEN_COST.music, musicFromExtra);
      return json({ ok: true, queued: "music", count: 1 });
    }
    if (intent === "faceless") {
      // Creator "Faceless video" — topic → scripted 9:16 social video. No product,
      // no photo. Gated at the "video" capability (video-shaped pipeline).
      assertCapability(shop.activePlan, "video");
      const topic = trimToWord((form.get("facelessTopic") as string) || (direction || ""), 300);
      if (!topic) return json({ error: "Give your video a topic." });
      const facelessFormat = ((form.get("facelessFormat") as string) || "facts").trim();
      const voiceKey = ((form.get("voiceKey") as string) || "f-warm").trim();
      const flFromExtra = (await spendTokens(shop.id, TOKEN_COST.faceless)).fromExtra;
      charged(TOKEN_COST.faceless, flFromExtra);
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
        section: "creator", contentType: "faceless", topic, facelessFormat, voiceKey,
        productTitle: topic.slice(0, 60),
        prePaid: true, chargedTokens: TOKEN_COST.faceless, chargedFromExtra: flFromExtra,
      });
      backed(TOKEN_COST.faceless, flFromExtra);
      return json({ ok: true, queued: "faceless", count: 1 });
    }
    if (intent === "blog") {
      assertCapability(shop.activePlan, "blog");
      const blogFromExtra = (await spendTokens(shop.id, TOKEN_COST.blog)).fromExtra;
      charged(TOKEN_COST.blog, blogFromExtra);
      await enqueueJob(shop.id, "GENERATE_BLOG_POST", {
        section: genSection,
        productTitle, productUrl, productDescription: direction, serviceMode: service,
        prePaid: true, chargedTokens: TOKEN_COST.blog, chargedFromExtra: blogFromExtra,
      });
      backed(TOKEN_COST.blog, blogFromExtra);
      return json({ ok: true, queued: "article" });
    }
  } catch (e) {
    // Give back anything charged that no job will ever run. spendTokens itself
    // throwing (insufficient balance) leaves the debt at 0, so this cannot
    // refund a spend that never happened, and a partially-queued burst refunds
    // only the pieces that did not make it.
    if (unbackedTokens > 0) {
      try {
        await refundTokens(shop.id, unbackedTokens, unbackedFromExtra);
        console.warn(`[studio] refunded ${unbackedTokens} token(s) for ${intent} pieces that were charged but never queued`);
      } catch (re) {
        console.error(
          `[studio] REFUND FAILED — shop ${shop.id} is owed ${unbackedTokens} token(s) for an unqueued ${intent}: `,
          re instanceof Error ? re.message.slice(0, 200) : re,
        );
      }
    }
    return json({ error: e instanceof Error ? e.message : "Couldn't queue that." });
  }
  return json({});
};

type Tab = "video" | "image" | "music" | "faceless" | "blog" | "import";
type CType = (typeof CONTENT_TYPES)[number]["key"];
type CastItem = { id: string; name: string; img: string; designed: boolean };

/* Module-level on purpose: defined inside the page component, React would
 * see a NEW component type on every render and remount the strip — which
 * reset the horizontal scroll to the first presenter on every click. Any
 * new inputs come in as explicit props. */
/** The forge takes a minute or two of silence, and a line of text reading
 *  "forging…" makes that look like nothing is happening. So show the shape of
 *  what's coming: four placeholder character cards — one per outfit — shimmering
 *  in the same tile geometry the presenter row uses, with a real elapsed clock.
 *  When the job lands, these swap for the actual faces. */
function ForgingPresenter({ name, status, startedAt }: { name: string; status: string; startedAt: string }) {
  const revalidator = useRevalidator();
  const [elapsed, setElapsed] = useState(0);
  const failed = status === "failed";

  // Count from the job's REAL start, so a reload mid-forge shows "1m 40s".
  useEffect(() => {
    if (failed) return;
    const base = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - base) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, failed]);

  // Poll until the forge lands. 6s matches the catalogue importer.
  useEffect(() => {
    if (failed) return;
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 6000);
    return () => clearInterval(id);
  }, [revalidator, failed]);

  if (failed) {
    return (
      <div className="ws-forge ws-forge-bad" role="status">
        <b>{name} couldn&rsquo;t be forged.</b>
        <span>The reference photo didn&rsquo;t give us enough to work with — try a clearer, front-facing image.</span>
      </div>
    );
  }
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  return (
    <div className="ws-forge" role="status" aria-live="polite">
      <div className="ws-forge-hd">
        <span className="ws-forge-spin" aria-hidden="true" />
        <div>
          <b>Forging {name}…</b>
          <span>Four outfits, {mm > 0 ? `${mm}m ${ss}s` : `${ss}s`} elapsed — usually a minute or two. You can keep working.</span>
        </div>
      </div>
      <div className="ws-forge-row">
        {["Casual", "Smart", "Branded", "Outdoor"].map((o, i) => (
          <div className="ws-forge-card" key={o} style={{ animationDelay: `${i * 0.18}s` }}>
            <span className="ws-forge-img" aria-hidden="true" />
            <span className="ws-forge-nm">{o}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Presenters({ cast, avatarId, setAvatarId, optional, brandFaceId }: {
  cast: CastItem[];
  avatarId: string | null;
  setAvatarId: (id: string | null) => void;
  optional?: boolean;
  brandFaceId: string | null;
}) {
  // Voice preview: one sample at a time. Designed ("true voice") faces get a
  // lip-sync video instead of the mp3 snippet.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const stopAudio = () => { audioRef.current?.pause(); audioRef.current = null; setPlaying(null); };
  const sample = (c: CastItem) => {
    if (c.designed) { stopAudio(); setVideoId(c.id); return; } // premium "true voice" → lip-sync video
    if (playing === c.id) { stopAudio(); return; }
    stopAudio();
    const a = new Audio(`/voices/${c.id}.mp3?v=3`);
    audioRef.current = a; setPlaying(c.id);
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
  };

  // Brand Face leads the cast.
  const ordered = brandFaceId ? [...cast.filter((c) => c.id === brandFaceId), ...cast.filter((c) => c.id !== brandFaceId)] : cast;
  // Type a name instead of scrubbing a hundred faces sideways. Filtering never
  // drops the CAST presenter — losing sight of your own selection mid-search is
  // worse than one extra tile.
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? ordered.filter((c) => c.name.toLowerCase().includes(needle) || c.id === avatarId)
    : ordered;

  return (
    <>
      <div className="ws-lbl">Presenter{optional ? <span className="ws-opt">optional</span> : null}</div>
      <div className="ws-castsearch">
        <input className="wb-in" type="search" value={q} placeholder={`Search ${cast.length} presenters by name…`}
          onChange={(e) => setQ(e.target.value)} aria-label="Search presenters by name" />
        {needle && <button type="button" className="ws-cs-clr" onClick={() => setQ("")} aria-label="Clear search">✕</button>}
      </div>
      {needle && shown.length === 0 && <p className="ws-offernote">No presenter called “{q.trim()}”.</p>}
      <div className="ws-cast">
        {optional && !needle && (
          <button type="button" className={`ws-face${avatarId === null ? " sel" : ""}`} onClick={() => setAvatarId(null)}>
            <span className="ws-face-img none">✕</span><span>None</span>
          </button>
        )}
        {shown.map((c) => {
          const bf = c.id === brandFaceId;
          return (
            <div key={c.id} className={`ws-face${avatarId === c.id ? " sel" : ""}${bf ? " bf" : ""}`}>
              <button type="button" className="ws-face-pick" onClick={() => setAvatarId(c.id)} aria-label={`Cast ${c.name}`}>
                <span className="ws-face-img" style={{ backgroundImage: `url(${c.img})` }}>{avatarId === c.id && <b>✓</b>}</span>
              </button>
              <button type="button" className={`ws-samp${playing === c.id ? " on" : ""}${c.designed ? " prem" : ""}`} onClick={() => sample(c)}
                title={c.designed ? `Watch ${c.name} speak` : `Hear ${c.name}`} aria-label={c.designed ? `Watch ${c.name} speak` : `Hear ${c.name}'s voice`}>
                <Ico n={playing === c.id ? "music" : c.designed ? "play" : "sound"} size={15} />
              </button>
              <span>{bf ? <><Ico n="star" size={12} /> Brand face</> : c.name}</span>
            </div>
          );
        })}
      </div>
      {videoId && (
        <div className="ws-vscrim" onClick={() => setVideoId(null)}>
          <div className="ws-vbox" onClick={(e) => e.stopPropagation()}>
            <video src={`/voice-videos/${videoId}.mp4?v=1`} autoPlay controls playsInline className="ws-video" />
            <button type="button" className="ws-vx" onClick={() => setVideoId(null)}>✕</button>
          </div>
        </div>
      )}
    </>
  );
}

/* "Pulling your products in now" as flat text reads as a page that died. This
 * is the same beat the Archive's cooking tiles hit: the gold rosette turning on
 * a dark panel, a live elapsed clock, and the page quietly revalidating so the
 * grid appears the moment the import lands — nobody has to guess or refresh. */
function CatalogSync({ startedAt }: { startedAt: string | null }) {
  const revalidator = useRevalidator();
  const [elapsed, setElapsed] = useState(0);

  // Tick the clock from the job's REAL start time, so a reload mid-import
  // shows "2m 10s", not a counter that just began.
  useEffect(() => {
    const base = startedAt ? new Date(startedAt).getTime() : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - base) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Poll for completion. 6s is frequent enough to feel instant and cheap
  // enough that a long sitemap crawl doesn't hammer our own server.
  useEffect(() => {
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 6000);
    return () => clearInterval(id);
  }, [revalidator]);

  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  return (
    <div className="ws-catload" role="status" aria-live="polite">
      <span className="ws-catload-spin" aria-hidden="true" />
      <div className="ws-catload-txt">
        <b>Pulling your products in…</b>
        <span>
          {mm > 0 ? `${mm}m ${ss}s` : `${ss}s`} — reading your storefront.
          {elapsed > 90 ? " Big catalogues take a few minutes." : ""}
        </span>
        <i>This page updates itself the moment it lands.</i>
      </div>
    </div>
  );
}

/* One long card reads as one long chore. Numbered heads cut the same fields
 * into three obvious moves — look, product, direction — so the form is scanned
 * rather than waded through. Purely presentational: no state, no wrapping, so
 * every field stays exactly where the multipart submit expects it. */
function StepHead({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="ws-stephead">
      <span className="ws-stepn" aria-hidden="true">{n}</span>
      <b>{title}</b>
      {hint ? <span className="ws-stephint">{hint}</span> : null}
    </div>
  );
}

/* Tab glyphs, drawn rather than typed.
 *
 * Emoji were doing two things wrong here: they render as a different typeface
 * on every platform (Apple's clapperboard is nothing like Android's), and they
 * carry their own colour — so on the selected green tab the picture stayed a
 * beige-and-blue sticker while the label went white. These inherit
 * currentColor, so they turn white with the label and green-grey without. */
function TabIcon({ kind }: { kind: Tab }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className="ws-tabi" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
      {kind === "video" && (
        <>
          <rect x="2.2" y="4.4" width="15.6" height="11.2" rx="2.4" {...p} />
          <path d="M8.4 8.2 12.6 10l-4.2 1.8Z" {...p} fill="currentColor" />
          <path d="M2.2 7.6h15.6" {...p} />
        </>
      )}
      {kind === "import" && (
        <>
          <path d="M3 7.4 4.6 3.6h10.8L17 7.4Z" {...p} />
          <path d="M4.2 7.4v8.2a1.2 1.2 0 0 0 1.2 1.2h9.2a1.2 1.2 0 0 0 1.2-1.2V7.4" {...p} />
          <path d="M10 9.4v4.2m0 0 1.7-1.7M10 13.6l-1.7-1.7" {...p} />
        </>
      )}
      {kind === "image" && (
        <>
          <rect x="2.4" y="3.8" width="15.2" height="12.4" rx="2.4" {...p} />
          <circle cx="7.3" cy="8.1" r="1.35" {...p} />
          <path d="m3.6 14.4 3.9-3.6a1.5 1.5 0 0 1 2 0l2.1 1.9 1.5-1.3a1.5 1.5 0 0 1 2 0l3.3 3" {...p} />
        </>
      )}
      {kind === "music" && (
        <>
          <path d="M7.2 14.2V5.2l8-1.6v8.4" {...p} />
          <circle cx="5.3" cy="14.3" r="1.9" {...p} />
          <circle cx="13.3" cy="12.3" r="1.9" {...p} />
        </>
      )}
      {kind === "faceless" && (
        <>
          <rect x="3" y="4.5" width="14" height="11" rx="2" {...p} />
          <path d="M17 8.4 20.5 6v8l-3.5-2.4" {...p} />
          <path d="M6.5 8.5h5M6.5 11.5h3" {...p} />
        </>
      )}
      {kind === "blog" && (
        <>
          <path d="M4 3.4h8.4L16.4 7v9.6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1Z" {...p} />
          <path d="M12.2 3.6V7h3.9" {...p} />
          <path d="M6.1 10.3h6.4M6.1 13.2h4.3" {...p} />
        </>
      )}
    </svg>
  );
}

export default function WebStudio() {
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  // Creation mode from the shell (web.tsx). "casual" reframes the Studio for
  // just-for-fun making + photo edits and hides the merchant-only surfaces; it
  // never changes what the backend charges. Default marketing if, somehow,
  // there's no provider (keeps the live merchant flow safe).
  const { mode } = useOutletContext<{ mode: "marketing" | "casual"; setMode: (m: "marketing" | "casual") => void }>() || { mode: "marketing" as const, setMode: () => {} };
  const casual = mode === "casual";
  const nav = useNavigation();
  const submit = useSubmit();
  const busy = nav.state !== "idle";
  const can = (c: string) => d.caps.includes(c);

  // Deep-link support: arrive with ?tab= and ?product= pre-filled.
  const [searchParams] = useSearchParams();
  // ?do= lets the Creator home deep-link straight into a flow: edit/image →
  // Image tab, presenter → Image+presenter, video → Video tab. ?tab= still works.
  const doParam = searchParams.get("do");
  const initTab = doParam === "video" ? "video"
    : doParam === "music" ? "music"
    : doParam === "faceless" ? "faceless"
    : (doParam === "edit" || doParam === "image" || doParam === "presenter" || doParam === "create") ? "image"
    : (["video", "image", "music", "faceless", "blog", "import"] as const).find((t) => t === searchParams.get("tab"));
  const [tab, setTab] = useState<Tab>(initTab || "video");
  const [productTitle, setProductTitle] = useState(searchParams.get("product") || "");
  const [imageUrl, setImageUrl] = useState("");
  const [hasFile, setHasFile] = useState(false);
  const [contentType, setContentType] = useState<CType | null>(null);
  const [cartoonStyle, setCartoonStyle] = useState<string | null>(null);
  const [avatarId, setAvatarId] = useState<string | null>(d.brandFaceId ?? d.cast[0]?.id ?? null);
  const [imageMode, setImageMode] = useState<"product" | "presenter" | "create" | null>(
    doParam === "edit" || doParam === "image" ? "product" : doParam === "presenter" ? "presenter" : doParam === "create" ? "create" : null,
  );
  // Creator "Make an image" art style.
  const [createStyle, setCreateStyle] = useState<string | null>(null);
  // Creator "Make music" genre/mood preset (optional, folded into the prompt).
  const [musicStyle, setMusicStyle] = useState<string | null>(null);
  // Creator "Faceless video" — format + voice.
  const [facelessFormat, setFacelessFormat] = useState("facts");
  const [voiceKey, setVoiceKey] = useState("f-warm");
  // How many to make in one go. Kept in one place across tabs so the choice
  // survives switching, but re-clamped below — video caps lower than image.
  const [burst, setBurst] = useState(1);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [formatKey, setFormatKey] = useState<string | null>(null);
  // Casual "edit a photo" operation (restyle | cartoonize | bgswap | bgremove).
  const [editOp, setEditOp] = useState<string | null>(null);
  // Which format category the picker is showing. Leads with "popular" so the
  // first thing a merchant sees is eight strong choices, not forty.
  const [fmtGroup, setFmtGroup] = useState<string>("popular");
  const [videoEngine, setVideoEngine] = useState("auto");
  const [commercial, setCommercial] = useState(false);
  const [breakout, setBreakout] = useState(false);
  const [upsell, setUpsell] = useState<{ name: string; tier: string; price: number } | null>(null);
  const [showDone, setShowDone] = useState(false);
  // ?prompt= lets the Creator home's prompt-first box prefill the describe/
  // topic field when it deep-links into a mode (image/edit/video/music).
  const [direction, setDirection] = useState(searchParams.get("prompt") || "");
  // Advanced prompting — default: EasyMode decides. Advanced reveals the 3 W's.
  const [advanced, setAdvanced] = useState(false);
  const [saySomething, setSaySomething] = useState("");
  const [doWhat, setDoWhat] = useState("");
  const [where, setWhere] = useState("");
  // Service mode — an intangible offer (coaching, SaaS, a subscription…). No
  // product to hold, so the presenter explains and sells the outcome.
  const [service, setService] = useState(false);
  // Presenter × product → hold vs wear. Auto-detect apparel from the typed
  // name; reset the override when detection flips so detection leads.
  const apparel = isApparel(productTitle);
  const [wearOverride, setWearOverride] = useState<boolean | null>(null);
  useEffect(() => { setWearOverride(null); }, [apparel]);
  const wear = wearOverride === null ? apparel : wearOverride;
  // Casual hides Article + Import — if the mode flips (or a deep-link lands)
  // while one of those is active, fall back to a visible tab so the user never
  // stares at a tab with no button. Runs after mount, when `casual` resolves.
  useEffect(() => { if (casual && (tab === "blog" || tab === "import")) { setTab("image"); setUpsell(null); } }, [casual, tab]);
  // "Commercial look" is an ad treatment — clear it on entering casual so a value
  // ticked in marketing can't ride a casual submit (the control is hidden in
  // casual, but a control nobody can see must not change the order).
  useEffect(() => { if (casual) setCommercial(false); }, [casual]);
  // The photo-edit op only applies to the casual Image→product surface; clear it
  // whenever we leave so a stale op can't flag a later submit as an edit.
  useEffect(() => { if (!(casual && tab === "image" && imageMode === "product")) setEditOp(null); }, [casual, tab, imageMode]);
  useEffect(() => { if (!(casual && tab === "image" && imageMode === "create")) setCreateStyle(null); }, [casual, tab, imageMode]);
  useEffect(() => { if (!(casual && tab === "music")) setMusicStyle(null); }, [casual, tab]);
  // Import-by-URL (works for any storefront).
  const [showImport, setShowImport] = useState(false);
  // Catalogue picker: the chosen product's URL rides along so the social
  // post can deep-link shoppers straight to the buy page.
  const [pickedUrl, setPickedUrl] = useState("");
  const [catQuery, setCatQuery] = useState("");
  // WHAT IS ON SCREEN, NOT WHAT IS IN THE DATABASE.
  //
  // The label quoted catalogCount — every row the shop has — over a grid that
  // renders at most 60 tiles. A merchant with 300 products read "300 products"
  // above 60 of them and had no way to know the other 240 existed, let alone
  // that the search box was how to reach them. The count was true about the
  // database and false about the page.
  const CAT_TILES = 60;
  // Token-AND search, not one contiguous substring. A contiguous match drops a
  // real product the moment any token sits between the words you typed: searching
  // "Grumpipi Whispers to Dreamland" returned 0 rows for the title
  // "Grumpipi V2 Whispers to Dreamland" because the run is broken by "V2".
  // Match every whitespace-separated token somewhere in the title instead, so
  // word order and interspersed tokens (versions, sizes, pack counts) still hit.
  const catNeedles = catQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const catFiltered = d.catalog.filter((c) => {
    if (!catNeedles.length) return true;
    const hay = c.title.toLowerCase();
    return catNeedles.every((n) => hay.includes(n));
  });
  const catShown = catFiltered.slice(0, CAT_TILES);
  const [productSize, setProductSize] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [storeInput, setStoreInput] = useState("");
  const [avatarName, setAvatarName] = useState("");
  const [avatarGender, setAvatarGender] = useState("m");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState("");
  // Last-used product memory — offer a one-tap refill next visit.
  const [lastProd, setLastProd] = useState<{ title: string; image: string } | null>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem("wsLastProduct"); if (raw) setLastProd(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);

  const queued = actionData && "queued" in actionData ? (actionData as { queued: string }).queued : null;
  const queuedCount = (actionData as { count?: number } | null)?.count ?? 1;
  useEffect(() => {
    if (actionData && "queued" in actionData) {
      setShowDone(true);
      try {
        const entry = { title: productTitle.trim(), image: imageUrl.trim() };
        if (entry.title) { localStorage.setItem("wsLastProduct", JSON.stringify(entry)); setLastProd(entry); }
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionData]);
  useEffect(() => {
    const imp = actionData && "imported" in actionData ? (actionData as { imported: { title: string; image: string | null; url: string | null } }).imported : null;
    // THE BUY LINK MOVES WITH THE PRODUCT, ON EVERY PATH.
    //
    // pickedUrl is set by the catalogue tile and cleared only by the product
    // NAME input's onChange. Two paths replace the product without firing
    // that handler — this import, and the “Use last” chip — so the previous
    // pick's URL rode along: the ad went out with a caption linking to a
    // different product than the one in the picture. Here the scraped page IS
    // the right destination, so carry it.
    if (imp) { setProductTitle(imp.title); setImageUrl(imp.image || ""); setPickedUrl(imp.url || ""); setUrlInput(""); setShowImport(false); }
  }, [actionData]);
  const importErr = actionData && "importError" in actionData ? (actionData as { importError: string }).importError : null;

  const styleChar = avatarId ?? d.cast[0]?.id ?? "ingrid";
  const styleCover = (key: string) => `/style-tiles/${styleChar}-${key}.jpg?v=5`;

  // Mirror the server: no presenter → the engine renders the video and its
  // surcharge is real. With a presenter the lipsync engine does the work, so
  // quoting a surcharge here would quote a fee we don't take.
  // QUOTE WHAT THE SERVER WILL CHARGE.
  //
  // This asked "is a presenter selected?", but the server asks "did a presenter
  // ARRIVE?" — and avatarId is only submitted for the content types that use
  // one (needsPresenterField). The picker state defaults to the brand face on
  // arrival and is never cleared, so for Highlight, Commercial and Satisfying
  // Close-Up the button saw a presenter, quoted no surcharge, and the server
  // saw no presenter and took one: 225 tokens for a Veo video the button priced
  // at 150, or 675 against a quoted 450 on a x3 burst. The note underneath also
  // told the merchant the surcharge did not apply, while it did.
  //
  // Same condition as the hidden field, so the quote and the charge cannot
  // disagree again.
  const presenterWillBeSent = !!avatarId && needsPresenterField(contentType);
  const engineForcedDefault = contentType === "commercial";
  const engineApplies = tab === "video" && !presenterWillBeSent && !engineForcedDefault;
  const engineFee = engineApplies ? engineSurcharge(videoEngine) : 0;
  // Re-clamp on every render rather than in an effect: switching from a ×10
  // image burst to the video tab must not quote — or charge — ten videos.
  const burstMax = tab === "video" ? MAX_BURST.video : tab === "image" ? MAX_BURST.image : 1;
  if (burst > burstMax) setBurst(burstMax);
  // Casual "edit a photo": the image→product surface becomes the photo editor,
  // which submits intent="edit" (once an op is picked) and reads as "Edit photo".
  const isEdit = casual && tab === "image" && imageMode === "product";
  // Creator "Make an image" — a text-to-image generation (its own intent).
  const isCreate = casual && tab === "image" && imageMode === "create";
  // Creator "Make music" — a text-to-song generation on its own casual tab.
  const isMusic = casual && tab === "music";
  // Creator "Faceless video" — topic → scripted 9:16 social video, own casual tab.
  const isFaceless = casual && tab === "faceless";
  const submitIntent = isEdit && (editOp || direction.trim()) ? "edit" : isCreate ? "create" : tab;
  const verb = isCreate || isMusic || isFaceless ? "Make" : isEdit ? "Edit" : tab === "blog" ? "Write" : "Generate";
  const noun = isCreate ? "image" : isMusic ? "song" : isFaceless ? "video" : isEdit ? "photo" : tab === "video" ? "video" : tab === "image" ? "image" : "article";
  const baseCost = tab === "video" ? d.costs.video : tab === "image" ? d.costs.image : tab === "music" ? d.costs.music : tab === "faceless" ? d.costs.faceless : d.costs.blog;
  const cost = baseCost + engineFee;
  const needsPresenter = tab === "video" ? baseOf(contentType) === "avatar" : tab === "image" && imageMode === "presenter";
  const showCartoonGrid = tab === "video" && (contentType === "cartoon" || contentType === "jingle");
  const cfgReady = tab === "blog" || tab === "music" || tab === "faceless" || (tab === "video" && !!contentType && (contentType !== "cartoon" || !!cartoonStyle)) || (tab === "image" && imageMode !== null);
  // The Service/offer toggle only EXISTS on two of the four surfaces, but its
  // state survived a tab or mode change and the hidden field was submitted
  // regardless. So a merchant who tried Service on the product screen, backed
  // out and picked "With presenter" was charged for a presenter-less
  // service-outcome image — after a screen that told them the presenter would
  // be in it. A control nobody can see must not be able to change the order.
  // No "what are you promoting?" in casual — there's nothing being sold. (The
  // server also forces service=false in casual, so this is UX, not the guard.)
  const showService = !casual && (tab === "video" || (tab === "image" && imageMode === "product"));
  // ONE FLAG, AND IT IS THE ONE THAT GETS SUBMITTED.
  //
  // `service` survives a tab or mode change but the toggle only EXISTS while
  // showService is true, and the hidden field is only submitted under the
  // same condition. The client-side checks still read the raw state, so:
  // turn Service on in Video, switch to Image + With presenter, and
  // needsPhoto reads false while the field is not submitted. The button
  // enables, the form posts with no photo and no service flag, and the
  // server generates a presenter ad from the product NAME — the AI-slop path
  // the “add a product photo” warning exists to prevent, at full price.
  //
  // Everything the client reasons about now uses the effective value, so a
  // control nobody can see cannot change the order.
  const serviceOn = showService && service;
  // baseOf, not the literal. Review and Unboxing are avatar-based presets
  // (CT_PRESETS above maps both to base "avatar"), and every other test in this
  // file goes through baseOf — needsPresenter, the presenter picker, the
  // product-in-hand hint. This one did not, so on exactly the two formats that
  // are ABOUT holding the product, the merchant lost both the hold/wear choice
  // and the "how big is it?" control, and no wear flag was submitted. Size then
  // falls to inference, which is how a twelve-box case once came out palm-sized.
  const showWear = ((tab === "video" && baseOf(contentType) === "avatar") || (tab === "image" && imageMode === "presenter")) && !!avatarId && !serviceOn;
  const avatarRides = (tab === "video" && !!contentType && needsPresenterField(contentType) && !!avatarId) || (tab === "image" && imageMode === "presenter" && !!avatarId);

  // Compose direction + scene exactly like the embedded Studio: Advanced's
  // 3 W's fold into one direction string, the do/where pair also feeds the
  // composed opening frame as `scene`; Commercial look rides the same plumbing.
  let finalDirection = direction.trim();
  let finalScene = "";
  if (tab === "video") {
    if (advanced) {
      const parts: string[] = [];
      if (saySomething.trim()) parts.push(`They say: ${saySomething.trim()}`);
      if (doWhat.trim()) parts.push(`They do: ${doWhat.trim()}`);
      if (where.trim()) parts.push(`Setting: ${where.trim()}`);
      finalDirection = parts.join(". ");
      finalScene = [doWhat.trim(), where.trim()].filter(Boolean).join(". ");
    }
    if (!casual && commercial && (contentType === "avatar" || contentType === "highlight")) {
      const commercialScene = "a seamless bold single-color studio backdrop that complements the product's colors, big-budget commercial styling, crisp professional studio lighting";
      finalScene = finalScene ? `${finalScene}. ${commercialScene}` : commercialScene;
      finalDirection = finalDirection ? `${finalDirection}. Big-budget studio commercial energy.` : "Big-budget studio commercial energy: polished, confident, premium.";
    }
  } else if (tab === "image") {
    finalScene = direction.trim();
  }

  // Rotate the presenter’s 4 wardrobe variants across generations so repeated
  // content of the same face never looks stale (0→1→2→3→…).
  //
  // The counter is PER PRESENTER AND PRODUCT. One global “csOutfit” key meant
  // the rotation was shared by every pair the merchant had ever made: two ads
  // of different products could land on the same outfit while two ads of the
  // SAME product skipped straight past one, so “their outfit rotates each
  // time” — which this page says out loud — was true only by accident.
  //
  // localStorage still, because it is a nicety, not an invariant: a fresh
  // browser starts the pair at outfit 1 again, which is a different outfit
  // from a merchant’s first-ever ad only by luck. What guarantees the ads
  // differ is freshShot in the action, not this.
  const variantRef = useRef<HTMLInputElement | null>(null);
  const nextVariant = () => {
    const pair = `csOutfit:${avatarId || "none"}:${(productTitle || "").slice(0, 60)}`;
    let n = 0;
    try { n = ((parseInt(localStorage.getItem(pair) || "0", 10) || 0) + 1); localStorage.setItem(pair, String(n)); } catch { /* private mode */ }
    return String(n % 4);
  };
  const onFormSubmit = () => { if (variantRef.current) variantRef.current.value = nextVariant(); };

  const doImport = () => { if (urlInput.trim()) submit({ intent: "importUrl", url: urlInput.trim() }, { method: "post" }); };

  const err = actionData && "error" in actionData ? (actionData.error as string) : null;
  // A product ad with no product photo is just AI art from the title — the
  // pipeline happily renders it and the merchant pays for slop. Require a
  // photo (upload OR url) for anything that should SHOW the product; services
  // legitimately have nothing to photograph.
  // "Make an image" generates from text — no photo required.
  const needsPhoto = tab !== "blog" && tab !== "music" && tab !== "faceless" && !serviceOn && !isCreate && !hasFile && !imageUrl.trim();
  // THE WALLET IS PART OF WHETHER THE BUTTON WORKS. Every other precondition
  // (title, photo, presenter, cartoon style) disabled the button; the one that
  // bites a brand-new trialist first did not. A Studio trial spends from a
  // 400-token ceiling, and "×3" on a Veo pick is 675 — the button read
  // "Generate 3 videos — 675 tokens" directly above "Wallet: 400 tokens" and
  // was live. The server refused it, correctly, so no money moved — but the
  // very first thing many merchants would try answered with an error instead
  // of the number they were short by and where to get it.
  const shortBy = d.hasPlan ? Math.max(0, cost * burst - d.tokens) : 0;
  const ctaDisabled = busy || !d.hasPlan || (!isEdit && !isCreate && !isMusic && !isFaceless && !productTitle.trim()) || needsPhoto || (needsPresenter && !avatarId) || (tab === "video" && contentType === "cartoon" && !cartoonStyle) || (isEdit && !editOp && !direction.trim()) || (isEdit && editOp === "replace" && !direction.trim()) || (isCreate && !direction.trim()) || (isMusic && !direction.trim()) || (isFaceless && !direction.trim()) || shortBy > 0;

  return (
    <div className={casual ? "ws-casual" : undefined}>
      <style dangerouslySetInnerHTML={{ __html: WS_STYLE }} />
      <h1 className="wb-h1">{casual ? "Create" : "Content Studio"}</h1>
      <p className="wb-sub">
        {casual
          ? <>Upload a photo to edit, or make an image or video to share — it lands in your <Link to="/web/archive?section=creator">gallery</Link>. </>
          : <>Make one piece by hand, in your voice — it lands in your <Link to="/web/archive">Archive</Link>. </>}
        Balance: <Ico n="coin" /> {d.tokens.toLocaleString("en-US")}
      </p>
      {!d.hasBrand && !casual && <div className="wb-err">Set your <Link to="/web">brand voice</Link> first so content sounds like you.</div>}
      {!d.hasPlan && <div className="wb-err">Pick a <Link to="/web">plan</Link> first — content runs on tokens.</div>}
      {/* Top banner too — a failure must be visible even when the config
          section that holds the inline error is collapsed or scrolled away. */}
      {err && <div className="wb-err">Couldn&apos;t generate: {err}</div>}

      <div className="ws-tabs">
        {/* Casual drops Article (every blog angle is sell-coded) and Import (a
            store-catalogue concept) — it's about making & editing, not merchandising. */}
        {((casual ? [["video", "Video"], ["image", "Image"], ["music", "Music"], ["faceless", "Faceless"]] : [["video", "Video"], ["image", "Image"], ["blog", "Article"], ["import", "Import"]]) as [Tab, string][]).map(([k, label]) => (
          <button type="button" key={k} className={`ws-tab${tab === k ? " on" : ""}`} onClick={() => { setTab(k); setUpsell(null); }}>
            <TabIcon kind={k} />{label}
          </button>
        ))}
      </div>

      <Form method="post" encType="multipart/form-data" className="wb-card ws-card" onSubmit={onFormSubmit}>
        {/* ---- IMPORT: the setup tab. Bring the whole store in, and forge
             a presenter from your own logo or mascot. Both are queued jobs,
             so this tab is about kicking them off and watching them land. ---- */}
        {tab === "import" && (
          <div className="ws-import-tab">
            <div className="ws-lbl">Bring your store in</div>
            {d.catalog.length > 0 ? (
              <p className="ws-offernote">
                <b>{d.catalogCount} product{d.catalogCount === 1 ? "" : "s"}</b> imported.
                {d.catalogTruncated ? " That’s our maximum for a single import, so if your store has more they aren’t here yet." : ""}{" "}
                Pick one from the grid
                whenever you make something — no more hunting down links. Re-run this any time your catalogue changes.
              </p>
            ) : (
              <p className="ws-offernote">
                Paste your store address once and we pull your products in — photos, titles and links. After that
                you choose from a grid instead of pasting a link every time, and the product page rides along to
                the post so shoppers land on the buy page.
              </p>
            )}
            <div className="ws-import">
              <input className="wb-in" type="url" value={storeInput} placeholder="yourstore.com"
                onChange={(e) => setStoreInput(e.target.value)} />
              <button type="button" className="wb-btn" disabled={busy || d.catalogSyncing || !storeInput.trim()}
                onClick={() => submit({ intent: "importCatalog", storeUrl: storeInput.trim() }, { method: "post" })}>
                {d.catalog.length > 0 ? "Re-import" : "Pull my products in"}
              </button>
            </div>
            {actionData && "catalogError" in actionData && actionData.catalogError
              ? <div className="wb-err">{String(actionData.catalogError)}</div> : null}
            {actionData && "catalogQueued" in actionData && actionData.catalogQueued
              ? <p className="ws-offernote">Import queued — your products will appear here shortly.</p> : null}
            {d.catalogSyncing && <CatalogSync startedAt={d.catalogSyncStartedAt} />}
            {!d.catalogSyncing && d.catalogFailed && (
              <div className="wb-err" style={{ marginTop: 10 }}>
                <b>That import didn&apos;t work.</b> {d.catalogFailed}
              </div>
            )}

            <div className="ws-lbl" style={{ marginTop: 26 }}>
              <span>Turn your brand mascot into a marketing tool</span>
            </div>
            <p className="ws-offernote">
              Upload your logo, mascot or spokesperson and we forge them into a presenter — four outfits, ready to
              star in your videos. Yours alone: nobody else&rsquo;s Studio can cast them.
            </p>
            <div className="ws-import ws-avatarforge">
              <input className="wb-in" name="avatarName" placeholder="Presenter name (e.g. your mascot)"
                value={avatarName} onChange={(e) => setAvatarName(e.target.value)} />
              <input className="wb-in" type="file" accept="image/*"
                onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} />
              <button type="button" className="wb-btn" disabled={busy || !avatarName.trim() || !avatarFile}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("intent", "forgeAvatar");
                  fd.set("avatarName", avatarName.trim());
                  fd.set("avatarGender", avatarGender);
                  if (avatarFile) fd.set("avatarPhoto", avatarFile);
                  submit(fd, { method: "post", encType: "multipart/form-data" });
                }}>
                Forge my presenter
              </button>
            </div>
            <div className="ws-seg" style={{ marginTop: 10 }}>
              {([["m", "He"], ["f", "She"]] as [string, string][]).map(([g, label]) => (
                <button type="button" key={g} className={avatarGender === g ? "sel" : ""}
                  onClick={() => setAvatarGender(g)}>{label}</button>
              ))}
            </div>
            {actionData && "avatarError" in actionData && actionData.avatarError
              ? <div className="wb-err">{String(actionData.avatarError)}</div> : null}
            {/* The buffer sits at the BOTTOM, under the form, so the moment you
                hit Forge there is something visibly working. */}
            {d.forgingAvatars.map((f) => (
              <ForgingPresenter key={f.name + f.startedAt} name={f.name} status={f.status} startedAt={f.startedAt} />
            ))}
          </div>
        )}

        {/* ---- VIDEO: pick your content type (big live-render tiles) ---- */}
        {tab === "video" && !contentType && (
          <>
            <div className="ws-lbl">Pick your content type</div>
            <div className="ws-tiles ws-scrollbox">
              {CONTENT_TYPES.filter((ct) => !casual || !(ct.key === "commercial" || ct.key === "review")).map((ct) => {
                const locked = !can(ct.cap);
                return (
                  <button type="button" key={ct.key} className={`ws-tile${locked ? " lockd" : ""}`}
                    onClick={() => (locked ? setUpsell({ name: ct.name, tier: ct.tier, price: ct.price }) : (setContentType(ct.key), setUpsell(null)))}>
                    <span className="ws-tile-img" style={{ backgroundImage: `url(${ct.cover})` }}>
                      {locked && <span className="ws-lock"><Ico n="lock" size={13} /> {ct.tier}</span>}
                    </span>
                    <b>{ct.name}</b>
                    {/* The description, always. With no plan every tile is
                        locked, so this line used to replace all eight
                        explanations with “Unlock with Studio” — a merchant
                        deciding whether to pay could not find out what Anthem,
                        Unboxing or Satisfying Close-Up even were. The lock is
                        already said twice over by the badge and the tile
                        styling, and tapping one opens the panel that names the
                        tier and the price. */}
                    <span className="ws-tile-sub" title={ct.sub}>{ct.sub}</span>
                  </button>
                );
              })}
            </div>
            {upsell && (
              <div className="ws-upsell">
                <b><Ico n="lock" size={15} /> {upsell.name} is a {upsell.tier} feature</b>
                <p>Upgrade to {upsell.tier} (${upsell.price}/mo) to unlock it — everything you already have comes along.</p>
                <div><Link to="/web" className="wb-btn" style={{ padding: "9px 20px", fontSize: 13 }}>See plans</Link>
                  <button type="button" className="wb-btn ghost" style={{ padding: "9px 16px", fontSize: 13, marginLeft: 8 }} onClick={() => setUpsell(null)}>Not now</button></div>
              </div>
            )}
          </>
        )}
        {tab === "video" && contentType && (
          <>
            <button type="button" className="ws-back" onClick={() => setContentType(null)}>‹ Content type</button>
            <StepHead n={1} title="Pick the look" hint="who stars in it, and how it's shot" />
            {/* Real content type always rides along — the pipelines route on it
                and videoCapabilityFor() gates avatar/highlight as plain "video". */}
            <input type="hidden" name="contentType" value={contentType} />
            {contentType === "jingle" && (
              <p className="ws-note"><Ico n="music" /> <b>Anthem</b> — we write your product an earworm: the iconic, stuck-in-your-head jingle of a 2000s commercial, and your presenter <i>sings it on camera</i>, lipsynced. Pick your singer first — photoreal, or redrawn in a cartoon style below. No singer = the song plays over a cinematic product shot.</p>
            )}
            {/* Presenter FIRST — the style tiles below render as the chosen
              * presenter, so picking them in this order explains the art. */}
            {(baseOf(contentType) === "avatar" || showCartoonGrid) && <Presenters cast={d.cast} avatarId={avatarId} setAvatarId={setAvatarId} optional={baseOf(contentType) !== "avatar"} brandFaceId={d.brandFaceId} />}
            {contentType === "cartoon" && !avatarId && <p className="ws-note">No presenter — the ad goes product-hero in the picked style instead.</p>}
            {contentType === "jingle" && !avatarId && <p className="ws-note">No singer picked — the anthem plays over a hero shot of your product instead.</p>}
            {showCartoonGrid && (
              <>
                <div className="ws-lbl">{contentType === "jingle" ? "Singer style" : "Pick a cartoon avatar style"} <span className="ws-opt">previews show your chosen {contentType === "jingle" ? "singer" : "presenter"}</span></div>
                <div className="ws-tiles styles ws-scrollbox">
                  {contentType === "jingle" && (
                    <button type="button" className={`ws-tile small${cartoonStyle === null ? " sel" : ""}`}
                      onClick={() => setCartoonStyle(null)}>
                      <span className="ws-tile-img" style={{ backgroundImage: `url(${d.cast.find((c) => c.id === styleChar)?.img || ""})` }}>{cartoonStyle === null && <span className="ws-chk">✓</span>}</span>
                      <b><Ico n="camera" /> Photoreal</b>
                    </button>
                  )}
                  {CARTOON_STYLES.map((cs) => (
                    <button type="button" key={cs.key} className={`ws-tile small${cartoonStyle === cs.key ? " sel" : ""}`}
                      onClick={() => setCartoonStyle(cs.key)}>
                      <span className="ws-tile-img" style={{ backgroundImage: `url(${styleCover(cs.key)})`, backgroundColor: cs.tint }}>{cartoonStyle === cs.key && <span className="ws-chk">✓</span>}</span>
                      <b>{cs.name}</b>
                    </button>
                  ))}
                </div>
                {contentType === "cartoon" && (cartoonStyle ? (
                  <p className="ws-note"><Ico n="palette" /> <b>{CARTOON_STYLES.find((c) => c.key === cartoonStyle)?.name}</b> — {CARTOON_STYLES.find((c) => c.key === cartoonStyle)?.blurb}. Your presenter and product get redrawn in this style, then animated with a narrator.</p>
                ) : (
                  <p className="ws-note">Pick the style — your presenter becomes the character, your product stays recognizable.</p>
                ))}
                {cartoonStyle && <input type="hidden" name="cartoonStyle" value={cartoonStyle} />}
              </>
            )}
            {contentType === "highlight" && <p className="ws-note"><Ico n="video" /> <b>Product Highlight</b> — cinematic motion built around your product. No presenter needed.</p>}
            {contentType === "commercial" && <p className="ws-note"><Ico n="film" /> <b>Commercial</b> — a multi-scene cinematic story ad that ends on your product, like a big-budget TV spot. No presenter needed; give direction below to steer the story.</p>}
            {contentType === "review" && <p className="ws-note"><Ico n="camera" /> <b>Creator Demo</b> — your presenter demos the product like a creator would: phone-shot, casual, straight to camera. Organic UGC energy without faking a customer review.</p>}
            {contentType === "unboxing" && <p className="ws-note"><Ico n="box" /> <b>Unboxing</b> — the box opens on camera: your presenter lifts the product out, reacts, and shows it off up close.</p>}
            {contentType === "asmr" && <p className="ws-note"><Ico n="wave" /> <b>Satisfying Close-Up</b> — extreme macro, slow luxurious motion, textures and light. No presenter — just the loop nobody scrolls past.</p>}
            {avatarId && needsPresenterField(contentType) && <input type="hidden" name="avatarId" value={avatarId} />}
            {!casual && (contentType === "avatar" || contentType === "highlight") && (
              <label className="ws-commercial">
                <input type="checkbox" name="commercial" value="1" checked={commercial}
                  onChange={(e) => { setCommercial(e.target.checked); if (e.target.checked) setBreakout(false); }} />
                <span><b><Ico n="video" /> Commercial look</b> — big-budget studio spot: color-block set matched to your product, hero-lit</span>
              </label>
            )}
            {contentType === "highlight" && (
              <label className="ws-commercial">
                <input type="checkbox" name="breakout" value="1" checked={breakout}
                  onChange={(e) => { setBreakout(e.target.checked); if (e.target.checked) setCommercial(false); }} />
                <span><b><Ico n="burst" /> Breakout</b> — your product bursts out of a social post frame in 3D, the scroll-stopper</span>
              </label>
            )}
            <div className="ws-lbl">Video engine <span className="ws-opt">premium engines add tokens</span></div>
            {!engineApplies && (
              <p className="ws-enginenote">
                {engineForcedDefault
                  ? "Commercials are built from several scenes, so they always render on our standard engine — no engine surcharge."
                  : "Presenter ads are rendered by our lip-sync engine, so the engine choice and its surcharge don't apply here."}
              </p>
            )}
            <div className={`ws-engines${engineApplies ? "" : " off"}`}>
              {VIDEO_ENGINES.map((e) => (
                <button type="button" key={e.key} className={`ws-engine${videoEngine === e.key ? " sel" : ""}`} title={e.blurb} onClick={() => setVideoEngine(e.key)}>
                  <b>{e.name}</b><span>{e.surcharge > 0 ? `+${e.surcharge}` : "included"}</span>
                </button>
              ))}
            </div>
            <input type="hidden" name="videoEngine" value={videoEngine} />
          </>
        )}

        {/* ---- IMAGE: product-ad templates or presenter-holding ---- */}
        {tab === "image" && !imageMode && (
          <>
            <div className="ws-lbl">{casual ? "What do you want to make?" : "What kind of image ad?"}</div>
            <div className={`ws-tiles${casual ? "" : " two"}`}>
              {casual && (
                <button type="button" className="ws-tile" onClick={() => setImageMode("create")}>
                  <span className="ws-tile-img" style={{ backgroundImage: "url(/ad-templates/format-poster.jpg?v=2)" }} />
                  <b>Make an image</b><span className="ws-tile-sub">Type anything — pick an art style, generate</span>
                </button>
              )}
              <button type="button" className="ws-tile" onClick={() => setImageMode("product")}>
                <span className="ws-tile-img" style={{ backgroundImage: "url(/ad-templates/format-offer.jpg?v=2)" }} />
                <b>{casual ? "Edit a photo" : "Product ad"}</b><span className="ws-tile-sub">{casual ? "Restyle, cartoonize, change the background" : "Your product in a famous ad format"}</span>
              </button>
              <button type="button" className="ws-tile" onClick={() => setImageMode("presenter")}>
                <span className="ws-tile-img" style={{ backgroundImage: "url(/style-tiles/avatarcover.jpg?v=4)" }} />
                <b>{casual ? "With a character" : "With presenter"}</b><span className="ws-tile-sub">{casual ? "A character holds or shows it" : "A presenter holds it, poster copy on top"}</span>
              </button>
            </div>
          </>
        )}
        {tab === "image" && imageMode && (
          <>
            <button type="button" className="ws-back" onClick={() => { setImageMode(null); setTemplateKey(null); }}>‹ Image type</button>
            <StepHead n={1} title={isCreate ? "Pick a style" : "Pick the look"} hint={isCreate ? "the art style for your image" : casual ? "how your image is styled" : "the structure your ad is built on"} />
            {imageMode === "create" && casual && (
              <>
                <div className="ws-lbl">Art style <span className="ws-opt">optional</span></div>
                <div className="ws-fmtcats" role="tablist" aria-label="Art style">
                  {CREATE_STYLES.map((s) => (
                    <button type="button" key={s.key} role="tab" aria-selected={createStyle === s.key}
                      className={`ws-fmtcat${createStyle === s.key ? " sel" : ""}`} onClick={() => setCreateStyle(createStyle === s.key ? null : s.key)}>
                      <span aria-hidden="true">{s.emoji}</span> {s.name}
                    </button>
                  ))}
                </div>
                <p className="ws-note">Describe what you want below and we&apos;ll generate it{createStyle ? ` in ${CREATE_STYLES.find((s) => s.key === createStyle)?.name} style` : ""} — no photo needed.</p>
                {createStyle && <input type="hidden" name="createStyle" value={createStyle} />}
              </>
            )}
            {imageMode === "product" && casual && (
              <>
                <div className="ws-lbl">Quick actions <span className="ws-opt">optional</span></div>
                <div className="ws-fmtcats" role="tablist" aria-label="Photo edit">
                  {([["restyle", "🎨 Restyle"], ["cartoonize", "✏️ Cartoonize"], ["replace", "🔁 Replace"], ["colorize", "🌈 Colorize"], ["upscale", "🔍 Upscale"], ["bgswap", "🖼 Swap background"], ["bgremove", "✂️ Remove background"]] as [string, string][]).map(([k, label]) => (
                    <button type="button" key={k} role="tab" aria-selected={editOp === k}
                      className={`ws-fmtcat${editOp === k ? " sel" : ""}`} onClick={() => setEditOp(editOp === k ? null : k)}>{label}</button>
                  ))}
                </div>
                <p className="ws-note">
                  {editOp === "bgremove" ? "Upload your photo — we'll cut the subject out onto a clean transparent background."
                    : editOp === "bgswap" ? "Upload your photo, then describe the new background in the box below."
                    : editOp === "cartoonize" ? "Upload your photo — we'll redraw it as a cartoon. Add any direction below to steer the style."
                    : editOp === "restyle" ? "Upload your photo and describe the look you want in the box below."
                    : editOp === "colorize" ? "Upload a black-and-white or faded photo — we'll add natural, realistic colour."
                    : editOp === "upscale" ? "Upload your photo — we'll sharpen and upscale it to higher resolution."
                    : editOp === "replace" ? "Upload your photo, then describe what to change in the box below."
                    : "Upload your photo and just describe the changes you want below — or tap a quick action."}
                </p>
                {editOp && <input type="hidden" name="editOp" value={editOp} />}
              </>
            )}
            {imageMode === "product" && !service && !casual && (
              <>
                <div className="ws-lbl">Ad format <span className="ws-opt">proven structures, not filters</span></div>
                <div className="ws-fmtcats" role="tablist" aria-label="Ad format categories">
                  {FORMAT_GROUPS.map((g) => (
                    <button type="button" key={g.key} role="tab" aria-selected={fmtGroup === g.key}
                      className={`ws-fmtcat${fmtGroup === g.key ? " sel" : ""}`} title={g.blurb}
                      onClick={() => setFmtGroup(g.key)}>
                      <span aria-hidden="true">{g.emoji}</span> {g.name}
                    </button>
                  ))}
                  <button type="button" role="tab" aria-selected={fmtGroup === "all"}
                    className={`ws-fmtcat${fmtGroup === "all" ? " sel" : ""}`} title="Every format"
                    onClick={() => setFmtGroup("all")}>All {AD_FORMATS.length}</button>
                </div>
                {/* What's armed, shown above the tiles so a selection made in one
                    category isn't invisible while browsing another — otherwise a
                    merchant could generate "Callouts" while looking at an empty-
                    looking Offers tab. */}
                {formatKey && AD_FORMAT_BY_KEY[formatKey] && (
                  <p className="ws-fmtsel">
                    Selected: <b>{AD_FORMAT_BY_KEY[formatKey].name}</b>
                    <button type="button" onClick={() => setFormatKey(null)} aria-label={`Clear ${AD_FORMAT_BY_KEY[formatKey].name}`}>✕</button>
                  </p>
                )}
                {(() => {
                  const grp = FORMAT_GROUPS.find((g) => g.key === fmtGroup);
                  const scroll = fmtGroup === "all";
                  const shown: AdFormat[] = scroll || !grp
                    ? AD_FORMATS
                    : grp.formats.map((k) => AD_FORMAT_BY_KEY[k]).filter((f): f is AdFormat => !!f && !f.retired);
                  return (
                    <>
                      {grp && grp.key !== "popular" && <p className="ws-fmthint">{grp.blurb}</p>}
                      <div className={`ws-tiles fmt${scroll ? " ws-fmtbox" : ""}`}>
                        {shown.map((f, i) => (
                          <button type="button" key={f.key} className={`ws-tile fmt${formatKey === f.key ? " sel" : ""}`} title={f.blurb}
                            style={scroll ? { animationDelay: `${Math.min(i * 22, 550)}ms` } : undefined}
                            onClick={() => { setFormatKey(formatKey === f.key ? null : f.key); setTemplateKey(null); }}>
                            <span className="ws-tile-img" style={{ backgroundImage: `url(/ad-templates/format-${f.key}.jpg?v=2)` }}>{formatKey === f.key && <span className="ws-chk">✓</span>}</span>
                            <b>{f.name}</b>
                          </button>
                        ))}
                      </div>
                    </>
                  );
                })()}
                <p className="ws-note">Each format is a different creative <b>structure</b> — copy is written fresh for your product, the layout is built around your real photo, and a vision check rejects garbled text before you ever see it.</p>
                {formatKey && <input type="hidden" name="formatKey" value={formatKey} />}
                <details>
                  <summary className="ws-lbl" style={{ cursor: "pointer" }}>Backdrop scenes (classic){templateKey ? " · 1 selected" : ""}</summary>
                  <div className="ws-tiles styles ws-scrollbox">
                    {d.templates.map((t) => (
                      <button type="button" key={t.key} className={`ws-tile small${templateKey === t.key ? " sel" : ""}`} title={t.blurb}
                        onClick={() => { setTemplateKey(templateKey === t.key ? null : t.key); setFormatKey(null); }}>
                        <span className="ws-tile-img" style={{ backgroundImage: `url(/ad-templates/preview-${t.key}.jpg?v=10)` }}>{templateKey === t.key && <span className="ws-chk">✓</span>}</span>
                        <b>{t.name}</b>
                        <span className="ws-tile-sub">{t.kind === "exact" ? "Exact match — your product, this scene" : "AI-staged to match"}</span>
                      </button>
                    ))}
                  </div>
                </details>
                {templateKey && <input type="hidden" name="templateKey" value={templateKey} />}
              </>
            )}
            {imageMode === "presenter" && (
              <>
                <Presenters cast={d.cast} avatarId={avatarId} setAvatarId={setAvatarId} brandFaceId={d.brandFaceId} />
                {avatarId && <p className="ws-note">{casual ? "The character will hold your subject in the shot — add a photo below." : "The presenter will hold your product in the shot — add a product photo below."}</p>}
                {avatarId && <input type="hidden" name="avatarId" value={avatarId} />}
              </>
            )}
          </>
        )}

        {/* Outfit rotation + Brand Face crowning, wherever a presenter stars. */}
        {((tab === "video" && baseOf(contentType) === "avatar") || (tab === "image" && imageMode === "presenter")) && avatarId && (
          <>
            <p className="ws-note">{casual ? "Their outfit changes each time, so every shot looks a little different." : "Their outfit rotates each time, so your content never looks stale."}</p>
            {!casual && avatarId !== d.brandFaceId && (
              <button type="button" className="ws-setbf" onClick={() => submit({ intent: "setBrandFace", avatarId }, { method: "post" })}>
                <Ico n="star" size={13} /> Make {d.cast.find((c) => c.id === avatarId)?.name || "this presenter"} your Brand Face
              </button>
            )}
          </>
        )}

        {/* ---- Shared product fields + CTA ---- */}
        {cfgReady && (
          <>
            {/* "Make an image" and "Make music" generate from text — they need
                no subject/photo, so the whole step-2 block is skipped for them. */}
            {!isCreate && !isMusic && !isFaceless && (<>
            <StepHead n={2} title={casual ? "Your subject" : "Your product"} hint={casual ? "what this is about" : "what we're actually selling"} />

            {/* ---- Catalogue picker ----
                Pasting a link and retyping the title on every generation is a
                tax the merchant pays forever. Their storefront gets mirrored
                once, and from then on this is two taps. Hidden in casual — a
                store catalogue is a selling concept; casual uploads its own photo. */}
            {d.catalog.length > 0 && !casual ? (
              <>
                <div className="ws-lbl">
                  <span>Pick from your store</span>
                  <span className="ws-opt">
                    {catShown.length < d.catalogCount
                      ? `showing ${catShown.length} of ${d.catalogCount} — search for the rest`
                      : `${d.catalogCount} product${d.catalogCount === 1 ? "" : "s"}`}
                  </span>
                </div>
                {d.catalog.length > 8 && (
                  <input className="wb-in ws-catsearch" value={catQuery} placeholder="Search your catalogue…"
                    onChange={(e) => setCatQuery(e.target.value)} />
                )}
                <div className="ws-catgrid">
                  {catShown
                    .map((c) => (
                      <button type="button" key={c.id}
                        className={`ws-cat${productTitle === c.title ? " sel" : ""}`}
                        title={c.title}
                        onClick={() => {
                          setProductTitle(c.title);
                          setImageUrl(c.imageUrl || "");
                          setPickedUrl(c.url);
                        }}>
                        <span className="ws-cat-img" style={c.imageUrl ? { backgroundImage: `url(${c.imageUrl})` } : undefined}>
                          {!c.imageUrl && <Ico n="image" size={22} />}
                          {productTitle === c.title && <span className="ws-chk">✓</span>}
                        </span>
                        <b>{c.title}</b>
                        {c.priceText && <span className="ws-cat-p">{c.priceText}</span>}
                      </button>
                    ))}
                </div>
                <div className="ws-catfoot">
                  {!d.catalogSyncing && (
                    <button type="button" className="ws-addurl" onClick={() => setShowConnect((v) => !v)}>
                      {showConnect ? "Cancel" : "↻ Refresh catalogue"}
                    </button>
                  )}
                </div>
                {d.catalogSyncing && <CatalogSync startedAt={d.catalogSyncStartedAt} />}
              </>
            ) : (
              <div className="ws-connect">
                <b><Ico n="box" /> Bring your whole store in</b>
                <p>Paste your store address once and we&rsquo;ll pull your products in — then you pick one from a grid instead of hunting down a link every time. Your product page link rides along to the post, so shoppers land straight on the buy page.</p>
                {/* A failed import otherwise showed only on the Import tab, so a
                    merchant who came straight here to generate had no idea why
                    their store never appeared. */}
                {!d.catalogSyncing && d.catalogFailed && (
                  <div className="wb-err" style={{ marginBottom: 8 }}><b>That import didn&apos;t work.</b> {d.catalogFailed} You can paste a single product link below instead.</div>
                )}
                {!d.catalogSyncing && (
                  <button type="button" className="wb-btn ghost" onClick={() => setShowConnect(true)}>Connect my store</button>
                )}
              </div>
            )}
            {d.catalogSyncing && d.catalog.length === 0 && <CatalogSync startedAt={d.catalogSyncStartedAt} />}
            {showConnect && !d.catalogSyncing && (
              <div className="ws-import">
                <input className="wb-in" type="url" value={storeInput} placeholder="yourstore.com"
                  onChange={(e) => setStoreInput(e.target.value)} />
                <button type="button" className="wb-btn" disabled={busy || !storeInput.trim()}
                  onClick={() => { submit({ intent: "importCatalog", storeUrl: storeInput.trim() }, { method: "post" }); setShowConnect(false); }}>
                  Pull my products in
                </button>
              </div>
            )}
            {showWear && (
              <>
                <div className="ws-lbl"><span>How big is it?</span> <span className="ws-opt">so the presenter holds it at the right size</span></div>
                <div className="ws-seg ws-sizeseg">
                  <button type="button" className={!productSize ? "sel" : ""} onClick={() => setProductSize("")}>Auto</button>
                  {SIZE_CHOICES.map((sz) => (
                    <button type="button" key={sz.key} className={productSize === sz.key ? "sel" : ""} onClick={() => setProductSize(sz.key)}>
                      {sz.label}
                    </button>
                  ))}
                </div>
                {productSize ? <input type="hidden" name="productSize" value={productSize} /> : null}
                <p className="ws-offernote">
                  A product photo on a white background carries no scale, so we read the size from your
                  title. Set it yourself if a render comes out too big or too small.
                </p>
              </>
            )}
            {(actionData as { catalogError?: string } | null)?.catalogError && (
              <div className="wb-err" style={{ marginTop: 8 }}>{(actionData as { catalogError?: string }).catalogError}</div>
            )}
            {pickedUrl ? <input type="hidden" name="productUrl" value={pickedUrl} /> : null}

            <div className="ws-lbl"><span>Product name</span>
              <button type="button" className="ws-addurl" onClick={() => setShowImport((s) => !s)}>{showImport ? "Cancel" : "＋ Add by URL"}</button>
            </div>
            {showImport && (
              <div className="ws-import">
                <input className="wb-in" type="url" value={urlInput} placeholder="Paste a product link…" onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && urlInput.trim()) { e.preventDefault(); doImport(); } }} />
                <button type="button" className="wb-btn ws-impbtn" disabled={busy || !urlInput.trim()} onClick={doImport}>{busy ? "…" : "Import"}</button>
              </div>
            )}
            {importErr && <p className="ws-note" style={{ color: "#9A3120" }}>{importErr}</p>}
            {/* setPickedUrl("") because no URL is remembered with the last
                product — the previous pick's link must not survive the swap. */}
            {lastProd && lastProd.title && lastProd.title !== productTitle.trim() && (
              <button type="button" className="ws-chip ws-lastchip" onClick={() => { setProductTitle(lastProd.title); setImageUrl(lastProd.image || ""); setPickedUrl(""); }}>
                ↺ Use last: {lastProd.title}
              </button>
            )}
            <input className="wb-in" name="productTitle" required={!isEdit} value={productTitle} onChange={(e) => { setProductTitle(e.target.value); setPickedUrl(""); }} placeholder={isEdit ? "Optional name for your edit" : casual ? "My dog Biscuit · Sunset at the lake" : "Midnight Roast — whole bean coffee"} />
            {tab !== "blog" && (
              <>
                <div className="ws-lbl">{casual ? <>Photo <span className="ws-opt">powers your videos and images — upload or paste a URL</span></> : <>Product photo <span className="ws-opt">powers videos & image ads — upload or paste a URL</span></>}</div>
                <input className="wb-in" type="file" name="productPhoto" accept="image/jpeg,image/png,image/webp" style={{ padding: 9 }}
                  onChange={(e) => setHasFile(!!e.currentTarget.files?.length)} />
                <input className="wb-in" name="productImageUrl" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder={casual ? "…or https://example.com/my-photo.jpg" : "…or https://yourstore.com/cdn/product.jpg"} style={{ marginTop: 8 }} />
                {needsPhoto && (
                  <p className="ws-note" style={{ color: "#8A5A12" }}>
                    {casual
                      ? <>Add a photo so it&apos;s really <b>yours</b> — without one we&apos;d just be inventing something from the name.</>
                      : <>Add a photo so the ad features <b>your</b> product — without one we&apos;d be inventing a product from the name. Promoting a service? Switch to <b>Service / offer</b> below.</>}
                  </p>
                )}
              </>
            )}

            {showService && (
              <>
                <div className="ws-lbl">What are you promoting?</div>
                <div className="ws-seg">
                  <button type="button" className={!service ? "sel" : ""} onClick={() => setService(false)}><Ico n="box" /> Physical product</button>
                  <button type="button" className={service ? "sel" : ""} onClick={() => setService(true)}><Ico n="burst" /> Service / offer</button>
                </div>
                {service && <p className="ws-svchint">{tab === "video" && contentType === "commercial" ? <>The commercial tells your offer&apos;s <b>transformation story</b> — before, discovery, after — and closes on a branded end-card. No product shot needed.</> : tab === "video" && (contentType === "cartoon" || contentType === "jingle" || baseOf(contentType) === "highlight") ? <>The ad sells the <b>outcome</b> of your offer — no product shot needed. Great for coaching, subscriptions, digital &amp; local services.</> : tab === "image" ? <>We build a lifestyle scene that sells the <b>outcome</b> of your offer — no product shot needed. Great for coaching, subscriptions, digital &amp; local services.</> : <>The presenter explains your offer and sells the <b>outcome</b> — no product shot needed. Great for coaching, subscriptions, digital &amp; local services.</>}</p>}
              </>
            )}

            {showWear && (
              <>
                <div className="ws-lbl"><span>How they show it</span>{apparel && <span className="ws-opt">apparel detected</span>}</div>
                <div className="ws-seg">
                  <button type="button" className={!wear ? "sel" : ""} onClick={() => setWearOverride(false)}><Ico n="figure" /> Holding it</button>
                  <button type="button" className={wear ? "sel" : ""} onClick={() => setWearOverride(true)}><Ico n="shirt" /> Wearing it <span className="ws-wq">(generally for apparel)</span></button>
                </div>
              </>
            )}
            </>)}

            <StepHead n={3} title={isFaceless ? "Your video" : isCreate || isMusic ? "Describe it" : `Direction & ${verb.toLowerCase()}`} hint={isFaceless ? "what's it about?" : isCreate || isMusic ? "the more detail, the better" : "leave it to EasyMode, or steer it"} />
            {tab === "image" && !casual && (
              <>
                <div className="ws-lbl"><span>Running a promo?</span> <span className="ws-opt">optional</span></div>
                <input className="wb-in" name="merchantOffer" maxLength={40} placeholder="e.g. 20% off first order" />
                <p className="ws-offernote">
                  Only fill this in if you&rsquo;re <b>actually</b> running it — we never invent discounts, so
                  offer-style ads sell on the product instead when this is blank.
                </p>
              </>
            )}
            {tab === "video" ? (
              <>
                <div className="ws-lbl"><span>Prompting</span>
                  <button type="button" className="ws-addurl" onClick={() => setAdvanced((a) => !a)}>{advanced ? "Use auto" : "Advanced ▾"}</button>
                </div>
                {!advanced ? (
                  <>
                    <div className="ws-autobox">✨ <b>EasyMode decides</b> the scene &amp; script from your brand voice. Tap <b>Advanced</b> to direct it yourself — or drop a quick direction below.</div>
                    <input className="wb-in" value={direction} maxLength={300} placeholder="cozy autumn morning energy, focus on the aroma" onChange={(e) => setDirection(e.target.value)} />
                    {/* Blank boxes freeze people. Three tappable directions
                        show the register and prove a single sentence is
                        enough — tap to fill, tap again to clear. */}
                    <div className="ws-chips" style={{ marginTop: 8 }}>
                      {["golden-hour rooftop, confident and premium", "fast + funny, lead with the price", "cozy at home, make it feel like a gift"].map((ex) => (
                        <button type="button" key={ex} className={`ws-chip${direction === ex ? " sel" : ""}`} onClick={() => setDirection(direction === ex ? "" : ex)}>✨ {ex}</button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="ws-3w">
                    <div>
                      <span className="ws-w">{contentType === "jingle" ? "What should the anthem sing about?" : contentType === "cartoon" ? "What should the narrator say?" : "What do they say?"}</span>
                      <textarea className="wb-in ws-ta" value={saySomething} maxLength={400} placeholder={contentType === "jingle" ? "Lines or claims to work into the lyrics…" : "The hook + a couple talking points, in your voice…"} onChange={(e) => setSaySomething(e.target.value)} />
                    </div>
                    <div>
                      <span className="ws-w">{contentType === "cartoon" || contentType === "jingle" ? "What happens in the scene?" : "What do they do?"}</span>
                      <input className="wb-in" type="text" value={doWhat} maxLength={160} placeholder={contentType === "cartoon" || contentType === "jingle" ? "the product saves the day, sparkles, celebration…" : "unbox it, hold it up, demo a feature…"} onChange={(e) => setDoWhat(e.target.value)} />
                    </div>
                    <div>
                      <span className="ws-w">{contentType === "cartoon" || contentType === "jingle" ? "Where does it happen?" : "Where are they?"}</span>
                      <input className="wb-in" type="text" value={where} maxLength={140} placeholder="a cozy cabin, a city rooftop, a snowy slope…" onChange={(e) => setWhere(e.target.value)} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {tab === "blog" && (
                  <>
                    <div className="ws-lbl">Pick an angle <span className="ws-opt">optional</span></div>
                    <div className="ws-chips">
                      {BLOG_ANGLES.map((s, i) => (
                        <button type="button" key={i} className={`ws-chip${direction === s.prompt ? " sel" : ""}`} onClick={() => setDirection(direction === s.prompt ? "" : s.prompt)}><Ico n={s.icon} /> {s.label}</button>
                      ))}
                    </div>
                  </>
                )}
                {tab === "music" && (
                  <>
                    <div className="ws-lbl">Genre / mood <span className="ws-opt">optional</span></div>
                    <div className="ws-fmtcats" role="tablist" aria-label="Music style">
                      {MUSIC_STYLES.map((s) => (
                        <button type="button" key={s.key} role="tab" aria-selected={musicStyle === s.key}
                          className={`ws-fmtcat${musicStyle === s.key ? " sel" : ""}`} onClick={() => setMusicStyle(musicStyle === s.key ? null : s.key)}>
                          <span aria-hidden="true">{s.emoji}</span> {s.name}
                        </button>
                      ))}
                    </div>
                    {musicStyle && <input type="hidden" name="musicStyle" value={musicStyle} />}
                  </>
                )}
                {tab === "faceless" && (
                  <>
                    <div className="ws-lbl">Format</div>
                    <div className="ws-fmtcats" role="tablist" aria-label="Video format">
                      {([["motivational", "💪 Motivational"], ["facts", "💡 Facts"], ["storytime", "📖 Storytime"], ["listicle", "🔢 Listicle"]] as [string, string][]).map(([k, label]) => (
                        <button type="button" key={k} role="tab" aria-selected={facelessFormat === k}
                          className={`ws-fmtcat${facelessFormat === k ? " sel" : ""}`} onClick={() => setFacelessFormat(k)}>{label}</button>
                      ))}
                    </div>
                    <div className="ws-lbl" style={{ marginTop: 12 }}>Voice</div>
                    <div className="ws-fmtcats" role="tablist" aria-label="Voice">
                      {([["f-warm", "🎙 Female · calm"], ["f-hype", "🎙 Female · hype"], ["m-warm", "🎙 Male · calm"], ["m-hype", "🎙 Male · hype"]] as [string, string][]).map(([k, label]) => (
                        <button type="button" key={k} role="tab" aria-selected={voiceKey === k}
                          className={`ws-fmtcat${voiceKey === k ? " sel" : ""}`} onClick={() => setVoiceKey(k)}>{label}</button>
                      ))}
                    </div>
                    <input type="hidden" name="facelessFormat" value={facelessFormat} />
                    <input type="hidden" name="voiceKey" value={voiceKey} />
                    <p className="ws-note" style={{ marginTop: 12 }}>We write the script, voice it, generate the b-roll + word-synced captions and set it to music — a ready-to-post 9:16 video. Takes a few minutes.</p>
                  </>
                )}
                {/* WHAT THIS BOX DOES DEPENDS ON WHAT IS ABOVE IT.
                    With an ad FORMAT picked the composition is already fixed
                    and this text only ever reaches the copywriter as “Angle:”,
                    so asking the merchant to “describe the scene you want”
                    invited an instruction the renderer will not follow — and
                    they then blame the app for ignoring them. Ask for the
                    thing it can actually deliver. */}
                <div className="ws-lbl">
                  {tab === "image"
                    ? isCreate
                      ? "Describe your image"
                      : isEdit
                        ? editOp === "bgswap" ? "Describe the new background" : editOp === "replace" ? "What to change" : editOp === "cartoonize" ? "Cartoon style" : (editOp === "bgremove" || editOp === "colorize" || editOp === "upscale") ? "No input needed" : editOp === "restyle" ? "Describe the look" : "Describe your changes"
                        : templateKey ? "Tweaks" : formatKey ? "Anything to emphasise?" : "Describe it"
                    : tab === "music" ? "Describe your music"
                    : tab === "faceless" ? "What's your video about?"
                    : "Topic"}{" "}
                  <span className="ws-opt">{isCreate || isMusic || isFaceless ? "required" : isEdit && (editOp === "replace" || !editOp) ? "required" : isEdit && (editOp === "bgremove" || editOp === "colorize" || editOp === "upscale") ? "nothing to add" : "optional"}</span>
                </div>
                <input className="wb-in" value={direction} maxLength={300}
                  disabled={isEdit && (editOp === "bgremove" || editOp === "colorize" || editOp === "upscale")}
                  placeholder={
                    tab === "faceless"
                      ? "e.g. 5 mind-blowing facts about the deep ocean"
                    : tab === "music"
                      ? "e.g. upbeat lo-fi hip-hop with mellow piano and a soft beat"
                    : tab === "image"
                      ? isCreate
                        ? "e.g. a red panda astronaut floating over neon Tokyo at night"
                        : isEdit
                        ? editOp === "bgswap" ? "e.g. a sunny marble kitchen counter" : editOp === "replace" ? "e.g. replace the sky with a sunset" : editOp === "cartoonize" ? "e.g. bold outlines, flat colors — or leave blank" : (editOp === "bgremove" || editOp === "colorize" || editOp === "upscale") ? "Nothing to add — just hit Edit" : editOp === "restyle" ? "e.g. warm film look, soft golden light" : "e.g. make the shirt a purple hoodie, add a camera"
                        : templateKey
                          ? "Any edits — e.g. make the wall sage green, add pine branches…"
                          : formatKey
                            ? "e.g. lead with how fast it ships — or leave blank and we'll pick the angle"
                            : "Describe the scene you want — or leave blank for bright & clean…"
                      : "Tap an angle above, or describe your own topic…"
                  }
                  onChange={(e) => setDirection(e.target.value)} />
              </>
            )}

            {/* Composed fields ride hidden inputs so the native multipart
                submit (needed for the photo upload) carries them. */}
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="direction" value={finalDirection} />
            {finalScene ? <input type="hidden" name="scene" value={finalScene} /> : null}
            {serviceOn ? <input type="hidden" name="service" value="1" /> : null}
            {showWear && wear ? <input type="hidden" name="wear" value="1" /> : null}
            {avatarRides && <input ref={variantRef} type="hidden" name="avatarVariant" defaultValue="0" />}

            <div className="ws-tok"><span className="tt">This {noun}</span><span className="tb"><b>{cost}</b><i>tokens</i></span></div>

            {err && <div className="wb-err" style={{ marginTop: 4 }}>{err}</div>}
            {/* The trial cap is the ONE spend failure the merchant can clear
                themselves, so the way out sits on the message that blocked
                them rather than three taps away on the plans page. */}
            {err && d.trialing && /free trial/i.test(err) && (
              <div className="ws-trialout">
                <b>Don&rsquo;t want to wait?</b>
                <p>Start your plan now and your full monthly allowance unlocks immediately — your card is charged today instead of on day 7.</p>
                <button type="button" className="wb-btn" disabled={busy}
                  onClick={() => submit({ intent: "endTrial" }, { method: "post" })}>
                  Start my plan now
                </button>
              </div>
            )}
            {(actionData as { trialEnded?: string } | null)?.trialEnded && (
              <div className="wb-ok" style={{ marginTop: 8 }}>{(actionData as { trialEnded?: string }).trialEnded}</div>
            )}
            {/* BURST — a handful of usable variations in one go, so the merchant
                has options to post or test, not "pick one, bin the rest" (every
                take should be good). Blog has no burst: nobody wants five near
                identical articles, and each one is a page not a thumbnail. */}
            {tab !== "blog" && !isEdit && !isCreate && !isMusic && !isFaceless && (
              <div className="ws-burst">
                <span className="ws-burst-lbl">How many</span>
                <div className="ws-burst-steps">
                  {(tab === "video" ? BURST_STEPS.video : BURST_STEPS.image).map((n) => (
                    <button type="button" key={n} className={burst === n ? "sel" : ""}
                      onClick={() => setBurst(n)} aria-pressed={burst === n}>
                      {n === 1 ? "Just one" : `×${n}`}
                    </button>
                  ))}
                </div>
                {burst > 1 && (
                  <p className="ws-burst-note">
                    {tab === "image" && !templateKey && !formatKey && imageMode !== "presenter" && !service && !casual
                      ? `${burst} different ad layouts at once — a full set, all ready to post.`
                      : casual
                        ? `${burst} different looks at once — all yours to share.`
                        : `${burst} takes at once — same setup, different angles, all yours to use.`}
                  </p>
                )}
              </div>
            )}
            <input type="hidden" name="burst" value={burst} />
            <div style={{ marginTop: 10 }}>
              <button className="wb-btn" name="intent" value={submitIntent} disabled={ctaDisabled}>
                {busy
                  ? "Sending to the studio…"
                  : !d.hasPlan
                    ? "Pick a plan to start"
                  : shortBy > 0
                    ? `Needs ${shortBy.toLocaleString("en-US")} more token${shortBy === 1 ? "" : "s"} — ${cost * burst} for ${burst > 1 ? `${burst} ${noun}s` : `this ${noun}`}`
                  : burst > 1
                    ? `${verb} ${burst} ${noun}s — ${cost * burst} tokens`
                    : `${verb} ${noun} — ${cost} tokens${engineFee ? ` (incl. +${engineFee} engine)` : ""}`}
              </button>
              <p className="ws-wallet">
                {!d.hasPlan
                  ? <>Your 7-day free trial unlocks every generator — <Link to="/web#plans">pick a plan</Link> to begin.</>
                  : shortBy > 0
                    ? <>Wallet: {d.tokens.toLocaleString("en-US")} tokens · <Link to="/web#plans">Add tokens</Link>{burst > 1 ? " or make fewer at once" : ""}</>
                    : `Wallet: ${d.tokens.toLocaleString("en-US")} tokens`}
              </p>
            </div>
          </>
        )}
      </Form>

      {showDone && queued && (
        <div className="ws-scrim" onClick={() => setShowDone(false)}>
          <div className="ws-modal" onClick={(e) => e.stopPropagation()}>
            <span className="ws-mrose" aria-hidden />
            {/* The flex: crest, wordmark, gold rule. A stock sparkle emoji is
                the one thing on screen that isn't ours — this is the moment
                the merchant just paid for, so put our name on it. */}
            <div className="ws-flex" aria-hidden="true">
              <span className="ws-flex-crest"><img src="/easymode-head.png?v=2" alt="" /></span>
              <span className="ws-flex-word">Easy<b>Mode</b></span>
              <span className="ws-flex-rule" />
            </div>
            <b className="ws-mh">{queuedCount > 1 ? `Your ${queuedCount} ${queued}s are being made` : `Your ${queued === "faceless" ? "faceless video" : queued} is being made`}</b>
            <p className="ws-mp">{queuedCount > 1 ? <>They land in your <b>{casual ? "gallery" : "Archive"}</b> over the next few minutes — a set of different takes, all ready to {casual ? "share" : "post"}.</> : <>It lands in your <b>{casual ? "gallery" : "Archive"}</b> in a few minutes — along with everything else EasyMode builds for you.</>}</p>
            <Link className="wb-btn ws-mcta" to={`/web/archive?tab=${queued === "article" ? "blog" : queued === "faceless" ? "video" : queued}${casual ? "&section=creator" : ""}`}>{casual ? "View gallery ›" : "View Archive ›"}</Link>
            <button type="button" className="ws-mclose" onClick={() => setShowDone(false)}>Make another</button>
          </div>
        </div>
      )}
    </div>
  );
}

function needsPresenterField(ct: CType | null): boolean {
  return ct === "avatar" || ct === "cartoon" || ct === "jingle" || ct === "review" || ct === "unboxing";
}

/* Route-local styles — GStyle palette (paper #F4F1E6, card #FDFCF7, ink
 * #14201A, green #12A85E, gold #B08526/#E7C879), extending the ws-* look
 * that lives in the /web layout. */
const WS_STYLE = `
/* Search above the presenter row — typing a name beats scrubbing 100 faces. */
.ws-castsearch{position:relative;margin:0 0 8px}
.ws-castsearch .wb-in{width:100%;padding-right:34px}
.ws-cs-clr{position:absolute;top:50%;right:8px;transform:translateY(-50%);width:22px;height:22px;border-radius:50%;border:0;background:var(--paper,#F4F1E6);color:var(--ink2,#4A554E);font-size:11px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}
/* Forging buffer — the shape of what's coming, so the wait looks like work. */
.ws-forge{margin:14px 0 4px;padding:13px 14px;border-radius:14px;background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF)}
.ws-forge-hd{display:flex;gap:11px;align-items:flex-start;margin-bottom:12px}
.ws-forge-hd b{display:block;font-size:13.5px;color:var(--ink,#14201A)}
.ws-forge-hd span{display:block;font-size:12px;color:var(--ink2,#4A554E);margin-top:2px}
.ws-forge-spin{flex:0 0 auto;width:16px;height:16px;margin-top:2px;border-radius:50%;border:2px solid rgba(18,168,94,.25);border-top-color:#12A85E;animation:wsforgespin .8s linear infinite}
@keyframes wsforgespin{to{transform:rotate(360deg)}}
.ws-forge-row{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}
.ws-forge-card{animation:wsforgepulse 1.5s ease-in-out infinite;text-align:center}
@keyframes wsforgepulse{0%,100%{opacity:.45}50%{opacity:1}}
.ws-forge-img{display:block;width:100%;aspect-ratio:3/4;border-radius:11px;border:1px dashed var(--line,#E4DFCF);
  background:linear-gradient(100deg,rgba(18,168,94,.05) 30%,rgba(18,168,94,.16) 50%,rgba(18,168,94,.05) 70%) 0 0/280% 100%;
  animation:wsforgeshim 1.5s linear infinite}
@keyframes wsforgeshim{to{background-position:-280% 0}}
.ws-forge-nm{display:block;margin-top:5px;font-size:10.5px;font-weight:700;color:var(--ink2,#4A554E)}
.ws-forge-bad{border-color:#D9A2A2;background:#FDF4F4}
.ws-forge-bad b{display:block;font-size:13.5px;color:#8C2F2F}
.ws-forge-bad span{display:block;font-size:12px;color:var(--ink2,#4A554E);margin-top:3px}
@media (prefers-reduced-motion:reduce){
  .ws-forge-spin,.ws-forge-card,.ws-forge-img{animation:none}
  .ws-forge-card{opacity:.7}
}
.ws-face{position:relative}
.ws-face-pick{display:block;width:100%;border:0;background:none;padding:0;cursor:pointer;font:inherit;color:inherit;text-align:center}
.ws-samp{position:absolute;top:46px;right:0;width:24px;height:24px;border-radius:50%;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);cursor:pointer;font-size:11px;line-height:1;display:grid;place-items:center;box-shadow:0 1px 4px rgba(20,32,26,.14);z-index:2;padding:0}
.ws-samp.on{border-color:#12A85E;color:#12A85E}
.ws-samp.prem{border-color:#E7C879;background:#FFFBEF}
.ws-face.bf .ws-face-img{border-color:#B08526;box-shadow:0 0 0 2px rgba(176,133,38,.35)}
.ws-face.bf>span:last-child{color:#7E5E13;font-weight:700}
.ws-vscrim{position:fixed;inset:0;z-index:10600;background:rgba(12,18,14,.6);backdrop-filter:blur(3px);display:grid;place-items:center;padding:20px}
.ws-vbox{position:relative;width:min(420px,92vw)}
.ws-video{width:100%;border-radius:16px;display:block;background:#000;box-shadow:0 18px 60px rgba(0,0,0,.4)}
.ws-vx{position:absolute;top:-10px;right:-10px;width:30px;height:30px;border-radius:50%;border:0;background:#FDFCF7;color:#14201A;font-size:14px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.ws-setbf{display:inline-block;margin:2px 0 6px;padding:8px 14px;border-radius:999px;border:1px solid #E7C879;background:#FFFBEF;color:#7E5E13;font-weight:700;font-size:12.5px;cursor:pointer}
.ws-seg{display:flex;gap:8px;flex-wrap:wrap}
.ws-seg button{padding:9px 14px;border-radius:11px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font-weight:700;font-size:12.5px;cursor:pointer}
.ws-seg button.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E;color:var(--ink,#14201A);background:#F0FAF4}
.ws-wq{font-weight:500;font-size:11px;color:var(--ink2,#4A554E)}
.ws-svchint{font-size:12.5px;color:var(--ink2,#4A554E);background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF);border-radius:12px;padding:10px 13px;margin:8px 0 0}
.ws-autobox{font-size:13px;color:var(--ink,#14201A);background:var(--paper,#F4F1E6);border:1px dashed #B08526;border-radius:12px;padding:11px 14px;margin:2px 0 8px}
.ws-3w{display:flex;flex-direction:column;gap:10px;margin-top:2px}
.ws-w{display:block;font-size:12px;font-weight:700;color:var(--ink,#14201A);margin-bottom:5px}
.ws-ta{min-height:74px;resize:vertical;font:inherit;width:100%}
/* Format category chips — turn a 40-tile wall into a short, browsable menu.
   Wrap on desktop (all chips fit); scroll sideways on a phone so they never
   stack three rows deep above the tiles. */
.ws-fmtcats{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.ws-fmtcat{padding:8px 14px;border-radius:999px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font-weight:700;font-size:12.5px;line-height:1;white-space:nowrap;cursor:pointer}
.ws-fmtcat:hover{border-color:#9CCBB1}
.ws-fmtcat.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E;background:#F0FAF4;color:var(--ink,#14201A)}
.ws-fmthint{margin:-4px 0 10px;font-size:12.5px;color:var(--ink2,#4A554E)}
.ws-fmtsel{display:flex;align-items:center;gap:8px;margin:0 0 11px;font-size:12.5px;color:var(--ink2,#4A554E)}
.ws-fmtsel b{color:#0C7A46;font-size:12.5px}
.ws-fmtsel button{width:20px;height:20px;border-radius:50%;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font-size:10px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}
.ws-fmtsel button:hover{border-color:#12A85E;color:#12A85E}
@media (max-width:620px){
  .ws-fmtcats{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;padding-bottom:4px;scrollbar-width:none}
  .ws-fmtcats::-webkit-scrollbar{display:none}
}
.ws-chips{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 4px}
.ws-chip{padding:8px 13px;border-radius:999px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink,#14201A);font-weight:600;font-size:12.5px;cursor:pointer}
.ws-chip.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E;background:#F0FAF4}
.ws-lastchip{display:block;margin:0 0 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.ws-import{display:flex;gap:8px;margin-bottom:8px}
/* Burst — make several at once rather than tapping generate over and over. */
.ws-burst{margin-top:14px;padding:11px 13px;border-radius:13px;background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF)}
.ws-burst-lbl{display:block;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2,#4A554E);margin-bottom:7px}
.ws-burst-steps{display:flex;gap:10px;flex-wrap:wrap}
/* 44px min target — these pick how many PAID renders fire, so a mis-tap on a
   phone costs real tokens; they were 31px tall and 7px apart. */
.ws-burst-steps button{min-height:44px;min-width:56px;padding:11px 18px;border-radius:999px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.ws-burst-steps button.sel{border-color:#12A85E;box-shadow:0 0 0 1px #12A85E;background:#F0FAF4;color:var(--ink,#14201A)}
.ws-burst-note{margin:8px 0 0;font-size:12px;color:var(--ink2,#4A554E)}
/* Import tab: the setup surface — pull the catalogue in, forge a presenter. */
.ws-import-tab{padding:2px 0 6px}
.ws-import-tab .ws-import{flex-wrap:wrap}
.ws-import-tab .ws-import .wb-in{flex:1 1 220px;min-width:0}
.ws-avatarforge input[type=file]{padding:9px 10px;font-size:13px}
.ws-import input{flex:1;min-width:0}
.ws-impbtn{padding:9px 18px;font-size:13px;flex:0 0 auto}
.ws-addurl{border:0;background:none;color:#0C7A46;font-weight:700;font-size:12px;cursor:pointer;padding:0;margin-left:auto}
.ws-tok{display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px;padding:12px 16px;border-radius:14px;background:var(--paper,#F4F1E6);border:1px solid var(--line,#E4DFCF)}
.ws-tok .tt{font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E)}
.ws-tok .tb{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;color:var(--ink,#14201A)}
.ws-tok .tb i{font-style:normal;font-size:11.5px;font-weight:600;color:var(--ink2,#4A554E);margin-left:5px}
.ws-wallet{margin-top:8px;font-size:12.5px;font-weight:600;color:#7E5E13}

/* ===================================================================
   CASUAL (Creator) — premium, DeepAI-clean treatment. Scoped to
   .ws-casual so the Marketing Studio is untouched. All features stay;
   this only restyles. =================================================== */
.ws-casual .wb-h1{font-family:Poppins,sans-serif;font-weight:800;font-size:34px;line-height:1.08;letter-spacing:-.025em;text-align:center;margin:8px 0 10px}
.ws-casual .wb-sub{text-align:center;max-width:520px;margin:0 auto 20px;font-size:14.5px;color:var(--ink2,#4A554E)}
.ws-casual .ws-tabs{justify-content:center;gap:8px;margin-bottom:18px}
.ws-casual .ws-tab{border-radius:999px;border:1px solid var(--line,#E1DECD);background:#fff;box-shadow:0 1px 2px rgba(20,32,26,.05);font-family:Poppins,sans-serif;font-weight:700;font-size:13.5px;color:var(--ink2,#4A554E);padding:9px 17px;transition:transform .12s,box-shadow .12s,color .12s}
.ws-casual .ws-tab:hover{transform:translateY(-1px);box-shadow:0 10px 22px -12px rgba(20,32,26,.3);color:var(--ink,#14201A)}
.ws-casual .ws-tab.on{background:linear-gradient(135deg,#12A85E,#0C7A46);color:#fff;border-color:transparent;box-shadow:0 4px 14px rgba(12,122,70,.3)}
.ws-casual .ws-card{border-radius:22px;padding:26px 26px 24px;box-shadow:0 2px 8px rgba(20,32,26,.06),0 26px 60px -24px rgba(20,32,26,.2),inset 0 0 0 1px rgba(231,200,121,.26)}
/* De-wizard: drop the numbered badges, let the titles lead (DeepAI-clean). The
   steps and everything they do stay; only the number chip is hidden. */
.ws-casual .ws-stepn{display:none}
.ws-casual .ws-stephead{align-items:baseline;gap:8px;margin-top:6px}
.ws-casual .ws-stephead b{font-family:Poppins,sans-serif;font-weight:700;font-size:16px;letter-spacing:-.01em;color:var(--ink,#14201A)}
.ws-casual .ws-lbl{font-family:Poppins,sans-serif}
/* Selection pills get depth + lift; active in the brand green. */
.ws-casual .ws-fmtcat,.ws-casual .ws-chip{box-shadow:0 1px 2px rgba(20,32,26,.05);font-family:Poppins,sans-serif;transition:transform .12s,box-shadow .12s,border-color .12s,background .12s}
.ws-casual .ws-fmtcat:hover,.ws-casual .ws-chip:hover{transform:translateY(-1px);box-shadow:0 9px 18px -11px rgba(20,32,26,.3)}
.ws-casual .ws-fmtcat.sel,.ws-casual .ws-chip.sel{border-color:#0C7A46;background:#EAF6EF;box-shadow:0 0 0 1px #0C7A46;color:var(--ink,#14201A)}
/* The describe/prompt field → a premium ask-field. */
.ws-casual .wb-in{border-radius:14px;border:1px solid var(--line,#E1DECD);padding:13px 16px;font-size:15px;box-shadow:inset 0 1px 2px rgba(20,32,26,.03);transition:border-color .15s,box-shadow .15s}
.ws-casual .wb-in:focus{border-color:#9CCBB1;box-shadow:0 0 0 4px rgba(12,122,70,.14);outline:none}
.ws-casual .ws-tok{border-radius:14px}
/* Primary CTA → the home's "Make it" gradient pill (ghosts stay ghosts). */
.ws-casual .wb-btn:not(.ghost){border-radius:15px;font-family:Poppins,sans-serif;font-weight:800;font-size:15px;padding:14px 22px;background:linear-gradient(135deg,#12A85E,#0C7A46);box-shadow:0 4px 14px rgba(12,122,70,.3);transition:transform .1s,box-shadow .1s,filter .1s}
.ws-casual .wb-btn:not(.ghost):hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(12,122,70,.36);filter:brightness(1.03)}
@media(max-width:620px){.ws-casual .wb-h1{font-size:27px}.ws-casual .ws-card{padding:20px 17px}}
`;
