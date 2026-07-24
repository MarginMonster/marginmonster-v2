import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, Link } from "@remix-run/react";
import { useState } from "react";
import { Page, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { linkedFromCache } from "../lib/social-provider.server";
import { tokensRemaining } from "../lib/tokens.server";
import { acceptQuestline } from "../lib/questlines.server";
import { TOKEN_COST } from "../lib/plan-config";

const PLAT_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
const SHORT: Record<string, "tt" | "ig" | "fb"> = { tiktok: "tt", instagram: "ig", facebook: "fb" };

// cadence → per-account content pack (matches SOCIAL_PLAN_DEFS in questlines.ts)
const CADENCE = {
  light: { key: "SOCIAL_LIGHT", name: "Light", video: 2, image: 4, freq: "~2 drops / week", why: "A steady drip that keeps you on the feed without overposting." },
  standard: { key: "SOCIAL_STANDARD", name: "Standard", video: 4, image: 8, freq: "~3 drops / week", why: "Post ~3× a week, every week. Brands this consistent get seen up to 4× more — it keeps the algorithm on your side." },
  heavy: { key: "SOCIAL_HEAVY", name: "Heavy", video: 8, image: 12, freq: "daily drops", why: "All-in. A drop nearly every day for maximum reach and momentum." },
} as const;
type CadKey = keyof typeof CADENCE;
const perAccount = (c: { video: number; image: number }) => c.video * TOKEN_COST.video + c.image * TOKEN_COST.image;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const linked = shop ? linkedFromCache(shop.socialsJson).filter((p) => p in PLAT_LABEL) : [];
  return json({
    hasPlan: !!(shop && (await db.plan.findUnique({ where: { shopId: shop.id } }))?.active),
    tokens: shop ? tokensRemaining(await db.plan.findUnique({ where: { shopId: shop.id } }) ?? { tokensIncluded: 0, tokensUsed: 0, tokensExtra: 0 }) : 0,
    linked,
    costs: Object.fromEntries(Object.entries(CADENCE).map(([k, v]) => [k, perAccount(v)])) as Record<CadKey, number>,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const cadKey = (form.get("cadence") as CadKey) || "standard";
  const accounts = Math.max(1, Math.min(3, parseInt((form.get("accounts") as string) || "1", 10)));
  const cad = CADENCE[cadKey];
  if (!cad) return json({ error: "Unknown plan." });

  const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true } });
  if (!shop) return json({ error: "Shop not found." });
  if (!shop.activePlan?.active) return json({ error: "Choose a subscription plan first, then activate a Social Media Plan." });

  const linked = linkedFromCache(shop.socialsJson).filter((p) => p in PLAT_LABEL);
  if (linked.length < accounts) return json({ error: `Connect ${accounts} account${accounts > 1 ? "s" : ""} first — you have ${linked.length}.` });

  // Auto-use the store's catalog as the plan's product bag.
  let bag: { title: string; image: string | null; url: string | null }[] = [];
  try {
    const res = await admin.graphql(`{ products(first: 12, sortKey: UPDATED_AT, reverse: true) { edges { node { title handle onlineStoreUrl featuredImage { url } } } } }`);
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { title: string; handle?: string; onlineStoreUrl?: string; featuredImage?: { url?: string } } }[] } } };
    bag = (j.data?.products?.edges || []).map((e) => ({ title: e.node.title, image: e.node.featuredImage?.url || null, url: e.node.onlineStoreUrl || (e.node.handle ? `https://${session.shop}/products/${e.node.handle}` : null) }));
  } catch { /* fall through */ }
  if (bag.length === 0) return json({ error: "Add at least one product to your store — plans make content about your products." });

  // One platform-native plan per account (each posts only to its own account).
  const targets = linked.slice(0, accounts);
  const created: string[] = [];
  for (const platform of targets) {
    const r = await acceptQuestline({
      shopId: shop.id,
      templateKey: cad.key,
      avatarId: shop.brandAvatarId,
      avatarVariant: shop.brandAvatarVariant ?? 0,
      reviewMode: "REVIEW_FIRST",
      bag,
      platforms: [platform],
    });
    if (!r.ok) {
      const partial = created.length ? ` (${created.length} plan${created.length > 1 ? "s" : ""} already started — those tokens were charged)` : "";
      return json({ error: `${r.error}${partial}` });
    }
    created.push(r.id);
  }
  return redirect("/app/campaigns");
};

