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
 * Standard normal CDF via Abramowitz-Stegun 7.1.26 approximation.
 * Accurate to ~7.5e-8.
 */
export function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z < 0 ? p : 1 - p;
}

/**
 * Estrella-Mishkin (1996) probit model for 12-month-ahead recession probability.
 * Inputs the 10Y-3M Treasury spread (FRED: T10Y3M) in percentage points.
 * Coefficients refit to the original published probability table.
 * Spread of 0 → ~33% probability; -1 → ~63%; +1 → ~16%.
 */
export function recessionProbability(spread) {
  if (spread === null || spread === undefined || !Number.isFinite(spread)) return null;
  return Number(normalCdf(-0.307 - 0.667 * spread).toFixed(3));
}

/**
 * Count consecutive observations at the end of a series where `value < threshold`
 * (or > threshold if `inverted=true`). Returns 0 if the latest observation is
 * not in the triggered state. Useful for yield-curve inversion dwell time.
 */
export function thresholdDwell(series, threshold, { inverted = false } = {}) {
  if (!Array.isArray(series) || !series.length) return 0;
  let count = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i].value;
    const triggered = inverted ? v > threshold : v < threshold;
    if (triggered) count++;
    else break;
  }
  return count;
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

  const last = normalized[normalized.length - 1];
  const levelScore = last?.score ?? 0;
  const momentum = computeMomentum(normalized);
  // Blend level and momentum: turning points matter, level is the anchor.
  const blendedScore = momentum === null
    ? levelScore
    : clamp01(0.7 * levelScore + 0.3 * momentum);

  return {
    latest: last,
    levelScore,
    momentumScore: momentum,
    score: blendedScore,
    series: normalized
  };
}

/**
 * Momentum sub-score in [0, 1]. Computed from the 3-month change in the
 * normalized score series. Rising risk (score going up) → high momentum.
 * Returns null when the series is too short.
 */
function computeMomentum(normalized) {
  if (!normalized || normalized.length < 4) return null;
  const recent = normalized[normalized.length - 1].score;
  const past   = normalized[normalized.length - 4].score;
  const delta  = recent - past;   // in [-1, 1]
  return clamp01(0.5 + delta);    // 0.5 = no change, 1 = fast rise, 0 = fast fall
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
 * Convert a composite score in [0, 100] to a 1–10 recession risk rating.
 * 1 = minimal risk, 10 = extreme risk.
 */
export function ratingScore(score) {
  return Math.min(10, Math.max(1, Math.round((score / 100) * 9) + 1));
}

/**
 * Downsample a series to the last `months` calendar months, taking the last
 * observation in each month. Used to keep the embedded per-indicator history
 * compact in current.json.
 */
function lastMonthly(series, months = 24) {
  if (!Array.isArray(series) || !series.length) return [];
  const byMonth = new Map();
  for (const p of series) {
    byMonth.set(p.date.slice(0, 7), p);   // last-write-wins (series is ascending)
  }
  return [...byMonth.values()].slice(-months).map(p => ({ date: p.date, value: p.value }));
}

/**
 * Top-level: take normalized indicators, produce the full snapshot payload.
 */
export function buildSnapshot(normalizedIndicators, asOfDate) {
  const layerScores = computeLayerScores(normalizedIndicators);
  const compositeScore = computeCompositeScore(layerScores);
  const withData = normalizedIndicators.filter(x => x.latest !== null).length;
  const confidence = normalizedIndicators.length > 0
    ? Number((withData / normalizedIndicators.length).toFixed(2))
    : 0;

  // Yield-curve probit (Estrella-Mishkin) using T10Y3M if present.
  const yc = normalizedIndicators.find(x => x.fred_id === 'T10Y3M');
  const ycSpread = yc?.latest?.value ?? null;
  const recessionProb = recessionProbability(ycSpread);
  const inversionDays = yc?.series ? thresholdDwell(yc.series, 0, { inverted: false }) : 0;

  return {
    as_of: asOfDate || new Date().toISOString().slice(0, 10),
    generated_at: new Date().toISOString(),
    composite: {
      score: compositeScore,
      alert: alertState(compositeScore),
      rating: ratingScore(compositeScore),
      confidence,
      recession_probability_12mo: recessionProb,
      yield_curve_inversion_days: inversionDays,
      yield_curve_spread: ycSpread
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
      description: x.description || '',
      latest_value: x.latest?.value ?? null,
      latest_date: x.latest?.date ?? null,
      score: Number(((x.score || 0) * 100).toFixed(1)),
      level_score: x.levelScore !== undefined ? Number((x.levelScore * 100).toFixed(1)) : null,
      momentum_score: x.momentumScore !== null && x.momentumScore !== undefined
        ? Number((x.momentumScore * 100).toFixed(1)) : null,
      alert: alertState((x.score || 0) * 100),
      threshold: x.threshold,
      direction: x.direction,
      frequency: x.frequency,
      history: lastMonthly(x.series || [], 24)
    }))
  };
}

/**
 * Build a 24-month history by replaying monthly snapshots from FRED series data.
 * Uses a rolling windowMonths window for z-score normalization at each cutoff,
 * matching the same window used by the live scoring engine.
 *
 * @param {object} rawData  Map of fredId → [{date, value}] (ascending)
 * @param {Array}  registry REGISTRY array
 * @param {object} opts
 * @returns {Array<{date, composite, alert, layers}>}
 */
export function buildHistoryFromSeries(rawData, registry, { windowMonths = 36, historyMonths = 24 } = {}) {
  const today = new Date();
  const entries = [];

  for (let i = historyMonths - 1; i >= 0; i--) {
    // Last calendar day of the target month
    const lastDay = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
    // Rolling window start: windowMonths before the cutoff
    const windowStart = new Date(today.getFullYear(), today.getMonth() - i - windowMonths + 1, 1);
    const cutoff = lastDay.toISOString().slice(0, 10);
    const windowStartStr = windowStart.toISOString().slice(0, 10);

    const normalized = registry.map(indicator => {
      const series = (rawData[indicator.fred_id] || []).filter(
        x => x.date >= windowStartStr && x.date <= cutoff
      );
      return { ...indicator, ...normalizeIndicator(series, indicator) };
    });

    const layerScores = computeLayerScores(normalized);
    const composite = computeCompositeScore(layerScores);
    entries.push({
      date: cutoff,
      composite,
      alert: alertState(composite),
      layers: { ...layerScores }
    });
  }

  return entries;
}
