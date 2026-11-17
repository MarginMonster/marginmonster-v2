import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useLocation, useNavigate, useRevalidator, useSearchParams, type ShouldRevalidateFunction } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { readUiLang, tr } from "../lib/ui-i18n";
import { db } from "../db.server";
import { requireWebIdentity } from "../lib/web-auth.server";
import { LIVE_AVATARS, OUTFITS, avatarImg, DESIGNED_VOICES, privateCastFor, type Avatar } from "../lib/avatars";
import { AVATAR_VOICES, DEFAULT_AVATAR_VOICE } from "../lib/avatar-voice-catalog";
import { TOKEN_COST } from "../lib/plan-config";
import { stockSpin, stockCut, stockLooks, customSpin, customCut, type Spin } from "../lib/presenter-kits";
import { useModalA11y } from "../lib/use-modal-a11y";
import { VoicePicker, VOICE_UI_CSS, type MyVoiceT } from "../components/VoicePicker";
import { SpinStage, SPIN_STAGE_CSS } from "../components/SpinStage";

export const meta: MetaFunction = () => [{ title: "Your presenters · EASYMODE" }];

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
  vibe: string; about: string; gender: "f" | "m"; age: string; energy: "hype" | "warm" | "calm";
  img: string; cut: string | null; looks: Look[];
  cutsPending: boolean;
  /** "" = a stock presenter on their own signature voice, or a custom presenter saved without one. */
  voiceId: string; voice: string; voiceOwn: boolean; voiceSample: string;
  /** Stock presenters only: their designed voice, and a clip of it when there is one. */
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
  const { customCastFor, stockVoicesFor } = await import("../lib/custom-avatars.server");
  const { shopVoiceClones, canCloneVoice } = await import("../lib/voice-clone.server");
  const { spinsAreFree, ensureKits } = await import("../lib/presenter-kit.server");
  // Bring this shop's presenters' kits up to date in the background: any cut-out still missing, any 3D
  // view its creation paid for that hasn't started, any build a deploy interrupted. First, so what is
  // read next already shows them as under way; the page polls below until they land.
  const cutting = await ensureKits(shop.id).catch((e) => {
    console.error(`[kit] ensureKits: ${e instanceof Error ? e.message : e}`);
    return new Set<string>();
  });
  const [custom, myVoices, stockVoice] = await Promise.all([customCastFor(shop.id), shopVoiceClones(shop.id), stockVoicesFor(shop.id)]);

  const voiceInfo = (voiceId: string | null | undefined, stockId?: string) => {
    const mine = myVoices.find((v) => v.voiceId === voiceId);
    if (mine) return { voiceId: mine.voiceId, voice: mine.label, voiceOwn: true, voiceSample: mine.preview };
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
      id: c.id, rowId: c.rowId, name: c.name, custom: true,
      vibe: "Your brand presenter", about: /the brand's own presenter character$/.test(c.desc) ? "" : sentence(c.desc),
      gender: c.gender, age: "", energy: c.energy,
      img: c.img, cut: cutAt(0),
      looks,
      cutsPending: cutting.has(c.rowId),
      ...voiceInfo(c.voiceId), signature: null,
    };
  });
  const stock: Member[] = [...privateCastFor(account.email, shop.id, shop.domain), ...LIVE_AVATARS].map((a) => {
    const img = avatarImg(a.id, 0);
    const cut = stockCut(a.id, 0);
    // one portrait for most of the live cast today; a presenter with all four outfits shows all four
    const looks: Look[] = Array.from({ length: Math.min(OUTFITS.length, stockLooks(a.id)) }, (_, v) => ({
      label: OUTFITS[v].label, img: avatarImg(a.id, v), cut: stockCut(a.id, v), spin: stockSpin(a.id, v), spinState: "none",
    }));
    return {
      id: a.id, rowId: "", name: a.name, custom: false,
      vibe: a.vibe, about: sentence(a.desc), gender: a.gender, age: ageText(a), energy: a.energy,
      img, cut, looks,
      cutsPending: false,
      ...voiceInfo(stockVoice[a.id], a.id),
      signature: { sample: DESIGNED_VOICES.has(a.id) ? `/voice-videos/${a.id}.mp4?v=4` : "" },
    };
  });
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
  // Brand Face leads the grid (your face, front and center), then everyone else.
  const bf = cast.find((c) => c.id === brandFaceId);
  const ordered = bf ? [bf, ...cast.filter((c) => c.id !== brandFaceId)] : cast;
  return json({
    cast: ordered,
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
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }) => {
  if (formMethod) return defaultShouldRevalidate;
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) return false;
  return defaultShouldRevalidate;
};

