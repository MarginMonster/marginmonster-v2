# Prompt for Claude in Chrome

Copy everything below the line into Claude in Chrome.

---

You are working on the Wix site **Magic Monster Wholesale**
(shopmagicmonster.com), site ID `36f4e7b1-b7ec-42ff-ac6e-754fa213b31e`.
I am the owner and I am logged in. Work through the five tasks below in
order. Do not skip a task because it looks done — verify each one.

The code you need is in my GitHub repo, branch `claude/new-session-cg90lw`:
https://github.com/MarginMonster/marginmonster-v2/tree/claude/new-session-cg90lw/wix

I am logged into GitHub in this browser, so open the files there and copy
them exactly. Do not retype or paraphrase code.

---

## Task 1 — Install the shipping rates plugin

Right now shipping is priced by a 13-band weight table in the dashboard.
It charges each band's **ceiling** weight regardless of where the cart
lands, so a cart at 10.1 kg and one at 19.9 kg both pay $185. Replace it
with a plugin that prices off actual cart weight.

1. Open the **Wix Editor** → left sidebar → **Code** (`{}`) → enable Dev
   Mode if it is off.
2. Scroll to **Custom Extensions** → **+ Add** → **Shipping Rates**.
3. Name it exactly `ecom-shipping-rates`.
4. Wix creates two files. Replace each one's entire contents with the
   matching file from
   `wix/shipping-rates/backend/` in the repo:
   - `ecom-shipping-rates.js`
   - `ecom-shipping-rates-config.js`
5. **Publish the site.** `getConfig()` is only read at publish; saving is
   not enough.

Then turn off the old table, or buyers will see both sets of options:

6. Dashboard → **Settings → Shipping & fulfilment → Domestic**.
7. Deactivate these two Basic Shipping rows:
   - `Air Freight Upgrade - Expedited` (the 13-band table)
   - `Sea Freight - Included (no extra charge)`

**Check it:** add enough to a cart to pass 12 kg and open checkout. You
should see `Sea Freight - Included` at $0.00 and `Air Freight Upgrade -
Expedited` at roughly cart weight × $9.09. Then cut the cart down to one
case — sea should vanish and only air remain. That is intentional: sea
freight bills a minimum consignment and is withheld below 12 kg.

---

## Task 2 — Install the Buy Full Case button

**This fixes a live bug.** When a buyer picks the "120 pcs" size-split
option and hits Add to Cart, Wix adds **1 unit**, not 120. The size split
is a modifier — it is only a label, it does not change quantity. Buyers
are being forced to manually bump the quantity to 120 themselves.

The button already exists in the repo and sets the quantity to the
product's MOQ in one click. It was written but never installed.

1. In the Editor, open the **Product Page**.
2. Add a **button** to the page. Set its ID to exactly `buyCaseButton`.
3. Add a **text element** below it. Set its ID to exactly `caseNote`.
4. Open the Product Page's **code panel** (not `masterPage.js`) and paste
   the contents of `wix/buy-case-button/pages/product-page.js`.
5. Confirm `backend/moq.web.js` exists in the site's backend folder. If
   it does not, create it from `wix/moq-validation/backend/moq.web.js`.
6. Publish.

**Check it:** open a costume product with a 120 MOQ. The button should
read `BUY FULL CASE — 120 PCS`. Click it and confirm the cart shows
**120**, not 1. Then open a Pokémon or Smiski product — those have no
MOQ, so the button and note should both be hidden.

---

## Task 3 — Update the cart rules

The cart currently tells buyers they need **3 different products**. That
is wrong. The floor is **3 pieces**, and they can all be the same
product — a buyer wanting 3 of one case is a valid order and is being
turned away.

1. Editor → **Code** → **Custom Extensions** → the existing
   `ecom-validations` plugin.
2. Replace the entire contents of `ecom-validations.js` with the version
   at `wix/moq-validation/backend/ecom-validations.js` in the repo.
3. Leave `ecom-validations-config.js` alone — it has not changed.
4. Publish.

**Check it:** put 3 of a single Smiski case in the cart. It should go
through cleanly. Drop it to 2 and you should get: *"Wholesale orders
start at 3 pieces. You have 2. They can all be the same product — add 1
more."*

---

## Task 4 — Audit costume sizes

Many costume listings have the wrong sizing. Each costume has a "Size
split" modifier with choices like `All S100-110CM (60 pcs)` or
`All M110-120CM (120 pcs)`.

Go through the costume products in **Dashboard → Catalog → Products**
and for each one compare three things:

- the size letters and cm ranges in the **Size split modifier**
- the sizes stated in the **product description**
- the sizes on any **size chart image** in the product gallery

Flag every product where these disagree. Common problems to look for:

- cm range attached to the wrong letter (an `M` labelled `150-180CM`)
- adult ranges on a kids' costume or the reverse — kids' costumes run
  roughly 90–140 cm, adult roughly 150–180 cm
- a size in the description that has no matching choice in the modifier
- a piece count in the modifier that does not match the MOQ on the
  product

**Do not fix them yet.** Build me a list first: product name, what the
modifier says, what the description says, and what you think is right.
Show me the list and wait for my go-ahead before editing anything.

---

## Task 5 — Report back

Tell me:

1. Which tasks completed and which are blocked, with the reason.
2. The result of each check above — the actual number you saw in the
   cart, the actual shipping quote, the actual error message.
3. The costume sizing list from Task 4.

Do not tell me something worked unless you saw it work. If a step fails,
say so and stop rather than carrying on.
