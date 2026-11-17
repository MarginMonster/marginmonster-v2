/* The presenter voice picker and the "Use my own voice" recorder.
 *
 * One component, used wherever a presenter's voice is chosen: the Studio's create-a-presenter and
 * Manage panels, its narrator pills, and the Presenters section's character view. It lived inside
 * web.studio.tsx until the Presenters section needed it too; the markup, class names and behaviour
 * are unchanged, so every place looks and works the same.
 *
 * The CSS travels with it as VOICE_UI_CSS — a route that renders the picker includes that string in
 * its own <style> block (the class names keep their original ws- prefix). */

import { Fragment, useEffect, useRef, useState } from "react";
import { useRevalidator } from "@remix-run/react";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { AVATAR_VOICES, DEFAULT_AVATAR_VOICE } from "../lib/avatar-voice-catalog";

/* Pick a voice for a custom presenter — chips under the gender toggle, each with
 * a ▶ that plays the real pre-rendered sample (free, instant) so a merchant
 * HEARS the voice before spending. One <audio>, one playing at a time. Shared by
 * the forge modal and the Manage panel. The catalog is deliberately small and
 * all-neutral-English, so nothing here surprises them with an accent. */
export type MyVoiceT = { id: string; voiceId: string; label: string; gender: "f" | "m"; preview: string };