const TT = () => <svg viewBox="0 0 24 24"><path d="M16.5 3c.35 2.34 1.68 3.9 3.9 4.12v2.86c-1.3.08-2.53-.28-3.68-.98v5.9c0 3.5-2.48 6-5.86 6C7.6 20.9 5.3 18.7 5.3 15.6c0-3.02 2.4-5.3 5.5-5.3.34 0 .67.03 1 .09v2.94c-.32-.1-.65-.15-1-.15-1.42 0-2.5 1.05-2.5 2.44 0 1.42 1.1 2.46 2.55 2.46 1.53 0 2.6-1.13 2.6-2.98V3h3.05z" fill="#111" /></svg>;
const IG = () => <svg viewBox="0 0 24 24" fill="none" stroke="#E1306C" strokeWidth="2"><rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" /><circle cx="12" cy="12" r="4.1" /><circle cx="17.4" cy="6.6" r="1.2" fill="#E1306C" stroke="none" /></svg>;
const FB = () => <svg viewBox="0 0 24 24"><path d="M13.8 21v-8h2.6l.42-3.1h-3.02V7.9c0-.9.26-1.5 1.56-1.5h1.66V3.62c-.29-.04-1.27-.12-2.42-.12-2.4 0-4.04 1.46-4.04 4.15V9.9H8.1v3.1h2.44V21h3.26z" fill="#1877F2" /></svg>;
const GLYPH = { tt: TT, ig: IG, fb: FB } as const;

export default function NewPlan() {
  const { hasPlan, tokens, linked, costs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const error = actionData && "error" in actionData ? actionData.error : null;
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const [cadKey, setCadKey] = useState<CadKey>("standard");
  const cad = CADENCE[cadKey];
  const per = costs[cadKey];
  const primary = linked[0];
  const activate = (accounts: number) => submit({ cadence: cadKey, accounts: String(accounts) }, { method: "post" });

  return (
    <Page>
      <div className="smp">
        <span className="smp-ey">Automated Marketing</span>
        <h1 className="smp-h1">Social Media Plans</h1>
        <p className="smp-sub">Pick a cadence. Each plan posts to one account — grow it to more anytime.</p>

        {error && <div style={{ marginBottom: 14 }}><Banner tone="warning" title="Couldn't start the plan"><p>{error}</p></Banner></div>}

        {linked.length === 0 ? (
          <div className="smp-connect">
            <b>Connect an account to begin</b>
            <p>Link TikTok, Instagram or Facebook and EasyMode can start posting your plan automatically.</p>
            <Link className="smp-go" to="/app/connect">Connect an account</Link>
          </div>
        ) : (
          <>
            <div className="smp-lbl">Cadence</div>
            <div className="smp-cads">
              {(Object.keys(CADENCE) as CadKey[]).map((k) => {
                const c = CADENCE[k];
                return (
                  <button type="button" className={`smp-cad${k === cadKey ? " sel" : ""}`} key={k} onClick={() => setCadKey(k)}>
                    <span className="cn">{c.name}</span>
                    <span className="cm">{c.video} Vid · {c.image} Img</span>
                    <span className="cp">{costs[k]}<span>/acct</span></span>
                  </button>
                );
              })}
            </div>

            <div className="smp-plan">
              <div className="pt">{cad.name} plan</div>
              <p className="pwhy">{cad.why}</p>
              <div className="prow"><span className="pk">Posts</span><span className="pv">{cad.video} videos + {cad.image} images a month, native to the app</span></div>
              <div className="prow"><span className="pk">Frequency</span><span className="pv">{cad.freq}, auto-scheduled</span></div>
              <div className="prow"><span className="pk">Posts to</span><span className="pv"><span className="acct"><span className="lg">{(() => { const G = GLYPH[SHORT[primary]]; return <G />; })()}</span>{PLAT_LABEL[primary]}</span> — your primary account</span></div>
            </div>

            <div className="smp-tok"><div className="tt">Token cost · 1 account</div><div className="tb"><b>{per}</b><span>tokens / month</span></div></div>

            <div className="smp-acts">
              <button type="button" className="smp-cta go" disabled={busy} onClick={() => activate(1)}>{busy ? "Starting…" : `Activate — ${per} tokens / mo`}</button>
              {linked.length >= 2 ? (
                <button type="button" className="smp-cta up" disabled={busy} onClick={() => activate(2)}>＋ Post to 2 accounts <span className="plus">&nbsp;·&nbsp; +{per} tokens</span></button>
              ) : (
                <Link className="smp-cta up" to="/app/connect">＋ Connect a 2nd account</Link>
              )}
              {linked.length >= 3 ? (
                <button type="button" className="smp-cta viral" disabled={busy} onClick={() => activate(3)}><span className="vwrap">🔥 GO VIRAL — all 3 accounts &nbsp;·&nbsp; +{per * 2}</span></button>
              ) : (
                <Link className="smp-cta viral" to="/app/connect"><span className="vwrap">🔥 GO VIRAL — connect all 3 accounts</span></Link>
              )}
            </div>
            <p className="smp-wallet">{hasPlan ? `Wallet: ${tokens.toLocaleString()} tokens` : "Choose a subscription plan to activate."}</p>
          </>
        )}
      </div>
    </Page>
  );
}
