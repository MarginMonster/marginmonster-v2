import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  quote, airPrice, cartWeight, unitWeight, getShippingRates,
  RATE_PER_KG, MIN_CHARGE, FALLBACK_WEIGHT_KG, SEA_MIN_KG, seaAvailable
} from './.tmp/ecom-shipping-rates.mjs';

const item = (weight, quantity = 1) => ({ quantity, physicalProperties: { weight } });

test('order 10008 prices off real weight, not the bottom band', () => {
  // 3 x Eevee plush case (1.39) + Funism palmsize V2 (2.53) + suitcase set (4.23)
  const cart = [item(1.39, 3), item(2.53), item(4.23)];
  const q = quote(cart);
  assert.equal(q.kg.toFixed(2), '10.93');
  assert.equal(q.assumedLines, 0);
  // banded table charged $185 for this cart; it was billed $25
  assert.equal(q.air.toFixed(2), '99.36');
});

test('sea is free once offered', () => {
  assert.equal(quote([item(50)]).sea, 0);
  assert.equal(quote([]).sea, null);
});

test('price tracks the rate exactly, no band snapping', () => {
  // two carts either side of the old 10-20 band both paid $185
  const low = quote([item(10.1)]).air;
  const high = quote([item(19.9)]).air;
  assert.equal(low.toFixed(2), (10.1 * RATE_PER_KG).toFixed(2));
  assert.ok(high > low * 1.9, 'a 2x heavier cart should cost about 2x');
});

test('never quotes below cost', () => {
  for (let kg = 1; kg <= 400; kg += 0.5) {
    assert.ok(airPrice(kg) >= kg * RATE_PER_KG, 'under cost at ' + kg + ' kg');
  }
});

test('minimum charge floors tiny carts', () => {
  assert.equal(airPrice(0.05), MIN_CHARGE);
  assert.equal(airPrice(0.3), MIN_CHARGE);
  // above the crossover the rate takes over
  assert.ok(airPrice(2) > MIN_CHARGE);
});

test('a weightless line is billed, never free', () => {
  const q = quote([{ quantity: 4 }]);
  assert.equal(q.assumedLines, 1);
  assert.equal(q.kg, FALLBACK_WEIGHT_KG * 4);
  assert.ok(q.air > MIN_CHARGE);
});

test('an empty cart still cannot ship for nothing', () => {
  assert.equal(quote([]).air, MIN_CHARGE);
  assert.equal(quote(undefined).air, MIN_CHARGE);
});

test('zero and junk weights fall back rather than counting as free', () => {
  assert.equal(unitWeight(item(0)).assumed, true);
  assert.equal(unitWeight(item(null)).assumed, true);
  assert.equal(unitWeight(item('abc')).assumed, true);
  assert.equal(unitWeight(item(-3)).assumed, true);
  assert.equal(unitWeight(item('2.5')).kg, 2.5, 'numeric strings are real weights');
});

test('missing quantity counts as one unit', () => {
  assert.equal(cartWeight([{ physicalProperties: { weight: 2 } }]).kg, 2);
});

test('mixed cart adds real and assumed weight together', () => {
  const q = cartWeight([item(2, 2), { quantity: 1 }]);
  assert.equal(q.kg, 4 + FALLBACK_WEIGHT_KG);
  assert.equal(q.assumedLines, 1);
});

test('sea is withheld until the cart makes a consignment', () => {
  assert.equal(seaAvailable(0.5), false);
  assert.equal(seaAvailable(11.99), false);
  assert.equal(seaAvailable(SEA_MIN_KG), true);
  assert.equal(seaAvailable(40), true);
});

test('a light cart is quoted air only', () => {
  const q = quote([item(1.39, 3)]);        // 4.17 kg
  assert.equal(q.sea, null);
  assert.ok(q.air > 0);
});

test('order 10008 falls short of the sea minimum', () => {
  // 10.93 kg against a 12 kg consignment minimum, so sea is not offered.
  // Adding one more Eevee case (1.39) takes it over.
  assert.equal(quote([item(1.39, 3), item(2.53), item(4.23)]).sea, null);
  assert.equal(quote([item(1.39, 4), item(2.53), item(4.23)]).sea, 0);
});

test('the buyer is shown the weight and the arithmetic', () => {
  const out = getShippingRates({ currency: 'USD', lineItems: [item(1.39, 3), item(2.53), item(4.23)] });
  const air = out.shippingRates.find(r => r.code === 'air-upgrade');
  assert.match(air.logistics.deliveryTime, /10\.9 kg/);
  assert.match(air.logistics.deliveryTime, /\$9\.09\/kg/);
  // the figure quoted in the text must equal the figure charged
  assert.match(air.logistics.deliveryTime, new RegExp('= \\$' + air.cost.price));
});

test('a qualifying cart is told it qualifies', () => {
  const out = getShippingRates({ currency: 'USD', lineItems: [item(20)] });
  const sea = out.shippingRates.find(r => r.code === 'sea-included');
  assert.equal(sea.cost.price, '0.00');
  assert.match(sea.logistics.deliveryTime, /qualifies for sea/);
  assert.match(sea.logistics.deliveryTime, /12 kg minimum/);
});

test('a light cart returns air only, never an empty list', () => {
  const out = getShippingRates({ currency: 'USD', lineItems: [item(2)] });
  assert.equal(out.shippingRates.length, 1);
  assert.equal(out.shippingRates[0].code, 'air-upgrade');
});
