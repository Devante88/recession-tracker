// Out-of-sample validation. Pure functions, no I/O.
//
// The honest test of a recession model is whether thresholds chosen on past data
// still work on data they never saw. We split the backtest replay at a cutoff,
// optimize the YELLOW/RED composite cutoffs on the TRAIN window only, freeze
// them, and measure skill on the held-out TEST window. A large train→test drop
// in skill = overfitting; a small drop = the signal generalizes.
//
// We also report ROC AUC, a threshold-independent measure of how well the
// composite score separates recession months from expansion months.

import { NBER_RECESSIONS, inRecession } from './backtest-eval.mjs';

const ym = d => (d || '').slice(0, 7);

// Default split: train holds the 1990–91 and 2001 recessions; test holds the
// 2007–09 (GFC) and 2020 (COVID) recessions. Two recessions on each side.
export const DEFAULT_CUTOFF = '2005-01';

export function splitByDate(entries, cutoff = DEFAULT_CUTOFF) {
  const rows = (entries || [])
    .filter(e => e && e.date && typeof e.composite === 'number')
    .map(e => ({ m: ym(e.date), composite: e.composite, recession: inRecession(e.date) }));
  return {
    train: rows.filter(r => r.m < cutoff),
    test:  rows.filter(r => r.m >= cutoff)
  };
}

// Confusion stats for a fixed composite cutoff: flag when composite >= cutoff.
export function statsAtCutoff(rows, cutoff) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of rows) {
    const flagged = r.composite >= cutoff;
    if (r.recession && flagged) tp++;
    else if (r.recession && !flagged) fn++;
    else if (!r.recession && flagged) fp++;
    else tn++;
  }
  const pos = tp + fn, neg = fp + tn;
  return {
    cutoff,
    hit_rate: pos ? tp / pos : null,           // sensitivity / recall
    false_positive_rate: neg ? fp / neg : null, // 1 - specificity
    youden_j: pos && neg ? (tp / pos) - (fp / neg) : null,
    confusion: { tp, fp, tn, fn }
  };
}

/**
 * Pick the composite cutoff that maximizes Youden's J (sensitivity+specificity-1)
 * on the supplied rows, optionally subject to a false-positive-rate budget.
 * Returns the chosen cutoff plus its train-window stats.
 */
export function optimizeCutoff(rows, { fprBudget = 1, min = 5, max = 95, step = 1 } = {}) {
  let best = null;
  for (let c = min; c <= max; c += step) {
    const s = statsAtCutoff(rows, c);
    if (s.hit_rate === null || s.false_positive_rate === null) continue;
    if (s.false_positive_rate > fprBudget) continue;
    if (!best || s.youden_j > best.youden_j ||
        (s.youden_j === best.youden_j && c < best.cutoff)) {
      best = s;
    }
  }
  return best;
}

/**
 * ROC AUC via the Mann–Whitney rank statistic (handles ties with average ranks).
 * 0.5 = no skill, 1.0 = perfect separation. Threshold-independent.
 */
export function rocAuc(rows) {
  const pos = rows.filter(r => r.recession).map(r => r.composite).filter(v => Number.isFinite(v));
  const neg = rows.filter(r => !r.recession).map(r => r.composite).filter(v => Number.isFinite(v));
  if (!pos.length || !neg.length) return null;

  const all = rows.map(r => r.composite).filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b);
  // Average ranks (1-based) for tie handling.
  const rankOf = new Map();
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1] === all[i]) j++;
    const avg = (i + j) / 2 + 1;
    rankOf.set(all[i], avg);
    i = j + 1;
  }
  const sumRanksPos = pos.reduce((a, v) => a + rankOf.get(v), 0);
  const auc = (sumRanksPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
  return Number(auc.toFixed(3));
}

const round = (x, d = 3) => x === null || x === undefined ? null : Number(x.toFixed(d));

function present(stats) {
  if (!stats) return null;
  return {
    cutoff: stats.cutoff,
    hit_rate: round(stats.hit_rate),
    false_positive_rate: round(stats.false_positive_rate),
    youden_j: round(stats.youden_j),
    confusion: stats.confusion
  };
}

/**
 * Full out-of-sample study. Optimizes RED (Youden-optimal) and YELLOW
 * (most sensitive within an FPR budget) cutoffs on TRAIN, freezes them, and
 * reports TRAIN vs TEST skill plus the generalization gap and ROC AUC.
 */
export function outOfSampleStudy(entries, { cutoff = DEFAULT_CUTOFF, yellowFprBudget = 0.30 } = {}) {
  const { train, test } = splitByDate(entries, cutoff);
  const trainPos = train.filter(r => r.recession).length;
  const testPos  = test.filter(r => r.recession).length;

  // Need recession months on both sides for an honest split.
  if (!trainPos || !testPos) {
    return { valid: false, reason: 'insufficient recession coverage on both sides of the split',
             cutoff, train_months: train.length, test_months: test.length,
             train_recession_months: trainPos, test_recession_months: testPos };
  }

  const redTrain    = optimizeCutoff(train, { fprBudget: 1 });
  const yellowTrain = optimizeCutoff(train, { fprBudget: yellowFprBudget });

  const redTest    = redTrain    ? statsAtCutoff(test, redTrain.cutoff)    : null;
  const yellowTest = yellowTrain ? statsAtCutoff(test, yellowTrain.cutoff) : null;

  const gap = (a, b) => (a?.youden_j != null && b?.youden_j != null)
    ? round(a.youden_j - b.youden_j) : null;

  return {
    valid: true,
    cutoff,
    train_months: train.length,
    test_months: test.length,
    train_recession_months: trainPos,
    test_recession_months: testPos,
    auc: { train: rocAuc(train), test: rocAuc(test) },
    red:    { thresholds_from: 'train', train: present(redTrain),    test: present(redTest),    generalization_gap: gap(redTrain, redTest) },
    yellow: { thresholds_from: 'train', train: present(yellowTrain), test: present(yellowTest), generalization_gap: gap(yellowTrain, yellowTest), fpr_budget: yellowFprBudget }
  };
}

export { NBER_RECESSIONS };
