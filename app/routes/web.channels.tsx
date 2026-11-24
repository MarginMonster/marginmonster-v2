/* Channels — the Creator section's autopilot. Pick a vibe once; EASYMODE writes,
 * voices, captions, scores and POSTS a fresh faceless video on a cadence, hands
 * off. Reuses the faceless pipeline + the upload-post provider + the token
 * prepay/refund safety (see creator-series.server.ts). Green-on-cream premium,
 * "videos/week" not token-math, reliability + approve-gate up front. */

import { json, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { requireWebIdentity } from "../lib/web-auth.server";
import { db } from "../db.server";
import { tokensRemainingLive } from "../lib/tokens.server";
import { TOKEN_COST } from "../lib/plan-config";
import { xpForSpend } from "../lib/achievements";
import { CADENCE, cadenceOf, parsePlatforms } from "../lib/creator-series.server";
import { socialProviderEnabled, linkedFromCache } from "../lib/social-provider.server";
import { VIDEO_PLATFORMS, networkName } from "../lib/social-networks";
import { shopVoiceClones } from "../lib/voice-clone.server";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { readUiLang, tr } from "../lib/ui-i18n";
// (2026-11-24) A CHARACTER'S SHOW: a channel whose every drop is an episode starring one of the cast
import { CHARACTER_SERIES_MAX, SHOWS, SHOW_CADENCES, episodesByShow, parseStar, showMetaNeedle, showOf, signoffOf, type ShowEpisode } from "../lib/character-series";
import { LIVE_AVATARS, STOCK_CHARACTERS, avatarImg, styleId } from "../lib/avatars";
import { isAdminEmail } from "../lib/admin.server";

/** Who can star in a show: the shop's own characters and presenters first, then the stock characters, then
 *  the stock presenters — each as the cast has them (their picture, what they are, their voice). */
async function showRoster(shopId: string): Promise<Array<{ id: string; name: string; /** which STYLE of the character this is ("Film") */ tag?: string; img: string; kind: "person" | "cartoon" | "monster"; look: string; voiceId: string | null }>> {
  const { customCastFor, stockVoicesFor } = await import("../lib/custom-avatars.server");
  const [custom, stockVoice] = await Promise.all([customCastFor(shopId), stockVoicesFor(shopId)]);
  return [
    ...custom.filter((c) => !!c.img && c.status !== "failed").map((c) => ({ id: c.id, name: c.name, img: c.img as string, kind: (c.kind || "person") as "person" | "cartoon" | "monster", look: (c.desc || "").slice(0, 220), voiceId: c.voiceId || null })),
    // (…and each of a stock character's other STYLES right after it — the same somebody, the same voice,
    //  its own picture and words: avatars.ts → AvatarStyle)
    ...STOCK_CHARACTERS.flatMap((a) => {
      const kind = (a.kind || "person") as "person" | "cartoon" | "monster";
      const voiceId = stockVoice[a.id] || a.voiceId || null;
      return [
        { id: a.id, name: a.name, img: avatarImg(a.id, 0), kind, look: (a.desc || "").slice(0, 220), voiceId },
        ...(a.styles || []).map((st) => ({ id: styleId(a.id, st.key), name: a.name, tag: st.label, img: st.img, kind, look: (st.desc || "").slice(0, 220), voiceId })),
      ];
    }),
    ...LIVE_AVATARS.map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), kind: "person" as const, look: (a.desc || "").slice(0, 220), voiceId: stockVoice[a.id] || null })),
  ].slice(0, 80);
}

export const meta = ({ matches }: { matches: Array<{ id: string; data: unknown }> }) => {
  const uiLang = (matches.find((m) => m.id === "root")?.data as { uiLang?: string } | null)?.uiLang;
  return [{ title: tr((uiLang || "en") as Parameters<typeof tr>[0], "Channels") + " · EasyMode" }];
};

