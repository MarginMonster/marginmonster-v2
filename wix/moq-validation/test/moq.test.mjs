import { getValidationViolations } from './ecom-validations.mjs';

let pass = 0, fail = 0;

function line(sku, quantity, catalogItemId, name) {
  return {
    id: 'li-' + Math.random().toString(16).slice(2),
    itemType: { preset: 'PHYSICAL' },
    physicalProperties: { shippable: true, sku, weight: 1 },
    productName: { original: name || sku },
    catalogReference: { appId: 'stores', catalogItemId: catalogItemId || 'p-' + sku },
    quantity
  };
}

async function check(label, lineItems, expect) {
  const { violations } = await getValidationViolations({ validationInfo: { lineItems } });
  const got = violations.map(v => v.description);
  const ok = expect(got, violations);
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '\n        got: ' + JSON.stringify(got, null, 2)); }
}

const none = g => g.length === 0;
const has = re => g => g.some(d => re.test(d));
const countIs = n => g => g.length === n;

console.log('\n--- MOQ enforcement ---');
// MM-0001 = 60, MM-0002 = 120, MM-0263 = 30, MM-0212 = 200
await check('exact case passes', [line('MM-0001', 60), line('MM-0002', 120), line('MM-0263', 30)], none);
await check('multiples pass', [line('MM-0001', 120), line('MM-0002', 360), line('MM-0263', 90)], none);
await check('below MOQ blocked', [line('MM-0001', 1), line('MM-0002', 120), line('MM-0263', 30)],
  has(/minimum order is 60 pcs, you have 1\. Add 59 more/));
await check('part case blocked with both options', [line('MM-0002', 130), line('MM-0001', 60), line('MM-0263', 30)],
  has(/full cases of 120\. Change 130 to 120 or 240/));

console.log('\n--- the split-line bug (60 + 60 vs MOQ 120) ---');
await check('same SKU across two lines is summed', [line('MM-0002', 60), line('MM-0002', 60), line('MM-0001', 60), line('MM-0263', 30)], none);
await check('summed total still short is caught', [line('MM-0002', 50), line('MM-0002', 50), line('MM-0001', 60), line('MM-0263', 30)],
  has(/minimum order is 120 pcs, you have 100/));

console.log('\n--- unlisted SKUs (TCG) pass through ---');
await check('unknown SKU ignored', [line('TCG-POKE-01', 3), line('MM-0001', 60), line('MM-0002', 120)], none);

console.log('\n--- minimum distinct products ---');
await check('two products blocked', [line('MM-0001', 60), line('MM-0002', 120)],
  has(/at least 3 different products\. You have 2/));
await check('same product twice is still one product',
  [line('MM-0002', 60, 'p-A'), line('MM-0002', 60, 'p-A'), line('MM-0001', 60, 'p-B')],
  has(/You have 2/));

console.log('\n--- edge cases ---');
await check('empty cart is silent', [], none);
await check('missing physicalProperties does not throw',
  [{ id: 'x', quantity: 5, productName: { original: 'Odd' }, catalogReference: { catalogItemId: 'p-x' } },
   line('MM-0001', 60), line('MM-0002', 120)], none);
await check('digital item skipped',
  [{ id: 'd', itemType: { preset: 'DIGITAL' }, quantity: 1, physicalProperties: { sku: 'MM-0002' },
     productName: { original: 'Digital' }, catalogReference: { catalogItemId: 'p-d' } },
   line('MM-0001', 60), line('MM-0002', 120), line('MM-0263', 30)], none);
await check('lowercase / padded SKU still matches',
  [line('  mm-0001  ', 1), line('MM-0002', 120), line('MM-0263', 30)],
  has(/minimum order is 60 pcs, you have 1/));
await check('one violation per offending SKU',
  [line('MM-0001', 1), line('MM-0002', 5), line('MM-0263', 7)], countIs(3));

console.log('\n--- violation shape matches the Wix contract ---');
{
  const { violations } = await getValidationViolations({ validationInfo: { lineItems: [line('MM-0001', 1)] } });
  const v = violations[0];
  const shapeOk = v.severity === 'ERROR' && v.target && v.target.other &&
                  v.target.other.name === 'OTHER_DEFAULT' && typeof v.description === 'string';
  if (shapeOk) { pass++; console.log('  PASS  severity/target/description'); }
  else { fail++; console.log('  FAIL  shape: ' + JSON.stringify(v)); }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
