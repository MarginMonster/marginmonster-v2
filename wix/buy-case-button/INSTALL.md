# Add-on: the "buy full case" button

You already installed the MOQ validation. This is the second half — the fix for
"I pick a size split and the cart says 1".

## Why it needs a button

Wix's own product-page widget owns its quantity box. Velo cannot reach in and change
it when a dropdown choice is made — there is no hook for that. What Velo *can* do is
add its own button that puts the full case in the cart in one click. So that's what
this does.

The stock Add to Cart button stays where it is. This sits next to it.

## Install — about 5 minutes

1. **Wix Editor → Dev Mode on** (already on from last time).

2. Open the **Product Page** (Pages menu → Store Pages → Product Page).

3. **Add → Button.** Put it under the size dropdown. Any style you like — the label
   gets set by the code.

4. Select the button → **Properties panel → ID** → set it to exactly:
   ```
   buyCaseButton
   ```

5. *(Optional but nice)* **Add → Text**, put it under the button, set its ID to:
   ```
   caseNote
   ```
   It shows "Sold by the case — 120 pcs minimum." and then confirms after a click.

6. Open the Product Page's **code panel** (the `{}` tab at the bottom, with the
   Product Page selected) and paste in `pages/product-page.js`.

7. **Publish.**

## Test

Open any costume listing. The button should read **BUY FULL CASE — 120 PCS**
(or 60 / 100 / 200, matching that product). Click it — the cart should show the
full case, not 1.

## Before you start — one extra file

This version needs **`backend/moq.web.js`** in place (it ships with the MOQ plugin,
in `wix/moq-validation/backend/`). Add it the same way you added `moq-data.js`.

It exists because Velo page code **cannot import a plain backend `.js` file**. The
original version of this button did `import { moqForSku } from 'backend/moq-data.js'`
inside page code, which fails silently at runtime — the label never fills in and the
click does nothing. Only web modules (`.web.js` / `.jsw`) are callable from the
frontend, and their exports must be awaited.

## If the button label stays blank

The code tries the product widget first, then router data. If neither resolves, click
the product widget and read its real ID from the Properties panel — if it isn't
`#productPage1`, change that ID in `resolveProduct()`.

Also check the browser console for `[MM] could not resolve the product on this page`.

## Note

`moq-data.js` is shared with the validation plugin — the button reads the same 674-SKU
table. Change a SKU's MOQ there once and both the button and the checkout block follow.
