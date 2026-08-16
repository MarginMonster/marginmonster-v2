/* ------------------------------------------------------------------
 * Magic Monster Wholesale — web module
 *
 * WHY THIS FILE EXISTS
 * Velo page code (frontend) cannot import a plain backend .js file.
 * `import { moqForSku } from 'backend/moq-data.js'` inside product-page.js
 * fails at runtime — the button's label stays blank and nothing happens
 * on click.
 *
 * Only WEB MODULES (.web.js / .jsw) are callable from the frontend, and
 * every exported function must be async and awaited by the caller.
 *
 * So the page imports getMoq() from HERE, and this file reads the same
 * shared moq-data.js the validation plugin uses. One table, both features.
 * ------------------------------------------------------------------ */

import { Permissions, webMethod } from 'wix-web-module';
import { moqForSku } from 'backend/moq-data.js';

// Anyone browsing the site must be able to read a MOQ — it is printed on
// the listing anyway, so this is public by design.
export const getMoq = webMethod(Permissions.Anyone, async (sku) => {
  return moqForSku(sku);
});
