import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useLocation, useNavigate, useRevalidator, useSearchParams, type ShouldRevalidateFunction } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { readUiLang, tr } from "../lib/ui-i18n";
import { db } from "../db.server";
import { requireWebIdentity } from "../lib/web-auth.server";
import { LIVE_AVATARS, STOCK_CHARACTERS, OUTFITS, avatarImg, DESIGNED_VOICES, privateCastFor, type Avatar, type CharacterKind } from "../lib/avatars";
import { AVATAR_VOICES, DEFAULT_AVATAR_VOICE } from "../lib/avatar-voice-catalog";
import { TOKEN_COST } from "../lib/plan-config";
import { stockSpin, stockCut, stockLooks, customSpin, customCut, spinFrame, type Spin } from "../lib/presenter-kits";
import { useModalA11y } from "../lib/use-modal-a11y";
import { VoicePicker, VOICE_UI_CSS, type MyVoiceT } from "../components/VoicePicker";
import { CharacterForge, FORGE_CSS } from "../components/CharacterForge";
import { DEFAULT_CHARACTER_VOICE, characterVoice, characterVoiceSample } from "../lib/character-voices";
import { SpinStage, SPIN_STAGE_CSS } from "../components/SpinStage";
import { favouritesFirst, passes, NO_FILTER, type CastFilter } from "../lib/favourites";

export const meta: MetaFunction = () => [{ title: "Your cast · EasyMode" }];

/* The Presenters section — the cast, and everything about each member of it, in ONE place.
 *
 * Tapping a presenter opens their character view right here (?who=<id>): a full-body figure you can
 * turn around, who they are, the voice they speak with (and the picker to change it), their outfits,
 * and what you can do with them. It used to drop you into the Creator's video form, which made this
 * page a launcher rather than a home for the cast.
 *
 * Every presenter is shown cut out of their portrait's own background on ONE shared backdrop
 * (.ph-bd) — the stock cast was photographed on blue, red, grey and orange, custom presenters on
 * warm beige, and side by side that read as a collage. See app/lib/presenter-kits.ts for the files. */

/** One outfit: its portrait, the same portrait cut out of its background, and its 3D view (a full-body
 *  rotation) when it has one. `spinState` says where a custom presenter's 3D view is when it isn't there yet. */
type Look = { label: string; img: string; cut: string | null; spin: Spin | null; spinState: "none" | "building" | "failed" };
type Member = {
  id: string; rowId: string; name: string; custom: boolean;
  /** A person, or a character that is not one (the stock cartoon characters and monsters). */
  kind: CharacterKind;
  vibe: string; about: string; gender: "f" | "m"; age: string; energy: "hype" | "warm" | "calm";
  img: string; cut: string | null; looks: Look[];
  cutsPending: boolean;
  /** "" = no voice has been chosen: a stock presenter speaks in their signature voice if they have one
   *  (`signature`), anyone else in a voice picked to fit them. */
  voiceId: string; voice: string; voiceOwn: boolean; voiceSample: string;
  /** Only a stock presenter with a voice DESIGNED for them has one: that voice's clip. (It used to be
   *  set for every stock member, so the owner's mascot — which has none — read "Signature voice".) */
  signature: { sample: string } | null;
};

