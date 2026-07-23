import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  DataTable,
  Box,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { getPerformanceSummary } from "../lib/performance.server";
import { paidAdsEnabled } from "../lib/feature-flags.server";
import { socialProviderEnabled, linkedFromCache } from "../lib/social-provider.server";
import type { PlatformStats } from "../lib/social-provider.server";
import { parseSocialStats, sumStats, refreshShopStats, SOCIAL_PLATFORMS } from "../lib/social-insights.server";
import { parseSchedule } from "../lib/questlines";

type RecentPost = { title: string; platform: string; url: string; date: string };
type Totals = ReturnType<typeof sumStats>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // ── Paid ROI path (gated on Marketing API approval) ──────────────────────
  if (paidAdsEnabled()) {
    const shop = await db.shop.findUnique({ where: { domain: session.shop } });
    if (!shop) return json({ mode: "paid" as const, summary: null });
    const summary = await getPerformanceSummary(shop.id);
    return json({ mode: "paid" as const, summary });
  }

  // ── Organic results path — followers + engagement from the socials ───────
  const emptyOrganic = () => json({
    mode: "organic" as const, socialOn: socialProviderEnabled(), linked: [] as string[],
    platforms: {} as Record<string, PlatformStats>, fetchedAt: null as string | null,
    totals: sumStats(parseSocialStats(null)), recent: [] as RecentPost[],
  });

  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    select: {
      id: true, socialProfileKey: true, socialsJson: true, socialStatsJson: true,
      questlines: { orderBy: { createdAt: "desc" }, take: 12, select: { name: true, scheduleJson: true } },
    },
  });
  if (!shop) return emptyOrganic();

  const linked = linkedFromCache(shop.socialsJson).filter((p) => (SOCIAL_PLATFORMS as readonly string[]).includes(p));
  let stats = parseSocialStats(shop.socialStatsJson);
  // First open with nothing cached yet → try one live pull so the page isn't empty.
  if (linked.length > 0 && !stats.fetchedAt) {
    stats = (await refreshShopStats(shop.id)) ?? stats;
  }

  // Recent posts feed — pulled from what auto-posting actually shipped.
  const recent: RecentPost[] = [];
  for (const q of shop.questlines) {
    const sched = parseSchedule(q.scheduleJson);
    for (const s of sched.slots) {
      if (s.status !== "POSTED" || !s.postedUrls) continue;
      for (const [platform, url] of Object.entries(s.postedUrls)) {
        if (url) recent.push({ title: s.productTitle || q.name, platform, url, date: s.date });
      }
    }
  }
  recent.sort((a, b) => (a.date < b.date ? 1 : -1));

  return json({
    mode: "organic" as const,
    socialOn: socialProviderEnabled(),
    linked,
    platforms: stats.platforms,
    fetchedAt: stats.fetchedAt,
    totals: sumStats(stats),
    recent: recent.slice(0, 8),
  });
};

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nfmt = (n: number) => n.toLocaleString();

// ── platform glyphs (brand-colored on white chips) ─────────────────────────
const GTikTok = () => <svg viewBox="0 0 24 24"><path d="M16.5 3c.35 2.34 1.68 3.9 3.9 4.12v2.86c-1.3.08-2.53-.28-3.68-.98v5.9c0 3.5-2.48 6-5.86 6C7.6 20.9 5.3 18.7 5.3 15.6c0-3.02 2.4-5.3 5.5-5.3.34 0 .67.03 1 .09v2.94c-.32-.1-.65-.15-1-.15-1.42 0-2.5 1.05-2.5 2.44 0 1.42 1.1 2.46 2.55 2.46 1.53 0 2.6-1.13 2.6-2.98V3h3.05z" fill="#010101" /></svg>;
const GInsta = () => <svg viewBox="0 0 24 24" fill="none" stroke="#E1306C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" /><circle cx="12" cy="12" r="4.1" /><circle cx="17.4" cy="6.6" r="1.15" fill="#E1306C" stroke="none" /></svg>;
const GFacebook = () => <svg viewBox="0 0 24 24"><path d="M13.8 21v-8h2.6l.42-3.1h-3.02V7.9c0-.9.26-1.5 1.56-1.5h1.66V3.62c-.29-.04-1.27-.12-2.42-.12-2.4 0-4.04 1.46-4.04 4.15V9.9H8.1v3.1h2.44V21h3.26z" fill="#1877F2" /></svg>;

