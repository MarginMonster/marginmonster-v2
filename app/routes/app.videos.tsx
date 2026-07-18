import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useFetcher, useRevalidator, useActionData } from "@remix-run/react";
import { useState, useEffect } from "react";
import fs from "node:fs";
import path from "node:path";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  TextField,
  Banner,
  Box,
  Divider,
  EmptyState,
  Select,
  Checkbox,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";
import { spendTokens, tokensRemaining } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { AVATARS, AVATAR_BY_ID, DIRECTION_CHIPS, OUTFITS, CAST_PREVIEW_COUNT, avatarImg } from "../lib/avatars";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  if (!shop) return json({ videos: [], plan: null, hasVideoPlan: false, products: [], castAvail: {} as Record<string, string>, renderJobs: [] as never[], linkedSocials: [] as string[], posterEnabled: false, brandFace: null, tokens: 0, videoTokenCost: TOKEN_COST.video });

  const videos = await db.asset.findMany({
    where: { shopId: shop.id, type: "VIDEO_AD" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Catalog picker — same pattern as the SEO Forge, so no typing needed.
  let products: { id: string; title: string; image: string | null; description: string }[] = [];
  try {
    const res = await admin.graphql(
      `{ products(first: 24, sortKey: UPDATED_AT, reverse: true) {
        edges { node { id title featuredImage { url } description(truncateAt: 220) } }
      } }`
    );
    const j = (await res.json()) as {
      data?: { products?: { edges?: { node: { id: string; title: string; featuredImage?: { url?: string }; description?: string } }[] } };
    };
    products = (j.data?.products?.edges || []).map((e) => ({
      id: e.node.id,
      title: e.node.title,
      image: e.node.featuredImage?.url || null,
      description: e.node.description || "",
    }));
  } catch {
    /* non-fatal — manual entry still works */
  }

  // Which cast portraits actually exist on disk — lets the roster grow to 100
  // the moment the wardrobe images deploy, without ever showing broken cards.
  const castAvail: Record<string, "variants" | "legacy"> = {};
  try {
    const files = new Set(fs.readdirSync(path.join(process.cwd(), "public", "avatars")));
    for (const a of AVATARS) {
      if (files.has(`${a.id}_0.jpg`)) castAvail[a.id] = "variants";
      else if (files.has(`${a.id}.jpg`)) castAvail[a.id] = "legacy";
    }
  } catch { /* no avatars dir — roster renders empty, product-only still works */ }

  // In-flight + failed renders so ROLL CAMERA always has visible consequences.
  // Every card carries its provenance: quest-drip renders name their quest,
  // manual renders name the person who pressed the button.
  const rawJobs = await db.job.findMany({
    where: { shopId: shop.id, type: "GENERATE_VIDEO_AD", status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const parsed = rawJobs.map((j) => {
    let payload: { productTitle?: string; avatarId?: string; avatarVariant?: number | string; productImageUrl?: string; questlineId?: string; initiator?: string } = {};
    try { payload = JSON.parse(j.payload); } catch { /* keep defaults */ }
    return { j, payload };
  });
  const questIds = [...new Set(parsed.map((p) => p.payload.questlineId).filter(Boolean))] as string[];
  const questNames = new Map<string, string>();
  if (questIds.length) {
    for (const q of await db.questline.findMany({ where: { id: { in: questIds } }, select: { id: true, name: true } })) {
      questNames.set(q.id, q.name);
    }
  }
  const nowMs = Date.now();
  const renderJobs = parsed.map(({ j, payload }) => {
    // scheduled = a drip job whose forge time is still in the future
    const scheduledFor = j.runAt && j.runAt.getTime() > nowMs ? j.runAt.toISOString() : null;
    return {
      id: j.id,
      status: j.status,
      title: payload.productTitle || "Video",
      avatarId: payload.avatarId || null,
      avatarVariant: payload.avatarVariant != null ? Number(payload.avatarVariant) : 0,
      productImage: payload.productImageUrl || null,
      origin: payload.questlineId
        ? `⚔ QUEST · ${(questNames.get(payload.questlineId) || "CAMPAIGN").toUpperCase()}`
        : `🎬 BY ${(payload.initiator || "MERCHANT").toUpperCase()}`,
      scheduledFor,
      lastError: j.lastError,
      attempts: j.attempts,
      createdAt: j.createdAt,
    };
  });

  const plan = shop.activePlan;
  const hasVideoPlan = !!plan && plan.videoQuota > 0;

  // linked social platforms (for the per-take "Post to socials" test buttons)
  const { linkedFromCache, socialProviderEnabled } = await import("../lib/social-provider.server");
  const linkedSocials = linkedFromCache(shop.socialsJson);

  return json({
    videos,
    plan: plan
      ? { videoQuota: plan.videoQuota, videoUsed: plan.videoUsed, videoCredits: plan.videoCredits }
      : null,
    hasVideoPlan,
    products,
    castAvail,
    renderJobs,
    linkedSocials,
    posterEnabled: socialProviderEnabled(),
    tokens: plan ? tokensRemaining(plan) : 0,
    videoTokenCost: TOKEN_COST.video,
    brandFace: shop.brandAvatarId
      ? { id: shop.brandAvatarId, variant: shop.brandAvatarVariant ?? 0 }
      : null,
  });
};

/** Friendly local date+time for a scheduled forge, e.g. "Thu, Jul 17 · 6PM".
 *  Client-only (rendered inside the live-clock section), so locale is fine. */
function fmtDayTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "soon";
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 === 0 ? 12 : h % 12;
  return `${day} · ${m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, "0")}${ap}`}`;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, brandProfile: true },
  });
  if (!shop) return json({ error: "Shop not found" });

  // ---- Pull product info from any URL (Shopify product JSON → JSON-LD → OG tags) ----
  if (intent === "pullUrl") {
    const raw = ((form.get("url") as string) || "").trim();
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
      const host = u.hostname.toLowerCase();
      if (
        host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      ) {
        return json({ pullError: "That URL isn't allowed." });
      }
      const ua = { "user-agent": "Mozilla/5.0 (compatible; AdArcade product import)", accept: "text/html,application/json" };

      // Shopify storefront shortcut: /products/{handle}.js returns clean JSON
      if (/\/products\/[^/?#]+\/?$/.test(u.pathname)) {
        try {
          const jres = await fetch(`${u.origin}${u.pathname.replace(/\/$/, "")}.js`, { signal: AbortSignal.timeout(8000), headers: ua });
          if (jres.ok) {
            const pj = (await jres.json()) as { title?: string; description?: string; featured_image?: string };
            if (pj?.title) {
              const img = pj.featured_image
                ? (pj.featured_image.startsWith("//") ? `https:${pj.featured_image}` : pj.featured_image)
                : null;
              return json({
                pulled: { title: pj.title.slice(0, 120), image: img, description: stripHtml(pj.description || "").slice(0, 300) },
              });
            }
          }
        } catch { /* fall through to HTML scrape */ }
      }

      const res = await fetch(u.href, { signal: AbortSignal.timeout(9000), headers: ua, redirect: "follow" });
      if (!res.ok) return json({ pullError: `Couldn't reach that page (${res.status}).` });
      const html = (await res.text()).slice(0, 600_000);

      let title: string | undefined;
      let image: string | undefined;
      let description: string | undefined;

      // JSON-LD Product schema
      const ldBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const block of ldBlocks) {
        try {
          const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
          const data = JSON.parse(body);
          const nodes: any[] = Array.isArray(data) ? data : data?.["@graph"] ? data["@graph"] : [data];
          const prod = nodes.find((n) => {
            const t = n?.["@type"];
            return t === "Product" || (Array.isArray(t) && t.includes("Product"));
          });
          if (prod) {
            title = prod.name;
            description = stripHtml(String(prod.description || "")).slice(0, 300);
            const im = Array.isArray(prod.image) ? prod.image[0] : prod.image;
            image = typeof im === "object" ? im?.url : im;
            break;
          }
        } catch { /* try the next block */ }
      }

      // OpenGraph / <title> fallback
      const og = (p: string) =>
        html.match(new RegExp(`<meta[^>]+(?:property|name)=["']og:${p}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:${p}["']`, "i"))?.[1];
      title = title || og("title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
      image = image || og("image");
      description = description || stripHtml(og("description") || "").slice(0, 300);

      if (!title) return json({ pullError: "Couldn't find product info on that page." });
      return json({
        pulled: {
          title: decodeEntities(title.trim()).slice(0, 120),
          image: image || null,
          description: decodeEntities(description || ""),
        },
      });
    } catch {
      return json({ pullError: "Couldn't pull from that URL — check the link and try again." });
    }
  }

  if (intent === "generate" || intent === "regenerate") {
    if (!shop.brandProfile) {
      return json({ error: "Analyze your store first (on the dashboard) so videos match your brand." });
    }
    if (!shop.activePlan || !shop.activePlan.active || shop.activePlan.videoQuota <= 0) {
      return json({ error: "Video generation needs the Pro or Scale plan. Upgrade on the Plans page." });
    }

    const productTitle = (form.get("productTitle") as string)?.trim();
    const avatarId = ((form.get("avatarId") as string) || "").trim() || undefined;
    const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
    // Cast selection drives the style: a presenter = avatar video, none = showcase.
    const style = avatarId ? "AI_AVATAR" : "PRODUCT_HIGHLIGHT";
    const customPrompt = (form.get("customPrompt") as string)?.trim() || undefined;
    const productImageUrl = ((form.get("productImageUrl") as string) || "").trim() || undefined;
    const productDescription = ((form.get("productDescription") as string) || "").trim() || undefined;
    const captions = form.get("captions") !== "off";
    const composedFrameUrl = ((form.get("composedFrameUrl") as string) || "").trim() || undefined;
    if (!productTitle) return json({ error: "Give your video a product or subject." });

    // Plan takes first, tokens after — once the monthly takes are used, a take
    // costs TOKEN_COST.video from the wallet (prePaid → accounting skips the
    // quota burn since the coins already paid for it).
    let prePaid = false;
    const planTakesLeft = shop.activePlan.videoQuota - shop.activePlan.videoUsed + shop.activePlan.videoCredits;
    if (planTakesLeft <= 0) {
      try {
        await spendTokens(shop.id, TOKEN_COST.video);
        prePaid = true;
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "Not enough tokens for this take." });
      }
    }

    // Provenance: name the human who pressed ROLL CAMERA (quest drips carry
    // their questlineId instead), so the Studio can label every card.
    const sessUser = (session as { onlineAccessInfo?: { associated_user?: { first_name?: string; last_name?: string } } }).onlineAccessInfo?.associated_user;
    const initiator = [sessUser?.first_name, sessUser?.last_name].filter(Boolean).join(" ").trim() || undefined;

    await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
      productTitle,
      style,
      customPrompt,
      avatarId,
      avatarVariant,
      productImageUrl,
      productDescription,
      captions,
      initiator,
      composedFrameUrl, // approved in-hand frame — the render animates THIS
      prePaid,
    });
    return json({ ok: true, queued: true });
  }

  // ---- In-hand demo: compose "presenter holding the product" frames for the
  // merchant to approve BEFORE the video spend. Two-phase: the first call
  // submits and returns queue handles fast; the client auto-repolls the SAME
  // job until the shots land (no re-tapping, no double spend). ----
  if (intent === "composeFrame") {
    try {
      const { submitCompose, pollCompose, isFalQueueUrl, falImageEnabled } = await import("../lib/fal-image.server");
      if (!falImageEnabled()) return json({ composeError: "The image engine isn't switched on yet (FAL_KEY)." });

      // phase 2: keep checking an in-flight job
      const statusUrl = ((form.get("composeStatusUrl") as string) || "").trim();
      const responseUrl = ((form.get("composeResponseUrl") as string) || "").trim();
      if (statusUrl && responseUrl) {
        if (!isFalQueueUrl(statusUrl) || !isFalQueueUrl(responseUrl)) return json({ composeError: "Bad compose handle." });
        const p = await pollCompose(statusUrl, responseUrl);
        return p.done ? json({ frames: p.urls }) : json({ composePending: { statusUrl, responseUrl } });
      }

      // phase 1: kick a new job off
      const avatarId = ((form.get("avatarId") as string) || "").trim();
      const avatarVariant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
      const productImageUrl = ((form.get("productImageUrl") as string) || "").trim();
      const productTitle = ((form.get("productTitle") as string) || "").trim();
      if (!avatarId || !productImageUrl) return json({ composeError: "Cast a presenter and pick a product with a photo first." });
      const { resolvePortraitFile } = await import("../lib/ugc-ad-pipeline.server");
      const path = await import("node:path");
      const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
      const portraitUrl = `${base}/avatars/${path.basename(resolvePortraitFile(avatarId, avatarVariant))}`;
      const q = await submitCompose(portraitUrl, productImageUrl, productTitle, 2);
      // give fast renders one early chance (~5s), then hand off to auto-repoll
      await new Promise((r) => setTimeout(r, 5000));
      const first = await pollCompose(q.statusUrl, q.responseUrl);
      return first.done ? json({ frames: first.urls }) : json({ composePending: q });
    } catch (e) {
      return json({ composeError: `Couldn't compose the shot (${(e instanceof Error ? e.message : "error").slice(0, 80)}). Tap ✨ to try again.` });
    }
  }

  // ---- Take card ops: delete / attach to listing / queue for social ----
  if (intent === "deleteTake") {
    const id = (form.get("assetId") as string) || "";
    try {
      const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: "VIDEO_AD" } });
      if (asset) {
        try {
          const body = JSON.parse(asset.bodyJson || "{}");
          if (typeof body.videoUrl === "string" && body.videoUrl.startsWith("/renders/")) {
            const f = path.join(process.cwd(), "data", "renders", path.basename(body.videoUrl));
            if (fs.existsSync(f)) fs.unlinkSync(f);
          }
        } catch { /* file cleanup is best-effort */ }
        // campaigns reference assets with a restrict FK — clean up draft/demo
        // campaign rows first, but never touch one that actually launched
        const live = await db.campaign.count({ where: { assetId: asset.id, externalId: { not: null } } });
        if (live > 0) {
          return json({ opError: "This take is part of a launched campaign — end the campaign before deleting it." });
        }
        await db.campaign.deleteMany({ where: { assetId: asset.id } });
        await db.asset.delete({ where: { id: asset.id } });
      }
      return json({ ok: true });
    } catch (e) {
      // absolutely never take the page down over a delete
      console.error("[videos] deleteTake failed:", e);
      return json({ opError: "Couldn't delete that take — it may be linked to other records. Try again after ending its campaigns." });
    }
  }

  // ---- Retry a failed render: reset the job, keep its stage checkpoints ----
  // (a job that failed at assembly re-runs WITHOUT re-buying script/voice/video)
  if (intent === "retryJob") {
    const jobId = (form.get("jobId") as string) || "";
    await db.job.updateMany({
      where: { id: jobId, shopId: shop.id, type: "GENERATE_VIDEO_AD", status: "FAILED" },
      data: { status: "PENDING", attempts: 0, lastError: null },
    });
    return json({ ok: true });
  }

  if (intent === "queueSocial") {
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: "VIDEO_AD" } });
    if (asset) {
      const meta = JSON.parse(asset.metaJson || "{}");
      meta.socialQueued = !meta.socialQueued; // toggle
      meta.socialQueuedAt = meta.socialQueued ? new Date().toISOString() : null;
      await db.asset.update({ where: { id: asset.id }, data: { metaJson: JSON.stringify(meta) } });
    }
    return json({ ok: true });
  }

  if (intent === "postToSocials") {
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: "VIDEO_AD" } });
    if (!asset) return json({ opError: "Take not found." });
    let videoUrl: string | undefined;
    let title = "New from our shop";
    try {
      const body = JSON.parse(asset.bodyJson || "{}");
      videoUrl = body.videoUrl;
      const meta = JSON.parse(asset.metaJson || "{}");
      title = meta.productTitle || asset.title || title;
    } catch { /* fall through */ }
    if (!videoUrl) return json({ opError: "This take has no rendered video yet." });

    const { ensureProfile, refreshLinkedPlatforms, publishPost, socialProviderEnabled } = await import("../lib/social-provider.server");
    if (!socialProviderEnabled()) return json({ opError: "Auto-posting isn't switched on yet (no provider key)." });
    const profileKey = await ensureProfile(shop.id);
    if (!profileKey) return json({ opError: "Couldn't reach the posting service." });
    const linked = await refreshLinkedPlatforms(shop.id);
    const platforms = linked.filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
    if (platforms.length === 0) return json({ opError: "Connect a social account first (Ad Accounts tab)." });

    const res = await publishPost(profileKey, { title, mediaUrl: videoUrl, isVideo: true, platforms });
    return res.ok
      ? json({ posted: platforms.join(", ") })
      : json({ opError: `Posting failed (${res.error || "unknown"}). Check your connected accounts.` });
  }

  if (intent === "attachProduct") {
    const id = (form.get("assetId") as string) || "";
    const productId = (form.get("productId") as string) || "";
    const productTitle = (form.get("productTitle") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: "VIDEO_AD" } });
    if (!asset || !productId) return json({ opError: "Pick a product to attach this take to." });
    try {
      const body = JSON.parse(asset.bodyJson || "{}");
      if (!body.videoUrl) return json({ opError: "This take has no rendered video yet." });

      // get the video bytes (local render, or re-download a remote take)
      let buf: Buffer;
      if (String(body.videoUrl).startsWith("/renders/")) {
        const f = path.join(process.cwd(), "data", "renders", path.basename(body.videoUrl));
        if (!fs.existsSync(f)) return json({ opError: "The video file has expired from storage — roll a fresh take and attach that." });
        buf = fs.readFileSync(f);
      } else {
        const res = await fetch(body.videoUrl);
        if (!res.ok) return json({ opError: "The video file has expired from the provider — roll a fresh take and attach that." });
        buf = Buffer.from(await res.arrayBuffer());
      }

      // 1) staged upload target
      const staged = await admin.graphql(
        `mutation Staged($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { message }
          }
        }`,
        { variables: { input: [{ resource: "VIDEO", filename: "adarcade-take.mp4", mimeType: "video/mp4", fileSize: String(buf.length), httpMethod: "POST" }] } }
      );
      const sj = (await staged.json()) as {
        data?: { stagedUploadsCreate?: { stagedTargets?: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors?: { message: string }[] } };
      };
      const errs1 = sj.data?.stagedUploadsCreate?.userErrors || [];
      const target = sj.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (errs1.length || !target) return json({ opError: errs1[0]?.message || "Shopify refused the upload slot." });

      // 2) upload the bytes
      const fd = new FormData();
      for (const p of target.parameters) fd.append(p.name, p.value);
      fd.append("file", new Blob([buf], { type: "video/mp4" }), "adarcade-take.mp4");
      const up = await fetch(target.url, { method: "POST", body: fd });
      if (!up.ok && up.status !== 201) return json({ opError: `Upload failed (${up.status}).` });

      // 3) attach as product media
      const media = await admin.graphql(
        `mutation Attach($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media { alt }
            mediaUserErrors { message }
          }
        }`,
        { variables: { productId, media: [{ mediaContentType: "VIDEO", originalSource: target.resourceUrl, alt: asset.title || "AdArcade video" }] } }
      );
      const mj = (await media.json()) as { data?: { productCreateMedia?: { mediaUserErrors?: { message: string }[] } } };
      const errs2 = mj.data?.productCreateMedia?.mediaUserErrors || [];
      if (errs2.length) return json({ opError: errs2[0].message });

      const meta = JSON.parse(asset.metaJson || "{}");
      meta.attachedProductId = productId;
      meta.attachedProductTitle = productTitle;
      meta.attachedAt = new Date().toISOString();
      await db.asset.update({ where: { id: asset.id }, data: { metaJson: JSON.stringify(meta) } });
      return json({ ok: true, attached: productTitle });
    } catch (e) {
      return json({ opError: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- Dismiss a failed render from the queue view ----
  if (intent === "dismissJob") {
    const jobId = (form.get("jobId") as string) || "";
    // scoped delete — only this shop's failed video jobs can be dismissed
    await db.job.deleteMany({
      where: { id: jobId, shopId: shop.id, type: "GENERATE_VIDEO_AD", status: "FAILED" },
    });
    return json({ ok: true });
  }

  // ---- Brand Face: crown (or uncrown) the signature presenter ----
  if (intent === "setBrandFace") {
    const id = ((form.get("avatarId") as string) || "").trim() || null;
    const variant = Math.max(0, Math.min(3, parseInt((form.get("avatarVariant") as string) || "0", 10) || 0));
    await db.shop.update({
      where: { id: shop.id },
      data: { brandAvatarId: id, brandAvatarVariant: id ? variant : 0 },
    });
    return json({ ok: true, brandFaceSet: !!id });
  }

  const assetId = form.get("assetId") as string;
  if (intent === "approve") {
    await db.asset.update({ where: { id: assetId }, data: { status: "APPROVED" } });
  } else if (intent === "reject") {
    await db.asset.update({ where: { id: assetId }, data: { status: "REJECTED" } });
  }
  return json({ ok: true });
};

type Pick = { id: string | null; title: string; image: string | null; description: string };

export default function Videos() {
  const { videos, plan, hasVideoPlan, products, brandFace, castAvail, renderJobs, linkedSocials, posterEnabled, tokens, videoTokenCost } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const puller = useFetcher<{ pulled?: Pick; pullError?: string }>();
  const crowner = useFetcher();
  const taker = useFetcher<{ ok?: boolean; attached?: string; posted?: string; opError?: string }>();
  const busy = nav.state !== "idle";
  const pulling = puller.state !== "idle";
  const queued = !!(actionData && "queued" in actionData && actionData.queued);
  const actionError = actionData && "error" in actionData ? (actionData.error as string) : null;

  // Brand Face pre-casts the merchant's signature presenter + outfit
  const [productTitle, setProductTitle] = useState("");
  const [avatarId, setAvatarId] = useState<string>(brandFace?.id || ""); // "" = product only
  const [avatarVariant, setAvatarVariant] = useState(brandFace?.variant ?? 0); // wardrobe slot 0-3
  const [captionsOn, setCaptionsOn] = useState(true);
  const [visibleCount, setVisibleCount] = useState(CAST_PREVIEW_COUNT);

  // only presenters whose portraits exist on this deploy; brand face pinned
  // right after PRODUCT ONLY so it's always on screen
  const available = AVATARS.filter((a) => castAvail[a.id]);
  const orderedCast = brandFace?.id && AVATAR_BY_ID[brandFace.id] && castAvail[brandFace.id]
    ? [AVATAR_BY_ID[brandFace.id], ...available.filter((a) => a.id !== brandFace.id)]
    : available;
  const castImg = (id: string, v: number) =>
    castAvail[id] === "variants" ? avatarImg(id, v) : `/avatars/${id}.jpg`;

  // Take Library filters — reference cuts by presenter/product/status instead
  // of scrolling the full reel
  const [libTab, setLibTab] = useState<"READY" | "PENDING">("READY");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [presenterFilter, setPresenterFilter] = useState<string>("ALL");
  const [productFilter, setProductFilter] = useState<string>("ALL");

  const videoMeta = (v: { metaJson: string }) => {
    try { return JSON.parse(v.metaJson) as { avatarId?: string | null; productTitle?: string }; } catch { return {}; }
  };
  const presenterOptions = [
    { label: "All presenters", value: "ALL" },
    { label: "Product only", value: "NONE" },
    ...Array.from(new Set(videos.map((v) => videoMeta(v).avatarId).filter(Boolean) as string[]))
      .map((id) => ({ label: AVATAR_BY_ID[id]?.name || id, value: id })),
  ];
  const productOptions = [
    { label: "All products", value: "ALL" },
    ...Array.from(new Set(videos.map((v) => videoMeta(v).productTitle).filter(Boolean) as string[]))
      .map((t) => ({ label: t.length > 40 ? t.slice(0, 40) + "…" : t, value: t })),
  ];
  const filteredVideos = videos.filter((v) => {
    const meta = videoMeta(v);
    if (statusFilter !== "ALL" && v.status !== statusFilter) return false;
    if (presenterFilter === "NONE" && meta.avatarId) return false;
    if (presenterFilter !== "ALL" && presenterFilter !== "NONE" && meta.avatarId !== presenterFilter) return false;
    if (productFilter !== "ALL" && meta.productTitle !== productFilter) return false;
    return true;
  });

  // videos render in the background — poll while any job is in flight so the
  // finished cut pops in without a manual refresh
  const activeJobs = renderJobs.filter((j) => j.status === "PENDING" || j.status === "IN_PROGRESS");
  const failedJobs = renderJobs.filter((j) => j.status === "FAILED");
  const rendering = activeJobs.length > 0;
  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(() => revalidator.revalidate(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendering]);
  // client-only clock for "N min in" (avoids a server/client hydration mismatch)
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  // take-card ops: attach flow state
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [attachPick, setAttachPick] = useState<string>("");
  useEffect(() => {
    if (taker.state === "idle" && taker.data && "ok" in taker.data && taker.data.ok) setAttachingId(null);
  }, [taker.state, taker.data]);
  const opError = taker.data && "opError" in taker.data ? taker.data.opError : null;
  const attachOptions = [
    { label: "Pick a product…", value: "" },
    ...products.map((p) => ({ label: p.title.length > 42 ? p.title.slice(0, 42) + "…" : p.title, value: p.id })),
  ];
  const [customPrompt, setCustomPrompt] = useState("");
  const [pick, setPick] = useState<Pick | null>(null);
  const [pullUrl, setPullUrl] = useState("");
  // In-hand demo: composed "presenter holding the product" frames + the one
  // the merchant approved (its URL rides the generate payload). Compose is
  // async on the server — composePending hands back queue handles and this
  // auto-repolls the SAME job every 4s (~90s budget) until the shots land.
  const composer = useFetcher<{ frames?: string[]; composeError?: string; composePending?: { statusUrl: string; responseUrl: string } }>();
  const [framePick, setFramePick] = useState<string>("");
  const [composeTries, setComposeTries] = useState(0);
  const composeFrames = composer.data && "frames" in composer.data ? composer.data.frames : null;
  const composePending = composer.data && "composePending" in composer.data ? composer.data.composePending : null;
  const composeError =
    composer.data && "composeError" in composer.data
      ? composer.data.composeError
      : composeTries > 22
        ? "The art station is jammed right now — tap ✨ to try a fresh compose."
        : null;
  const composing = composer.state !== "idle" || (!!composePending && composeTries <= 22);
  useEffect(() => {
    if (!composePending || composer.state !== "idle" || composeTries > 22) return;
    const t = setTimeout(() => {
      setComposeTries((n) => n + 1);
      composer.submit(
        { intent: "composeFrame", composeStatusUrl: composePending.statusUrl, composeResponseUrl: composePending.responseUrl },
        { method: "post" }
      );
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composePending, composer.state, composeTries]);
  const composeShot = () => {
    setFramePick("");
    setComposeTries(0);
    composer.submit(
      { intent: "composeFrame", avatarId, avatarVariant: String(avatarVariant), productImageUrl: pick?.image || "", productTitle: pick?.title || productTitle },
      { method: "post" }
    );
  };

  const castAvatar = (id: string) => {
    setAvatarId(id);
    setAvatarVariant(0); // new presenter starts in their default fit
    setFramePick(""); // new face → any composed frame is stale
  };

  // a URL pull landing = auto-select that product
  useEffect(() => {
    const pulled = puller.data && "pulled" in puller.data ? puller.data.pulled : null;
    if (pulled) {
      setPick({ id: null, title: pulled.title, image: pulled.image, description: pulled.description || "" });
      setProductTitle(pulled.title);
    }
  }, [puller.data]);
  const pullError = puller.data && "pullError" in puller.data ? puller.data.pullError : null;

  const choose = (p: { id: string; title: string; image: string | null; description: string }) => {
    setFramePick(""); // product changed → any composed frame is stale
    if (pick?.id === p.id) {
      setPick(null);
      return;
    }
    setPick({ id: p.id, title: p.title, image: p.image, description: p.description });
    setProductTitle(p.title);
  };

  const insertChip = (chip: string) =>
    setCustomPrompt((p) => (p.trim() ? `${p.trim()}, ${chip.toLowerCase()}` : chip));

  const generate = (intent: "generate" | "regenerate", seed?: { title: string; avatarId: string; variant: number; prompt: string }) => {
    submit(
      {
        intent,
        productTitle: seed?.title ?? productTitle,
        avatarId: seed?.avatarId ?? avatarId,
        avatarVariant: String(seed?.variant ?? avatarVariant),
        customPrompt: seed?.prompt ?? customPrompt,
        productImageUrl: seed ? "" : pick?.image || "",
        productDescription: seed ? "" : pick?.description || "",
        captions: captionsOn ? "on" : "off",
        composedFrameUrl: seed ? "" : framePick,
      },
      { method: "post" }
    );
  };

  if (!hasVideoPlan) {
    return (
      <Page title="Video Studio" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState
          heading="Video generation is a Pro feature"
          image=""
          action={{ content: "See plans", url: "/app/plans" }}
        >
          <p>Upgrade to Pro or Scale to generate AI product videos — a full presenter cast or highlight reels — from your catalog.</p>
        </EmptyState>
      </Page>
    );
  }

  const remaining = plan ? plan.videoQuota - plan.videoUsed + plan.videoCredits : 0;
  const selectedAvatar = avatarId ? AVATAR_BY_ID[avatarId] : null;

  return (
    <Page
      title="Video Studio"
      backAction={{ content: "Home", url: "/app" }}
      subtitle="Pick your presenter, direct the shot, and roll camera — ready-to-post videos for TikTok, Reels & Shorts."
    >
      <Layout>
        <Layout.Section>
          <div className="pp-hero">
            <span className="pp-eyebrow">Video Studio</span>
            <h1>Lights. Camera. <em>Sales.</em></h1>
            <p className="pp-sub">
              Cast a presenter (or go product-only), give your direction, and a
              scroll-stopping vertical video comes back — your presenter holding
              your product, cut for TikTok, Reels, and Shorts.
            </p>
            <div className="pp-stats">
              <div className="pp-stat">
                <div className="v">{remaining}</div>
                <div className="l">Takes left</div>
              </div>
              <div className="pp-stat">
                <div className="v"><span className="g">{selectedAvatar ? selectedAvatar.name : "Product only"}</span></div>
                <div className="l">{selectedAvatar ? `Now casting · ${OUTFITS[avatarVariant].label}` : "No presenter cast"}</div>
              </div>
            </div>
          </div>
        </Layout.Section>

        {/* ROLL CAMERA feedback — a click ALWAYS has a visible consequence */}
        {(queued || actionError) && (
          <Layout.Section>
            {queued ? (
              <Banner tone="success" title="🎬 Rolling!">
                <p>Your video is rendering — usually 2–6 minutes (first takes can run longer while the AI model warms up). It'll appear in the Take Library below automatically.</p>
              </Banner>
            ) : (
              <Banner tone="critical" title="Couldn't start the shoot">
                <p>{actionError}</p>
              </Banner>
            )}
          </Layout.Section>
        )}

        {/* CAST SELECT — Zeely-style presenter gallery (100-strong, 4 fits each) */}
        <Layout.Section>
          <span className="mm-section-label">▶ SELECT YOUR PRESENTER<span className="mm-dots">· · · · ·</span></span>
          <div className="mm-cast-grid">
            <button
              type="button"
              className={`mm-cast mm-cast-none${avatarId === "" ? " on" : ""}`}
              onClick={() => setAvatarId("")}
            >
              <div className="ph">🎬</div>
              <div className="nm">PRODUCT ONLY</div>
              <div className="vb">Showcase reel</div>
            </button>
            {orderedCast.slice(0, visibleCount).map((a) => (
              <button
                key={a.id}
                type="button"
                className={`mm-cast${avatarId === a.id ? " on" : ""}`}
                onClick={() => castAvatar(a.id)}
              >
                {brandFace?.id === a.id && <span className="mm-bf-tag">★ BRAND FACE</span>}
                <img
                  src={castImg(a.id, avatarId === a.id ? avatarVariant : 0)}
                  alt={`${a.name} — ${a.vibe}`}
                  loading="lazy"
                />
                <div className="nm">{a.name}</div>
                <div className="vb">{a.vibe}</div>
              </button>
            ))}
          </div>
          {visibleCount < orderedCast.length && (
            <div className="mm-viewmore-wrap">
              <button type="button" className="mm-ghost-btn" onClick={() => setVisibleCount(orderedCast.length)}>
                ▼ VIEW MORE AVATARS ({orderedCast.length - visibleCount} more)
              </button>
            </div>
          )}

          {/* WARDROBE — 4 fits per presenter + Brand Face crown */}
          {selectedAvatar && castAvail[selectedAvatar.id] === "variants" && (
            <div className="mm-wardrobe">
              <span className="mm-section-label">▶ {selectedAvatar.name}'S WARDROBE</span>
              <div className="mm-wardrobe-row">
                {OUTFITS.map((o, i) => (
                  <button
                    key={o.label}
                    type="button"
                    className={`mm-fit${avatarVariant === i ? " on" : ""}`}
                    onClick={() => setAvatarVariant(i)}
                  >
                    <img src={avatarImg(selectedAvatar.id, i)} alt={`${selectedAvatar.name} — ${o.label}`} loading="lazy" />
                    <span className="fl">{o.label}</span>
                  </button>
                ))}
              </div>
              <div className="mm-bf-row">
                {brandFace?.id === selectedAvatar.id && brandFace?.variant === avatarVariant ? (
                  <button
                    type="button"
                    className="mm-bf-btn on"
                    onClick={() => crowner.submit({ intent: "setBrandFace", avatarId: "", avatarVariant: "0" }, { method: "post" })}
                    disabled={crowner.state !== "idle"}
                  >
                    ★ YOUR BRAND FACE — every video stays on-brand · tap to uncrown
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mm-bf-btn"
                    onClick={() => crowner.submit({ intent: "setBrandFace", avatarId: selectedAvatar.id, avatarVariant: String(avatarVariant) }, { method: "post" })}
                    disabled={crowner.state !== "idle"}
                  >
                    ☆ SET AS BRAND FACE — pre-cast {selectedAvatar.name} in this fit on every visit
                  </button>
                )}
              </div>
            </div>
          )}
        </Layout.Section>

        {/* Direction booth */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                {selectedAvatar ? `Direct ${selectedAvatar.name}'s shoot` : "Direct your showcase"}
              </Text>

              {products.length > 0 && (
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingSm" as="h3">Pick from your catalog</Text>
                    {pick?.id && <Badge tone="success">{pick.title.length > 30 ? pick.title.slice(0, 30) + "…" : pick.title}</Badge>}
                  </InlineStack>
                  <div className="mm-prodgrid">
                    {products.map((p) => {
                      const on = pick?.id === p.id;
                      return (
                        <button key={p.id} type="button" className={`mm-prodcard${on ? " on" : ""}`} onClick={() => choose(p)}>
                          {on && <span className="mm-prodcheck">✓</span>}
                          {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="mm-prodph">🛍️</div>}
                          <span className="mm-prodtitle">{p.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </BlockStack>
              )}

              <BlockStack gap="200">
                <TextField
                  label="…or pull from any product URL"
                  value={pullUrl}
                  onChange={setPullUrl}
                  autoComplete="off"
                  placeholder="https://yourstore.com/products/blue-razz-gummy-worms"
                  helpText="Paste a product page — we'll grab the title, image, and description automatically."
                  connectedRight={
                    <Button
                      onClick={() => puller.submit({ intent: "pullUrl", url: pullUrl }, { method: "post" })}
                      loading={pulling}
                      disabled={!pullUrl.trim()}
                    >
                      ⤓ Pull
                    </Button>
                  }
                />
                {pullError && (
                  <Text variant="bodySm" as="p" tone="critical">{pullError}</Text>
                )}
              </BlockStack>

              <TextField
                label="Product or subject"
                value={productTitle}
                onChange={setProductTitle}
                autoComplete="off"
                placeholder="e.g. Blue Razz Gummy Worms"
                helpText={pick ? "Auto-filled from your selection — tweak it freely." : "What's the video about?"}
                prefix={pick?.image ? <img src={pick.image} alt="" style={{ width: 22, height: 22, borderRadius: 5, objectFit: "cover", display: "block" }} /> : undefined}
              />

              <BlockStack gap="200">
                <TextField
                  label="Your direction (optional)"
                  value={customPrompt}
                  onChange={setCustomPrompt}
                  multiline={3}
                  autoComplete="off"
                  placeholder={
                    selectedAvatar
                      ? `What should ${selectedAvatar.name} do or say? e.g. "opens the bag mid-sentence and reacts to the sour hit"`
                      : 'Describe the shots and vibe. e.g. "slow-mo close-ups, bright candy colors, upbeat energy"'
                  }
                  helpText="Leave blank and we'll direct it from your brand voice — or take the director's chair. Tap a card below to drop in a proven angle."
                />
                <div className="mm-dir-chips">
                  {DIRECTION_CHIPS.map((c) => (
                    <button key={c} type="button" className="mm-chip mm-dir-chip" onClick={() => insertChip(c)}>
                      + {c}
                    </button>
                  ))}
                </div>
              </BlockStack>

              <Checkbox
                label="Burn in on-screen captions"
                helpText="Bold word-by-word captions like top TikTok/Reels ads. Turn off for a clean, caption-free cut."
                checked={captionsOn}
                onChange={setCaptionsOn}
              />

              {/* IN-HAND DEMO — compose the presenter holding the product,
                  approve the shot, THEN roll. The highest-converting UGC format. */}
              {avatarId && pick?.image && (
                <div className="mm-inhand">
                  <InlineStack gap="300" blockAlign="center" wrap>
                    <Text variant="headingSm" as="h3">🤲 IN-HAND DEMO</Text>
                    <span className="mm-inhand-sub">
                      {AVATAR_BY_ID[avatarId]?.name || "Your presenter"} holds your product on camera — the highest-converting ad format.
                    </span>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Button size="slim" loading={composing} onClick={composeShot} disabled={composing}>
                      {composeFrames ? "🎲 New shots" : "✨ Compose the shot"}
                    </Button>
                    {composing && <span className="mm-inhand-sub">Painting the shot… ~30 sec, it'll appear right here.</span>}
                    {framePick && <Badge tone="success">Shot cast — rolls with this take</Badge>}
                    {!framePick && composeFrames && !composing && <span className="mm-inhand-sub">Tap your favorite:</span>}
                  </InlineStack>
                  {composeError && !composing && <Text variant="bodySm" as="p" tone="caution">{composeError}</Text>}
                  {composeFrames && composeFrames.length > 0 && (
                    <div className="mm-inhand-frames">
                      {composeFrames.map((f) => (
                        <button
                          key={f}
                          type="button"
                          className={`mm-inhand-frame${framePick === f ? " on" : ""}`}
                          onClick={() => setFramePick(framePick === f ? "" : f)}
                        >
                          <img src={f} alt="Presenter holding the product" />
                          {framePick === f && <span className="tick">✓ THIS ONE</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mm-forge-cta">
                <button
                  type="button"
                  className="mm-arcade-btn"
                  onClick={() => generate("generate")}
                  disabled={busy || !productTitle.trim() || (remaining <= 0 && tokens < videoTokenCost)}
                >
                  {busy ? "ROLLING…" : "▶ ROLL CAMERA"}
                </button>
                <span className={`mm-credits${remaining <= 0 && tokens < videoTokenCost ? " low" : ""}`}>
                  {remaining > 0 ? (
                    <><b>{remaining} TAKES</b> in plan · then {videoTokenCost} 🪙 each</>
                  ) : tokens >= videoTokenCost ? (
                    <><b>{videoTokenCost} 🪙</b> this take · Balance {tokens.toLocaleString()}</>
                  ) : (
                    <><b>INSERT TOKENS</b> — {videoTokenCost} 🪙 per take</>
                  )}
                </span>
              </div>
              {remaining <= 0 && tokens < videoTokenCost && (
                <Text variant="bodySm" as="p" tone="critical">
                  Plan takes are used and the coin bank is under {videoTokenCost} — top up tokens or upgrade on the Packages page.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Failed renders — dismissible, never silent */}
        {failedJobs.length > 0 && (
          <Layout.Section>
            <BlockStack gap="300">
              {failedJobs.map((j) => (
                <Banner
                  key={j.id}
                  tone="critical"
                  title={`Render failed — ${j.title} · ${j.origin}`}
                  action={{
                    content: "Retry (free — resumes where it stopped)",
                    onAction: () => crowner.submit({ intent: "retryJob", jobId: j.id }, { method: "post" }),
                  }}
                  secondaryAction={{
                    content: "Dismiss",
                    onAction: () => crowner.submit({ intent: "dismissJob", jobId: j.id }, { method: "post" }),
                  }}
                >
                  <p>
                    {j.lastError || "Unknown error."} ({j.attempts} attempts)
                    {/(payment|credit|402|billing|insufficient)/i.test(j.lastError || "")
                      ? " — the video provider account looks out of credit."
                      : " — Retry picks up from the last completed stage, so finished footage isn't re-bought."}
                  </p>
                </Banner>
              ))}
            </BlockStack>
          </Layout.Section>
        )}

        {/* TAKE LIBRARY — filterable by status / presenter / product */}
        <Layout.Section>
          <span className="mm-section-label">▶ TAKE LIBRARY</span>
          <div className="mm-lib-tabs">
            <button
              type="button"
              className={`mm-chip mm-filter-chip${libTab === "READY" ? " on" : ""}`}
              onClick={() => setLibTab("READY")}
            >
              ✅ Ready ({videos.length})
            </button>
            <button
              type="button"
              className={`mm-chip mm-filter-chip${libTab === "PENDING" ? " on" : ""}`}
              onClick={() => setLibTab("PENDING")}
            >
              🗓️ Scheduled & rendering ({activeJobs.length})
            </button>
          </div>
          {opError && (
            <Box paddingBlockEnd="300">
              <Banner tone="critical" title="That didn't work">
                <p>{opError}</p>
              </Banner>
            </Box>
          )}
          {taker.data && "attached" in taker.data && taker.data.attached && (
            <Box paddingBlockEnd="300">
              <Banner tone="success" title={`Video attached to "${taker.data.attached}"`}>
                <p>Shopify is processing it now — it'll appear in that product's media shortly.</p>
              </Banner>
            </Box>
          )}
          {taker.data && "posted" in taker.data && taker.data.posted && (
            <Box paddingBlockEnd="300">
              <Banner tone="success" title="📲 Posted to your socials">
                <p>Live on {taker.data.posted}. Check your accounts — this is the same pipeline your campaigns post through automatically.</p>
              </Banner>
            </Box>
          )}
          {taker.data && "opError" in taker.data && taker.data.opError && (
            <Box paddingBlockEnd="300">
              <Banner tone="critical" title="Couldn't post"><p>{taker.data.opError}</p></Banner>
            </Box>
          )}
          {videos.length === 0 && activeJobs.length === 0 ? (
            <Card>
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  No videos yet — pick a presenter and roll your first take above.
                </Text>
              </Box>
            </Card>
          ) : (
            <BlockStack gap="300">
              {libTab === "READY" && (
                <Card>
                  <InlineStack gap="400" blockAlign="end" wrap>
                    <div className="mm-filter-chips">
                      {([["ALL", "All"], ["PENDING", "Needs review"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]] as const).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          className={`mm-chip mm-filter-chip${statusFilter === val ? " on" : ""}`}
                          onClick={() => setStatusFilter(val)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <Box minWidth="170px">
                      <Select label="Presenter" options={presenterOptions} value={presenterFilter} onChange={setPresenterFilter} />
                    </Box>
                    <Box minWidth="170px">
                      <Select label="Product" options={productOptions} value={productFilter} onChange={setProductFilter} />
                    </Box>
                  </InlineStack>
                </Card>
              )}
              {libTab === "READY" && filteredVideos.length === 0 && (
                <Card>
                  <Box padding="400">
                    <Text as="p" tone="subdued" alignment="center">
                      {videos.length === 0 ? "No finished takes yet — scheduled ones appear under the other tab." : "No takes match those filters."}
                    </Text>
                  </Box>
                </Card>
              )}
              {libTab === "PENDING" && activeJobs.length === 0 && (
                <Card>
                  <Box padding="400">
                    <Text as="p" tone="subdued" alignment="center">Nothing scheduled or rendering right now — finished takes are under Ready.</Text>
                  </Box>
                </Card>
              )}
              <div className="mm-take-grid">
              {libTab === "PENDING" && activeJobs.map((j) => {
                const cm = j.avatarId ? AVATAR_BY_ID[j.avatarId] : null;
                const thumb = j.productImage || (cm && castAvail[cm.id] ? castImg(cm.id, j.avatarVariant) : null);
                const mins = now ? Math.max(1, Math.round((now - new Date(j.createdAt).getTime()) / 60_000)) : null;
                // a drip job with a future forge time isn't rendering — it's scheduled
                const scheduled = j.status === "PENDING" && j.scheduledFor;
                const schedLabel = scheduled ? fmtDayTime(j.scheduledFor as string) : null;
                return (
                  <div key={j.id} className="mm-take-render">
                    <div className="mm-take-render-thumb">
                      {thumb ? <img src={thumb} alt="" /> : <div className="ph">🎬</div>}
                      {scheduled ? (
                        <div className="mm-sched-overlay" aria-hidden="true">
                          <span className="ico">🗓️</span>
                          <span className="lb">SCHEDULED</span>
                          <span className="dt">{schedLabel}</span>
                        </div>
                      ) : (
                        <div className="mm-buffer" aria-hidden="true"><span className="ring" /></div>
                      )}
                    </div>
                    <div className="mm-take-render-body">
                      <Text variant="headingSm" as="h3">{j.title}</Text>
                      <InlineStack gap="200" blockAlign="center">
                        {cm && castAvail[cm.id] && (
                          <span className="mm-cast-tag">
                            <img src={castImg(cm.id, j.avatarVariant)} alt="" /> {cm.name}
                          </span>
                        )}
                        <Badge tone={scheduled ? "info" : "attention"}>
                          {scheduled ? "SCHEDULED" : j.status === "IN_PROGRESS" ? "RENDERING NOW" : "IN LINE"}
                        </Badge>
                        <span className="mm-origin-tag">{j.origin}</span>
                      </InlineStack>
                      <Text variant="bodySm" as="p" tone="subdued">
                        {scheduled
                          ? `Scheduled to generate on ${schedLabel} — your campaign creates this automatically about a day before it posts. Nothing to do; it'll appear here when it's forged.`
                          : j.status === "IN_PROGRESS"
                          ? `${mins ? `${mins} min in · ` : ""}usually 3–8 min${mins && mins > 8 ? " — long takes happen when the AI model is warming up" : ""}. Updates automatically.`
                          : "Waiting for the take ahead of it to finish — takes render one at a time."}
                      </Text>
                    </div>
                  </div>
                );
              })}
              {libTab === "READY" && filteredVideos.map((v) => {
                const body = JSON.parse(v.bodyJson);
                const meta = JSON.parse(v.metaJson);
                const pendingProvider = body.status === "awaiting_video_provider";
                const castMember = meta.avatarId ? AVATAR_BY_ID[meta.avatarId] : null;
                return (
                  <Card key={v.id}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text variant="headingSm" as="h3">{v.title}</Text>
                          <InlineStack gap="200" blockAlign="center">
                            {castMember ? (
                              <span className="mm-cast-tag">
                                <img src={avatarImg(castMember.id, meta.avatarVariant ?? 0)} alt="" /> {castMember.name}
                              </span>
                            ) : (
                              <Badge>{(meta.style || "PRODUCT_HIGHLIGHT").replace(/_/g, " ")}</Badge>
                            )}
                            <Badge tone={v.status === "APPROVED" ? "success" : v.status === "REJECTED" ? "critical" : "warning"}>
                              {v.status}
                            </Badge>
                            {meta.attachedProductTitle && (
                              <Badge tone="success">{`📎 ${String(meta.attachedProductTitle).slice(0, 24)}`}</Badge>
                            )}
                            {meta.socialQueued && <Badge tone="info">QUEUED FOR SOCIAL</Badge>}
                            {meta.origin && <span className="mm-origin-tag">{meta.origin}</span>}
                          </InlineStack>
                        </BlockStack>
                      </InlineStack>

                      {body.videoUrl ? (
                        <video
                          src={body.videoUrl}
                          controls
                          style={{ width: "100%", maxWidth: 320, borderRadius: 12 }}
                        />
                      ) : (
                        <Banner tone={pendingProvider ? "info" : "warning"}>
                          <p>
                            {pendingProvider
                              ? "Queued — connect a video provider to render this. Your prompt & style are saved."
                              : "Rendering…"}
                          </p>
                        </Banner>
                      )}

                      {body.prompt && (
                        <>
                          <Divider />
                          <Text variant="bodySm" as="p" tone="subdued">
                            <strong>Direction:</strong> {body.prompt}
                          </Text>
                        </>
                      )}

                      <InlineStack gap="200">
                        <Button
                          size="slim"
                          onClick={() =>
                            generate("regenerate", {
                              title: v.title || meta.productTitle || "",
                              avatarId: meta.avatarId || "",
                              variant: meta.avatarVariant ?? 0,
                              prompt: meta.direction || "",
                            })
                          }
                          loading={busy}
                        >
                          Another take
                        </Button>
                        {v.status === "PENDING" && (
                          <>
                            <Button
                              size="slim"
                              variant="primary"
                              onClick={() => submit({ intent: "approve", assetId: v.id }, { method: "post" })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => submit({ intent: "reject", assetId: v.id }, { method: "post" })}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {body.videoUrl && (
                          <>
                            <Button size="slim" url={body.videoUrl} download target="_blank">
                              ⬇ Download
                            </Button>
                            <Button
                              size="slim"
                              onClick={() => { setAttachingId(attachingId === v.id ? null : v.id); setAttachPick(""); }}
                            >
                              📎 Attach to listing
                            </Button>
                            <Button
                              size="slim"
                              pressed={!!meta.socialQueued}
                              loading={taker.state !== "idle"}
                              onClick={() => taker.submit({ intent: "queueSocial", assetId: v.id }, { method: "post" })}
                            >
                              {meta.socialQueued ? "📣 Unqueue" : "📣 Queue for social"}
                            </Button>
                            {posterEnabled && (
                              <Button
                                size="slim"
                                variant="primary"
                                loading={taker.state !== "idle"}
                                disabled={linkedSocials.length === 0}
                                onClick={() => taker.submit({ intent: "postToSocials", assetId: v.id }, { method: "post" })}
                              >
                                {linkedSocials.length === 0 ? "📲 Connect socials first" : `📲 Post now → ${linkedSocials.map((p: string) => p === "facebook" ? "FB" : p === "instagram" ? "IG" : "TikTok").join("+")}`}
                              </Button>
                            )}
                          </>
                        )}
                        <Button
                          size="slim"
                          tone="critical"
                          variant="tertiary"
                          onClick={() => {
                            if (window.confirm("Delete this take? The video file is removed for good.")) {
                              taker.submit({ intent: "deleteTake", assetId: v.id }, { method: "post" });
                            }
                          }}
                        >
                          🗑
                        </Button>
                      </InlineStack>

                      {attachingId === v.id && (
                        <InlineStack gap="200" blockAlign="end" wrap>
                          <Box minWidth="240px">
                            <Select label="Attach to product listing" options={attachOptions} value={attachPick} onChange={setAttachPick} />
                          </Box>
                          <Button
                            variant="primary"
                            size="slim"
                            disabled={!attachPick}
                            loading={taker.state !== "idle"}
                            onClick={() =>
                              taker.submit(
                                {
                                  intent: "attachProduct",
                                  assetId: v.id,
                                  productId: attachPick,
                                  productTitle: products.find((p) => p.id === attachPick)?.title || "",
                                },
                                { method: "post" }
                              )
                            }
                          >
                            Attach video to listing
                          </Button>
                        </InlineStack>
                      )}
                    </BlockStack>
                  </Card>
                );
              })}
              </div>
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
