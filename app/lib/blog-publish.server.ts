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
  const asset = await db.asset.findUnique({
    where: { id: assetId },
    select: { type: true, title: true, bodyJson: true, status: true, metaJson: true },
  });
  if (!asset || asset.type !== "BLOG_POST") return { ok: false, error: "not-a-blog" };

  // ALREADY LIVE? DO NOT WRITE A SECOND ARTICLE.
  //
  // Creating a Shopify article is not idempotent, and the caller marks the
  // slot POSTED only after this returns. If that mark fails to save — a
  // transient database error, a restart — the next scan finds the slot still
  // READY and calls this again, and the merchant's blog collects the same
  // article every five minutes until something breaks the loop.
  if (asset.status === "PUBLISHED") {
    let prior = "";
    try { prior = (JSON.parse(asset.metaJson || "{}") as { blogUrl?: string }).blogUrl || ""; } catch { /* ignore */ }
    return { ok: true, url: prior || undefined };
  }

  let html = "";
  try {
    const b = JSON.parse(asset.bodyJson);
    html = b.html || b.body || "";
  } catch { /* fall through */ }
  if (!html.trim()) return { ok: false, error: "no-body" };

  // Self-marketing byline — added only on the PUBLIC store blog (not the in-app
  // viewer). These posts get indexed by Google; readers who find them are often
  // other store owners, so a subtle tracked credit turns organic blog traffic
  // into EasyMode discovery. Honest (it IS made with EasyMode) and unobtrusive.
  const listing = process.env.SHOPIFY_APP_LISTING_URL || "https://apps.shopify.com";
  const bylineUrl = `${listing}${listing.includes("?") ? "&" : "?"}utm_source=merchant_blog&utm_medium=written_with_byline&utm_campaign=self_marketing`;
  if (!/written with .*easymode/i.test(html)) {
    html += `\n<p style="margin-top:28px;padding-top:14px;border-top:1px solid #eee;font-size:13px;color:#9a9d92;">✨ Written with <a href="${bylineUrl}" rel="nofollow noopener" style="color:#0C7A46;font-weight:700;text-decoration:none;">EasyMode</a> — AI content &amp; auto-posting for Shopify.</p>`;
  }

  // Prefer the article's OWN headline — that is the SEO-written one, and it is
  // what the reader sees at the top of the page. The asset title is the bare
  // product name, set at generation time, and it is never empty, so preferring
  // it meant the <h1> branch below was dead and every published article was
  // titled with the product name — identical for two posts about one product.
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const headline = (h1 ? h1[1] : "").replace(/<[^>]+>/g, "").trim();
  const title = headline || (asset.title || "").trim() || "New from our shop";

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

    // Record the live URL with the status, so the short-circuit above can hand
    // it back instead of publishing again.
    try {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(asset.metaJson || "{}"); } catch { /* fresh */ }
      await db.asset.update({
        where: { id: assetId },
        data: { status: "PUBLISHED", metaJson: JSON.stringify({ ...meta, blogUrl: url || null, blogPublishedAt: new Date().toISOString() }) },
      });
    } catch { /* non-fatal */ }
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "publish-failed" };
  }
}
