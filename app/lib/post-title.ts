/* Assembling a post title inside the provider's 150-character cap.
 *
 * Pure and dependency-free on purpose: this is the last gate before bytes
 * leave for the provider, and it must not depend on the database or on the
 * module that generates captions still being reachable. That also makes it
 * directly testable — see tests/post-title.test.ts. */

import { trimToWord } from "./text-trim.ts";
/** The provider caps a post title at 150 characters, and buildPostTitle
 *  routinely produces two or three times that: caption, then the shop link,
 *  then the hashtag block, then the trial credit.
 *
 *  The first version was a blind `slice(0, 150)`, which cut the AI-disclosure
 *  hashtag — appended last, so always the first casualty. Meta requires that
 *  disclosure and the landing page promises it, so a fix trimmed the body and
 *  re-attached the tag.
 *
 *  That fix moved the wound. The body it trimmed still contained the SHOP
 *  LINK, which buildPostTitle puts after the caption — so on a normal-length
 *  caption the 137 characters of body budget ran out inside the URL. Every
 *  over-length post either lost its link entirely or, worse, shipped a cuid
 *  cut in half: a link that still looks real to a shopper and goes nowhere.
 *  That link is the whole attribution loop — go/a/<id> is how a post is
 *  credited with a sale — so this was silently breaking the thing merchants
 *  are paying for.
 *
 *  Budget the fixed parts FIRST and give the caption what is left. Priority
 *  when it will not all fit: disclosure (legal), then the link (the money),
 *  then caption text, then the merchant's other hashtags, then the trial
 *  credit (a watermark).
 *
 *  The disclosure is deliberately duplicated as a literal rather than imported
 *  from social-caption.server: this is the last gate before bytes leave for the
 *  provider, and it must not depend on the module that generates captions
 *  still being reachable. */
const TITLE_MAX = 150;
const DISCLOSURE = "#EasyModeAi";
const SEP = "\n\n";

/** The block that is purely the shop link — the exact shape buildPostTitle
 *  emits. Matched precisely so a URL the copywriter wrote INSIDE the caption
 *  is never mistaken for it. */
const LINK_BLOCK = /^(?:\uD83D\uDED2\s*)?https?:\/\/\S+$/;

export function trimKeepingDisclosure(raw: string): string {
  const title = (raw || "").trim();
  if (title.length <= TITLE_MAX) return title;

  const blocks = title.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const linkIdx = blocks.findIndex((b) => LINK_BLOCK.test(b));
  const tagIdx = blocks.findIndex((b, i) => i !== linkIdx && b.toLowerCase().includes(DISCLOSURE.toLowerCase()));

  const link = linkIdx >= 0 ? blocks[linkIdx] : "";
  const fullTags = tagIdx >= 0 ? blocks[tagIdx] : "";

  // Nothing recognisable to protect — keep the old behaviour rather than
  // inventing structure that isn't there.
  if (!link && !fullTags) return title.slice(0, TITLE_MAX);

  const body = blocks
    .filter((_, i) => i !== linkIdx && i !== tagIdx)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const cost = (parts: string[]) => parts.filter(Boolean).join(SEP).length;

  // Reserve the fixed tail, shedding the merchant's extra hashtags before the
  // link and the link before the disclosure.
  let tags = fullTags || DISCLOSURE;
  let keepLink = link;
  if (cost([keepLink, tags]) > TITLE_MAX) tags = DISCLOSURE;
  if (cost([keepLink, tags]) > TITLE_MAX) keepLink = "";

  const room = TITLE_MAX - cost([keepLink, tags]) - SEP.length;
  // Below this the caption is a stub that reads worse than no caption.
  const kept = room >= 12 ? trimToWord(body, room) : "";

  return [kept, keepLink, tags].filter(Boolean).join(SEP);
}
