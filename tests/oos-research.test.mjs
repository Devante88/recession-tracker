import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitByDate, statsAtCutoff, optimizeCutoff, rocAuc, outOfSampleStudy
} from '../src/oos-research.mjs';
import { inRecession } from '../src/backtest-eval.mjs';

// Build a synthetic 1988–2023 monthly backtest where the composite is high
// during NBER recessions and low otherwise, with a little noise.
function syntheticHistory({ recHigh = 75, expLow = 15, noise = 0 } = {}) {
  const entries = [];
  for (let y = 1988; y <= 2023; y++) {
    for (let m = 1; m <= 12; m++) {
      const date = `${y}-${String(m).padStart(2, '0')}-28`;
      const rec = inRecession(date);
      const base = rec ? recHigh : expLow;
      const wobble = noise ? ((y * 12 + m) % 7 - 3) * noise : 0;
      entries.push({ date, composite: base + wobble, alert: 'NA' });
    }
  }
  return entries;
}

test('splitByDate partitions train/test at the cutoff', () => {
  const { train, test } = splitByDate(syntheticHistory(), '2005-01');
  assert.ok(train.length > 0 && test.length > 0);
  assert.ok(train.every(r => r.m < '2005-01'));
  assert.ok(test.every(r => r.m >= '2005-01'));
  // Train should hold 1990-91 + 2001; test should hold 2007-09 + 2020.
  assert.ok(train.some(r => r.recession));
  assert.ok(test.some(r => r.recession));
});

test('statsAtCutoff computes a confusion matrix', () => {
  const rows = splitByDate(syntheticHistory(), '2005-01').train;
  const s = statsAtCutoff(rows, 50);
  assert.equal(s.confusion.tp + s.confusion.fn, rows.filter(r => r.recession).length);
  assert.ok(s.hit_rate >= 0 && s.hit_rate <= 1);
});

test('separable data yields AUC near 1', () => {
  const rows = splitByDate(syntheticHistory(), '2005-01').train;
  assert.ok(rocAuc(rows) > 0.99);
});

test('optimizeCutoff finds a separating threshold on clean data', () => {
  const rows = splitByDate(syntheticHistory(), '2005-01').train;
  const best = optimizeCutoff(rows, { fprBudget: 1 });
  assert.ok(best.cutoff > 15 && best.cutoff <= 75);
  assert.equal(best.hit_rate, 1);
  assert.equal(best.false_positive_rate, 0);
});

test('FPR budget constrains the chosen cutoff', () => {
  const rows = splitByDate(syntheticHistory({ noise: 4 }), '2005-01').train;
  const lax    = optimizeCutoff(rows, { fprBudget: 1 });
  const strict = optimizeCutoff(rows, { fprBudget: 0 });
  if (strict) assert.ok(strict.false_positive_rate <= lax.false_positive_rate + 1e-9);
});

test('outOfSampleStudy generalizes on clean separable data', () => {
  const study = outOfSampleStudy(syntheticHistory(), { cutoff: '2005-01' });
  assert.equal(study.valid, true);
  assert.ok(study.train_recession_months > 0 && study.test_recession_months > 0);
  assert.ok(study.auc.train > 0.99 && study.auc.test > 0.99);
  // Thresholds learned on train should still classify test recessions perfectly.
  assert.equal(study.red.test.hit_rate, 1);
  assert.equal(Math.abs(study.red.generalization_gap) < 0.05, true);
});

test('outOfSampleStudy reports invalid when a side lacks recessions', () => {
  // Cutoff in the future → test window has no recession months.
  const study = outOfSampleStudy(syntheticHistory(), { cutoff: '2025-01' });
  assert.equal(study.valid, false);
});
