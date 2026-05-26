// Pure scoring functions. No I/O. Heavily tested.
//
// Pipeline:
//   raw FRED series → normalizeIndicator → score in [0, 1]
//   indicators → computeLayerScores → layer scores in [0, 100]
//   layer scores → computeCompositeScore → 1 composite in [0, 100]
//   composite → alertState → GREEN | YELLOW | RED

import { LAYER_WEIGHTS } from './registry.mjs';
import { computeGeopoliticalFlag } from './geopolitical.mjs';

/**
 * Logistic squashing function. Maps real line → [0, 1].
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
 */
export function recessionProbability(spread) {
  if (spread === null || spread === undefined || !Number.isFinite(spread)) return null;
  return Number(normalCdf(-0.307 - 0.667 * spread).toFixed(3));
}

/**
 * Count consecutive observations at the end of a series where value < threshold
 * (or > threshold if inverted=true). Returns 0 if latest is not triggered.
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
 * Also returns percentile_rank (where current score sits in the historical distribution)
 * and anomaly (true when the latest change exceeds 1.5σ of historical changes).
 */
export function normalizeIndicator(series, indicator) {
  if (!Array.isArray(series) || !series.length) {
    return { latest: null, score: 0, series: [], percentileRank: null, anomaly: false };
  }

  const { threshold, direction } = indicator;
  let normalized;

  let normMean = null;
  let normStd  = null;

  if (threshold !== null && threshold !== undefined) {
    const denom = Math.abs(threshold) || 1;
    normalized = series.map(p => {
      const raw = direction === 'direct'
        ? (threshold - p.value) / denom
        : (p.value - threshold) / denom;
      return { ...p, score: clamp01(logistic(raw)) };
    });
  } else {
    const { mean, std } = meanStd(series.map(x => x.value));
    normMean = Number(mean.toFixed(4));
    normStd  = Number(std.toFixed(4));
    normalized = series.map(p => {
      const z = (p.value - mean) / std;
      const raw = direction === 'direct' ? -z : z;
      return { ...p, score: clamp01(logistic(raw)) };
    });
  }

  const last       = normalized[normalized.length - 1];
  const levelScore = last?.score ?? 0;
  const momentum   = computeMomentum(normalized);
  const blendedScore = momentum === null
    ? levelScore
    : clamp01(0.7 * levelScore + 0.3 * momentum);

  // Percentile rank: where current score sits in the historical distribution
  const scores       = normalized.map(p => p.score);
  const below        = scores.filter(s => s < blendedScore).length;
  const percentileRank = Math.round((below / scores.length) * 100);

  // Anomaly: latest period-to-period change > 1.5σ of historical changes
  let anomaly = false;
  if (normalized.length >= 4) {
    const changes = normalized.slice(1).map((p, i) => p.score - normalized[i].score);
    const { mean: cm, std: cs } = meanStd(changes);
    const latestChange = changes[changes.length - 1];
    anomaly = Math.abs(latestChange - cm) > 1.5 * cs;
  }

  return { latest: last, levelScore, momentumScore: momentum, score: blendedScore, series: normalized, percentileRank, anomaly, norm_mean: normMean, norm_std: normStd };
}

/**
 * Momentum sub-score in [0, 1] from the 3-month delta of normalized scores.
 */
function computeMomentum(normalized) {
  if (!normalized || normalized.length < 4) return null;
  const recent = normalized[normalized.length - 1].score;
  const past   = normalized[normalized.length - 4].score;
  const delta  = recent - past;
  return clamp01(0.5 + delta);
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Aggregate normalized indicators into layer scores in [0, 100].
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
    const weighted  = items.reduce((a, b) => a + (b.score || 0) * b.weight, 0);
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
    weighted    += score * w;
    totalWeight += w;
  }
  return Number((weighted / (totalWeight || 1)).toFixed(1));
}

/**
 * Three-state alert. Documented thresholds, not backtested calibration.
 */
export function alertState(score) {
  if (score >= 60) return 'RED';
  if (score >= 30) return 'YELLOW';
  return 'GREEN';
}

/**
 * Convert composite score [0, 100] to 1–10 recession risk rating.
 */
export function ratingScore(score) {
  return Math.min(10, Math.max(1, Math.round((score / 100) * 9) + 1));
}

/**
 * Downsample a series to the last `months` calendar months.
 */
function lastMonthly(series, months = 24) {
  if (!Array.isArray(series) || !series.length) return [];
  const byMonth = new Map();
  for (const p of series) {
    byMonth.set(p.date.slice(0, 7), p);
  }
  return [...byMonth.values()].slice(-months).map(p => ({ date: p.date, value: p.value }));
}

/**
 * Top-level: produce the full snapshot payload from normalized indicators.
 */
