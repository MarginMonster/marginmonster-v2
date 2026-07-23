import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData, Link } from "@remix-run/react";
import { Page, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { generateBrandProfile } from "../lib/brand-voice.server";
import { unlockAchievement } from "../lib/xp.server";
import { paidAdsEnabled } from "../lib/feature-flags.server";
import { socialProviderEnabled } from "../lib/social-provider.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: {
      brandProfile: true,
      activePlan: true,
      assets: { orderBy: { createdAt: "desc" }, take: 12 },
      jobs: { where: { type: "GENERATE_BRAND_PROFILE" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const pendingAssets = shop?.assets.filter((a) => a.status === "PENDING").length ?? 0;
  const brandJob = shop?.jobs[0] || null;

  return json({
    shop,
    pendingAssets,
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

  try {
    await generateBrandProfile(shop.id, graphql);
    await unlockAchievement(shop.id, "SCANNER");
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
};

// ── refined line-icons (no emoji) ──────────────────────────────────────────
const ISend = () => <svg viewBox="0 0 24 24"><path d="M22 2 L11 13" /><path d="M22 2 L15 22 L11 13 L2 9 Z" /></svg>;
const IPen = () => <svg viewBox="0 0 24 24"><path d="M14 4 l6 6 -11 11 -6 0 0 -6 z" /><path d="M13 5 l6 6" /></svg>;
const IChart = () => <svg viewBox="0 0 24 24"><path d="M4 4 L4 20 L20 20" /><path d="M7 15 L11 10 L14 12 L19 6" /><circle cx="19" cy="6" r="1.3" fill="currentColor" stroke="none" /></svg>;
const IVideo = () => <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2.5" /><path d="M10 9.5 L15 12 L10 14.5 Z" fill="currentColor" stroke="none" /></svg>;
const IImage = () => <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M4 18 L10 13 L14 16 L20 10" /></svg>;
const IDoc = () => <svg viewBox="0 0 24 24"><path d="M5 4 L15 4 L19 8 L19 20 L5 20 Z" /><path d="M8 11 L16 11 M8 15 L14 15" /></svg>;
const IChev = () => <svg viewBox="0 0 10 16"><path d="M2 2 L8 8 L2 14" /></svg>;

const TYPE_META: Record<string, { label: string; Icon: () => JSX.Element }> = {
  VIDEO_AD: { label: "Video", Icon: IVideo },
  IMAGE_AD: { label: "Image", Icon: IImage },
  BLOG_POST: { label: "Blog", Icon: IDoc },
  AD_COPY: { label: "Ad copy", Icon: IDoc },
  EMAIL: { label: "Email", Icon: IDoc },
};
const typeMeta = (t: string) => TYPE_META[t] || { label: t, Icon: IDoc };

function statusMeta(s: string): { chip: string; cls: string; sub: string } {
  switch (s) {
    case "PENDING": return { chip: "Review", cls: "rev", sub: "ready to review" };
    case "APPROVED": return { chip: "Scheduled", cls: "sch", sub: "scheduled to post" };
    case "PUBLISHED": return { chip: "Posted", cls: "sch", sub: "posted to your socials" };
    default: return { chip: s.toLowerCase(), cls: "sch", sub: s.toLowerCase() };
  }
}

export default function Dashboard() {
  const { shop, pendingAssets, brandJobError, paidAds } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const building = nav.state !== "idle";
  const liveError = (actionData && "error" in actionData ? actionData.error : null) || brandJobError;
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
  const ap = shop.activePlan;
  const tokens = ap ? Math.max(0, ap.tokensIncluded - ap.tokensUsed) + ap.tokensExtra : 0;
  const level = shop.level ?? 1;

  const assets = shop.assets;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const made = assets.filter((a) => new Date(a.createdAt).getTime() >= weekAgo).length;
  const posted = assets.filter((a) => a.status === "PUBLISHED").length;
  const scheduled = assets.filter((a) => a.status === "APPROVED").length;
  const toReview = pendingAssets;

  // Queue: things needing attention first, then most recent.
  const known = assets.filter((a) => TYPE_META[a.type]);
  const queue = [...known.filter((a) => a.status === "PENDING"), ...known.filter((a) => a.status !== "PENDING")].slice(0, 3);

  const big = hasPlan
    ? made > 0
      ? `This week it made ${made} ${made === 1 ? "piece" : "pieces"}${posted > 0 ? ` and posted ${posted} for you` : ""}.`
      : "Your engine is warming up — your first content is on the way."
    : "Choose a plan and I'll start making content for your store, automatically.";

  return (
    <Page>
      <div className="eh">
        <div className="eh-top">
          <span className="eh-mk">E</span>
          <span className="eh-wm">EasyMode</span>
          <span className="eh-pill coin"><span className="c" />{tokens.toLocaleString()}</span>
          <span className="eh-pill lvl">LVL {level}</span>
        </div>
        <div className="eh-rule" />

        {!hasProfile && (
          <div className="eh-analyze">
            <b>Let's get to know your store</b>
            <p>We'll learn your brand voice and products so everything we make sounds and looks like you. Takes about a minute.</p>
            {liveError && (
              <div style={{ marginBottom: 12 }}>
                <Banner tone="warning" title="Last attempt hit a snag"><p>{liveError}</p></Banner>
              </div>
            )}
            <button type="button" onClick={buildProfile} disabled={building}>
              {building ? "Analyzing your store…" : "Analyze my store"}
            </button>
          </div>
        )}

        <span className="eh-ey">On autopilot</span>
        <h1>Your marketing, handled.</h1>
        <p className="eh-sub">EasyMode makes videos, images and posts from your products — then posts them to your socials on a schedule. You approve, it ships.</p>

        <div className="eh-status">
          <div className="lab"><span className="dot" />{hasPlan ? "Autopilot running" : "Ready when you are"}</div>
          <div className="big">{big}</div>
          <div className="row">
            <div className="st"><div className="n">{posted}</div><div className="k">Posted</div></div>
            <div className="st"><div className="n">{scheduled}</div><div className="k">Scheduled</div></div>
            <div className="st"><div className="n">{toReview}</div><div className="k">To review</div></div>
          </div>
        </div>

        <div className="eh-acts">
          <Link className="eh-btn primary" to={hasPlan ? "/app/campaigns" : "/app/plans"}>
            <div className="hd"><span className="ic"><ISend /></span><span className="ti">Automated Marketing</span></div>
            <p className="ds">{hasPlan ? "Pick a goal — we create and run a full month of content, start to finish." : "Choose a plan to switch on hands-free marketing."}</p>
            <span className="chev"><IChev /></span>
          </Link>
          <div className="eh-acts2">
            <Link className="eh-btn sm" to="/app/videos">
              <div className="hd"><span className="ic"><IPen /></span><span className="ti">Content Studio</span></div>
              <p className="ds">Make one piece by hand, in your voice.</p>
            </Link>
            <Link className="eh-btn sm" to={paidAds ? "/app/performance" : "/app/calendar"}>
              <div className="hd"><span className="ic"><IChart /></span><span className="ti">Results</span></div>
              <p className="ds">What shipped, and the clicks it drove.</p>
            </Link>
          </div>
        </div>

        {queue.length > 0 && (
          <>
            <div className="eh-sec"><h2>In the queue</h2><Link to="/app/assets">Review all</Link></div>
            <div className="eh-feed">
              {queue.map((a) => {
                const tm = typeMeta(a.type);
                const sm = statusMeta(a.status);
                return (
                  <Link className="eh-item" to="/app/assets" key={a.id}>
                    <span className="th"><tm.Icon /></span>
                    <span className="m"><b>{a.title || `${tm.label} from your catalog`}</b><span>{tm.label} · {sm.sub}</span></span>
                    <span className={`cg ${sm.cls}`}>{sm.chip}</span>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Page>
  );
}
