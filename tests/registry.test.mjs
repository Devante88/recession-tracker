import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, LAYER_WEIGHTS, validateLayerWeights, validateCompositeWeights, getFredIds, getIndicatorsByLayer } from '../src/registry.mjs';

test('registry has expected layers', () => {
  const layers = new Set(REGISTRY.map(x => x.layer));
  assert.deepEqual([...layers].sort(), ['financial_lead', 'global', 'inflation', 'labor', 'micro', 'real_economy']);
});

test('every indicator has required fields', () => {
  const required = ['name', 'fred_id', 'layer', 'frequency', 'direction', 'weight', 'category', 'description'];
  for (const item of REGISTRY) {
    for (const field of required) {
      assert.ok(item[field] !== undefined, `${item.name} missing ${field}`);
    }
  }
});

test('direction values are valid', () => {
  for (const item of REGISTRY) {
    assert.ok(['direct', 'inverse'].includes(item.direction), `${item.name} has bad direction ${item.direction}`);
  }
});

test('frequency values are valid', () => {
  for (const item of REGISTRY) {
    assert.ok(['daily', 'weekly', 'monthly', 'quarterly'].includes(item.frequency), `${item.name} bad frequency`);
  }
});

test('layer weights sum to 1.0 within each layer', () => {
  const result = validateLayerWeights();
  assert.equal(result.valid, true, `Layer weights invalid: ${JSON.stringify(result.layers)}`);
});

test('LAYER_WEIGHTS sums to 1.0', () => {
  const result = validateCompositeWeights();
  assert.equal(result.ok, true, `Composite weights sum = ${result.sum}`);
});

test('getFredIds returns array of strings', () => {
  const ids = getFredIds();
  assert.ok(Array.isArray(ids));
  assert.ok(ids.every(x => typeof x === 'string'));
});

test('getIndicatorsByLayer filters correctly', () => {
  const labor = getIndicatorsByLayer('labor');
  assert.ok(labor.length > 0);
  assert.ok(labor.every(x => x.layer === 'labor'));
});

test('no duplicate FRED IDs', () => {
  const ids = getFredIds();
  assert.equal(new Set(ids).size, ids.length, 'Duplicate FRED IDs detected');
});
