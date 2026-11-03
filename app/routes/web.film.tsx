/* Film Studio — EasyMode's premium long-form tier. Music Video + Kids Cartoon +
 * Skit (members of the shared Film engine). Flow: pick a template → (Skit: pick
 * your product) → write the treatment FREE (no tokens) → read/edit/Randomize →
 * see the live per-scene cost → Generate. Metered by scene count (plan-config.
 * estimateFilmTokens — the SAME function quotes and charges). Gated at
 * "creatorvideo" (all plans). */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { requireWebIdentity } from "../lib/web-auth.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { normalizeContentLang } from "../lib/content-lang";
import { db } from "../db.server";
import { planTrialing, refundTokens, spendTokens, tokensRemainingLive } from "../lib/tokens.server";
import { capabilitiesFor } from "../lib/capabilities.server";
import { enqueueJob } from "../lib/job-queue.server";
import { estimateFilmTokens, FILM_PER_SCENE, FILM_BASE } from "../lib/plan-config";

export const meta: MetaFunction = () => [{ title: "Film Studio · EASYMODE" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const { LIVE_FILM_TEMPLATES } = await import("../lib/film-engine.server");
  const templates = LIVE_FILM_TEMPLATES.map((t) => ({
    key: t.key, name: t.name, brief: t.brief, defaultScenes: t.defaultScenes, minScenes: t.minScenes, maxScenes: t.maxScenes, needsProduct: !!t.needsProduct,
  }));
  // The merchant's own catalogue — only products WITH a photo can seed a skit.
  const products = (await db.catalogProduct.findMany({
    where: { shopId: shop.id, imageUrl: { not: null } },
    orderBy: { position: "asc" },
    take: 80,
    select: { title: true, imageUrl: true, description: true },
  })).map((p) => ({ title: p.title, imageUrl: p.imageUrl as string, description: (p.description || "").slice(0, 300) }));
  return json({
    tokens: tokensRemainingLive(shop.activePlan),
    hasPlan: !!shop.activePlan?.active,
    trialing: planTrialing(shop.activePlan),
    canFilm: capabilitiesFor(shop.activePlan).has("creatorvideo"),
    outputLang: normalizeContentLang(shop.contentLang),
    templates,
    products,
    perScene: FILM_PER_SCENE,
    base: FILM_BASE,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = await readUiLang(request);
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = ((form.get("intent") as string) || "").trim();
  const { filmTemplate, previewFilmTreatment } = await import("../lib/film-engine.server");

  if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan on the Dashboard first — film runs on tokens.") });
  if (!capabilitiesFor(shop.activePlan).has("creatorvideo")) {
    return json({ error: tr(lang, "Your plan doesn't include video yet — upgrade to make films.") });
  }

  const tmpl = filmTemplate((form.get("template") as string) || undefined);
  const topic = ((form.get("filmTopic") as string) || "").trim().slice(0, 300);
  const clampScenes = (n: number) => Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, Math.round(n || tmpl.defaultScenes)));

  // Product (skit): title + photo required for product templates.
  const productTitle = ((form.get("filmProductTitle") as string) || "").trim().slice(0, 120);
  const productImageUrl = ((form.get("filmProductImageUrl") as string) || "").trim().slice(0, 2000);
  const productDescription = ((form.get("filmProductDescription") as string) || "").trim().slice(0, 500);
  if (tmpl.needsProduct && !productImageUrl) {
    return json({ error: tr(lang, "Add your product first — pick one from your store or paste a product image URL.") });
  }

  // FREE — write/re-write the treatment as plain text (no token spend).
  if (intent === "previewFilmTreatment") {
    const scenes = clampScenes(parseInt((form.get("filmScenes") as string) || "", 10) || tmpl.defaultScenes);
    try {
      const treatment = await previewFilmTreatment({ shopId: shop.id, template: tmpl.key, topic, sceneCount: scenes, contentLang: shop.contentLang, productTitle, productDescription });
      return json({ treatment });
    } catch (e) {
      return json({ error: tr(lang, "Couldn't write that treatment — give it another go, or tweak the premise a little (for Horror, a spookier / less-graphic angle writes more reliably)."), detail: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }

  // PAID — enqueue the render. Charge by the ACTUAL scene count (the approved
  // treatment's length if one was approved, else the slider), so the quote the
  // merchant saw == the debit. The queue's refundPrepaidOnce returns chargedTokens
  // on terminal failure; this catch covers a charge that never gets a job row.
  if (intent === "film") {
    const approvedRaw = ((form.get("approvedTreatment") as string) || "").trim();
    let approvedTreatment: string | undefined;
    let scenes = clampScenes(parseInt((form.get("filmScenes") as string) || "", 10) || tmpl.defaultScenes);
    if (approvedRaw) {
      try {
        const t = JSON.parse(approvedRaw) as { scenes?: unknown[] };
        const n = Array.isArray(t.scenes) ? t.scenes.length : 0;
        if (n > 0) { approvedTreatment = approvedRaw; scenes = clampScenes(n); }
      } catch { /* malformed — fall back to the slider count + engine-written treatment */ }
    }
    const cost = estimateFilmTokens(scenes);

    let unbacked = 0, unbackedFromExtra = 0;
    try {
      const { fromExtra } = await spendTokens(shop.id, cost);
      unbacked = cost; unbackedFromExtra = fromExtra;
      await enqueueJob(shop.id, "GENERATE_VIDEO_AD", {
        section: "creator", contentType: "film",
        filmTemplate: tmpl.key, filmTopic: topic, filmScenes: scenes,
        approvedTreatment,
        ...(tmpl.needsProduct ? { filmProductTitle: productTitle, filmProductImageUrl: productImageUrl, filmProductDescription: productDescription } : {}),
        productTitle: (productTitle || topic || tmpl.name).slice(0, 60),
        prePaid: true, chargedTokens: cost, chargedFromExtra: fromExtra, initiator: "web",
      });
      unbacked = 0;
      return json({ ok: true, queued: "film", cost, scenes });
    } catch (e) {
      if (unbacked > 0) {
        try { await refundTokens(shop.id, unbacked, unbackedFromExtra); } catch { /* owed-refund path logs inside */ }
      }
      const name = e instanceof Error ? e.name : "";
      if (name === "InsufficientTokensError") return json({ error: e instanceof Error ? e.message : tr(lang, "Not enough tokens.") });
      console.error("[film] enqueue failed:", e instanceof Error ? e.message : e);
      return json({ error: tr(lang, "Couldn't start the render — try again in a moment.") });
    }
  }

  return json({ error: tr(lang, "Unknown action.") });
};

type Scene = { visual: string; caption?: string };
type Treatment = { title?: string; scenes: Scene[]; musicMood: string };

export default function FilmStudio() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  const nav = useNavigation();
  const actionData = useActionData<typeof action>() as { ok?: boolean; queued?: string; cost?: number; error?: string } | undefined;
  const treatmentFetcher = useFetcher<{ treatment?: Treatment; error?: string }>();

  const [template, setTemplate] = useState(d.templates[0]?.key || "musicvideo");
  const tmpl = d.templates.find((x) => x.key === template) || d.templates[0];
  const [topic, setTopic] = useState("");
  const [scenes, setScenes] = useState(tmpl?.defaultScenes || 6);
  const [treatment, setTreatment] = useState<Treatment | null>(null);
  // Product (skit): title + photo + (catalog) description.
  const [prodTitle, setProdTitle] = useState("");
  const [prodImage, setProdImage] = useState("");
  const [prodDesc, setProdDesc] = useState("");

  // When a fresh treatment arrives, adopt it (and lock the scene count to it).
  useEffect(() => {
    const tr2 = treatmentFetcher.data?.treatment;
    if (tr2 && tr2.scenes?.length) { setTreatment(tr2); setScenes(tr2.scenes.length); }
  }, [treatmentFetcher.data]);

  const writing = treatmentFetcher.state !== "idle";
  const generating = nav.state !== "idle" && nav.formData?.get("intent") === "film";
  const cost = estimateFilmTokens(scenes);
  const affordable = d.tokens >= cost;
  const productReady = !tmpl?.needsProduct || !!prodImage.trim();
  const canGo = d.hasPlan && d.canFilm && affordable && productReady && !generating;

  const bump = (delta: number) => {
    const n = Math.max(tmpl.minScenes, Math.min(tmpl.maxScenes, scenes + delta));
    setScenes(n);
    if (treatment && treatment.scenes.length !== n) setTreatment(null);
  };
  const switchTemplate = (key: string) => {
    const nt = d.templates.find((x) => x.key === key);
    setTemplate(key); setScenes(nt?.defaultScenes || 6); setTreatment(null);
  };
  const pickCatalog = (idx: number) => {
    const p = d.products[idx];
    if (!p) return;
    setProdTitle(p.title || ""); setProdImage(p.imageUrl || ""); setProdDesc(p.description || "");
    setTreatment(null);
  };
  const writeTreatment = () => {
    treatmentFetcher.submit(
      { intent: "previewFilmTreatment", template, filmTopic: topic, filmScenes: String(scenes), filmProductTitle: prodTitle, filmProductImageUrl: prodImage, filmProductDescription: prodDesc },
      { method: "post" }
    );
  };
  const editCaption = (i: number, v: string) => {
    if (!treatment) return;
    setTreatment({ ...treatment, scenes: treatment.scenes.map((s, j) => (j === i ? { ...s, caption: v } : s)) });
  };

  return (
    <div className="fs-wrap">
      <style>{FS_STYLE}</style>

      <div className="fs-head">
        <b>{t("Film Studio")} <span className="fs-beta">{t("new")}</span></b>
        <span>{t("Premium long-form video — made from a prompt. Pick a format, we write the treatment free, then you spend only when you hit Generate.")}</span>
      </div>

      {/* Template row */}
      <div className="fs-tmpls">
        {d.templates.map((x) => (
          <button type="button" key={x.key} className={`fs-tmpl${template === x.key ? " on" : ""}`}
            aria-pressed={template === x.key} onClick={() => switchTemplate(x.key)}>
            <span className="fs-tmpl-ico" aria-hidden="true"><Ico n="film" size={20} /></span>
            <b>{t(x.name)}</b>
            <span className="fs-tmpl-sub">{t(x.brief)}</span>
          </button>
        ))}
        <div className="fs-tmpl soon" aria-hidden="true">
          <span className="fs-tmpl-ico"><Ico n="wand" size={20} /></span>
          <b>{t("TV Shows · Episodes")}</b>
          <span className="fs-tmpl-sub">{t("Coming next — talking characters + a recurring cast across episodes")}</span>
        </div>
      </div>

      {/* Skit only — your product (kept pin-sharp in every scene) */}
      {tmpl?.needsProduct && (
        <div className="fs-card">
          <div className="fs-lbl"><Ico n="camera" size={16} /> {t("Your product")} <span className="fs-free">{t("stays pin-sharp")}</span></div>
          <p className="fs-hint">{t("The real product is the hero of the gag — it's composited into every scene and kept exactly as photographed.")}</p>
          {d.products.length > 0 && (
            <select className="fs-sel" defaultValue="" onChange={(e) => { if (e.target.value !== "") pickCatalog(Number(e.target.value)); }}>
              <option value="">{t("Pick from your store…")}</option>
              {d.products.map((p, i) => <option key={i} value={i}>{p.title}</option>)}
            </select>
          )}
          <div className="fs-prow">
            {prodImage ? <span className="fs-pthumb" style={{ backgroundImage: `url(${prodImage})` }} role="img" aria-label={prodTitle || "product"} /> : <span className="fs-pthumb empty"><Ico n="camera" size={18} /></span>}
            <div className="fs-pfields">
              <input className="fs-in" value={prodTitle} onChange={(e) => setProdTitle(e.target.value)} placeholder={t("Product name")} maxLength={120} />
              <input className="fs-in" value={prodImage} onChange={(e) => { setProdImage(e.target.value); setProdDesc(""); setTreatment(null); }} placeholder={t("or paste a product image URL")} maxLength={2000} />
            </div>
          </div>
        </div>
      )}

      {/* Step 1 — the vibe + length */}
      <div className="fs-card">
        <div className="fs-lbl"><span className="fs-n">1</span> {tmpl?.needsProduct ? t("What's the gag?") : t("What's it about?")}</div>
        <textarea className="fs-ta" rows={3} value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder={tmpl?.needsProduct ? t("the joke, the vibe, who's in it… or leave blank and we'll write one") : t("a theme, a story, a mood… or leave blank and we'll surprise you")} maxLength={300} />
        <div className="fs-len">
          <span>{t("Scenes")}</span>
          <div className="fs-stepper">
            <button type="button" onClick={() => bump(-1)} disabled={scenes <= tmpl.minScenes} aria-label={t("Fewer scenes")}>−</button>
            <b>{scenes}</b>
            <button type="button" onClick={() => bump(1)} disabled={scenes >= tmpl.maxScenes} aria-label={t("More scenes")}>+</button>
          </div>
          <span className="fs-len-note">{t("≈ {sec}s · {n} AI clips", { sec: scenes * 5, n: scenes })}</span>
        </div>
      </div>

      {/* Step 2 — write the treatment FREE */}
      <div className="fs-card">
        <div className="fs-lbl"><span className="fs-n">2</span> {t("Write the treatment")} <span className="fs-free">{t("free")}</span></div>
        <p className="fs-hint">{t("We draft every scene + the hook. Read it, tweak the lines, re-roll — no tokens spent until you Generate.")}</p>
        <button type="button" className="fs-write" onClick={writeTreatment} disabled={writing || !productReady}>
          {writing ? <>… {t("Writing")}</> : treatment ? <><Ico n="refresh" size={14} /> {t("Randomize")}</> : <><Ico n="wand" size={14} /> {t("Write the treatment — free")}</>}
        </button>
        {tmpl?.needsProduct && !productReady && <p className="fs-hint">{t("Add your product above first.")}</p>}
        {treatmentFetcher.data?.error && <p className="fs-err">{treatmentFetcher.data.error}</p>}

        {treatment && (
          <div className="fs-treat">
            {treatment.title && <div className="fs-treat-ttl">{treatment.title}</div>}
            <div className="fs-treat-mood"><Ico n="music" size={12} /> {treatment.musicMood}</div>
            <ol className="fs-scenes">
              {treatment.scenes.map((s, i) => (
                <li key={i} className="fs-scene">
                  <span className="fs-scene-vis">{s.visual}</span>
                  <input className="fs-scene-cap" value={s.caption || ""} onChange={(e) => editCaption(i, e.target.value)}
                    placeholder={t("on-screen line (optional)")} maxLength={80} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Step 3 — generate (the only paid step) */}
      <div className="fs-card fs-go-card">
        <div className="fs-lbl"><span className="fs-n">3</span> {t("Generate")}</div>
        <Form method="post">
          <input type="hidden" name="intent" value="film" />
          <input type="hidden" name="template" value={template} />
          <input type="hidden" name="filmTopic" value={topic} />
          <input type="hidden" name="filmScenes" value={String(scenes)} />
          {tmpl?.needsProduct && <input type="hidden" name="filmProductTitle" value={prodTitle} />}
          {tmpl?.needsProduct && <input type="hidden" name="filmProductImageUrl" value={prodImage} />}
          {tmpl?.needsProduct && <input type="hidden" name="filmProductDescription" value={prodDesc} />}
          {treatment && <input type="hidden" name="approvedTreatment" value={JSON.stringify(treatment)} />}
          <button type="submit" className="fs-go" disabled={!canGo}>
            {generating ? <>… {t("Starting your film")}</> : <><Ico n="film" size={16} /> {cost > 0 ? t("Generate {name} · {cost} Tokens", { name: t(tmpl?.name || "Film"), cost }) : t("Generate {name} · Free", { name: t(tmpl?.name || "Film") })}</>}
          </button>
        </Form>
        <p className="fs-cost">
          {cost > 0
            ? <>{t("{base} + {per}/scene × {n} = {cost} Tokens", { base: d.base, per: d.perScene, n: scenes, cost })}{" · "}<span className={affordable ? "fs-bal" : "fs-bal low"}>{t("you have {n}", { n: d.tokens })}</span></>
            : t("Free while we get this section dialed in — pricing comes later")}
        </p>
        {!treatment && <p className="fs-hint">{t("Tip: write the treatment above first so you see exactly what renders — but you can Generate straight away and we'll script it for you.")}</p>}
        {!d.hasPlan && <p className="fs-err">{t("Pick a plan on the Dashboard first — film runs on tokens.")}</p>}
        {d.hasPlan && !affordable && <p className="fs-err">{t("Not enough tokens for this length — shorten it, or top up on the Plans page.")}</p>}
        {d.hasPlan && tmpl?.needsProduct && !productReady && <p className="fs-err">{t("Add your product above to generate a skit.")}</p>}
        {actionData?.error && <p className="fs-err">{actionData.error}</p>}
        {actionData?.ok && (
          <p className="fs-ok"><Ico n="check" size={14} /> {t("Rolling! Your film is rendering — it'll land in your Gallery in a few minutes. You can keep working.")}</p>
        )}
      </div>
    </div>
  );
}

const FS_STYLE = `
.fs-wrap{max-width:760px;margin:0 auto;}
.fs-head b{font-family:Poppins,sans-serif;font-weight:800;font-size:22px;color:var(--ink,#14201A);display:flex;align-items:center;gap:8px;}
.fs-beta{font-size:11px;font-weight:800;color:#fff;background:var(--green,#0C7A46);border-radius:999px;padding:2px 9px;text-transform:uppercase;letter-spacing:.04em;}
.fs-head>span{display:block;font-size:13px;color:var(--ink2,#4A554E);margin-top:5px;max-width:560px;line-height:1.5;}
.fs-tmpls{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0 6px;}
.fs-tmpl{flex:1 1 200px;min-width:0;text-align:left;border:1.5px solid var(--line,#E4DFCF);background:#fff;border-radius:16px;padding:14px 16px;cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s;display:block;}
.fs-tmpl:hover{transform:translateY(-2px);box-shadow:0 8px 18px rgba(20,32,26,.12);border-color:var(--green2,#1FA463);}
.fs-tmpl.on{border-color:var(--green,#0C7A46);box-shadow:0 0 0 1.5px var(--green,#0C7A46);}
.fs-tmpl.soon{opacity:.55;cursor:default;}
.fs-tmpl.soon:hover{transform:none;box-shadow:none;border-color:var(--line,#E4DFCF);}
.fs-tmpl-ico{display:inline-grid;place-items:center;width:38px;height:38px;border-radius:11px;background:var(--mint,#EAF6EF);color:var(--green,#0C7A46);margin-bottom:8px;}
.fs-tmpl b{font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink,#14201A);display:block;}
.fs-tmpl-sub{display:block;font-size:12px;color:var(--ink2,#4A554E);margin-top:3px;line-height:1.4;}
.fs-card{background:#fff;border:1.5px solid var(--line,#E4DFCF);border-radius:16px;padding:16px 18px;margin:12px 0;}
.fs-go-card{border-color:var(--green,#0C7A46);}
.fs-lbl{display:flex;align-items:center;gap:8px;font-family:Poppins,sans-serif;font-weight:800;font-size:15px;color:var(--ink,#14201A);margin-bottom:10px;}
.fs-n{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:999px;background:var(--green,#0C7A46);color:#fff;font-size:13px;}
.fs-free{font-size:11px;font-weight:800;color:var(--green,#0C7A46);background:var(--mint,#EAF6EF);border-radius:999px;padding:2px 9px;text-transform:uppercase;letter-spacing:.03em;}
.fs-ta{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:12px;padding:11px 13px;font-size:14px;font-family:inherit;color:var(--ink,#14201A);resize:vertical;line-height:1.45;}
.fs-ta:focus,.fs-in:focus,.fs-sel:focus{outline:none;border-color:var(--green,#0C7A46);}
.fs-sel{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;padding:10px 12px;font-size:13.5px;font-family:inherit;color:var(--ink,#14201A);background:#fff;margin-bottom:10px;}
.fs-prow{display:flex;gap:12px;align-items:stretch;}
.fs-pthumb{flex:0 0 auto;width:66px;height:66px;border-radius:12px;background-size:cover;background-position:center;background-color:var(--mint,#EAF6EF);border:1.5px solid var(--line,#E4DFCF);}
.fs-pthumb.empty{display:grid;place-items:center;color:var(--green,#0C7A46);}
.fs-pfields{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px;}
.fs-in{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#E4DFCF);border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;color:var(--ink,#14201A);}
.fs-len{display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap;}
.fs-len>span:first-child{font-weight:700;font-size:13px;color:var(--ink,#14201A);}
.fs-stepper{display:inline-flex;align-items:center;gap:0;border:1.5px solid var(--line,#E4DFCF);border-radius:999px;overflow:hidden;}
.fs-stepper button{width:34px;height:34px;border:0;background:var(--mint,#EAF6EF);color:var(--green,#0C7A46);font-size:19px;font-weight:800;cursor:pointer;line-height:1;}
.fs-stepper button:disabled{opacity:.4;cursor:default;}
.fs-stepper b{min-width:34px;text-align:center;font-size:15px;color:var(--ink,#14201A);}
.fs-len-note{font-size:12px;color:var(--ink2,#4A554E);}
.fs-hint{font-size:12.5px;color:var(--ink2,#4A554E);margin:0 0 10px;line-height:1.45;}
.fs-write{display:inline-flex;align-items:center;gap:7px;background:var(--mint,#EAF6EF);color:var(--green,#0C7A46);border:1.5px solid var(--green,#0C7A46);border-radius:999px;padding:11px 20px;font-weight:800;font-size:14px;cursor:pointer;}
.fs-write:disabled{opacity:.6;cursor:default;}
.fs-treat{margin-top:14px;border-top:1px dashed var(--line,#E4DFCF);padding-top:12px;}
.fs-treat-ttl{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;color:var(--ink,#14201A);}
.fs-treat-mood{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--ink2,#4A554E);margin:3px 0 10px;}
.fs-scenes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px;counter-reset:sc;}
.fs-scene{counter-increment:sc;position:relative;padding:10px 12px 10px 38px;background:var(--cream,#FBF6E6);border-radius:11px;}
.fs-scene::before{content:counter(sc);position:absolute;left:10px;top:10px;width:20px;height:20px;border-radius:999px;background:var(--green,#0C7A46);color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;}
.fs-scene-vis{display:block;font-size:13px;color:var(--ink,#14201A);line-height:1.45;}
.fs-scene-cap{display:block;width:100%;box-sizing:border-box;margin-top:7px;border:1.5px solid var(--line,#E4DFCF);border-radius:8px;padding:6px 9px;font-size:12.5px;font-weight:700;color:var(--green,#0C7A46);background:#fff;font-family:inherit;}
.fs-scene-cap:focus{outline:none;border-color:var(--green,#0C7A46);}
.fs-go{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--green,#0C7A46);color:#fff;border:0;border-radius:12px;padding:15px;font-family:Poppins,sans-serif;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 8px 20px rgba(10,95,56,.26);}
.fs-go:disabled{opacity:.5;cursor:default;box-shadow:none;}
.fs-cost{font-size:12.5px;color:var(--ink2,#4A554E);margin:10px 0 0;text-align:center;}
.fs-bal{font-weight:700;color:var(--green,#0C7A46);}
.fs-bal.low{color:#B3421E;}
.fs-err{font-size:12.5px;color:#B3421E;margin:8px 0 0;font-weight:600;}
.fs-ok{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--green,#0C7A46);font-weight:700;margin:10px 0 0;}
@media(max-width:640px){.fs-tmpl{flex:1 1 100%;}}
`;