const DECADE: Record<string, string> = { twenties: "20s", thirties: "30s", forties: "40s", fifties: "50s", sixties: "60s", seventies: "70s" };
/** "a gentle East Asian woman in her mid twenties with…" → "Mid 20s". */
function ageText(a: Avatar): string {
  const m = /\b(early|mid|late)\s+(twenties|thirties|forties|fifties|sixties|seventies)\b/i.exec(a.desc);
  // only an age the description states — a guessed band reads as a fact ("30s–40s" on an ogre mascot)
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${DECADE[m[2].toLowerCase()]}` : "";
}
// The cast's descriptions were written as prompts: "a photorealistic friendly ogre" is a note to the
// picture model, not something to say about them.
const sentence = (s: string) => { const x = s.trim().replace(/\.$/, "").replace(/^(an?) photorealistic /i, "$1 "); return x ? `${x[0].toUpperCase()}${x.slice(1)}.` : ""; };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const { customCastFor, stockVoicesFor, favouritesFor } = await import("../lib/custom-avatars.server");
  const { shopVoiceClones, canCloneVoice } = await import("../lib/voice-clone.server");
  const { spinsAreFree, ensureKits } = await import("../lib/presenter-kit.server");
  // Bring this shop's presenters' kits up to date in the background: any cut-out still missing, any 3D
  // view its creation paid for that hasn't started, any build a deploy interrupted. First, so what is
  // read next already shows them as under way; the page polls below until they land.
  const cutting = await ensureKits(shop.id).catch((e) => {
    console.error(`[kit] ensureKits: ${e instanceof Error ? e.message : e}`);
    return new Set<string>();
  });
  const [custom, myVoices, stockVoice, favs] = await Promise.all([customCastFor(shop.id), shopVoiceClones(shop.id), stockVoicesFor(shop.id), favouritesFor(shop.id)]);

  const voiceInfo = (voiceId: string | null | undefined, stockId?: string) => {
    const mine = myVoices.find((v) => v.voiceId === voiceId);
    if (mine) return { voiceId: mine.voiceId, voice: mine.label, voiceOwn: true, voiceSample: mine.preview };
    const acted = characterVoice(voiceId);
    if (acted) return { voiceId: acted.id, voice: acted.label, voiceOwn: false, voiceSample: characterVoiceSample(acted.id) };
    const cat = AVATAR_VOICES.find((v) => v.id === voiceId);
    if (cat) return { voiceId: cat.id, voice: cat.label, voiceOwn: false, voiceSample: `/voice-samples/${cat.id}.mp3` };
    return { voiceId: "", voice: "", voiceOwn: false, voiceSample: stockId && DESIGNED_VOICES.has(stockId) ? `/voice-videos/${stockId}.mp4?v=4` : "" };
  };

  const mine: Member[] = custom.filter((c) => c.status === "ready").map((c) => {
    const cutAt = (i: number) => (i < c.cuts ? customCut(c.rowId, i) : null);
    const looks: Look[] = c.imgs.map((img, i) => {
      const s = c.spins.find((x) => x.look === i);
      const ready = s?.state === "ready";
      return {
        label: OUTFITS[i]?.label || `Look ${i + 1}`, img, cut: cutAt(i),
        spin: s && ready ? customSpin(c.rowId, { n: s.frames, w: s.frameW, h: s.frameH, dir: s.dir }, i, s.updatedAt.getTime()) : null,
        spinState: !s || ready ? "none" : s.state === "building" ? "building" : "failed",
      };
    });
    return {
      id: c.id, rowId: c.rowId, name: c.name, custom: true, kind: (c.kind || "person") as CharacterKind,
      vibe: c.kind === "monster" ? "Your creature" : c.kind === "cartoon" ? "Your cartoon" : "Your character", about: /the brand's own presenter character$/.test(c.desc) ? "" : sentence(c.desc),
      gender: c.gender, age: "", energy: c.energy,
      img: c.img, cut: cutAt(0),
      looks,
      cutsPending: cutting.has(c.rowId),
      ...voiceInfo(c.voiceId), signature: null,
    };
  });
  const asMember = (a: Avatar): Member => {
    const img = avatarImg(a.id, 0);
    const cut = stockCut(a.id, 0);
    // one portrait for most of the live cast today; a presenter with all four outfits shows all four
    const looks: Look[] = Array.from({ length: Math.min(OUTFITS.length, stockLooks(a.id)) }, (_, v) => ({
      label: OUTFITS[v].label, img: avatarImg(a.id, v), cut: stockCut(a.id, v), spin: stockSpin(a.id, v), spinState: "none",
    }));
    return {
      id: a.id, rowId: "", name: a.name, custom: false, kind: a.kind || "person",
      vibe: a.vibe, about: sentence(a.desc), gender: a.gender, age: ageText(a), energy: a.energy,
      img, cut, looks,
      cutsPending: false,
      // the shop's own choice for them, else the voice they come with (the stock characters have one)
      ...voiceInfo(stockVoice[a.id] || a.voiceId, a.id),
      signature: DESIGNED_VOICES.has(a.id) ? { sample: `/voice-videos/${a.id}.mp4?v=4` } : null,
    };
  };
  const people = [...privateCastFor(account.email, shop.id, shop.domain), ...LIVE_AVATARS].map(asMember);
  // The stock characters stand IN the cast, not after it: one after every third person, cartoon and
  // monster by turns — "throw some cartoon characters and horror monsters into the mix" (the owner).
  const characters = STOCK_CHARACTERS.map(asMember);
  const mixed = ["cartoon", "monster"].map((k) => characters.filter((c) => c.kind === k));
  const turns: Member[] = [];
  for (let i = 0; i < Math.max(mixed[0].length, mixed[1].length); i++) for (const group of mixed) if (group[i]) turns.push(group[i]);
  const stock: Member[] = [];
  people.forEach((p, i) => { stock.push(p); if (i % 3 === 2 && turns.length) stock.push(turns.shift() as Member); });
  stock.push(...turns);
  const cast = [...mine, ...stock];
  // A forge that failed is retried by the worker (up to three goes) and its row says "failed" between
  // goes. While a forge job for it is still queued or running it is still being made — only once the
  // job has given up is it something to tell the merchant about (and safe to offer to dismiss).
  const forgeJobs = await db.job.findMany({
    where: { shopId: shop.id, type: "FORGE_CUSTOM_AVATAR", status: { in: ["PENDING", "IN_PROGRESS"] } },
    select: { payload: true },
  });
  const retrying = new Set(forgeJobs.map((j) => { try { return String((JSON.parse(j.payload) as { customAvatarId?: string }).customAvatarId || ""); } catch { return ""; } }));
  const stillForging = (c: { status: string; rowId: string }) => c.status === "forging" || (c.status === "failed" && retrying.has(c.rowId));
  const brandFaceId = shop.brandAvatarId && cast.some((c) => c.id === shop.brandAvatarId) ? shop.brandAvatarId : null;
  // Brand Face leads the grid (your face, front and center), then the ones you starred, then everyone else.
  const bf = cast.find((c) => c.id === brandFaceId);
  const ordered = bf ? [bf, ...favouritesFirst(cast.filter((c) => c.id !== brandFaceId), favs)] : favouritesFirst(cast, favs);
  return json({
    cast: ordered,
    favs: favs.filter((id) => cast.some((c) => c.id === id)),
    brandFaceId,
    // "forging" means forging. A forge that had FAILED for good used to be counted here too, so one
    // bad upload left "1 presenter still forging" on this page forever.
    forging: custom.filter(stillForging).length,
    failed: custom.filter((c) => c.status === "failed" && !stillForging(c)).map((c) => ({ id: c.id, name: c.name })),
    myVoices,
    canMakeVoice: canCloneVoice(account, shop),
    // what adding one outfit's 3D view to a presenter costs this viewer (0 = free: an admin account)
    spinCost: spinsAreFree(account) ? 0 : TOKEN_COST.avatarSpin,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = readUiLang(request);
  const { account, shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const avatarId = String(form.get("avatarId") || "").trim();
  const cav = await import("../lib/custom-avatars.server");
  const ownRow = async () =>
    cav.isCustomAvatarId(avatarId) ? db.customAvatar.findFirst({ where: { id: avatarId.slice(cav.CUSTOM_PREFIX.length), shopId: shop.id } }) : null;
  const gone = () => json({ error: tr(lang, "That presenter is already gone.") });

  // None of these is gated on a plan: looking after your own cast (a voice, a name, your Brand Face,
  // removing one) must keep working for a lapsed merchant, exactly as it does in the Studio.
  if (intent === "setBrandFace") {
    if (avatarId) {
      const known = cav.isCustomAvatarId(avatarId)
        ? (await ownRow())?.status === "ready"
        : [...privateCastFor(account.email, shop.id, shop.domain), ...LIVE_AVATARS].some((a) => a.id === avatarId);
      if (!known) return gone();
      // The Brand Face is who presents your product videos, and those are built around a person who can
      // hold the product. A cartoon or a creature is cast in films instead.
      if (cav.isCustomAvatarId(avatarId) && ((await ownRow())?.kind || "person") !== "person") {
        return json({ error: tr(lang, "Your Brand Face presents your product videos, so it has to be a person. Cast this character in a movie instead.") });
      }
    }
    await db.shop.update({ where: { id: shop.id }, data: { brandAvatarId: avatarId || null, brandAvatarVariant: 0 } });
    return json({ ok: "brand" });
  }

  if (intent === "setVoice") {
    const want = String(form.get("voiceId") || "").trim();
    if (cav.isCustomAvatarId(avatarId)) {
      const row = await ownRow();
      if (!row) return gone();
      const { resolveVoiceChoice } = await import("../lib/voice-clone.server");
      const voiceId = await resolveVoiceChoice(shop.id, want, row.gender === "f" ? "f" : "m");
      await db.customAvatar.update({ where: { id: row.id }, data: { voiceId } });
      return json({ ok: "voice" });
    }
    try {
      await cav.setStockVoice(shop.id, avatarId, want);
      return json({ ok: "voice" });
    } catch (e) {
      return json({ error: e instanceof Error ? tr(lang, e.message) : tr(lang, "Couldn't save that voice — mind trying again?") });
    }
  }

  // A star: this presenter sits first here and in every picker. Only someone this shop can cast.
  if (intent === "fav") {
    const castable = cav.isCustomAvatarId(avatarId)
      ? !!(await ownRow())
      : [...privateCastFor(account.email, shop.id, shop.domain), ...LIVE_AVATARS, ...STOCK_CHARACTERS].some((a) => a.id === avatarId);
    if (!castable) return gone();
    await cav.setFavourite(shop.id, avatarId, form.get("on") === "1");
    return json({ ok: "fav" });
  }

  if (intent === "rename") {
    const row = await ownRow();
    if (!row) return gone();
    const name = String(form.get("name") || "").trim().slice(0, 40);
    if (!name) return json({ error: tr(lang, "Give your presenter a name.") });
    await db.customAvatar.update({ where: { id: row.id }, data: { name } });
    return json({ ok: "rename" });
  }

  if (intent === "delete") {
    const name = await cav.deleteCustomAvatar(shop.id, avatarId);
    if (name === null) return gone();
    return json({ ok: "delete", name });
  }

  // Add the 3D view of one outfit to one of your own presenters (the ones created since 3D views
  // existed already have theirs — it is part of what creating a presenter costs).
  if (intent === "buildSpin") {
    const { spinsAreFree, buySpin } = await import("../lib/presenter-kit.server");
    const row = await ownRow();
    if (!row) return gone();
    // one outfit, or "all": every outfit that doesn't have its 3D view yet, each charged as it starts
    const wanted = String(form.get("look") || "0") === "all"
      ? OUTFITS.map((_, i) => i)
      : [Math.max(0, Math.min(OUTFITS.length - 1, parseInt(String(form.get("look") || "0"), 10) || 0))];
    let started = 0;
    for (const look of wanted) {
      try {
        if ((await buySpin(shop.id, row.id, look, spinsAreFree(account))) === "started") started++;
      } catch (e) {
        // the wallet's own words ("Not enough tokens — needs 10, you have 4…"); whatever started stays started
        const msg = e instanceof Error ? e.message : tr(lang, "Couldn't start the 3D view — nothing was charged.");
        return json(started ? { ok: "spin", error: msg } : { error: msg });
      }
    }
    return json({ ok: "spin" });
  }

  return json({ error: tr(lang, "Unknown request.") }, { status: 400 });
};

/* Opening, closing and paging through presenters only changes ?who= — the cast itself hasn't changed,
 * so don't refetch it on every arrow press. Saves (a form method) and the kit polling still reload. */
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, formMethod, formData, defaultShouldRevalidate }) => {
  // A star is shown at once on the page (kept locally); reloading would re-sort the grid under the
  // finger that just tapped it. The new order shows next time the cast is opened.
  if (formMethod && formData?.get("intent") === "fav") return false;
  if (formMethod) return defaultShouldRevalidate;
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) return false;
  return defaultShouldRevalidate;
};

type Saved = { ok?: string; error?: string; name?: string };

/* The hero's line-up: the cast standing together, full height — each figure is the first frame of
 * that presenter's 3D view, so it is the real person you are about to open, not a stock group photo.
 * Your Brand Face leads from the centre (when they can be turned around); beside them a fixed, varied
 * pick of the pro cast, so the row reads as a cast rather than as whoever sorts first. An id that isn't
 * in this viewer's cast (a private presenter, one since retired) is simply skipped. */
const LINEUP = ["valentina", "pip", "keeper", "desmond", "marquis", "monster", "howl", "aditi", "fatima", "cole", "keiko", "omar", "isla", "tunde", "esther"];
/** How tall each kind stands beside the people: a cartoon pup comes up to a grown-up's chest, a monster looms. */
const STANDS: Record<CharacterKind, number> = { person: 1, cartoon: 0.66, monster: 1.05 };
type Standing = { m: Member; spin: Spin; rank: number; lead: boolean };
function lineupOf(cast: Member[], brandFaceId: string | null): Standing[] {
  const spinOf = (m: Member) => m.looks[0]?.spin || null;
  const lead = cast.find((c) => c.id === brandFaceId && c.kind === "person" && spinOf(c));
  const picks: Member[] = lead ? [lead] : [];
  for (const id of LINEUP) {
    const m = cast.find((c) => c.id === id);
    if (m && spinOf(m) && !picks.includes(m)) picks.push(m);
  }
  for (const c of cast) if (!c.custom && c.kind === "person" && spinOf(c) && !picks.includes(c)) picks.push(c);
  // centre-out: the first pick in the middle, the next two either side of them, and so on outward
  const row: Standing[] = [];
  picks.slice(0, 7).forEach((m, i) => {
    const s: Standing = { m, spin: spinOf(m) as Spin, rank: Math.ceil(i / 2), lead: i === 0 && !!lead };
    if (i % 2) row.unshift(s); else row.push(s);
  });
  return row;
}

type Show = "all" | "fav" | "mine" | CharacterKind;

export default function PresenterHub() {
  const d = useLoaderData<typeof loader>();
  const cast = d.cast as Member[];
  const t = useT();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const revalidator = useRevalidator();
  const who = sp.get("who");
  const [picked, setShow] = useState<Show>(() => { const v = sp.get("show"); return v === "fav" || v === "mine" || v === "person" || v === "cartoon" || v === "monster" ? v : "all"; });
  // "Create your own character" opens here, in place (?forge=1 opens it straight away)
  const [forgeOpen, setForgeOpen] = useState(sp.get("forge") === "1");
  // STARS. Shown the moment they're tapped (the save doesn't reload the cast — see shouldRevalidate);
  // the grid puts starred presenters first the next time it is opened.
  const [favs, setFavs] = useState<Set<string>>(() => new Set(d.favs));
  const favKey = (d.favs as string[]).join("|");
  useEffect(() => { setFavs(new Set(d.favs)); }, [favKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const favF = useFetcher<Saved>();
  useEffect(() => { if (favF.state === "idle" && favF.data?.error) revalidator.revalidate(); }, [favF.state, favF.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFav = (id: string) => {
    const on = !favs.has(id);
    setFavs((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
    const fd = new FormData();
    fd.set("intent", "fav"); fd.set("avatarId", id); fd.set("on", on ? "1" : "0");
    favF.submit(fd, { method: "post" });
  };
  // The refine chips: who they are (women · men), their age, their energy. Unset = everyone.
  const [filt, setFilt] = useState<CastFilter>(NO_FILTER);
  const refining = !!(filt.sex || filt.age || filt.energy);
  const tabs = ([
    { id: "all", label: "All", n: cast.length },
    { id: "fav", label: "Favourites", n: cast.filter((c) => favs.has(c.id)).length },
    { id: "mine", label: "Yours", n: cast.filter((c) => c.custom).length },
    { id: "person", label: "People", n: cast.filter((c) => c.kind === "person").length },
    { id: "cartoon", label: "Cartoons", n: cast.filter((c) => c.kind === "cartoon").length },
    { id: "monster", label: "Monsters", n: cast.filter((c) => c.kind === "monster").length },
  ] as Array<{ id: Show; label: string; n: number }>).filter((x) => x.n > 0);
  // A tab that no longer exists (you deleted your last character while on "Yours") must not leave an
  // empty grid with no chip lit.
  const show: Show = tabs.some((x) => x.id === picked) ? picked : "all";
  const shown = (show === "all" ? cast : cast.filter((c) => (show === "fav" ? favs.has(c.id) : show === "mine" ? c.custom : c.kind === show)))
    .filter((c) => passes(c, filt));
  // ← → in the character view page through what the grid is showing — unless the presenter that is
  // open isn't among them (a link straight to someone the filter hides), then through everyone
  const list = who && shown.some((c) => c.id === who) ? shown : cast;
  const openIdx = who ? list.findIndex((c) => c.id === who) : -1;
  const open = openIdx >= 0 ? list[openIdx] : null;
  // Hear a presenter from the grid without opening them. One player for the page; a second tap (or
  // another card, or opening someone) stops it.
  const hearRef = useRef<HTMLAudioElement | null>(null);
  const [hearing, setHearing] = useState<string | null>(null);
  const hearCard = (id: string, sample: string) => {
    const a = hearRef.current;
    if (!a) return;
    if (hearing === id) { a.pause(); setHearing(null); return; }
    a.pause();
    a.src = sample;
    a.currentTime = 0;
    setHearing(id);
    a.play().catch(() => setHearing(null));
  };
  useEffect(() => { if (open) { hearRef.current?.pause(); setHearing(null); } }, [open]);
  const row = lineupOf(cast, d.brandFaceId);
  const cleanup = useFetcher<Saved>();
  // The character view is portaled to <body> (below), which only exists in the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // A presenter whose cut-outs or 3D views are still being made: look again until they land — every
  // 5 seconds for the first two minutes, then every 15 (a presenter's four 3D views take about ten
  // minutes, and several presenters queue behind each other), giving up after forty minutes.
  const waiting = cast.some((c) => c.cutsPending || c.looks.some((l) => l.spinState === "building")) || d.forging > 0;
  const ticks = useRef(0);
  useEffect(() => {
    if (!waiting) { ticks.current = 0; return; }
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const n = ++ticks.current;
      if (n > 480 || (n > 24 && n % 3 !== 0)) return;
      revalidator.revalidate();
    }, 5000);
    return () => clearInterval(id);
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromHub = !!(location.state as { hub?: boolean } | null)?.hub;
  const close = () => {
    if (fromHub) navigate(-1);
    else navigate("/web/presenters", { replace: true, preventScrollReset: true });
  };
  const go = (idx: number) => {
    const next = list[(idx + list.length) % list.length];
    if (next) navigate(`/web/presenters?who=${encodeURIComponent(next.id)}`, { replace: true, preventScrollReset: true, state: location.state });
  };

  return (
    <div className="ph-wrap">
      <style dangerouslySetInnerHTML={{ __html: PH_STYLE }} />
      {/* The hero: what this section is, the two things to do with a cast (make one of your own, put
          them in a film — they used to be two full-width bars stacked under a banner), and the cast
          itself standing on the right. With fewer than three figures to stand there it falls back to
          the group photo. */}
      <header className={`ph-hero${row.length >= 3 ? "" : " photo"}`}>
        <span className="ph-hero-rose" aria-hidden="true" />
        <span className="ph-hero-stage" aria-hidden="true">
          {row.length < 3 && <img className="ph-hero-img" src="/landing/presenter-hero.jpg?v=3" alt="" />}
        </span>
        <div className="ph-hero-copy">
          <span className="ph-hero-eyebrow"><Ico n="presenter" size={13} /> {t("Your AI cast")}</span>
          <h1 className="ph-hero-h">{t("Meet your cast")}</h1>
          <p>{t("People, cartoon characters, monsters — the cast for your movies, shows and ads. Pick one, or create your own.")}</p>
          <div className="ph-hero-cta">
            <button type="button" className="ph-hero-btn main" onClick={() => setForgeOpen(true)}><Ico n="wand" size={15} /> {t("Create your own character")}</button>
            <Link to="/web/film" className="ph-hero-btn"><Ico n="film" size={15} /> {t("Cast them in a movie")}</Link>
          </div>
        </div>
        {row.length >= 3 && (
          <div className="ph-lineup">
            {row.map(({ m, spin, rank, lead }) => (
              <Link key={m.id} to={`/web/presenters?who=${encodeURIComponent(m.id)}`} state={{ hub: true }} preventScrollReset
                className={`ph-lu r${rank} k-${m.kind}${lead ? " lead" : ""}`} style={{ aspectRatio: `${spin.w} / ${spin.h}`, ["--k" as string]: STANDS[m.kind] }} aria-label={m.name}>
                <img src={spinFrame(spin, 0)} alt="" draggable={false} />
                <span className="ph-lu-nm" aria-hidden="true">{lead ? <Ico n="star" size={10} /> : null}{m.name}</span>
              </Link>
            ))}
          </div>
        )}
      </header>
      {d.forging > 0 && (
        <p className="ph-forging"><Ico n="bolt" size={13} /><span>{t("{n} presenter(s) still forging — they'll appear below when ready.", { n: d.forging })}</span></p>
      )}
      {d.failed.map((f) => (
        <p className="ph-forging bad" key={f.id}>
          <Ico n="warning" size={13} />
          <span>
            {t("{name} couldn't be made — your tokens were returned. Try again; a clear, front-facing picture works best.", { name: f.name })}{" "}
            <button type="button" className="ph-linkbtn" disabled={cleanup.state !== "idle"}
              onClick={() => { const fd = new FormData(); fd.set("intent", "delete"); fd.set("avatarId", f.id); cleanup.submit(fd, { method: "post" }); }}>
              {t("Dismiss")}
            </button>
          </span>
        </p>
      ))}

      <div className="ph-bar">
        <div className="ph-bar-t">
          <h2>{t("The cast")}</h2>
          <span>{t("tap one to meet them")}{d.brandFaceId ? <> · <Ico n="star" size={11} /> {t("is your Brand Face")}</> : null}</span>
        </div>
        {tabs.length > 2 && (
          <div className="ph-filters" role="group" aria-label={t("Show")}>
            {tabs.map((f) => (
              <button type="button" key={f.id} className={show === f.id ? "on" : ""} aria-pressed={show === f.id} onClick={() => setShow(f.id)}>
                {f.id === "fav" ? <Ico n="star" size={11} /> : null}{t(f.label)}<i>{f.n}</i>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Refine: by who they are, their age and their energy — one chip per group at a time; tap a lit
          chip again to let that group go. */}
      <div className="ph-refine" role="group" aria-label={t("Refine")}>
        {([
          ["sex", "f", "Women"], ["sex", "m", "Men"],
          ["age", "20", "20s"], ["age", "30", "30s"], ["age", "40", "40s+"],
          ["energy", "hype", "Upbeat"], ["energy", "warm", "Warm"], ["energy", "calm", "Calm"],
        ] as Array<[keyof CastFilter, string, string]>).map(([k, v, label], i, all) => {
          const on = filt[k] === v;
          const groupStart = i > 0 && all[i - 1][0] !== k;
          return (
            <button type="button" key={`${k}-${v}`} className={`${on ? "on" : ""}${groupStart ? " gap" : ""}`} aria-pressed={on}
              onClick={() => setFilt((f) => ({ ...f, [k]: on ? "" : v }))}>{t(label)}</button>
          );
        })}
        {refining && <button type="button" className="ph-refine-clear" onClick={() => setFilt(NO_FILTER)}>{t("Clear")}</button>}
      </div>
      {shown.length === 0 && (
        <p className="ph-none">{show === "fav" && !refining ? t("Tap the ☆ on a presenter to keep them here — and first in every picker.") : t("No one in the cast matches all of these.")}{" "}
          {refining && <button type="button" className="ph-linkbtn" onClick={() => setFilt(NO_FILTER)}>{t("Clear the filters")}</button>}
        </p>
      )}
      <audio ref={hearRef} preload="none" onEnded={() => setHearing(null)} onError={() => setHearing(null)} />
      <div className="ph-grid">
        {/* Making your own leads the grid — it is the first thing a new merchant should see they can do. */}
        {(show === "all" || show === "mine") && (
          <button type="button" className="ph-new" onClick={() => setForgeOpen(true)}>
            <span className="ph-new-ico" aria-hidden="true"><Ico n="wand" size={22} /></span>
            <b>{t("Create your own character")}</b>
            <span className="ph-new-sub">{t("You, a model, a mascot, a cartoon, a creature — yours alone.")}</span>
            <i><Ico n="wand" size={12} /> {t("Describe them or add a picture")}</i>
          </button>
        )}
        {shown.map((c) => {
          const isBf = c.id === d.brandFaceId;
          return (
            <div key={c.id} className={`ph-facewrap${c.voiceSample ? " can-hear" : ""}`}>
            <Link to={`/web/presenters?who=${encodeURIComponent(c.id)}`} state={{ hub: true }} preventScrollReset className={`ph-face${isBf ? " bf" : ""}`}>
              {isBf && <span className="ph-bfbadge"><Ico n="star" size={10} /> {t("Brand Face")}</span>}
              {c.custom && !isBf && <span className="ph-yoursbadge">{t("Yours")}</span>}
              {c.kind !== "person" && <span className={`ph-kind ${c.kind}`}>{t(c.kind === "cartoon" ? "Cartoon" : "Monster")}</span>}
              <span className={`ph-face-img ph-bd${c.cut ? "" : " raw"}`}>
                <img src={c.cut || c.img} alt={c.name} loading="lazy" draggable={false} />
                {/* bottom-left of the picture: the top-right corner is the star's */}
                {c.looks.some((l) => !!l.spin) && <span className="ph-3d" aria-hidden="true"><Ico n="sphere" size={10} /> {t("3D")}</span>}
                <span className="ph-face-go" aria-hidden="true"><Ico n="arrow" size={15} /></span>
              </span>
              <span className="ph-face-meta">
                <span className="ph-face-nm">{c.name}</span>
                <span className={`ph-face-voice${c.voiceOwn ? " own" : ""}`}><Ico n="mic" size={10} /> {c.voiceOwn ? c.voice : c.voice ? t(c.voice) : c.signature ? t("Signature") : t("Automatic")}</span>
              </span>
            </Link>
            {c.voiceSample ? (
              <button type="button" className={`ph-hear${hearing === c.id ? " on" : ""}`} onClick={() => hearCard(c.id, c.voiceSample)}
                aria-label={hearing === c.id ? t("Stop") : t("Hear {name}'s voice", { name: c.name })} aria-pressed={hearing === c.id}>
                {hearing === c.id ? <i className="ph-hear-eq" aria-hidden="true"><i /><i /><i /></i> : <span aria-hidden="true">▶</span>}
              </button>
            ) : null}
            <button type="button" className={`ph-fav${favs.has(c.id) ? " on" : ""}`} onClick={() => toggleFav(c.id)} aria-pressed={favs.has(c.id)}
              aria-label={favs.has(c.id) ? t("Remove {name} from favourites", { name: c.name }) : t("Add {name} to favourites", { name: c.name })}>
              <span aria-hidden="true">{favs.has(c.id) ? "★" : "☆"}</span>
            </button>
            </div>
          );
        })}
      </div>

      {/* Portaled to document.body so it escapes .wb-main's stacking context: inside it, the scrim's
          z-index only counts against the page, and the site header (z-index 30) showed through the top
          of the view — on a phone, straight across the stage and its close button. */}
      {open && mounted ? createPortal(
        <CharacterView
          key={open.id}
          c={open}
          isBrandFace={open.id === d.brandFaceId}
          fav={favs.has(open.id)}
          onFav={() => toggleFav(open.id)}
          myVoices={d.myVoices as MyVoiceT[]}
          canMakeVoice={d.canMakeVoice}
          spinCost={d.spinCost}
          position={`${openIdx + 1} / ${list.length}`}
          onClose={close}
          onPrev={() => go(openIdx - 1)}
          onNext={() => go(openIdx + 1)}
        />,
        document.body,
      ) : null}
      <CharacterForge open={forgeOpen} onClose={() => setForgeOpen(false)} />
    </div>
  );
}

const ENERGY: Record<Member["energy"], string> = { hype: "High energy", warm: "Warm", calm: "Calm" };

/* One presenter, up close. Left: the stage — the outfit you picked as a full-body figure to turn
 * around (its "3D view"), or as its portrait. Right: who they are, their voice, their outfits, and
 * what to do with them. */
function CharacterView({ c, isBrandFace, fav, onFav, myVoices, canMakeVoice, spinCost, position, onClose, onPrev, onNext }: {
  c: Member; isBrandFace: boolean; myVoices: MyVoiceT[]; canMakeVoice: boolean;
  /** Starred by this shop (sits first in the cast and in every picker), and the toggle. */
  fav: boolean; onFav: () => void;
  /** Tokens to add one outfit's 3D view to a presenter that doesn't have it (0 = free for this viewer). */
  spinCost: number;
  position: string;
  onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
  const t = useT();
  const fetcher = useFetcher<Saved>();
  const busy = fetcher.state !== "idle";
  // which outfit is on the stage, and whether it is shown as its portrait rather than its 3D view
  const [look, setLook] = useState(0);
  const [flat, setFlat] = useState(false);
  // choosing a voice takes over the column beside the stage (its own screen, not a drawer in a drawer)
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pendingVoice, setPendingVoice] = useState(c.voiceId);
  const voicePanelRef = useRef<HTMLDivElement | null>(null);
  // Opening the voice screen unmounts the "Change" button that opened it, so keyboard and screen-reader
  // focus fell back to the page; closing it never came back either. Focus follows the screen both ways.
  const voiceTitleRef = useRef<HTMLHeadingElement | null>(null);
  const voiceChangeRef = useRef<HTMLButtonElement | null>(null);
  const voiceWasOpen = useRef(false);
  // Escape steps back out of the voice screen first, and only then closes the presenter
  const dialogRef = useModalA11y<HTMLDivElement>(true, () => { if (voiceOpen) setVoiceOpen(false); else onClose(); });
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(c.name);
  const [armed, setArmed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  // the page behind must not scroll while this is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  // ← → page through the cast, unless the keys are busy turning the figure, typing a name, or a
  // voice is being chosen (paging away would throw the choice out)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (voiceOpen) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.closest(".spin") || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      if (e.key === "ArrowLeft") onPrev(); else onNext();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onPrev, onNext, voiceOpen]);
  // on a phone the voice screen opens below the stage: bring its top into view
  useEffect(() => {
    if (voiceOpen && window.matchMedia("(max-width:760px)").matches) voicePanelRef.current?.scrollIntoView({ block: "start" });
    if (voiceOpen) voiceTitleRef.current?.focus({ preventScroll: true });
    else if (voiceWasOpen.current) voiceChangeRef.current?.focus({ preventScroll: true });
    voiceWasOpen.current = voiceOpen;
  }, [voiceOpen]);
  // a save landed: fold the editors; a delete landed: there is nobody left to look at
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok) return;
    if (fetcher.data.ok === "voice") setVoiceOpen(false);
    if (fetcher.data.ok === "rename") setRenaming(false);
    if (fetcher.data.ok === "delete") onClose();
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = (fields: Record<string, string>) => {
    const fd = new FormData();
    fd.set("avatarId", c.id);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fetcher.submit(fd, { method: "post" });
  };
  const hear = () => {
    const a = audioRef.current;
    if (!a || !c.voiceSample) return;
    if (playing) { a.pause(); setPlaying(false); return; }
    a.src = c.voiceSample;
    a.currentTime = 0;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  const cur = c.looks[Math.min(look, c.looks.length - 1)];
  const has3d = c.looks.some((l) => !!l.spin);
  // outfits of one of YOUR presenters that have no 3D view and none on the way
  const missing3d = c.custom ? c.looks.filter((l) => !l.spin && l.spinState !== "building").length : 0;
  const voiceName = c.voiceOwn ? c.voice : c.voice ? t(c.voice) : c.signature ? t("Signature voice") : t("Automatic");
  const voiceNote = c.voiceOwn ? t("Your own voice")
    : c.voice ? t(characterVoice(c.voiceId)?.blurb || AVATAR_VOICES.find((v) => v.id === c.voiceId)?.blurb || "")
    : c.signature ? t("Designed for {name}", { name: c.name })
    : t("Picked automatically — choose one to make it theirs");
  // What the voice shown actually does — said per kind of voice, because it differs: a recorded voice
  // is also SUNG in (songs, cartoons); a stock voice is the speaking voice of video ads and comes along
  // when the presenter is cast in a movie; a signature voice can only speak in video ads.
  // (Nothing is claimed for a character yet: how its voice reaches a film is still being built.)
  const voiceFine = c.kind !== "person" ? ""
    : c.voiceOwn ? t("{name} talks — and sings — in your own voice.", { name: c.name })
    : c.voice ? t("The voice {name} speaks with in your video ads, and brings along when you cast them in a movie.", { name: c.name })
    : !c.signature ? ""
    : t("The voice {name} speaks with in your video ads.", { name: c.name });
  const gender = c.gender === "f" ? "f" : "m";
  const showLooks = c.looks.length > 1;
  // a cartoon or a creature — one of the stock ones, or one you made: it is cast in films, not in ads
  const isCharacter = c.kind !== "person";
  const characterKind = c.kind === "person" ? undefined : c.kind;
  const badge = isBrandFace ? t("Brand Face") : c.custom ? t("Your character") : c.kind === "cartoon" ? t("Cartoon character") : c.kind === "monster" ? t("Monster") : t("Pro cast");
  // Removing one of your own presenters. It sits at the end of what scrolls on a desktop ("in") and
  // after the actions on a phone ("out") — the stylesheet shows one of the two.
  const danger = (where: "in" | "out") => c.custom ? (
    <section className={`pc-sec pc-danger ${where}`}>
      {armed ? (
        <p className="pc-warn">
          {t("Delete {name}? This can't be undone.", { name: c.name })}
          <button type="button" className="pc-del go" disabled={busy} onClick={() => post({ intent: "delete" })}>{busy ? t("Deleting…") : t("Delete")}</button>
          <button type="button" className="pc-textbtn" onClick={() => setArmed(false)}>{t("Keep")}</button>
        </p>
      ) : (
        <button type="button" className="pc-del" onClick={() => setArmed(true)}><Ico n="trash" size={13} /> {c.kind === "person" ? t("Delete this presenter") : t("Delete this character")}</button>
      )}
    </section>
  ) : null;

  return (
    <div className="pc-scrim" onClick={onClose}>
      <div ref={dialogRef} className="pc" role="dialog" aria-modal="true" aria-label={c.name} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="pc-x" onClick={onClose} aria-label={t("Close")}><Ico n="x" size={17} /></button>

        <div className="pc-stage ph-bd">
          {cur?.spin && !flat ? (
            <SpinStage key={look} spin={cur.spin} name={c.name} label={t("Turn {name} around", { name: c.name })} hint={t("Drag to turn")} loadingLabel={t("Loading 3D view")} />
          ) : cur ? (
            <img className={`pc-still${cur.cut ? "" : " raw"}`} src={cur.cut || cur.img} alt={`${c.name} — ${t(cur.label)}`} draggable={false} />
          ) : null}
          <span className="pc-count" aria-hidden="true">{position}</span>
          {cur?.spin && (
            <span className="pc-view" role="group" aria-label={t("View")}>
              <button type="button" className={flat ? "" : "on"} aria-pressed={!flat} onClick={() => setFlat(false)}><Ico n="sphere" size={12} /> {t("3D")}</button>
              <button type="button" className={flat ? "on" : ""} aria-pressed={flat} onClick={() => setFlat(true)}><Ico n="image" size={12} /> {t("Portrait")}</button>
            </span>
          )}
          <button type="button" className="pc-nav prev" onClick={onPrev} aria-label={t("Previous presenter")}><Ico n="arrow" size={16} style={{ transform: "rotate(180deg)" }} /></button>
          <button type="button" className="pc-nav next" onClick={onNext} aria-label={t("Next presenter")}><Ico n="arrow" size={16} /></button>
          {c.custom && cur && !cur.spin && cur.spinState === "building" && (
            <span className="pc-build" role="status"><i className="pc-build-spin" aria-hidden="true" />{t("Building this outfit's 3D view — a few minutes. You can keep browsing.")}</span>
          )}
          {c.custom && cur && !cur.spin && cur.spinState !== "building" && (
            <button type="button" className="pc-buildbtn" disabled={busy} onClick={() => post({ intent: "buildSpin", look: String(look) })}>
              <Ico n="sphere" size={14} />
              {cur.spinState === "failed"
                ? (spinCost > 0 ? t("3D view couldn't be made (tokens returned) — try again · {n} tokens", { n: spinCost }) : t("3D view couldn't be made — try again"))
                : (spinCost > 0 ? t("Add 3D view · {n} tokens", { n: spinCost }) : t("Add 3D view"))}
            </button>
          )}
        </div>

        {/* Who they are scrolls; what to do with them stays put underneath, so "Make a video" is never
            below the fold however much there is to read. (On a phone it is all one scroll.) */}
        <div className={`pc-info${voiceOpen ? " voice" : ""}`}>
         {voiceOpen ? (<>
         {/* Choosing a voice: every voice as a card you can play, and Save always in reach. */}
         <div className="pc-scroll pc-vpanel" ref={voicePanelRef}>
          <button type="button" className="pc-back" onClick={() => setVoiceOpen(false)}>
            <Ico n="arrow" size={14} style={{ transform: "rotate(180deg)" }} /> {t("Back to {name}", { name: c.name })}
          </button>
          <h3 className="pc-vtitle" ref={voiceTitleRef} tabIndex={-1}>{t("Choose a voice")}</h3>
          <p className="pc-vsub">{t("Tap ▶ to hear one. {name} keeps the voice they have until you save.", { name: c.name })}</p>
          {fetcher.data?.error ? <p className="pc-err" role="alert">{fetcher.data.error}</p> : null}
          <VoicePicker gender={gender} value={pendingVoice} onChange={setPendingVoice} myVoices={myVoices} canMake={canMakeVoice} showAll characterKind={characterKind}
            signature={c.signature ? { name: c.name, sample: c.signature.sample || undefined } : undefined} />
         </div>
         <div className="pc-sec pc-acts pc-vfoot">
          <button type="button" className="wb-btn pc-act-main" disabled={busy || pendingVoice === c.voiceId}
            onClick={() => post({ intent: "setVoice", voiceId: pendingVoice })}>
            {busy ? t("Saving…") : t("Save voice")}
          </button>
          <button type="button" className="pc-act" onClick={() => setVoiceOpen(false)}>{t("Cancel")}</button>
         </div>
         </>) : (<>
         <div className="pc-scroll">
          <span className={`pc-badge${isBrandFace ? " bf" : c.custom ? " own" : c.kind !== "person" ? ` ${c.kind}` : ""}`}>{isBrandFace ? <Ico n="star" size={11} /> : null}{badge}</span>
          {renaming ? (
            <form className="pc-rename" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) post({ intent: "rename", name: newName.trim() }); }}>
              <input className="wb-in" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} aria-label={t("Presenter name")} autoFocus />
              <button type="submit" className="wb-btn" disabled={busy || !newName.trim() || newName.trim() === c.name}>{busy ? t("Saving…") : t("Save")}</button>
              <button type="button" className="pc-textbtn" onClick={() => { setRenaming(false); setNewName(c.name); }}>{t("Cancel")}</button>
            </form>
          ) : (
            <h2 className="pc-name">{c.name}{c.custom && <button type="button" className="pc-pencil" onClick={() => setRenaming(true)} aria-label={t("Rename {name}", { name: c.name })}><Ico n="pencil" size={14} /></button>}
              <button type="button" className={`pc-star${fav ? " on" : ""}`} onClick={onFav} aria-pressed={fav}
                aria-label={fav ? t("Remove {name} from favourites", { name: c.name }) : t("Add {name} to favourites", { name: c.name })}
                title={fav ? t("In your favourites — first in every picker") : t("Add to favourites — first in every picker")}>
                <span aria-hidden="true">{fav ? "★" : "☆"}</span>
              </button>
            </h2>
          )}
          <p className="pc-vibe">{c.custom ? t(c.vibe) : c.vibe}</p>
          <div className="pc-facts">
            <span><Ico n="bolt" size={12} /> {t(ENERGY[c.energy])}</span>
            {c.age ? <span><Ico n="hourglass" size={12} /> {c.age}</span> : null}
            {c.looks.length > 1 ? <span><Ico n="shirt" size={12} /> {t("{n} outfits", { n: c.looks.length })}</span> : null}
            {has3d ? <span><Ico n="sphere" size={12} /> {t("3D view")}</span> : null}
          </div>
          {c.about ? <p className="pc-about">{c.about}</p> : null}
          {fetcher.data?.error ? <p className="pc-err" role="alert">{fetcher.data.error}</p> : null}

          {/* Outfits */}
          {showLooks && (
            <section className="pc-sec">
              <h3 className="pc-h">
                <Ico n="shirt" size={13} /> {t("Outfits")}
                {c.custom && missing3d >= 2 && (
                  <button type="button" className="pc-h-act" disabled={busy} onClick={() => post({ intent: "buildSpin", look: "all" })}>
                    <Ico n="sphere" size={11} /> {spinCost > 0 ? t("3D view for all {n} · {cost} tokens", { n: missing3d, cost: missing3d * spinCost }) : t("3D view for all {n}", { n: missing3d })}
                  </button>
                )}
              </h3>
              <div className="pc-looks">
                {c.looks.map((l, i) => (
                  <button type="button" key={i} className={`pc-look${look === i ? " on" : ""}`} onClick={() => { setLook(i); setFlat(false); }} aria-pressed={look === i}>
                    <span className={`pc-look-img ph-bd${l.cut ? "" : " raw"}`}>
                      <img src={l.cut || l.img} alt="" loading="lazy" draggable={false} />
                      {/* which outfits can be turned around — and which one is being made right now */}
                      {l.spin ? <i className="pc-look-3d">{t("3D")}</i> : l.spinState === "building" ? <i className="pc-look-3d busy" aria-label={t("3D view being built")}><b className="pc-build-spin" aria-hidden="true" /></i> : null}
                    </span>
                    <span className="pc-look-nm">{t(l.label)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Voice */}
          <section className="pc-sec">
            <h3 className="pc-h"><Ico n="mic" size={13} /> {t("Voice")}</h3>
            <div className={`pc-voice${playing ? " playing" : ""}`}>
              <div className="pc-voice-row">
                <button type="button" className={`pc-play${playing ? " on" : ""}`} onClick={hear} disabled={!c.voiceSample}
                  aria-label={playing ? t("Stop") : t("Hear {name}'s voice", { name: c.name })}>
                  {playing ? "⏸" : "▶"}
                </button>
                <span className="pc-voice-t">
                  <b className={c.voiceOwn ? "own" : ""}>{voiceName}{playing ? <i className="pc-eq" aria-hidden="true"><i /><i /><i /><i /></i> : null}</b>
                  <small>{voiceNote}</small>
                </span>
                <button type="button" className="pc-chg" ref={voiceChangeRef}
                  onClick={() => { audioRef.current?.pause(); setPlaying(false); setPendingVoice(c.voiceId || (!c.custom ? "" : characterKind ? DEFAULT_CHARACTER_VOICE[characterKind][gender] : DEFAULT_AVATAR_VOICE[gender])); setVoiceOpen(true); }}>
                  {t("Change")}
                </button>
              </div>
              <audio ref={audioRef} preload="none" onEnded={() => setPlaying(false)} />
            </div>
            {voiceFine ? <p className="pc-fine">{voiceFine}</p> : null}
          </section>
          {danger("in")}
         </div>

          {/* What to do with them */}
          <section className="pc-sec pc-acts">
            {isCharacter ? (
              // A character belongs in a story: its way in is Movie Maker, where it is offered in the
              // cast step of the format it suits. (It is not offered as an ad presenter or a Brand Face.)
              <>
                <Link to="/web/film" className="wb-btn pc-act-main"><Ico n="film" size={15} /> {c.kind === "cartoon" ? t("Cast {name} in a Kids Cartoon", { name: c.name }) : t("Cast {name} in a Horror Story", { name: c.name })}</Link>
                <p className="pc-fine">{c.kind === "cartoon"
                  ? t("In Movie Maker, pick Kids Cartoon and write your story — {name} is in the cast step, under “Pick a presenter”.", { name: c.name })
                  : t("In Movie Maker, pick Horror Story and write your story — {name} is in the cast step, under “Pick a presenter”.", { name: c.name })}</p>
                {/* a character that was made Brand Face before that was limited to people can still be un-made */}
                {isBrandFace ? <button type="button" className="pc-act" disabled={busy} onClick={() => post({ intent: "setBrandFace", avatarId: "" })}><Ico n="star" size={14} /> {t("Clear Brand Face")}</button> : null}
              </>
            ) : (
              <>
                <Link to={`/web/studio?do=video&avatar=${encodeURIComponent(c.id)}`} className="wb-btn pc-act-main"><Ico n="video" size={15} /> {t("Make a video with {name}", { name: c.name })}</Link>
                <div className="pc-act-row">
                  <Link to="/web/film" className="pc-act"><Ico n="film" size={14} /> {t("Cast in a movie")}</Link>
                  <button type="button" className={`pc-act${isBrandFace ? " on" : ""}`} disabled={busy} aria-pressed={isBrandFace}
                    onClick={() => post({ intent: "setBrandFace", avatarId: isBrandFace ? "" : c.id })}>
                    <Ico n="star" size={14} /> {isBrandFace ? t("Your Brand Face") : t("Make Brand Face")}
                  </button>
                </div>
                {isBrandFace ? <p className="pc-fine">{t("Your Brand Face is picked for you first whenever you make a video. Tap again to clear it.")}</p> : null}
              </>
            )}
          </section>

          {danger("out")}
         </>)}
        </div>
      </div>
    </div>
  );
}

const PH_STYLE = `
${VOICE_UI_CSS}
${FORGE_CSS}
${SPIN_STAGE_CSS}
.ph-wrap{max-width:1360px;margin:0 auto;}
/* THE backdrop every presenter stands on — grid cards, outfit tiles, the stage and the hero's line-up.
   One soft studio wall, lit from the top: light enough for dark hair and dark clothes to read, deep
   enough that a white shirt still has an edge. */
.ph-bd{background:radial-gradient(125% 95% at 50% 22%,#EDF1E8 0%,#D9E1D4 55%,#C2CDBE 100%);}

/* ---- the hero: the section's green band on the left, the cast standing in the studio on the right ---- */
.ph-hero{position:relative;isolation:isolate;display:flex;align-items:center;min-height:clamp(260px,42vh,380px);margin-bottom:22px;border-radius:22px;overflow:hidden;background:radial-gradient(120% 160% at 0% 0%,#3A8660 0%,#226043 42%,#143F2B 100%);box-shadow:0 24px 54px -28px rgba(8,62,39,.62),inset 0 0 0 1px rgba(255,255,255,.08);}
.ph-hero-rose{position:absolute;z-index:0;left:-150px;bottom:-190px;width:400px;height:400px;background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.28;mix-blend-mode:screen;pointer-events:none;will-change:transform;animation:phspin 115s linear infinite;}
@keyframes phspin{to{transform:rotate(-360deg);}}
/* the studio wall — the light the cards stand in, fading into the green so the two halves are one picture */
.ph-hero-stage{position:absolute;z-index:0;top:0;right:0;bottom:0;width:64%;background:radial-gradient(85% 120% at 58% 10%,#F5F8F0 0%,#E0E8DB 50%,#BECBBA 100%);-webkit-mask-image:linear-gradient(90deg,transparent 0,rgba(0,0,0,.45) 13%,#000 29%);mask-image:linear-gradient(90deg,transparent 0,rgba(0,0,0,.45) 13%,#000 29%);}
/* the wall darkens a little toward the bottom, behind the cast */
.ph-hero-stage::after{content:"";position:absolute;left:0;right:0;bottom:0;height:34%;background:linear-gradient(180deg,rgba(60,84,66,0),rgba(60,84,66,.2));}
.ph-hero.photo .ph-hero-stage::after{display:none;}
.ph-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}
.ph-hero-copy{position:relative;z-index:2;box-sizing:border-box;width:40%;min-width:0;padding:34px 0 34px clamp(26px,3.4vw,48px);}
.ph-hero-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:#E7C879;text-transform:uppercase;letter-spacing:.09em;}
.ph-hero-h{margin:10px 0 0;font-family:Poppins,sans-serif;font-weight:800;font-size:clamp(30px,3.3vw,46px);line-height:1.04;letter-spacing:-.025em;color:#fff;text-shadow:0 2px 18px rgba(0,0,0,.28);}
.ph-hero-copy p{margin:12px 0 0;max-width:400px;font-size:15px;line-height:1.5;color:rgba(255,255,255,.86);}
.ph-hero-cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px;}
.ph-hero-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;box-sizing:border-box;min-height:44px;padding:10px 18px;border-radius:999px;border:1.5px solid rgba(255,255,255,.4);background:rgba(255,255,255,.09);color:#fff;font:inherit;font-size:13.5px;font-weight:800;text-decoration:none;white-space:nowrap;cursor:pointer;transition:transform .14s,background .14s,border-color .14s,box-shadow .14s;}
.ph-hero-btn:hover{transform:translateY(-1px);background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.75);}
.ph-hero-btn.main{background:#FBF6E6;border-color:#FBF6E6;color:#0A5F38;box-shadow:0 10px 22px -10px rgba(0,0,0,.5);}
.ph-hero-btn.main:hover{background:#fff;border-color:#fff;box-shadow:0 14px 28px -10px rgba(0,0,0,.55);}
/* The line-up — framed like a cast photo: everyone from the thigh up, shoulder to shoulder, the lead
   in front. A figure is as tall as --h: the smaller of "a bit taller than the hero" and "what lets the
   whole row fit its width" (--fit, set for how many are standing) — so a tall window never pushes the
   outer figures off the edge. The bottom third of each figure hangs below the hero, which clips it. */
.ph-lineup{position:absolute;z-index:1;top:0;right:0;bottom:0;width:60%;box-sizing:border-box;display:flex;align-items:flex-end;justify-content:center;padding:0 clamp(12px,2vw,30px) 0 0;container-type:size;--fit:52cqw;}
.ph-lu{--h:calc(var(--s,1)*var(--k,1)*118%);position:relative;flex:0 0 auto;height:var(--h);margin:0 -12px -100px;display:block;outline:none;transform-origin:50% 100%;transition:transform .28s cubic-bezier(.2,.8,.2,1),filter .28s;animation:phrise .7s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--d,0)*80ms + 60ms);-webkit-tap-highlight-color:transparent;}
@supports (height:1cqh){.ph-lu{--h:calc(var(--s,1)*var(--k,1)*min(128cqh,var(--fit)));margin:0 calc(var(--h)*-.045) calc(var(--h)*-.32);}}
@keyframes phrise{from{opacity:0;transform:translateY(22px);}}
.ph-lu img{display:block;width:100%;height:100%;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;}
/* the one in the middle stands tallest and in front; each pair further out a little smaller, a little further back */
.ph-lu.r0{--s:1;--d:0;z-index:5;}
.ph-lu.r1{--s:.94;--d:1;z-index:4;}
.ph-lu.r2{--s:.885;--d:2;z-index:3;filter:saturate(.96);}
.ph-lu.r3{--s:.83;--d:3;z-index:2;filter:saturate(.92) brightness(.985);}
/* a cartoon character is small: it stands in FRONT of the grown-ups, never behind one */
.ph-lu.k-cartoon{z-index:6;filter:none;}
.ph-lu:hover,.ph-lu:focus-visible{transform:translateY(-8px) scale(1.03);z-index:7;filter:none;}
.ph-lu-nm{position:absolute;z-index:2;left:50%;bottom:calc(32% + 12px);transform:translate(-50%,6px);opacity:0;display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:999px;background:rgba(20,32,26,.82);color:#fff;font-family:Poppins,sans-serif;font-size:11.5px;font-weight:700;letter-spacing:.02em;white-space:nowrap;pointer-events:none;transition:opacity .18s,transform .18s;box-shadow:0 4px 12px rgba(20,32,26,.25);}
.ph-lu:hover .ph-lu-nm,.ph-lu:focus-visible .ph-lu-nm,.ph-lu.lead .ph-lu-nm{opacity:1;transform:translate(-50%,0);}
.ph-lu.lead .ph-lu-nm{background:#E7C879;color:#3A2C06;}
.ph-lu:focus-visible .ph-lu-nm{box-shadow:0 0 0 3px var(--green2,#12A85E);}

.ph-forging{display:flex;align-items:flex-start;gap:6px;font-size:12.5px;line-height:1.4;color:var(--ink2,#4A554E);margin:0 2px 8px;}
.ph-forging svg{margin-top:2px;}
.ph-forging.bad{color:#8A3B12;}
.ph-linkbtn{border:0;background:transparent;padding:2px 4px;font:inherit;font-weight:800;color:var(--green,#0C7A46);text-decoration:underline;text-underline-offset:2px;cursor:pointer;}

/* ---- the cast ---- */
.ph-bar{display:flex;align-items:center;justify-content:space-between;gap:10px 20px;flex-wrap:wrap;margin:0 2px 14px;}
.ph-bar-t{display:flex;align-items:baseline;gap:4px 12px;flex-wrap:wrap;min-width:0;}
.ph-bar h2{margin:0;font-family:Poppins,sans-serif;font-weight:800;font-size:21px;line-height:1.2;letter-spacing:-.015em;color:var(--ink,#14201A);}
.ph-bar-t span{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:600;color:var(--ink2,#4A554E);}
.ph-filters{display:inline-flex;gap:3px;padding:4px;border-radius:999px;background:#fff;border:1px solid var(--line,#E1DECD);box-shadow:0 2px 8px rgba(20,32,26,.05);}
.ph-filters button{display:inline-flex;align-items:center;gap:6px;min-height:36px;border:0;background:transparent;border-radius:999px;padding:6px 14px;font:inherit;font-size:12.5px;font-weight:800;color:var(--ink2,#4A554E);cursor:pointer;transition:background .12s,color .12s;}
.ph-filters button i{font-style:normal;font-weight:700;font-size:11px;opacity:.72;font-variant-numeric:tabular-nums;}
.ph-filters button:hover{background:#F1F5EE;color:var(--ink,#14201A);}
.ph-filters button.on{background:var(--green,#0C7A46);color:#fff;}
@media(pointer:coarse){.ph-filters button{min-height:44px;}}
.ph-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:16px;}
.ph-face{position:relative;display:flex;flex-direction:column;border-radius:18px;overflow:hidden;border:1px solid var(--line,#E1DECD);background:#fff;box-shadow:0 1px 2px rgba(20,32,26,.04),0 10px 24px -16px rgba(20,32,26,.24);cursor:pointer;text-decoration:none;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s,border-color .2s;}
.ph-facewrap{position:relative;display:grid;transition:transform .2s cubic-bezier(.2,.8,.2,1);}
.ph-facewrap:hover{transform:translateY(-4px);}
.ph-facewrap:hover .ph-face{box-shadow:0 2px 4px rgba(20,32,26,.05),0 24px 40px -20px rgba(20,32,26,.4);border-color:#9CCBB1;}
.ph-facewrap.can-hear .ph-face-meta{padding-right:44px;}
.ph-hear{position:absolute;right:10px;bottom:12px;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;padding:0;border:1px solid #BFE2CD;background:#EAF6EF;color:var(--green,#0C7A46);font-size:11px;line-height:1;cursor:pointer;transition:background .15s,transform .15s;}
.ph-hear:hover{background:#D5EEDF;transform:scale(1.06);}
.ph-hear.on{background:var(--green,#0C7A46);border-color:var(--green,#0C7A46);color:#fff;}
.ph-hear:focus-visible{outline:2px solid var(--green,#0C7A46);outline-offset:2px;}
.ph-hear::before{content:"";position:absolute;inset:-7px;border-radius:50%;} /* a 44px thumb target round the 30px dot */
.ph-hear-eq{display:inline-flex;align-items:flex-end;gap:2px;height:11px;}
.ph-hear-eq i{display:block;width:2.5px;background:currentColor;border-radius:1px;animation:phEq .8s ease-in-out infinite;}
.ph-hear-eq i:nth-child(2){animation-delay:.15s}.ph-hear-eq i:nth-child(3){animation-delay:.3s}
@keyframes phEq{0%,100%{height:3px}50%{height:11px}}
@media (prefers-reduced-motion:reduce){.ph-facewrap,.ph-facewrap:hover{transform:none}.ph-hear-eq i{animation:none;height:8px}}
.ph-face-img{display:block;position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;}
.ph-face-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 18%;display:block;transition:transform .35s cubic-bezier(.2,.8,.2,1);}
.ph-face:hover .ph-face-img img{transform:scale(1.045);}
/* "open" — slides in on the picture when the card is pointed at */
.ph-face-go{position:absolute;right:9px;bottom:9px;width:32px;height:32px;border-radius:50%;background:var(--green,#0C7A46);color:#fff;display:grid;place-items:center;box-shadow:0 6px 14px -4px rgba(12,122,70,.6);opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s;}
.ph-face:hover .ph-face-go,.ph-face:focus-visible .ph-face-go{opacity:1;transform:none;}
.ph-face-meta{display:flex;flex-direction:column;gap:2px;min-width:0;padding:10px 12px 12px;}
.ph-face-nm{font-family:Poppins,sans-serif;font-size:14px;font-weight:700;line-height:1.25;color:var(--ink,#14201A);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ph-face-voice{display:flex;align-items:center;gap:4px;min-width:0;font-size:11.5px;font-weight:600;color:var(--ink2,#4A554E);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ph-face-voice svg{flex:0 0 auto;}
.ph-face-voice.own{color:var(--green,#0C7A46);}
.ph-face.bf{border-color:#D3A63A;box-shadow:0 0 0 1.5px #D3A63A,0 10px 24px -16px rgba(20,32,26,.24);}
.ph-face.bf:hover{border-color:#D3A63A;box-shadow:0 0 0 1.5px #D3A63A,0 24px 40px -20px rgba(20,32,26,.4);}
.ph-bfbadge,.ph-yoursbadge,.ph-3d{position:absolute;top:9px;z-index:2;display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:800;border-radius:999px;padding:3px 8px;line-height:1.2;}
.ph-bfbadge{left:9px;background:#E7C879;color:#3A2C06;box-shadow:0 2px 6px rgba(0,0,0,.18);}
.ph-yoursbadge{left:9px;background:var(--green,#0C7A46);color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.18);}
.ph-3d{right:9px;background:rgba(20,32,26,.62);color:#fff;letter-spacing:.03em;}
.ph-face-img .ph-3d{top:auto;right:auto;left:9px;bottom:9px;}
.ph-fav{position:absolute;top:7px;right:7px;z-index:3;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;padding:0;border:1px solid rgba(20,32,26,.10);background:rgba(255,255,255,.92);color:#6F7972;font-size:16px;line-height:1;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.14);transition:transform .12s,color .12s,background .12s;}
.ph-fav::before{content:"";position:absolute;inset:-7px;border-radius:50%;} /* a 44px thumb target round the 30px dot */
.ph-fav:hover{transform:scale(1.08);color:#A87A08;}
.ph-fav.on{background:#FFF4D0;border-color:#E7C879;color:#A87A08;}
.ph-fav:focus-visible{outline:2px solid var(--green,#0C7A46);outline-offset:2px;}
.ph-refine{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:-4px 2px 16px;}
.ph-refine button{min-height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--line,#E1DECD);background:#fff;font:inherit;font-size:12px;font-weight:700;color:var(--ink2,#4A554E);cursor:pointer;transition:background .12s,border-color .12s,color .12s;}
.ph-refine button:hover{border-color:#9CCBB1;color:var(--ink,#14201A);}
.ph-refine button.gap{margin-left:8px;}
.ph-refine button.on{background:#EAF6EF;border-color:#9CCBB1;color:var(--green,#0C7A46);}
.ph-refine .ph-refine-clear{border-color:transparent;background:transparent;color:var(--green,#0C7A46);text-decoration:underline;text-underline-offset:2px;}
@media(pointer:coarse){.ph-refine button{min-height:40px;}}
.ph-none{margin:0 2px 16px;font-size:13.5px;line-height:1.5;color:var(--ink2,#4A554E);}
@media(max-width:640px){.ph-refine{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;margin:-6px 0 14px;padding:2px 0;}.ph-refine::-webkit-scrollbar{display:none;}.ph-refine button{flex:0 0 auto;}}
.pc-star{position:relative;display:inline-grid;place-items:center;width:34px;height:34px;margin-left:8px;padding:0;vertical-align:middle;border-radius:50%;border:1px solid var(--line,#E1DECD);background:#fff;color:#6F7972;font-size:18px;line-height:1;cursor:pointer;transition:color .12s,background .12s;}
.pc-star::before{content:"";position:absolute;inset:-5px;border-radius:50%;}
.pc-star:hover{color:#A87A08;}
.pc-star.on{background:#FFF4D0;border-color:#E7C879;color:#A87A08;}
.ph-kind{position:absolute;top:9px;left:9px;z-index:2;display:inline-flex;align-items:center;font-size:10px;font-weight:800;border-radius:999px;padding:3px 8px;line-height:1.2;box-shadow:0 2px 6px rgba(0,0,0,.18);}
.ph-kind.cartoon{background:#FFD45C;color:#4A3300;}
.ph-kind.monster{background:#2B2140;color:#E9DEFF;}
.pc-badge.cartoon{background:#FFE9A8;color:#4A3300;}
.pc-badge.monster{background:#2B2140;color:#E9DEFF;}
/* "make your own" — the first tile of the grid */
.ph-new{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;width:100%;font:inherit;cursor:pointer;padding:18px 14px;text-align:center;border-radius:18px;border:1.5px dashed #8CC3A6;background:linear-gradient(180deg,#F4FAF6,#E5F3EB);color:var(--ink,#14201A);text-decoration:none;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s,border-color .2s,background .2s;}
.ph-new:hover{transform:translateY(-4px);border-color:var(--green,#0C7A46);background:linear-gradient(180deg,#F7FCF9,#DAEFE3);box-shadow:0 24px 40px -22px rgba(12,122,70,.5);}
.ph-new-ico{flex:0 0 auto;width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#12A85E,#0A5F38);color:#fff;display:grid;place-items:center;box-shadow:0 10px 20px -8px rgba(12,122,70,.65);}
.ph-new b{font-family:Poppins,sans-serif;font-weight:800;font-size:15px;line-height:1.2;}
.ph-new-sub{font-size:11.5px;line-height:1.42;color:var(--ink2,#4A554E);}
.ph-new i{font-style:normal;display:inline-flex;align-items:center;gap:5px;margin-top:4px;padding:7px 13px;border-radius:999px;background:#fff;border:1px solid #BFE0CD;color:var(--green,#0C7A46);font-size:12px;font-weight:800;white-space:nowrap;}

@media(max-width:1179px){.ph-lineup{--fit:72cqw;}.ph-lu.r3{display:none;}}
@media(max-width:899px){
  .ph-hero-copy{width:50%;padding-top:26px;padding-bottom:26px;}
  .ph-hero-copy p{font-size:13.5px;}
  .ph-hero-stage{width:58%;}
  .ph-lineup{width:50%;--fit:104cqw;}
  .ph-lu.r2{display:none;}
}
@media(max-width:640px){
  /* phone: the copy, then the cast standing along the bottom of the card */
  .ph-hero{flex-direction:column;align-items:stretch;min-height:0;border-radius:18px;margin-bottom:18px;}
  .ph-hero-copy{width:auto;padding:20px 18px 0;}
  .ph-hero-h{font-size:27px;}
  .ph-hero-cta{margin-top:14px;gap:8px;}
  .ph-hero-btn{flex:1 1 auto;padding:10px 14px;font-size:13px;}
  .ph-hero-stage{top:auto;left:0;width:auto;height:222px;-webkit-mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.5) 16%,#000 36%);mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.5) 16%,#000 36%);}
  .ph-hero.photo .ph-hero-stage{position:relative;height:150px;margin-top:14px;}
  .ph-lineup{position:relative;width:auto;height:200px;margin-top:10px;padding:0 10px;--fit:72cqw;}
  .ph-lu.r2{display:block;}
  .ph-bar{margin-bottom:12px;}
  .ph-bar h2{font-size:18px;}
  .ph-filters{display:flex;width:100%;box-sizing:border-box;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
  .ph-filters::-webkit-scrollbar{display:none;}
  .ph-filters button{flex:1 0 auto;justify-content:center;padding:6px 12px;}
  .ph-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}
  .ph-face{border-radius:14px;}
  .ph-face-meta{padding:7px 8px 9px;}
  .ph-facewrap.can-hear .ph-face-meta{padding-right:34px;}
  .ph-hear{width:26px;height:26px;right:6px;bottom:8px;font-size:9.5px;}
  .ph-hear::before{inset:-9px;}
  .ph-face-nm{font-size:12px;}
  .ph-face-voice{font-size:10.5px;}
  .ph-face-go{display:none;}
  .ph-bfbadge,.ph-yoursbadge,.ph-3d,.ph-kind{top:6px;font-size:9px;padding:2px 6px;}
  .ph-bfbadge,.ph-yoursbadge,.ph-kind{left:6px;}
  .ph-kind~.ph-3d{display:none;}
  .ph-3d{right:6px;}
  .ph-3d svg{display:none;}
  .ph-bfbadge~.ph-3d{display:none;}
  .ph-new{border-radius:14px;padding:12px 8px;gap:6px;}
  .ph-new-ico{width:40px;height:40px;}
  .ph-new b{font-size:12.5px;}
  .ph-new-sub{display:none;}
  .ph-new i{font-size:10px;padding:5px 8px;}
  .ph-new i svg{display:none;}
}
@media(prefers-reduced-motion:reduce){.ph-hero-rose,.ph-lu{animation:none;}.ph-lu,.ph-face,.ph-new,.ph-face-go{transition:none;}.ph-lu:hover,.ph-lu:focus-visible,.ph-face:hover,.ph-new:hover{transform:none;}}

/* ---- the character view ---- */
.pc-scrim{font-family:Inter,-apple-system,sans-serif;color:var(--ink,#14201A);position:fixed;inset:0;z-index:10500;background:rgba(11,20,15,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px;animation:pcfade .16s ease;}
@keyframes pcfade{from{opacity:0}}
.pc{position:relative;display:grid;grid-template-columns:minmax(0,45fr) minmax(0,55fr);width:min(940px,100%);height:min(660px,calc(100dvh - 36px));background:var(--card,#FDFCF7);border-radius:22px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.42);animation:pcrise .22s cubic-bezier(.2,.8,.2,1);}
@keyframes pcrise{from{opacity:0;transform:translateY(14px) scale(.985)}}
.pc-x{position:absolute;top:12px;right:12px;z-index:5;width:36px;height:36px;border-radius:50%;border:1px solid var(--line,#E1DECD);background:rgba(253,252,247,.92);color:var(--ink,#14201A);display:grid;place-items:center;cursor:pointer;}
.pc-x:hover{border-color:var(--green2,#12A85E);color:var(--green,#0C7A46);}
.pc-stage{position:relative;min-height:0;overflow:hidden;}
.pc-still{position:absolute;left:50%;bottom:0;width:auto;height:auto;max-width:100%;max-height:94%;transform:translateX(-50%);display:block;user-select:none;-webkit-user-select:none;}
.pc-still.raw{inset:0;left:0;transform:none;width:100%;height:100%;object-fit:cover;object-position:center 18%;}
.pc-count{position:absolute;top:14px;left:14px;z-index:3;padding:3px 9px;border-radius:999px;background:rgba(20,32,26,.5);color:#fff;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.02em;}
.pc-view{position:absolute;top:12px;left:50%;z-index:3;transform:translateX(-50%);display:inline-flex;padding:3px;border-radius:999px;background:rgba(253,252,247,.86);box-shadow:0 2px 8px rgba(20,32,26,.14);}
.pc-view button{display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;border-radius:999px;padding:5px 11px;font-size:11.5px;font-weight:800;color:var(--ink2,#4A554E);cursor:pointer;}
.pc-view button.on{background:var(--green,#0C7A46);color:#fff;}
.pc-look-3d{position:absolute;top:4px;right:4px;z-index:1;display:grid;place-items:center;min-width:22px;height:16px;padding:0 5px;border-radius:999px;background:var(--green,#0C7A46);color:#fff;font-size:9.5px;font-weight:800;font-style:normal;letter-spacing:.03em;}
.pc-look-3d.busy{background:rgba(20,32,26,.7);padding:0 4px;}
.pc-look-3d .pc-build-spin{width:9px;height:9px;border-width:1.5px;}
.pc-nav{position:absolute;top:50%;z-index:3;width:38px;height:38px;margin-top:-19px;border-radius:50%;border:0;background:rgba(253,252,247,.86);color:var(--ink,#14201A);display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 8px rgba(20,32,26,.18);transition:background .12s,transform .12s;}
.pc-nav:hover{background:#fff;transform:scale(1.06);}
.pc-nav.prev{left:10px;}
.pc-nav.next{right:10px;}
.pc-build,.pc-buildbtn{position:absolute;z-index:3;left:12px;right:12px;bottom:12px;margin-inline:auto;width:fit-content;max-width:calc(100% - 24px);display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:999px;font-size:12px;font-weight:800;}
.pc-build{background:rgba(20,32,26,.72);color:#fff;font-weight:700;line-height:1.3;border-radius:14px;}
.pc-build-spin{flex:0 0 auto;width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:pcspin .8s linear infinite;}
@keyframes pcspin{to{transform:rotate(360deg)}}
.pc-buildbtn{border:0;background:var(--green,#0C7A46);color:#fff;cursor:pointer;text-align:left;line-height:1.3;border-radius:14px;box-shadow:0 4px 14px rgba(12,122,70,.35);}
.pc-buildbtn:hover{background:#0A6A3D;}
.pc-buildbtn:disabled{opacity:.6;cursor:default;}
/* the figure sits ON the stage floor: measured from the bottom edge, not from a flex margin */
.pc-stage .spin-fig{position:absolute;left:50%;bottom:6%;height:86%;margin:0;transform:translateX(-50%);}
.pc-info{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;}
.pc-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:26px 26px 20px;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:#C9D2C6 transparent;}
.pc-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;background:#EAF0E6;color:var(--ink2,#4A554E);font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;}
.pc-badge.own{background:#E3F3EA;color:var(--green,#0C7A46);}
.pc-badge.bf{background:#F6E9BF;color:#5C4508;}
.pc-name{display:flex;align-items:center;gap:8px;margin:9px 44px 0 0;font-family:Poppins,sans-serif;font-weight:800;font-size:32px;line-height:1.08;letter-spacing:-.02em;color:var(--ink,#14201A);overflow-wrap:anywhere;}
.pc-pencil{flex:0 0 auto;width:30px;height:30px;border-radius:50%;border:1px solid var(--line,#E1DECD);background:transparent;color:var(--ink2,#4A554E);display:grid;place-items:center;cursor:pointer;}
.pc-pencil:hover{border-color:var(--green2,#12A85E);color:var(--green,#0C7A46);}
.pc-rename{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 44px 0 0;}
.pc-rename .wb-in{flex:1 1 160px;min-width:0;}
.pc-vibe{margin:4px 0 0;font-size:14px;font-weight:700;color:var(--green,#0C7A46);}
.pc-facts{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0;}
.pc-facts span{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;border:1px solid var(--line,#E1DECD);background:#fff;font-size:12px;font-weight:700;color:var(--ink,#14201A);}
.pc-about{margin:12px 0 0;font-size:13.5px;line-height:1.5;color:var(--ink2,#4A554E);max-width:46ch;}
.pc-err{margin:12px 0 0;padding:8px 11px;border-radius:10px;background:#FCF1F0;color:#B3261E;font-size:12.5px;font-weight:700;}
.pc-sec{margin-top:18px;padding-top:16px;border-top:1px solid var(--line,#E1DECD);}
.pc-h-act{margin-left:auto;display:inline-flex;align-items:center;gap:4px;border:1.5px solid var(--line,#E1DECD);background:#fff;border-radius:999px;padding:4px 10px;font:inherit;font-size:11px;font-weight:800;letter-spacing:0;text-transform:none;color:var(--green,#0C7A46);cursor:pointer;}
.pc-h-act:hover{border-color:var(--green2,#12A85E);background:#F3F9F4;}
.pc-h-act:disabled{opacity:.6;cursor:default;}
.pc-h{display:flex;align-items:center;gap:6px;margin:0 0 9px;font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--ink2,#4A554E);}
.pc-voice{border:1.5px solid var(--line,#E1DECD);border-radius:16px;background:#fff;overflow:hidden;transition:border-color .16s,box-shadow .16s;}
.pc-voice:hover{border-color:#BFD9C9;}
.pc-voice.playing{border-color:var(--green2,#12A85E);box-shadow:0 0 0 3px rgba(18,168,94,.13);}
/* a little equaliser beside the name while the voice is playing */
.pc-eq{display:inline-flex;align-items:flex-end;gap:2px;height:12px;margin-left:8px;vertical-align:-1px;}
.pc-eq i{width:3px;height:100%;border-radius:2px;background:var(--green2,#12A85E);transform-origin:50% 100%;animation:pceq .9s ease-in-out infinite;}
.pc-eq i:nth-child(1){animation-delay:-.2s;}
.pc-eq i:nth-child(2){animation-delay:-.55s;}
.pc-eq i:nth-child(3){animation-delay:-.05s;}
.pc-eq i:nth-child(4){animation-delay:-.7s;}
@keyframes pceq{0%,100%{transform:scaleY(.3);}50%{transform:scaleY(1);}}
.pc-voice-row{display:flex;align-items:center;gap:11px;padding:10px 12px;}
.pc-play{flex:0 0 auto;width:40px;height:40px;border-radius:50%;border:0;background:var(--green,#0C7A46);color:#fff;font-size:13px;display:grid;place-items:center;cursor:pointer;transition:transform .12s,background .12s;}
.pc-play:hover{transform:scale(1.06);}
.pc-play.on{background:var(--ink,#14201A);}
.pc-play:disabled{background:#C9D2C6;cursor:default;transform:none;}
.pc-voice-t{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;}
.pc-voice-t b{font-size:14.5px;color:var(--ink,#14201A);}
.pc-voice-t b.own{color:var(--green,#0C7A46);}
.pc-voice-t small{font-size:12px;color:var(--ink2,#4A554E);line-height:1.3;}
.pc-chg{flex:0 0 auto;border:1.5px solid var(--line,#E1DECD);background:transparent;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:800;color:var(--green,#0C7A46);cursor:pointer;}
.pc-chg:hover{border-color:var(--green2,#12A85E);background:#F3F9F4;}
/* ---- choosing a voice: its own screen in the column beside the stage ---- */
.pc-vpanel{display:flex;flex-direction:column;}
.pc-back{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;min-height:36px;margin:-4px 0 10px -8px;padding:6px 12px 6px 8px;border:0;border-radius:999px;background:transparent;font:inherit;font-size:12.5px;font-weight:800;color:var(--ink2,#4A554E);cursor:pointer;}
.pc-back:hover{background:#EDF1E8;color:var(--ink,#14201A);}
.pc-vtitle:focus{outline:none}
.pc-vtitle{margin:0 44px 0 0;font-family:Poppins,sans-serif;font-weight:800;font-size:27px;line-height:1.1;letter-spacing:-.02em;color:var(--ink,#14201A);}
.pc-vsub{margin:7px 0 16px;max-width:52ch;font-size:13.5px;line-height:1.45;color:var(--ink2,#4A554E);}
/* the shared picker, laid out as cards: play on the left, name over its description, a tick when chosen */
.pc-vpanel .ws-vpx{margin:0;}
.pc-vpanel .ws-vp{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;max-height:none;overflow:visible;margin:0 0 12px;padding:0;}
.pc-vpanel .ws-vp-sec{grid-column:1/-1;margin:8px 0 -1px;padding:0 2px;font-size:11px;letter-spacing:.07em;color:var(--ink2,#4A554E);}
.pc-vpanel .ws-vp-sec:first-child{margin-top:0;}
.pc-vpanel .ws-vp-chip{align-items:center;gap:10px;box-sizing:border-box;min-height:60px;padding:8px 10px;border:1.5px solid var(--line,#E1DECD);border-radius:14px;background:#fff;overflow:visible;transition:border-color .14s,box-shadow .14s,background .14s;}
.pc-vpanel .ws-vp-chip:hover{border-color:#9CCBB1;box-shadow:0 8px 18px -12px rgba(20,32,26,.35);}
.pc-vpanel .ws-vp-chip.sel{border-color:var(--green,#0C7A46);box-shadow:0 0 0 1px var(--green,#0C7A46),0 8px 18px -12px rgba(12,122,70,.45);background:#F0FAF4;}
.pc-vpanel .ws-vp-chip.sig{grid-column:1/-1;border-color:#E7D08A;background:linear-gradient(135deg,#FFFDF4,#FBF3D9);}
.pc-vpanel .ws-vp-chip.sig.sel{border-color:var(--green,#0C7A46);background:linear-gradient(135deg,#F4FBF7,#E6F5EC);}
.pc-vpanel .ws-vp-chip.sig .ws-vp-pick b{display:inline-flex;align-items:center;gap:5px;}
.pc-vpanel .ws-vp-play{order:-1;flex:0 0 auto;width:40px;height:40px;border:0;border-radius:50%;background:#E3F3EA;color:var(--green,#0C7A46);font-size:12px;transition:background .12s,transform .12s;}
.pc-vpanel .ws-vp-play:hover{background:#D0EBDC;transform:scale(1.06);}
.pc-vpanel .ws-vp-play.on{background:var(--green,#0C7A46);color:#fff;}
.pc-vpanel .ws-vp-pick{display:grid;grid-template-columns:minmax(0,1fr) auto;align-content:center;column-gap:8px;row-gap:1px;min-height:44px;padding:0;}
.pc-vpanel .ws-vp-pick b{grid-column:1;min-width:0;font-size:14px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pc-vpanel .ws-vp-blurb{grid-column:1;font-size:12px;line-height:1.3;}
.pc-vpanel .ws-vp-tick{grid-column:2;grid-row:1/span 2;align-self:center;width:22px;height:22px;border-radius:50%;background:var(--green,#0C7A46);color:#fff;display:grid;place-items:center;font-size:12px;}
.pc-vpanel .ws-vp-rm{align-self:center;width:32px;height:32px;padding:0;border:0;border-radius:9px;}
.pc-vpanel .ws-vp-rm.armed{width:auto;padding:0 10px;}
.pc-vpanel .ws-vp-own{border-radius:14px;padding:12px 14px;}
.pc-info>.pc-acts.pc-vfoot{flex-direction:row;align-items:stretch;}
.pc-vfoot .pc-act-main{flex:1 1 auto;width:auto;}
.pc-vfoot .pc-act{flex:0 0 auto;min-width:112px;}
.pc-fine{margin:8px 0 0;font-size:11.5px;line-height:1.4;color:var(--ink2,#4A554E);}
.pc-looks{display:flex;gap:9px;flex-wrap:wrap;}
.pc-look{flex:0 0 auto;width:74px;border:0;background:transparent;padding:0;cursor:pointer;text-align:center;transition:transform .14s;}
.pc-look:hover{transform:translateY(-2px);}
.pc-look.on .pc-look-nm{color:var(--green,#0C7A46);font-weight:800;}
.pc-look-img{position:relative;display:grid;place-items:center;width:100%;aspect-ratio:3/4;border-radius:11px;overflow:hidden;border:2px solid transparent;box-shadow:0 0 0 1px var(--line,#E1DECD);color:var(--green,#0C7A46);transition:box-shadow .12s,border-color .12s;}
.pc-look-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 18%;display:block;}
.pc-look.on .pc-look-img{border-color:var(--green,#0C7A46);box-shadow:0 0 0 1px var(--green,#0C7A46);}
.pc-look:hover .pc-look-img{box-shadow:0 0 0 1px var(--green2,#12A85E);}
.pc-look-nm{display:block;margin-top:5px;font-size:11.5px;font-weight:700;color:var(--ink,#14201A);}
.pc-info>.pc-acts{flex:0 0 auto;display:flex;flex-direction:column;gap:9px;margin-top:0;padding:14px 26px 18px;background:var(--card,#FDFCF7);}
.pc-act-main{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;text-align:center;}
.pc-act-row{display:grid;grid-template-columns:1fr 1fr;gap:9px;}
.pc-act{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:9px 12px;border-radius:12px;border:1.5px solid var(--line,#E1DECD);background:#fff;color:var(--ink,#14201A);font-size:13px;font-weight:800;text-decoration:none;cursor:pointer;transition:border-color .12s,background .12s;}
.pc-act:hover{border-color:var(--green2,#12A85E);background:#F6FBF8;}
.pc-act.on{border-color:var(--gold,#B08526);background:#FBF3D9;color:#5C4508;}
.pc-act:disabled{opacity:.6;cursor:default;}
.pc-danger{display:flex;}
.pc-danger.out{display:none;}
.pc-del{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:6px 2px;font-size:12.5px;font-weight:700;color:#9A4A42;cursor:pointer;}
.pc-del:hover{color:#B3261E;}
.pc-del.go{padding:7px 14px;border-radius:999px;background:#B3261E;color:#fff;font-weight:800;}
.pc-warn{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;font-size:13px;font-weight:700;color:#B3261E;}
.pc-textbtn{border:0;background:transparent;padding:6px 4px;font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E);text-decoration:underline;text-underline-offset:2px;cursor:pointer;}
@media(max-width:760px){
  .pc-scrim{padding:0;align-items:stretch;}
  .pc{display:block;width:100%;height:100dvh;border-radius:0;overflow-y:auto;-webkit-overflow-scrolling:touch;}
  .pc-stage{height:min(54dvh,440px);}
  .pc-info{display:block;overflow:visible;padding-bottom:calc(28px + env(safe-area-inset-bottom,0px));}
  .pc-scroll{overflow:visible;padding:18px 16px 0;}
  .pc-info>.pc-acts{margin-top:18px;padding:16px 16px 0;}
  .pc-danger.in{display:none;}
  .pc-info.voice{padding-bottom:0;}
  .pc-vpanel .ws-vp{grid-template-columns:minmax(0,1fr);}
  .pc-vtitle{font-size:23px;}
  .pc-info>.pc-acts.pc-vfoot{position:sticky;bottom:0;z-index:3;margin-top:14px;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));box-shadow:0 -12px 22px -16px rgba(20,32,26,.4);}
  .pc-danger.out{display:flex;margin-top:14px;padding:0 16px;border-top:0;}
  .pc-name{font-size:27px;margin-right:0;}
  .pc-x{position:fixed;top:calc(10px + env(safe-area-inset-top,0px));right:10px;}
}
/* a desktop has room for a bigger figure and a calmer column beside it */
@media(min-width:1180px) and (min-height:600px){
  .pc{width:min(1140px,100%);height:min(760px,calc(100dvh - 44px));grid-template-columns:minmax(0,47fr) minmax(0,53fr);border-radius:26px;}
  .pc-scroll{padding:30px 40px 22px;}
  .pc-info>.pc-acts{padding:16px 40px 22px;}
  .pc-name{font-size:38px;margin-top:10px;}
  .pc-vibe{font-size:15.5px;margin-top:5px;}
  .pc-facts{margin-top:14px;gap:7px;}
  .pc-facts span{padding:6px 12px;font-size:12.5px;}
  .pc-about{font-size:14.5px;margin-top:14px;max-width:52ch;}
  .pc-scroll .pc-sec{margin-top:19px;padding-top:17px;}
  .pc-look{width:86px;}
  .pc-x{top:16px;right:16px;width:40px;height:40px;}
  .pc-nav{width:44px;height:44px;margin-top:-22px;}
  .pc-nav.prev{left:14px;}
  .pc-nav.next{right:14px;}
  .pc-count{top:18px;left:18px;}
  .pc-view{top:16px;}
  .pc-view button{padding:6px 13px;font-size:12px;}
}
@media(prefers-reduced-motion:reduce){.pc-scrim,.pc,.pc-eq i{animation:none;}.ph-face-img img,.pc-look{transition:none;}.pc-look:hover{transform:none;}}
`;
