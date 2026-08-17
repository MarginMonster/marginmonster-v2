/* ------------------------------------------------------------------
 * Magic Monster Wholesale — shipping rates service plugin CONFIG
 *
 * Wix creates this file alongside ecom-shipping-rates.js, named after
 * the plugin with "-config" added:
 *   plugin named "ecom-shipping-rates"  ->  ecom-shipping-rates-config.js
 *
 * These two strings are what the shipping provider is called on the
 * dashboard. They are not shown to buyers — the buyer sees the `title`
 * on each rate returned by getShippingRates().
 *
 * Wix calls getConfig() when the site is PUBLISHED. Editing this file
 * does nothing until you publish again.
 * ------------------------------------------------------------------ */

export function getConfig() {
  return {
    name: 'Magic Monster Freight',
    description: 'Sea freight included in the price; air freight priced by cart weight'
  };
}
