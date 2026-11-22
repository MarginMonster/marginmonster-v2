/* THE BRAND KIT — what EasyMode knows about the brand, on one page you can see and change: the logo, the
 * colours, the fonts, the voice (tone, tagline, about), and the products. "Read my store" fills it from
 * the store's own homepage in a few seconds (brand-kit.server.ts); every value stays editable. Image ads
 * use the colours as accents; every writer uses the voice. Google Pomelli does this free — so do we. */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import { db } from "../db.server";
import { requireWebIdentity } from "../lib/web-auth.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { useT } from "../lib/ui-lang";
import { Ico } from "../lib/icons";
import { normalizeHex } from "../lib/brand-kit";

export const meta: MetaFunction = () => [{ title: "Brand Kit · EasyMode" }];

type Kit = { name: string; tagline: string; logo: string | null; logoLocal?: string | null; colors: string[]; fonts: string[]; from?: string; at?: string };
type Voice = { tone: string; tagline: string; about: string };

const parse = (s: string | null | undefined): Record<string, unknown> => { try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { return {}; } };
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireWebIdentity(request);
  const [profile, products] = await Promise.all([
    db.brandProfile.findUnique({ where: { shopId: shop.id }, select: { voiceJson: true, visualJson: true } }),
    db.catalogProduct.findMany({ where: { shopId: shop.id, imageUrl: { not: null } }, orderBy: { position: "asc" }, take: 8, select: { id: true, title: true, imageUrl: true, priceText: true } }),
  ]);
  const v = parse(profile?.voiceJson);
  const k = parse(profile?.visualJson).kit as Kit | undefined;
  return json({
    kit: k && typeof k === "object" ? k : null,
    voice: { tone: str(v.tone), tagline: str(v.tagline), about: str(v.about) } as Voice,
    storeUrl: shop.storeUrl || "",
    products,
  });
};

type Res = { ok?: string; error?: string; kit?: Kit };

export const action = async ({ request }: ActionFunctionArgs) => {
  const lang = readUiLang(request);
  const { shop } = await requireWebIdentity(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const kitLib = await import("../lib/brand-kit.server");

  // READ MY STORE: the kit from the store's own homepage, for the merchant to check — NOT saved. A saved
  // kit changes their image ads (its colours become accents), so nothing applies until they press Save.
  if (intent === "read") {
    let url = String(form.get("url") || shop.storeUrl || "").trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    try { if (!url || !/^https?:$/.test(new URL(url).protocol)) throw new Error("bad"); } catch { return json<Res>({ error: tr(lang, "Paste your store's address, like yourstore.com.") }); }
    const kit = await kitLib.readStoreKit(shop.id, url);
    if (!kit) return json<Res>({ error: tr(lang, "We couldn't read that page. Check the address, or fill the kit in by hand below.") });
    return json<Res>({ ok: "read", kit });
  }

  // SAVE: the kit as shown here (read from the store and/or edited), and the voice (tone · tagline · about)
  // merged into the brand profile. saveKit cleans every field, whoever sent it.
  if (intent === "save") {
    const prior = await kitLib.kitFor(shop.id);
    const colors = String(form.get("colors") || "").split(",").map((c) => normalizeHex(c)).filter((c): c is string => !!c);
    const fonts = String(form.get("fonts") || "").split("|").map((f) => f.trim()).filter(Boolean);
    const field = (k: string) => String(form.get(k) || "").trim();
    const kit = {
      name: field("name") || prior?.name || "", tagline: field("storeTagline") || prior?.tagline || "",
      logo: field("logo") || prior?.logo || null, logoLocal: field("logoLocal") || prior?.logoLocal || null,
      colors, fonts, from: field("from") || prior?.from, edited: true,
    };
    if (!(await kitLib.saveKit(shop.id, kit))) return json<Res>({ error: tr(lang, "That didn't save — try again.") });
    // the voice: merged into whatever the profile already says (a Shopify import fills more than this page shows)
    const tone = String(form.get("tone") || "").trim().slice(0, 120);
    const tagline = String(form.get("tagline") || "").trim().slice(0, 120);
    const about = String(form.get("about") || "").trim().slice(0, 600);
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = await db.brandProfile.findUnique({ where: { shopId: shop.id }, select: { voiceJson: true } });
      if (!p) break;
      const next = JSON.stringify({ ...parse(p.voiceJson), tone, tagline, about });
      const saved = await db.brandProfile.updateMany({ where: { shopId: shop.id, voiceJson: p.voiceJson }, data: { voiceJson: next } });
      if (saved.count === 1) break;
    }
    return json<Res>({ ok: "save" });
  }

  // LOGO: an uploaded file (PNG, JPEG or WebP, stood upright), kept on our disk
  if (intent === "logo") {
    const file = form.get("logo");
    if (!file || typeof file === "string" || file.size === 0) return json<Res>({ error: tr(lang, "Pick a picture of your logo.") });
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return json<Res>({ error: tr(lang, "Use a PNG, JPG or WebP logo.") });
    if (file.size > 4 * 1024 * 1024) return json<Res>({ error: tr(lang, "Keep the logo under 4 MB.") });
    const [fs, path, crypto, { uprightPhoto }] = await Promise.all([import("node:fs"), import("node:path"), import("node:crypto"), import("../lib/upright-photo.server")]);
    const buf = await uprightPhoto(Buffer.from(await file.arrayBuffer()));
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const name = `brandlogo-${shop.id.slice(-8)}-${crypto.createHash("sha1").update(buf).digest("hex").slice(0, 10)}.${ext}`;
    const dir = path.join(process.cwd(), "data", "renders");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    try { const { mirrorRender } = await import("../lib/object-storage.server"); await mirrorRender(name, buf); } catch { /* the disk copy is served */ }
    const prior = await kitLib.kitFor(shop.id);
    const kit = { name: prior?.name || "", tagline: prior?.tagline || "", logo: prior?.logo || null, logoLocal: `/renders/${name}`, colors: prior?.colors || [], fonts: prior?.fonts || [], from: prior?.from, edited: true };
    if (!(await kitLib.saveKit(shop.id, kit))) return json<Res>({ error: tr(lang, "That didn't save — try again.") });
    return json<Res>({ ok: "logo", kit });
  }

  return json<Res>({ error: tr(lang, "Unknown request.") }, { status: 400 });
};

