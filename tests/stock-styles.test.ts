/* A STOCK CHARACTER CAN HAVE STYLES — the same somebody, made another way.
 *
 * The owner, 2026-11-24, on the stock werewolf: "the Howl character who is slightly ai slop looking". Four
 * photographed candidates were drawn; his verdict: "C is slop - a is a banger, b is mid". And: "a cartoon
 * used version should still be a selectable style to a degree as an available mechanic". So the film look is
 * ADDED beside the first — one more look on Howl's own page, one more way to cast him — never a replacement.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_STYLE_LABEL, STOCK_CHARACTERS, STYLE_SEP, baseAvatarId, styleId } from "../app/lib/stock-characters.ts";
import { parseStar } from "../app/lib/character-series.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8").replace(/\r\n/g, "\n");

test("Howl has a film look beside the one he had — its own picture and words, on our own disk", () => {
  const howl = STOCK_CHARACTERS.find((c) => c.id === "howl")!;
  assert.equal(howl.styles?.length, 1);
  const film = howl.styles![0];
  assert.deepEqual([film.key, film.label], ["film", "Film"]);
  assert.ok(/^\/avatars\/howl_film\.jpg\?v=\d+$/.test(film.img));
  assert.ok(fs.existsSync(path.join(root, "public", "avatars", "howl_film.jpg")), "the picture is in the repo");
  assert.ok(fs.existsSync(path.join(root, "public", "avatars", "howl_0.jpg")), "…and the first look is still there");
  // the same character in other words: upright, grey fur, yellow eyes, the red plaid — and photographed
  for (const must of ["werewolf", "upright", "dark-grey fur", "yellow eyes", "red plaid shirt", "never a render"]) assert.ok(film.desc.includes(must), must);
  assert.ok(film.desc.length <= 320 && (film.continuity || "").includes("only the torn red plaid shirt"));
  // nobody else gained a style by accident
  assert.deepEqual(STOCK_CHARACTERS.filter((c) => c.styles?.length).map((c) => c.id), ["howl"]);
});

test("a style is cast by its own id, and still belongs to its character", () => {
  assert.equal(STYLE_SEP, "~");
  assert.equal(styleId("howl", "film"), "howl~film");
  assert.equal(baseAvatarId("howl~film"), "howl");
  assert.equal(baseAvatarId("howl"), "howl");
  assert.equal(baseAvatarId(null), "");
  assert.equal(FIRST_STYLE_LABEL, "Classic");
  // a show can star the style: the star it stores passes the same check as any other
  const film = STOCK_CHARACTERS.find((c) => c.id === "howl")!.styles![0];
  const star = parseStar({ id: styleId("howl", film.key), name: "Howl", faceUrl: film.img, kind: "monster", look: film.desc, voiceId: "char:howl" });
  assert.ok(star && star.id === "howl~film" && star.faceUrl === film.img && star.look.length <= 220);
});

test("where it shows: one more look on the character's page, one more star in the show picker", () => {
  const cast = read("app", "routes", "web.presenters.tsx");
  assert.ok(cast.includes("label: a.styles?.length && v === 0 ? FIRST_STYLE_LABEL : OUTFITS[v].label,"), "the first look of a character with styles is \"Classic\", not an outfit's name");
  assert.ok(cast.includes("for (const st of a.styles || []) looks.push({ label: st.label, img: st.img, cut: null, spin: null, spinState: \"none\" });"), "shown as it was made — no cut-out, no 3D view");
  assert.ok(cast.includes("(showsBy[baseAvatarId(star.id)] ||= []).push({"), "a show starring a style is listed on the character's own page");
  const ch = read("app", "routes", "web.channels.tsx");
  assert.ok(ch.includes("...(a.styles || []).map((st) => ({ id: styleId(a.id, st.key), name: a.name, tag: st.label, img: st.img, kind, look: (st.desc || \"\").slice(0, 220), voiceId })),"), "the same name and voice, its own picture and words");
  assert.ok(ch.includes("<span>{r.name}{r.tag ? <> · {t(r.tag)}</> : null}</span>"), "told apart in the picker");
  const dict = read("app", "lib", "ui-i18n-dict.ts");
  for (const k of ["Classic", "Film"]) assert.ok(dict.split(`${JSON.stringify(k)}:`).length - 1 >= 5, k);
});
