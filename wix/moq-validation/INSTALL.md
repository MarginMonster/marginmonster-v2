# MOQ enforcement — Magic Monster Wholesale

Two files. Ten minutes in the editor. Nothing here touches your products.

Checked against the live site (shopmagicmonster.com) before writing:

- Velo is **enabled**, Wix Stores is on **Catalog V3**.
- Product SKUs are stored as plain `MM-0001`, `MM-0263`… with **no size suffix**,
  and no product uses size/colour options. So one line item = one SKU, and
  matching on SKU is safe.
- The field paths this code reads (`physicalProperties.sku`, `quantity`,
  `productName.original`) are the ones Wix actually sends to the validations
  plugin.

---

## 1. Turn on Dev Mode

Open the site in the **Wix Editor** → top bar → **Dev Mode** → **Turn on Dev Mode**.

## 2. Add the eCommerce Validations service plugin

In the left **Code** sidebar:

1. Go to the **Public & Backend** section.
2. Hover over **Service Plugins** and click the **+** (Add) icon.
3. Choose the **eCommerce Validations** plugin. Accept any terms shown.
4. Enter the name `ecom-validations` — **no spaces or special characters** —
   and click **Add & Edit Code**.

Wix creates a folder containing two files:

- `ecom-validations.js` — the rules
- `ecom-validations-config.js` — the settings

(If the folder does not appear, refresh the editor.)

## 3. Paste in the three files

- Replace the generated **`ecom-validations.js`** with the one in this folder.
- Replace the generated **`ecom-validations-config.js`** with the one in this
  folder. If you named your plugin something other than `ecom-validations`, your
  config file will be named `<your-name>-config.js` — paste the contents into
  that file rather than renaming anything.
- Add **`moq-data.js`** to the **`backend`** folder (Code sidebar → *Backend* →
  *+ New .js file* → name it `moq-data.js`).

If your plugin folder puts the file somewhere other than `backend/`, fix the
import at the top of `ecom-validations.js` to match — it must point at `moq-data.js`.

## 4. Make it run in the CART, not just checkout

This is handled by `ecom-validations-config.js`, which returns:

```js
export function getConfig() {
  return { validateInCart: true };
}
```

Note it is a **`getConfig()` function, not a JSON file** — an earlier version of
these instructions had that wrong. Without `validateInCart: true` the buyer is
only stopped at checkout, after they have already filled in their address.

Wix reads `getConfig()` **when the site is published**, so config changes never
take effect until you publish again.

## 5. Test before publishing

You do not have to publish to find out whether the code works. In the code
editor, use **functional testing** to call `getValidationViolations()` directly
with a sample cart. `console.log()` output from the plugin appears in **Wix Logs**
once the site is published.

## 6. Publish

Click **Publish**. It is live immediately.

> If you later want to try changes on a **test site**, note that the production
> site must be published at least once after adding the plugin before the test
> site will run it.

---

## Testing it

1. Open the live site, add **one** costume, set quantity to **1**.
2. Go to the cart. You should see:
   *"… minimum order is 120 pcs, you have 1. Add 119 more."*
3. Checkout is blocked until it is fixed.

Worth also testing: put **240** of a 120-piece SKU in the cart (should pass) and
**130** (should be blocked, offering 120 or 240).

---

## The four switches

Top of `ecom-validations.js`:

```js
const MIN_TOTAL_UNITS       = 3;      // pieces per order; 0 drops the floor
const REQUIRE_WHOLE_CASES   = true;   // false = 121 pcs allowed, only the floor matters
const UNKNOWN_SKU_POLICY    = 'allow'; // 'allow' | 'block' — see below
const MIN_UNITS_COUNTS_ONLY_MOQ_ITEMS = false;
```

### `UNKNOWN_SKU_POLICY` — leave this on `'allow'`

**This is the setting that makes the toys work.** Leave it alone.

The two product groups are meant to behave differently:

| | Costumes (`MM-####`) | Toys — Pokemon, Smiski, etc. |
|---|---|---|
| Per-SKU minimum | Yes, by the case | **None** |
| Counts toward the 3-piece floor | Yes | **Yes** |

`'allow'` is what delivers the right-hand column: a SKU with no row in
`moq-data.js` carries no case minimum and sells in any quantity, while still
counting toward the three pieces the cart requires. A buyer taking three Smiski
checks out cleanly whether they are three different ones or three of the same;
a buyer taking one gets the piece-floor message and nothing else.

Setting it to `'block'` would stop every toy at the cart. Don't.

For the same reason, leave `MIN_UNITS_COUNTS_ONLY_MOQ_ITEMS = false` — that
is what lets toys count toward the three.

### `MIN_TOTAL_UNITS` counts pieces, not products

The floor is **three pieces**, and they may all be the same product. Three of
one Smiski case clears it. This is a change from the original rule, which
demanded three *different* products and turned away buyers who wanted a depth
buy of a single line.

**The trade-off you are accepting:** because unlisted SKUs sell freely, a
*costume* added later without a row in `moq-data.js` will also sell in ones,
silently. Nothing warns you. When you add costumes, add their MOQ row in the
same sitting.

#### Audit of the live catalogue

- Every SKU in the store falls in `MM-0001`–`MM-0674`, contiguous, exactly one
  variant per SKU.
- `moq-data.js` covers `MM-0001`–`MM-0674`. **The match is 1:1** — every costume
  has an MOQ, and no entry in the file is orphaned.
- No SKU sorts outside that range, so the toy ranges are not in this catalogue
  yet. When they land, they need no MOQ rows — they are handled by `'allow'`.

---

## Changing a SKU's MOQ

Open `moq-data.js`, find the SKU, change the number, republish. Nothing else
needs touching.

```js
"MM-0042": 60,
```

---

## What it does NOT do

- It does not check the **size split**. The buyer picks that from the dropdown on
  the listing ("60 L / 60 XL"); this code only enforces the total quantity.
- It does not touch products absent from `moq-data.js` while `UNKNOWN_SKU_POLICY`
  is `'allow'`.
- It does not apply to digital or gift-card line items.

---

## What changed from the first version

- **Quantities are now totalled per SKU before checking.** Previously each line
  was checked alone, so a cart holding 60 + 60 of one 120-piece SKU was rejected
  even though it is a valid full case.
- **One message per offending product**, instead of every problem concatenated
  into a single run-on error.
- **`UNKNOWN_SKU_POLICY`** added, so the 267-SKU gap above is a decision rather
  than an accident.
- **Digital / gift-card lines are skipped**, and a missing `physicalProperties`
  object no longer risks a crash.
- **The whole plugin is wrapped in a try/catch** that logs and lets the order
  through. A thrown error inside a validations plugin is not worth taking the
  store's checkout down for.
- Below-minimum messages now say how many more to add.

## A note on the data

`MM-0263` is set to `30` where its neighbours are 60/120. That looked like a
typo, but it is *"Assorted Fairytale Princess Dress Boxed Mix"* — a boxed
assortment, so a smaller case size is plausible. Left as-is. Worth a glance:
`MM-0622` is `100` inside an otherwise unbroken block of `200`s.

Separately: every product checked came back with `visible: false` on the
storefront. Expected if the store has not launched yet — but the MOQ rules
cannot be tested end-to-end on the live site until products are visible.
