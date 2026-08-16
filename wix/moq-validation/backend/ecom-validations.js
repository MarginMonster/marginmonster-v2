/* ------------------------------------------------------------------
 * Magic Monster Wholesale — cart & checkout validation
 *
 * Blocks checkout unless every line item is ordered by the case:
 *   quantity must equal that SKU's MOQ, or a whole multiple of it.
 *   e.g. MOQ 120  ->  120, 240, 360 OK.  1, 50, 130 blocked.
 *
 * Also enforces a minimum number of distinct products per order.
 *
 * Products with no MOQ on file are handled by UNKNOWN_SKU_POLICY below.
 * ------------------------------------------------------------------ */

import { moqForSku } from 'backend/moq-data.js';

/* ==================== SETTINGS — edit these ==================== */

// Minimum number of DIFFERENT products in one order. Set to 0 to switch off.
const MIN_DISTINCT_PRODUCTS = 3;

// true  = quantity must be an exact multiple of the MOQ (120, 240, 360)
// false = quantity only has to reach the MOQ (121, 155 also allowed)
const REQUIRE_WHOLE_CASES = true;

// What to do with a product whose SKU is not listed in moq-data.js.
//   'allow' = no case minimum; sells in any quantity  <-- toys rely on this
//   'block' = refuse checkout and name the item
// Pokemon, Smiski and the rest of the toys carry no per-SKU MOQ: they are held
// to the MIN_DISTINCT_PRODUCTS rule below and nothing else. Switching this to
// 'block' would stop every one of them at the cart.
// Trade-off: a COSTUME added later without a row in moq-data.js will likewise
// sell in ones, with no warning. Add the MOQ row when you add the product.
const UNKNOWN_SKU_POLICY = 'allow';

// Should the "3 different products" rule count only MOQ-managed items?
//   false = every product counts, toys included  <-- required for the toys
//   true  = only products listed in moq-data.js count
const MIN_DISTINCT_COUNTS_ONLY_MOQ_ITEMS = false;

/* =============================================================== */

const OTHER_TARGET = { other: { name: 'OTHER_DEFAULT' } };

function violation(description) {
  return { severity: 'ERROR', target: OTHER_TARGET, description };
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

  /* --- 2. minimum distinct products ------------------------------- */
  if (MIN_DISTINCT_PRODUCTS > 0) {
    const counted = MIN_DISTINCT_COUNTS_ONLY_MOQ_ITEMS
      ? lineItems.filter((item) => moqForSku(skuOf(item)))
      : lineItems;

    const distinct = new Set(
      counted
        .map(
          (item) =>
            (item.catalogReference && item.catalogReference.catalogItemId) || item.id
        )
        .filter(Boolean)
    );

    if (distinct.size < MIN_DISTINCT_PRODUCTS) {
      violations.push(
        violation(
          `Wholesale orders need at least ${MIN_DISTINCT_PRODUCTS} different products. You have ${distinct.size}.`
        )
      );
    }
  }

  return violations;
}
