/* ------------------------------------------------------------------
 * Magic Monster Wholesale — cart & checkout validation
 *
 * Blocks checkout unless every line item is ordered by the case:
 *   quantity must equal that SKU's MOQ, or a whole multiple of it.
 *   e.g. MOQ 120  ->  120, 240, 360 OK.  1, 50, 130 blocked.
 *
 * Also enforces a minimum number of pieces per order. That floor counts
 * pieces, not distinct products — three of the same item clears it.
 *
 * Products with no MOQ on file are handled by UNKNOWN_SKU_POLICY below.
 * ------------------------------------------------------------------ */

import { moqForSku } from 'backend/moq-data.js';

/* ==================== SETTINGS — edit these ==================== */

// Minimum number of pieces in one order, counted across the whole cart.
// Three of the SAME product satisfies this — they do not have to be
// different products. Set to 0 to switch off.
const MIN_TOTAL_UNITS = 3;

// true  = quantity must be an exact multiple of the MOQ (120, 240, 360)
// false = quantity only has to reach the MOQ (121, 155 also allowed)
const REQUIRE_WHOLE_CASES = true;

// What to do with a product whose SKU is not listed in moq-data.js.
//   'allow' = no case minimum; sells in any quantity  <-- toys rely on this
//   'block' = refuse checkout and name the item
// Pokemon, Smiski and the rest of the toys carry no per-SKU MOQ: they are held
// to the MIN_TOTAL_UNITS floor below and nothing else. Switching this to
// 'block' would stop every one of them at the cart.
// Trade-off: a COSTUME added later without a row in moq-data.js will likewise
// sell in ones, with no warning. Add the MOQ row when you add the product.
const UNKNOWN_SKU_POLICY = 'allow';

// Should the minimum-pieces rule count only MOQ-managed items?
//   false = every product counts, toys included  <-- required for the toys
//   true  = only products listed in moq-data.js count
const MIN_UNITS_COUNTS_ONLY_MOQ_ITEMS = false;

/* --- shipping notice -------------------------------------------------
 * Sea freight is free but needs a minimum consignment. Without a notice
 * the sea option simply vanishes from checkout with no explanation, so
 * the cart tells the buyer how far short they are.
 *
 * KEEP THESE THREE IN SYNC with ecom-shipping-rates.js. They are copied
 * rather than imported on purpose: an import that fails to resolve takes
 * the whole checkout down, and these two plugins are installed
 * separately.
 */
const SEA_MIN_KG = 12;            // == SEA_MIN_KG
const FALLBACK_WEIGHT_KG = 1.2;   // == FALLBACK_WEIGHT_KG
const AIR_RATE_PER_KG = 9.09;     // == RATE_PER_KG

// Set to false to stop showing the sea-minimum notice in the cart.
const SHOW_SHIPPING_NOTICE = true;

/* =============================================================== */

const OTHER_TARGET = { other: { name: 'OTHER_DEFAULT' } };

function violation(description) {
  return { severity: 'ERROR', target: OTHER_TARGET, description };
}

// WARNING is shown to the buyer but does not stop them checking out.
function notice(description) {
  return { severity: 'WARNING', target: OTHER_TARGET, description };
}

function weightOf(item) {
  const w = Number(item && item.physicalProperties && item.physicalProperties.weight);
  return Number.isFinite(w) && w > 0 ? w : FALLBACK_WEIGHT_KG;
}

function skuOf(item) {
  const sku = item && item.physicalProperties && item.physicalProperties.sku;
  return String(sku || '').trim().toUpperCase();
}

function nameOf(item, fallback) {
  const name = item && item.productName;
  return (name && (name.original || name.translated)) || fallback || 'Item';
}

// Digital / gift-card lines carry no physical stock, so no case rule applies.
function isPhysical(item) {
  const preset = item && item.itemType && item.itemType.preset;
  return !preset || preset === 'PHYSICAL';
}

export function getValidationViolations(options) {
  // Never let a bug in here take the whole store's checkout down: if
  // something unexpected happens, log it and let the order through.
  try {
    return Promise.resolve({ violations: collectViolations(options) });
  } catch (err) {
    console.error('[MOQ] validation error — allowing checkout:', err);
    return Promise.resolve({ violations: [] });
  }
}

