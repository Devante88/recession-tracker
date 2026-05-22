// Out-of-sample optimization of the composite LAYER weights. Pure functions.
//
// The alert *cutoffs* are validated out-of-sample in oos-research.mjs, but the
// layer weights themselves are doctrinal. This module asks the honest question:
// if we tune the six layer weights to best separate recessions on the TRAIN
// window, do they still help on the held-out TEST window — or is the doctrinal
// weighting just as good (i.e. tuning would overfit)? We report both and let
// the verdict fall where it lands rather than assuming tuning helps.

import { rocAuc } from './oos-research.mjs';
import { inRecession } from './backtest-eval.mjs';

const ym = d => (d || '').slice(0, 7);

export function compositeFromLayers(layers, weights) {
  let num = 0, den = 0;
  for (const [layer, w] of Object.entries(weights)) {
    const s = layers?.[layer];
    if (typeof s === 'number') { num += s * w; den += w; }
  }
  return den ? num / den : 0;
}

// AUC of a weighting over rows of { layers, recession }.
export function aucForWeights(rows, weights) {
  return rocAuc(rows.map(r => ({ composite: compositeFromLayers(r.layers, weights), recession: r.recession })));
}

function normalize(weights) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (const [k, v] of Object.entries(weights)) out[k] = Number((v / sum).toFixed(4));
  return out;
}

/**
 * Coordinate-ascent search: nudge each layer weight up/down on a grid, keep the
 * change if it improves train AUC, renormalize, repeat. Deterministic.
 */
export function optimizeLayerWeights(rows, { base, step = 0.02, passes = 8, min = 0.02, max = 0.6 } = {}) {
  let weights = normalize({ ...base });
  let bestAuc = aucForWeights(rows, weights);
  const layers = Object.keys(base);

  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (const L of layers) {
      for (const delta of [step, -step]) {
        const cand = normalize({ ...weights, [L]: Math.min(max, Math.max(min, weights[L] + delta)) });
        const auc = aucForWeights(rows, cand);
        if (auc != null && auc > bestAuc + 1e-6) {
          weights = cand; bestAuc = auc; improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { weights, auc: bestAuc };
}

/**
 * Full weight study: optimize on TRAIN, freeze, compare doctrinal vs optimized
 * AUC on the held-out TEST window. Returns valid:false if either side lacks
 * recession coverage.
 */
export function weightStudy(entries, { base, cutoff = '2005-01' } = {}) {
  const rows = (entries || [])
    .filter(e => e && e.date && e.layers)
    .map(e => ({ m: ym(e.date), layers: e.layers, recession: inRecession(e.date) }));
  const train = rows.filter(r => r.m < cutoff);
  const test  = rows.filter(r => r.m >= cutoff);

  const trainPos = train.filter(r => r.recession).length;
  const testPos  = test.filter(r => r.recession).length;
  if (!trainPos || !testPos) {
    return { valid: false, reason: 'insufficient recession coverage on both sides of the split', cutoff };
  }

  const doctrinalTrain = aucForWeights(train, base);
  const doctrinalTest  = aucForWeights(test, base);
  const opt = optimizeLayerWeights(train, { base });
  const optimizedTest = aucForWeights(test, opt.weights);

  const round = x => x == null ? null : Number(x.toFixed(3));
  const testGain = (optimizedTest != null && doctrinalTest != null) ? optimizedTest - doctrinalTest : null;

  return {
    valid: true,
    cutoff,
    doctrinal: { weights: normalize(base), train_auc: round(doctrinalTrain), test_auc: round(doctrinalTest) },
    optimized: { weights: opt.weights, train_auc: round(opt.auc), test_auc: round(optimizedTest) },
    test_auc_gain: round(testGain),
    // Honest verdict: did tuning generalize, overfit, or make no difference?
    verdict: testGain == null ? 'unknown'
      : testGain > 0.02 ? 'tuning-helps-out-of-sample'
      : testGain < -0.02 ? 'tuning-overfits-keep-doctrinal'
      : 'no-material-difference-doctrinal-is-fine'
  };
}
