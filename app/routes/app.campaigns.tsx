import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
import { useState } from "react";
import fs from "node:fs";
import path from "node:path";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Select,
  Banner,
  Box,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";
import { tokensRemaining } from "../lib/tokens.server";
import { acceptQuestline } from "../lib/questlines.server";
import { QUESTLINES, QUESTLINE_BY_KEY, questlineTokenCost } from "../lib/questlines";
import { AVATARS, AVATAR_BY_ID, avatarImg } from "../lib/avatars";

const TIER_RANK: Record<string, number> = { STARTER: 0, GROWTH: 1, PRO: 2, SCALE: 3 };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    include: { activePlan: true, questlines: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!shop) return json({ questlines: [], products: [], tokens: 0, tier: "STARTER", brandFace: null, castAvail: {} as Record<string, boolean> });

  let products: { id: string; title: string; image: string | null }[] = [];
  try {
    const res = await admin.graphql(
      `{ products(first: 24, sortKey: UPDATED_AT, reverse: true) { edges { node { id title featuredImage { url } } } } }`
    );
    const j = (await res.json()) as { data?: { products?: { edges?: { node: { id: string; title: string; featuredImage?: { url?: string } } }[] } } };
    products = (j.data?.products?.edges || []).map((e) => ({ id: e.node.id, title: e.node.title, image: e.node.featuredImage?.url || null }));
  } catch { /* manual entry still works */ }

  const castAvail: Record<string, boolean> = {};
  try {
    const files = new Set(fs.readdirSync(path.join(process.cwd(), "public", "avatars")));
    for (const a of AVATARS) if (files.has(`${a.id}_0.jpg`) || files.has(`${a.id}.jpg`)) castAvail[a.id] = true;
  } catch { /* empty roster */ }

  return json({
    questlines: shop.questlines.map((q) => ({
      id: q.id, name: q.name, template: q.template, status: q.status,
      avatarId: q.avatarId, avatarVariant: q.avatarVariant, productTitle: q.productTitle,
      objectives: JSON.parse(q.objectivesJson) as { key: string; label: string; type: string; target: number; done: number }[],
      tokenCost: q.tokenCost, xpReward: q.xpReward, progress: q.progress, reviewMode: q.reviewMode,
    })),
    products,
    tokens: shop.activePlan ? tokensRemaining(shop.activePlan) : 0,
    tier: shop.activePlan?.type || "STARTER",
    brandFace: shop.brandAvatarId ? { id: shop.brandAvatarId, variant: shop.brandAvatarVariant ?? 0 } : null,
    castAvail,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent") as string;
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop) return json({ error: "Shop not found" });

  if (intent === "accept") {
    const res = await acceptQuestline({
      shopId: shop.id,
      templateKey: (form.get("template") as string) || "",
      avatarId: ((form.get("avatarId") as string) || "").trim() || null,
      avatarVariant: parseInt((form.get("avatarVariant") as string) || "0", 10) || 0,
      reviewMode: (form.get("reviewMode") as "REVIEW_FIRST" | "SET_AND_FORGET") || "REVIEW_FIRST",
      productTitle: (form.get("productTitle") as string) || "",
      productImageUrl: ((form.get("productImageUrl") as string) || "").trim() || null,
    });
    return json(res.ok ? { accepted: true } : { error: res.error });
  }

  if (intent === "pauseToggle") {
    const id = (form.get("questlineId") as string) || "";
    const q = await db.questline.findFirst({ where: { id, shopId: shop.id } });
    if (q && q.status !== "COMPLETE") {
      await db.questline.update({ where: { id }, data: { status: q.status === "ACTIVE" ? "PAUSED" : "ACTIVE" } });
    }
    return json({ ok: true });
  }

  if (intent === "delete") {
    await db.questline.deleteMany({ where: { id: (form.get("questlineId") as string) || "", shopId: shop.id } });
    return json({ ok: true });
  }

  return json({ ok: true });
};

const OBJ_ICON: Record<string, string> = { video: "🎬", image: "🖼", blog: "📝", post: "📣" };

