# Air freight upgrade - how it is priced

Sea freight is baked into every product price. Air is an **upgrade**, so it
charges the difference between air and sea freight, not the full air rate.

    air - sea   10.70 - 2.80  =  7.90 / kg
    + 15% pad                 =  9.09 / kg

Suppliers use different freight forwarders and their per-kg quotes are not
comparable, so this is a single rate across the catalogue, set from the
Seasonal quote. Only `RATE_PER_KG` moves when a quote changes.

## The bug that was live

Order 10008 - 3 x Eevee plush case, 1 x Funism palmsize V2, 1 x Funism
suitcase set - was charged **$25**.

Every product in that cart had no weight on it. The cart totalled 0 kg, and
0 fell into the bottom band of the rate table. The cart is actually 10.93 kg.

All 938 sellable products now carry a weight, so that cause is gone. The
plugin also refuses to price an unweighed line at zero, so it cannot come
back through a newly added product.

## The second problem: the table disagreed with itself

The banded table charged each band's **ceiling** weight regardless of where
the cart actually landed. A cart at the bottom of a band paid for nearly
double the weight it had.

| band | charge | $/kg at floor | $/kg at ceiling | spread |
| --- | --- | --- | --- | --- |
| 0 - 2 | $25 | - | 12.50 | - |
| 2 - 5 | $50 | 25.00 | 10.00 | 2.5x |
| 5 - 10 | $95 | 19.00 | 9.50 | 2.0x |
| 10 - 20 | $185 | 18.50 | 9.25 | 2.0x |
| 20 - 35 | $320 | 16.00 | 9.14 | 1.8x |
| 35 - 50 | $455 | 13.00 | 9.10 | 1.4x |
| 50 - 75 | $685 | 13.70 | 9.13 | 1.5x |
| 75 - 120 | $1,090 | 14.53 | 9.08 | 1.6x |
| 120 - 200 | $1,820 | 15.17 | 9.10 | 1.7x |
| 200 - 300 | $2,730 | 13.65 | 9.10 | 1.5x |
| 300 - 500 | $4,550 | 15.17 | 9.10 | 1.7x |
| 500 - 800 | $7,280 | 14.56 | 9.10 | 1.6x |

Design rate is $9.09/kg. Inside a band the buyer paid anywhere from $9.08 to
$25.00 per kg depending on where they landed - a 1.4x to 2.5x spread that has
nothing to do with what freight cost.

## The fix

`wix/shipping-rates/` replaces the table with a Velo service plugin that
prices straight off cart weight:

    air = max(8.00, cart_kg x 9.09)

No bands, so no spread. Same arithmetic at every weight.

| cart | old table | plugin | actual freight |
| --- | --- | --- | --- |
| 0.3 kg (one keychain case) | $25 | $8.00 | $2.73 |
| 10.1 kg | $185 | $91.82 | $91.82 |
| 10.93 kg (order 10008) | $185 | $99.36 | $99.36 |
| 19.9 kg | $185 | $180.89 | $180.89 |
| 50 kg | $455 | $454.50 | $454.50 |

Rounding is always up to the cent, and `MIN_CHARGE` floors small carts, so
the quote is never under cost.

Install steps are in `wix/shipping-rates/INSTALL.md`. The old two Basic
Shipping rows have to be deactivated as part of that, or buyers see both.

## Open item: weight unit

The store's weight unit is set to **LB**, but every number in the catalogue is
a kilogram figure - costumes at 0.375 are 0.375 kg (4.5 kg case / 12), and the
TCG case weights are kg. The old bands were authored on the kg scale too.

The arithmetic is self-consistent; only the label shown at checkout is wrong.
Switching the store unit to KG is a one-line settings change, but verify on the
backup site first that Wix relabels rather than rescales the 940 stored values.