// A channel posts videos: every linked network that takes one (social-networks.ts is the one list).
const SOCIAL = VIDEO_PLATFORMS;
const PLAT_LABEL: Record<string, string> = Object.fromEntries(VIDEO_PLATFORMS.map((p) => [p, networkName(p)]));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  // CHARACTER SHOWS — a third kind of channel. Open to the owner's own account until it has a price (an
  // episode is a film, and films are free today): everyone else sees the page as it was.
  const url = new URL(request.url);
  const showsOpen = isAdminEmail(account.email);
  const kind: "show" | "vibe" = showsOpen && url.searchParams.get("kind") === "show" ? "show" : "vibe";

  let canUse = false;
  if (shop.activePlan) {
    try {
      const { assertCapability } = await import("../lib/capabilities.server");
      assertCapability(shop.activePlan, "video");
      canUse = true;
    } catch { canUse = false; }
  }

  const providerOn = socialProviderEnabled();
  const linked = providerOn ? linkedFromCache(shop.socialsJson).filter((p) => (SOCIAL as readonly string[]).includes(p)) : [];

  const rows = await db.creatorSeries.findMany({
    where: { shopId: shop.id, status: { not: "ENDED" } },
    orderBy: { createdAt: "desc" },
    take: 24,
  });
  // A SHOW'S EPISODES, on its own card: the pieces whose meta says they are an episode of it, newest
  // first, each as its poster (character-series.ts → episodesByShow). One read for all the shows shown.
  const showIds = kind === "show" ? rows.filter((s) => s.sourceType === "character").map((s) => s.id) : [];
  let episodes: Record<string, ShowEpisode[]> = {};
  if (showIds.length) {
    try {
      const pieces = await db.asset.findMany({
        where: { shopId: shop.id, type: "VIDEO_AD", OR: showIds.map((id) => ({ metaJson: { contains: showMetaNeedle(id) } })) },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: { id: true, title: true, metaJson: true },
      });
      episodes = episodesByShow(pieces, showIds, 4);
    } catch (e) { console.error(`[channels] a show's episodes could not be read (the cards show without them): ${e instanceof Error ? e.message.slice(0, 140) : e}`); }
  }
  const series = rows.filter((s) => (s.sourceType === "character") === (kind === "show")).map((s) => {
    const cad = cadenceOf(s.cadence);
    const star = s.sourceType === "character" ? parseStar(s.characterJson) : null;
    return {
      id: s.id,
      name: s.name,
      niche: s.niche,
      // …its latest episodes (a show only): each one's number, own name, poster, and the piece to open
      episodes: (episodes[s.id] || []).map((e) => ({ id: e.assetId, n: e.episode, title: e.title, poster: e.poster })),
      // a character's show: who stars, and what kind of show it is
      star: star ? { name: star.name, img: star.faceUrl } : null,
      showName: s.sourceType === "character" ? (showOf(s.format)?.name || "") : "",
      signoff: s.sourceType === "character" ? (s.signoff || "") : "",
      format: s.format,
      voiceKey: s.voiceKey,
      cadence: s.cadence,
      perWeek: cad.perWeek,
      platforms: parsePlatforms(s.platformsJson),
      autoPost: s.autoPost,
      status: s.status,
      pauseReason: s.pauseReason,
      dropsMade: s.dropsMade,
      dropsPosted: s.dropsPosted,
      nextRunAt: s.status === "ACTIVE" && s.nextRunAt ? s.nextRunAt.toISOString() : null,
    };
  });

  return json({
    name: account.name?.trim()?.split(" ")[0] || account.email.split("@")[0],
    tokens: tokensRemainingLive(shop.activePlan),
    facelessCost: TOKEN_COST.faceless,
    canUse,
    providerOn,
    linked,
    series,
    cadences: Object.entries(CADENCE).filter(([key]) => kind !== "show" || SHOW_CADENCES.includes(key)).map(([key, v]) => ({ key, label: v.label, perWeek: v.perWeek })),
    kind, showsOpen,
    shows: SHOWS.map((s) => ({ key: s.key, name: s.name, line: s.line })),
    roster: kind === "show" ? (await showRoster(shop.id)).map((r) => ({ id: r.id, name: r.name, tag: r.tag || "", img: r.img, kind: r.kind })) : [],
    starId: (url.searchParams.get("star") || "").slice(0, 80),
    showsMax: CHARACTER_SERIES_MAX,
    // the shop's own recorded voices — offered as narrators next to the stock four
    myVoices: (await shopVoiceClones(shop.id)).map((v) => ({ id: v.id, voiceId: v.voiceId, label: v.label, preview: v.preview })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const lang = readUiLang(request);
  const form = await request.formData();
  const intent = (form.get("intent") as string) || "";

  const mine = async (id: string) =>
    (await db.creatorSeries.findFirst({ where: { id, shopId: shop.id }, select: { id: true } }))?.id;

  if (intent === "pause") {
    const id = await mine((form.get("id") as string) || "");
    if (id) await db.creatorSeries.update({ where: { id }, data: { status: "PAUSED", pauseReason: "user" } });
    return json({ ok: true });
  }
  if (intent === "resume") {
    const id = await mine((form.get("id") as string) || "");
    if (id) await db.creatorSeries.update({ where: { id }, data: { status: "ACTIVE", pauseReason: null, nextRunAt: new Date(Date.now() + 60_000) } });
    return json({ ok: true });
  }
  if (intent === "end") {
    const id = await mine((form.get("id") as string) || "");
    if (id) await db.creatorSeries.update({ where: { id }, data: { status: "ENDED", nextRunAt: null } });
    return json({ ok: true });
  }

  if (intent === "create") {
    // Gate: channels render faceless, which rides the video capability.
    let canUse = false;
    if (shop.activePlan) {
      try { const { assertCapability } = await import("../lib/capabilities.server"); assertCapability(shop.activePlan, "video"); canUse = true; } catch { canUse = false; }
    }
    // "Legend", not "Anthem": Anthem is only the tier's internal key — the plans page sells Starter, Studio and Legend.
    if (!canUse) return json({ error: tr(lang, "Channels need a plan with video — upgrade to Studio or Legend.") }, { status: 400 });

    // A CHARACTER'S SHOW (lib/character-series.ts): who stars is looked up in THIS shop's own cast — the
    // page sends only an id — and a show starts on the next tick like any channel.
    if (((form.get("kind") as string) || "") === "show") {
      if (!isAdminEmail(account.email)) return json({ error: tr(lang, "Character shows are not open yet.") }, { status: 403 });
      const show = showOf(((form.get("show") as string) || "").trim());
      const pick = (await showRoster(shop.id)).find((r) => r.id === ((form.get("star") as string) || "").trim());
      const star = pick ? parseStar({ id: pick.id, name: pick.name, faceUrl: pick.img, kind: pick.kind, look: pick.look, voiceId: pick.voiceId }) : null;
      if (!star) return json({ error: tr(lang, "Pick who stars in the show.") }, { status: 400 });
      if (!show) return json({ error: tr(lang, "Pick what kind of show it is.") }, { status: 400 });
      const showCadence = ((form.get("cadence") as string) || "3x_week").trim();
      if (!SHOW_CADENCES.includes(showCadence)) return json({ error: tr(lang, "Pick a posting cadence.") }, { status: 400 });
      const running = await db.creatorSeries.count({ where: { shopId: shop.id, sourceType: "character", status: "ACTIVE" } });
      if (running >= CHARACTER_SERIES_MAX) return json({ error: tr(lang, "That is as many shows as can run at once — pause or end one first.") }, { status: 400 });
      const showAuto = (form.get("autoPost") as string) === "1";
      const showPlats = ((form.get("platforms") as string) || "").split(",").map((s) => s.trim()).filter((p) => (SOCIAL as readonly string[]).includes(p));
      if (showAuto) {
        const linkedNow = socialProviderEnabled() ? linkedFromCache(shop.socialsJson).filter((p) => (SOCIAL as readonly string[]).includes(p)) : [];
        const targets = showPlats.length ? showPlats.filter((p) => linkedNow.includes(p)) : linkedNow;
        if (targets.length === 0) return json({ error: tr(lang, "Connect a social account first (or switch to “Let me approve each one”).") }, { status: 400 });
      }
      const about = ((form.get("niche") as string) || "").replace(/\s+/g, " ").trim().slice(0, 160);
      const showTitle = ((form.get("name") as string) || "").replace(/\s+/g, " ").trim().slice(0, 60);
      await db.creatorSeries.create({
        data: {
          shopId: shop.id,
          name: showTitle || `${star.name}: ${show.name}`.slice(0, 60),
          niche: about || show.line,
          sourceType: "character",
          format: show.key,
          characterJson: JSON.stringify(star),
          signoff: signoffOf(form.get("signoff")) || null,
          cadence: showCadence,
          platformsJson: JSON.stringify(showPlats),
          autoPost: showAuto,
          status: "ACTIVE",
          // (the first episode starts on the next worker tick, like any channel's first drop)
          nextRunAt: new Date(Date.now() + 60_000),
        },
      });
      return redirect("/web/channels?kind=show");
    }

    const name = ((form.get("name") as string) || "").trim().slice(0, 60);
    const niche = ((form.get("niche") as string) || "").trim().slice(0, 160);
    const format = ((form.get("format") as string) || "facts").trim();
    const voiceKey = ((form.get("voiceKey") as string) || "f-warm").trim();
    const cadence = ((form.get("cadence") as string) || "3x_week").trim();
    const autoPost = (form.get("autoPost") as string) === "1";
    const platforms = ((form.get("platforms") as string) || "")
      .split(",").map((s) => s.trim()).filter((p) => (SOCIAL as readonly string[]).includes(p));

    if (!niche) return json({ error: tr(lang, "Give your channel a vibe — what's it about?") }, { status: 400 });
    if (!CADENCE[cadence]) return json({ error: tr(lang, "Pick a posting cadence.") }, { status: 400 });

    if (autoPost) {
      const linked = socialProviderEnabled() ? linkedFromCache(shop.socialsJson).filter((p) => (SOCIAL as readonly string[]).includes(p)) : [];
      const targets = platforms.length ? platforms.filter((p) => linked.includes(p)) : linked;
      if (targets.length === 0) return json({ error: tr(lang, "Connect a social account first (or switch to “Let me approve each one”).") }, { status: 400 });
    }

    await db.creatorSeries.create({
      data: {
        shopId: shop.id,
        name: name || niche.slice(0, 48),
        niche,
        format,
        voiceKey,
        cadence,
        platformsJson: JSON.stringify(platforms),
        autoPost,
        status: "ACTIVE",
        // First drop fires on the next worker tick (~2-3 min) so the channel
        // comes alive right after you press start.
        nextRunAt: new Date(Date.now() + 60_000),
      },
    });
    try { const { unlockAchievement } = await import("../lib/xp.server"); await unlockAchievement(shop.id, "CHANNEL_FIRST"); } catch { /* non-fatal */ }
    return redirect("/web/channels");
  }

  return json({ error: tr(lang, "Unknown action.") }, { status: 400 });
};

/* ---------------- UI ---------------- */

const FORMATS: [string, string][] = [["motivational", "Motivational"], ["facts", "Facts"], ["storytime", "Storytime"], ["listicle", "Listicle"]];
// [key, label, sampleId] — the sampleId mirrors faceless-video.server VOICE_MAP so
// the ▶ plays the SAME pre-rendered /voice-samples/*.mp3 the pipeline actually uses
// (free, instant). Keep in sync if the server map changes.
const VOICES: [string, string, string][] = [
  ["f-warm", "Female · calm", "English_CalmWoman"],
  ["f-hype", "Female · hype", "English_ConfidentWoman"],
  ["m-warm", "Male · calm", "English_Trustworth_Man"],
  ["m-hype", "Male · hype", "English_magnetic_voiced_man"],
];
const NICHES = ["Deep ocean facts", "Stoic motivation", "Weird history", "Money & side hustles", "Mind-blowing science", "Space facts", "Fitness tips", "Life hacks", "Mythology stories", "True crime shorts"];

function relTime(iso: string | null, t: (s: string, p?: Record<string, string | number>) => string): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t("any minute now");
  const m = Math.round(ms / 60000);
  if (m < 60) return t("in {m} min", { m });
  const h = Math.round(m / 60);
  if (h < 24) return t("in {h}h", { h });
  return t("in {d}d", { d: Math.round(h / 24) });
}

type Series = ReturnType<typeof useLoaderData<typeof loader>>["series"][number];

export default function Channels() {
  const t = useT();
  const { name, tokens, facelessCost, canUse, linked, series, cadences, myVoices, kind, showsOpen, shows, roster, starId, showsMax } = useLoaderData<typeof loader>();
  const isShow = kind === "show";
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const nav = useNavigation();
  const creating = nav.state !== "idle" && nav.formData?.get("intent") === "create";

  // (arriving from a character's own page — "Give Howl a show" — the form is open with them picked,
  //  whatever shows there already are)
  const [showForm, setShowForm] = useState(series.length === 0 || (isShow && !!starId && roster.some((r) => r.id === starId)));
  // "Start my channel" redirects the page to itself: no message, and the form stayed open, still filled,
  // with its button live — so a second tap made a second channel on the same schedule (nothing checks for
  // a duplicate). When the list grows, the form closes, and what shows is the new card with its
  // "First video rendering…" line.
  const seriesCount = useRef(series.length);
  useEffect(() => {
    if (series.length > seriesCount.current) setShowForm(false);
    seriesCount.current = series.length;
  }, [series.length]);

  return (
    <div className="ch">
      <style dangerouslySetInnerHTML={{ __html: CH_CSS }} />

      <div className="ch-srcswitch" role="group" aria-label={t("Channel source")}>
        <Link to="/web/product-channels" className="ch-src">{t("My products")}</Link>
        <Link to="/web/channels" className={`ch-src${isShow ? "" : " sel"}`} aria-current={isShow ? undefined : "page"}>{t("Trending topics")}</Link>
        {/* A CHARACTER'S SHOW — a channel whose every drop is an episode starring one of the cast */}
        {showsOpen && <Link to="/web/channels?kind=show" className={`ch-src${isShow ? " sel" : ""}`} aria-current={isShow ? "page" : undefined}>{t("Character shows")}</Link>}
      </div>

      <header className="ch-head">
        <div>
          <h1 className="ch-title">{isShow ? t("Character shows") : t("Channels")}</h1>
          {isShow
            ? <p className="ch-sub">{t("Give a character a show of their own — a new episode on repeat, starring them, told in their voice.")}{" "}<span className="ch-accent">{t("Hands off.")}</span></p>
            : <p className="ch-sub">{t("Put your content on autopilot — we write, voice & post a fresh video on repeat.")}{" "}<span className="ch-accent">{t("Hands off.")}</span></p>}
        </div>
        {series.length > 0 && canUse && (
          <button className="ch-newbtn" onClick={() => setShowForm((v) => !v)}>{showForm ? t("Close") : <><span className="ch-plus" aria-hidden="true">+</span> {isShow ? t("New show") : t("New channel")}</>}</button>
        )}
      </header>

      {!canUse && (
        <div className="ch-upsell">
          <div className="ch-upsell-ic"><Ico n="film" size={28} /></div>
          <div>
            <b>{t("Channels run on faceless video.")}</b>
            {/* "Legend" is what the plans page calls the top plan; "Anthem" is its internal key */}
            <p>{t("That's on the Studio & Legend plans. Upgrade and your channel can start posting today.")}</p>
          </div>
          <Link to="/web#plans" className="ch-go sm">{t("See plans")}</Link>
        </div>
      )}

      {canUse && showForm && isShow && (
        <ShowForm roster={roster} shows={shows} starId={starId} linked={linked} cadences={cadences} running={series.filter((s) => s.status === "ACTIVE").length} max={showsMax} error={actionData?.error} creating={creating} onCancel={series.length ? () => setShowForm(false) : undefined} />
      )}
      {canUse && showForm && !isShow && (
        <SetupForm linked={linked} tokens={tokens} facelessCost={facelessCost} cadences={cadences} myVoices={myVoices} error={actionData?.error} creating={creating} onCancel={series.length ? () => setShowForm(false) : undefined} />
      )}

      {series.length > 0 && (
        <div className="ch-grid">
          {/* (an episode of a show costs what a told story costs — nothing while films are free) */}
          {series.map((s) => <ChannelCard key={s.id} s={s} tokens={tokens} facelessCost={s.star ? 0 : facelessCost} />)}
        </div>
      )}

      {canUse && series.length === 0 && !showForm && (
        <div className="ch-empty">{isShow ? t("No shows yet —") : t("No channels yet —")} <button className="ch-link" onClick={() => setShowForm(true)}>{t("start one")}</button>.</div>
      )}
    </div>
  );
}

function SetupForm({ linked, tokens, facelessCost, cadences, myVoices, error, creating, onCancel }: {
  linked: string[]; tokens: number; facelessCost: number;
  cadences: { key: string; label: string; perWeek: number }[];
  myVoices: OwnVoice[];
  error?: string; creating: boolean; onCancel?: () => void;
}) {
  const t = useT();
  const [niche, setNiche] = useState("");
  const [name, setName] = useState("");
  const [format, setFormat] = useState("facts");
  const [voiceKey, setVoiceKey] = useState("f-warm");
  const [cadence, setCadence] = useState("3x_week");
  const [plats, setPlats] = useState<string[]>(linked);
  const [autoPost, setAutoPost] = useState(linked.length > 0);

  const perWeek = useMemo(() => cadences.find((c) => c.key === cadence)?.perWeek || 3, [cadence, cadences]);
  const weeklyTokens = perWeek * facelessCost;
  const canAfford = tokens >= facelessCost;
  // Honest runway: the summary advertises a weekly burn, so show how far the
  // wallet actually stretches at this cadence — drops it can cover and roughly
  // how many days that buys — and flag when it can't even cover one week.
  const dropsLeft = Math.floor(tokens / facelessCost);
  const daysLeft = perWeek > 0 ? Math.round((dropsLeft / perWeek) * 7) : 0;
  const coversWeek = tokens >= weeklyTokens;
  const heavyCadence = perWeek >= 14; // 2×/day
  const togglePlat = (p: string) => setPlats((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const disabled = creating || !niche.trim() || (autoPost && plats.length === 0) || !canAfford;

  return (
    <Form method="post" className="ch-setup">
      <input type="hidden" name="intent" value="create" />
      <input type="hidden" name="format" value={format} />
      <input type="hidden" name="voiceKey" value={voiceKey} />
      <input type="hidden" name="cadence" value={cadence} />
      <input type="hidden" name="platforms" value={plats.join(",")} />
      <input type="hidden" name="autoPost" value={autoPost ? "1" : "0"} />
      <input type="hidden" name="name" value={name || niche.slice(0, 48)} />

      <div className="ch-setup-head">
        <span className="ch-spark"><Ico n="sparkle" size={18} /></span> {t("Start a channel")}
        {onCancel && <button type="button" className="ch-x" onClick={onCancel} aria-label={t("Close")}><Ico n="x" size={16} /></button>}
      </div>

      <label className="ch-lbl">{t("What's it about?")}</label>
      <input className="ch-field" placeholder={t("e.g. mind-blowing deep ocean facts")} value={niche} maxLength={160}
        onChange={(e) => setNiche(e.target.value)} />
      <div className="ch-chips">
        {NICHES.map((n) => <button type="button" key={n} className={`ch-chip${niche === n ? " on" : ""}`} onClick={() => setNiche(n)}>{t(n)}</button>)}
      </div>

      <label className="ch-lbl">{t("Channel name")} <span className="ch-opt">{t("(optional)")}</span></label>
      <input className="ch-field" placeholder={niche ? niche.slice(0, 48) : t("Deep Ocean Facts")} value={name} maxLength={60}
        onChange={(e) => setName(e.target.value)} />

      <div className="ch-row2">
        <div>
          <label className="ch-lbl">{t("Format")}</label>
          <div className="ch-pills2">
            {FORMATS.map(([k, l]) => <button type="button" key={k} className={`ch-pill${format === k ? " sel" : ""}`} onClick={() => setFormat(k)}>{t(l)}</button>)}
          </div>
        </div>
        <div>
          <label className="ch-lbl">{t("Voice")}</label>
          <VoicePick value={voiceKey} onChange={setVoiceKey} myVoices={myVoices} />
        </div>
      </div>

      <label className="ch-lbl">{t("How often?")}</label>
      <div className="ch-cads">
        {cadences.map((c) => (
          <button type="button" key={c.key} className={`ch-cad${cadence === c.key ? " sel" : ""}`} onClick={() => setCadence(c.key)}>
            <b>{t(c.label)}</b>
            <span>{t("{n} videos/week", { n: c.perWeek })}</span>
          </button>
        ))}
      </div>
      {heavyCadence && <div className="ch-hint">{t("That's a lot — ~{n}/day. Great for growth, but it burns tokens fast.", { n: Math.round(perWeek / 7) })}</div>}

      <label className="ch-lbl">{t("Where it posts")}</label>
      {linked.length > 0 ? (
        <div className="ch-chips">
          {linked.map((p) => <button type="button" key={p} className={`ch-chip plat${plats.includes(p) ? " on" : ""}`} onClick={() => togglePlat(p)}>{plats.includes(p) && <Ico n="check" size={13} className="ch-chip-chk" />}{PLAT_LABEL[p]}</button>)}
        </div>
      ) : (
        <div className="ch-connect">{t("No socials linked yet —")} <Link to="/web/connect" className="ch-link">{t("connect your socials")}</Link> {t("to post automatically. You can still start in approve mode below.")}</div>
      )}

      <label className="ch-lbl">{t("Posting")}</label>
      <div className="ch-modes">
        <button type="button" className={`ch-mode${autoPost ? " sel" : ""}`} disabled={linked.length === 0} onClick={() => setAutoPost(true)}>
          <b><Ico n="sparkle" /> {t("Post automatically")}</b><span>{t("Each drop goes straight to your socials.")}</span>
        </button>
        <button type="button" className={`ch-mode${!autoPost ? " sel" : ""}`} onClick={() => setAutoPost(false)}>
          <b><Ico n="eye" /> {t("Let me approve each one")}</b><span>{t("Drops wait in your Archive — you post with one tap.")}</span>
        </button>
      </div>

      <div className="ch-summary">
        <span><b>{perWeek}</b> {t("videos/week")} · ~<b>{weeklyTokens}</b> {t("tokens / wk")} · <b>+{xpForSpend(weeklyTokens)}</b> {t("XP / wk")}</span>
        <span className="ch-bal">{t("{tokens} tokens in wallet", { tokens })}</span>
      </div>
      {canAfford && (
        <div className="ch-runway">{t("Your wallet covers ~{drops} drops — about {days} days at this cadence.", { drops: dropsLeft, days: daysLeft })}</div>
      )}

      {error && <div className="ch-err">{error}</div>}
      {!canAfford && <div className="ch-err">{t("You need at least {n} tokens to run a channel —", { n: facelessCost })} <Link to="/web#plans" className="ch-link">{t("top up")}</Link>.</div>}
      {canAfford && !coversWeek && <div className="ch-warn">{t("Heads up — your wallet won't cover a full week at this cadence (~{n} tokens/wk). The channel pauses itself when it runs low —", { n: weeklyTokens })} <Link to="/web#plans" className="ch-link">{t("top up")}</Link>.</div>}

      {/* The button below stays off until there is a topic and — when it posts by itself — a place to post.
          It said neither: a new form simply had a dead "Start my channel". These are the two sentences the
          server answers with for the same two gaps, shown before the tap instead of never. */}
      {!niche.trim() && <div className="ch-hint">{t("Give your channel a vibe — what's it about?")}</div>}
      {autoPost && plats.length === 0 && <div className="ch-hint">{t("Connect a social account first (or switch to “Let me approve each one”).")}</div>}

      <button className="ch-go" type="submit" disabled={disabled}>
        <span className="ch-go-flower" aria-hidden="true" />
        {creating ? t("Starting…") : <>{t("Start my channel")} <Ico n="rocket" /></>}
      </button>
    </Form>
  );
}

/* A CHARACTER'S SHOW — its setup. Five small decisions, in the order a person would say them: who stars,
 * what kind of show, what it is about, the line it always ends on, how often. It starts in "approve"
 * mode: the first episodes are looked at before anything is posted. */
function ShowForm({ roster, shows, starId, linked, cadences, running, max, error, creating, onCancel }: {
  roster: Array<{ id: string; name: string; tag?: string; img: string; kind: string }>;
  shows: Array<{ key: string; name: string; line: string }>;
  starId: string; linked: string[];
  cadences: { key: string; label: string; perWeek: number }[];
  running: number; max: number;
  error?: string; creating: boolean; onCancel?: () => void;
}) {
  const t = useT();
  const [star, setStar] = useState(roster.some((r) => r.id === starId) ? starId : "");
  const [show, setShow] = useState(shows[0]?.key || "");
  const [about, setAbout] = useState("");
  const [name, setName] = useState("");
  const [signoff, setSignoff] = useState("");
  const [cadence, setCadence] = useState("3x_week");
  const [plats, setPlats] = useState<string[]>(linked);
  const [autoPost, setAutoPost] = useState(false);
  const who = roster.find((r) => r.id === star);
  const kindOf = shows.find((s) => s.key === show);
  const autoName = who && kindOf ? `${who.name}: ${t(kindOf.name)}` : "";
  const perWeek = cadences.find((c) => c.key === cadence)?.perWeek || 3;
  const full = running >= max;
  const togglePlat = (p: string) => setPlats((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const disabled = creating || !who || !kindOf || full || (autoPost && plats.length === 0);
  // whoever arrived already picked (from their own page) is brought into view in the row — the row is
  // scrolled, never the page
  const starsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const row = starsRef.current;
    const el = row?.querySelector<HTMLElement>(".ch-star.sel");
    if (row && el) row.scrollLeft = Math.max(0, el.offsetLeft - row.offsetLeft - (row.clientWidth - el.offsetWidth) / 2);
  }, []);
  return (
    <Form method="post" className="ch-setup">
      <input type="hidden" name="intent" value="create" />
      <input type="hidden" name="kind" value="show" />
      <input type="hidden" name="star" value={star} />
      <input type="hidden" name="show" value={show} />
      <input type="hidden" name="cadence" value={cadence} />
      <input type="hidden" name="platforms" value={plats.join(",")} />
      <input type="hidden" name="autoPost" value={autoPost ? "1" : "0"} />
      <input type="hidden" name="name" value={name || autoName} />

      <div className="ch-setup-head">
        <span className="ch-spark"><Ico n="sparkle" size={18} /></span> {t("Start a show")}
        {onCancel && <button type="button" className="ch-x" onClick={onCancel} aria-label={t("Close")}><Ico n="x" size={16} /></button>}
      </div>

      <label className="ch-lbl">{t("Who stars?")}</label>
      <div className="ch-stars" role="listbox" aria-label={t("Who stars?")} ref={starsRef}>
        {roster.map((r) => (
          <button type="button" key={r.id} role="option" aria-selected={star === r.id} className={`ch-star${star === r.id ? " sel" : ""}`} onClick={() => setStar(r.id)} title={r.name}>
            <img src={r.img} alt="" loading="lazy" />
            <span>{r.name}{r.tag ? <> · {t(r.tag)}</> : null}</span>
          </button>
        ))}
      </div>

      <label className="ch-lbl">{t("What kind of show?")}</label>
      <div className="ch-cads">
        {shows.map((s) => (
          <button type="button" key={s.key} className={`ch-cad${show === s.key ? " sel" : ""}`} onClick={() => setShow(s.key)}>
            <b>{t(s.name)}</b>
            <span>{t(s.line)}</span>
          </button>
        ))}
      </div>

      <label className="ch-lbl">{t("What's it about?")} <span className="ch-opt">{t("(optional)")}</span></label>
      <input className="ch-field" name="niche" placeholder={t("e.g. things nobody teaches you about money")} value={about} maxLength={160} onChange={(e) => setAbout(e.target.value)} />

      <div className="ch-row2">
        <div>
          <label className="ch-lbl">{t("Show name")} <span className="ch-opt">{t("(optional)")}</span></label>
          <input className="ch-field" placeholder={autoName || t("Howl: Night tales")} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="ch-lbl">{t("The line every episode ends on")} <span className="ch-opt">{t("(optional)")}</span></label>
          <input className="ch-field" name="signoff" placeholder={t("e.g. Stay quiet. Stay sharp.")} value={signoff} maxLength={120} onChange={(e) => setSignoff(e.target.value)} />
        </div>
      </div>

      <label className="ch-lbl">{t("How often?")}</label>
      <div className="ch-cads">
        {cadences.map((c) => (
          <button type="button" key={c.key} className={`ch-cad${cadence === c.key ? " sel" : ""}`} onClick={() => setCadence(c.key)}>
            <b>{t(c.label)}</b>
            <span>{t("{n} episodes/week", { n: c.perWeek })}</span>
          </button>
        ))}
      </div>

      <label className="ch-lbl">{t("Posting")}</label>
      <div className="ch-modes">
        <button type="button" className={`ch-mode${!autoPost ? " sel" : ""}`} onClick={() => setAutoPost(false)}>
          <b><Ico n="eye" /> {t("Let me approve each one")}</b><span>{t("Episodes wait in your Archive — you post with one tap.")}</span>
        </button>
        <button type="button" className={`ch-mode${autoPost ? " sel" : ""}`} disabled={linked.length === 0} onClick={() => setAutoPost(true)}>
          <b><Ico n="sparkle" /> {t("Post automatically")}</b><span>{t("Each episode goes straight to your socials.")}</span>
        </button>
      </div>
      {autoPost && linked.length > 0 && (
        <div className="ch-chips">
          {linked.map((p) => <button type="button" key={p} className={`ch-chip plat${plats.includes(p) ? " on" : ""}`} onClick={() => togglePlat(p)}>{plats.includes(p) && <Ico n="check" size={13} className="ch-chip-chk" />}{PLAT_LABEL[p]}</button>)}
        </div>
      )}

      <div className="ch-summary">
        <span><b>{perWeek}</b> {t("episodes/week")} · {t("about a minute each")}</span>
        <span className="ch-bal">{t("Free while films are free")}</span>
      </div>

      {error && <div className="ch-err">{error}</div>}
      {full && <div className="ch-err">{t("That is as many shows as can run at once — pause or end one first.")}</div>}
      {!who && <div className="ch-hint">{t("Pick who stars in the show.")}</div>}
      {autoPost && plats.length === 0 && <div className="ch-hint">{t("Connect a social account first (or switch to “Let me approve each one”).")}</div>}

      <button className="ch-go" type="submit" disabled={disabled}>
        <span className="ch-go-flower" aria-hidden="true" />
        {creating ? t("Starting…") : <>{t("Start the show")} <Ico n="rocket" /></>}
      </button>
    </Form>
  );
}

/* Voice picker with a ▶ that plays the real pre-rendered sample (free, instant)
 * so a merchant HEARS the voice before committing to weeks of it — this is a
 * channel that'll speak in this voice on repeat. Same /voice-samples/*.mp3 the
 * faceless pipeline uses; one <audio>, one playing at a time. */
type OwnVoice = { id: string; voiceId: string; label: string; preview: string };

function VoicePick({ value, onChange, myVoices }: { value: string; onChange: (k: string) => void; myVoices: OwnVoice[] }) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const done = () => setPlaying(null);
    a.addEventListener("ended", done);
    return () => a.removeEventListener("ended", done);
  }, []);
  const play = (src: string, key: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (playing === key) { a.pause(); setPlaying(null); return; }
    a.src = src;
    a.currentTime = 0;
    a.play().then(() => setPlaying(key)).catch(() => setPlaying(null));
  };
  return (
    <div className="ch-voices">
      {VOICES.map(([k, l, sampleId]) => {
        const sel = value === k;
        const on = playing === k;
        return (
          <div key={k} className={`ch-voice${sel ? " sel" : ""}`}>
            <button type="button" className="ch-voice-pick" onClick={() => onChange(k)} aria-pressed={sel}>{t(l)}</button>
            <button type="button" className={`ch-voice-play${on ? " on" : ""}`} onClick={() => play(`/voice-samples/${sampleId}.mp3`, k)}
              aria-label={on ? t("Stop preview") : t("Preview the {label} voice", { label: t(l) })}>
              {on ? <Ico n="sound" size={15} /> : <Ico n="play" size={15} />}
            </button>
          </div>
        );
      })}
      {/* the shop's own recorded voices ("own:<voiceId>" — re-checked when each video renders) */}
      {myVoices.map((v) => {
        const k = `own:${v.voiceId}`;
        const sel = value === k;
        const on = playing === k;
        return (
          <div key={k} className={`ch-voice${sel ? " sel" : ""}`}>
            <button type="button" className="ch-voice-pick own" onClick={() => onChange(k)} aria-pressed={sel} title={t("Your own voice")}><Ico n="mic" size={12} /> {v.label}</button>
            {v.preview ? (
              <button type="button" className={`ch-voice-play${on ? " on" : ""}`} onClick={() => play(v.preview, k)}
                aria-label={on ? t("Stop preview") : t("Preview the {label} voice", { label: v.label })}>
                {on ? <Ico n="sound" size={15} /> : <Ico n="play" size={15} />}
              </button>
            ) : null}
          </div>
        );
      })}
      <audio ref={audioRef} preload="none" />
    </div>
  );
}

