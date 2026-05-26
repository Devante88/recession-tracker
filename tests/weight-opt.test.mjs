import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compositeFromLayers, aucForWeights, optimizeLayerWeights, weightStudy
} from '../src/weight-opt.mjs';
import { inRecession } from '../src/backtest-eval.mjs';

const BASE = { financial_lead: 0.27, labor: 0.22, inflation: 0.14, real_economy: 0.18, micro: 0.09, global: 0.10 };

test('compositeFromLayers is a renormalized weighted average', () => {
  const c = compositeFromLayers({ a: 100, b: 0 }, { a: 1, b: 1 });
  assert.equal(c, 50);
});

// Synthetic 1988–2023: ONLY the labor layer carries the recession signal;
// the others are noise. A good optimizer should upweight labor.
function syntheticByLayer() {
  const out = [];
  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 1988; y <= 2023; y++) for (let m = 1; m <= 12; m++) {
    const date = `${y}-${String(m).padStart(2, '0')}-28`;
    const rec = inRecession(date);
    out.push({ date, layers: {
      financial_lead: 40 + rnd() * 20,
      labor: rec ? 58 + rnd() * 22 : 38 + rnd() * 22,  // the real signal, but overlapping
      inflation: 40 + rnd() * 20,
      real_economy: 45 + rnd() * 20,
      micro: 40 + rnd() * 20,
      global: 45 + rnd() * 20
    }});
  }
  return out;
}

test('aucForWeights rewards weighting the predictive layer', () => {
  const rows = syntheticByLayer().map(e => ({ layers: e.layers, recession: inRecession(e.date) }));
  const laborHeavy = aucForWeights(rows, { ...BASE, labor: 0.8 });
  const laborLight = aucForWeights(rows, { ...BASE, labor: 0.02 });
  assert.ok(laborHeavy > laborLight);
});

test('optimizeLayerWeights improves train AUC and upweights labor', () => {
  const rows = syntheticByLayer().map(e => ({ layers: e.layers, recession: inRecession(e.date) }));
  const baseAuc = aucForWeights(rows, BASE);
  const opt = optimizeLayerWeights(rows, { base: BASE });
  assert.ok(opt.auc >= baseAuc);
  assert.ok(opt.weights.labor > BASE.labor);
});

test('weightStudy returns a verdict and generalizes on clean data', () => {
  const study = weightStudy(syntheticByLayer(), { base: BASE, cutoff: '2005-01' });
  assert.equal(study.valid, true);
  assert.ok(['tuning-helps-out-of-sample', 'no-material-difference-doctrinal-is-fine'].includes(study.verdict));
  assert.ok(study.optimized.test_auc >= study.doctrinal.test_auc - 0.05);
});

test('weightStudy invalid when a split side lacks recessions', () => {
  const study = weightStudy(syntheticByLayer(), { base: BASE, cutoff: '2030-01' });
  assert.equal(study.valid, false);
});
