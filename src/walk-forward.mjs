// Walk-forward validation + block-bootstrap confidence intervals. Pure functions.
//
// A single fixed train/test split (oos-research.mjs) holds out only the post-2005
// recessions and gives a point estimate with no uncertainty. This module closes
// both gaps:
//
//  1. Walk-forward (expanding window): repeatedly train on all data before an
//     origin, optimize the RED cutoff there, and score the next test window —
//     rolling the origin forward. Every recession ends up held out in some fold,
//     and we get a DISTRIBUTION of out-of-sample skill rather than one number.
//
//  2. Moving-block bootstrap: resample the month series in blocks (preserving
//     autocorrelation) to put a 95% confidence interval on ROC AUC. With only a
//     handful of recessions the honest answer is an interval, not a point.

import { rocAuc, statsAtCutoff, optimizeCutoff } from './oos-research.mjs';
import { inRecession } from './backtest-eval.mjs';

const ym = d => (d || '').slice(0, 7);

function addMonths(yyyymm, months) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
}

function toRows(entries) {
  return (entries || [])
    .filter(e => e && e.date && typeof e.composite === 'number')
    .map(e => ({ m: ym(e.date), composite: e.composite, recession: inRecession(e.date) }))
    .sort((a, b) => a.m.localeCompare(b.m));
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] : null;
const round = (x, d = 3) => x == null ? null : Number(x.toFixed(d));

/**
 * Expanding-window walk-forward. Returns per-fold out-of-sample stats and an
 * aggregate summary (mean test AUC, mean Youden J, fold count).
 */
export function walkForward(entries, { minTrainMonths = 120, stepMonths = 24, testMonths = 60 } = {}) {
  const rows = toRows(entries);
  if (rows.length < minTrainMonths + 12) return { valid: false, reason: 'not enough history for walk-forward', folds: [] };

  const first = rows[0].m, last = rows[rows.length - 1].m;
  const folds = [];
  for (let origin = addMonths(first, minTrainMonths); origin <= addMonths(last, -testMonths); origin = addMonths(origin, stepMonths)) {
    const train = rows.filter(r => r.m < origin);
    const test  = rows.filter(r => r.m >= origin && r.m < addMonths(origin, testMonths));
    const trainPos = train.filter(r => r.recession).length;
    const testPos  = test.filter(r => r.recession).length;
    if (!trainPos || !testPos) continue;

    const red = optimizeCutoff(train, { fprBudget: 1 });
    if (!red) continue;
    const ts = statsAtCutoff(test, red.cutoff);
    folds.push({
      origin,
      train_months: train.length,
      test_months: test.length,
      test_recession_months: testPos,
      cutoff: red.cutoff,
      test_auc: rocAuc(test),
      test_hit_rate: round(ts.hit_rate),
      test_fpr: round(ts.false_positive_rate),
      test_youden_j: round(ts.youden_j)
    });
  }

  if (!folds.length) return { valid: false, reason: 'no folds had recessions on both sides', folds: [] };

  const aucs = folds.map(f => f.test_auc).filter(x => x != null);
  const js   = folds.map(f => f.test_youden_j).filter(x => x != null);
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  return {
    valid: true,
    params: { minTrainMonths, stepMonths, testMonths },
    folds,
    summary: {
      n_folds: folds.length,
      mean_test_auc: round(mean(aucs)),
      min_test_auc: round(Math.min(...aucs)),
      max_test_auc: round(Math.max(...aucs)),
      mean_test_youden_j: round(mean(js))
    }
  };
}

/**
 * Moving-block bootstrap 95% CI for ROC AUC. Deterministic (seeded PRNG).
 */
export function bootstrapAucCI(entries, { blockLen = 12, iterations = 600, seed = 20260522 } = {}) {
  const rows = toRows(entries);
  if (rows.length < blockLen * 2) return null;
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const n = rows.length;
  const nBlocks = Math.ceil(n / blockLen);
  const aucs = [];
  for (let it = 0; it < iterations; it++) {
    const sample = [];
    for (let b = 0; b < nBlocks; b++) {
      const start = Math.floor(rnd() * (n - blockLen + 1));
      for (let k = 0; k < blockLen; k++) sample.push(rows[start + k]);
    }
    sample.length = n;
    const a = rocAuc(sample);
    if (a != null) aucs.push(a);
  }
  if (!aucs.length) return null;
  aucs.sort((x, y) => x - y);
  const mean = aucs.reduce((x, y) => x + y, 0) / aucs.length;
  return {
    point: round(rocAuc(rows)),
    mean: round(mean),
    ci95: [round(pct(aucs, 0.025)), round(pct(aucs, 0.975))],
    block_len: blockLen,
    iterations: aucs.length
  };
}

// Combined study for the pipeline.
export function robustnessStudy(entries) {
  const wf = walkForward(entries);
  const boot = bootstrapAucCI(entries);
  return { generated_at: new Date().toISOString(), walk_forward: wf, bootstrap_auc: boot };
}
