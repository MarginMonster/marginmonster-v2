# Shipping rates plugin — install

Same mechanism as the MOQ validations plugin. Editor only; the Wix API
cannot create service plugins.

## 1. Create the extension

1. Open the site in the **Wix Editor**.
2. Left sidebar → **Code** (`{}`) → turn on Dev Mode if it is off.
3. Scroll to **Custom Extensions** → **+ Add** → **Shipping Rates**.
4. Name it exactly **`ecom-shipping-rates`**.

Wix creates a folder with two files:

```
ecom-shipping-rates.js
ecom-shipping-rates-config.js
```

## 2. Paste the code

Replace the contents of each generated file with the matching file from
`backend/` in this folder. Names must line up — Wix pairs the config file
to the plugin by name.

## 3. Publish

`getConfig()` is only read at **publish** time. Saving is not enough.
Publish the site or the plugin stays inert.

## 4. Turn off the old rate table

Until you do this, buyers see the old bands *and* the new rates.

Dashboard → **Settings → Shipping & fulfilment → Domestic**. Deactivate
the two Basic Shipping rows:

- `Air Freight Upgrade - Expedited` (the 13-band table)
- `Sea Freight - Included (no extra charge)`

The plugin returns replacements for both.

## 5. Check it

Put enough in a cart to pass 12 kg and open checkout. Two options should
appear:

- Sea Freight - Included — $0.00
- Air Freight Upgrade - Expedited — cart weight × $9.09

Then empty it down to one case. Sea should disappear and only air remain.

Cross-check against `wix/shipping/AIR-FREIGHT-RATES.md`.

## The sea minimum

Sea freight bills a minimum consignment, so a small order costs the same
to ship as one at the minimum. Baking sea into the product price only
recovers that once the cart is heavy enough.

`SEA_MIN_KG` is set to **12 kg**. Below that the sea option is not
offered and the buyer ships air. Set it to 0 to always offer sea.

Worth knowing: order 10008 was 10.93 kg, so it would **not** have
qualified for sea under this rule — one more Eevee case would have
taken it over. If that is turning away orders you want, lower the
number; the trade is that you eat the shortfall on the consignment
minimum.

## Changing the rate

Edit `RATE_PER_KG` at the top of `ecom-shipping-rates.js` and publish.
That is the only number that needs to move when freight quotes change.

`MIN_CHARGE` floors small carts. `FALLBACK_WEIGHT_KG` is what an
unweighed line item gets billed at — see below.

## The zero-weight guard

Order 10008 was charged $25 for a multi-case order because every product
in it had no weight. The cart totalled 0 kg and 0 fell into the cheapest
band.

All 938 sellable products now carry a weight, so that specific cause is
gone. The guard is for the next time a product is added without one: a
line item with no usable weight is billed at `FALLBACK_WEIGHT_KG` per
unit rather than zero, and the plugin writes a warning to the site logs
naming how many lines it had to assume. A missing weight can make a cart
dearer than it should be; it can never make it cheaper.

To find them, check **Dev Mode → Site Monitoring** for lines starting
`[shipping-rates]`.
