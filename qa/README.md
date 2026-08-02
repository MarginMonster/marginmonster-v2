# Ad QA — the golden set

Renders a fixed set of real products through the real ad pipeline, scores every
result with a vision rubric, and publishes a contact sheet you can scan in
thirty seconds.

It exists because every generation-quality bug we shipped was found the same
way — spotted in the Archive on a phone, after a merchant could already have
hit it. And the causes were almost never model weakness. They were our own
prompts contradicting themselves:

| shipped prompt | what came back |
|---|---|
| "candid smartphone **selfie**" + "both hands on the product" | a third arm reaching at the camera |
| "**five fingers** per hand" (a hand is four fingers **plus** a thumb) | six digits |
| "offer is a short offer like **20% OFF**" | invented discounts on stores running no sale |
| QA asked only whether text was "correctly spelled" | "we still each still got" passed clean |

All four are visible in ten seconds of looking at a rendered ad. Nobody was
looking, because looking meant generating by hand and paying for it.

## Running it

**Actions → Ad QA (golden set) → Run workflow.**

| input | meaning |
|---|---|
| `formats` | comma-separated format keys — `review,versus,callout,chat` |
| `limit` | how many golden-set products to use |
| `max_renders` | hard cap on cells. Cost control, enforced and logged if it truncates |
| `store_url` | only for seeding the set the first time (see below) |
| `fail_under` | fail the job under this gate pass rate. `0` = report only |

Output is the **ad-qa-report** artifact — open `index.html`. A summary table
also lands on the job page.

## First run: seeding the set

`qa/golden-set.json` doesn't exist yet. Run the workflow once with
`store_url` set to a real storefront — it discovers the catalogue, picks a
deterministic slice, and prints a JSON block to the log. Commit that block as
`qa/golden-set.json`.

After that the set is **fixed**, which is the entire point. A golden set that
changes underneath you cannot tell you whether a prompt edit made things
better or worse.

Pick products that stress different things: something with heavy packaging
text, something with non-Latin script, something tiny, something large,
something on a white background and something shot in a room.

## Required secrets

Settings → Secrets and variables → Actions:

- `ANTHROPIC_API_KEY` — copy generation, the live gate, the rubric
- `REPLICATE_API_TOKEN` — the renders

Missing either, the job exits neutral rather than red. Nothing was tested, and
that isn't a code failure.

## Auto-running on prompt changes

The workflow has a `push` trigger on the prompt files, gated behind a
repository variable so it never spends money you didn't ask it to. Set
`AD_QA_ON_PUSH` to `true` (Settings → Variables → Actions) to turn it on.

## What the rubric measures

The live gate (`qaFormat`) answers one question: ship or don't. Useful at
generation time, useless for tracking regressions — "pass rate went from 61%
to 68%" hides *which* failure moved. The rubric scores each dimension
separately:

- `productIntact` — same product as the source photo, not warped or reinvented
- `textSensible` — reads as English. Duplicated words fail even though every word is spelled right
- `textMatches` — says the strings we asked for, none missing, none invented
- `noSourceText` — no marketing text or watermark carried in from the source photo's background
- `anatomyOk` — four fingers and a thumb, exactly two hands, nobody holding the camera
- `scalePlausible` — believable real-world size next to a hand or a person
- `wouldShip` — would you let a paying merchant post this

## A note on cost

Every cell is one render, two if the gate rejects the first, plus two vision
calls. That's the same money a merchant's failed generation costs us — which
is the other reason this harness pays for itself. A prompt fix that lifts the
first-try pass rate cuts COGS on every generation, not just the tested ones.
