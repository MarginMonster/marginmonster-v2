import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Page } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { tokensRemaining } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";

/* SEO HUB — one front door for everything search: product listings, blog
 * posts, landing pages. Built in the GStyle money-engraved language to match
 * the landing page, plans and Content Studio. */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true },
  });
  if (!shop) return json({ ready: false, forged: 0, blogs: 0, pages: 0, tokens: 0, blogsLive: 0 });

  const [blogs, blogsLive, pages] = await Promise.all([
    db.asset.count({ where: { shopId: shop.id, type: "BLOG_POST" } }),
    db.asset.count({ where: { shopId: shop.id, type: "BLOG_POST", status: "PUBLISHED" } }),
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

const TOOLS = [
  {
    to: "/app/products",
    ico: "🛠",
    title: "Product listings",
    body: "Titles, descriptions, bullets and meta tags rewritten in your brand voice — SEO-weighted and pushed live to Shopify in one click.",
    cta: "Open listings",
  },
  {
    to: "/app/archive?tab=blog",
    ico: "📰",
    title: "Blog posts",
    body: "Articles targeting what your buyers actually search — written, scheduled and auto-published to your store. Traffic that keeps arriving after the month ends.",
    cta: "Open blog queue",
  },
  {
    to: "/app/funnels",
    ico: "🎯",
    title: "Landing pages",
    body: "Focused pages built to close one product or offer — headline, story, social proof and CTA generated from your catalog.",
    cta: "Open landing pages",
  },
] as const;

export default function SeoHub() {
  const { forged, blogs, blogsLive, pages, tokens } = useLoaderData<typeof loader>();

  const counts = [
    `${forged.toLocaleString()} created so far`,
    `${blogsLive} live of ${blogs}`,
    `${pages.toLocaleString()} published`,
  ];
  const costs = [`${TOKEN_COST.description} / listing`, `${TOKEN_COST.blog} / post`, `${TOKEN_COST.landing} / page`];

  return (
    <Page backAction={{ content: "Home", url: "/app" }}>
      <div className="sh">
        <div className="sh-hero">
          <span className="sh-eyebrow">SEO Hub</span>
          <h1>Search is a channel. <em>Own it.</em></h1>
          <p className="sh-sub">
            Ads stop the moment you stop paying — search compounds. Everything here
            builds ranking assets from your real catalog: listings that convert,
            articles that pull free traffic, landing pages that close.
          </p>
          <div className="sh-stats">
            <div className="sh-stat"><b>{forged.toLocaleString()}</b><span>Listings</span></div>
            <div className="sh-stat"><b>{blogs.toLocaleString()}<i>· {blogsLive} live</i></b><span>Blog posts</span></div>
            <div className="sh-stat"><b>{pages.toLocaleString()}</b><span>Landing pages</span></div>
            <div className="sh-stat"><b className="tok">{tokens.toLocaleString()}</b><span>Tokens left</span></div>
          </div>
        </div>

        <div className="sh-head">
          <h2>Three ways in</h2>
          <span>Every asset earns XP · cost shown per piece</span>
        </div>
        <div className="sh-tools">
          {TOOLS.map((t, i) => (
            <div className="sh-card" key={t.to}>
              <span className="sh-ico" aria-hidden>{t.ico}</span>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
              <div className="sh-meta">
                <span className="sh-count">{counts[i]}</span>
                <span className="sh-chip"><span className="sh-coin" />{costs[i]}</span>
              </div>
              <Link to={t.to} className="sh-cta go">{t.cta}</Link>
            </div>
          ))}
        </div>

        <div className="sh-auto">
          <span className="sh-auto-t">Runs itself</span>
          <div className="sh-auto-grid">
            <span>Treasure Hunt campaigns drip blogs + listings on a 30-day schedule</span>
            <span>Every piece is written from your live catalog — never generic</span>
            <span>Auto-published at the times Google rewards consistency</span>
            <span>Review-first or fully hands-off — your call, per campaign</span>
          </div>
        </div>
      </div>
    </Page>
  );
}
