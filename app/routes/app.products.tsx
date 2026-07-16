import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useSubmit, useNavigation, useFetcher, Link } from "@remix-run/react";
import { useState, useRef, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  TextField,
  Box,
  Divider,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { generateProductCopy, type ProductCopy } from "../lib/product-copy.server";
import { chargeTokens, tokensRemaining, InsufficientTokensError } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { awardXp, unlockAchievement, checkLevelAchievements, type UnlockResult, type XpResult } from "../lib/xp.server";
import { XP_EVENTS } from "../lib/achievements";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true, activePlan: true },
  });
  const tokens = shop?.activePlan
    ? { remaining: tokensRemaining(shop.activePlan), included: shop.activePlan.tokensIncluded }
    : null;

  // Pull the store catalog so the merchant can pick a product instead of
  // typing a name. read_products, via the request (online) token.
  let products: { id: string; title: string; image: string | null; description: string }[] = [];
  try {
    const res = await admin.graphql(
      `{ products(first: 40, sortKey: UPDATED_AT, reverse: true) {
        edges { node { id title featuredImage { url } description(truncateAt: 220) } }
      } }`
    );
    const j = (await res.json()) as {
      data?: { products?: { edges?: { node: { id: string; title: string; featuredImage?: { url?: string }; description?: string } }[] } };
    };
    products = (j.data?.products?.edges || []).map((e) => ({
      id: e.node.id,
      title: e.node.title,
      image: e.node.featuredImage?.url || null,
      description: e.node.description || "",
    }));
  } catch {
    /* non-fatal — falls back to manual entry */
  }

  return json({ hasBrand: !!shop?.brandProfile, products, tokens, cost: TOKEN_COST.description });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { brandProfile: true, activePlan: true },
  });
  const form = await request.formData();
  const intent = (form.get("intent") as string) || "generate";

  // ---- Autopilot: write the generated SEO copy back to the Shopify product ----
  if (intent === "apply") {
    const productId = (form.get("productId") as string) || "";
    const descriptionHtml = (form.get("descriptionHtml") as string) || "";
    const seoTitle = (form.get("seoTitle") as string) || "";
    const seoDescription = (form.get("seoDescription") as string) || "";
    if (!productId) return json({ applyError: "Pick a product from your store (not a typed name) to apply automatically." });
    try {
      const res = await admin.graphql(
        `mutation ForgeApply($input: ProductInput!) {
          productUpdate(input: $input) { product { id title } userErrors { field message } }
        }`,
        { variables: { input: { id: productId, descriptionHtml, seo: { title: seoTitle, description: seoDescription } } } }
      );
      const j = (await res.json()) as {
        data?: { productUpdate?: { product?: { title?: string }; userErrors?: { message: string }[] } };
      };
      const errs = j.data?.productUpdate?.userErrors || [];
      if (errs.length) return json({ applyError: errs.map((e) => e.message).join("; ") });
      // Progression: applying a listing is the outcome we most want to reward.
      let xpRes: XpResult | null = null;
      const newAch: UnlockResult[] = [];
      if (shop) {
        try {
          await db.shop.update({ where: { id: shop.id }, data: { appliedCount: { increment: 1 } } });
          const a = await unlockAchievement(shop.id, "SHIPPED_IT");
          if (a) newAch.push(a);
          xpRes = await awardXp(shop.id, XP_EVENTS.applyListing);
          if (xpRes?.leveledUp) newAch.push(...(await checkLevelAchievements(shop.id, xpRes.level)));
        } catch { /* progression is never fatal */ }
      }
      return json({ applied: true, appliedTitle: j.data?.productUpdate?.product?.title || "", xpRes, newAch });
    } catch (e) {
      return json({ applyError: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- Autopilot: apply MANY listings at once ----
  if (intent === "applyAll") {
    let batch: { productId: string; descriptionHtml: string; seoTitle: string; seoDescription: string }[] = [];
    try {
      batch = JSON.parse((form.get("items") as string) || "[]");
    } catch {
      batch = [];
    }
    batch = batch.filter((b) => b.productId).slice(0, 12);
    if (!batch.length) return json({ applyError: "No catalog listings to apply (typed products can't be matched)." });
    let ok = 0;
    const failed: string[] = [];
    for (const b of batch) {
      try {
        const res = await admin.graphql(
          `mutation ForgeApply($input: ProductInput!) {
            productUpdate(input: $input) { product { id } userErrors { field message } }
          }`,
          { variables: { input: { id: b.productId, descriptionHtml: b.descriptionHtml, seo: { title: b.seoTitle, description: b.seoDescription } } } }
        );
        const j = (await res.json()) as { data?: { productUpdate?: { userErrors?: { message: string }[] } } };
        const errs = j.data?.productUpdate?.userErrors || [];
        if (errs.length) failed.push(errs[0].message);
        else ok++;
      } catch (e) {
        failed.push(e instanceof Error ? e.message : String(e));
      }
    }
    // Progression: batch applies earn per-listing XP + combo achievement.
    let xpRes: XpResult | null = null;
    const newAch: UnlockResult[] = [];
    if (shop && ok > 0) {
      try {
        await db.shop.update({ where: { id: shop.id }, data: { appliedCount: { increment: ok } } });
        const a1 = await unlockAchievement(shop.id, "SHIPPED_IT");
        if (a1) newAch.push(a1);
        if (ok >= 5) {
          const a2 = await unlockAchievement(shop.id, "BATCH_MASTER");
          if (a2) newAch.push(a2);
        }
        xpRes = await awardXp(shop.id, XP_EVENTS.applyListing * ok);
        if (xpRes?.leveledUp) newAch.push(...(await checkLevelAchievements(shop.id, xpRes.level)));
      } catch { /* progression is never fatal */ }
    }
    return json({ appliedAll: ok, appliedTotal: batch.length, applyError: failed.length ? `${failed.length} failed: ${failed[0]}` : null, xpRes, newAch });
  }

  // ---- Generate (one or many listings in a single batch) ----
  if (!shop?.brandProfile) return json({ error: "Analyze your store on the dashboard first." });
  if (!shop.activePlan) return json({ error: "Choose a plan first to get tokens.", outOfTokens: true });

  let items: { id?: string | null; title: string; notes?: string }[] = [];
  try {
    items = JSON.parse((form.get("items") as string) || "[]");
  } catch {
    items = [];
  }
  items = items.filter((it) => it.title?.trim()).slice(0, 12); // cap a batch at 12
  if (!items.length) return json({ error: "Pick or type at least one product to forge." });

  const perCost = TOKEN_COST.description;
  const totalCost = perCost * items.length;
  const have = tokensRemaining(shop.activePlan);
  if (have < totalCost) {
    return json({
      error: `Not enough tokens — forging ${items.length} listing${items.length > 1 ? "s" : ""} needs ${totalCost}, you have ${have}. Top up on the Plans page.`,
      outOfTokens: true,
    });
  }

  // Forge them all in parallel, then charge only for the ones that succeeded.
  const settled = await Promise.allSettled(
    items.map((it) => generateProductCopy(shop.brandProfile!, it.title.trim(), (it.notes || "").trim()))
  );
  const results = items.map((it, i) => {
    const s = settled[i];
    if (s.status === "fulfilled") return { id: it.id ?? null, title: it.title, copy: s.value };
    return { id: it.id ?? null, title: it.title, error: s.reason instanceof Error ? s.reason.message : String(s.reason) };
  });

  let remaining = have;
  const forged = results.filter((r) => "copy" in r).length;
  for (let i = 0; i < forged; i++) {
    try {
      remaining = (await chargeTokens(shop.id, "description")).remaining;
    } catch {
      break;
    }
  }

  // Progression: forge XP + forge-count achievements (token-spend XP already
  // flowed through chargeTokens).
  let xpRes: XpResult | null = null;
  const newAch: UnlockResult[] = [];
  if (forged > 0) {
    try {
      const updated = await db.shop.update({
        where: { id: shop.id },
        data: { forgedCount: { increment: forged } },
      });
      const a1 = await unlockAchievement(shop.id, "FIRST_FORGE");
      if (a1) newAch.push(a1);
      if (updated.forgedCount >= 10) {
        const a2 = await unlockAchievement(shop.id, "HAMMER_TIME");
        if (a2) newAch.push(a2);
      }
      xpRes = await awardXp(shop.id, XP_EVENTS.forgeListing * forged);
      if (xpRes?.leveledUp) newAch.push(...(await checkLevelAchievements(shop.id, xpRes.level)));
      // gifts/bonuses may have topped the wallet back up — report the fresh number
      const freshPlan = await db.plan.findUnique({ where: { shopId: shop.id } });
      if (freshPlan) remaining = tokensRemaining(freshPlan);
    } catch { /* progression is never fatal */ }
  }
  return json({ results, remaining, forged, xpRes, newAch });
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type PickItem = { id: string; title: string; description: string };
type ForgeResult = { id: string | null; title: string; copy?: ProductCopy; error?: string };

const QUICK = [
  { l: "Dashboard", route: "/app" },
  { l: "Plans", route: "/app/plans" },
  { l: "Video Studio", route: "/app/videos" },
  { l: "Landing Pages", route: "/app/funnels" },
  { l: "Content Queue", route: "/app/assets" },
  { l: "Calendar", route: "/app/calendar" },
  { l: "Ad Accounts", route: "/app/connect" },
  { l: "Performance", route: "/app/performance" },
];

export default function Products() {
  const { hasBrand, products, tokens, cost } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const outOfTokens = actionData && "outOfTokens" in actionData && actionData.outOfTokens;
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;
  const results = (actionData && "results" in actionData ? actionData.results : null) as ForgeResult[] | null;
  const forgedCount = actionData && "forged" in actionData ? (actionData.forged as number) : 0;
  const xpRes = (actionData && "xpRes" in actionData ? actionData.xpRes : null) as { gained: number; level: number; leveledUp: boolean; giftedTokens: number } | null;
  const newAch = ((actionData && "newAch" in actionData ? actionData.newAch : null) || []) as { key: string; icon: string; label: string; tokens: number; xp: number }[];

  // multi-select from the catalog + one optional manual entry
  const [selected, setSelected] = useState<Record<string, PickItem>>({});
  const [manualName, setManualName] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const toggle = (p: PickItem) =>
    setSelected((prev) => {
      const n = { ...prev };
      if (n[p.id]) delete n[p.id];
      else n[p.id] = p;
      return n;
    });
  const selectedList = Object.values(selected);
  const batch = [
    ...selectedList.map((p) => ({ id: p.id, title: p.title, notes: (p.description || "").slice(0, 300) })),
    ...(manualName.trim() ? [{ id: null, title: manualName.trim(), notes: manualNotes.trim() }] : []),
  ];
  const forgeCount = batch.length;
  const totalCost = cost * forgeCount;
  const remaining = tokens?.remaining ?? 0;
  const canAfford = tokens == null || remaining >= totalCost;

  // Apply runs through its own fetcher so it doesn't wipe the forged results.
  const applyFetcher = useFetcher<{ applied?: boolean; applyError?: string; appliedAll?: number; appliedTotal?: number }>();
  const applied = applyFetcher.data?.applied || false;
  const appliedAll = applyFetcher.data?.appliedAll;
  const applyError = applyFetcher.data?.applyError || null;
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const applyingAll = applyingId === "__all__" && applyFetcher.state !== "idle";
  useEffect(() => {
    if (applyFetcher.state === "idle") setApplyingId(null);
  }, [applyFetcher.state]);

  const resultsRef = useRef<HTMLDivElement>(null);
  const scrollTop = () => {
    // robust across the embedded frame's scroll container(s)
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* */ }
    try { document.scrollingElement?.scrollTo({ top: 0, behavior: "smooth" }); } catch { /* */ }
    try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; } catch { /* */ }
  };
  const scrollToResults = () => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const descHtml = (c: ProductCopy, text: string) => {
    const bulletsHtml = c.bullets?.length
      ? `<ul>${c.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
      : "";
    return `<p>${escapeHtml(text)}</p>${bulletsHtml}`;
  };

  const forge = () => {
    if (!forgeCount) return;
    submit({ intent: "generate", items: JSON.stringify(batch) }, { method: "post" });
    scrollTop(); // pop up to the forge so the hammer animation is in view
  };

  // Autopilot: write a chosen variant (+ bullets) and SEO meta to one product.
  const applyOne = (r: ForgeResult, descriptionText: string) => {
    if (!r.id || !r.copy) return;
    setApplyingId(r.id);
    const c = r.copy;
    applyFetcher.submit(
      { intent: "apply", productId: r.id, descriptionHtml: descHtml(c, descriptionText), seoTitle: c.seoTitle, seoDescription: c.metaDescription },
      { method: "post" }
    );
  };

  // catalog listings that CAN be auto-applied (have a product id + copy)
  const applicable = (results || []).filter((r) => r.id && r.copy) as (ForgeResult & { id: string; copy: ProductCopy })[];
  const applyAll = () => {
    if (!applicable.length) return;
    setApplyingId("__all__");
    const items = applicable.map((r) => ({
      productId: r.id,
      descriptionHtml: descHtml(r.copy, r.copy.descriptions[0]),
      seoTitle: r.copy.seoTitle,
      seoDescription: r.copy.metaDescription,
    }));
    applyFetcher.submit({ intent: "applyAll", items: JSON.stringify(items) }, { method: "post" });
  };

  // ensure we're at the top the moment forging kicks off (watch the hammer)
  useEffect(() => {
    if (busy) scrollTop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  if (!hasBrand) {
    return (
      <Page title="SEO Forge" backAction={{ content: "Home", url: "/app" }}>
        <EmptyState heading="Analyze your store first" image="" action={{ content: "Go to dashboard", url: "/app" }}>
          <p>We learn your brand voice first, so every description sounds like you.</p>
        </EmptyState>
      </Page>
    );
  }

  return (
    <>
      <Page
        title="Product listings"
        backAction={{ content: "SEO Hub", url: "/app/seo" }}
        subtitle="Titles, descriptions, bullets & meta tags — rewritten in your brand voice and pushed live in one click."
      >
        <Layout>
        <Layout.Section>
          <div className="pp-hero">
            <span className="pp-eyebrow">SEO Hub · Listings</span>
            <h1>Listings that <em>rank and sell.</em></h1>
            <p className="pp-sub">
              Pick products below and every one gets an SEO-weighted title, description,
              bullets and meta tags in your brand voice. Review, then push live to
              Shopify in one click — each listing earns XP.
            </p>
            {busy && (
              <div className="pp-stats">
                <div className="pp-stat">
                  <div className="v">✍ Writing {forgeCount > 1 ? `${forgeCount} listings` : "your listing"}…</div>
                  <div className="l">Usually under a minute · updates automatically</div>
                </div>
              </div>
            )}
            {results && !busy && forgedCount > 0 && (
              <div className="pp-stats">
                <button type="button" className="pp-cta gold" onClick={scrollToResults}>
                  ✓ {forgedCount} listing{forgedCount > 1 ? "s" : ""} ready — review ↓
                </button>
              </div>
            )}
          </div>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {selectedList.length > 0 && (
                <Text variant="bodySm" as="p" tone="subdued">
                  {selectedList.length} product{selectedList.length > 1 ? "s" : ""} selected from your catalog below.
                </Text>
              )}
              <TextField
                label="Add a custom product (optional)"
                value={manualName}
                onChange={setManualName}
                autoComplete="off"
                placeholder="e.g. Blue Razz Gummy Worms"
                helpText={products.length > 0 ? "Or select several from your catalog below." : "Type the product to forge."}
              />
              {manualName.trim() !== "" && (
                <TextField
                  label="Notes for custom product (optional)"
                  value={manualNotes}
                  onChange={setManualNotes}
                  autoComplete="off"
                  multiline={2}
                  placeholder="Key features, who it's for, what makes it special…"
                />
              )}
              <div className="mm-forge-cta">
                <button type="button" className={`pp-cta-hero${busy ? " busy" : ""}`} onClick={forge} disabled={busy || !forgeCount || !canAfford}>
                  {busy
                    ? `✍ Writing ${forgeCount > 1 ? `${forgeCount} listings` : "your listing"}…`
                    : `✨ Write ${forgeCount > 1 ? `${forgeCount} listings` : "my listing"}`}
                </button>
                {tokens != null && (
                  <span className={`mm-credits${!canAfford ? " low" : ""}`}>
                    <b>TOKENS</b> 🪙 {remaining.toLocaleString()}
                    {forgeCount > 0 && <em> · Cost {totalCost} Tokens</em>}
                  </span>
                )}
              </div>
              {!canAfford && forgeCount > 0 && (
                <Text variant="bodySm" as="p" tone="critical">
                  Not enough tokens for {forgeCount} — need {totalCost}. Top up on the Plans page.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {products.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">Pick products to forge</Text>
                  {selectedList.length > 0 && <Badge tone="success">{`${selectedList.length} selected`}</Badge>}
                </InlineStack>
                <Text variant="bodySm" as="p" tone="subdued">
                  Tap to select — pick as many as you like, then hit Forge. Each listing costs {cost} ⚡.
                </Text>
                <div className="mm-prodgrid">
                  {products.map((p) => {
                    const on = !!selected[p.id];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`mm-prodcard${on ? " on" : ""}`}
                        onClick={() => toggle(p)}
                      >
                        {on && <span className="mm-prodcheck">✓</span>}
                        {p.image ? (
                          <img src={p.image} alt="" loading="lazy" />
                        ) : (
                          <div className="mm-prodph">🛍️</div>
                        )}
                        <span className="mm-prodtitle">{p.title}</span>
                      </button>
                    );
                  })}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {error && (
          <Layout.Section>
            <Banner
              tone={outOfTokens ? "critical" : "warning"}
              title={outOfTokens ? "Out of tokens" : "Couldn't generate copy"}
              action={outOfTokens ? { content: "Top up tokens", url: "/app/plans" } : undefined}
            >
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}

        {(applied || appliedAll != null) && (
          <Layout.Section>
            <Banner
              tone="success"
              title={appliedAll != null ? `${appliedAll} listing${appliedAll === 1 ? "" : "s"} updated on your store` : "Listing updated on your store"}
            >
              <p>Your product copy and SEO are now live on Shopify. 🔨</p>
            </Banner>
          </Layout.Section>
        )}
        {applyError && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't update the listing"><p>{applyError}</p></Banner>
          </Layout.Section>
        )}

        {results && !busy && (
          <Layout.Section>
            <div ref={resultsRef} style={{ scrollMarginTop: 12 }} />
            <div className="mm-forged-head">
              <span className="mm-forged-stamp">FORGED!</span>
              <Text variant="headingMd" as="h2">
                {forgedCount} listing{forgedCount === 1 ? "" : "s"} ready
              </Text>
              {xpRes && <span className="mm-cheer">+{xpRes.gained} XP</span>}
            </div>
            {(xpRes?.leveledUp || newAch.length > 0) && (
              <Box paddingBlockStart="200">
                <InlineStack gap="200" wrap blockAlign="center">
                  {xpRes?.leveledUp && (
                    <div className="mm-levelup">
                      ⭐ LEVEL {xpRes.level}!{xpRes.giftedTokens > 0 ? ` +${xpRes.giftedTokens} 🪙 GIFT` : ""}
                    </div>
                  )}
                  {newAch.map((a) => (
                    <span key={a.key} className="mm-cheer">
                      🏆 {a.label.toUpperCase()} UNLOCKED{a.tokens > 0 ? ` +${a.tokens} 🪙` : ""}
                    </span>
                  ))}
                </InlineStack>
              </Box>
            )}
            {applicable.length > 0 && (
              <Box paddingBlockStart="200">
                <InlineStack gap="300" blockAlign="center" wrap>
                  <Button variant="primary" onClick={applyAll} loading={applyingAll} disabled={applyFetcher.state !== "idle"}>
                    {`⚙️ Autopilot: apply all ${applicable.length} to my store`}
                  </Button>
                  <button type="button" className="mm-ghost-btn" onClick={scrollToResults}>Review each first ↓</button>
                </InlineStack>
                <Box paddingBlockStart="100">
                  <p className="mm-forge-note">
                    "Apply all" pushes the first variant of every listing live. Prefer picking variants? Review each below.
                  </p>
                </Box>
              </Box>
            )}
          </Layout.Section>
        )}

        {results && !busy && results.map((r, ri) => (
          <Layout.Section key={ri}>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">{r.title}</Text>
                {r.error ? (
                  <Banner tone="warning"><p>Couldn't forge this one: {r.error}</p></Banner>
                ) : r.copy ? (
                  <>
                    <BlockStack gap="100">
                      <Text variant="bodySm" as="p" tone="subdued">Title tag</Text>
                      <Text variant="bodyMd" as="p" fontWeight="semibold">{r.copy.seoTitle}</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text variant="bodySm" as="p" tone="subdued">Meta description</Text>
                      <Text variant="bodyMd" as="p">{r.copy.metaDescription}</Text>
                    </BlockStack>
                    <Divider />
                    <InlineStack gap="300" wrap>
                      {r.copy.descriptions.map((d, i) => (
                        <Box key={i} minWidth="300px" maxWidth="400px">
                          <Card>
                            <BlockStack gap="300">
                              <Badge>{`Variant ${i + 1}`}</Badge>
                              <Text variant="bodyMd" as="p">{d}</Text>
                              <Button
                                size="slim"
                                variant="primary"
                                onClick={() => applyOne(r, d)}
                                loading={applyingId === r.id}
                                disabled={!r.id || applyingId !== null}
                              >
                                ⚙️ Autopilot: apply to my listing
                              </Button>
                            </BlockStack>
                          </Card>
                        </Box>
                      ))}
                    </InlineStack>
                    <BlockStack gap="050">
                      <Text variant="headingSm" as="h4">Selling points</Text>
                      {r.copy.bullets.map((b) => (
                        <Text key={b} variant="bodyMd" as="p">• {b}</Text>
                      ))}
                    </BlockStack>
                    {!r.id && (
                      <Text variant="bodySm" as="p" tone="subdued">
                        Typed products can't auto-apply — no store listing to match.
                      </Text>
                    )}
                  </>
                ) : null}
              </BlockStack>
            </Card>
          </Layout.Section>
        ))}

        <Layout.Section>
          <span className="mm-section-label">▶ QUICK ACCESS</span>
          <div className="mm-quick">
            {QUICK.map((q) => (
              <Link key={q.l} to={q.route} className="mm-chip">{q.l}</Link>
            ))}
          </div>
        </Layout.Section>
        </Layout>
      </Page>
    </>
  );
}
