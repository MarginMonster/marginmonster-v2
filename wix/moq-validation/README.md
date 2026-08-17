# Magic Monster Wholesale — MOQ enforcement (Wix Velo)

Cart and checkout rules for **shopmagicmonster.com**. Not part of the
Shopify app in this repo — this is Wix Velo code, kept here for version
control. It runs on the Wix site, pasted in through the Editor.

## What it enforces

| Product group | Per-SKU minimum | Counts toward the 3-product rule |
| --- | --- | --- |
| Costumes (`MM-0001`–`MM-0674`) | Yes — by the case, from `moq-data.js` | Yes |
| Toys (Pokemon, Smiski, …) | **None** — sell in any quantity | Yes |

Toys have no SKU in the catalogue, so they never match `moq-data.js` and are
skipped by the per-SKU check. They are held only to `MIN_TOTAL_UNITS` — three
pieces per order, which may all be the same product.

## Files

    backend/ecom-validations.js         the rules
    backend/ecom-validations-config.js  getConfig() — turns on cart validation
    backend/moq-data.js                 SKU -> minimum order quantity (674 SKUs)
    INSTALL.md                          Wix Editor install steps
    test/run.sh                         runs both suites under Node

Install steps are in `INSTALL.md`. The config is a `getConfig()` **function**,
not a JSON file, and Wix only reads it when the site is published.

## Tests

    ./test/run.sh

23 checks: MOQ floors, whole-case multiples, quantities summed per SKU across
line items, the distinct-product rule, and the toy scenarios. No dependencies.

## Verified against the live catalogue

Checked via the Wix API, not assumed:

- Catalogue SKUs are exactly `MM-0001`–`MM-0674`, contiguous, one variant each
  — a 1:1 match with `moq-data.js`. No costume lacks a minimum.
- All **674** size-split modifier labels ("Size split - min 120pcs - L/XL")
  state the same number the code enforces. Zero contradictions.
- All **2679** split choices sum to exactly their SKU's MOQ, so a buyer cannot
  choose a split that doesn't add up. The split needs no enforcement in code —
  only the total quantity does, which is what this plugin checks.
- SKUs are plain `MM-####` with no size suffix and no product options, so one
  line item maps to one SKU.

## Known gaps

- **Multiples make the split ambiguous.** `REQUIRE_WHOLE_CASES` allows 240 and
  360, but the split modifier is a single choice. A buyer picking
  "60 L / 60 XL" at quantity 240 has not said whether they want 120/120. The
  listing doesn't define it and this code has no opinion.
- **Unlisted SKUs sell with no minimum.** That is deliberate — it is what lets
  the toys work (`UNKNOWN_SKU_POLICY = 'allow'`). The cost is that a *costume*
  added without a `moq-data.js` row also sells in ones, silently. Add the row
  when you add the product.
- **Size splits are not validated against stock**, only against the MOQ total.
