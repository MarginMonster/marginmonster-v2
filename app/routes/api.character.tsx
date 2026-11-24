/* Creating a character — the server half of the dialog in app/components/CharacterForge.tsx.
 *
 * A RESOURCE route (no component), so the one dialog can be opened from anywhere a cast is shown — the
 * Presenters section, the Studio's presenter picker — and talk to the same place:
 *
 *   GET                         → what the dialog needs to draw itself: prices, previews left today,
 *                                 the shop's own voices, whether the plan can create characters at all
 *   POST intent=preview         multipart { charKind, avatarDesc, avatarPhoto? | refFile? }
 *                               → { preview: { file, refFile, kind, left } }        FREE, counted
 *   POST intent=adopt           { img (one of our /renders pictures), charKind, avatarDesc }
 *                               → { preview: { file, refFile: "", kind, left } }    FREE, nothing drawn —
 *                                 "Keep in my cast": a story's own character, from the portrait it drew
 *   POST intent=register        { previewFile, avatarName, avatarGender, avatarVoice, avatarEnergy }
 *                               → { registered: { name, kind } }                    charged here, once
 *
 * The rule the owner set (2026-11-17): "they need to see what it will be before commit". So a character
 * is registered FROM a preview, and everything that decides the price and the result — what kind it is,
 * the description, the picture — is read from the record written when that preview was drawn
 * (character-preview.server.ts), never from the form. The browser only says WHICH preview. */

import fs from "node:fs";
import path from "node:path";
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { db } from "../db.server";
import { ownRenderPath } from "../lib/story-picture";
import { getWebIdentity } from "../lib/web-auth.server";
import { readUiLang, tr } from "../lib/ui-i18n";
import { capabilitiesFor } from "../lib/capabilities.server";
import { refundTokens, spendTokens } from "../lib/tokens.server";
import { enqueueJob } from "../lib/job-queue.server";
import { TOKEN_COST } from "../lib/plan-config";
import { uprightPhoto } from "../lib/upright-photo.server";
import { CHAR_DESC_MAX, charKindOf } from "../lib/character-prompts";
import { DEFAULT_CHARACTER_VOICE, isCharacterVoice } from "../lib/character-voices";

/** How many characters a shop may keep. A failed one made nothing usable and does not count. */
const MAX_CUSTOM_PRESENTERS = 12;
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function loader({ request }: LoaderFunctionArgs) {
  const id = await getWebIdentity(request);
  if (!id) return json({ error: "Sign in first." }, { status: 401 });
  const { shop, account } = id;
  const pv = await import("../lib/character-preview.server");
  const { shopVoiceClones, canCloneVoice } = await import("../lib/voice-clone.server");
  const hasPlan = !!shop.activePlan?.active;
  return json({
    hasPlan,
    // Characters star in videos and films, and creating one is priced at Studio/Legend token value —
    // the same gate the two actions below apply.
    canCreate: hasPlan && capabilitiesFor(shop.activePlan).has("video"),
    costs: { person: TOKEN_COST.avatarForge, character: TOKEN_COST.characterForge },
    left: pv.previewsLeft(shop.id),
    perDay: pv.PREVIEWS_PER_DAY,
    myVoices: await shopVoiceClones(shop.id),
    canMakeVoice: canCloneVoice(account, shop),
  }, noStore);
}

