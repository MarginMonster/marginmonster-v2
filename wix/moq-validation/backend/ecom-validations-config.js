/* ------------------------------------------------------------------
 * Magic Monster Wholesale — validations service plugin CONFIG
 *
 * This is the file Wix creates alongside ecom-validations.js. Its name
 * follows the plugin name you typed in the editor, with "-config" added:
 *   plugin named "ecom-validations"  ->  ecom-validations-config.js
 *
 * validateInCart: true makes the rules run in the CART as well as at
 * checkout. Without it the buyer is only stopped at checkout, after they
 * have already filled in their address.
 *
 * Wix calls getConfig() when the site is PUBLISHED. Editing this file does
 * nothing until you publish again.
 * ------------------------------------------------------------------ */

export function getConfig() {
  return {
    validateInCart: true
  };
}
