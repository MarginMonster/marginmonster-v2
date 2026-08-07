import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, Link } from "@remix-run/react";
import { useState } from "react";
import { Page, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { linkedFromCache } from "../lib/social-provider.server";
import { tokensRemaining, tokensRemainingLive, spendTokens, refundTokens } from "../lib/tokens.server";
import { acceptQuestline } from "../lib/questlines.server";
import { SOCIAL_PLAN_DEFS, questlineTokenCost } from "../lib/questlines";
import { AVATARS, avatarImg, privateCastFor } from "../lib/avatars";
import { PLAN_TIERS, PLAN_BY_KEY, TOKEN_PACKS, resolveTierKey } from "../lib/plan-config";

const PLAT_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
const SHORT: Record<string, "tt" | "ig" | "fb"> = { tiktok: "tt", instagram: "ig", facebook: "fb" };

/* Plan archetypes — each is a full month of content that auto-posts across the
 * next 30 days. Motivation + value anchor sell the deal; the mix + cost come
 * from SOCIAL_PLAN_DEFS so token math is the single source of truth. */
const ARCH_META: Record<string, { badge: string; freq: string; motivation: string; value: string }> = {
  SOCIAL_FOUND: { badge: "SEO", freq: "a drop most days", motivation: "14 articles targeting what your buyers actually Google — each keeps ranking and pulling free traffic for months — plus 20 image posts so the feed never sleeps. The cheapest customers you'll ever get.", value: "≈ $2,000+ of agency SEO content" },
  SOCIAL_STEADY: { badge: "Balanced", freq: "a drop most days", motivation: "Show up nearly every day across video, image and article. Brands this consistent get seen up to 4× more — it's the drumbeat that turns scrollers into repeat buyers.", value: "≈ a $1,500/mo content retainer" },
  SOCIAL_VIRAL: { badge: "Video-heavy", freq: "video twice a week + daily drops", motivation: "8 presenter-led videos a month plus a wall of image posts — and on the Anthem plan, two arrive as SHOWSTOPPERS: a viral-style cartoon drop and your product's own sung Anthem. You only need one to hit.", value: "≈ $1,200+ in UGC video alone" },
  SOCIAL_EMPIRE: { badge: "Max firepower", freq: "several drops every day", motivation: "The whole machine, unleashed. 72 drops a month across every platform, every single day — 12 videos with the showstoppers included, 40 image posts, 20 articles. Some brands post. Yours is simply always there.", value: "≈ a $4,000/mo growth agency" },
};
const ARCH_ORDER = ["SOCIAL_FOUND", "SOCIAL_STEADY", "SOCIAL_VIRAL", "SOCIAL_EMPIRE"];

// Cross-posting an extra connected account re-posts the SAME drops — no new
// generation — so it's a small flat monthly fee, never a second plan price.
const CROSS_POST_FEE = 20;

function tierFor(cost: number): string {
  const t = PLAN_TIERS.find((p) => p.monthlyTokens >= cost);
  return t ? t.name : PLAN_TIERS[PLAN_TIERS.length - 1].name;
}

function archetypes(allowance: number, planName: string | null, hasVideoCap: boolean) {
  return ARCH_ORDER.map((key) => {
    const def = SOCIAL_PLAN_DEFS.find((d) => d.key === key)!;
    const mix = { video: 0, image: 0, blog: 0 };
    for (const o of def.objectives) if (o.type in mix) (mix as Record<string, number>)[o.type] = o.target;
    const cost = questlineTokenCost(def);
    const drops = mix.video + mix.image + mix.blog;
    const tier = tierFor(cost);
    // Two gates, surfaced honestly: the CAPABILITY (videos need Studio) and
    // the BUDGET (does it fit the monthly allowance).
    const videoLocked = mix.video > 0 && !hasVideoCap;
    const fits = !videoLocked && allowance > 0 && allowance >= cost;
    const fitLabel = videoLocked
      ? `🔒 Includes video — unlocks on the Studio plan`
      : fits
        ? `✓ ${cost.toLocaleString()} of your ${allowance.toLocaleString()} monthly tokens`
        : allowance > 0
          ? `Costs ${cost.toLocaleString()} tokens — top up or upgrade to ${tier}`
          : `${cost.toLocaleString()} tokens — fits ${tier}`;
    return { key, name: def.name, icon: def.icon, ...ARCH_META[key], mix, cost, drops, tier, fits, fitLabel, planName };
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  const plan = shop ? await db.plan.findUnique({ where: { shopId: shop.id } }) : null;
  const linked = shop ? linkedFromCache(shop.socialsJson).filter((p) => p in PLAT_LABEL) : [];
  const tierKey = plan?.active ? resolveTierKey(plan.type) : null;
  const tier = tierKey ? PLAN_BY_KEY[tierKey] : null;
  const allowance = tier?.monthlyTokens ?? 0;
  const { capabilitiesFor } = await import("../lib/capabilities.server");
  const hasVideoCap = capabilitiesFor(plan).has("video");

  let products: { title: string; image: string | null; url: string | null }[] = [];
  try {
    const res = await admin.graphql(`{ products(first: 12, sortKey: UPDATED_AT, reverse: true) { edges { node { title handle onlineStoreUrl featuredImage { url } } } } }`);
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { title: string; handle?: string; onlineStoreUrl?: string; featuredImage?: { url?: string } } }[] } } };
    products = (j.data?.products?.edges || []).map((e) => ({ title: e.node.title, image: e.node.featuredImage?.url || null, url: e.node.onlineStoreUrl || (e.node.handle ? `https://${session.shop}/products/${e.node.handle}` : null) }));
  } catch { /* fall through */ }

  // FULL Studio cast — the campaign picker carries every presenter, same as
  // the Content Studio (it's a horizontal scroller, so the row scales).
  const cast = [...privateCastFor(session.shop), ...AVATARS].map((a) => ({ id: a.id, name: a.name, vibe: a.vibe, img: avatarImg(a.id, 0) }));

  return json({
    hasPlan: !!plan?.active,
    planName: tier?.name ?? null,
    allowance,
    packs: TOKEN_PACKS,
    tiers: PLAN_TIERS.map((t) => ({ name: t.name, monthlyTokens: t.monthlyTokens, price: t.price })),
    tokens: tokensRemainingLive(plan),
    linked,
    products,
    cast,
    defaultAvatar: shop?.brandAvatarId && cast.some((c) => c.id === shop.brandAvatarId) ? shop.brandAvatarId : cast[0]?.id ?? null,
    archetypes: archetypes(allowance, tier?.name ?? null, hasVideoCap),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const archKey = (form.get("archetype") as string) || "SOCIAL_STEADY";
  const def = SOCIAL_PLAN_DEFS.find((d) => d.key === archKey);
  if (!def) return json({ error: "Unknown plan." });

  const avatarId = (form.get("avatarId") as string) || null;
  let platforms: string[] = [];
  let picked: { title: string; image: string | null; url: string | null }[] = [];
  try { platforms = JSON.parse((form.get("platforms") as string) || "[]"); } catch { /* ignore */ }
  try { picked = JSON.parse((form.get("products") as string) || "[]"); } catch { /* ignore */ }

  const shop = await db.shop.findUnique({ where: { domain: session.shop }, include: { activePlan: true } });
  if (!shop) return json({ error: "Shop not found." });
  if (!shop.activePlan?.active) return json({ error: "Choose a subscription plan first, then activate a Social Media Plan." });

  const linked = linkedFromCache(shop.socialsJson).filter((p) => p in PLAT_LABEL);
  platforms = platforms.filter((p) => linked.includes(p));
  if (platforms.length === 0) return json({ error: "Pick at least one connected account for this plan to post to." });

  let bag = picked.filter((p) => p.title?.trim());
  if (bag.length === 0) {
    try {
      const res = await admin.graphql(`{ products(first: 8, sortKey: UPDATED_AT, reverse: true) { edges { node { title handle onlineStoreUrl featuredImage { url } } } } }`);
      const j = (await res.json()) as { data?: { products?: { edges?: { node: { title: string; handle?: string; onlineStoreUrl?: string; featuredImage?: { url?: string } } }[] } } };
      bag = (j.data?.products?.edges || []).map((e) => ({ title: e.node.title, image: e.node.featuredImage?.url || null, url: e.node.onlineStoreUrl || (e.node.handle ? `https://${session.shop}/products/${e.node.handle}` : null) }));
    } catch { /* fall through */ }
  }
  if (bag.length === 0) return json({ error: "Add at least one product to your store — plans make content about your products." });

  // ONE plan generates the content; extra accounts just re-post it, so each
  // costs a small flat 20 tokens/mo — not a duplicate full-price plan. The
  // questline's schedule.platforms carries the full target list and
  // postDueSlots fans each drop out to all of them.
  const crossFee = Math.max(0, platforms.length - 1) * CROSS_POST_FEE;
  if (crossFee > 0) {
    try { await spendTokens(shop.id, crossFee); }
    catch (e) { return json({ error: e instanceof Error ? e.message : "Not enough tokens for cross-posting." }); }
  }
  const r = await acceptQuestline({
    shopId: shop.id,
    templateKey: def.key,
    avatarId: avatarId ?? shop.brandAvatarId,
    avatarVariant: avatarId && avatarId === shop.brandAvatarId ? (shop.brandAvatarVariant ?? 0) : 0,
    reviewMode: "REVIEW_FIRST",
    bag,
    platforms,
  });
  if (!r.ok) {
    if (crossFee > 0) { try { await refundTokens(shop.id, crossFee); } catch { /* non-fatal */ } }
    return json({ error: r.error });
  }
  return redirect("/app/campaigns");
};

const TT = () => <svg viewBox="0 0 24 24"><path d="M16.5 3c.35 2.34 1.68 3.9 3.9 4.12v2.86c-1.3.08-2.53-.28-3.68-.98v5.9c0 3.5-2.48 6-5.86 6C7.6 20.9 5.3 18.7 5.3 15.6c0-3.02 2.4-5.3 5.5-5.3.34 0 .67.03 1 .09v2.94c-.32-.1-.65-.15-1-.15-1.42 0-2.5 1.05-2.5 2.44 0 1.42 1.1 2.46 2.55 2.46 1.53 0 2.6-1.13 2.6-2.98V3h3.05z" fill="#111" /></svg>;
const IG = () => <svg viewBox="0 0 24 24" fill="none" stroke="#E1306C" strokeWidth="2"><rect x="3.3" y="3.3" width="17.4" height="17.4" rx="5" /><circle cx="12" cy="12" r="4.1" /><circle cx="17.4" cy="6.6" r="1.2" fill="#E1306C" stroke="none" /></svg>;
const FB = () => <svg viewBox="0 0 24 24"><path d="M13.8 21v-8h2.6l.42-3.1h-3.02V7.9c0-.9.26-1.5 1.56-1.5h1.66V3.62c-.29-.04-1.27-.12-2.42-.12-2.4 0-4.04 1.46-4.04 4.15V9.9H8.1v3.1h2.44V21h3.26z" fill="#1877F2" /></svg>;
const GLYPH = { tt: TT, ig: IG, fb: FB } as const;

export default function NewPlan() {
  const { hasPlan, planName, allowance, tokens, packs, tiers, linked, products, cast, defaultAvatar, archetypes: archs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const error = actionData && "error" in actionData ? actionData.error : null;
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const [archKey, setArchKey] = useState(archs[1]?.key ?? archs[0]?.key ?? "SOCIAL_STEADY");
  const arch = archs.find((a) => a.key === archKey) ?? archs[0];
  const [avatarId, setAvatarId] = useState<string | null>(defaultAvatar);
  // Type a name instead of scrubbing the whole cast sideways. The cast
  // presenter always survives the filter, so a search can't hide your pick.
  const [castQ, setCastQ] = useState("");
  const castNeedle = castQ.trim().toLowerCase();
  const castShown = castNeedle
    ? cast.filter((c) => c.name.toLowerCase().includes(castNeedle) || c.id === avatarId)
    : cast;
  const [picked, setPicked] = useState<number[]>(products.length ? products.slice(0, Math.min(5, products.length)).map((_, i) => i) : []);
  const primary = linked[0];
  const extras = linked.slice(1);
  const unlinked = (["tiktok", "instagram", "facebook"] as const).filter((p) => !linked.includes(p));
  const [addOns, setAddOns] = useState<string[]>([]); // extra accounts beyond primary

  // One plan price + a small flat fee per extra account — cross-posting the
  // same drops doesn't generate anything new, so it never costs a second plan.
  const per = arch?.cost ?? 0;
  const accounts = 1 + addOns.length;
  const total = per + addOns.length * CROSS_POST_FEE;
  const shortfall = Math.max(0, total - tokens); // can't cover from the wallet right now
  const overAllowance = total > allowance; // bigger than the monthly refill → upgrade territory
  const upgradeTier = tiers.find((t) => t.monthlyTokens >= total && t.monthlyTokens > allowance) || null;
  const pack = packs.find((p) => p.tokens >= shortfall) || packs[packs.length - 1];
  const needNudge = hasPlan && (shortfall > 0 || overAllowance);
  const toggleProduct = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  const toggleAddOn = (p: string) => setAddOns((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  const activate = () => {
    const plats = [primary, ...addOns].filter(Boolean);
    if (!plats.length) return;
    submit(
      { intent: "activate", archetype: archKey, avatarId: avatarId ?? "", platforms: JSON.stringify(plats), products: JSON.stringify(picked.map((i) => products[i]).filter(Boolean)) },
      { method: "post" }
    );
  };

  return (
    <Page>
      <div className="smp">
        <h1 className="smp-h1">Social Media Plans</h1>
        <p className="smp-sub">Pick a strategy and EasyMode creates <b>and auto-posts</b> a full month of content across the next 30 days — hands off.</p>

        {error && <div style={{ marginBottom: 14 }}><Banner tone="warning" title="Couldn't start the plan"><p>{error}</p></Banner></div>}

        {linked.length === 0 ? (
          <div className="smp-connect">
            <b>Connect an account to begin</b>
            <p>Link TikTok, Instagram or Facebook and EasyMode can start posting your plan automatically.</p>
            <Link className="smp-go" to="/app/connect">Connect an account</Link>
          </div>
        ) : (
          <>
            {/* 1 — strategy */}
            <div className="smp-step">1 · Choose your strategy</div>
            <div className="smp-arch">
              {archs.map((a) => {
                const sel = a.key === archKey;
                return (
                  <button type="button" key={a.key} className={`smp-ac${sel ? " sel" : ""}`} onClick={() => setArchKey(a.key)}>
                    <div className="ac-top">
                      <span className="ac-badge">{a.badge}</span>
                      <span className="ac-drops">{a.drops}<span> drops / mo</span></span>
                    </div>
                    <div className="ac-name">{a.icon} {a.name}</div>
                    <div className="ac-mix">
                      {a.mix.video ? <span className="v">{a.mix.video} Video</span> : null}
                      {a.mix.image ? <span className="i">{a.mix.image} Image</span> : null}
                      {a.mix.blog ? <span className="b">{a.mix.blog} Article</span> : null}
                    </div>
                    <div className="ac-price"><span className="coin" /><b>{a.cost.toLocaleString()}</b> tokens <span>/ month</span></div>
                    <p className="ac-why">{a.motivation}</p>
                    <div className="ac-foot">
                      <span className="ac-val">{a.value}</span>
                      <span className={`ac-fit${a.fits ? " in" : ""}`}>{a.fitLabel}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 2 — configure */}
            <div className="smp-step">2 · Make it yours</div>
            <div className="smp-cfg">
              <div className="cfg-lbl">Presenter — who stars all month</div>
              <div className="cs-search">
                <input className="cs-search-in" type="search" value={castQ} placeholder={`Search ${cast.length} presenters by name…`}
                  onChange={(e) => setCastQ(e.target.value)} aria-label="Search presenters by name" />
                {castNeedle && <button type="button" className="cs-search-x" onClick={() => setCastQ("")} aria-label="Clear search">✕</button>}
              </div>
              {castNeedle && castShown.length === 0 && <p className="cs-nohit">No presenter called “{castQ.trim()}”.</p>}
              <div className={castNeedle ? "cs-castgrid" : "cfg-cast"}>
                {castShown.map((c) => (
                  <button type="button" key={c.id} className={`cast${c.id === avatarId ? " sel" : ""}`} onClick={() => setAvatarId(c.id)}>
                    <span className="ca-img" style={{ backgroundImage: `url(${c.img})` }}>{c.id === avatarId && <span className="ca-chk">✓</span>}</span>
                    <span className="ca-nm">{c.name}</span>
                  </button>
                ))}
              </div>

              {products.length > 0 && (
                <>
                  <div className="cfg-lbl">Feature products — rotated at random</div>
                  <div className="cfg-prods">
                    {products.map((p, i) => (
                      <button type="button" key={i} className={`prod${picked.includes(i) ? " sel" : ""}`} onClick={() => toggleProduct(i)} title={p.title}>
                        <span className="pr-img" style={p.image ? { backgroundImage: `url(${p.image})` } : undefined}>{picked.includes(i) && <span className="pr-chk">✓</span>}</span>
                      </button>
                    ))}
                  </div>
                  <p className="cfg-note">{picked.length ? `${picked.length} selected` : "All products"} — EasyMode showcases a different one each drop, no two the same.</p>
                </>
              )}

              <div className="cfg-lbl">Posts to</div>
              <div className="cfg-primary">
                {primary && (<><span className="pl-lg"><PLogo p={primary} /></span><span className="pp-nm">{PLAT_LABEL[primary]}</span><span className="pp-inc">Included</span></>)}
              </div>
              {(extras.length > 0 || unlinked.length > 0) && (
                <div className="cfg-addons">
                  <div className="ca-lbl">Reach more — same plan, posted everywhere</div>
                  {extras.map((p) => {
                    const on = addOns.includes(p);
                    return (
                      <button type="button" key={p} className={`addon${on ? " on" : ""}`} onClick={() => toggleAddOn(p)}>
                        <span className="pl-lg"><PLogo p={p} /></span>
                        <span className="ao-nm">{PLAT_LABEL[p]}</span>
                        <span className="ao-plus">{on ? `✓ Added · +${CROSS_POST_FEE} tokens` : `＋ ${CROSS_POST_FEE} tokens / mo`}</span>
                      </button>
                    );
                  })}
                  {unlinked.map((p) => (
                    <Link key={p} className="addon connect" to="/app/connect">
                      <span className="pl-lg"><PLogo p={p} /></span>
                      <span className="ao-nm">{PLAT_LABEL[p]}</span>
                      <span className="ao-plus">＋ Connect · +{CROSS_POST_FEE} tokens</span>
                    </Link>
                  ))}
                </div>
              )}

              <div className="smp-promise">Once activated, EasyMode creates all <b>{arch?.drops ?? 0} drops</b> across the next 30 days and auto-posts every one{accounts > 1 ? <> to <b>all {accounts} accounts</b></> : null} — no work from you.</div>

              <div className="smp-tok">
                <div className="tt">Total{accounts > 1 ? ` · posts to ${accounts} accounts` : ""}</div>
                <div className="tb"><b>{total.toLocaleString()}</b><span>tokens / month</span></div>
                {accounts > 1 && <div className="tk-sub">{per.toLocaleString()} plan + {CROSS_POST_FEE} × {addOns.length} cross-posting — extra accounts re-post the same drops, they don't regenerate</div>}
              </div>

              {needNudge && (
                <div className="smp-nudge">
                  <div className="nz-hd">{shortfall > 0 ? `You're ${shortfall.toLocaleString()} tokens short for this plan` : `This plan runs ${total.toLocaleString()} tokens — more than your ${planName} allowance`}</div>
                  <div className="nz-opts">
                    {shortfall > 0 && (
                      <Link className="nz-opt buy" to="/app/plans">
                        <span className="nz-t">＋ Buy {pack.label}</span>
                        <span className="nz-s">${pack.price} · covers it instantly</span>
                      </Link>
                    )}
                    {upgradeTier && (
                      <Link className="nz-opt up" to="/app/plans">
                        <span className="nz-t">↑ Upgrade to {upgradeTier.name}</span>
                        <span className="nz-s">{upgradeTier.monthlyTokens.toLocaleString()} tokens/mo — includes this every month</span>
                      </Link>
                    )}
                  </div>
                </div>
              )}

              <button type="button" className="smp-cta go" disabled={busy || !primary || shortfall > 0} onClick={activate}>
                {busy ? "Starting…" : shortfall > 0 ? `Top up to activate — ${shortfall.toLocaleString()} short` : `Activate ${arch?.name ?? "plan"} — ${total.toLocaleString()} tokens / mo`}
              </button>
              <p className="smp-wallet">{hasPlan ? `Wallet: ${tokens.toLocaleString()} tokens · ${planName} plan` : "Choose a subscription plan to activate."}</p>
            </div>

            <p className="smp-multi">💡 Run several at once — a <b>Go Viral</b> plan on TikTok and a <b>Get Found</b> SEO plan can run side by side, each with its own presenter and products.</p>
          </>
        )}
      </div>
    </Page>
  );
}

function PLogo({ p }: { p: string }) {
  const G = GLYPH[SHORT[p]];
  return <G />;
}
