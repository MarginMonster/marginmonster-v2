import { db } from "../db.server";

/* Blog publishing — the SEO half of the pipeline.
 *
 * A generated BLOG_POST asset holds finished HTML. This module pushes it live
 * to the store's Online Store blog (Admin GraphQL `articleCreate`), so the
 * "Get Found" plan is genuinely hands-off SEO: written by Claude, published to
 * the merchant's blog on schedule, ranking on Google.
 *
 * HONESTY RULE (mirrors social-post): a blog slot only becomes POSTED on a
 * confirmed articleCreate success. Any failure leaves the slot READY and logs.
 */

type PubResult = { ok: true; url?: string } | { ok: false; error: string };

function storeName(domain: string): string {
  const base = domain.replace(/\.myshopify\.com$/, "").replace(/[-_]+/g, " ").trim();
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : "Editorial";
}

/** Publish a generated blog asset to the store's Online Store blog. Finds the
 *  first existing blog (or creates a "News" blog), then creates a published
 *  article. Returns the live article URL on success. */
export async function publishBlogAsset(shopDomain: string, assetId: string): Promise<PubResult> {
  const asset = await db.asset.findUnique({ where: { id: assetId }, select: { type: true, title: true, bodyJson: true } });
  if (!asset || asset.type !== "BLOG_POST") return { ok: false, error: "not-a-blog" };

  let html = "";
  try {
    const b = JSON.parse(asset.bodyJson);
    html = b.html || b.body || "";
  } catch { /* fall through */ }
  if (!html.trim()) return { ok: false, error: "no-body" };

  // Pull a clean title: prefer the asset title, else the first <h1>.
  let title = (asset.title || "").trim();
  if (!title) {
    const m = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    title = (m ? m[1] : "").replace(/<[^>]+>/g, "").trim() || "New from our shop";
  }

  const { unauthenticated } = await import("./../shopify.server");
  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shopDomain));
  } catch (e) {
    return { ok: false, error: `admin-auth: ${e instanceof Error ? e.message : "failed"}` };
  }
  const gql = async (query: string, variables?: Record<string, unknown>) => {
    const res = await admin.graphql(query, variables ? { variables } : undefined);
    const j = (await res.json()) as { data?: any; errors?: unknown };
    if (j.errors) throw new Error("Shopify API: " + JSON.stringify(j.errors));
    return j.data;
  };

  try {
    // 1) find (or create) a blog to publish into
    const found = await gql(`{ blogs(first: 1) { edges { node { id handle } } } }`);
    let blogId: string | undefined = found?.blogs?.edges?.[0]?.node?.id;
    let blogHandle: string = found?.blogs?.edges?.[0]?.node?.handle || "news";
    if (!blogId) {
      const created = await gql(
        `mutation CreateBlog($blog: BlogCreateInput!) { blogCreate(blog: $blog) { blog { id handle } userErrors { field message } } }`,
        { blog: { title: "News" } }
      );
      const be = created?.blogCreate?.userErrors;
      if (be?.length) return { ok: false, error: "blog-create: " + be.map((x: any) => x.message).join("; ") };
      blogId = created?.blogCreate?.blog?.id;
      blogHandle = created?.blogCreate?.blog?.handle || "news";
      if (!blogId) return { ok: false, error: "blog-create-empty" };
    }

    // 2) create a published article
    const data = await gql(
      `mutation CreateArticle($article: ArticleCreateInput!) { articleCreate(article: $article) { article { handle } userErrors { field message } } }`,
      { article: { blogId, title: title.slice(0, 255), body: html, isPublished: true, author: { name: storeName(shopDomain) } } }
    );
    const errs = data?.articleCreate?.userErrors;
    if (errs?.length) return { ok: false, error: "article-create: " + errs.map((x: any) => x.message).join("; ") };
    const handle = data?.articleCreate?.article?.handle;
    const url = handle ? `https://${shopDomain}/blogs/${blogHandle}/${handle}` : undefined;

    try { await db.asset.update({ where: { id: assetId }, data: { status: "PUBLISHED" } }); } catch { /* non-fatal */ }
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "publish-failed" };
  }
}