export function VoicePicker({ gender, value, onChange, myVoices, canMake, signature, showAll }: {
  gender: "f" | "m"; value: string; onChange: (id: string) => void;
  /** The shop's OWN cloned voices ("My voices") — listed above the stock ones. */
  myVoices?: MyVoiceT[];
  /** May this account record a new voice right now? Hides the option entirely when false. */
  canMake?: boolean;
  /** A STOCK presenter’s own designed voice — offered first, and selected while `value` is "". */
  signature?: { name: string; sample?: string };
  /** Also list the other gender’s stock voices (after this gender’s), so a voice that was saved from
   *  the other list still shows as the selected one. */
  showAll?: boolean;
}) {
  const t = useT();
  const revalidator = useRevalidator();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [mine, setMine] = useState<MyVoiceT[]>(myVoices || []);
  const mineKey = (myVoices || []).map((v) => v.id).join(",");
  useEffect(() => { setMine(myVoices || []); }, [mineKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [makerOpen, setMakerOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const voices = AVATAR_VOICES.filter((v) => v.gender === gender);
  const others = showAll ? AVATAR_VOICES.filter((v) => v.gender !== gender) : [];
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const done = () => setPlaying(null);
    a.addEventListener("ended", done);
    return () => a.removeEventListener("ended", done);
  }, []);
  const play = (id: string, src?: string) => {
    const a = audioRef.current;
    if (!a) return;
    if (playing === id) { a.pause(); setPlaying(null); return; }
    a.src = src || `/voice-samples/${id}.mp3`;
    a.currentTime = 0;
    a.play().then(() => setPlaying(id)).catch(() => setPlaying(null));
  };
  const removeMine = async (v: MyVoiceT) => {
    setArmed(null);
    const fd = new FormData();
    fd.set("intent", "delete"); fd.set("id", v.id);
    try { await fetch("/api/avatar-voice", { method: "POST", body: fd }); } catch { /* the reload below shows the truth */ }
    setMine((m) => m.filter((x) => x.id !== v.id));
    if (value === v.voiceId) onChange(signature ? "" : DEFAULT_AVATAR_VOICE[gender]);
    revalidator.revalidate();
  };
  return (
    <div className="ws-vpx">
      <div className="ws-vp">
        {signature && (
          <div className={`ws-vp-chip sig${value === "" ? " sel" : ""}`}>
            <button type="button" className="ws-vp-pick" onClick={() => onChange("")} aria-pressed={value === ""}>
              <b><Ico n="star" size={12} /> {t("Signature voice")}</b>
              <em className="ws-vp-blurb">{t("Designed for {name}", { name: signature.name })}</em>
              {value === "" ? <i className="ws-vp-tick" aria-hidden="true">✓</i> : null}
            </button>
            {signature.sample ? (
              <button type="button" className={`ws-vp-play${playing === "__sig" ? " on" : ""}`} onClick={() => play("__sig", signature.sample)}
                aria-label={playing === "__sig" ? t("Stop preview") : t("Preview the {label} voice", { label: t("Signature voice") })}>
                {playing === "__sig" ? "⏸" : "▶"}
              </button>
            ) : null}
          </div>
        )}
        {mine.length > 0 && <div className="ws-vp-sec">{t("My voices")}</div>}
        {mine.map((v) => {
          const sel = value === v.voiceId;
          const on = playing === v.voiceId;
          return (
            <div key={v.id} className={`ws-vp-chip mine${sel ? " sel" : ""}`}>
              <button type="button" className="ws-vp-pick" onClick={() => onChange(v.voiceId)} aria-pressed={sel}>
                <b><Ico n="mic" size={12} /> {v.label}</b>
                <em className="ws-vp-blurb">{t("Your own voice")}</em>
                {sel ? <i className="ws-vp-tick" aria-hidden="true">✓</i> : null}
              </button>
              {armed === v.id ? (
                <button type="button" className="ws-vp-rm armed" onClick={() => removeMine(v)}>{t("Remove")}</button>
              ) : (
                <button type="button" className="ws-vp-rm" onClick={() => setArmed(v.id)} aria-label={t("Remove the {label} voice", { label: v.label })}><Ico n="trash" size={12} /></button>
              )}
              {v.preview ? (
                <button type="button" className={`ws-vp-play${on ? " on" : ""}`} onClick={() => play(v.voiceId, v.preview)}
                  aria-label={on ? t("Stop preview") : t("Preview the {label} voice", { label: v.label })}>
                  {on ? "⏸" : "▶"}
                </button>
              ) : null}
            </div>
          );
        })}
        {(mine.length > 0 || signature) && <div className="ws-vp-sec">{t("Stock voices")}</div>}
        {[...voices, ...others].map((v, i) => {
          const sel = value === v.id;
          const on = playing === v.id;
          return (
            <Fragment key={v.id}>
              {others.length > 0 && i === voices.length && <div className="ws-vp-sec">{t("More voices")}</div>}
              <div className={`ws-vp-chip${sel ? " sel" : ""}`}>
                <button type="button" className="ws-vp-pick" onClick={() => onChange(v.id)} aria-pressed={sel}>
                  <b>{t(v.label)}</b>
                  <em className="ws-vp-blurb">{t(v.blurb)}</em>
                  {sel ? <i className="ws-vp-tick" aria-hidden="true">✓</i> : null}
                </button>
                <button type="button" className={`ws-vp-play${on ? " on" : ""}`} onClick={() => play(v.id)}
                  aria-label={on ? t("Stop preview") : t("Preview the {label} voice", { label: t(v.label) })}>
                  {on ? "⏸" : "▶"}
                </button>
              </div>
            </Fragment>
          );
        })}
        <audio ref={audioRef} preload="none" />
      </div>
      {canMake && !makerOpen && (
        <button type="button" className="ws-vp-own" onClick={() => { audioRef.current?.pause(); setPlaying(null); setMakerOpen(true); }}>
          <span className="ws-vp-own-ico" aria-hidden="true"><Ico n="mic" size={15} /></span>
          <span className="ws-vp-own-t"><b>{t("Use my own voice")}</b><small>{t("Record 30 seconds — your presenter talks and sings like you")}</small></span>
        </button>
      )}
      {canMake && makerOpen && (
        <VoiceMaker gender={gender} onCancel={() => setMakerOpen(false)}
          onMade={(v) => { setMine((m) => [v, ...m.filter((x) => x.id !== v.id)]); onChange(v.voiceId); setMakerOpen(false); revalidator.revalidate(); }} />
      )}
    </div>
  );
}

/* "Use my own voice" — record ~30 seconds here (or upload a recording), confirm it's yours, and it
 * becomes a voice in the list above. One small panel that lives INSIDE the existing voice picker, so it
 * shows up everywhere the picker does (create-a-presenter + Manage). The audio goes to /api/avatar-voice,
 * which cleans it up and clones it in the background; we poll until it's ready (about a minute). */
const VOICE_READ_SCRIPT = "Hi, it's me! I'm recording this so my presenter can sound just like I do. I love what I do, and I can't wait to show you what we've been working on. So — are you ready? Let's make something great together.";
const VOICE_MIN_SECS = 15;
const VOICE_MAX_SECS = 60;

export function VoiceMaker({ gender, onMade, onCancel }: { gender: "f" | "m"; onMade: (v: MyVoiceT) => void; onCancel: () => void }) {
  const t = useT();
  const [phase, setPhase] = useState<"idle" | "recording" | "have" | "making">("idle");
  const [secs, setSecs] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string; name: string; recorded: boolean } | null>(null);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aliveRef = useRef(true);
  const stopTracks = () => { streamRef.current?.getTracks().forEach((tr) => tr.stop()); streamRef.current = null; };
  const stopTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  // leaving the panel mid-recording must release the microphone
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; stopTick(); try { recRef.current?.stop(); } catch { /* not recording */ } stopTracks(); }; }, []);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);

  const startRec = async () => {
    setErr("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stopTick(); stopTracks();
        if (!aliveRef.current) return;
        const type = rec.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks, { type });
        setClip({ blob, url: URL.createObjectURL(blob), name: `my-voice.${/mp4/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "webm"}`, recorded: true });
        setPhase("have");
      };
      recRef.current = rec;
      rec.start();
      setSecs(0); setPhase("recording");
      tickRef.current = setInterval(() => setSecs((s) => { if (s + 1 >= VOICE_MAX_SECS) { try { rec.stop(); } catch { /* already stopped */ } } return s + 1; }), 1000);
    } catch {
      stopTracks();
      setErr(t("We couldn't use your microphone. Allow it in your browser and try again — or upload a recording instead."));
    }
  };
  const stopRec = () => { try { recRef.current?.stop(); } catch { /* already stopped */ } };
  const pickFile = (f: File | null) => {
    if (!f) return;
    setErr("");
    if (f.size > 20 * 1024 * 1024) { setErr(t("That recording is too big — keep it under 20 MB (about a minute is plenty).")); return; }
    setClip({ blob: f, url: URL.createObjectURL(f), name: f.name || "my-voice.mp3", recorded: false });
    setSecs(0); setPhase("have");
  };
  const redo = () => { setClip(null); setSecs(0); setErr(""); setPhase("idle"); };

  const make = async () => {
    if (!clip || !consent) return;
    setErr(""); setPhase("making");
    const fail = (m?: string) => { if (aliveRef.current) { setErr(m || t("That didn't work — mind trying again?")); setPhase("have"); } };
    try {
      const fd = new FormData();
      fd.set("intent", "clone"); fd.set("gender", gender); fd.set("consent", "1");
      fd.set("audio", clip.blob, clip.name);
      const res = await fetch("/api/avatar-voice", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !j.id) return fail(j.error);
      // cloned in the background — usually well under a minute; give it up to four
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!aliveRef.current) return;
        const s = (await fetch(`/api/avatar-voice?id=${encodeURIComponent(j.id)}`).then((r) => r.json()).catch(() => null)) as { status?: string; voice?: MyVoiceT | null; error?: string } | null;
        if (s?.status === "ready" && s.voice) { if (aliveRef.current) onMade(s.voice); return; }
        if (s?.status === "failed") return fail(t("We couldn't learn that voice — try a clearer recording with just you talking, no music or background noise."));
      }
      fail(t("That's taking longer than it should — check back in a minute; your voice will show up in the list if it finished."));
    } catch { fail(); }
  };

  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const tooShort = !!clip && clip.recorded && secs < VOICE_MIN_SECS;
  return (
    <div className="ws-vm">
      <div className="ws-vm-h">
        <b><Ico n="mic" size={14} /> {t("Your own voice")}</b>
        {phase !== "making" && <button type="button" className="ws-vm-x" onClick={onCancel} aria-label={t("Close")}><Ico n="x" size={13} /></button>}
      </div>
      {phase === "making" ? (
        <div className="ws-vm-making">
          <span className="ws-vm-spin" aria-hidden="true" />
          <b>{t("Learning your voice…")}</b>
          <span>{t("Usually under a minute. Keep this open — it'll appear in the list when it's ready.")}</span>
        </div>
      ) : (
        <>
          <p className="ws-vm-how">{t("Read this out loud like you're talking to a friend — about 30 seconds, somewhere quiet:")}</p>
          <p className="ws-vm-script">“{t(VOICE_READ_SCRIPT)}”</p>
          {phase === "idle" && (
            <div className="ws-vm-row">
              <button type="button" className="ws-vm-rec" onClick={startRec}><span className="ws-vm-dot" aria-hidden="true" /> {t("Record")}</button>
              <label className="ws-vm-up">
                <input type="file" accept="audio/*" hidden onChange={(e) => pickFile(e.target.files?.[0] || null)} />
                <Ico n="upload" size={13} /> {t("or upload a recording")}
              </label>
            </div>
          )}
          {phase === "recording" && (
            <div className="ws-vm-row">
              <span className="ws-vm-live"><span className="ws-vm-dot pulse" aria-hidden="true" /> {mmss}</span>
              <button type="button" className="ws-vm-stop" onClick={stopRec} disabled={secs < 3}>{secs < VOICE_MIN_SECS ? t("Keep going — {n}s more", { n: VOICE_MIN_SECS - secs }) : t("Stop — that's enough")}</button>
            </div>
          )}
          {phase === "have" && clip && (
            <>
              <audio className="ws-vm-audio" controls src={clip.url} />
              {tooShort && <p className="ws-vm-warn">{t("That's a little short — record at least {n} seconds so it really sounds like you.", { n: VOICE_MIN_SECS })}</p>}
              <label className="ws-vm-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>{t("This is my own voice, or I have this person's permission to use it.")}</span>
              </label>
              <div className="ws-vm-row">
                <button type="button" className="wb-btn ws-vm-go" disabled={!consent || tooShort} onClick={make}><Ico n="wand" size={14} /> {t("Create my voice")}</button>
                <button type="button" className="ws-vm-redo" onClick={redo}>{t("Redo")}</button>
              </div>
            </>
          )}
        </>
      )}
      {err ? <p className="ws-vm-err">{err}</p> : null}
    </div>
  );
}

