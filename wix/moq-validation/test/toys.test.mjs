import { getValidationViolations } from './ecom-validations.mjs';

const item = (sku, quantity, id) => ({
  id: 'li-' + (id || sku), itemType: { preset: 'PHYSICAL' },
  physicalProperties: { sku }, productName: { original: sku },
  catalogReference: { catalogItemId: 'p-' + (id || sku) }, quantity
});

let pass = 0, fail = 0;
async function t(label, lineItems, want) {
  const { violations } = await getValidationViolations({ validationInfo: { lineItems } });
  const d = violations.map(v => v.description);
  const ok = want(d);
  ok ? (pass++, console.log('  PASS  ' + label))
     : (fail++, console.log('  FAIL  ' + label + '\n        ' + JSON.stringify(d, null, 2)));
}
const clean = d => d.length === 0;
const onlyFloor = d => d.length === 1 && /start at 3 pieces/.test(d[0]);
const noMoqMsg = d => !d.some(x => /minimum order is|full cases of/.test(x));

console.log('\n--- toys (Pokemon / Smiski): no per-SKU MOQ, 3-product rule only ---');
await t('3 different toys, qty 1 each -> passes',
  [item('POKE-151-BB', 1), item('SMISKI-HIDE', 1), item('SMISKI-BATH', 1)], clean);
await t('3 toys at odd quantities -> passes (no case rule)',
  [item('POKE-151-BB', 7), item('SMISKI-HIDE', 3), item('SMISKI-BATH', 11)], clean);
await t('1 toy alone -> short of the 3-piece floor',
  [item('POKE-151-BB', 1)], onlyFloor);
// 2 + 5 = 7 pieces. Two products, but the floor counts pieces, so this passes.
await t('2 toys at 7 pieces -> allowed',
  [item('POKE-151-BB', 2), item('SMISKI-HIDE', 5)], clean);
await t('3 of one toy -> allowed',
  [item('POKE-151-BB', 3)], clean);

console.log('\n--- mixed carts ---');
await t('2 toys + 1 costume at full case -> passes',
  [item('POKE-151-BB', 4), item('SMISKI-HIDE', 2), item('MM-0002', 120)], clean);
await t('2 toys + 1 costume short -> only the costume is flagged',
  [item('POKE-151-BB', 4), item('SMISKI-HIDE', 2), item('MM-0002', 30)],
  d => d.length === 1 && /minimum order is 120 pcs, you have 30/.test(d[0]));
await t('toys never trigger a case-quantity message',
  [item('POKE-151-BB', 13), item('SMISKI-HIDE', 1), item('SMISKI-BATH', 99)], noMoqMsg);

console.log('\n--- toys count toward the piece floor ---');
await t('1 costume + 2 toys clears the floor',
  [item('MM-0001', 60), item('POKE-151-BB', 1), item('SMISKI-HIDE', 1)], clean);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