type Saved = { ok?: string; error?: string; name?: string };

export default function PresenterHub() {
  const d = useLoaderData<typeof loader>();
  const cast = d.cast as Member[];
  const t = useT();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const revalidator = useRevalidator();
  const who = sp.get("who");
  const openIdx = who ? cast.findIndex((c) => c.id === who) : -1;
  const open = openIdx >= 0 ? cast[openIdx] : null;
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
    const next = cast[(idx + cast.length) % cast.length];
    if (next) navigate(`/web/presenters?who=${encodeURIComponent(next.id)}`, { replace: true, preventScrollReset: true, state: location.state });
  };

  return (
    <div className="ph-wrap">
      <style dangerouslySetInnerHTML={{ __html: PH_STYLE }} />
      <div className="ph-cinehead">
        <span className="ph-cinehead-bg" aria-hidden="true">
          <span className="ph-cinehead-rose" />
          <span className="ph-cinehead-media"><img className="ph-cinehead-img" src="/landing/presenter-hero.jpg?v=3" alt="" loading="lazy" /></span>
        </span>
        <div className="ph-cinehead-copy">
          <span className="ph-cinehead-eyebrow"><Ico n="presenter" size={13} /> {t("Your AI cast")}</span>
          <b>{t("Your presenters")}</b>
          <span>{t("A full cast of pro presenters, ready to film your product — or upload a photo and become the face of your brand.")}</span>
        </div>
      </div>

      {/* Forge hero — the differentiator, made prominent. */}
      <Link to="/web/studio?do=video&forge=1" className="ph-forge">
        <span className="ph-forge-l">
          <span className="ph-forge-ico" aria-hidden="true"><Ico n="wand" size={22} /></span>
          <span className="ph-forge-txt">
            <b>{t("Create your own presenter")}</b>
            <span>{t("Be the face of your brand — you, a model, or your mascot. Four outfits, yours alone.")}</span>
          </span>
        </span>
        <span className="ph-forge-go"><Ico n="camera" size={14} /> {t("Upload a photo")}</span>
      </Link>
      {/* Film path — this cast stars in Movie Maker dialogue films, not just video ads. */}
      <Link to="/web/film" className="ph-filmcta">
        <span className="ph-forge-l">
          <span className="ph-filmcta-ico" aria-hidden="true"><Ico n="film" size={22} /></span>
          <span className="ph-forge-txt">
            <b>{t("Cast them in a movie")}</b>
            <span>{t("Write a scene and these faces act out real dialogue — pick them in Movie Maker's cast step.")}</span>
          </span>
        </span>
        <span className="ph-filmcta-go"><Ico n="filmreel" size={14} /> {t("Open Movie Maker")}</span>
      </Link>
      {d.forging > 0 && (
        <p className="ph-forging"><Ico n="bolt" size={13} /><span>{t("{n} presenter(s) still forging — they'll appear below when ready.", { n: d.forging })}</span></p>
      )}
      {d.failed.map((f) => (
        <p className="ph-forging bad" key={f.id}>
          <Ico n="warning" size={13} />
          <span>
            {t("{name} couldn't be made from that photo. A clear, front-facing photo works best.", { name: f.name })}{" "}
            <button type="button" className="ph-linkbtn" disabled={cleanup.state !== "idle"}
              onClick={() => { const fd = new FormData(); fd.set("intent", "delete"); fd.set("avatarId", f.id); cleanup.submit(fd, { method: "post" }); }}>
              {t("Dismiss")}
            </button>
          </span>
        </p>
      ))}

      <div className="ph-castlbl">
        {t("The cast")}
        <span>{t("tap one to meet them")}{d.brandFaceId ? <> · <Ico n="star" size={11} /> {t("is your Brand Face")}</> : null}</span>
      </div>
      <div className="ph-grid">
        {cast.map((c) => {
          const isBf = c.id === d.brandFaceId;
          return (
            <Link key={c.id} to={`/web/presenters?who=${encodeURIComponent(c.id)}`} state={{ hub: true }} preventScrollReset className={`ph-face${isBf ? " bf" : ""}`}>
              {isBf && <span className="ph-bfbadge"><Ico n="star" size={10} /> {t("Brand Face")}</span>}
              {c.custom && !isBf && <span className="ph-yoursbadge">{t("Yours")}</span>}
              <span className={`ph-face-img ph-bd${c.cut ? "" : " raw"}`}><img src={c.cut || c.img} alt={c.name} loading="lazy" draggable={false} /></span>
              <span className="ph-face-nm">{c.name}</span>
              <span className={`ph-face-voice${c.voiceOwn ? " own" : ""}`}><Ico n="mic" size={10} /> {c.voiceOwn ? c.voice : c.voice ? t(c.voice) : c.custom ? t("Automatic") : t("Signature")}</span>
            </Link>
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
          myVoices={d.myVoices as MyVoiceT[]}
          canMakeVoice={d.canMakeVoice}
          spinCost={d.spinCost}
          position={`${openIdx + 1} / ${cast.length}`}
          onClose={close}
          onPrev={() => go(openIdx - 1)}
          onNext={() => go(openIdx + 1)}
        />,
        document.body,
      ) : null}
    </div>
  );
}

const ENERGY: Record<Member["energy"], string> = { hype: "High energy", warm: "Warm", calm: "Calm" };

/* One presenter, up close. Left: the stage — the outfit you picked as a full-body figure to turn
 * around (its "3D view"), or as its portrait. Right: who they are, their voice, their outfits, and
 * what to do with them. */
function CharacterView({ c, isBrandFace, myVoices, canMakeVoice, spinCost, position, onClose, onPrev, onNext }: {
  c: Member; isBrandFace: boolean; myVoices: MyVoiceT[]; canMakeVoice: boolean;
  /** Tokens to add one outfit's 3D view to a presenter that doesn't have it (0 = free for this viewer). */
  spinCost: number;
  position: string;
  onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
  const t = useT();
  const fetcher = useFetcher<Saved>();
  const busy = fetcher.state !== "idle";
  const dialogRef = useModalA11y<HTMLDivElement>(true, onClose);
  // which outfit is on the stage, and whether it is shown as its portrait rather than its 3D view
  const [look, setLook] = useState(0);
  const [flat, setFlat] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pendingVoice, setPendingVoice] = useState(c.voiceId);
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
  // ← → page through the cast, unless the keys are busy turning the figure or typing a name
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.closest(".spin") || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      if (e.key === "ArrowLeft") onPrev(); else onNext();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onPrev, onNext]);
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
  const voiceName = c.voiceOwn ? c.voice : c.voice ? t(c.voice) : c.custom ? t("Automatic") : t("Signature voice");
  const voiceNote = c.voiceOwn ? t("Your own voice")
    : c.voice ? t(AVATAR_VOICES.find((v) => v.id === c.voiceId)?.blurb || "")
    : c.custom ? t("Picked automatically — choose one to make it theirs")
    : t("Designed for {name}", { name: c.name });
  // What the voice shown actually does — said per kind of voice, because it differs: a recorded voice
  // is also SUNG in (songs, cartoons); a stock voice is the speaking voice of video ads and comes along
  // when the presenter is cast in a movie; a signature voice can only speak in video ads.
  const voiceFine = c.voiceOwn ? t("{name} talks — and sings — in your own voice.", { name: c.name })
    : c.voice ? t("The voice {name} speaks with in your video ads, and brings along when you cast them in a movie.", { name: c.name })
    : c.custom ? ""
    : t("The voice {name} speaks with in your video ads.", { name: c.name });
  const gender = c.gender === "f" ? "f" : "m";
  const showLooks = c.looks.length > 1;
  const badge = isBrandFace ? t("Brand Face") : c.custom ? t("Your presenter") : t("Pro cast");

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

        <div className="pc-info">
          <span className={`pc-badge${isBrandFace ? " bf" : c.custom ? " own" : ""}`}>{isBrandFace ? <Ico n="star" size={11} /> : null}{badge}</span>
          {renaming ? (
            <form className="pc-rename" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) post({ intent: "rename", name: newName.trim() }); }}>
              <input className="wb-in" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} aria-label={t("Presenter name")} autoFocus />
              <button type="submit" className="wb-btn" disabled={busy || !newName.trim() || newName.trim() === c.name}>{busy ? t("Saving…") : t("Save")}</button>
              <button type="button" className="pc-textbtn" onClick={() => { setRenaming(false); setNewName(c.name); }}>{t("Cancel")}</button>
            </form>
          ) : (
            <h2 className="pc-name">{c.name}{c.custom && <button type="button" className="pc-pencil" onClick={() => setRenaming(true)} aria-label={t("Rename {name}", { name: c.name })}><Ico n="pencil" size={14} /></button>}</h2>
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

          {/* Voice */}
          <section className="pc-sec">
            <h3 className="pc-h"><Ico n="mic" size={13} /> {t("Voice")}</h3>
            <div className={`pc-voice${voiceOpen ? " open" : ""}`}>
              <div className="pc-voice-row">
                <button type="button" className={`pc-play${playing ? " on" : ""}`} onClick={hear} disabled={!c.voiceSample}
                  aria-label={playing ? t("Stop") : t("Hear {name}'s voice", { name: c.name })}>
                  {playing ? "⏸" : "▶"}
                </button>
                <span className="pc-voice-t">
                  <b className={c.voiceOwn ? "own" : ""}>{voiceName}</b>
                  <small>{voiceNote}</small>
                </span>
                <button type="button" className="pc-chg" aria-expanded={voiceOpen}
                  onClick={() => { audioRef.current?.pause(); setPlaying(false); setPendingVoice(c.voiceId || (c.custom ? DEFAULT_AVATAR_VOICE[gender] : "")); setVoiceOpen((v) => !v); }}>
                  {voiceOpen ? t("Close") : t("Change")}
                </button>
              </div>
              {voiceOpen && (
                <div className="pc-voice-pick">
                  <VoicePicker gender={gender} value={pendingVoice} onChange={setPendingVoice} myVoices={myVoices} canMake={canMakeVoice} showAll
                    signature={c.signature ? { name: c.name, sample: c.signature.sample || undefined } : undefined} />
                  <button type="button" className="wb-btn pc-save" disabled={busy || pendingVoice === c.voiceId}
                    onClick={() => post({ intent: "setVoice", voiceId: pendingVoice })}>
                    {busy ? t("Saving…") : t("Save voice")}
                  </button>
                </div>
              )}
              <audio ref={audioRef} preload="none" onEnded={() => setPlaying(false)} />
            </div>
            {voiceFine ? <p className="pc-fine">{voiceFine}</p> : null}
          </section>

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

          {/* What to do with them */}
          <section className="pc-sec pc-acts">
            <Link to={`/web/studio?do=video&avatar=${encodeURIComponent(c.id)}`} className="wb-btn pc-act-main"><Ico n="video" size={15} /> {t("Make a video with {name}", { name: c.name })}</Link>
            <div className="pc-act-row">
              <Link to="/web/film" className="pc-act"><Ico n="film" size={14} /> {t("Cast in a movie")}</Link>
              <button type="button" className={`pc-act${isBrandFace ? " on" : ""}`} disabled={busy} aria-pressed={isBrandFace}
                onClick={() => post({ intent: "setBrandFace", avatarId: isBrandFace ? "" : c.id })}>
                <Ico n="star" size={14} /> {isBrandFace ? t("Your Brand Face") : t("Make Brand Face")}
              </button>
            </div>
            {isBrandFace ? <p className="pc-fine">{t("Your Brand Face is picked for you first whenever you make a video. Tap again to clear it.")}</p> : null}
          </section>

          {c.custom && (
            <section className="pc-sec pc-danger">
              {armed ? (
                <p className="pc-warn">
                  {t("Delete {name}? This can't be undone.", { name: c.name })}
                  <button type="button" className="pc-del go" disabled={busy} onClick={() => post({ intent: "delete" })}>{busy ? t("Deleting…") : t("Delete")}</button>
                  <button type="button" className="pc-textbtn" onClick={() => setArmed(false)}>{t("Keep")}</button>
                </p>
              ) : (
                <button type="button" className="pc-del" onClick={() => setArmed(true)}><Ico n="trash" size={13} /> {t("Delete this presenter")}</button>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const PH_STYLE = `
${VOICE_UI_CSS}
${SPIN_STAGE_CSS}
.ph-wrap{max-width:780px;margin:0 auto;}
/* THE backdrop every presenter stands on — grid cards, outfit tiles and the stage. One soft studio
   wall, lit from the top: light enough for dark hair and dark clothes to read, deep enough that a
   white shirt still has an edge. */
.ph-bd{background:radial-gradient(125% 95% at 50% 22%,#EDF1E8 0%,#D9E1D4 55%,#C2CDBE 100%);}
/* Section hero — softened green band to match Film Studio / Studio. */
.ph-cinehead{position:relative;z-index:1;border-radius:18px;padding:20px 24px;margin-bottom:16px;min-height:130px;display:flex;align-items:center;}
.ph-cinehead-bg{position:absolute;inset:0;z-index:0;border-radius:18px;overflow:hidden;background:radial-gradient(135% 130% at 8% -25%,#38815C 0%,#265F45 46%,#1C4E33 100%);box-shadow:0 8px 22px rgba(11,20,15,.16),inset 0 0 0 1px rgba(255,255,255,.1);}
.ph-cinehead-rose{position:absolute;left:-130px;bottom:-170px;width:350px;height:350px;background:url(/gstyle-rosette.svg) center/contain no-repeat;opacity:.3;mix-blend-mode:screen;pointer-events:none;will-change:transform;animation:phspin 115s linear infinite;}
@keyframes phspin{to{transform:rotate(-360deg);}}
.ph-cinehead-media{position:absolute;right:0;top:0;bottom:0;width:54%;-webkit-mask-image:linear-gradient(90deg,transparent,#000 44%);mask-image:linear-gradient(90deg,transparent,#000 44%);}
.ph-cinehead-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}
.ph-cinehead-copy{position:relative;z-index:1;flex:1 1 auto;min-width:0;max-width:52%;}
.ph-cinehead-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:800;color:#E7C879;text-transform:uppercase;letter-spacing:.08em;}
.ph-cinehead-copy b{font-family:Poppins,sans-serif;font-weight:800;font-size:26px;letter-spacing:-.02em;color:#fff;display:block;margin-top:7px;line-height:1.1;}
.ph-cinehead-copy>span{display:block;font-size:13px;color:rgba(255,255,255,.74);margin-top:7px;max-width:320px;line-height:1.45;}
@media(max-width:640px){.ph-cinehead{padding:18px;min-height:114px;}.ph-cinehead-copy b{font-size:21px;}.ph-cinehead-copy{max-width:60%;}.ph-cinehead-media{width:52%;}}
@media(prefers-reduced-motion:reduce){.ph-cinehead-rose{animation:none;}}
.ph-forge{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:16px 0 8px;padding:18px 20px;border-radius:16px;background:linear-gradient(135deg,#0C7A46,#0A5F38);color:#FBF6E6;box-shadow:0 8px 22px rgba(10,95,56,.28);text-decoration:none;transition:transform .12s,box-shadow .12s;}
.ph-forge:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(10,95,56,.34);}
.ph-forge-l{display:flex;align-items:center;gap:14px;min-width:0;}
.ph-forge-ico{flex:0 0 auto;width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,.16);display:grid;place-items:center;color:#FBF6E6;}
.ph-forge-txt{min-width:0;}
.ph-forge-txt b{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;display:block;}
.ph-forge-txt span{font-size:12.5px;opacity:.9;display:block;margin-top:2px;line-height:1.35;}
.ph-forge-go{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;background:#FBF6E6;color:var(--green,#0C7A46);font-weight:800;font-size:13px;border-radius:999px;padding:10px 16px;white-space:nowrap;}
.ph-forging{display:flex;align-items:flex-start;gap:6px;font-size:12px;line-height:1.4;color:var(--ink2,#4A554E);margin:0 0 6px;}
.ph-forging svg{margin-top:2px;}
.ph-forging.bad{color:#8A3B12;}
.ph-linkbtn{border:0;background:transparent;padding:2px 4px;font:inherit;font-weight:800;color:var(--green,#0C7A46);text-decoration:underline;text-underline-offset:2px;cursor:pointer;}
.ph-castlbl{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-weight:800;font-size:14px;color:var(--ink,#14201A);margin:18px 0 12px;}
.ph-castlbl span{display:inline-flex;align-items:center;gap:4px;font-weight:600;font-size:12px;color:var(--ink2,#4A554E);}
.ph-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;}
.ph-face{position:relative;border-radius:14px;overflow:hidden;border:1.5px solid var(--line,#E4DFCF);background:#fff;cursor:pointer;text-decoration:none;display:block;transition:transform .12s,box-shadow .12s,border-color .12s;}
.ph-face:hover{transform:translateY(-2px);box-shadow:0 8px 18px rgba(20,32,26,.14);border-color:var(--green2,#1FA463);}
.ph-face-img{display:block;position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;}
.ph-face-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 18%;display:block;transition:transform .25s ease;}
.ph-face:hover .ph-face-img img{transform:scale(1.04);}
.ph-face-nm{display:block;padding:7px 8px 2px;font-size:12px;font-weight:700;color:var(--ink,#14201A);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ph-face-voice{display:flex;align-items:center;justify-content:center;gap:3px;margin:0 0 7px;font-size:10.5px;font-weight:700;color:var(--ink2,#4A554E);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px;}
.ph-face-voice.own{color:var(--green,#0C7A46);}
.ph-face.bf{border-color:var(--gold,#D3A63A);box-shadow:0 0 0 1.5px var(--gold,#D3A63A);}
.ph-bfbadge{position:absolute;top:7px;left:7px;z-index:2;display:inline-flex;align-items:center;gap:3px;background:var(--gold,#D3A63A);color:#3A2C06;font-size:10px;font-weight:800;border-radius:999px;padding:2px 8px;box-shadow:0 2px 5px rgba(0,0,0,.2);}
.ph-yoursbadge{position:absolute;top:7px;left:7px;z-index:2;background:var(--green,#0C7A46);color:#fff;font-size:10px;font-weight:800;border-radius:999px;padding:2px 8px;box-shadow:0 2px 5px rgba(0,0,0,.2);}
.ph-filmcta{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 8px;padding:16px 20px;border-radius:16px;background:var(--card,#FDFCF7);border:1.5px solid #9CCBB1;box-shadow:0 6px 18px rgba(20,32,26,.08);text-decoration:none;transition:transform .12s,box-shadow .12s,border-color .12s;}
.ph-filmcta:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(20,32,26,.12);border-color:var(--green,#0C7A46);}
.ph-filmcta-ico{flex:0 0 auto;width:44px;height:44px;border-radius:12px;background:#EAF6EF;display:grid;place-items:center;color:var(--green,#0C7A46);}
.ph-filmcta .ph-forge-txt b{color:var(--ink,#14201A);font-family:Poppins,sans-serif;font-weight:800;font-size:16px;display:block;}
.ph-filmcta .ph-forge-txt span{color:var(--ink2,#4A554E);opacity:1;display:block;margin-top:2px;line-height:1.35;font-size:12.5px;}
.ph-filmcta-go{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;background:var(--green,#0C7A46);color:#fff;font-weight:800;font-size:13px;border-radius:999px;padding:10px 16px;white-space:nowrap;}
@media(max-width:640px){.ph-grid{grid-template-columns:repeat(3,minmax(0,1fr));}.ph-forge,.ph-filmcta{flex-direction:column;align-items:flex-start;}.ph-forge-go,.ph-filmcta-go{align-self:stretch;justify-content:center;}}

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
.pc-info{min-width:0;min-height:0;overflow-y:auto;padding:26px 26px 22px;-webkit-overflow-scrolling:touch;}
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
.pc-voice{border:1.5px solid var(--line,#E1DECD);border-radius:14px;background:#fff;overflow:hidden;}
.pc-voice.open{border-color:var(--green2,#12A85E);}
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
.pc-voice-pick{padding:0 12px 12px;}
.pc-voice-pick .ws-vp{max-height:216px;}
.pc-voice-pick .ws-vpx{margin-bottom:10px;}
.pc-save{width:100%;}
.pc-fine{margin:8px 0 0;font-size:11.5px;line-height:1.4;color:var(--ink2,#4A554E);}
.pc-looks{display:flex;gap:9px;flex-wrap:wrap;}
.pc-look{flex:0 0 auto;width:74px;border:0;background:transparent;padding:0;cursor:pointer;text-align:center;}
.pc-look-img{position:relative;display:grid;place-items:center;width:100%;aspect-ratio:3/4;border-radius:11px;overflow:hidden;border:2px solid transparent;box-shadow:0 0 0 1px var(--line,#E1DECD);color:var(--green,#0C7A46);transition:box-shadow .12s,border-color .12s;}
.pc-look-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 18%;display:block;}
.pc-look.on .pc-look-img{border-color:var(--green,#0C7A46);box-shadow:0 0 0 1px var(--green,#0C7A46);}
.pc-look:hover .pc-look-img{box-shadow:0 0 0 1px var(--green2,#12A85E);}
.pc-look-nm{display:block;margin-top:5px;font-size:11.5px;font-weight:700;color:var(--ink,#14201A);}
.pc-acts{display:flex;flex-direction:column;gap:9px;}
.pc-act-main{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;text-align:center;}
.pc-act-row{display:grid;grid-template-columns:1fr 1fr;gap:9px;}
.pc-act{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:9px 12px;border-radius:12px;border:1.5px solid var(--line,#E1DECD);background:#fff;color:var(--ink,#14201A);font-size:13px;font-weight:800;text-decoration:none;cursor:pointer;transition:border-color .12s,background .12s;}
.pc-act:hover{border-color:var(--green2,#12A85E);background:#F6FBF8;}
.pc-act.on{border-color:var(--gold,#B08526);background:#FBF3D9;color:#5C4508;}
.pc-act:disabled{opacity:.6;cursor:default;}
.pc-danger{display:flex;}
.pc-del{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:6px 2px;font-size:12.5px;font-weight:700;color:#9A4A42;cursor:pointer;}
.pc-del:hover{color:#B3261E;}
.pc-del.go{padding:7px 14px;border-radius:999px;background:#B3261E;color:#fff;font-weight:800;}
.pc-warn{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;font-size:13px;font-weight:700;color:#B3261E;}
.pc-textbtn{border:0;background:transparent;padding:6px 4px;font-size:12.5px;font-weight:700;color:var(--ink2,#4A554E);text-decoration:underline;text-underline-offset:2px;cursor:pointer;}
@media(max-width:760px){
  .pc-scrim{padding:0;align-items:stretch;}
  .pc{display:block;width:100%;height:100dvh;border-radius:0;overflow-y:auto;-webkit-overflow-scrolling:touch;}
  .pc-stage{height:min(54dvh,440px);}
  .pc-info{overflow:visible;padding:18px 16px calc(28px + env(safe-area-inset-bottom,0px));}
  .pc-name{font-size:27px;margin-right:0;}
  .pc-x{position:fixed;top:calc(10px + env(safe-area-inset-top,0px));right:10px;}
}
@media(prefers-reduced-motion:reduce){.pc-scrim,.pc{animation:none;}.ph-face-img img{transition:none;}}
`;