/* Pausing is reversible, so this is a LIGHT confirm (one arm step) — not the
 * red arm-to-delete. First tap asks, a second within 4s actually pauses. */
function PauseForm({ id }: { id: string }) {
  const t = useT();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Form method="post" onSubmit={(e) => { if (!armed) { e.preventDefault(); setArmed(true); } }}>
      <input type="hidden" name="intent" value="pause" /><input type="hidden" name="id" value={id} />
      <button className={`ch-act${armed ? " warn" : ""}`}>{armed ? t("Pause?") : t("Pause")}</button>
    </Form>
  );
}

function ChannelCard({ s, tokens, facelessCost }: { s: Series; tokens: number; facelessCost: number }) {
  const t = useT();
  const paused = s.status === "PAUSED";
  const fmtLabel = FORMATS.find(([k]) => k === s.format)?.[1] || s.format;
  // "Next drop" is a live countdown — re-render active cards every 30s so it
  // doesn't read a stale "in 3 min" long after that minute has passed.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (s.status !== "ACTIVE") return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [s.status]);
  // End is permanent, so guard it behind the app's arm-to-confirm: first tap
  // arms the button, a second within 4s actually ends it. Auto-clears so a
  // stray tap is harmless. (Same pattern as the Archive delete.)
  const [armedEnd, setArmedEnd] = useState(false);
  useEffect(() => {
    if (!armedEnd) return;
    const timer = setTimeout(() => setArmedEnd(false), 4000);
    return () => clearTimeout(timer);
  }, [armedEnd]);
  const freshDrop = s.status === "ACTIVE" && s.dropsMade === 0;
  const reasonText: Record<string, string> = {
    "out-of-tokens": t("Out of tokens"),
    "no-accounts": t("No socials linked"),
    "needs-plan": t("Plan changed"),
    user: t("Paused by you"),
  };
  return (
    <div className={`ch-card${paused ? " paused" : ""}`}>
      <div className="ch-card-top">
        {s.star && <img className="ch-card-star" src={s.star.img} alt={s.star.name} loading="lazy" />}
        <div className="ch-card-who">
          <div className="ch-card-name">{s.name}</div>
          <div className="ch-card-niche">{s.star ? <>{t(s.showName)} · {s.niche}</> : <>{t(fmtLabel)} · {s.niche}</>}</div>
          {s.star && s.signoff ? <div className="ch-card-sign">“{s.signoff}”</div> : null}
        </div>
        {/* A SHOW IS ON AIR: the studio's own sign, lit while the show is running (a channel keeps its badge) */}
        {s.star ? <span className={`ch-onair${s.status === "ACTIVE" ? " live" : ""}`} role="status">{s.status === "ACTIVE" ? t("On air") : t("Off air")}</span> :
        <span className={`ch-badge ${s.status === "ACTIVE" ? "live" : "off"}`}>{s.status === "ACTIVE" ? <><span className="ch-run-dot" aria-hidden="true" /> {t("Running")}</> : <><span className="ch-pause-bars" aria-hidden="true" /> {t("Paused")}</>}</span>}
      </div>

      {/* ITS EPISODES, as their posters — the newest first; each opens in the Archive */}
      {s.star && s.episodes.length > 0 && (
        <div className="ch-eps" role="list" aria-label={t("Episodes")}>
          {s.episodes.map((e) => (
            <Link key={e.id} role="listitem" to={`/web/archive?section=creator&tab=video&open=${encodeURIComponent(e.id)}`} className="ch-ep" title={e.title ? `${t("Episode {n}", { n: e.n })} — ${e.title}` : t("Episode {n}", { n: e.n })}>
              {e.poster ? <img src={e.poster} alt={e.title || t("Episode {n}", { n: e.n })} loading="lazy" /> : <span className="ch-ep-none"><Ico n="film" size={16} /></span>}
              <b>{t("Ep {n}", { n: e.n })}</b>
            </Link>
          ))}
        </div>
      )}

      <div className="ch-card-meta">
        <span><b>{s.perWeek}</b> {s.star ? t("episodes/week") : t("videos/week")}</span>
        <span>{s.autoPost ? <><Ico n="sparkle" /> {t("auto-post")}</> : <><Ico n="eye" /> {t("approve")}</>}</span>
        {s.platforms.length > 0 && <span>{s.platforms.map((p) => PLAT_LABEL[p]).join(" · ")}</span>}
      </div>

      {freshDrop ? (
        <div className="ch-next rendering"><span className="ch-next-dot" /> {s.star ? t("First episode on its way…") : t("First video rendering…")}</div>
      ) : s.status === "ACTIVE" ? (
        <div className="ch-next"><span className="ch-next-dot" /> {s.star ? t("Next episode") : t("Next drop")} {relTime(s.nextRunAt, t) || t("any minute now")}</div>
      ) : null}
      {paused && s.pauseReason && (
        <div className="ch-paused-note">
          {reasonText[s.pauseReason] || t("Paused")}
          {s.pauseReason === "out-of-tokens" && <> — <Link to="/web#plans" className="ch-link">{t("top up")}</Link></>}
          {s.pauseReason === "no-accounts" && <> — <Link to="/web/connect" className="ch-link">{t("connect")}</Link></>}
        </div>
      )}
      {/* Resume (below) is off whenever the wallet cannot pay for one video — but the reason was said only
          when the engine itself had paused the channel for it. Paused by hand, or for a social, on a low
          wallet, the button was simply dead. */}
      {paused && tokens < facelessCost && s.pauseReason !== "out-of-tokens" && (
        <div className="ch-paused-note">{t("Out of tokens")} — <Link to="/web#plans" className="ch-link">{t("top up")}</Link></div>
      )}

      <div className="ch-card-stats">
        <div><b>{s.dropsMade}</b><span>{t("made")}</span></div>
        <div><b>{s.dropsPosted}</b><span>{t("posted")}</span></div>
        <Link to={s.star ? "/web/archive?section=creator&tab=video" : "/web/archive?section=creator"} className="ch-card-gal">{s.star ? t("All episodes") : t("All drops")} →</Link>
      </div>

      <div className="ch-card-acts">
        {paused ? (
          <Form method="post"><input type="hidden" name="intent" value="resume" /><input type="hidden" name="id" value={s.id} /><button className="ch-act primary" disabled={tokens < facelessCost}>{t("Resume")}</button></Form>
        ) : (
          <PauseForm id={s.id} />
        )}
        <Form method="post" onSubmit={(e) => { if (!armedEnd) { e.preventDefault(); setArmedEnd(true); } }}>
          <input type="hidden" name="intent" value="end" /><input type="hidden" name="id" value={s.id} />
          <button className={`ch-act ghost${armedEnd ? " armed" : ""}`} title={armedEnd ? (s.star ? t("Tap again to end — the show stops making new episodes") : t("Tap again to end — the channel stops making new videos")) : s.star ? t("End this show") : t("End this channel")}>{armedEnd ? t("Tap again to end") : t("End")}</button>
        </Form>
      </div>
    </div>
  );
}