export async function action({ request }: ActionFunctionArgs) {
  const lang = readUiLang(request);
  const id = await getWebIdentity(request);
  if (!id) return json({ error: tr(lang, "Sign in first.") }, { status: 401 });
  const { shop } = id;
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: tr(lang, "That didn't come through — try again.") }, { status: 400 }); }
  const intent = String(form.get("intent") || "");

  if (!shop.activePlan?.active) return json({ error: tr(lang, "Pick a plan first — creating a character runs on tokens.") });
  // Custom characters exist to STAR in videos and films — the "video" capability (Studio and up). A
  // standalone Creator plan's tokens are worth a third as much, and creation is priced to break even at
  // Studio token value (TOKEN_COST.avatarForge / characterForge), so it would be made at a loss there.
  if (!capabilitiesFor(shop.activePlan).has("video")) {
    return json({ error: tr(lang, "Custom characters star in your videos — upgrade to a plan with video to create one.") });
  }
  const pv = await import("../lib/character-preview.server");

  /* ---- step one: SEE them. One picture, free, counted; nothing is charged or queued. ---- */
  if (intent === "preview") {
    const kind = charKindOf(form.get("charKind"));
    const desc = String(form.get("avatarDesc") || "").trim().replace(/\s+/g, " ").slice(0, CHAR_DESC_MAX);
    // the picture they added: a new upload, or the one that came with an earlier preview in this sitting
    const photo = form.get("avatarPhoto");
    const hasPhoto = !!photo && typeof photo !== "string" && photo.size > 0;
    let refFile = hasPhoto ? "" : String(form.get("refFile") || "").trim();
    if (refFile && !pv.ownsUpload(shop.id, refFile)) refFile = "";
    let upload: Buffer | null = null;
    let ext: ReturnType<typeof pv.sniffImage> = null;
    if (hasPhoto && typeof photo !== "string" && photo) {
      if (photo.size > 8 * 1024 * 1024) return json({ error: tr(lang, "Image too large — keep it under 8 MB.") });
      upload = await uprightPhoto(Buffer.from(await photo.arrayBuffer()));
      ext = pv.sniffImage(upload); // what the bytes are, not what the browser called them
      if (!ext) return json({ error: tr(lang, "That file isn't an image — use a JPG, PNG or WebP.") });
    }
    if (!upload && !refFile && desc.length < 8) return json({ error: tr(lang, "Describe your character, or add a picture of them.") });

    // Take one of today's previews NOW — before the screen and the half-minute draw are awaited — so
    // parallel requests cannot all pass the check. Given back on every path that draws nothing.
    const giveBack = pv.reservePreview(shop.id);
    if (!giveBack) {
      return json({ error: tr(lang, "That's {n} previews today — register one you like, or come back tomorrow for more.", { n: pv.PREVIEWS_PER_DAY }) });
    }
    let saved = ""; // a picture written for THIS request — removed again if it leads to no preview
    try {
      if (desc) {
        const { screenCreatePrompt } = await import("../lib/prompt-safety.server");
        const verdict = await screenCreatePrompt(desc);
        if (!verdict.ok) { giveBack(); return json({ error: verdict.message }); }
      }
      if (upload && ext) { saved = pv.saveReference(shop.id, upload, ext); refFile = saved; }
      const file = await pv.makeCharacterPreview({ shopId: shop.id, kind, desc, refFile: refFile || undefined });
      return json({ preview: { file, refFile, kind, left: pv.previewsLeft(shop.id) } }, noStore);
    } catch (e) {
      giveBack();
      if (saved) pv.dropUpload(shop.id, saved);
      console.error(`[character] preview failed for shop ${shop.id}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
      return json({ error: tr(lang, "We couldn't draw them that time — nothing was charged. Try again, or change the description.") });
    }
  }

  /* ---- KEEP A STORY'S CHARACTER: the portrait their story drew for one of its own characters becomes
     the preview. Nothing is drawn (they have seen it — it is the face in every scene), nothing is
     charged, and it is not one of the day's free looks. Step two, below, is the same as for any other
     character: registered once, charged once, by its kind. ---- */
  if (intent === "adopt") {
    const kind = charKindOf(form.get("charKind"));
    const desc = String(form.get("avatarDesc") || "").trim().replace(/\s+/g, " ").slice(0, CHAR_DESC_MAX);
    // only ever one of OUR render pictures, by its bare name (the address comes back from the browser)
    const src = ownRenderPath(String(form.get("img") || ""));
    if (!src) return json({ error: tr(lang, "That picture isn't one of your story's — open the story again.") });
    let buf: Buffer;
    try { buf = fs.readFileSync(path.join(process.cwd(), "data", "renders", path.basename(src))); }
    catch { return json({ error: tr(lang, "That picture is no longer here — draw the story's cast again.") }); }
    const ext = pv.sniffImage(buf); // what the bytes are, not what the name says
    if ((ext !== "jpg" && ext !== "png" && ext !== "webp") || buf.length > 8 * 1024 * 1024) return json({ error: tr(lang, "That picture is no longer here — draw the story's cast again.") });
    try {
      // (the words are screened like a typed description — once: changing only what KIND they are asks nothing new)
      const known = pv.adoptedRecord(shop.id, src);
      if (desc && (!known || known.rec.desc !== desc)) {
        const { screenCreatePrompt } = await import("../lib/prompt-safety.server");
        const verdict = await screenCreatePrompt(desc);
        if (!verdict.ok) return json({ error: verdict.message });
      }
      const file = pv.adoptPicture({ shopId: shop.id, kind, desc, src, buf, ext });
      return json({ preview: { file, refFile: "", kind, left: pv.previewsLeft(shop.id) } }, noStore);
    } catch (e) {
      console.error(`[character] adopting a story portrait failed for shop ${shop.id}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
      return json({ error: tr(lang, "We couldn't bring them over that time — nothing was charged. Try again.") });
    }
  }

  /* ---- step two: register the one they like. This is where tokens are charged. ---- */
  if (intent === "register") {
    const name = String(form.get("avatarName") || "").trim().slice(0, 40);
    if (!name) return json({ error: tr(lang, "Give your character a name.") });
    const gender: "f" | "m" = form.get("avatarGender") === "f" ? "f" : "m";
    const energy = ["hype", "warm", "calm"].includes(String(form.get("avatarEnergy"))) ? String(form.get("avatarEnergy")) : "warm";
    const fileName = String(form.get("previewFile") || "").trim();
    if (!fileName) return json({ error: tr(lang, "Make a preview of your character first — you see them before anything is charged.") });

    const owned = await db.customAvatar.count({ where: { shopId: shop.id, status: { not: "failed" } } });
    if (owned >= MAX_CUSTOM_PRESENTERS) {
      return json({ error: tr(lang, "You already have {n} characters — delete one to create another.", { n: MAX_CUSTOM_PRESENTERS }) });
    }
    const peek = pv.previewRecord(shop.id, fileName);
    if (!peek) return json({ error: tr(lang, "That preview isn't available any more — make a new one.") });
    if (peek.kind === "person") {
      // A person is forged into four outfits by a queued job; one at a time per shop.
      const running = await db.job.count({ where: { shopId: shop.id, type: "FORGE_CUSTOM_AVATAR", status: { in: ["PENDING", "IN_PROGRESS"] } } });
      if (running > 0) return json({ error: tr(lang, "Your last character is still being made — give it a minute.") });
    }

    // CLAIM the preview: from here on this picture cannot be registered a second time (a double click,
    // two tabs, a dialog reopened on the picture it just registered). What KIND it is and what it was
    // drawn from come from the record made when it was drawn — the price follows the kind.
    const rec = pv.claimPreview(shop.id, fileName);
    if (!rec) return json({ error: tr(lang, "That preview isn't available any more — make a new one.") });
    const kind = rec.kind;
    const forgeCost = kind === "person" ? TOKEN_COST.avatarForge : TOKEN_COST.characterForge;

    // The voice: a performed character voice, one of the stock voices, or one of this shop's OWN — an
    // id that is none of those falls back to a default, so a bad id can never reach a speech model.
    const wantVoice = String(form.get("avatarVoice") || "").trim();
    const { resolveVoiceChoice } = await import("../lib/voice-clone.server");
    const voiceId = isCharacterVoice(wantVoice) ? wantVoice
      : kind !== "person" && !wantVoice ? DEFAULT_CHARACTER_VOICE[kind][gender]
      : await resolveVoiceChoice(shop.id, wantVoice, gender);

    let fromExtra = 0;
    try {
      fromExtra = (await spendTokens(shop.id, forgeCost)).fromExtra;
    } catch (e) {
      pv.unclaimPreview(shop.id, fileName, rec);
      return json({ error: e instanceof Error ? e.message : tr(lang, "Not enough tokens to create a character.") });
    }

    // The spend is committed: everything after it either makes the character or gives the tokens back.
    let rowId = "";
    try {
      const row = await db.customAvatar.create({
        data: {
          shopId: shop.id, name, gender, energy, voiceId, kind,
          // a person with no description keeps the old neutral line; a creature gets none — the line is
          // quoted into "This is a creature, not a person (…)" wherever it is drawn again
          desc: rec.desc || (kind === "person" ? `${name}, the brand's own presenter character` : ""),
          refFile: fileName,
          // The price just charged includes a 3D view of each look. Record each one's share (and how
          // much of it came from purchased tokens), so the views are built without charging again and
          // one that can't be made is refunded to where it was paid from.
          spinPaid: TOKEN_COST.avatarSpin,
          spinPaidExtra: Math.floor((fromExtra * TOKEN_COST.avatarSpin) / forgeCost),
        },
      });
      rowId = row.id;
      if (kind === "person") {
        await enqueueJob(shop.id, "FORGE_CUSTOM_AVATAR", { customAvatarId: row.id, prePaid: true, chargedTokens: forgeCost, chargedFromExtra: fromExtra });
      } else {
        // A cartoon or a creature keeps the ONE look its maker approved — registering it is a file copy,
        // so it happens here, now, instead of waiting in the render queue behind somebody's film.
        const { registerCharacterNow } = await import("../lib/custom-avatars.server");
        await registerCharacterNow(row.id);
        // …and its 3D figure starts building straight away, wherever the dialog was opened from.
        const { ensureKits } = await import("../lib/presenter-kit.server");
        void ensureKits(shop.id).catch((e) => console.error(`[kit] ensureKits after registering ${name}: ${e instanceof Error ? e.message : e}`));
      }
      pv.settlePreviews(shop.id, rec);
      return json({ registered: { name, kind } }, noStore);
    } catch (e) {
      console.error(`[character] registering "${name}" failed for shop ${shop.id}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
      if (rowId) await db.customAvatar.delete({ where: { id: rowId } }).catch(() => { /* a failed row is shown with a remove button */ });
      pv.unclaimPreview(shop.id, fileName, rec);
      try {
        await refundTokens(shop.id, forgeCost, fromExtra);
      } catch (re) {
        console.error(`[character] REFUND FAILED — shop ${shop.id} is owed ${forgeCost} tokens: `, re instanceof Error ? re.message.slice(0, 200) : re);
        return json({ error: tr(lang, "Something went wrong and we couldn't return your tokens automatically — contact support and we'll put them back.") });
      }
      return json({ error: tr(lang, "Couldn't register them — your tokens were returned. Try again.") });
    }
  }

  return json({ error: tr(lang, "Unknown request.") }, { status: 400 });
}