const PLAT: Record<string, { label: string; Glyph: () => JSX.Element }> = {
  tiktok: { label: "TikTok", Glyph: GTikTok },
  instagram: { label: "Instagram", Glyph: GInsta },
  facebook: { label: "Facebook", Glyph: GFacebook },
};
const platMeta = (p: string) => PLAT[p] || { label: p, Glyph: GFacebook };

function relDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Results() {
  const data = useLoaderData<typeof loader>();
  if (data.mode === "paid") return <PaidROI summary={data.summary} />;
  return (
    <Organic
      socialOn={data.socialOn}
      linked={data.linked}
      platforms={data.platforms}
      fetchedAt={data.fetchedAt}
      totals={data.totals}
      recent={data.recent}
    />
  );
}

// ═══ Organic engagement dashboard ═══════════════════════════════════════════
function Organic({ socialOn, linked, platforms, fetchedAt, totals, recent }: {
  socialOn: boolean;
  linked: string[];
  platforms: Record<string, PlatformStats>;
  fetchedAt: string | null;
  totals: Totals;
  recent: RecentPost[];
}) {
  const platformKeys = Object.keys(platforms);
  const hasStats = platformKeys.length > 0 && totals.followers + totals.views + totals.likes > 0;
  const engagement = totals.likes + totals.comments + totals.shares;

  return (
    <Page title="Results" backAction={{ content: "Home", url: "/app" }}>
      <div className="er">
        <span className="er-ey">Your socials</span>
        <h1 className="er-h1">Reach &amp; engagement</h1>
        <p className="er-sub">Followers, views and engagement across every account EasyMode posts to — refreshed automatically.</p>

        {!socialOn ? (
          <div className="er-note">
            <b>Engagement tracking is switching on</b>
            <p>The moment your store's socials are connected, your followers, views, likes and comments show up here — pulled straight from each platform.</p>
          </div>
        ) : linked.length === 0 ? (
          <div className="er-note">
            <b>Connect your socials to see results</b>
            <p>Link TikTok, Instagram and Facebook and EasyMode starts tracking your reach and engagement automatically — one tap, no passwords shared with us.</p>
            <a className="er-cta" href="/app/connect">Connect socials</a>
          </div>
        ) : !hasStats ? (
          <div className="er-note">
            <b>Warming up your numbers</b>
            <p>You're connected on {linked.map((p) => platMeta(p).label).join(", ")}. We pull fresh follower and engagement counts every hour — check back shortly.</p>
          </div>
        ) : (
          <>
            <div className="er-tot">
              <div className="c"><div className="n">{nfmt(totals.followers)}</div><div className="k">Followers</div></div>
              <div className="c"><div className="n">{nfmt(totals.views || totals.reach)}</div><div className="k">Views</div></div>
              <div className="c"><div className="n">{nfmt(engagement)}</div><div className="k">Engagements</div></div>
            </div>

            <div className="er-plats">
              {platformKeys.map((p) => {
                const m = platMeta(p);
                const s = platforms[p];
                return (
                  <div className="er-plat" key={p}>
                    <div className="hd"><span className="chip"><m.Glyph /></span><b>{m.label}</b><span className="fol">{nfmt(s.followers)} followers</span></div>
                    <div className="mets">
                      <div className="mt"><div className="n">{nfmt(s.views || s.reach)}</div><div className="k">Views</div></div>
                      <div className="mt"><div className="n">{nfmt(s.likes)}</div><div className="k">Likes</div></div>
                      <div className="mt"><div className="n">{nfmt(s.comments)}</div><div className="k">Comments</div></div>
                      <div className="mt"><div className="n">{nfmt(s.shares)}</div><div className="k">Shares</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
            {fetchedAt && (
              <p className="er-stamp">Updated {new Date(fetchedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
            )}
          </>
        )}

        {recent.length > 0 && (
          <>
            <div className="er-sec"><h2>Recently posted</h2></div>
            <div className="er-feed">
              {recent.map((r, i) => {
                const m = platMeta(r.platform);
                return (
                  <a className="er-item" href={r.url} target="_blank" rel="noreferrer" key={`${r.url}-${i}`}>
                    <span className="chip"><m.Glyph /></span>
                    <span className="m"><b>{r.title}</b><span>{m.label} · {relDate(r.date)}</span></span>
                    <span className="go">View</span>
                  </a>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}

// ═══ Paid ROI dashboard (unchanged behavior) ════════════════════════════════
function PaidROI({ summary }: { summary: Awaited<ReturnType<typeof getPerformanceSummary>> | null }) {
  if (!summary || !summary.hasData) {
    return (
      <Page title="Performance & ROI" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState heading="No campaign data yet" image="">
          <p>Launch a paid campaign and this fills with real ad spend, revenue, ROI, traffic sources, and conversions — all in one place.</p>
        </EmptyState>
      </Page>
    );
  }

  const { totals, roi, roas, byPlatform, campaigns } = summary;
  const platformRows = byPlatform.map((p) => [p.platform, money(p.spendCents), money(p.revenueCents), `${p.roas.toFixed(2)}x`, p.clicks.toLocaleString(), p.conversions.toLocaleString()]);
  const campaignRows = campaigns.map((c) => [c.name, c.platform, c.status, money(c.spendCents), money(c.revenueCents), `${c.roas.toFixed(2)}x`, `${c.roi >= 0 ? "+" : ""}${c.roi.toFixed(0)}%`, c.conversions.toLocaleString()]);

  return (
    <Page title="Performance & ROI" backAction={{ content: "Home", url: "/app" }} subtitle="Every dollar in, every dollar out — ad spend, revenue, ROI, traffic, and conversions.">
      <Layout>
        <Layout.Section>
          <div className="mm-score"><span className="lbl">HI-SCORE · ROI</span><span className="val">{`${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`}</span></div>
        </Layout.Section>
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <Kpi label="Ad spend" value={money(totals.spendCents)} sub="total invested" />
            <Kpi label="Revenue" value={money(totals.revenueCents)} sub="attributed to ads" tone="green" />
            <Kpi label="ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(0)}%`} sub="return on ad spend" tone={roi >= 0 ? "green" : "red"} />
            <Kpi label="ROAS" value={`${roas.toFixed(2)}x`} sub="revenue per $1 spent" />
            <Kpi label="Conversions" value={totals.conversions.toLocaleString()} sub="purchases from ads" />
            <Kpi label="Traffic" value={totals.clicks.toLocaleString()} sub="clicks to your store" />
          </InlineStack>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Traffic sources</Text>
              <Text variant="bodyMd" as="p" tone="subdued">Where your visitors and sales are coming from.</Text>
              <DataTable columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric"]} headings={["Source", "Spend", "Revenue", "ROAS", "Clicks", "Conversions"]} rows={platformRows} />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Campaign performance</Text>
              <DataTable columnContentTypes={["text", "text", "text", "numeric", "numeric", "numeric", "numeric", "numeric"]} headings={["Campaign", "Source", "Status", "Spend", "Revenue", "ROAS", "ROI", "Conv."]} rows={campaignRows} />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? "var(--mm-green, #4B7B4E)" : tone === "red" ? "var(--mm-red, #B3473B)" : "var(--mm-gold-deep, #A87D1E)";
  return (
    <Box minWidth="150px">
      <Card>
        <BlockStack gap="100">
          <Text variant="headingSm" as="h3" tone="subdued">{label}</Text>
          <div style={{ fontFamily: "Poppins, sans-serif", fontSize: 26, fontWeight: 800, color }}>{value}</div>
          <Text variant="bodySm" as="p" tone="subdued">{sub}</Text>
        </BlockStack>
      </Card>
    </Box>
  );
}
