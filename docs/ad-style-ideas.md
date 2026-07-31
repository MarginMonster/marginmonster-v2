# Ad style ideas & requests

Running list of creative styles worth building, so requests survive between
sessions. Add new ones at the top with the source that inspired them.

## Built

### 💥 Breakout — the "breaking out of the feed" ad (built 2026-07-31)
**Requested from:** Breakout Clips (facebook.com/BreakoutClips) — their whole
page is this one device, and it performs.

**The structure:** a mock social post card sits as a horizontal band across the
middle of the frame (small avatar circle, brand name, outline heart/comment/
send icons, caption). The product is rendered large and in FRONT of that card,
overflowing well past its top and bottom edges, casting a soft shadow onto the
card — so it reads as physically bursting out of the screen. Background layer
behind the card carries a simple complementary scene.

**Why it works:** in a feed, a post whose contents escape the post frame reads
as a glitch in the scroll — the eye stops before the brain catches up.

**Deliberate constraints:**
- The card is GENERIC and unbranded. No real platform's logo, wordmark, colors
  or exact interface — that keeps us clear of trademark issues, same principle
  as naming cartoon styles descriptively instead of by the IP that popularised
  them.
- No invented engagement numbers ("10,500 likes"). Fabricated social proof on
  an ad is an FTC problem; icons alone carry the visual language. If we ever
  want counts, they should come from the merchant's REAL post metrics, which
  we already pull in social-insights.server.ts.

**Where it lives:** `breakout` in `app/lib/ad-formats.ts`, layout prompt in
`formatLayoutPrompt` (image-generation.server.ts), and it's in the campaign
FORMAT_ROTATION so autopilot months include it.

**Natural next step:** this style is even stronger as VIDEO — the product
pushing out of the card with parallax. Worth a Product Highlight motion preset
once the image version proves itself.

## Requested, not yet built

_(nothing queued)_