const GOOGLE = (f: string) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;700&display=swap`;

export default function BrandKitPage() {
  const d = useLoaderData<typeof loader>();
  const t = useT();
  const reader = useFetcher<Res>();
  const saver = useFetcher<Res>();
  const logoF = useFetcher<Res>();
  // the kit being edited: the saved one, replaced by a fresh read or a new logo when they land
  const [kit, setKit] = useState<Kit | null>(d.kit as Kit | null);
  useEffect(() => { if (reader.data?.kit) setKit(reader.data.kit); }, [reader.data]);
  useEffect(() => { if (logoF.data?.kit) setKit((k) => ({ ...(k || { name: "", tagline: "", logo: null, colors: [], fonts: [] }), logoLocal: logoF.data!.kit!.logoLocal })); }, [logoF.data]);
  const [colors, setColors] = useState<string[]>(kit?.colors || []);
  const [fonts, setFonts] = useState<string[]>(kit?.fonts?.length ? kit.fonts : [""]);
  useEffect(() => { if (reader.data?.kit) { setColors(reader.data.kit.colors); setFonts(reader.data.kit.fonts.length ? reader.data.kit.fonts : [""]); } }, [reader.data]);
  const [voice, setVoice] = useState<Voice>(d.voice as Voice);
  const [url, setUrl] = useState(d.storeUrl || kit?.from || "");
  const reading = reader.state !== "idle";
  const saving = saver.state !== "idle";
  const logo = kit?.logoLocal || kit?.logo || "";
  // preview the fonts in themselves (Google Fonts; one that isn't there just shows in the fallback)
  const fontLinks = useMemo(() => fonts.filter(Boolean).map((f) => GOOGLE(f)), [fonts]);
  // WHAT was saved, not just THAT a save happened. `saver.data` never clears, so after one save the bar went
  // on saying "Saved" through later colour, font and voice edits and through a fresh "Read my store again" —
  // and from then on the "check it over… then save" notice and the Save pulse never came back. So the kit as
  // it stood when Save was pressed is kept (at the press, not when the reply lands: the fields stay live
  // while it is on its way), and it counts as saved only while what is on the page still equals it.
  const shown = JSON.stringify({ kit, colors, fonts, voice });
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const saved = saver.data?.ok === "save" && saver.state === "idle" && savedAs === shown;
  const save = () => {
    setSavedAs(shown);
    saver.submit({
      intent: "save", name: kit?.name || "", storeTagline: kit?.tagline || "", logo: kit?.logo || "", logoLocal: kit?.logoLocal || "", from: kit?.from || "",
      colors: colors.join(","), fonts: fonts.filter(Boolean).join("|"), tone: voice.tone, tagline: voice.tagline, about: voice.about,
    }, { method: "post" });
  };
  // a fresh read is shown, not saved — say so until it is (and again once it is changed after saving)
  const unsaved = reader.data?.ok === "read" && !saved;
  const empty = !kit && !voice.tone && !voice.tagline && !voice.about;

  return (
    <div className="bk-wrap">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {fontLinks.map((h) => <link key={h} rel="stylesheet" href={h} />)}
      <header className="bk-head">
        <div>
          <span className="bk-eyebrow"><Ico n="sparkle" size={13} /> {t("Brand Kit")}</span>
          <h1 className="wb-h1">{kit?.name ? t("{name}'s Brand Kit", { name: kit.name }) : t("Your Brand Kit")}</h1>
          <p className="wb-sub">{t("What EasyMode knows about your brand. Every ad, post and film is made with it — change anything, any time.")}</p>
        </div>
      </header>

      <reader.Form method="post" className="bk-read">
        <input type="hidden" name="intent" value="read" />
        <label className="bk-read-in">
          <Ico n="link" size={15} />
          <input className="wb-in" name="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("yourstore.com")} aria-label={t("Your store's address")} inputMode="url" autoComplete="url" />
        </label>
        <button type="submit" className="wb-btn" disabled={reading}>{reading ? t("Reading your store…") : kit ? t("Read my store again") : t("Read my store")}</button>
      </reader.Form>
      {reader.data?.error && <p className="bk-err" role="alert">{reader.data.error}</p>}
      {unsaved && !reading && <p className="bk-ok" role="status"><Ico n="check" size={13} /> {t("Read from your store — check it over, change anything, then save.")}</p>}
      {empty && !reading && <p className="bk-hint">{t("Paste your store's address and we'll read your logo, colours and fonts off your homepage in a few seconds. No store? Fill it in by hand below.")}</p>}

      <div className="bk-grid">
        <section className="bk-card bk-logo" aria-labelledby="bk-logo-h">
          <h2 id="bk-logo-h">{t("Logo")}</h2>
          <div className="bk-logo-stage">{logo ? <img src={logo} alt={t("Your logo")} /> : <span>{t("No logo yet")}</span>}</div>
          <logoF.Form method="post" encType="multipart/form-data" className="bk-logo-up">
            <input type="hidden" name="intent" value="logo" />
            <label className="bk-file">
              <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" onChange={(e) => { if (e.currentTarget.files?.length && e.currentTarget.form) logoF.submit(e.currentTarget.form, { method: "post", encType: "multipart/form-data" }); }} />
              <span>{logoF.state !== "idle" ? t("Uploading…") : logo ? t("Upload a different logo") : t("Upload your logo")}</span>
            </label>
          </logoF.Form>
          {logoF.data?.error && <p className="bk-err" role="alert">{logoF.data.error}</p>}
        </section>

        <section className="bk-card" aria-labelledby="bk-col-h">
          <h2 id="bk-col-h">{t("Colours")}</h2>
          <p className="bk-note">{t("Image ads use these as accents — your products keep their own colours.")}</p>
          <div className="bk-swatches">
            {colors.map((c, i) => (
              <div key={i} className="bk-sw">
                <label className="bk-sw-chip" style={{ background: c }}>
                  <input type="color" value={c} onChange={(e) => setColors((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))} aria-label={t("Colour {n}", { n: i + 1 })} />
                </label>
                <code>{c.toUpperCase()}</code>
                <button type="button" className="bk-x" onClick={() => setColors((cs) => cs.filter((_, j) => j !== i))} aria-label={t("Remove {c}", { c: c.toUpperCase() })}>×</button>
              </div>
            ))}
            {colors.length < 6 && (
              <label className="bk-sw bk-sw-add">
                <span className="bk-sw-chip add" aria-hidden="true">+</span>
                <input type="color" defaultValue="#0c7a46" onChange={(e) => setColors((cs) => (cs.length < 6 ? [...cs, e.target.value] : cs))} aria-label={t("Add a colour")} />
                <code>{t("Add")}</code>
              </label>
            )}
          </div>
        </section>

        <section className="bk-card" aria-labelledby="bk-font-h">
          <h2 id="bk-font-h">{t("Fonts")}</h2>
          <div className="bk-fonts">
            {fonts.map((f, i) => (
              <div key={i} className="bk-font">
                <input className="wb-in" value={f} onChange={(e) => setFonts((fs) => fs.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i === 0 ? t("Heading font, e.g. Poppins") : t("Body font, e.g. Inter")} aria-label={t("Font {n}", { n: i + 1 })} />
                {f ? <span className="bk-font-demo" style={{ fontFamily: `"${f}", Inter, sans-serif` }}>{kit?.name || "Aa Bb Cc 123"}</span> : null}
              </div>
            ))}
            {fonts.length < 3 && <button type="button" className="bk-add" onClick={() => setFonts((fs) => [...fs, ""])}>+ {t("Add a font")}</button>}
          </div>
        </section>

        <section className="bk-card bk-voice" aria-labelledby="bk-voice-h">
          <h2 id="bk-voice-h">{t("Voice")}</h2>
          <label className="bk-field"><span>{t("Tone")}</span><input className="wb-in" value={voice.tone} maxLength={120} onChange={(e) => setVoice({ ...voice, tone: e.target.value })} placeholder={t("warm, playful, a little cheeky")} /></label>
          <label className="bk-field"><span>{t("Tagline")}</span><input className="wb-in" value={voice.tagline} maxLength={120} onChange={(e) => setVoice({ ...voice, tagline: e.target.value })} placeholder={kit?.tagline ? kit.tagline.slice(0, 80) : t("Your brand in one line")} /></label>
          <label className="bk-field"><span>{t("About the brand")}</span><textarea className="wb-in" rows={3} value={voice.about} maxLength={600} onChange={(e) => setVoice({ ...voice, about: e.target.value })} placeholder={kit?.tagline || t("What you sell, who it's for, what makes it yours")} /></label>
        </section>

        {d.products.length > 0 && (
          <section className="bk-card bk-prods" aria-labelledby="bk-prod-h">
            <h2 id="bk-prod-h">{t("Your products")}</h2>
            <div className="bk-prod-row">
              {d.products.map((p) => (
                <figure key={p.id} className="bk-prod">
                  <img src={p.imageUrl || ""} alt="" loading="lazy" />
                  <figcaption>{p.title}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="bk-savebar">
        {saver.data?.error && <span className="bk-err" role="alert">{saver.data.error}</span>}
        {saved && <span className="bk-ok" role="status"><Ico n="check" size={13} /> {t("Saved — new content uses it.")}</span>}
        <Link to="/web" className="bk-back">{t("Back to the dashboard")}</Link>
        <button type="button" className={`wb-btn${unsaved ? " bk-pulse" : ""}`} disabled={saving} onClick={save}>{saving ? t("Saving…") : t("Save Brand Kit")}</button>
      </div>
    </div>
  );
}

const CSS = `
.bk-wrap{max-width:1080px;margin:0 auto;padding-bottom:90px;}
.bk-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.bk-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--green,#0C7A46);}
.bk-read{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 10px;}
.bk-read-in{flex:1 1 320px;display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--line,#E1DECD);border-radius:14px;padding:0 0 0 14px;color:var(--ink2,#4A554E);}
.bk-read-in:focus-within{border-color:var(--green,#0C7A46);box-shadow:0 0 0 3px rgba(12,122,70,.12);}
.bk-read-in .wb-in{border:0;box-shadow:none;background:transparent;flex:1;min-width:0;min-height:46px;}
.bk-read .wb-btn{min-height:48px;padding:0 22px;}
.bk-hint{margin:0 0 16px;font-size:13.5px;line-height:1.5;color:var(--ink2,#4A554E);max-width:70ch;}
.bk-err{margin:4px 0 12px;font-size:13px;color:#B4532A;}
.bk-ok{display:inline-flex;align-items:center;gap:6px;margin:4px 0 12px;font-size:13px;font-weight:600;color:var(--green,#0C7A46);}
.bk-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));margin-top:8px;}
.bk-card{background:linear-gradient(178deg,#FEFDF9,#F7F6EB);border:1px solid var(--line2,#E1DECD);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:12px;min-width:0;}
.bk-card h2{margin:0;font-family:Poppins,sans-serif;font-weight:800;font-size:16px;color:var(--ink,#14201A);}
.bk-note{margin:-4px 0 0;font-size:12.5px;line-height:1.45;color:var(--ink2,#4A554E);}
.bk-logo-stage{display:grid;place-items:center;min-height:150px;border-radius:14px;background-color:#fff;background-image:linear-gradient(45deg,#F1EFE4 25%,transparent 25%),linear-gradient(-45deg,#F1EFE4 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#F1EFE4 75%),linear-gradient(-45deg,transparent 75%,#F1EFE4 75%);background-size:18px 18px;background-position:0 0,0 9px,9px -9px,-9px 0;border:1px solid var(--line,#E1DECD);padding:14px;}
.bk-logo-stage img{max-width:100%;max-height:120px;object-fit:contain;display:block;}
.bk-logo-stage span{font-size:13px;color:var(--ink2,#4A554E);}
.bk-file{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border-radius:999px;border:1px solid #BFE2CD;background:#EAF6EF;color:var(--green,#0C7A46);font:700 13px/1 Poppins,sans-serif;cursor:pointer;overflow:hidden;}
.bk-file input{position:absolute;inset:0;opacity:0;cursor:pointer;}
.bk-file:focus-within{outline:2px solid var(--green,#0C7A46);outline-offset:2px;}
.bk-swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px;}
.bk-sw{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;}
.bk-sw-chip{position:relative;display:block;width:100%;aspect-ratio:1;border-radius:14px;box-shadow:inset 0 0 0 1px rgba(20,32,26,.10),0 6px 14px -8px rgba(20,32,26,.35);cursor:pointer;overflow:hidden;}
.bk-sw-chip input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;border:0;padding:0;}
.bk-sw-chip.add{display:grid;place-items:center;background:#fff;border:1.5px dashed #9CCBB1;box-shadow:none;color:var(--green,#0C7A46);font:800 22px/1 Poppins,sans-serif;}
.bk-sw-add{cursor:pointer;}
.bk-sw-add input{position:absolute;inset:0;opacity:0;cursor:pointer;}
.bk-sw code{font:600 11.5px/1 ui-monospace,Menlo,monospace;color:var(--ink2,#4A554E);font-variant-numeric:tabular-nums;}
.bk-x{position:absolute;top:-6px;right:-6px;width:26px;height:26px;border-radius:50%;border:1px solid var(--line,#E1DECD);background:#fff;color:var(--ink2,#4A554E);font:700 15px/1 Inter,sans-serif;cursor:pointer;display:grid;place-items:center;padding:0;}
.bk-x::before{content:"";position:absolute;inset:-9px;border-radius:50%;}
.bk-x:hover{color:#B4532A;border-color:#E9B9A2;}
.bk-fonts{display:flex;flex-direction:column;gap:12px;}
.bk-font{display:flex;flex-direction:column;gap:6px;}
.bk-font-demo{font-size:22px;line-height:1.2;color:var(--ink,#14201A);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.bk-add{align-self:flex-start;min-height:38px;padding:0 14px;border-radius:999px;border:1px dashed #9CCBB1;background:#fff;color:var(--green,#0C7A46);font:700 12.5px/1 Poppins,sans-serif;cursor:pointer;}
.bk-field{display:flex;flex-direction:column;gap:5px;}
.bk-field span{font-size:11.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--ink2,#4A554E);}
.bk-field textarea{resize:vertical;min-height:84px;font:inherit;line-height:1.45;}
.bk-prods{grid-column:1/-1;}
.bk-prod-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;}
.bk-prod{margin:0;display:flex;flex-direction:column;gap:6px;min-width:0;}
.bk-prod img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;background:#fff;border:1px solid var(--line,#E1DECD);}
.bk-prod figcaption{font-size:12px;line-height:1.3;color:var(--ink2,#4A554E);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bk-savebar{position:sticky;bottom:max(12px,env(safe-area-inset-bottom,0px));z-index:5;display:flex;align-items:center;justify-content:flex-end;gap:14px;flex-wrap:wrap;margin-top:18px;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid var(--line,#E1DECD);box-shadow:0 12px 28px -18px rgba(20,32,26,.45);}
.bk-savebar .bk-err,.bk-savebar .bk-ok{margin:0;margin-right:auto;}
.bk-savebar .wb-btn{min-height:46px;padding:0 24px;}
.bk-back{font-size:13px;font-weight:700;color:var(--ink2,#4A554E);}
.bk-pulse{box-shadow:0 0 0 0 rgba(12,122,70,.45);animation:bkPulse 1.6s ease-out infinite;}
@keyframes bkPulse{to{box-shadow:0 0 0 12px rgba(12,122,70,0);}}
@media(prefers-reduced-motion:reduce){.bk-pulse{animation:none;}}
@media(max-width:640px){.bk-read .wb-btn{flex:1 1 100%;}.bk-savebar{justify-content:space-between;}.bk-back{display:none;}}
/* On a phone the bar stuck 12px from the bottom of the screen — exactly under the shell's fixed bottom dock
   (z-index 50, over this page's z-index 1) — so "Save Brand Kit" was covered until the page was scrolled to
   its very end. 98px is the dock clearance the shell itself keeps (.wb-main's bottom padding at this width,
   web.tsx); the right padding keeps the button out from under Helpurr, who floats in that corner (16px in,
   56px wide, on a page that is itself 16px in). */
@media(max-width:760px){.bk-savebar{bottom:calc(98px + env(safe-area-inset-bottom,0px));padding-right:78px;}}
`;
