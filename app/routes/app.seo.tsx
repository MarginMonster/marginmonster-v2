import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Page, Layout } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { tokensRemaining } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";

/* SEO HUB — one front door for everything search: product listings, blog
 * posts, landing pages. First section built in the PREMIUM PLAY language
 * (Direction B pilot): game mechanics kept, arcade costume retired. */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  if (!shop) return json({ ready: false, forged: 0, blogs: 0, pages: 0, tokens: 0, blogsLive: 0 });

  const [blogs, blogsLive, pages] = await Promise.all([
    db.asset.count({ where: { shopId: shop.id, type: "BLOG_POST" } }),
    db.asset.count({ where: { shopId: shop.id, type: "BLOG_POST", status: "APPROVED" } }),
    db.landingPage.count({ where: { shopId: shop.id } }),
  ]);

  return json({
    ready: !!shop.activePlan,
    forged: shop.forgedCount,
    blogs,
    blogsLive,
    pages,
    tokens: shop.activePlan ? tokensRemaining(shop.activePlan) : 0,
  });
};

export default function SeoHub() {
  const { forged, blogs, blogsLive, pages, tokens } = useLoaderData<typeof loader>();

  return (
    <Page title="SEO Hub" backAction={{ content: "Home", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <div className="pp-hero">
            <span className="pp-eyebrow">SEO Hub</span>
            <h1>Search is a channel. <em>Own it.</em></h1>
            <p className="pp-sub">
              Ads stop the moment you stop paying — search compounds. Everything here
              builds ranking assets from your real catalog: listings that convert,
              articles that pull free traffic, landing pages that close it.
            </p>
            <div className="pp-stats">
              <div className="pp-stat"><div className="v">{forged.toLocaleString()}</div><div className="l">Listings forged</div></div>
              <div className="pp-stat"><div className="v">{blogs.toLocaleString()} <span className="g">· {blogsLive} live</span></div><div className="l">Blog posts</div></div>
              <div className="pp-stat"><div className="v">{pages.toLocaleString()}</div><div className="l">Landing pages</div></div>
              <div className="pp-stat"><div className="v"><span className="g">{tokens.toLocaleString()}</span></div><div className="l">Tokens banked</div></div>
            </div>
          </div>
        </Layout.Section>

        <Layout.Section>
          <div className="pp-head">
            <h2>Three ways in</h2>
            <span className="pp-sub2">Every asset earns XP · costs shown per piece</span>
          </div>
          <div className="pp-tools">
            <Link to="/app/products" className="pp-tool">
              <span className="ico">🛠</span>
              <h3>Product listings</h3>
              <p>
                Titles, descriptions, bullets and meta tags rewritten in your brand
                voice — SEO-weighted and pushed live to Shopify in one click.
              </p>
              <div className="pp-meta">
                <span className="pp-count">{forged.toLocaleString()} <span>forged so far</span></span>
                <span className="pp-chip"><span className="pp-coin" />{TOKEN_COST.description} / listing</span>
              </div>
              <span className="pp-cta">Open listings</span>
            </Link>

            <Link to="/app/assets" className="pp-tool">
              <span className="ico">📰</span>
              <h3>Blog posts</h3>
              <p>
                Articles targeting what your buyers actually search — written,
                scheduled and auto-published to your store. Traffic that keeps
                arriving after the month ends.
              </p>
              <div className="pp-meta">
                <span className="pp-count">{blogsLive} <span>live of {blogs}</span></span>
                <span className="pp-chip"><span className="pp-coin" />{TOKEN_COST.blog} / post</span>
              </div>
              <span className="pp-cta">Open blog queue</span>
            </Link>

            <Link to="/app/funnels" className="pp-tool">
              <span className="ico">🎯</span>
              <h3>Landing pages</h3>
              <p>
                Focused pages built to close one product or offer — headline,
                story, social proof and CTA generated from your catalog.
              </p>
              <div className="pp-meta">
                <span className="pp-count">{pages.toLocaleString()} <span>published</span></span>
                <span className="pp-chip"><span className="pp-coin" />{TOKEN_COST.landing} / page</span>
              </div>
              <span className="pp-cta">Open landing pages</span>
            </Link>
          </div>
        </Layout.Section>

        <Layout.Section>
          <div className="pp-auto">
            <div className="t">Runs itself</div>
            <div className="pp-auto-grid">
              <span>TREASURE HUNT campaigns drip blogs + listings on a 30-day schedule</span>
              <span>Every piece is written from your live catalog — never generic</span>
              <span>Auto-published at the times Google rewards consistency</span>
              <span>Review-first or fully hands-off — your call, per campaign</span>
            </div>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