const CH_CSS = `
.ch{--l:#E7E2D2;--ink:#14201A;--ink2:#5B6B61;--ink3:#8A968E;--g:#0C7A46;--g2:#12A85E;--paper:#FFFDF7;
  --sh-sm:0 1px 2px rgba(20,32,26,.05);--sh-md:0 2px 6px rgba(20,32,26,.05),0 14px 34px -14px rgba(20,32,26,.16);
  max-width:none;margin:0 auto;padding:14px 16px 64px;font-family:Poppins,sans-serif;color:var(--ink);}
.ch-srcswitch{display:inline-flex;flex-wrap:wrap;gap:4px;background:#fff;border:1px solid #E2DCC8;border-radius:22px;padding:4px;margin:0 0 16px;max-width:100%;}
/* A CHARACTER'S SHOW: the row its star is picked from, and the star's face on the show's card */
.ch-stars{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 8px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
.ch-star{flex:0 0 76px;width:76px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:5px 3px 6px;border:2px solid transparent;border-radius:16px;background:none;font:inherit;color:inherit;cursor:pointer;scroll-snap-align:start;}
.ch-star img{width:60px;height:60px;border-radius:50%;object-fit:cover;object-position:center top;background:#EDE9DF;box-shadow:0 0 0 1px var(--l);}
.ch-star span{max-width:100%;font-size:11.5px;font-weight:700;line-height:1.2;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ch-star.sel{border-color:var(--g);background:#F0F8F3;}
.ch-star.sel img{box-shadow:0 0 0 2px var(--g);}
.ch-star:focus-visible{outline:3px solid rgba(12,122,70,.35);outline-offset:2px;}
.ch-card-star{flex:0 0 auto;width:48px;height:48px;border-radius:50%;object-fit:cover;object-position:center top;background:#EDE9DF;box-shadow:0 0 0 2px #fff,0 0 0 3px var(--l);margin-right:2px;}
.ch-card-who{flex:1 1 auto;min-width:0;}
/* ON AIR — a show's card carries the studio's own sign: a dark plate whose letters are lit, and breathe,
   while the show is running; unlit when it is paused. (Nothing moves for anyone who asked for less motion.) */
.ch-onair{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 9px;border-radius:7px;background:#1B1410;color:#7C7068;font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 1px 2px rgba(20,32,26,.2);}
.ch-onair::before{content:"";flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:#4A3F38;}
.ch-onair.live{color:#FF7466;text-shadow:0 0 8px rgba(255,90,74,.75);box-shadow:inset 0 0 0 1px rgba(255,106,92,.4),0 0 14px -2px rgba(229,72,58,.55);animation:chOnAir 2.6s ease-in-out infinite;}
.ch-onair.live::before{background:#FF5A4A;box-shadow:0 0 8px 1px rgba(255,90,74,.9);}
@keyframes chOnAir{0%,100%{box-shadow:inset 0 0 0 1px rgba(255,106,92,.4),0 0 14px -2px rgba(229,72,58,.55)}50%{box-shadow:inset 0 0 0 1px rgba(255,106,92,.55),0 0 22px 0 rgba(229,72,58,.85)}}
@media(prefers-reduced-motion:reduce){.ch-onair.live{animation:none;}}
/* …and its episodes, as their posters: the newest first */
.ch-eps{display:flex;gap:8px;margin:14px 0 2px;}
.ch-ep{position:relative;flex:1 1 0;min-width:0;max-width:78px;aspect-ratio:4/5;border-radius:9px;overflow:hidden;background:#1B1410;box-shadow:0 1px 2px rgba(20,32,26,.2),0 0 0 1px rgba(20,32,26,.08);text-decoration:none;transition:transform .14s,box-shadow .14s;}
.ch-ep img{display:block;width:100%;height:100%;object-fit:cover;}
/* (its number sits in the top corner: a poster's own title is drawn across its foot, and a tag laid there
   printed over it) */
.ch-ep b{position:absolute;left:5px;top:5px;padding:2px 6px 1px;border-radius:6px;background:rgba(20,14,10,.74);color:#F6E7C1;font-size:9.5px;font-weight:800;line-height:1.5;letter-spacing:.07em;text-transform:uppercase;white-space:nowrap;}
.ch-ep-none{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#8A7A6C;}
.ch-ep:hover{transform:translateY(-2px);box-shadow:0 6px 14px -6px rgba(20,32,26,.5),0 0 0 1px rgba(20,32,26,.1);}
.ch-ep:focus-visible{outline:3px solid rgba(12,122,70,.4);outline-offset:2px;}
@media(prefers-reduced-motion:reduce){.ch-ep{transition:none;}.ch-ep:hover{transform:none;}}
.ch-card-sign{margin-top:3px;font-size:12px;font-weight:600;font-style:italic;color:var(--ink2);overflow-wrap:anywhere;}
.ch-src{min-height:44px;display:inline-flex;align-items:center;padding:0 16px;border-radius:999px;font:inherit;font-weight:700;font-size:13px;color:#5B6B61;text-decoration:none;cursor:pointer;border:0;background:none;}
.ch-src.sel{background:linear-gradient(165deg,#12A85E,#0B6B3E);color:#fff;}
.ch-src:not(.sel):hover{color:#0C7A46;}
.ch-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px;}
.ch-title{font-size:30px;font-weight:800;letter-spacing:-.02em;margin:0;}
.ch-sub{margin:4px 0 0;color:var(--ink2);font-size:14px;font-weight:500;max-width:52ch;}
.ch-accent{background:linear-gradient(120deg,var(--g2),var(--g));-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700;}
.ch-newbtn{flex:0 0 auto;font:inherit;font-weight:700;font-size:13px;color:var(--g);background:#fff;border:1px solid var(--l);border-radius:999px;padding:9px 16px;cursor:pointer;box-shadow:var(--sh-sm);transition:all .12s;}
.ch-newbtn:hover{transform:translateY(-1px);box-shadow:var(--sh-md);}
.ch-plus{font-weight:800;font-size:15px;line-height:1;color:var(--g);}
.ch-upsell{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid var(--l);border-radius:18px;padding:18px 20px;box-shadow:var(--sh-sm);margin-bottom:22px;}
.ch-upsell-ic{font-size:30px;}
.ch-upsell b{font-size:15px;} .ch-upsell p{margin:2px 0 0;color:var(--ink2);font-size:13px;}

/* setup */
.ch-setup{position:relative;background:#fff;border:1px solid var(--l);border-radius:22px;padding:22px;box-shadow:var(--sh-md),inset 0 0 0 1px rgba(231,200,121,.22);margin-bottom:26px;}
.ch-setup-head{display:flex;align-items:center;gap:8px;font-weight:800;font-size:16px;margin-bottom:14px;}
.ch-spark{color:#C79A2E;display:inline-flex;align-items:center;}
.ch-x{margin-left:auto;border:0;background:transparent;color:var(--ink3);font-size:15px;cursor:pointer;line-height:1;}
.ch-lbl{display:block;font-weight:700;font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:var(--ink2);margin:16px 0 8px;}
.ch-lbl:first-of-type{margin-top:0;}
.ch-opt{text-transform:none;letter-spacing:0;color:var(--ink3);font-weight:500;}
.ch-field{width:100%;box-sizing:border-box;background:var(--paper);border:1px solid #E2DCC8;border-radius:14px;padding:13px 15px;font:inherit;font-size:14.5px;color:var(--ink);box-shadow:inset 0 1px 3px rgba(20,32,26,.055);transition:border-color .15s,box-shadow .15s;}
.ch-field:focus{outline:none;border-color:#9CCBB1;box-shadow:inset 0 1px 3px rgba(20,32,26,.045),0 0 0 3px rgba(12,122,70,.14);}
.ch-field::placeholder{color:#A9B2AA;}
.ch-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.ch-chip{font:inherit;font-weight:600;font-size:12.5px;color:var(--ink2);background:#fff;border:1px solid var(--l);border-radius:999px;padding:7px 13px;cursor:pointer;transition:all .12s;}
.ch-chip:hover{border-color:#9CCBB1;color:var(--ink);}
.ch-chip.on{background:#EAF6EF;border-color:var(--g);color:var(--ink);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ch-chip-chk{margin-right:5px;color:var(--g);}
.ch-row2{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
.ch-pills2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.ch-pill{font:inherit;font-weight:700;font-size:12.5px;color:var(--ink2);background:#fff;border:1px solid var(--l);border-radius:12px;padding:10px 8px;cursor:pointer;text-align:center;transition:all .12s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ch-pill:hover{border-color:#9CCBB1;transform:translateY(-1px);box-shadow:var(--sh-sm);}
.ch-pill.sel{background:#EAF6EF;border-color:var(--g);color:var(--ink);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ch-voices{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.ch-voice{display:flex;align-items:stretch;background:#fff;border:1px solid var(--l);border-radius:12px;overflow:hidden;transition:all .12s;}
.ch-voice:hover{border-color:#9CCBB1;box-shadow:var(--sh-sm);}
.ch-voice.sel{background:#EAF6EF;border-color:var(--g);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ch-voice-pick{flex:1;min-width:0;font:inherit;font-weight:700;font-size:12.5px;color:var(--ink2);background:none;border:0;padding:10px 8px;cursor:pointer;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ch-voice.sel .ch-voice-pick{color:var(--ink);}
.ch-voice-pick.own svg{vertical-align:-2px;margin-right:2px;}
.ch-voice-play{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:34px;border:0;border-left:1px solid var(--l);background:none;color:var(--ink3);cursor:pointer;transition:all .12s;}
.ch-voice-play:hover{color:var(--g);background:#F7FBF8;}
.ch-voice-play.on{color:var(--g);background:#EAF6EF;}
.ch-voice.sel .ch-voice-play{border-left-color:rgba(12,122,70,.25);}
.ch-cads{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.ch-cad{font:inherit;display:flex;flex-direction:column;gap:3px;align-items:center;background:#fff;border:1px solid var(--l);border-radius:14px;padding:13px 8px;cursor:pointer;transition:all .12s;}
.ch-cad b{font-size:14px;color:var(--ink);} .ch-cad span{font-size:11.5px;color:var(--ink3);font-weight:600;}
.ch-cad:hover{border-color:#9CCBB1;transform:translateY(-1px);box-shadow:var(--sh-sm);}
.ch-cad.sel{background:#EAF6EF;border-color:var(--g);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ch-connect{background:#FBF7EA;border:1px dashed #E2DCC8;border-radius:12px;padding:11px 14px;font-size:12.5px;color:var(--ink2);}
.ch-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.ch-mode{font:inherit;text-align:left;display:flex;flex-direction:column;gap:3px;background:#fff;border:1px solid var(--l);border-radius:14px;padding:13px 14px;cursor:pointer;transition:all .12s;}
.ch-mode b{font-size:13.5px;color:var(--ink);} .ch-mode span{font-size:11.5px;color:var(--ink3);font-weight:500;line-height:1.35;}
.ch-mode:hover:not(:disabled){border-color:#9CCBB1;}
.ch-mode.sel{background:#EAF6EF;border-color:var(--g);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.ch-mode:disabled{opacity:.45;cursor:not-allowed;}
.ch-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0 4px;font-size:13px;color:var(--ink2);}
.ch-summary b{color:var(--ink);} .ch-bal{color:var(--ink3);font-size:12px;}
.ch-err{background:#FDECEC;border:1px solid #F3C9C9;color:#A4342E;border-radius:12px;padding:10px 14px;font-size:12.5px;margin-top:12px;}
.ch-hint{margin-top:8px;font-size:12px;color:#8A7A3A;font-weight:600;}
.ch-runway{margin-top:6px;font-size:12px;color:var(--ink3);font-weight:600;}
.ch-warn{background:#FBF4E4;border:1px solid #EBD9A6;color:#8A6D1E;border-radius:12px;padding:10px 14px;font-size:12.5px;margin-top:12px;}
.ch-go{position:relative;isolation:isolate;overflow:hidden;width:100%;margin-top:14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;cursor:pointer;font:inherit;font-weight:800;font-size:15px;color:#fff;padding:15px 22px;border-radius:15px;transition:transform .1s,box-shadow .1s,filter .1s;
  background:linear-gradient(100deg,#12A85E 38%,#0A6A3D 78%,#075530);box-shadow:0 4px 14px rgba(12,122,70,.32),inset 0 0 0 1px rgba(231,200,121,.34);}
.ch-go::before{content:"";position:absolute;inset:4px;border:1px solid rgba(255,210,74,.42);border-radius:11px;pointer-events:none;}
.ch-go.sm{width:auto;padding:11px 18px;font-size:13.5px;margin:0;text-decoration:none;flex:0 0 auto;}
.ch-go-flower{position:absolute;z-index:-1;right:-26px;top:-26px;width:120px;height:120px;background:#FFD24A;-webkit-mask:url(/gstyle-rosette.svg) center/contain no-repeat;mask:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.5;animation:wbDrift 60s linear infinite;}
.ch-go:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 8px 20px rgba(12,122,70,.36),inset 0 0 0 1px rgba(231,200,121,.34);filter:brightness(1.04);}
.ch-go:disabled{opacity:.42;cursor:not-allowed;box-shadow:none;}

/* dashboard */
.ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;}
.ch-card{background:#fff;border:1px solid var(--l);border-radius:18px;padding:18px;box-shadow:var(--sh-sm);transition:transform .14s,box-shadow .14s;}
.ch-card:hover{transform:translateY(-2px);box-shadow:var(--sh-md);}
.ch-card.paused{opacity:.92;background:#FCFBF6;}
.ch-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
.ch-card-name{font-weight:800;font-size:16px;letter-spacing:-.01em;}
.ch-card-niche{color:var(--ink3);font-size:12px;font-weight:500;margin-top:2px;max-width:30ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ch-badge{flex:0 0 auto;font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;}
.ch-badge{display:inline-flex;align-items:center;gap:5px;}
.ch-badge.live{color:var(--g);background:#EAF6EF;}
.ch-badge.off{color:#8A7A3A;background:#F6F0DE;}
.ch-run-dot{width:7px;height:7px;border-radius:50%;background:var(--g2);box-shadow:0 0 0 0 rgba(18,168,94,.5);animation:chPulse 1.8s ease-out infinite;}
@keyframes chPulse{0%{box-shadow:0 0 0 0 rgba(18,168,94,.5)}70%{box-shadow:0 0 0 5px rgba(18,168,94,0)}100%{box-shadow:0 0 0 0 rgba(18,168,94,0)}}
.ch-pause-bars{width:8px;height:9px;flex:0 0 auto;background:linear-gradient(to right,currentColor 0 36%,transparent 36% 64%,currentColor 64% 100%);border-radius:1px;}
.ch-card-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin:12px 0;font-size:12px;color:var(--ink2);font-weight:600;}
.ch-card-meta b{color:var(--ink);}
.ch-next{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--g);font-weight:700;}
.ch-next-dot{width:7px;height:7px;border-radius:50%;background:var(--g2);box-shadow:0 0 0 3px rgba(18,168,94,.18);}
.ch-next.rendering{color:var(--ink2);}
.ch-next.rendering .ch-next-dot{animation:chPulse 1.4s ease-out infinite;}
.ch-paused-note{font-size:12.5px;color:#8A7A3A;font-weight:600;}
.ch-card-stats{display:flex;align-items:center;gap:20px;margin:14px 0;padding:12px 0;border-top:1px solid #F0ECDE;border-bottom:1px solid #F0ECDE;}
.ch-card-stats>div{display:flex;flex-direction:column;}
.ch-card-stats b{font-size:18px;font-weight:800;line-height:1;} .ch-card-stats span{font-size:11px;color:var(--ink3);font-weight:600;margin-top:3px;}
.ch-card-gal{margin-left:auto;font-size:12px;font-weight:700;color:var(--g);text-decoration:none;}
.ch-card-acts{display:flex;gap:8px;}
.ch-card-acts form{flex:1;}
.ch-act{width:100%;font:inherit;font-weight:700;font-size:12.5px;padding:9px;border-radius:11px;border:1px solid var(--l);background:#fff;color:var(--ink);cursor:pointer;transition:all .12s;}
.ch-act:hover:not(:disabled){border-color:#9CCBB1;background:#F7FBF8;}
.ch-act:disabled{opacity:.4;cursor:not-allowed;}
.ch-act.primary{background:#EAF6EF;border-color:var(--g);color:var(--g);}
.ch-act.ghost{color:var(--ink3);} .ch-act.ghost:hover{color:#A4342E;border-color:#E6B9B6;background:#FDF3F2;}
.ch-act.warn{background:#FBF4E4;border-color:#EBD9A6;color:#8A6D1E;}
.ch-act.ghost.armed{background:#8C2E1B;border-color:#8C2E1B;color:#fff;animation:chArm .18s ease;}
@keyframes chArm{from{transform:scale(.94)}to{transform:scale(1)}}
.ch-empty{margin-top:10px;padding:22px;border-radius:16px;background:#fff;border:1px dashed var(--l);font-size:14px;color:var(--ink2);text-align:center;}
.ch-link{color:var(--g);font-weight:700;background:none;border:0;cursor:pointer;font:inherit;text-decoration:underline;padding:0;}
@media(max-width:560px){.ch-row2{grid-template-columns:1fr;}.ch-modes{grid-template-columns:1fr;}.ch-title{font-size:25px;}}
/* ── 44px tap-target floor (mobile touch). Appended so source order wins. ── */
.ch-go.sm{box-sizing:border-box;min-height:44px}
@media(max-width:620px){
  .ch-x{box-sizing:border-box;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center}
  /* "All drops →" was a bare 12px line of text; same floor as the Archive link on a product channel's card */
  .ch-card-gal{min-height:44px;display:inline-flex;align-items:center}
  .ch-chip{box-sizing:border-box;min-height:44px}
  .ch-act{box-sizing:border-box;min-height:44px}
  .ch-newbtn{box-sizing:border-box;min-height:44px}
  .ch-pill{box-sizing:border-box;min-height:44px}
  .ch-voice-pick{box-sizing:border-box;min-height:44px}
  .ch-voice-play{box-sizing:border-box;min-width:44px}
}
`;
