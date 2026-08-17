/* ------------------------------------------------------------------
 * Magic Monster Wholesale — product page
 * Adds a "BUY FULL CASE" button that puts the whole MOQ in the cart
 * in one click, with the chosen size split attached.
 *
 * Put this in the PRODUCT PAGE's code panel (not masterPage.js).
 * Requires one button on the page with the ID:  buyCaseButton
 * and one text element with the ID:             caseNote      (optional)
 *
 * Requires backend/moq.web.js to exist (ships with the MOQ plugin).
 * ------------------------------------------------------------------ */

import { cart } from 'wix-stores-frontend';
import { getMoq } from 'backend/moq.web.js';

let product = null;
let moq = 0;

$w.onReady(async function () {
  product = await resolveProduct();
  if (!product) {
    console.error('[MM] could not resolve the product on this page');
    safeHide('#buyCaseButton');
    safeHide('#caseNote');
    return;
  }

  const sku = product.sku || '';
  // getMoq is a web module call, so it MUST be awaited. Reading a plain
  // backend .js file from page code does not work in Velo.
  moq = sku ? await getMoq(sku) : 0;

  // No MOQ on file (the Pokemon / toy range) — no case button.
  if (!moq) {
    safeHide('#buyCaseButton');
    safeHide('#caseNote');
    return;
  }

  setText('#caseNote', caseNoteText(product, moq));
  setLabel('#buyCaseButton', `BUY FULL CASE — ${moq} PCS`);

  $w('#buyCaseButton').onClick(async () => {
    $w('#buyCaseButton').disable();
    try {
      await cart.addProducts([{
        productId: product._id,
        quantity: moq,
        // carries the size-split choice through to the order
        customTextFields: readSizeSplit()
      }]);
      setText('#caseNote', `${moq} pcs added to your cart.`);
    } catch (e) {
      setText('#caseNote', 'Could not add to cart — please try again.');
      console.error('[MM] addProducts failed', e);
    } finally {
      $w('#buyCaseButton').enable();
    }
  });
});

/* ------------------------------------------------------- shipping note
 * Shows what the case weighs and what that means for shipping, so the
 * buyer can see it on the product page rather than discovering it at
 * checkout. Keep SEA_MIN_KG and AIR_RATE_PER_KG in step with
 * ecom-shipping-rates.js.
 */
const SEA_MIN_KG = 12;
const AIR_RATE_PER_KG = 9.09;

function caseNoteText(prod, qty) {
  const base = `Sold by the case — ${qty} pcs minimum.`;

  const kg = Number(prod && prod.weight);
  if (!Number.isFinite(kg) || kg <= 0) return base;

  const cases = Math.ceil(SEA_MIN_KG / kg);
  const air = Math.max(8, Math.ceil(kg * AIR_RATE_PER_KG * 100) / 100);

  return (
    `${base} About ${kg.toFixed(1)} kg per case. ` +
    `Sea freight is free and already in the price — orders reach the ` +
    `${SEA_MIN_KG} kg sea minimum at ${cases} case${cases === 1 ? '' : 's'}. ` +
    `Air freight is optional, about $${air.toFixed(2)} for this case.`
  );
}

/* The product object is exposed differently depending on how the page was
   built, so try the known shapes in order rather than assuming one. */
async function resolveProduct() {
  // 1. the product widget, when the page uses one
  try {
    const el = $w('#productPage1');
    if (el && el.getProduct) {
      const p = await el.getProduct();
      if (p) return p;
    }
  } catch (e) { /* no product widget on this page build */ }

  // 2. router data, when the page is a dynamic store page
  try {
    const wixWindow = await import('wix-window');
    const data = await (wixWindow.default || wixWindow).getRouterData();
    if (data && data.product) return data.product;
  } catch (e) { /* not a router page */ }

  return null;
}

/* Reads whatever the shopper picked in the "Size split" modifier. */
function readSizeSplit() {
  try {
    const el = $w('#productPage1');
    const mods = el && el.getSelectedModifiers ? el.getSelectedModifiers() : null;
    if (mods && mods.length) {
      return [{ title: 'Size split', value: String(mods[0].value || mods[0].choice) }];
    }
  } catch (e) { /* no modifier element on this page build */ }
  return [];
}

function safeHide(id)   { try { $w(id).hide(); }     catch (e) {} }
function setText(id, t) { try { $w(id).text = t; }   catch (e) {} }
function setLabel(id,t) { try { $w(id).label = t; }  catch (e) {} }
