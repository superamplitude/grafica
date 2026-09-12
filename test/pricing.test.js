import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice, roundPrice } from '../src/domain/pricing.js';

test('roundPrice keeps Central Prints ending_90 behavior', () => {
  assert.equal(roundPrice(49.10, 'ending_90'), 49.90);
  assert.equal(roundPrice(49.95, 'ending_90'), 50.90);
});

test('markup percentage uses supplier plus additional cost', () => {
  const result = calculatePrice(
    { supplier_cost: 100, additional_cost: 20 },
    { calculation_method: 'markup_percentage', calculation_value: 50, rounding_rule: 'none' }
  );
  assert.equal(result.real_cost, 120);
  assert.equal(result.price, 180);
});

test('real margin percentage reproduces the legacy formula', () => {
  const result = calculatePrice(
    { supplier_cost: 65, additional_cost: 0 },
    { calculation_method: 'real_margin_percentage', calculation_value: 35, rounding_rule: 'none' }
  );
  assert.equal(result.price, 100);
  assert.equal(result.margin, 35);
});

test('minimum margin prevents underpricing', () => {
  const result = calculatePrice(
    { supplier_cost: 80, additional_cost: 0 },
    { calculation_method: 'fixed_addition', calculation_value: 1, minimum_margin: 20, rounding_rule: 'none' }
  );
  assert.equal(result.price, 100);
  assert.equal(result.margin, 20);
});

test('manual price can never fall below real cost', () => {
  const result = calculatePrice(
    { supplier_cost: 80, additional_cost: 20 },
    { calculation_method: 'manual_price', calculation_value: 50, rounding_rule: 'none' }
  );
  assert.equal(result.price, 100);
});
