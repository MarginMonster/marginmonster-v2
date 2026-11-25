/* "Create your character" — the one dialog, wherever a cast is shown.
 *
 * It used to live inside the Studio (web.studio.tsx), so creating a character from the Presenters
 * section meant being sent to another page. Now it is a component that talks to its own resource route
 * (app/routes/api.character.tsx) and can be opened in place: Presenters, the Studio's presenter picker.
 *
 * Two steps, the way the owner asked for it (2026-11-17: "generate character with the description, see
 * the image still — with a final Register Character if you like the look"):
 *   1. SEE THEM   describe them and/or add a picture → one free preview. Try another, or edit the description.
 *   2. REGISTER   name, voice, vibe → "Register · N tokens". This is the only place tokens are charged,
 *                 and the character is made from the very picture on screen.
 *
 * A person gets the stock voices (and the maker's own recorded voice); a cartoon or a creature gets the
 * PERFORMED character voices first — "how are we going to get the proper [voices] for horror or cartoon
 * peeps" — each with the take the owner approved behind its ▶.
 *
 * The CSS travels with it as FORGE_CSS (cf- prefix); a route that renders the dialog includes that
 * string and VOICE_UI_CSS (the voice picker's) in its own <style> block. */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useFetcher, useRevalidator } from "@remix-run/react";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { useModalA11y } from "../lib/use-modal-a11y";
import { DEFAULT_AVATAR_VOICE } from "../lib/avatar-voice-catalog";
import { DEFAULT_CHARACTER_VOICE } from "../lib/character-voices";
import { CHAR_DESC_MAX, type CharKind } from "../lib/character-prompts";
import { VoicePicker, type MyVoiceT } from "./VoicePicker";

type Info = { hasPlan: boolean; canCreate: boolean; costs: { person: number; character: number }; left: number; perDay: number; myVoices: MyVoiceT[]; canMakeVoice: boolean; error?: string };
/** `from`: the look a preview was EDITED from ("Edit description") — "Try another" then edits that same look again. */
type PreviewReply = { preview?: { file: string; refFile: string; kind: CharKind; left: number; from?: string }; error?: string };
type RegisterReply = { registered?: { name: string; kind: CharKind }; error?: string };

const KINDS: Array<{ k: CharKind; label: string; icon: string; hint: string; eg: string }> = [
  { k: "person", label: "Person", icon: "presenter", hint: "A photo of you or a model — front-facing works best", eg: "e.g. warm smile, early 30s, short dark curls, smart-casual" },
  { k: "cartoon", label: "Cartoon", icon: "paw", hint: "A drawing, a sketch, your mascot — anything that shows them", eg: "e.g. a round orange fox cub with a white-tipped tail, a green scarf and a big grin" },
  { k: "monster", label: "Creature", icon: "moon", hint: "A drawing, a sketch, a still — anything that shows them", eg: "e.g. a hulking swamp creature with antlers, glowing eyes and arms that reach its knees" },
];

const voiceFor = (kind: CharKind, gender: "f" | "m") => (kind === "person" ? DEFAULT_AVATAR_VOICE[gender] : DEFAULT_CHARACTER_VOICE[kind][gender]);

/** KEEP IN MY CAST (2026-11-24): the dialog opened ON a character a story invented — the portrait the story
 *  drew, its name, and the words it was described with. Nothing is drawn: the portrait itself becomes the
 *  preview (api.character → adopt), so the maker lands on step two with the face they saw in every scene.
 *  `kind` and `gender` are a first guess (story-picture.ts → keepGuess); the kind can be changed here,
 *  before anything is charged — the price follows it. */
export type ForgeSeed = { img: string; name: string; look: string; kind: CharKind; gender: "f" | "m" };

