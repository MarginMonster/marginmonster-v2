import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, Link } from "@remix-run/react";
import { useEffect } from "react";
import { Page, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { generateBrandProfile } from "../lib/brand-voice.server";
import { unlockAchievement } from "../lib/xp.server";
import { paidAdsEnabled } from "../lib/feature-flags.server";
import { socialProviderEnabled } from "../lib/social-provider.server";

type BrandResults = {
  tone: string; tagline: string; positioning: string; imageStyle: string;
  storeName: string; productCount: number; avgPrice: number;
  vocabulary: string[]; values: string[]; samplePhrases: string[];
  contentThemes: string[]; categories: string[]; productImages: string[];
};

function parseBrand(bp: { voiceJson: string; visualJson: string; productJson: string } | null): BrandResults | null {
  if (!bp) return null;
  const j = (s: string): Record<string, unknown> => { try { const v = JSON.parse(s); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
  const v = j(bp.voiceJson), vis = j(bp.visualJson), pr = j(bp.productJson);
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const arr = (x: unknown, n = 8): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string" && !!y.trim()).slice(0, n) : []);
  const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" ? parseFloat(x) || 0 : 0);
  return {
    tone: str(v.tone), tagline: str(v.tagline), positioning: str(pr.positioning), imageStyle: str(vis.imageStyle),
    storeName: str(pr.storeName), productCount: typeof pr.productCount === "number" ? pr.productCount : 0, avgPrice: num(pr.avgPrice),
    vocabulary: arr(v.vocabulary), values: arr(v.values, 4), samplePhrases: arr(v.samplePhrases, 3),
    contentThemes: arr(vis.contentThemes), categories: arr(pr.categories, 6),
    productImages: Array.isArray(vis.productImages) ? vis.productImages.filter((u): u is string => typeof u === "string").slice(0, 6) : [],
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: {
      brandProfile: true,
      activePlan: true,
      assets: { orderBy: { createdAt: "desc" }, take: 12 },
      questlines: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 1 },
      jobs: { where: { type: "GENERATE_BRAND_PROFILE" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const pendingAssets = shop?.assets.filter((a) => a.status === "PENDING").length ?? 0;
  const brandJob = shop?.jobs[0] || null;

  // Reviews engine: ask for an App Store review exactly once, right after the
  // first real WIN — something the merchant published live (a blog on their
  // store or a post to socials both land as PUBLISHED). Peak-delight moment.
  let askReview = false;
  if (shop && !shop.reviewAskedAt) {
    const wins = await db.asset.count({ where: { shopId: shop.id, status: "PUBLISHED" } });
    askReview = wins > 0;
  }

  return json({
    shop,
    pendingAssets,
    askReview,
    brand: parseBrand(shop?.brandProfile ?? null),
    brandJobError: brandJob?.lastError ?? null,
    paidAds: paidAdsEnabled(),
    socialOn: socialProviderEnabled(),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ error: "Shop not found" });

  const graphql = async (query: string) => {
    let res: Response;
    try {
      res = await admin.graphql(query);
    } catch (thrown) {
      if (thrown instanceof Response) {
        const body = await thrown.text().catch(() => "");
        throw new Error(`Shopify ${thrown.status}: ${body.slice(0, 400) || "(no body)"}`);
      }
      throw thrown;
    }
    const bodyText = await res.text();
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${bodyText.slice(0, 400)}`);
    const jsonRes = JSON.parse(bodyText);
    if (jsonRes.errors) throw new Error("Shopify GraphQL: " + JSON.stringify(jsonRes.errors).slice(0, 400));
    return jsonRes.data;
  };

  const form = await request.formData().catch(() => null);
  if (form?.get("intent") === "reviewAsked") {
    // Fired once the App Store review prompt has been shown — never ask again.
    await db.shop.update({ where: { id: shop.id }, data: { reviewAskedAt: new Date() } });
    return json({ ok: true });
  }

  try {
    await generateBrandProfile(shop.id, graphql);
    await unlockAchievement(shop.id, "SCANNER");
    // Capture the store's own contact email (for the monthly digest) — the
    // shop's own address, not customer data. Non-fatal if scopes block it.
    try {
      const d = await graphql(`{ shop { email } }`);
      const email = (d as { shop?: { email?: string } })?.shop?.email;
      if (email) await db.shop.update({ where: { id: shop.id }, data: { contactEmail: email } });
    } catch { /* email capture non-fatal */ }
    // If a plan is already active, forge their first content right now (TTFV).
    const { kickstartFirstContent } = await import("../lib/onboarding.server");
    await kickstartFirstContent(shop.id, graphql);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
};

// ── refined line-icons (no emoji) ──────────────────────────────────────────
const ISend = () => <svg viewBox="0 0 24 24"><path d="M22 2 L11 13" /><path d="M22 2 L15 22 L11 13 L2 9 Z" /></svg>;
const IPen = () => <svg viewBox="0 0 24 24"><path d="M14 4 l6 6 -11 11 -6 0 0 -6 z" /><path d="M13 5 l6 6" /></svg>;
const IChart = () => <svg viewBox="0 0 24 24"><path d="M4 4 L4 20 L20 20" /><path d="M7 15 L11 10 L14 12 L19 6" /><circle cx="19" cy="6" r="1.3" fill="currentColor" stroke="none" /></svg>;
const IChev = () => <svg viewBox="0 0 10 16"><path d="M2 2 L8 8 L2 14" /></svg>;

// ── real social glyphs (rendered on white chips, brand-colored via CSS) ─────
const ITikTok = () => <svg viewBox="0 0 24 24"><path d="M16.5 3c.35 2.34 1.68 3.9 3.9 4.12v2.86c-1.3.08-2.53-.28-3.68-.98v5.9c0 3.5-2.48 6-5.86 6C7.6 20.9 5.3 18.7 5.3 15.6c0-3.02 2.4-5.3 5.5-5.3.34 0 .67.03 1 .09v2.94c-.32-.1-.65-.15-1-.15-1.42 0-2.5 1.05-2.5 2.44 0 1.42 1.1 2.46 2.55 2.46 1.53 0 2.6-1.13 2.6-2.98V3h3.05z" /></svg>;
const IInsta = () => <svg viewBox="0 0 24 24"><rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" /><circle cx="12" cy="12" r="4.1" /><circle className="d" cx="17.4" cy="6.6" r="1.15" /></svg>;
const IFacebook = () => <svg viewBox="0 0 24 24"><path d="M13.8 21v-8h2.6l.42-3.1h-3.02V7.9c0-.9.26-1.5 1.56-1.5h1.66V3.62c-.29-.04-1.27-.12-2.42-.12-2.4 0-4.04 1.46-4.04 4.15V9.9H8.1v3.1h2.44V21h3.26z" /></svg>;

function friendlyError(msg: string): string {
  if (/403|forbidden/i.test(msg)) return "Shopify briefly blocked the scan (403). This is usually a temporary permissions hiccup — try Re-scan again in a moment. If it keeps happening, close and reopen EasyMode from your Shopify admin to refresh access.";
  if (/401|unauthor/i.test(msg)) return "Your Shopify session expired. Reopen EasyMode from your Shopify admin, then try again.";
  return msg;
}

export default function Dashboard() {
  const { shop, pendingAssets, askReview, brand, brandJobError, paidAds } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const building = nav.state !== "idle";

  // Reviews engine: at the first real win, ask Shopify to show its native App
  // Store review prompt (App Bridge injects window.shopify). We mark it asked
  // regardless of outcome so the merchant is never nagged twice.
  useEffect(() => {
    if (!askReview) return;
    let done = false;
    const fire = async () => {
      if (done) return; done = true;
      try { await (window as unknown as { shopify?: { reviews?: { request: () => Promise<unknown> } } }).shopify?.reviews?.request(); }
      catch { /* prompt ineligible or dismissed — fine */ }
      submit({ intent: "reviewAsked" }, { method: "post" });
    };
    // small delay so it lands after the page settles, not mid-navigation
    const t = setTimeout(fire, 1500);
    return () => clearTimeout(t);
  }, [askReview, submit]);
  // A re-scan the user JUST triggered failed (live, actionable).
  const actionError = actionData && "error" in actionData ? actionData.error : null;
  // Onboarding also surfaces the last stored job error (there's no profile yet).
  const liveError = actionError || brandJobError;
  const buildProfile = () => submit({}, { method: "post" });

  if (!shop) {
    return (
      <Page>
        <div className="eh"><p className="eh-sub">Connecting your store… refresh in a moment.</p></div>
      </Page>
    );
  }

  const hasPlan = !!shop.activePlan;
  const hasProfile = !!shop.brandProfile;
  // "Autopilot" is on only when a content campaign (questline) is actively running.
  const hasActiveCampaign = shop.questlines.length > 0;

  const assets = shop.assets;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const made = assets.filter((a) => new Date(a.createdAt).getTime() >= weekAgo).length;
  const posted = assets.filter((a) => a.status === "PUBLISHED").length;
  const scheduled = assets.filter((a) => a.status === "APPROVED").length;
  const toReview = pendingAssets;

  const campaignHref = hasPlan ? "/app/campaigns" : "/app/plans";
  const big = hasActiveCampaign
    ? made > 0
      ? `This week it made ${made} ${made === 1 ? "piece" : "pieces"}${posted > 0 ? ` and posted ${posted} for you` : ""}.`
      : "Your engine is warming up — your first content is on the way."
    : hasPlan
      ? "No campaign is running yet. Start one and I'll fill your calendar automatically."
      : "Choose a plan and I'll start making content for your store, automatically.";

  return (
    <Page>
      <div className="eh">

        {!hasProfile && (
          <div className="eh-analyze">
            <b>Let's get to know your store</b>
            <p>We'll learn your brand voice and products so everything we make sounds and looks like you. Takes about a minute.</p>
            {liveError && (
              <div style={{ marginBottom: 12 }}>
                <Banner tone="warning" title="Last attempt hit a snag"><p>{friendlyError(liveError)}</p></Banner>
              </div>
            )}
            <button type="button" onClick={buildProfile} disabled={building}>
              {building ? "Analyzing your store…" : "Analyze my store"}
            </button>
          </div>
        )}

        <h1>Your store, on <span className="eh-em">EasyMode</span>.</h1>
        <p className="eh-sub">It makes videos, images and posts from your products — then posts them to your socials on a schedule. You approve, it ships.</p>

        <div className={`eh-status${hasActiveCampaign ? "" : " idle"}`}>
          <div className="lab"><span className="dot" />{hasActiveCampaign ? "Autopilot running" : "Autopilot not running"}</div>
          <div className="big">{big}</div>
          {hasActiveCampaign ? (
            <div className="row">
              <div className="st"><div className="n">{posted}</div><div className="k">Posted</div></div>
              <div className="st"><div className="n">{scheduled}</div><div className="k">Scheduled</div></div>
              <div className="st"><div className="n">{toReview}</div><div className="k">To review</div></div>
            </div>
          ) : (
            <Link className="eh-start" to={campaignHref}>
              {hasPlan ? "Start a campaign" : "Choose a plan to start"}<IChev />
            </Link>
          )}
          {toReview > 0 && (
            <Link className="eh-review" to="/app/archive">
              <span className="rv-n">{toReview}</span>
              {toReview === 1 ? "new piece in your Archive" : "new pieces in your Archive"}
              <IChev />
            </Link>
          )}
        </div>

        <div className="eh-acts">
          <Link className="eh-btn primary" to={campaignHref}>
            <div className="hd"><span className="ic"><ISend /></span><span className="ti">Automated Marketing</span></div>
            <p className="ds">{hasPlan ? "Pick a goal — we create and run a full month of content, start to finish." : "Choose a plan to switch on hands-free marketing."}</p>
            <div className="eh-social">
              <span className="lbl">Auto-posts to</span>
              <span className="chip tt" title="TikTok"><ITikTok /></span>
              <span className="chip ig" title="Instagram"><IInsta /></span>
              <span className="chip fb" title="Facebook"><IFacebook /></span>
            </div>
            <span className="eh-cta">{hasPlan ? "View or launch a campaign" : "Choose a plan to start"}<IChev /></span>
          </Link>
          <div className="eh-acts2">
            <Link className="eh-btn sm" to="/app/studio">
              <div className="hd"><span className="ic"><IPen /></span><span className="ti">Content Studio</span></div>
              <p className="ds">Make one piece by hand, in your voice.</p>
            </Link>
            <Link className="eh-btn sm" to="/app/performance">
              <div className="hd"><span className="ic"><IChart /></span><span className="ti">Results</span></div>
              <p className="ds">{paidAds ? "Ad spend, revenue and ROI." : "Followers, views and engagement."}</p>
            </Link>
          </div>
        </div>

        {hasProfile && brand && (
          <>
            <div className="eh-sec"><h2>Brand analyzer</h2></div>

            {/* the analyzer ribbon — moved down here from the top */}
            <div className="eh-analyze done">
              <span className="ck" aria-hidden="true">✓</span>
              <div className="tx">
                <b>Brand analyzed{brand.storeName ? ` — ${brand.storeName}` : ""}</b>
                <span>Your voice, look and catalog are learned. Re-scan if your store changed.</span>
              </div>
              <button type="button" onClick={buildProfile} disabled={building}>
                {building ? "Re-scanning…" : "Re-scan"}
              </button>
            </div>
            {actionError && (
              <div style={{ marginTop: 10 }}>
                <Banner tone="warning" title="Re-scan hit a snag"><p>{friendlyError(actionError)}</p></Banner>
              </div>
            )}

            {/* the results */}
            <div className="eh-brand">
              {brand.tagline && <div className="bq">“{brand.tagline}”</div>}

              {(brand.tone || brand.imageStyle) && (
                <div className="btags">
                  {brand.tone && <span className="bt tone">{brand.tone}</span>}
                  {brand.imageStyle && <span className="bt">{brand.imageStyle}</span>}
                </div>
              )}

              {brand.productImages.length > 0 && (
                <div className="bstrip">
                  {brand.productImages.map((u, i) => (
                    <span key={i} className="bshot" style={{ backgroundImage: `url(${u})` }} />
                  ))}
                </div>
              )}

              <div className="battr">
                {brand.values.length > 0 && (
                  <div className="r"><span className="k">Values</span><span className="ch">{brand.values.map((x, i) => <em key={i}>{x}</em>)}</span></div>
                )}
                {brand.vocabulary.length > 0 && (
                  <div className="r"><span className="k">Voice</span><span className="ch">{brand.vocabulary.map((x, i) => <em key={i}>{x}</em>)}</span></div>
                )}
                {brand.contentThemes.length > 0 && (
                  <div className="r"><span className="k">Themes</span><span className="ch">{brand.contentThemes.map((x, i) => <em key={i}>{x}</em>)}</span></div>
                )}
                {brand.categories.length > 0 && (
                  <div className="r"><span className="k">Catalog</span><span className="ch">{brand.categories.map((x, i) => <em key={i}>{x}</em>)}</span></div>
                )}
              </div>

              {(brand.productCount > 0 || brand.avgPrice > 0) && (
                <div className="bmeta">
                  {brand.productCount > 0 && <span><b>{brand.productCount}</b> products scanned</span>}
                  {brand.avgPrice > 0 && <span><b>${brand.avgPrice.toFixed(0)}</b> avg price</span>}
                </div>
              )}

              {brand.positioning && <p className="bpos">{brand.positioning}</p>}

              {brand.samplePhrases.length > 0 && (
                <div className="bsample">
                  <span className="k">In your voice</span>
                  {brand.samplePhrases.map((x, i) => <p key={i}>“{x}”</p>)}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
