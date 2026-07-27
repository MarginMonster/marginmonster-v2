/* Web Archive — finished pieces for web accounts. Media serves from the same
 * /renders route the embedded app uses. Download-first for now; social
 * auto-posting for web accounts rides the connect flow (next track). */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";

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
  return json({
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
      };
    }),
  });
};

export default function WebArchive() {
  const { assets, cooking } = useLoaderData<typeof loader>();
  return (
    <div>
      <h1 className="wb-h1">Archive</h1>
      <p className="wb-sub">
        Everything you&apos;ve made. Right-click any piece to save it.
        {cooking > 0 && <> · <b>{cooking} piece{cooking > 1 ? "s" : ""} still cooking</b> — refresh in a minute.</>}
      </p>
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
              <div className="s">{a.type === "VIDEO_AD" ? "Video" : a.type === "IMAGE_AD" ? "Image ad" : "Article"} · {new Date(a.when).toLocaleDateString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