export function CharacterForge({ open, onClose, seed }: { open: boolean; onClose: () => void; seed?: ForgeSeed | null }) {
  const t = useT();
  const revalidator = useRevalidator();
  const info = useFetcher<Info>();
  const drawer = useFetcher<PreviewReply>();
  const registrar = useFetcher<RegisterReply>();

  const [kind, setKind] = useState<CharKind>("person");
  const [file, setFile] = useState<File | null>(null);
  const [thumb, setThumb] = useState("");
  const [desc, setDesc] = useState("");
  const [preview, setPreview] = useState<{ file: string; refFile: string; from?: string } | null>(null);
  // EDITING A LOOK (the owner, 2026-11-24: "I tried to edit her hair to blonde and it changed her face"): after
  // "Edit description" the next preview is that look, changed only where the words change — not a new face
  const [editing, setEditing] = useState<{ file: string; refFile: string } | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"f" | "m">("m");
  const [voice, setVoice] = useState(DEFAULT_AVATAR_VOICE.m);
  const [energy, setEnergy] = useState("warm");
  // "registering" covers the spinner, the confirmation and a failed registration — until it is closed
  const [registering, setRegistering] = useState(false);


  // It is drawn on <body> (a portal), like the Presenters character view: inside .wb-main the scrim's
  // z-index only counts against the page, and the site header shows through the top of the dialog.
  // <body> exists only in the browser — and ?forge=1 opens the dialog on the very first render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const reset = useCallback(() => {
    setKind("person"); setFile(null); setDesc(""); setPreview(null); setEditing(null); setName(""); setGender("m");
    setVoice(DEFAULT_AVATAR_VOICE.m); setEnergy("warm"); setRegistering(false);
  }, []);
  const registered = registrar.state === "idle" ? registrar.data?.registered : undefined;
  // Closing after a character was registered starts the next one from a clean sheet — however it is
  // closed (Esc, the ✕, the backdrop). Left as it was, reopening showed the same picture with a live
  // "Register" button under it.
  const close = useCallback(() => { if (registered) reset(); else setRegistering(false); onClose(); }, [registered, reset, onClose]);
  const dialogRef = useModalA11y<HTMLDivElement>(open && mounted, close);

  // what the dialog needs to draw itself — fetched each time it opens, so prices and the day's count are current
  useEffect(() => { if (open) info.load("/api/character"); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (info.data && typeof info.data.left === "number") setLeft(info.data.left); }, [info.data]);
  useEffect(() => {
    if (!file) { setThumb(""); return; }
    const url = URL.createObjectURL(file);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (drawer.state !== "idle" || !drawer.data?.preview) return;
    const p = drawer.data.preview;
    setPreview({ file: p.file, refFile: p.refFile, ...(p.from ? { from: p.from } : {}) });
    setEditing(null);
    setLeft(p.left);
  }, [drawer.state, drawer.data]);
  // the new character should be in the cast behind the dialog the moment it exists
  useEffect(() => { if (registered) revalidator.revalidate(); }, [registered]); // eslint-disable-line react-hooks/exhaustive-deps

  // KEEP IN MY CAST — opened on a story's character: everything is filled in from the story, and its
  // portrait is made the preview straight away. Nothing is drawn and nothing is charged by this.
  const adopt = (s: ForgeSeed, k: CharKind) => {
    const fd = new FormData();
    fd.set("intent", "adopt");
    fd.set("img", s.img);
    fd.set("charKind", k);
    fd.set("avatarDesc", s.look.trim().slice(0, CHAR_DESC_MAX));
    drawer.submit(fd, { method: "post", action: "/api/character" });
  };
  const seedKey = open && seed ? seed.img : "";
  useEffect(() => {
    if (!seedKey || !seed) return;
    setKind(seed.kind); setFile(null); setDesc(seed.look.trim().slice(0, CHAR_DESC_MAX)); setPreview(null);
    setName(seed.name.trim().slice(0, 40)); setGender(seed.gender); setVoice(voiceFor(seed.kind, seed.gender)); setEnergy("warm"); setRegistering(false);
    adopt(seed, seed.kind);
  }, [seedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !mounted) return null;

  const d = info.data && !info.data.error ? info.data : null;
  const canCreate = d ? d.canCreate : true; // until we know, don't flash a warning
  const drawing = drawer.state !== "idle";
  const cost = d ? (kind === "person" ? d.costs.person : d.costs.character) : null;
  const spec = KINDS.find((x) => x.k === kind) || KINDS[0];

  const pickKind = (k: CharKind) => {
    if (k === kind) return;
    // (another kind is another drawing — not an edit of the look they saw)
    setKind(k); setPreview(null); setEditing(null); setVoice(voiceFor(k, gender));
  };
  const pickGender = (g: "f" | "m") => { setGender(g); setVoice(voiceFor(kind, g)); };
  // (a story's character: "a cartoon, not a person" — the same portrait, kept as another kind. The price
  //  on the button follows; tapping the kind already chosen tries again when bringing them over failed.)
  const reKind = (k: CharKind) => {
    if (!seed || (k === kind && preview)) return;
    setKind(k); setVoice(voiceFor(k, gender));
    adopt(seed, k);
  };
  // ask for a preview: with the picture just added, or (for "Try another") the one already uploaded — and, for
  // an edit, the look being edited (`base`), which the server changes only where the words change
  const askPreview = (keptRef?: string, base?: string) => {
    const fd = new FormData();
    fd.set("intent", "preview");
    fd.set("charKind", kind);
    fd.set("avatarDesc", desc.trim());
    if (keptRef) fd.set("refFile", keptRef);
    else if (file && !base) fd.set("avatarPhoto", file);
    if (base) fd.set("editOf", base);
    drawer.submit(fd, { method: "post", action: "/api/character", encType: "multipart/form-data" });
  };
  const register = () => {
    if (!preview) return;
    const fd = new FormData();
    fd.set("intent", "register");
    fd.set("previewFile", preview.file);
    fd.set("avatarName", name.trim());
    fd.set("avatarGender", gender);
    fd.set("avatarVoice", voice);
    fd.set("avatarEnergy", energy);
    registrar.submit(fd, { method: "post", action: "/api/character" });
    setRegistering(true);
  };

  const drawError = !drawing && drawer.data?.error ? <p className="cf-err" role="alert">{String(drawer.data.error)}</p> : null;
  const leftNote = left == null ? null
    : left > 0 ? t(left === 1 ? "{n} free look left today" : "{n} free looks left today", { n: left })
    : t("No free looks left today — register one you like, or come back tomorrow.");

  return createPortal(
    <div className="ws-scrim cf-scrim" onClick={close}>
      <div ref={dialogRef} className={`cf${(preview || seed) && !registering ? " wide" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={seed ? t("Keep {name} in your cast", { name: seed.name }) : t("Create your character")}>
        <button type="button" className="cf-x" onClick={close} aria-label={t("Close")}><Ico n="x" size={16} /></button>

        {registering ? (
          registrar.state !== "idle" ? (
            <div className="cf-done">
              <span className="cf-spin" aria-hidden="true" />
              <b>{t("Registering {name}…", { name: name.trim() || t("your character") })}</b>
              <p>{t("Hang tight — setting them up.")}</p>
            </div>
          ) : registered ? (
            <div className="cf-done">
              <span className="cf-check"><Ico n="check" size={30} /></span>
              {registered.kind === "person" ? (
                <>
                  <b>{t("{name} is on the way!", { name: registered.name })}</b>
                  <p>{t("We're making their four outfits now — usually a minute or two, a little longer when a film is rendering. They appear in your cast when they're ready, and a 3D figure of each outfit follows.")}</p>
                </>
              ) : (
                <>
                  <b>{t("{name} has joined your cast!", { name: registered.name })}</b>
                  <p>{t("They're in your cast now. Their 3D figure — the one you can turn around — is being built and appears in a few minutes.")}</p>
                </>
              )}
              {seed ? (
                // (kept from a story: the maker is in the middle of that story — stay there; the cast opens beside it)
                <div className="cf-done-acts">
                  <button type="button" className="wb-btn cf-go" onClick={close}>{t("Done")}</button>
                  <Link className="cf-again" to="/web/presenters?show=mine" target="_blank" rel="noopener">{t("See your cast")}</Link>
                </div>
              ) : (
                <div className="cf-done-acts">
                  <Link className="wb-btn cf-go" to="/web/presenters?show=mine" onClick={() => { reset(); onClose(); }}>{t("See your cast")}</Link>
                  <button type="button" className="cf-again" onClick={reset}>{t("Create another")}</button>
                </div>
              )}
            </div>
          ) : (
            <div className="cf-done">
              <span className="cf-bad"><Ico n="warning" size={26} /></span>
              <b>{t("That didn't go through")}</b>
              <p>{String(registrar.data?.error || t("Something went wrong — nothing was charged. Try again."))}</p>
              <button type="button" className="wb-btn cf-go" onClick={() => setRegistering(false)}>{t("Back")}</button>
            </div>
          )
        ) : (
          <>
            <div className="cf-h">
              <span className="cf-crest"><Ico n="wand" size={20} /></span>
              <div>
                <b>{seed ? t("Keep {name} in your cast", { name: seed.name }) : t("Create your character")}</b>
                <span>{seed
                  ? t("Straight from your story — the same face. Name them, pick a voice and register; then cast them in any film.")
                  : preview
                  ? t("Here they are. Like the look? Name them and register — or try another, free.")
                  : t("A person, a mascot, a cartoon, a creature — describe them or add a picture. You see them first; nothing is charged until you say yes.")}</span>
              </div>
            </div>

            {!preview && !seed ? (
              <>
                <div className="cf-kinds" role="group" aria-label={t("What are they?")}>
                  {KINDS.map((x) => (
                    <button type="button" key={x.k} className={kind === x.k ? "sel" : ""} aria-pressed={kind === x.k} disabled={drawing} onClick={() => pickKind(x.k)}>
                      <Ico n={x.icon} size={17} /> {t(x.label)}
                    </button>
                  ))}
                </div>
                {editing ? (
                  // (the look they saw stays on screen while they change the words — it is what gets changed)
                  <div className="cf-up has cf-editing">
                    <span className="cf-thumb" style={{ backgroundImage: `url(/uploads/${editing.file})` }} aria-hidden="true" />
                    <span className="cf-up-t">{t("Editing this look — only what you change in the words will change")}</span>
                    <button type="button" className="cf-fresh" disabled={drawing} onClick={() => setEditing(null)}>{t("Start fresh")}</button>
                  </div>
                ) : (
                  <label className={`cf-up${thumb ? " has" : ""}`}>
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} hidden />
                    {thumb
                      ? <><span className="cf-thumb" style={{ backgroundImage: `url(${thumb})` }} aria-hidden="true" /><span className="cf-up-t">{t("Picture added — tap to change")}</span></>
                      : <><Ico n="camera" size={26} /><span className="cf-up-t">{t("Add a picture")}<em> · {t("optional")}</em></span><span className="cf-up-s">{t(spec.hint)}</span></>}
                  </label>
                )}
                <label className="cf-lbl" htmlFor="cf-desc">{t("Describe them")}<span>{t("the more you say, the more it's them")}</span></label>
                <textarea id="cf-desc" className="wb-in cf-desc" rows={3} maxLength={CHAR_DESC_MAX} placeholder={t(spec.eg)} value={desc} onChange={(e) => setDesc(e.target.value)} />
                <span className={`cf-count${desc.length >= CHAR_DESC_MAX * 0.9 ? " near" : ""}`} aria-live="polite">{desc.length}/{CHAR_DESC_MAX}</span>
                {drawError}
                {d && !d.hasPlan && <p className="cf-gate">{t("Pick a plan first — creating a character runs on tokens.")} <Link to="/web#plans" onClick={close}>{t("See plans")}</Link></p>}
                {d && d.hasPlan && !d.canCreate && <p className="cf-gate">{t("Custom characters need a plan with video — Studio and up.")} <Link to="/web#plans" onClick={close}>{t("See plans")}</Link></p>}
                <button type="button" className="wb-btn cf-go" disabled={drawing || (editing ? desc.trim().length < 3 : !file && desc.trim().length < 8) || !canCreate || left === 0} onClick={() => (editing ? askPreview(editing.refFile, editing.file) : askPreview())}>
                  {drawing ? <><span className="cf-spin sm" aria-hidden="true" /> {t("Drawing them — about half a minute…")}</> : <><Ico n="eye" size={16} /> {t("Show me first — free")}</>}
                </button>
                <p className="cf-note">
                  {t("A preview costs nothing. If you like what you see, you register them — that's when tokens are used")}{cost != null ? ` (${cost} ${t("tokens")})` : ""}.
                  {leftNote ? <> <b>{leftNote}</b></> : null}
                </p>
              </>
            ) : (
              <div className="cf-two">
                <div className="cf-col">
                  {/* (a story's character: the portrait the story drew — shown at once, while it is brought over) */}
                  <div className="cf-prev"><img src={preview ? `/uploads/${preview.file}` : seed ? seed.img : ""} alt={t("Your character")} /></div>
                  {seed ? (
                    <>
                      <div className="cf-lbl">{t("What are they?")}<span>{t("a person gets outfits; a cartoon or a creature keeps this look")}</span></div>
                      <div className="cf-kinds" role="group" aria-label={t("What are they?")}>
                        {KINDS.map((x) => (
                          <button type="button" key={x.k} className={kind === x.k ? "sel" : ""} aria-pressed={kind === x.k} disabled={drawing} onClick={() => reKind(x.k)}>
                            <Ico n={x.icon} size={17} /> {t(x.label)}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : preview ? (
                    <>
                      <div className="cf-prevacts">
                        {/* (a look that was itself an edit is tried again AS that edit — the same face, another take) */}
                        <button type="button" disabled={drawing || left === 0} onClick={() => askPreview(preview.refFile, preview.from)}>{drawing ? <><span className="cf-spin sm" aria-hidden="true" /> {t("Drawing another…")}</> : <><Ico n="refresh" size={13} /> {t("Try another")}</>}</button>
                        <button type="button" disabled={drawing} onClick={() => { setEditing({ file: preview.file, refFile: preview.refFile }); setPreview(null); }}><Ico n="pencil" size={13} /> {t("Edit description")}</button>
                      </div>
                      {leftNote ? <p className="cf-left">{leftNote}</p> : null}
                    </>
                  ) : null}
                  {drawError}
                </div>
                <div className="cf-col">
                  <label className="cf-lbl" htmlFor="cf-name">{t("Name")}</label>
                  <input id="cf-name" className="wb-in cf-nm" placeholder={kind === "person" ? t("e.g. Alex, or your brand") : t("e.g. Grumble, Captain Biscuit")} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
                  <div className="cf-lbl">{t("Voice")}<span>{t("tap ▶ to hear it")}</span></div>
                  <div className="cf-seg">
                    {([["m", "He"], ["f", "She"]] as ["f" | "m", string][]).map(([g, label]) => (
                      <button type="button" key={g} className={gender === g ? "sel" : ""} aria-pressed={gender === g} onClick={() => pickGender(g)}>{t(label)}</button>
                    ))}
                  </div>
                  <VoicePicker gender={gender} value={voice} onChange={setVoice} myVoices={d?.myVoices || []} canMake={!!d?.canMakeVoice} characterKind={kind === "person" ? undefined : kind} />
                  <div className="cf-lbl">{t("Vibe")}<span>{t("how fast they talk")}</span></div>
                  <div className="cf-seg">
                    {([["warm", "Warm"], ["hype", "Energetic"], ["calm", "Chill"]] as [string, string][]).map(([e, label]) => (
                      <button type="button" key={e} className={energy === e ? "sel" : ""} aria-pressed={energy === e} onClick={() => setEnergy(e)}>{t(label)}</button>
                    ))}
                  </div>
                  <button type="button" className="wb-btn cf-go" disabled={drawing || registrar.state !== "idle" || !name.trim() || !canCreate || !preview} onClick={register}>
                    <Ico n="wand" size={16} /> {name.trim() ? t("Register {name}", { name: name.trim() }) : t("Register this character")}{cost != null ? ` · ${cost} ${t("tokens")}` : ""}
                  </button>
                  <p className="cf-note">{kind === "person"
                    ? t("They're made from this picture into four outfits, each with a 3D figure you can turn around.")
                    : t("This is the look they keep. Their 3D figure — the one you can turn around — follows a few minutes later.")}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export const FORGE_CSS = `
/* Drawn on <body>, outside the app shell that sets the type: it must bring its own font and ink (the first deploy showed the whole dialog in the browser's serif). */
.cf-scrim{display:grid;place-items:center;padding:14px;font-family:Inter,-apple-system,sans-serif;color:var(--ink,#14201A);}
.cf{position:relative;width:min(430px,100%);max-height:min(92vh,92dvh);overflow:auto;background:var(--card,#FDFCF7);border-radius:20px;padding:24px 22px 22px;box-shadow:0 30px 80px rgba(8,12,10,.45),inset 0 0 0 1px rgba(255,255,255,.6);animation:cfin .18s ease;}
.cf.wide{width:min(860px,100%);}
@keyframes cfin{from{opacity:0;transform:translateY(8px) scale(.985);}to{opacity:1;transform:none;}}
.cf-x{position:absolute;top:13px;inset-inline-end:13px;width:34px;height:34px;border-radius:50%;border:0;background:var(--paper,#F4F1E6);color:var(--ink2,#4A554E);cursor:pointer;display:grid;place-items:center;padding:0;transition:background .12s;}
.cf-x:hover{background:#E9E4D2;}
.cf-h{display:flex;gap:13px;align-items:flex-start;margin:2px 34px 18px 0;}
.cf-crest{flex:0 0 auto;width:42px;height:42px;border-radius:13px;display:grid;place-items:center;color:#fff;background:linear-gradient(140deg,#16A866 0%,#0C7A46 70%);box-shadow:0 6px 14px rgba(12,122,70,.28);}
.cf-h b{display:block;font-family:Poppins,sans-serif;font-weight:800;font-size:17px;letter-spacing:-.01em;color:var(--ink,#14201A);}
.cf-h>div>span{display:block;font-size:12.5px;line-height:1.5;color:var(--ink2,#4A554E);margin-top:3px;}
.cf-kinds{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 12px;}
.cf-kinds button{display:flex;align-items:center;justify-content:center;gap:7px;min-height:46px;padding:8px 6px;border-radius:13px;border:1.5px solid var(--line,#E4DFCF);background:#fff;color:var(--ink2,#4A554E);font:inherit;font-weight:800;font-size:13px;cursor:pointer;transition:border-color .12s,background .12s,color .12s,box-shadow .12s;}
.cf-kinds button:hover:not(:disabled){border-color:#9CCBB1;}
.cf-kinds button.sel{border-color:var(--green2,#12A85E);box-shadow:0 0 0 1px var(--green2,#12A85E);background:#F0FAF4;color:var(--ink,#14201A);}
.cf-kinds button.sel svg{color:var(--green,#0C7A46);}
.cf-kinds button:disabled{opacity:.6;cursor:default;}
.cf-up{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;padding:20px 14px;border-radius:14px;border:1.5px dashed var(--green,#0C7A46);background:#F3F9F4;color:var(--green,#0C7A46);text-align:center;cursor:pointer;margin-bottom:12px;transition:background .12s;}
.cf-up:hover{background:#EAF5EE;}
.cf-up.has{border-style:solid;border-color:var(--green2,#1FA463);background:#EFF8F1;flex-direction:row;gap:12px;padding:12px 14px;}
.cf-up-t{font-size:14px;font-weight:800;}
.cf-up-t em{font-style:normal;font-weight:600;opacity:.7;}
.cf-up-s{font-size:11.5px;font-weight:600;color:var(--ink2,#4A554E);}
.cf-thumb{flex:0 0 auto;width:52px;height:52px;border-radius:12px;background:#fff center/cover no-repeat;box-shadow:inset 0 0 0 1px rgba(12,18,14,.12);}
.cf-editing{cursor:default;}
.cf-editing:hover{background:#EFF8F1;}
.cf-editing .cf-up-t{flex:1 1 auto;min-width:0;text-align:start;font-size:13px;line-height:1.4;}
.cf-fresh{flex:0 0 auto;min-height:44px;padding:6px 4px;border:0;background:transparent;color:var(--green,#0C7A46);font:inherit;font-size:12.5px;font-weight:800;text-decoration:underline;text-underline-offset:3px;cursor:pointer;}
.cf-fresh:disabled{opacity:.6;cursor:default;}
.cf-lbl{display:flex;align-items:baseline;gap:8px;font-weight:800;font-size:12.5px;color:var(--ink,#14201A);margin:12px 0 7px;}
.cf-lbl:first-child{margin-top:0;}
.cf-lbl span{font-weight:500;font-size:11.5px;color:var(--ink2,#4A554E);}
.cf-desc{width:100%;resize:vertical;min-height:74px;font-family:inherit;}
.cf-nm{width:100%;}
.cf-count{display:block;text-align:right;margin:4px 2px 8px;font-size:11px;font-weight:600;color:var(--ink2,#8A968E);font-variant-numeric:tabular-nums;}
.cf-count.near{color:#8A5A12;}
.cf-gate{font-size:12.5px;line-height:1.45;color:#8a5a12;background:#FDF4E3;border:1px solid #E8D3A6;border-radius:10px;padding:9px 12px;margin:0 0 10px;}
.cf-gate a{font-weight:800;color:#8a5a12;}
.cf-err{font-size:12.5px;line-height:1.45;color:#8C2F2F;background:#FDF4F4;border:1px solid #D9A2A2;border-radius:10px;padding:9px 12px;margin:0 0 10px;}
.cf-go{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;}
.cf-note{font-size:11.5px;color:var(--ink2,#4A554E);text-align:center;margin:10px 2px 0;line-height:1.45;}
.cf-note b{font-weight:700;color:var(--ink,#14201A);white-space:nowrap;}
.cf-two{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;}
.cf-col{min-width:0;}
.cf-prev{display:grid;place-items:center;border-radius:16px;overflow:hidden;border:1px solid var(--line,#E1DECD);background:radial-gradient(125% 95% at 50% 22%,#EDF1E8 0%,#D9E1D4 55%,#C2CDBE 100%);}
.cf-prev img{display:block;width:100%;max-height:min(46vh,430px);object-fit:contain;}
.cf-prevacts{display:flex;gap:8px;margin:10px 0 0;}
.cf-prevacts button{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;border:1.5px solid var(--line,#E1DECD);background:#fff;border-radius:12px;font:inherit;font-size:12.5px;font-weight:800;color:var(--green,#0C7A46);cursor:pointer;transition:border-color .12s,background .12s;}
.cf-prevacts button:hover:not(:disabled){border-color:var(--green2,#12A85E);background:#F6FBF8;}
.cf-prevacts button:disabled{opacity:.6;cursor:default;}
.cf-left{margin:8px 2px 0;font-size:11.5px;color:var(--ink2,#4A554E);text-align:center;}
.cf-col .cf-err{margin:10px 0 0;}
.cf-seg{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
.cf-seg button{min-height:40px;padding:8px 15px;border-radius:11px;border:1px solid var(--line,#E4DFCF);background:var(--card,#FDFCF7);color:var(--ink2,#4A554E);font:inherit;font-weight:700;font-size:12.5px;cursor:pointer;}
.cf-seg button.sel{border-color:var(--green2,#12A85E);box-shadow:0 0 0 1px var(--green2,#12A85E);color:var(--ink,#14201A);background:#F0FAF4;}
.cf .ws-vp{max-height:210px;}
.cf-done{display:flex;flex-direction:column;align-items:center;text-align:center;gap:11px;padding:20px 8px 6px;}
.cf-done b{font-family:Poppins,sans-serif;font-weight:800;font-size:18px;letter-spacing:-.01em;color:var(--ink,#14201A);}
.cf-done p{font-size:13px;line-height:1.55;color:var(--ink2,#4A554E);margin:0 4px;max-width:340px;}
.cf-done-acts{display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;margin-top:6px;}
.cf-done .cf-go{margin-top:4px;text-decoration:none;}
.cf-again{border:0;background:transparent;color:var(--green,#0C7A46);font:inherit;font-size:13px;font-weight:800;cursor:pointer;padding:6px 10px;}
.cf-again:hover{text-decoration:underline;}
.cf-check{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;background:#E3F3EA;color:var(--green,#0C7A46);}
.cf-bad{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;background:#FDF4F4;color:#8C2F2F;}
.cf-spin{width:32px;height:32px;border-radius:50%;border:3px solid rgba(18,168,94,.22);border-top-color:var(--green2,#12A85E);animation:cfspin .8s linear infinite;}
.cf-spin.sm{width:15px;height:15px;border-width:2px;display:inline-block;vertical-align:-2px;}
.wb-btn .cf-spin.sm{border-color:rgba(255,255,255,.35);border-top-color:#fff;}
@keyframes cfspin{to{transform:rotate(360deg);}}
@media(min-width:780px){
  .cf.wide{padding:28px 28px 26px;}
  .cf-two{grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:26px;align-items:start;}
  .cf-prev img{max-height:min(62vh,560px);}
}
@media(max-width:520px){
  .cf{padding:20px 16px 18px;border-radius:18px;}
  .cf-kinds button{font-size:12.5px;gap:5px;}
}
@media(prefers-reduced-motion:reduce){.cf{animation:none;}.cf-spin{animation:none;}}
`;
