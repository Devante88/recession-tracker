// Pure scoring functions. No I/O. Heavily tested.
//
// Pipeline:
//   raw FRED series → normalizeIndicator → score in [0, 1]
//   indicators → computeLayerScores → 5 layer scores in [0, 100]
//   layer scores → computeCompositeScore → 1 composite in [0, 100]
//   composite → alertState → GREEN | YELLOW | RED

import { LAYER_WEIGHTS } from './registry.mjs';

/**
 * Logistic squashing function. Maps real line → [0, 1].
 * @param {number} x
 * @param {number} k Steepness. Higher k = sharper transition.
 */
export function logistic(x, k = 4) {
  return 1 / (1 + Math.exp(-k * x));
}

/**
 * Compute mean and standard deviation of a numeric array.
 */
export function meanStd(values) {
  if (!values.length) return { mean: 0, std: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance) || 1;
  return { mean, std };
}

/**
 * Normalize one indicator's full series into recession risk scores in [0, 1].
 *
 * @param {Array<{date: string, value: number}>} series Time-ordered observations.
 * @param {object} indicator Registry entry.
 * @returns {{latest: object|null, score: number, series: Array}}
 */
export function normalizeIndicator(series, indicator) {
  if (!Array.isArray(series) || !series.length) {
    return { latest: null, score: 0, series: [] };
  }

  const { threshold, direction } = indicator;
  let normalized;

  if (threshold !== null && threshold !== undefined) {
    // Threshold-based: distance from threshold, scaled by |threshold|
    const denom = Math.abs(threshold) || 1;
    normalized = series.map(p => {
      const raw = direction === 'direct'
        ? (threshold - p.value) / denom    // direct: lower than threshold = bad = high score
        : (p.value - threshold) / denom;   // inverse: higher than threshold = bad = high score
      return { ...p, score: clamp01(logistic(raw)) };
    });
  } else {
    // Z-score normalization against the full window
    const { mean, std } = meanStd(series.map(x => x.value));
    normalized = series.map(p => {
      const z = (p.value - mean) / std;
      const raw = direction === 'direct' ? -z : z;
      return { ...p, score: clamp01(logistic(raw)) };
    });
  }

  return {
    latest: normalized[normalized.length - 1],
    score: normalized[normalized.length - 1]?.score ?? 0,
    series: normalized
  };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Aggregate normalized indicators into layer scores in [0, 100].
 * Within each layer, weights are applied as defined in the registry.
 */
export function computeLayerScores(indicators) {
  const grouped = {};
  for (const item of indicators) {
    if (!grouped[item.layer]) grouped[item.layer] = [];
    grouped[item.layer].push(item);
  }
  const scores = {};
  for (const [layer, items] of Object.entries(grouped)) {
    const weightSum = items.reduce((a, b) => a + b.weight, 0) || 1;
    const weighted = items.reduce((a, b) => a + (b.score || 0) * b.weight, 0);
    scores[layer] = Number(((weighted / weightSum) * 100).toFixed(1));
  }
  return scores;
}

/**
 * Aggregate layer scores into a single composite in [0, 100] using LAYER_WEIGHTS.
 */
export function computeCompositeScore(layerScores) {
  let weighted = 0;
  let totalWeight = 0;
  for (const [layer, score] of Object.entries(layerScores)) {
    const w = LAYER_WEIGHTS[layer] || 0;
    weighted += score * w;
    totalWeight += w;
  }
  return Number((weighted / (totalWeight || 1)).toFixed(1));
}

/**
 * Three-state alert. Thresholds are configuration, not validated empirically.
 * Documented in README as judgment calls pending future calibration.
 */
export function alertState(score) {
  if (score >= 60) return 'RED';
  if (score >= 30) return 'YELLOW';
  return 'GREEN';
}

/**
 * Top-level: take normalized indicators, produce the full snapshot payload.
 */
export function buildSnapshot(normalizedIndicators, asOfDate) {
  const layerScores = computeLayerScores(normalizedIndicators);
  const compositeScore = computeCompositeScore(layerScores);
  return {
    as_of: asOfDate || new Date().toISOString().slice(0, 10),
    generated_at: new Date().toISOString(),
    composite: {
      score: compositeScore,
      alert: alertState(compositeScore)
    },
    layers: Object.fromEntries(
      Object.entries(layerScores).map(([layer, score]) => [
        layer,
        { score, alert: alertState(score), weight: LAYER_WEIGHTS[layer] }
      ])
    ),
    indicators: normalizedIndicators.map(x => ({
      name: x.name,
      fred_id: x.fred_id,
      layer: x.layer,
      category: x.category,
      latest_value: x.latest?.value ?? null,
      latest_date: x.latest?.date ?? null,
      score: Number(((x.score || 0) * 100).toFixed(1)),
      alert: alertState((x.score || 0) * 100),
      threshold: x.threshold,
      direction: x.direction,
      frequency: x.frequency
    }))
  };
}
