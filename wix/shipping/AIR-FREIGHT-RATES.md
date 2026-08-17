# Air freight upgrade - rate tables

Sea freight is baked into every product price. The air option is an **upgrade**,
so it must charge the *difference* between air and sea, not the full air rate.

| Supplier | Goods | Sea $/kg | Air $/kg | Delta | Delta + 15% pad |
| --- | --- | --- | --- | --- | --- |
| Seasonal | costumes | 2.80 | 10.70 | 7.90 | **9.08** |
| ShuXiu | TCG / toys | 5.70 | 9.80 | 4.10 | **4.71** |

Every band is priced at its **ceiling**, so the charge is never below cost
anywhere inside the band.

## The bug that was live

The air table had no band below 2, and 234 products carried no weight at all.
A cart of weightless products totalled 0 and fell into the bottom band.
Order 10008 (3 x Eevee plush case + 2 Funism sets, 10.93 kg) was charged **$25**
against a true air-upgrade cost of $51.53.

All 938 sellable products now carry a real weight, so that cart now totals
10.93 and prices correctly.

## Tables to enter in the dashboard

### Costume profile (Seasonal) - $9.08 per kg

| Weight range | Rate |
| --- | --- |
| 0 - 1 | $10 |
| 1 - 2 | $19 |
| 2 - 3 | $28 |
| 3 - 4 | $37 |
| 4 - 5 | $46 |
| 5 - 6 | $55 |
| 6 - 8 | $73 |
| 8 - 10 | $91 |
| 10 - 12.5 | $114 |
| 12.5 - 15 | $137 |
| 15 - 20 | $182 |
| 20 - 25 | $228 |
| 25 - 30 | $273 |
| 30 - 40 | $364 |
| 40 - 50 | $455 |
| 50 - 75 | $682 |
| 75 - 100 | $909 |
| 100 - 150 | $1,363 |
| 150 - 200 | $1,817 |
| 200 - 300 | $2,726 |
| 300 - 500 | $4,543 |
| 500 and up | $4,997 |

### TCG / toys profile (ShuXiu) - $4.71 per kg

| Weight range | Rate |
| --- | --- |
| 0 - 1 | $5 |
| 1 - 2 | $10 |
| 2 - 3 | $15 |
| 3 - 4 | $19 |
| 4 - 5 | $24 |
| 5 - 6 | $29 |
| 6 - 8 | $38 |
| 8 - 10 | $48 |
| 10 - 12.5 | $59 |
| 12.5 - 15 | $71 |
| 15 - 20 | $95 |
| 20 - 25 | $118 |
| 25 - 30 | $142 |
| 30 - 40 | $189 |
| 40 - 50 | $236 |
| 50 - 75 | $354 |
| 75 - 100 | $472 |
| 100 - 150 | $708 |
| 150 - 200 | $943 |
| 200 - 300 | $1,415 |
| 300 - 500 | $2,358 |
| 500 and up | $2,594 |

## Why two profiles

A single table has to assume the worst-case supplier - Seasonal at $9.08/kg.
Applied to a TCG cart that is nearly 4x the real cost: order 10008 would be
charged $185 against $51.53 of actual freight. Splitting the catalogue into two
shipping profiles charges each side its own true delta.

Wix does not expose rate rows or product-to-profile assignment over the API;
both tables have to be entered under Settings > Shipping & fulfilment.

## Open item: weight unit

The store's weight unit is set to **LB**, but every number in the catalogue is a
**kilogram** figure - costumes at 0.375 are 0.375 kg (4.5 kg case / 12), and the
TCG case weights written here are kg. The rate bands were also authored on the kg
scale (the live table works out to $9.10 per unit of weight, matching the
Seasonal delta almost exactly).

The arithmetic is therefore self-consistent; only the label shown at checkout is
wrong. Switching the store unit to KG is a one-line settings change, but verify
on the backup site first that Wix relabels rather than rescales the 940 stored
values.