export const VOICE_UI_CSS = `
/* Voice picker — a scroll-capped column of (pick label + ▶ preview) rows. */
.ws-vp{display:flex;flex-direction:column;gap:7px;max-height:188px;overflow-y:auto;margin-bottom:12px;padding-right:2px}
/* rows keep their height and the LIST scrolls — as flex children they would otherwise be squashed to slivers once the list is longer than its cap */
.ws-vp>*{flex:0 0 auto}
.ws-vp-chip{display:flex;align-items:stretch;gap:0;border:1px solid var(--line,#E4DFCF);border-radius:12px;background:var(--card,#FDFCF7);overflow:hidden;transition:border-color .12s,box-shadow .12s,background .12s}
.ws-vp-chip.sel{border-color:var(--green2,#1FA463);box-shadow:0 0 0 1px var(--green2,#1FA463);background:#F0FAF4}
.ws-vp-pick{flex:1 1 auto;display:flex;align-items:center;gap:8px;min-width:0;text-align:left;border:0;background:transparent;padding:10px 11px;cursor:pointer}
.ws-vp-pick b{flex:0 0 auto;font-size:13px;color:var(--ink,#14201A)}
.ws-vp-blurb{flex:1 1 auto;min-width:0;font-style:normal;font-size:11.5px;color:var(--ink2,#4A554E);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ws-vp-tick{flex:0 0 auto;font-style:normal;color:var(--green,#0C7A46);font-size:12px}
.ws-vp-play{flex:0 0 auto;width:42px;border:0;border-left:1px solid var(--line,#E4DFCF);background:#F3F9F4;color:var(--green,#0C7A46);font-size:12px;cursor:pointer;display:grid;place-items:center;transition:background .12s}
.ws-vp-play:hover{background:#E6F3EC}
.ws-vp-play.on{background:var(--green,#0C7A46);color:#fff}
.ws-vpx{margin-bottom:12px}
.ws-vpx .ws-vp{margin-bottom:8px}
.ws-vp-sec{font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3,#8A938C);padding:2px 2px 0}
.ws-vp-chip.mine .ws-vp-pick b{display:inline-flex;align-items:center;gap:4px;color:var(--green,#0C7A46)}
.ws-vp-rm{flex:0 0 auto;border:0;border-left:1px solid var(--line,#E4DFCF);background:transparent;color:var(--ink3,#8A938C);padding:0 10px;cursor:pointer;display:grid;place-items:center;font-size:11px;font-weight:800}
.ws-vp-rm:hover{color:#B3261E;background:#FCF1F0}
.ws-vp-rm.armed{color:#fff;background:#B3261E}
.ws-vp-own{display:flex;align-items:center;gap:11px;width:100%;text-align:left;border:1.5px dashed #9CCBB1;background:#F6FBF8;border-radius:12px;padding:10px 12px;cursor:pointer;transition:border-color .12s,background .12s}
.ws-vp-own:hover{border-color:var(--green,#0C7A46);background:#EEF8F2}
.ws-vp-own-ico{flex:0 0 auto;width:32px;height:32px;border-radius:50%;background:var(--green,#0C7A46);color:#fff;display:grid;place-items:center}
.ws-vp-own-t{display:flex;flex-direction:column;gap:1px;min-width:0}
.ws-vp-own-t b{font-size:13px;color:var(--ink,#14201A)}
.ws-vp-own-t small{font-size:11.5px;color:var(--ink2,#4A554E);line-height:1.3}
.ws-vm{border:1.5px solid var(--green2,#1FA463);background:#F6FBF8;border-radius:14px;padding:12px 13px}
.ws-vm-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.ws-vm-h b{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;color:var(--ink,#14201A)}
.ws-vm-x{border:0;background:transparent;color:var(--ink2,#4A554E);cursor:pointer;padding:4px;display:grid;place-items:center;border-radius:8px}
.ws-vm-x:hover{background:#E6F3EC}
.ws-vm-how{margin:0 0 6px;font-size:12px;color:var(--ink2,#4A554E);line-height:1.4}
.ws-vm-script{margin:0 0 10px;padding:10px 12px;background:#fff;border:1px solid var(--line,#E4DFCF);border-radius:10px;font-size:13.5px;line-height:1.5;color:var(--ink,#14201A)}
.ws-vm-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ws-vm-rec,.ws-vm-stop{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:10px 18px;font-size:13.5px;font-weight:800;cursor:pointer}
.ws-vm-rec{background:#C62828;color:#fff;box-shadow:0 4px 12px rgba(198,40,40,.28)}
.ws-vm-rec:hover{background:#B31F1F}
.ws-vm-stop{background:var(--ink,#14201A);color:#fff}
.ws-vm-stop:disabled{opacity:.55;cursor:default}
.ws-vm-dot{width:10px;height:10px;border-radius:50%;background:#fff;flex:0 0 auto}
.ws-vm-live{display:inline-flex;align-items:center;gap:8px;font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;color:#C62828}
.ws-vm-live .ws-vm-dot{background:#C62828}
.ws-vm-dot.pulse{animation:wsvmpulse 1s ease-in-out infinite}
@keyframes wsvmpulse{50%{opacity:.25}}
.ws-vm-up{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;color:var(--green,#0C7A46);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.ws-vm-audio{display:block;width:100%;height:38px;margin:0 0 8px}
.ws-vm-consent{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;line-height:1.4;color:var(--ink,#14201A);margin:0 0 10px;cursor:pointer}
.ws-vm-consent input{flex:0 0 auto;width:17px;height:17px;margin-top:1px;accent-color:var(--green,#0C7A46);cursor:pointer}
.ws-vm-go{display:inline-flex;align-items:center;gap:6px}
.ws-vm-redo{border:0;background:transparent;color:var(--ink2,#4A554E);font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.ws-vm-warn,.ws-vm-err{margin:0 0 8px;font-size:12px;line-height:1.4;color:#B3261E}
.ws-vm-err{margin:8px 0 0}
.ws-vm-making{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;padding:14px 6px}
.ws-vm-making b{font-size:14px;color:var(--ink,#14201A)}
.ws-vm-making span{font-size:12px;color:var(--ink2,#4A554E);line-height:1.4}
.ws-vm-spin{width:26px;height:26px;border-radius:50%;border:3px solid #CFE8DA;border-top-color:var(--green,#0C7A46);animation:wsvmspin .8s linear infinite}
@keyframes wsvmspin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.ws-vm-dot.pulse,.ws-vm-spin{animation:none}}
`;
