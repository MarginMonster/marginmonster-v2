/* The words that draw a character — client-safe and import-free, so the tests can read them.
 *
 * Creating a character used to be one step: upload a photo, pay, get "a clean professional presenter
 * photo" in four human outfits. The owner gave it a rough ink drawing of a hulking antlered creature
 * and got back a man in an open shirt with a deer skull for a head, in Casual / Smart / Active / Street
 * (2026-11-17: "a humanoid monster not even close to reference image").
 *
 * So there are now three KINDS of character, each drawn its own way, and the first picture is a
 * PREVIEW the maker sees before anything is charged:
 *   person   a real-looking presenter, waist up — later forged into four outfits
 *   cartoon  a cartoon character, whole figure — one look, never re-dressed
 *   monster  a creature, whole figure — one look, never made more human, never dressed */

export type CharKind = "person" | "cartoon" | "monster";

export const charKindOf = (v: unknown): CharKind => (v === "cartoon" || v === "monster" ? v : "person");

/** The longest description a maker can give. */
export const CHAR_DESC_MAX = 400;

const FIGURE = "The whole figure is in frame from head to feet, facing the camera, centred, with a little space above the head.";
const CLEAN = "No text, no logo, no watermark, nobody else in the picture.";

/** The prompt for the one picture a maker sees first. `hasRef`: they added a picture of the character. */
export function characterPreviewPrompt(kind: CharKind, desc: string, hasRef: boolean): string {
  const said = desc.trim().replace(/\s+/g, " ").slice(0, CHAR_DESC_MAX);
  const words = said ? ` In the maker's words: ${said}${/[.!?]$/.test(said) ? "" : "."}` : "";
  if (kind === "monster") {
    return [
      hasRef
        ? "Redraw the creature in the reference image as a finished, highly detailed character design: a photorealistic practical-effects creature from a horror film, eerie rather than gory."
        : "A finished, highly detailed character design of a creature: a photorealistic practical-effects creature from a horror film, eerie rather than gory.",
      hasRef
        ? "It must stay the SAME creature — the same silhouette, build, bulk and posture, the same head and every feature on it, the same horns or antlers, spikes, limbs and body, the same colours and surface."
        : "",
      "Do NOT make it more human and do not dress it: no human face, no human hands, no clothes unless they are asked for or shown." + words,
      FIGURE,
      "Plain seamless mid-grey studio backdrop, moody soft light. No blood.",
      CLEAN,
    ].filter(Boolean).join(" ");
  }
  if (kind === "cartoon") {
    return [
      hasRef
        ? "Redraw the character in the reference image as a finished, polished character design, in the reference's own art style."
        : "A finished, polished cartoon character design. Unless the maker asks for another style: feature-film quality 3D animation, with appealing stylised proportions, large expressive eyes and richly detailed fur, skin and fabric.",
      hasRef
        ? "It must stay the SAME character — the same design, proportions, colours, markings, face, and the same clothing and accessories. Add nothing that is not there."
        : "One clear signature feature, a bold recognisable silhouette, and few accessories.",
      "It is a cartoon character, not a person in a costume." + words,
      FIGURE,
      "Plain seamless light-grey studio backdrop, soft even studio light.",
      CLEAN,
    ].filter(Boolean).join(" ");
  }
  return [
    hasRef
      ? "The reference image shows a person or a brand character. Recreate the EXACT same one — identical face, hair, colours and features — as a clean professional portrait photograph."
      : "A photorealistic professional portrait photograph of one person.",
    words.trim(),
    "Half-body framing: waist up, facing the camera, arms relaxed and visible, a relaxed everyday outfit.",
    "Soft even studio light on a plain warm neutral backdrop, sharp focus.",
    CLEAN,
  ].filter(Boolean).join(" ");
}

/** What a picture model must not "fix" about a character when it draws them again (a full-body still, a
 *  scene): a creature has no human hands, a cartoon pup wears no trousers. Empty for a person. */
export function characterContinuity(kind: CharKind, desc: string): string {
  if (kind === "person") return "";
  const said = desc.trim().replace(/\s+/g, " ").slice(0, 240);
  return kind === "monster"
    ? `This is a creature, not a person${said ? ` (${said})` : ""}. Its whole body stays exactly as in the reference — the same anatomy, hide, limbs, claws and proportions. Never human skin, human hands or a human face, and no clothes that are not in the reference.`
    : `This is a cartoon character, not a person${said ? ` (${said})` : ""}. Its whole body stays exactly as in the reference, in the same art style — the same design, colours and markings, and only the clothes and accessories it already has.`;
}
