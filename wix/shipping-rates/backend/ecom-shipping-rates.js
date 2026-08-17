/* ------------------------------------------------------------------
 * Magic Monster Wholesale — shipping rates service plugin
 *
 * Replaces the banded rate table in the dashboard. Wix calls
 * getShippingRates() whenever the cart changes; we price the air
 * upgrade straight off the cart weight instead of snapping it to the
 * top of a weight band.
 *
 * Sea freight is already baked into every product price, so the sea
 * option is $0 and the air option charges only the difference between
 * air and sea freight.
 *
 *   air - sea  =  10.70 - 2.80  =  7.90 / kg
 *   + 15% pad  =  9.09 / kg
 *
 * Wix calls this on every cart change and caches for 10 minutes. It must
 * return within 10 seconds, so there are no external calls in here.
 * ------------------------------------------------------------------ */

/* ---------------------------------------------------------- settings */

/** Charged per kg on the air upgrade. Sea is baked into the price. */
export const RATE_PER_KG = 9.09;

/** Nothing ships for less than this, however light the cart is. */
export const MIN_CHARGE = 8.00;

/**
 * Used for a line item that reaches us with no weight on it.
 *
 * This is the guard against the failure that charged $25 for a
 * multi-case order: every product in that cart had no weight, the cart
 * totalled 0 kg, and 0 fell into the cheapest band. A missing weight
 * must never make a cart cheaper, so an unweighed line is billed as a
 * typical case rather than as nothing.
 */
export const FALLBACK_WEIGHT_KG = 1.2;

/**
 * Sea freight bills a minimum consignment, so an order below this weight
 * costs the same to ship as one at the minimum. Baking sea into the
 * product price only recovers that cost once the cart reaches it.
 *
 * Below this weight the sea option is not offered and the buyer ships
 * air. Set to 0 to always offer sea.
 */
export const SEA_MIN_KG = 12;

const SEA_TITLE = 'Sea Freight - Included (no extra charge)';
const SEA_TIME = '40-60 days total (production + sea transit)';
const AIR_TITLE = 'Air Freight Upgrade - Expedited';
const AIR_TIME = '15-25 days total (production + air transit)';

/* ----------------------------------------------------------- helpers */

/**
 * Pull the per-unit weight off a line item.
 *
 * Wix has moved this field around between catalog versions, so check the
 * places it is known to appear before giving up and using the fallback.
 * Returns { kg, assumed } so the caller can tell a real weight from a
 * substituted one.
 */
export function unitWeight(lineItem) {
  const candidates = [
    lineItem && lineItem.physicalProperties && lineItem.physicalProperties.weight,
    lineItem && lineItem.weight,
    lineItem && lineItem.catalogReference && lineItem.catalogReference.weight
  ];

  for (const w of candidates) {
    const n = Number(w);
    if (Number.isFinite(n) && n > 0) return { kg: n, assumed: false };
  }
  return { kg: FALLBACK_WEIGHT_KG, assumed: true };
}

/** Total billable weight of a cart, in kg. */
export function cartWeight(lineItems) {
  let kg = 0;
  let assumedLines = 0;

  for (const li of (lineItems || [])) {
    const qty = Math.max(1, Number(li && li.quantity) || 1);
    const { kg: unit, assumed } = unitWeight(li);
    if (assumed) assumedLines += 1;
    kg += unit * qty;
  }
  return { kg, assumedLines };
}

/**
 * Price the air upgrade for a given weight.
 *
 * Rounded up to the cent so rounding can never land under cost, and
 * floored at MIN_CHARGE.
 */
export function airPrice(kg) {
  const raw = kg * RATE_PER_KG;
  const rounded = Math.ceil(raw * 100) / 100;
  return Math.max(MIN_CHARGE, rounded);
}

/** Is the cart heavy enough to make up a sea consignment? */
export function seaAvailable(kg) {
  return SEA_MIN_KG <= 0 || kg >= SEA_MIN_KG;
}

/** Both options for a cart, as plain numbers. Exported for the tests. */
export function quote(lineItems) {
  const { kg, assumedLines } = cartWeight(lineItems);
  return {
    kg,
    assumedLines,
    sea: seaAvailable(kg) ? 0 : null, // null = not offered at this weight
    air: airPrice(kg)
  };
}

/* ------------------------------------------------------- the plugin */

export const getShippingRates = (options) => {
  const currency = (options && options.currency) || 'USD';
  const { kg, air, assumedLines } = quote(options && options.lineItems);

  if (assumedLines > 0) {
    // Worth knowing about: a product is live without a weight on it.
    console.warn(
      '[shipping-rates] ' + assumedLines + ' line item(s) had no weight; ' +
      'billed at ' + FALLBACK_WEIGHT_KG + ' kg each. Cart totalled ' +
      kg.toFixed(2) + ' kg.'
    );
  }

  const rates = [];

  // Sea only appears once the cart makes up a consignment. Below that
  // the minimum charge would not be covered by the baked-in price.
  if (seaAvailable(kg)) {
    rates.push({
      code: 'sea-included',
      title: SEA_TITLE,
      logistics: { deliveryTime: SEA_TIME },
      cost: { price: '0.00', currency }
    });
  }

  rates.push({
    code: 'air-upgrade',
    title: AIR_TITLE,
    logistics: { deliveryTime: AIR_TIME },
    cost: { price: air.toFixed(2), currency }
  });

  return { shippingRates: rates };
};
