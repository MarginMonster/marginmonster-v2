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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { enqueueJob } from "../lib/job-queue.server";
import { AVATARS, AVATAR_BY_ID, DIRECTION_CHIPS, OUTFITS, CAST_PREVIEW_COUNT, avatarImg } from "../lib/avatars";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  if (!shop) return json({ videos: [], plan: null, hasVideoPlan: false, products: [] });

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
  const renderJobs = (
    await db.job.findMany({
      where: { shopId: shop.id, type: "GENERATE_VIDEO_AD", status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    })
  ).map((j) => {
    let title = "Video";
    try { title = JSON.parse(j.payload).productTitle || "Video"; } catch { /* keep default */ }
    return { id: j.id, status: j.status, title, lastError: j.lastError, attempts: j.attempts };
  });

  const plan = shop.activePlan;
  const hasVideoPlan = !!plan && plan.videoQuota > 0;

  return json({
    videos,
    plan: plan
      ? { videoQuota: plan.videoQuota, videoUsed: plan.videoUsed, videoCredits: plan.videoCredits }
      : null,
    hasVideoPlan,
    products,
    castAvail,
    renderJobs,
    brandFace: shop.brandAvatarId
      ? { id: shop.brandAvatarId, variant: shop.brandAvatarVariant ?? 0 }
      : null,
  });
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
    if (!shop.activePlan || shop.activePlan.videoQuota <= 0) {
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
    if (!productTitle) return json({ error: "Give your video a product or subject." });

    await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
      productTitle,
      style,
      customPrompt,
      avatarId,
      avatarVariant,
      productImageUrl,
      productDescription,
    });
    return json({ ok: true, queued: true });
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
  const { videos, plan, hasVideoPlan, products, brandFace, castAvail, renderJobs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const puller = useFetcher<{ pulled?: Pick; pullError?: string }>();
  const crowner = useFetcher();
  const busy = nav.state !== "idle";
  const pulling = puller.state !== "idle";
  const queued = !!(actionData && "queued" in actionData && actionData.queued);
  const actionError = actionData && "error" in actionData ? (actionData.error as string) : null;

  // Brand Face pre-casts the merchant's signature presenter + outfit
  const [productTitle, setProductTitle] = useState("");
  const [avatarId, setAvatarId] = useState<string>(brandFace?.id || ""); // "" = product only
  const [avatarVariant, setAvatarVariant] = useState(brandFace?.variant ?? 0); // wardrobe slot 0-3
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
  const rendering = renderJobs.some((j) => j.status === "PENDING" || j.status === "IN_PROGRESS");
  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(() => revalidator.revalidate(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendering]);
  const [customPrompt, setCustomPrompt] = useState("");
  const [pick, setPick] = useState<Pick | null>(null);
  const [pullUrl, setPullUrl] = useState("");

  const castAvatar = (id: string) => {
    setAvatarId(id);
    setAvatarVariant(0); // new presenter starts in their default fit
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
          <div className="mm-hero">
            <span className="mm-eyebrow">▶ VIDEO STUDIO · DIRECTOR MODE</span>
            <h1><span className="mm-marquee">Lights. Camera. Sales.</span></h1>
            <p>
              Choose a presenter from the cast (or go product-only), add your
              direction, and we'll shoot a scroll-stopping vertical video —
              cut for TikTok, Reels, and Shorts.
            </p>
            <div className="mm-hero-stats">
              <div className="mm-hero-stat">
                <div className="k">VIDEOS LEFT</div>
                <div className="v">{remaining}</div>
              </div>
              <div className="mm-hero-stat">
                <div className="k">NOW CASTING</div>
                <div className="v cyan">
                  {selectedAvatar ? `${selectedAvatar.name} · ${OUTFITS[avatarVariant].label.toUpperCase()}` : "PRODUCT ONLY"}
                </div>
              </div>
            </div>
          </div>
        </Layout.Section>

        {/* ROLL CAMERA feedback — a click ALWAYS has a visible consequence */}
        {(queued || actionError) && (
          <Layout.Section>
            {queued ? (
              <Banner tone="success" title="🎬 Rolling!">
                <p>Your video is rendering — this usually takes 2–5 minutes. It'll appear below automatically; you can keep working or roll another.</p>
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

              <div className="mm-forge-cta">
                <button
                  type="button"
                  className="mm-arcade-btn"
                  onClick={() => generate("generate")}
                  disabled={busy || !productTitle.trim() || remaining <= 0}
                >
                  {busy ? "ROLLING…" : "▶ ROLL CAMERA"}
                </button>
                <span className={`mm-credits${remaining <= 0 ? " low" : ""}`}>
                  <b>TAKES LEFT</b> 🎬 {remaining}
                </span>
              </div>
              {remaining <= 0 && (
                <Text variant="bodySm" as="p" tone="critical">
                  Out of video takes this period — top up or upgrade on the Plans page.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* In-flight + failed renders — the queue is never invisible */}
        {renderJobs.length > 0 && (
          <Layout.Section>
            <BlockStack gap="300">
              {renderJobs.map((j) =>
                j.status === "FAILED" ? (
                  <Banner key={j.id} tone="critical" title={`Render failed — ${j.title}`}>
                    <p>
                      {j.lastError || "Unknown error."} ({j.attempts} attempts)
                      {/(payment|credit|402|billing|insufficient)/i.test(j.lastError || "")
                        ? " — the video provider account looks out of credit."
                        : " — hit ROLL CAMERA to try again."}
                    </p>
                  </Banner>
                ) : (
                  <Card key={j.id}>
                    <InlineStack gap="300" blockAlign="center">
                      <span className="mm-render-spin" aria-hidden="true">🎥</span>
                      <BlockStack gap="050">
                        <Text variant="headingSm" as="h3">RENDERING — {j.title}</Text>
                        <Text variant="bodySm" as="p" tone="subdued">
                          Usually 2–5 minutes. This page checks automatically every few seconds.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </Card>
                )
              )}
            </BlockStack>
          </Layout.Section>
        )}

        {/* TAKE LIBRARY — filterable by status / presenter / product */}
        <Layout.Section>
          <span className="mm-section-label">
            ▶ TAKE LIBRARY ({filteredVideos.length}{filteredVideos.length !== videos.length ? ` of ${videos.length}` : ""})
          </span>
          {videos.length === 0 ? (
            <Card>
              <Box padding="400">
                <Text as="p" tone="subdued" alignment="center">
                  No videos yet — pick a presenter and roll your first take above.
                </Text>
              </Box>
            </Card>
          ) : (
            <BlockStack gap="300">
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
              {filteredVideos.length === 0 && (
                <Card>
                  <Box padding="400">
                    <Text as="p" tone="subdued" alignment="center">No takes match those filters.</Text>
                  </Box>
                </Card>
              )}
              <div className="mm-take-grid">
              {filteredVideos.map((v) => {
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
                              prompt: body.prompt || "",
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
                      </InlineStack>
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
