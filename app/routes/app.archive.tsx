import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, useRevalidator, useSearchParams, Link } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Page, Banner } from "@shopify/polaris";
import fs from "node:fs";
import path from "node:path";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { parseSchedule } from "../lib/questlines";
import { generateSlotEarly, retrySlot } from "../lib/questlines.server";
import { tokensRemaining, spendTokens } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { linkedFromCache } from "../lib/social-provider.server";
import { enqueueJob } from "../lib/job-queue.server";
import { paidAdsEnabled } from "../lib/feature-flags.server";

const BOOST_FEE = 25; // token service fee per boost; ad spend bills the merchant's own account

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtWhen(date: string, time: string): string {
  const [, m, d] = date.split("-").map(Number);
  const h = parseInt((time || "12:00").slice(0, 2), 10);
  const mm = (time || "12:00").slice(3, 5);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${MON[(m || 1) - 1]} ${d} · ${mm === "00" ? `${h12}${ap}` : `${h12}:${mm}${ap}`}`;
}
const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

type Card = { id: string; title: string; status: string; video?: string; image?: string; snippet?: string; full?: string; html?: string; daysLeft?: number };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, adAccounts: true, questlines: { where: { status: { not: "COMPLETE" } }, orderBy: { createdAt: "desc" }, take: 30 } },
  });
  if (!shop) return json({ hasPlan: false, tokens: 0, library: { video: [], image: [], blog: [] }, scheduled: [], jobCards: [], linkedSocial: [], products: [], adPlatforms: [], boostFee: BOOST_FEE, paidAds: false, cost: TOKEN_COST });

  // Store products power the "add to a product" merchandising action.
  let products: { id: string; title: string }[] = [];
  try {
    const res = await admin.graphql(`{ products(first: 30, sortKey: UPDATED_AT, reverse: true) { edges { node { id title } } } }`);
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { id: string; title: string } }[] } } };
    products = (j.data?.products?.edges || []).map((e) => ({ id: e.node.id, title: e.node.title }));
  } catch { /* fall through */ }

  const assets = await db.asset.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 80 });

  // In-flight + failed generation jobs → buffering / retry tiles on their tab.
  const jobRows = await db.job.findMany({ where: { shopId: shop.id, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] }, status: { in: ["PENDING", "IN_PROGRESS", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 40 });
  const nowMs = Date.now();
  const TYPICAL: Record<string, number> = { GENERATE_VIDEO_AD: 180, GENERATE_IMAGE_AD: 45, GENERATE_BLOG_POST: 40 };
  const KIND: Record<string, "video" | "image" | "blog"> = { GENERATE_VIDEO_AD: "video", GENERATE_IMAGE_AD: "image", GENERATE_BLOG_POST: "blog" };
  const jobCards: { jobId: string; kind: "video" | "image" | "blog"; status: "generating" | "failed"; productImage: string | null; productTitle: string; etaSec: number }[] = [];
  for (const j of jobRows) {
    let p: { productImageUrl?: string; productTitle?: string } = {};
    try { p = JSON.parse(j.payload); } catch { /* ignore */ }
    const due = !j.runAt || j.runAt.getTime() <= nowMs;
    const failed = j.status === "FAILED";
    const generating = j.status === "IN_PROGRESS" || (j.status === "PENDING" && due);
    if (!failed && !generating) continue; // scheduled-future drip lives in the Scheduled tab
    const startMs = (j.status === "IN_PROGRESS" ? j.updatedAt : j.createdAt).getTime();
    const etaSec = generating ? Math.max(5, Math.round(TYPICAL[j.type] - (nowMs - startMs) / 1000)) : 0;
    jobCards.push({ jobId: j.id, kind: KIND[j.type] || "image", status: failed ? "failed" : "generating", productImage: p.productImageUrl || null, productTitle: p.productTitle || "", etaSec });
  }
  const parse = (bodyJson: string) => { try { return JSON.parse(bodyJson); } catch { return {}; } };
  const byId = new Map(assets.map((a) => [a.id, a]));
  const CACHE_DAYS = 30;
  const nowT = Date.now();
  const toCard = (a: (typeof assets)[number]): Card => {
    const b = parse(a.bodyJson);
    const text = b.html ? stripHtml(b.html) : undefined;
    // Un-kept media (PENDING video/photo) auto-clears at 30 days — surface a
    // per-item countdown so nothing vanishes as a surprise. Blogs never expire.
    const unkeptMedia = a.status === "PENDING" && (a.type === "VIDEO_AD" || a.type === "IMAGE_AD");
    const daysLeft = unkeptMedia ? Math.max(0, CACHE_DAYS - Math.floor((nowT - a.createdAt.getTime()) / 86_400_000)) : undefined;
    return { id: a.id, title: a.title || "Untitled", status: a.status, video: b.videoUrl, image: b.imageUrl, snippet: text?.slice(0, 140), full: text?.slice(0, 4000), html: a.type === "BLOG_POST" && typeof b.html === "string" ? b.html : undefined, daysLeft };
  };
  const library = {
    video: assets.filter((a) => a.type === "VIDEO_AD").map(toCard),
    image: assets.filter((a) => a.type === "IMAGE_AD").map(toCard),
    blog: assets.filter((a) => a.type === "BLOG_POST").map(toCard),
  };

  const scheduled: { qid: string; slotIdx: number; type: string; product: string; when: string; date: string; status: string; campaign: string; image?: string; video?: string }[] = [];
  for (const q of shop.questlines) {
    for (const s of parseSchedule(q.scheduleJson).slots) {
      if (s.type !== "video" && s.type !== "image" && s.type !== "blog") continue;
      if (s.status === "POSTED") continue; // posted content lives in the library tabs
      const asset = s.assetId ? byId.get(s.assetId) : undefined;
      const b = asset ? parse(asset.bodyJson) : {};
      scheduled.push({ qid: q.id, slotIdx: s.idx, type: s.type, product: s.productTitle || q.name, when: fmtWhen(s.date, s.time), date: s.date, status: s.status, campaign: q.name, image: b.imageUrl, video: b.videoUrl });
    }
  }
  scheduled.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return json({
    hasPlan: !!shop.activePlan,
    tokens: shop.activePlan ? tokensRemaining(shop.activePlan) : 0,
    library,
    scheduled,
    jobCards,
    linkedSocial: linkedFromCache(shop.socialsJson).filter((p) => p === "tiktok" || p === "instagram" || p === "facebook"),
    products,
    adPlatforms: shop.adAccounts.map((a) => a.platform),
    boostFee: BOOST_FEE,
    paidAds: paidAdsEnabled(),
    cost: TOKEN_COST,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true, adAccounts: true } });
  if (!shop) return json({ error: "Shop not found." });
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const questlineId = (form.get("questlineId") as string) || "";
  const slotIdx = parseInt((form.get("slotIdx") as string) || "-1", 10);

  if (intent === "generateEarly") {
    const r = await generateSlotEarly(shop.id, questlineId, slotIdx);
    return json(r.ok ? { started: true } : { error: r.error });
  }
  if (intent === "retry") {
    const r = await retrySlot(shop.id, questlineId, slotIdx);
    return json(r.ok ? { retried: r.cost } : { error: r.error });
  }
  if (intent === "retryJob") {
    // Genuine generation failure (e.g. interrupted mid-render) → FREE retry.
    const jobId = (form.get("jobId") as string) || "";
    const job = await db.job.findFirst({ where: { id: jobId, shopId: shop.id, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] } } });
    if (!job) return json({ error: "That job's gone — try generating again from the Studio." });
    await db.job.update({ where: { id: job.id }, data: { status: "PENDING", attempts: 0, lastError: null, runAt: new Date() } });
    return json({ jobRetried: true });
  }
  if (intent === "dismissJob") {
    // They don't want to retry a wipeout — clear it out of storage for good.
    const jobId = (form.get("jobId") as string) || "";
    await db.job.deleteMany({ where: { id: jobId, shopId: shop.id, status: "FAILED", type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] } } });
    return json({ jobDismissed: true });
  }
  if (intent === "publishBlog") {
    // Blogs publish to the store's Online Store blog (SEO), not to socials.
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: "BLOG_POST" } });
    if (!asset) return json({ error: "That article is gone — refresh and try again." });
    const { publishBlogAsset } = await import("../lib/blog-publish.server");
    const r = await publishBlogAsset(shop.domain, id);
    if (!r.ok) return json({ error: `Couldn't publish (${r.error}) — check your store's blog permissions.` });
    return json({ blogPosted: r.url || "your blog" });
  }
  if (intent === "keep") {
    await db.asset.updateMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id }, data: { status: "APPROVED" } });
    return json({ kept: true });
  }
  if (intent === "delete") {
    await db.asset.deleteMany({ where: { id: (form.get("assetId") as string) || "", shopId: shop.id } });
    return json({ deleted: true });
  }
  if (intent === "draft") {
    // Suggest one editable caption for the manual post box. EasyMode: a single
    // caption the merchant can tweak, not three per-platform boxes. Tuned to
    // Instagram when linked (richest tag style), else the first linked network.
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
    if (!asset) return json({ error: "That piece is gone — refresh and try again." });
    let title = asset.title || "New from our shop";
    try { const m = JSON.parse(asset.metaJson || "{}"); title = m.productTitle || title; } catch { /* ignore */ }
    const isVideo = asset.type === "VIDEO_AD";
    let platforms: string[] = [];
    try {
      const { refreshLinkedPlatforms, socialProviderEnabled } = await import("../lib/social-provider.server");
      if (socialProviderEnabled()) platforms = (await refreshLinkedPlatforms(shop.id)).filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
    } catch { /* ignore */ }
    if (platforms.length === 0) platforms = ["instagram"];
    const tune = platforms.includes("instagram") ? "instagram" : platforms[0];
    const { getOrMakeCaptions, buildPostTitle, fallbackCaption } = await import("../lib/social-caption.server");
    const captions = await getOrMakeCaptions(id, shop.id, { productTitle: title, isVideo, platforms });
    const fbText = fallbackCaption({ productTitle: title, isVideo, platforms }).text;
    return json({ draft: buildPostTitle(captions[tune], "", fbText) });
  }
  if (intent === "post") {
    const id = (form.get("assetId") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
    if (!asset) return json({ error: "That piece is gone — refresh and try again." });
    let media: string | undefined;
    let title = asset.title || "New from our shop";
    try { const b = JSON.parse(asset.bodyJson || "{}"); media = b.videoUrl || b.imageUrl; } catch { /* ignore */ }
    try { const m = JSON.parse(asset.metaJson || "{}"); title = m.productTitle || title; } catch { /* ignore */ }
    if (!media) return json({ error: "This piece has no rendered file yet." });
    const { ensureProfile, refreshLinkedPlatforms, publishPost, socialProviderEnabled } = await import("../lib/social-provider.server");
    if (!socialProviderEnabled()) return json({ error: "Auto-posting isn't switched on yet." });
    const profileKey = await ensureProfile(shop.id);
    if (!profileKey) return json({ error: "Couldn't reach the posting service." });
    const platforms = (await refreshLinkedPlatforms(shop.id)).filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
    if (platforms.length === 0) return json({ error: "Connect a social account first, then post." });
    const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const mediaUrl = /^https?:\/\//.test(media) ? media : base ? `${base}${media}` : media;
    const isVideo = asset.type === "VIDEO_AD";

    // If the merchant edited a caption in the draft box, post THAT verbatim to
    // every platform (their words win, no tokens spent). Otherwise fall back to
    // the AI writer: a per-platform tuned caption, cached on the asset.
    const custom = ((form.get("caption") as string) || "").trim();
    let titleFor: (p: string) => string;
    if (custom) {
      titleFor = () => custom.slice(0, 900);
    } else {
      const { getOrMakeCaptions, buildPostTitle, fallbackCaption } = await import("../lib/social-caption.server");
      const captions = await getOrMakeCaptions(id, shop.id, { productTitle: title, isVideo, platforms });
      const fbText = fallbackCaption({ productTitle: title, isVideo, platforms }).text;
      titleFor = (p) => buildPostTitle(captions[p], "", fbText);
    }
    const urls: Record<string, string> = {};
    let anyOk = false;
    let lastErr: string | undefined;
    for (const p of platforms) {
      const r = await publishPost(profileKey, { title: titleFor(p), mediaUrl, isVideo, platforms: [p] });
      if (r.ok) { anyOk = true; if (r.urls) Object.assign(urls, r.urls); }
      else lastErr = r.error;
    }
    if (!anyOk) return json({ error: `Posting failed (${lastErr || "unknown"}) — check your connected accounts.` });
    await db.asset.update({ where: { id }, data: { status: "PUBLISHED" } });
    return json({ posted: platforms.join(", ") });
  }
  if (intent === "boost") {
    const assetId = (form.get("assetId") as string) || "";
    const platform = (form.get("platform") as string) || "";
    const budgetDaily = Math.max(1, Math.min(500, Number(form.get("budget") || 10)));
    if (!shop.activePlan?.active) return json({ error: "Pick a plan first to boost." });
    if (!shop.adAccounts.find((a) => a.platform === platform)) return json({ error: "Connect your ad account first — you set the budget, it spends from your account." });
    const asset = await db.asset.findFirst({ where: { id: assetId, shopId: shop.id } });
    if (!asset) return json({ error: "That piece is gone." });
    try { await spendTokens(shop.id, BOOST_FEE); } catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for the boost fee." }); }
    await db.asset.update({ where: { id: assetId }, data: { status: "APPROVED" } });
    await enqueueJob(shop.id, "LAUNCH_CAMPAIGN", { assetId, platform, weeklyBudgetCents: Math.round(budgetDaily * 7 * 100) });
    return json({ boosted: platform });
  }
  if (intent === "attach") {
    const id = (form.get("assetId") as string) || "";
    const productId = (form.get("productId") as string) || "";
    const productTitle = (form.get("productTitle") as string) || "";
    const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
    if (!asset || !productId) return json({ error: "Pick a product to attach this to." });
    const isVideo = asset.type === "VIDEO_AD";
    try {
      const body = JSON.parse(asset.bodyJson || "{}");
      const mediaUrl: string | undefined = body.videoUrl || body.imageUrl;
      if (!mediaUrl) return json({ error: "This piece has no rendered file yet." });
      let buf: Buffer;
      if (String(mediaUrl).startsWith("/renders/")) {
        const f = path.join(process.cwd(), "data", "renders", path.basename(mediaUrl));
        if (!fs.existsSync(f)) return json({ error: "The file expired from storage — regenerate and attach a fresh one." });
        buf = fs.readFileSync(f);
      } else {
        const r = await fetch(mediaUrl);
        if (!r.ok) return json({ error: "The file expired — regenerate and attach a fresh one." });
        buf = Buffer.from(await r.arrayBuffer());
      }
      const filename = isVideo ? "easymode.mp4" : "easymode.jpg";
      const mime = isVideo ? "video/mp4" : "image/jpeg";
      const staged = await admin.graphql(
        `mutation Staged($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
        { variables: { input: [{ resource: isVideo ? "VIDEO" : "IMAGE", filename, mimeType: mime, fileSize: String(buf.length), httpMethod: "POST" }] } }
      );
      const sj = (await staged.json()) as { data?: { stagedUploadsCreate?: { stagedTargets?: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors?: { message: string }[] } } };
      const errs1 = sj.data?.stagedUploadsCreate?.userErrors || [];
      const target = sj.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (errs1.length || !target) return json({ error: errs1[0]?.message || "Shopify refused the upload slot." });
      const fd = new FormData();
      for (const p of target.parameters) fd.append(p.name, p.value);
      fd.append("file", new Blob([buf], { type: mime }), filename);
      const up = await fetch(target.url, { method: "POST", body: fd });
      if (!up.ok && up.status !== 201) return json({ error: `Upload failed (${up.status}).` });
      const media = await admin.graphql(
        `mutation Attach($productId: ID!, $media: [CreateMediaInput!]!) { productCreateMedia(productId: $productId, media: $media) { mediaUserErrors { message } } }`,
        { variables: { productId, media: [{ mediaContentType: isVideo ? "VIDEO" : "IMAGE", originalSource: target.resourceUrl, alt: asset.title || "EasyMode" }] } }
      );
      const mj = (await media.json()) as { data?: { productCreateMedia?: { mediaUserErrors?: { message: string }[] } } };
      const errs2 = mj.data?.productCreateMedia?.mediaUserErrors || [];
      if (errs2.length) return json({ error: errs2[0].message });
      return json({ attached: productTitle });
    } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }); }
  }
  return json({ ok: true });
};