export default function Campaigns() {
  const { questlines, products, tokens, tier, brandFace, castAvail } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const err = actionData && "error" in actionData ? (actionData.error as string) : null;

  const available = AVATARS.filter((a) => castAvail[a.id]);
  const [starId, setStarId] = useState<string>(brandFace?.id && castAvail[brandFace.id] ? brandFace.id : available[0]?.id || "");
  const starVariant = brandFace?.id === starId ? brandFace.variant : 0;
  const [pick, setPick] = useState<{ id: string; title: string; image: string | null } | null>(null);
  const [reviewMode, setReviewMode] = useState<"REVIEW_FIRST" | "SET_AND_FORGET">("REVIEW_FIRST");

  const accept = (template: string) => {
    submit(
      {
        intent: "accept", template, productTitle: pick?.title || "",
        productImageUrl: pick?.image || "", avatarId: starId, avatarVariant: String(starVariant), reviewMode,
      },
      { method: "post" }
    );
  };

  const active = questlines.filter((q) => q.status !== "COMPLETE");
  const done = questlines.filter((q) => q.status === "COMPLETE");
  const canRun = (minTier: string) => (TIER_RANK[tier] ?? 0) >= (TIER_RANK[minTier] ?? 1);
  const star = starId ? AVATAR_BY_ID[starId] : null;

  return (
    <Page
      title="Campaign Quests"
      backAction={{ content: "Home", url: "/app" }}
      subtitle="Pick your Brand Face, accept a Questline, and let the arcade run your marketing on autopilot."
    >
      <Layout>
        <Layout.Section>
          <div className="mm-hero">
            <span className="mm-eyebrow">▶ CAMPAIGN QUESTS · AUTOPILOT</span>
            <h1><span className="mm-marquee">Accept the quest. Beat the algorithm.</span></h1>
            <p>
              Each Questline is an automated content mission — we generate the ads
              with your Brand Face and (once your accounts are connected) post them
              for you. Complete objectives to earn XP and loot.
            </p>
            <div className="mm-hero-stats">
              <div className="mm-hero-stat"><div className="k">TOKENS</div><div className="v">{tokens.toLocaleString()}</div></div>
              <div className="mm-hero-stat"><div className="k">ACTIVE QUESTS</div><div className="v cyan">{active.length}</div></div>
            </div>
          </div>
        </Layout.Section>

        {err && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't accept that quest"><p>{err}</p></Banner>
          </Layout.Section>
        )}
        {actionData && "accepted" in actionData && (
          <Layout.Section>
            <Banner tone="success" title="⚔️ Quest accepted!"><p>Your content is being forged now — watch the objectives tick below as the autopilot works.</p></Banner>
          </Layout.Section>
        )}

        {/* Loadout: brand face + product + review mode */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Your loadout</Text>
              <InlineStack gap="400" blockAlign="center" wrap>
                {star && castAvail[star.id] && (
                  <span className="mm-cast-tag"><img src={avatarImg(star.id, starVariant)} alt="" /> {star.name}</span>
                )}
                <Box minWidth="200px">
                  <Select
                    label="Star presenter (Brand Face)"
                    options={available.map((a) => ({ label: a.name + (brandFace?.id === a.id ? " ★" : ""), value: a.id }))}
                    value={starId}
                    onChange={setStarId}
                  />
                </Box>
                <Box minWidth="200px">
                  <Select
                    label="Publishing"
                    options={[
                      { label: "Review first (approve each)", value: "REVIEW_FIRST" },
                      { label: "Set & forget (auto-post)", value: "SET_AND_FORGET" },
                    ]}
                    value={reviewMode}
                    onChange={(v) => setReviewMode(v as "REVIEW_FIRST" | "SET_AND_FORGET")}
                  />
                </Box>
              </InlineStack>

              {products.length > 0 && (
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingSm" as="h3">Product to promote</Text>
                    {pick && <Badge tone="success">{pick.title.length > 30 ? pick.title.slice(0, 30) + "…" : pick.title}</Badge>}
                  </InlineStack>
                  <div className="mm-prodgrid">
                    {products.map((p) => (
                      <button key={p.id} type="button" className={`mm-prodcard${pick?.id === p.id ? " on" : ""}`} onClick={() => setPick(pick?.id === p.id ? null : p)}>
                        {pick?.id === p.id && <span className="mm-prodcheck">✓</span>}
                        {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="mm-prodph">🛍️</div>}
                        <span className="mm-prodtitle">{p.title}</span>
                      </button>
                    ))}
                  </div>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Active questlines — the live quest log */}
        {active.length > 0 && (
          <Layout.Section>
            <span className="mm-section-label">▶ ACTIVE QUESTS<span className="mm-dots">· · · · ·</span></span>
            <div className="mm-quest-grid">
              {active.map((q) => {
                const cm = q.avatarId ? AVATAR_BY_ID[q.avatarId] : null;
                const def = QUESTLINE_BY_KEY[q.template];
                return (
                  <div key={q.id} className="mm-quest">
                    <div className="mm-quest-head">
                      <span className="mm-quest-icon">{def?.icon || "⚔️"}</span>
                      <div className="mm-quest-title">
                        <div className="nm">{q.name}</div>
                        <div className="sub">{q.productTitle}{cm ? ` · ${cm.name}` : ""}</div>
                      </div>
                      <Badge tone={q.status === "PAUSED" ? "warning" : "attention"}>{q.status}</Badge>
                    </div>
                    <div className="mm-quest-bar"><i style={{ width: `${q.progress}%` }} /></div>
                    <div className="mm-quest-objs">
                      {q.objectives.map((o) => (
                        <div key={o.key} className={`mm-obj${o.done >= o.target ? " done" : ""}`}>
                          <span className="ck">{o.done >= o.target ? "✅" : OBJ_ICON[o.type] || "⬜"}</span>
                          <span className="lb">{o.label}</span>
                          <span className="ct">{o.done}/{o.target}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mm-quest-foot">
                      <span className="mm-cheer">🏆 {q.xpReward.toLocaleString()} XP</span>
                      <InlineStack gap="200">
                        <Button size="slim" onClick={() => submit({ intent: "pauseToggle", questlineId: q.id }, { method: "post" })}>
                          {q.status === "PAUSED" ? "Resume" : "Pause"}
                        </Button>
                        <Button size="slim" tone="critical" variant="tertiary" onClick={() => { if (confirm("Abandon this quest? Content already made is kept.")) submit({ intent: "delete", questlineId: q.id }, { method: "post" }); }}>🗑</Button>
                      </InlineStack>
                    </div>
                  </div>
                );
              })}
            </div>
          </Layout.Section>
        )}

        {/* Questline gallery — accept a new mission */}
        <Layout.Section>
          <span className="mm-section-label">▶ CHOOSE A QUESTLINE<span className="mm-dots">· · · · ·</span></span>
          {available.length === 0 && (
            <Box paddingBlockEnd="300"><Banner tone="warning"><p>Your presenter cast is still loading — quests need a Brand Face to star in the content.</p></Banner></Box>
          )}
          <div className="mm-questpick-grid">
            {QUESTLINES.map((q) => {
              const cost = questlineTokenCost(q);
              const locked = !canRun(q.minTier);
              const affordable = tokens >= cost;
              return (
                <div key={q.key} className={`mm-questcard${locked ? " locked" : ""}`}>
                  <div className="mm-questcard-head">
                    <span className="ic">{q.icon}</span>
                    <div className="nm">{q.name}</div>
                    {q.recurring && <span className="mm-recur">MONTHLY</span>}
                  </div>
                  <p className="tag">{q.tagline}</p>
                  <div className="mm-questcard-objs">
                    {q.objectives.map((o, i) => (
                      <div key={i} className="row"><span>{OBJ_ICON[o.type]}</span> {o.target}× {o.label}</div>
                    ))}
                  </div>
                  <div className="mm-questcard-foot">
                    <span className="cost">🪙 {cost.toLocaleString()}{q.recurring ? "/mo" : ""}</span>
                    <span className="xp">🏆 {q.xpReward.toLocaleString()} XP</span>
                  </div>
                  {locked ? (
                    <Button fullWidth disabled>🔒 {q.minTier[0] + q.minTier.slice(1).toLowerCase()} plan</Button>
                  ) : (
                    <button
                      type="button"
                      className="mm-arcade-btn mm-quest-accept"
                      disabled={busy || !pick || !affordable || !starId}
                      onClick={() => accept(q.key)}
                    >
                      {!pick ? "Pick a product ↑" : !affordable ? "Not enough 🪙" : busy ? "…" : "▶ ACCEPT QUEST"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <Box paddingBlockStart="300">
            <Text variant="bodySm" as="p" tone="subdued">
              Token cost covers content creation. Actual ad spend runs on your own connected TikTok/Meta account — we never touch your budget.
            </Text>
          </Box>
        </Layout.Section>

        {done.length > 0 && (
          <Layout.Section>
            <span className="mm-section-label">▶ COMPLETED</span>
            <BlockStack gap="200">
              {done.map((q) => (
                <Card key={q.id}>
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="headingSm" as="h3">{QUESTLINE_BY_KEY[q.template]?.icon} {q.name} — {q.productTitle}</Text>
                    <InlineStack gap="200"><Badge tone="success">COMPLETE</Badge><span className="mm-cheer">+{q.xpReward.toLocaleString()} XP</span></InlineStack>
                  </InlineStack>
                </Card>
              ))}
            </BlockStack>
          </Layout.Section>
        )}

        {active.length === 0 && done.length === 0 && (
          <Layout.Section>
            <EmptyState heading="No quests yet" image="">
              <p>Set your loadout above, then accept your first Questline to put your marketing on autopilot.</p>
            </EmptyState>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