function collectViolations(options) {
  const violations = [];

  const info = (options && options.validationInfo) || {};
  const lineItems = info.lineItems || [];

  if (lineItems.length === 0) {
    return violations;
  }

  /* --- 1. per-SKU MOQ ---------------------------------------------
   * Quantities are totalled per SKU first. If the same SKU appears on
   * two lines (60 + 60 against a MOQ of 120) that is a valid case, and
   * checking each line on its own would wrongly reject it.
   */
  const totals = new Map();
  const unknown = [];

  for (const item of lineItems) {
    if (!isPhysical(item)) continue;

    const sku = skuOf(item);
    const moq = moqForSku(sku);

    if (!moq) {
      if (sku && UNKNOWN_SKU_POLICY === 'block') {
        unknown.push(`"${nameOf(item, sku)}" (${sku})`);
      }
      continue;
    }

    const entry = totals.get(sku) || { moq, quantity: 0, name: nameOf(item, sku) };
    entry.quantity += Number(item.quantity) || 0;
    totals.set(sku, entry);
  }

  totals.forEach((entry) => {
    const { name, moq, quantity } = entry;

    if (quantity < moq) {
      violations.push(
        violation(
          `"${name}" — minimum order is ${moq} pcs, you have ${quantity}. Add ${moq - quantity} more.`
        )
      );
    } else if (REQUIRE_WHOLE_CASES && quantity % moq !== 0) {
      const down = Math.floor(quantity / moq) * moq;
      const up = down + moq;
      violations.push(
        violation(
          `"${name}" — must be ordered in full cases of ${moq}. Change ${quantity} to ${down} or ${up}.`
        )
      );
    }
  });

  if (unknown.length > 0) {
    violations.push(
      violation(
        'These items have no minimum order quantity on file and cannot be ordered online yet: ' +
          unknown.join(', ') +
          '. Please contact us to order them.'
      )
    );
  }

  /* --- 2. minimum pieces per order ---------------------------------
   * Counts total pieces, not distinct products. Three of the same
   * product clears the floor; they do not have to be different items.
   */
  if (MIN_TOTAL_UNITS > 0) {
    const counted = MIN_UNITS_COUNTS_ONLY_MOQ_ITEMS
      ? lineItems.filter((item) => moqForSku(skuOf(item)))
      : lineItems.filter(isPhysical);

    const units = counted.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0),
      0
    );

    if (units < MIN_TOTAL_UNITS) {
      violations.push(
        violation(
          `Wholesale orders start at ${MIN_TOTAL_UNITS} pieces. You have ${units}. ` +
            `They can all be the same product — add ${MIN_TOTAL_UNITS - units} more.`
        )
      );
    }
  }

  /* --- 3. shipping notice ------------------------------------------
   * Not a blocker. Tells the buyer what their order weighs, which
   * shipping they qualify for, and what the air upgrade would cost.
   */
  if (SHOW_SHIPPING_NOTICE && SEA_MIN_KG > 0) {
    const kg = lineItems
      .filter(isPhysical)
      .reduce((sum, item) => sum + weightOf(item) * (Number(item.quantity) || 0), 0);

    if (kg > 0) {
      const air = Math.max(8, Math.ceil(kg * AIR_RATE_PER_KG * 100) / 100);

      // Only speak up when there is something to act on. A cart that
      // already qualifies for sea gets its weight and both prices from
      // the shipping options at checkout; repeating it here would put a
      // warning banner on a perfectly healthy order.
      if (kg < SEA_MIN_KG) {
        const short = SEA_MIN_KG - kg;
        violations.push(
          notice(
            `Your order weighs about ${kg.toFixed(1)} kg. Free sea freight needs ` +
              `${SEA_MIN_KG} kg — add about ${short.toFixed(1)} kg more to qualify. ` +
              `Below that, air freight is the only option at $${air.toFixed(2)}.`
          )
        );
      }
    }
  }

  return violations;
}