const TABS = [
  { key: "video", label: "Videos", icon: "🎬" },
  { key: "image", label: "Images", icon: "🖼" },
  { key: "blog", label: "Blogs", icon: "✍️" },
  { key: "scheduled", label: "Scheduled", icon: "🗓" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const TYPE_LABEL: Record<string, string> = { video: "Video", image: "Image", blog: "Blog" };
const STATUS_LABEL: Record<string, string> = { SCHEDULED: "Scheduled", FORGING: "Creating", READY: "Ready to post", FAILED: "Needs retry" };

export default function Archive() {
  const { hasPlan, tokens, library, scheduled, jobCards, linkedSocial, products, adPlatforms, boostFee, paidAds, cost } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const revalidator = useRevalidator();
  const busy = nav.state !== "idle";
  const err = actionData && "error" in actionData ? (actionData as { error: string }).error : null;
  const [searchParams] = useSearchParams();
  const startTab = (["video", "image", "blog", "scheduled"] as const).find((t) => t === searchParams.get("tab")) as TabKey | undefined;
  const [tab, setTab] = useState<TabKey>(startTab || "video");
  const [viewer, setViewer] = useState<(Card & { kind: TabKey }) | null>(null);

  // Keep buffering tiles + ETAs live while anything is generating.
  const anyGenerating = jobCards.some((j) => j.status === "generating");
  useEffect(() => {
    if (!anyGenerating) return;
    const t = setInterval(() => { if (revalidator.state === "idle") revalidator.revalidate(); }, 9000);
    return () => clearInterval(t);
  }, [anyGenerating, revalidator]);

  const early = (qid: string, slotIdx: number) => submit({ intent: "generateEarly", questlineId: qid, slotIdx: String(slotIdx) }, { method: "post" });
  const retry = (qid: string, slotIdx: number) => submit({ intent: "retry", questlineId: qid, slotIdx: String(slotIdx) }, { method: "post" });
  const retryJob = (jobId: string) => submit({ intent: "retryJob", jobId }, { method: "post" });
  const dismissJob = (jobId: string) => submit({ intent: "dismissJob", jobId }, { method: "post" });
  const keepAsset = (assetId: string) => submit({ intent: "keep", assetId }, { method: "post" });
  const deleteAsset = (assetId: string) => submit({ intent: "delete", assetId }, { method: "post" });
  const publishBlog = (assetId: string) => submit({ intent: "publishBlog", assetId }, { method: "post" });
  const blogPosted = actionData && "blogPosted" in actionData ? (actionData as { blogPosted: string }).blogPosted : null;
  const posted = actionData && "posted" in actionData ? (actionData as { posted: string }).posted : null;
  const draftText = actionData && "draft" in actionData ? (actionData as { draft: string }).draft : null;
  // Editable draft: opening "Post to socials" reveals one caption box we
  // pre-fill with an AI suggestion the merchant can tweak or post as-is.
  const [capOpen, setCapOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [draftPending, setDraftPending] = useState(false);
  const startPost = (assetId: string) => { setCaption(""); setCapOpen(true); setDraftPending(true); submit({ intent: "draft", assetId }, { method: "post" }); };
  const doPost = (assetId: string) => submit({ intent: "post", assetId, caption }, { method: "post" });
  useEffect(() => { if (draftText != null) { setCaption(draftText); setDraftPending(false); } }, [draftText]);
  useEffect(() => { setCapOpen(false); setCaption(""); setDraftPending(false); }, [viewer?.id]);
  useEffect(() => { if (posted) setCapOpen(false); }, [posted]);
  const attached = actionData && "attached" in actionData ? (actionData as { attached: string }).attached : null;
  const boosted = actionData && "boosted" in actionData ? (actionData as { boosted: string }).boosted : null;
  const [tool, setTool] = useState<"attach" | "boost" | null>(null);
  const [attachId, setAttachId] = useState("");
  const [boostPlat, setBoostPlat] = useState("");
  const [boostBudget, setBoostBudget] = useState("10");
  const attach = (assetId: string) => { const p = products.find((x) => x.id === attachId); submit({ intent: "attach", assetId, productId: attachId, productTitle: p?.title || "" }, { method: "post" }); };
  const boost = (assetId: string) => submit({ intent: "boost", assetId, platform: boostPlat, budget: boostBudget }, { method: "post" });
  // Close the viewer once a piece is deleted or kept; close tools on success.
  useEffect(() => { if (actionData && ("deleted" in actionData || "kept" in actionData)) setViewer(null); }, [actionData]);
  useEffect(() => { if (attached || boosted) setTool(null); }, [attached, boosted]);
  const costOf = (t: string) => (t === "video" ? cost.video : t === "image" ? cost.image : cost.blog);
  const fmtEta = (s: number) => (s <= 12 ? "almost done" : s < 90 ? `~${s}s left` : `~${Math.round(s / 60)}m left`);

  const lib = tab === "video" ? library.video : tab === "image" ? library.image : tab === "blog" ? library.blog : [];
  // Segregate in-progress vs failed so wipeouts don't clutter finished work.
  const genCards = jobCards.filter((j) => j.kind === tab && j.status === "generating");
  const failCards = jobCards.filter((j) => j.kind === tab && j.status === "failed");

  return (
    <Page>
      <div className="smp">
        <h1 className="smp-h1">Archive Storage</h1>
        <p className="smp-sub">Everything EasyMode makes, in one place — plus what's queued to post next.</p>

        <div className="cs-tabs">
          {TABS.map((t) => (
            <button type="button" key={t.key} className={`cs-tab${t.key === tab ? " sel" : ""}`} onClick={() => setTab(t.key)}>
              <span className="cs-ti">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {err && <div style={{ marginBottom: 14 }}><Banner tone="warning" title="Couldn't do that"><p>{err}</p></Banner></div>}

        {tab === "scheduled" ? (
          <>
            <div className="ar-note">Generating early just lets you <b>preview what will post</b> — it doesn't post early. Posting still happens on schedule.</div>
            {scheduled.length === 0 ? (
              <div className="ar-empty"><b>Nothing scheduled</b><p>Start a Social Media Plan or schedule a drop and it'll queue up here.</p><Link className="dc-new" to="/app/campaigns/new">Browse Social Media Plans</Link></div>
            ) : (
              <div className="ar-list">
                {scheduled.map((s) => {
                  const ready = s.status === "READY";
                  const forging = s.status === "FORGING";
                  const thumb = s.video || s.image;
                  return (
                    <div className="ar-sched" key={`${s.qid}-${s.slotIdx}`}>
                      <div className="ar-sthumb" style={s.image ? { backgroundImage: `url(${s.image})` } : undefined}>
                        {s.video && <video className="ar-svid" src={s.video} muted playsInline preload="metadata" />}
                        {!thumb && <span className={`dc-dtag ${s.type}`}>{TYPE_LABEL[s.type]}</span>}
                      </div>
                      <div className="ar-sbody">
                        <b>{s.product}</b>
                        <span className="ar-smeta"><span className={`dc-dtag ${s.type}`}>{TYPE_LABEL[s.type]}</span> {s.campaign} · posts {s.when}</span>
                        <span className={`ar-status s-${s.status.toLowerCase()}`}>{STATUS_LABEL[s.status] || s.status}</span>
                      </div>
                      <div className="ar-sact">
                        {s.status === "SCHEDULED" && <button type="button" className="ar-btn free" disabled={busy} onClick={() => early(s.qid, s.slotIdx)}>Generate early<span>free · preview it</span></button>}
                        {forging && <button type="button" className="ar-btn" disabled>Creating…</button>}
                        {(ready || s.status === "FAILED") && <button type="button" className="ar-btn retry" disabled={busy} onClick={() => retry(s.qid, s.slotIdx)}>Retry<span>{costOf(s.type)} tokens</span></button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="smp-wallet">{hasPlan ? `Wallet: ${tokens.toLocaleString()} tokens` : "Choose a plan to generate."}</p>
          </>
        ) : (
          <>
            {(tab === "video" || tab === "image") && lib.length > 0 && (
              <p className="ar-cachenote">Un-kept videos &amp; photos clear automatically after 30 days — tap a piece and hit <b>Keep</b> to save it for good.</p>
            )}
            {(tab === "video" || tab === "image") && genCards.length > 0 && (
              <div className="ar-grid ar-gen">
                {genCards.map((j) => (
                  <div className="ar-tile" key={j.jobId}>
                    <div className="ar-timg" style={j.productImage ? { backgroundImage: `url(${j.productImage})` } : undefined}>
                      <span className="ar-bufwrap"><span className="ar-spin" /><span className="ar-eta">{fmtEta(j.etaSec)}</span></span>
                    </div>
                    <span className="ar-tstatus s-forging">Creating…</span>
                  </div>
                ))}
              </div>
            )}
            {tab === "blog" && genCards.length > 0 && (
              <div className="ar-blogs ar-genblogs">
                {genCards.map((j) => (
                  <div className="ar-blog ar-blogbuf" key={j.jobId}>
                    <span className="ar-blogspin"><span className="ar-spin" /></span>
                    <b>{j.productTitle ? `Writing about ${j.productTitle}…` : "Writing your article…"}</b>
                    <span className="ar-status s-forging">Creating · {fmtEta(j.etaSec)}</span>
                  </div>
                ))}
              </div>
            )}
            {lib.length === 0 && genCards.length === 0 && failCards.length === 0 ? (
              <div className="ar-empty"><b>No {TABS.find((t) => t.key === tab)?.label.toLowerCase()} yet</b><p>Make one in the Content Studio and it lands here.</p><Link className="dc-new" to="/app/studio">Open Content Studio</Link></div>
            ) : lib.length > 0 && (
              <div className={tab === "blog" ? "ar-blogs" : "ar-grid"}>
                {lib.map((c) => tab === "blog" ? (
                  <div className="ar-blog ar-blogrow" key={c.id}>
                    <button type="button" className="ar-blogopen" onClick={() => setViewer({ ...c, kind: "blog" })}>
                      <b>{c.title}</b>
                      {c.snippet && <p>{c.snippet}…</p>}
                      <span className={`ar-status s-${c.status.toLowerCase()}`}>{c.status === "PUBLISHED" ? "Live on your blog" : c.status === "APPROVED" ? "Kept" : "Ready to publish"}</span>
                    </button>
                    <button type="button" className="ar-tiletrash" title="Delete this article" disabled={busy} onClick={() => deleteAsset(c.id)}>🗑</button>
                  </div>
                ) : (
                  <div className="ar-tile" key={c.id}>
                    <button type="button" className="ar-thumb" onClick={() => setViewer({ ...c, kind: tab })}>
                      <div className="ar-timg" style={c.image ? { backgroundImage: `url(${c.image})` } : undefined}>
                        {c.video && <video className="ar-svid" src={c.video} muted playsInline preload="metadata" />}
                        {c.daysLeft != null && <span className={`ar-cd${c.daysLeft <= 3 ? " urgent" : c.daysLeft <= 7 ? " warn" : ""}`} title={`Auto-clears in ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} — tap Keep to save it`}>⏳ {c.daysLeft}d</span>}
                      </div>
                    </button>
                    <span className={`ar-tstatus s-${c.status.toLowerCase()}`}>{c.status === "PUBLISHED" ? "Posted" : c.status === "APPROVED" ? "Kept" : "New"}</span>
                    <button type="button" className="ar-tiletrash" title="Delete" disabled={busy} onClick={() => deleteAsset(c.id)}>🗑</button>
                  </div>
                ))}
              </div>
            )}
            {failCards.length > 0 && (
              <div className="ar-failsec">
                <div className="ar-faildiv"><span>Didn't come through</span> retry free, or clear it out</div>
                <div className={tab === "blog" ? "ar-blogs" : "ar-grid"}>
                  {failCards.map((j) => tab === "blog" ? (
                    <div className="ar-blog ar-blogfail" key={j.jobId}>
                      <b>{j.productTitle ? `Article on ${j.productTitle}` : "Your article"}</b>
                      <span className="ar-status s-failed">Didn't come through</span>
                      <div className="ar-failrow">
                        <button type="button" className="ar-retry" disabled={busy} onClick={() => retryJob(j.jobId)}>Retry — free</button>
                        <button type="button" className="ar-tiletrash inline" title="Clear it out" disabled={busy} onClick={() => dismissJob(j.jobId)}>🗑</button>
                      </div>
                    </div>
                  ) : (
                    <div className="ar-tile ar-failtile" key={j.jobId}>
                      <div className="ar-timg ar-fail" style={j.productImage ? { backgroundImage: `url(${j.productImage})` } : undefined}>
                        <span className="ar-failwrap"><span className="ar-failx">↻</span><button type="button" className="ar-retry" disabled={busy} onClick={() => retryJob(j.jobId)}>Retry — free</button></span>
                      </div>
                      <span className="ar-tstatus s-failed">Didn't come through</span>
                      <button type="button" className="ar-tiletrash" title="Clear it out" disabled={busy} onClick={() => dismissJob(j.jobId)}>🗑</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {viewer && (
          <div className="cs-scrim" onClick={() => setViewer(null)}>
            <div className={`ar-viewer${viewer.kind === "blog" ? " blogview" : ""}`} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="cs-vx" onClick={() => setViewer(null)}>✕</button>
              {viewer.kind === "blog" ? (
                <>
                  {viewer.html
                    ? <div className="ar-read ar-readscroll" dangerouslySetInnerHTML={{ __html: viewer.html }} />
                    : <div className="ar-read ar-readscroll"><h2>{viewer.title}</h2><p>{viewer.full || viewer.snippet}</p></div>}
                  <div className="ar-vmeta">
                    <div className="ar-vinfo">
                      <b>{viewer.title}</b>
                      {blogPosted ? <span className="ar-vok">Live on your blog ✓</span> : err ? <span className="ar-verr">{err}</span> : <span className={`ar-status s-${viewer.status.toLowerCase()}`}>{viewer.status === "PUBLISHED" ? "Live on your blog" : "Ready to publish"}</span>}
                    </div>
                    <div className="ar-vacts">
                      {viewer.status !== "PUBLISHED" && !blogPosted && <button type="button" className="ar-vpost" disabled={busy} onClick={() => publishBlog(viewer.id)}>{busy ? "Publishing…" : "Publish to my blog"}</button>}
                      <button type="button" className="ar-vdel" disabled={busy} onClick={() => deleteAsset(viewer.id)}>Delete</button>
                    </div>
                    <span className="ar-caphint">Publishes to your store's <b>Online Store → Blog posts</b> — built for Google SEO, not social feeds.</span>
                  </div>
                </>
              ) : viewer.video ? (
                <video className="ar-vfull" src={viewer.video} controls autoPlay playsInline />
              ) : viewer.image ? (
                <img className="ar-vfull" src={viewer.image} alt={viewer.title} />
              ) : (
                <div className="ar-read"><p>Still being made…</p></div>
              )}
              {viewer.kind !== "blog" && (
                <div className="ar-vmeta">
                  <div className="ar-vinfo">
                    <b>{viewer.title}</b>
                    {posted ? <span className="ar-vok">Posted to {posted} ✓</span> : err ? <span className="ar-verr">{err}</span> : <span className={`ar-status s-${viewer.status.toLowerCase()}`}>{viewer.status === "PUBLISHED" ? "Posted" : viewer.status === "APPROVED" ? "Kept" : "New"}</span>}
                    {!posted && !err && viewer.daysLeft != null && <span className={`ar-vcd${viewer.daysLeft <= 7 ? " warn" : ""}`}>⏳ Clears in {viewer.daysLeft} day{viewer.daysLeft === 1 ? "" : "s"} — hit <b>Keep</b> to save it</span>}
                    <span className="ar-aitag">✦ AI-generated — review before you post</span>
                  </div>
                  <div className="ar-vacts">
                    {linkedSocial.length > 0 && !capOpen && <button type="button" className="ar-vpost" disabled={busy} onClick={() => startPost(viewer.id)}>Post to socials</button>}
                    <button type="button" className="ar-vkeep" disabled={busy} onClick={() => keepAsset(viewer.id)}>Keep</button>
                    <button type="button" className="ar-vdel" disabled={busy} onClick={() => deleteAsset(viewer.id)}>Delete</button>
                  </div>
                  {capOpen && (
                    <div className="ar-cap">
                      <textarea className="ar-capbox" rows={5} value={caption} disabled={draftPending}
                        placeholder={draftPending ? "✨ Writing a caption for you…" : "Write your caption…"}
                        onChange={(e) => setCaption(e.target.value)} />
                      <div className="ar-caprow">
                        <button type="button" className="ar-vpost" disabled={busy || draftPending || !caption.trim()} onClick={() => doPost(viewer.id)}>{busy && !draftPending ? "Posting…" : "Post now"}</button>
                        <button type="button" className="ar-capcancel" disabled={busy} onClick={() => setCapOpen(false)}>Cancel</button>
                      </div>
                      <span className="ar-caphint">Posts to {linkedSocial.join(" · ")}. Tweak it or post as-is.</span>
                    </div>
                  )}
                  <div className="ar-vmore">
                    <button type="button" className={`ar-vtool${tool === "attach" ? " on" : ""}`} onClick={() => setTool(tool === "attach" ? null : "attach")}>🏷 Add to a product</button>
                    {paidAds && adPlatforms.length > 0 && <button type="button" className={`ar-vtool${tool === "boost" ? " on" : ""}`} onClick={() => setTool(tool === "boost" ? null : "boost")}>🚀 Boost</button>}
                  </div>
                  {attached && <div className="ar-vok">Added to {attached} ✓</div>}
                  {boosted && <div className="ar-vok">Boost launching on {boosted} ✓</div>}
                  {tool === "attach" && (
                    <div className="ar-tool">
                      <select value={attachId} onChange={(e) => setAttachId(e.target.value)}>
                        <option value="">Choose a product…</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                      </select>
                      <button type="button" className="ar-vpost" disabled={busy || !attachId} onClick={() => attach(viewer.id)}>{busy ? "Adding…" : "Add to product page"}</button>
                    </div>
                  )}
                  {tool === "boost" && (
                    <div className="ar-tool">
                      <select value={boostPlat} onChange={(e) => setBoostPlat(e.target.value)}>
                        <option value="">Ad account…</option>
                        {adPlatforms.map((p) => <option key={p} value={p}>{p === "META" ? "Meta (FB/IG)" : p}</option>)}
                      </select>
                      <label className="ar-budget">$<input type="number" min={1} max={500} value={boostBudget} onChange={(e) => setBoostBudget(e.target.value)} />/day</label>
                      <button type="button" className="ar-vpost" disabled={busy || !boostPlat} onClick={() => boost(viewer.id)}>{busy ? "Launching…" : `Boost · ${boostFee} tokens`}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
