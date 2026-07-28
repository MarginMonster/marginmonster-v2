/* Web Archive — finished pieces for web accounts. Media serves from the same
 * /renders route the embedded app uses. Download-first for now; social
 * auto-posting for web accounts rides the connect flow (next track). */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { linkedFromCache, publishPost, socialProviderEnabled } from "../lib/social-provider.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const assets = await db.asset.findMany({
    where: { shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD", "BLOG_POST"] } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const jobs = await db.job.findMany({
    where: { shopId: shop.id, status: { in: ["PENDING", "IN_PROGRESS"] }, type: { in: ["GENERATE_VIDEO_AD", "GENERATE_IMAGE_AD", "GENERATE_BLOG_POST"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const linked = linkedFromCache(shop.socialsJson).filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
  return json({
    canPost: socialProviderEnabled() && linked.length > 0,
    linkedCount: linked.length,
    cooking: jobs.length,
    assets: assets.map((a) => {
      let body: { videoUrl?: string; imageUrl?: string; title?: string } = {};
      try { body = JSON.parse(a.bodyJson || "{}"); } catch { /* ignore */ }
      return {
        id: a.id,
        type: a.type,
        title: a.title || body.title || "Untitled",
        media: body.videoUrl || body.imageUrl || null,
        when: a.createdAt,
        posted: a.status === "PUBLISHED",
      };
    }),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  if (form.get("intent") !== "post") return json({});
  if (!socialProviderEnabled()) return json({ error: "Social posting is coming online — check back shortly." });
  if (!shop.socialProfileKey) return json({ error: "Link your socials first on the Auto-posting page." });
  const platforms = linkedFromCache(shop.socialsJson).filter((p) => ["tiktok", "instagram", "facebook"].includes(p));
  if (platforms.length === 0) return json({ error: "Link your socials first on the Auto-posting page." });

  const id = (form.get("assetId") as string) || "";
  const asset = await db.asset.findFirst({ where: { id, shopId: shop.id, type: { in: ["VIDEO_AD", "IMAGE_AD"] } } });
  if (!asset) return json({ error: "That piece is gone — refresh and try again." });
  let body: { videoUrl?: string; imageUrl?: string } = {};
  try { body = JSON.parse(asset.bodyJson || "{}"); } catch { /* ignore */ }
  const media = body.videoUrl || body.imageUrl;
  if (!media) return json({ error: "This piece has no media to post." });
  const isVideo = asset.type === "VIDEO_AD";
  const base = new URL(request.url).origin;
  const mediaUrl = /^https?:\/\//.test(media) ? media : `${base}${media}`;

  // AI caption per platform (cached on the asset) + the #EasyModeAi tag —
  // buildPostTitle guarantees the disclosure on every post.
  const { getOrMakeCaptions, buildPostTitle, fallbackCaption } = await import("../lib/social-caption.server");
  const captions = await getOrMakeCaptions(id, shop.id, { productTitle: asset.title || "New drop", isVideo, platforms });
  const fbText = fallbackCaption({ productTitle: asset.title || "New drop", isVideo, platforms }).text;

  let anyOk = false;
  let lastErr: string | undefined;
  for (const p of platforms) {
    const r = await publishPost(shop.socialProfileKey, { title: buildPostTitle(captions[p], "", fbText), mediaUrl, isVideo, platforms: [p] });
    if (r.ok) anyOk = true;
    else lastErr = r.error;
  }
  if (!anyOk) return json({ error: `Posting failed (${lastErr || "unknown"}) — check your linked accounts.` });
  await db.asset.update({ where: { id }, data: { status: "PUBLISHED" } });
  return json({ ok: `Posted to ${platforms.length} account${platforms.length > 1 ? "s" : ""} 🎉` });
};

export default function WebArchive() {
  const { assets, cooking, canPost, linkedCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const err = actionData && "error" in actionData ? (actionData.error as string) : null;
  const ok = actionData && "ok" in actionData ? (actionData.ok as string) : null;
  return (
    <div>
      <h1 className="wb-h1">Archive</h1>
      <p className="wb-sub">
        Everything you&apos;ve made. Right-click any piece to save it{canPost ? `, or post it to your ${linkedCount} linked account${linkedCount > 1 ? "s" : ""} in one tap` : ""}.
        {cooking > 0 && <> · <b>{cooking} piece{cooking > 1 ? "s" : ""} still cooking</b> — refresh in a minute.</>}
      </p>
      {!canPost && <p className="wb-note" style={{ marginTop: -14, marginBottom: 18 }}>Want one-tap posting? <Link to="/web/connect">Link your socials</Link>.</p>}
      {err && <div className="wb-err">{err}</div>}
      {ok && <div className="wb-ok">{ok}</div>}
      {assets.length === 0 && cooking === 0 && (
        <div className="wb-card">Nothing here yet — make your first piece in the <Link to="/web/studio">Studio</Link>.</div>
      )}
      <div className="wb-assets">
        {assets.map((a) => (
          <div className="wb-asset" key={a.id}>
            {a.type === "VIDEO_AD" && a.media && <video src={a.media} controls playsInline preload="metadata" />}
            {a.type === "IMAGE_AD" && a.media && <img src={a.media} alt={a.title} loading="lazy" />}
            {a.type === "BLOG_POST" && <div style={{ padding: "60px 16px", textAlign: "center", fontSize: 34 }}>✍️</div>}
            <div className="m">
              {a.title}
              <div className="s">{a.type === "VIDEO_AD" ? "Video" : a.type === "IMAGE_AD" ? "Image ad" : "Article"} · {new Date(a.when).toLocaleDateString()}{a.posted ? " · posted ✓" : ""}</div>
              {canPost && a.type !== "BLOG_POST" && a.media && !a.posted && (
                <Form method="post" style={{ marginTop: 8 }}>
                  <input type="hidden" name="intent" value="post" />
                  <input type="hidden" name="assetId" value={a.id} />
                  <button className="wb-btn" style={{ padding: "8px 16px", fontSize: 12.5 }} disabled={busy}>
                    {busy ? "Posting…" : "Post to socials →"}
                  </button>
                </Form>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