export function buildSnapshot(normalizedIndicators, asOfDate, { gpr = null } = {}) {
  const layerScores    = computeLayerScores(normalizedIndicators);
  const compositeScore = computeCompositeScore(layerScores);
  const withData       = normalizedIndicators.filter(x => x.latest?.value !== null && x.latest?.value !== undefined).length;
  const confidence     = normalizedIndicators.length > 0
    ? Number((withData / normalizedIndicators.length).toFixed(2)) : 0;

  // Yield-curve probit (Estrella-Mishkin)
  const yc           = normalizedIndicators.find(x => x.fred_id === 'T10Y3M');
  const ycSpread     = yc?.latest?.value ?? null;
  const recessionProb = recessionProbability(ycSpread);
  const inversionDays = yc?.series ? thresholdDwell(yc.series, 0) : 0;

  // Sahm Rule probability proxy: 0 → 0%, 0.5+ → 100%, linear in between
  const sahm     = normalizedIndicators.find(x => x.fred_id === 'SAHMREALTIME');
  const sahmVal  = sahm?.latest?.value ?? null;
  const sahmProb = sahmVal !== null ? Math.min(1, Math.max(0, sahmVal / 0.5)) : null;

  // Credit spread probability proxy: BAA-10Y spread 1.5% → 0%, 4.5% → 100%
  const baa      = normalizedIndicators.find(x => x.fred_id === 'BAA10YM');
  const baaVal   = baa?.latest?.value ?? null;
  const creditProb = baaVal !== null ? Math.min(1, Math.max(0, (baaVal - 1.5) / 3.0)) : null;

  // Weighted ensemble of four signals, each a recession probability in [0,1].
  // Weights reflect each signal's documented forecasting role rather than an
  // equal average: the Estrella-Mishkin probit is the only peer-reviewed model
  // (highest weight); the broad composite is diversified but coincident-leaning;
  // Sahm is confirmatory (fires at recession onset, low lead); credit spreads
  // lead but are noisy. Weights renormalize over whichever signals are present.
  const ENSEMBLE_WEIGHTS = { composite: 0.30, probit: 0.35, sahm: 0.15, credit: 0.20 };
  const ensembleParts = [
    { p: compositeScore / 100, w: ENSEMBLE_WEIGHTS.composite },
    { p: recessionProb,        w: ENSEMBLE_WEIGHTS.probit },
    { p: sahmProb,             w: ENSEMBLE_WEIGHTS.sahm },
    { p: creditProb,           w: ENSEMBLE_WEIGHTS.credit }
  ].filter(x => x.p != null && Number.isFinite(x.p));
  const ensembleWeightSum = ensembleParts.reduce((a, b) => a + b.w, 0);
  const ensembleScore = ensembleWeightSum
    ? Number(((ensembleParts.reduce((a, b) => a + b.p * b.w, 0) / ensembleWeightSum) * 100).toFixed(1))
    : null;

  // Factor contributions: each indicator's signed contribution to composite
  const factorContributions = normalizedIndicators
    .filter(x => x.latest !== null)
    .map(x => ({
      name:    x.name,
      fred_id: x.fred_id,
      layer:   x.layer,
      score:   Number(((x.score || 0) * 100).toFixed(1)),
      contrib: Number(((((x.score || 0) * 100) - 50) * (x.weight || 0) * (LAYER_WEIGHTS[x.layer] || 0)).toFixed(3))
    }))
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
    .slice(0, 10);

  return {
    as_of:        asOfDate || new Date().toISOString().slice(0, 10),
    generated_at: new Date().toISOString(),
    composite: {
      score:                    compositeScore,
      alert:                    alertState(compositeScore),
      rating:                   ratingScore(compositeScore),
      confidence,
      recession_probability_12mo: recessionProb,
      yield_curve_inversion_days: inversionDays,
      yield_curve_spread:         ycSpread,
      ensemble_score:             ensembleScore
    },
    geopolitical: computeGeopoliticalFlag(normalizedIndicators, gpr),
    factor_contributions: factorContributions,
    layers: Object.fromEntries(
      Object.entries(layerScores).map(([layer, score]) => [
        layer,
        { score, alert: alertState(score), weight: LAYER_WEIGHTS[layer] }
      ])
    ),
    indicators: normalizedIndicators.map(x => ({
      name:           x.name,
      fred_id:        x.fred_id,
      layer:          x.layer,
      category:       x.category,
      description:    x.description || '',
      weight:         x.weight,
      latest_value:   x.latest?.value ?? null,
      latest_date:    x.latest?.date ?? null,
      score:          Number(((x.score || 0) * 100).toFixed(1)),
      level_score:    x.levelScore !== undefined ? Number((x.levelScore * 100).toFixed(1)) : null,
      momentum_score: x.momentumScore !== null && x.momentumScore !== undefined
        ? Number((x.momentumScore * 100).toFixed(1)) : null,
      percentile_rank: x.percentileRank ?? null,
      anomaly:         x.anomaly ?? false,
      alert:           alertState((x.score || 0) * 100),
      threshold:       x.threshold,
      direction:       x.direction,
      frequency:       x.frequency,
      norm_mean:       x.norm_mean ?? null,
      norm_std:        x.norm_std ?? null,
      history:         lastMonthly(x.series || [], 24)
    }))
  };
}

/**
 * Build a history by replaying monthly snapshots from FRED series data.
 */
export function buildHistoryFromSeries(rawData, registry, { windowMonths = 36, historyMonths = 24 } = {}) {
  const today   = new Date();
  const entries = [];

  for (let i = historyMonths - 1; i >= 0; i--) {
    const lastDay     = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
    const windowStart = new Date(today.getFullYear(), today.getMonth() - i - windowMonths + 1, 1);
    const cutoff      = lastDay.toISOString().slice(0, 10);
    const windowStartStr = windowStart.toISOString().slice(0, 10);

    const normalized = registry.map(indicator => {
      const series = (rawData[indicator.fred_id] || []).filter(
        x => x.date >= windowStartStr && x.date <= cutoff
      );
      return { ...indicator, ...normalizeIndicator(series, indicator) };
    });

    const layerScores = computeLayerScores(normalized);
    const composite   = computeCompositeScore(layerScores);
    entries.push({ date: cutoff, composite, alert: alertState(composite), layers: { ...layerScores } });
  }

  return entries;
}
