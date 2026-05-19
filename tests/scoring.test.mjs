import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logistic, meanStd, normalizeIndicator,
  computeLayerScores, computeCompositeScore, alertState, ratingScore,
  normalCdf, recessionProbability, thresholdDwell, buildSnapshot,
  buildHistoryFromSeries
} from '../src/scoring.mjs';

test('logistic returns 0.5 at zero', () => {
  assert.equal(logistic(0), 0.5);
});

test('logistic is bounded in [0, 1]', () => {
  for (const x of [-100, -10, -1, 0, 1, 10, 100]) {
    const y = logistic(x);
    assert.ok(y >= 0 && y <= 1, `logistic(${x}) = ${y} out of bounds`);
  }
});

test('meanStd on simple array', () => {
  const { mean, std } = meanStd([1, 2, 3, 4, 5]);
  assert.equal(mean, 3);
  assert.ok(Math.abs(std - Math.sqrt(2)) < 0.001);
});

test('meanStd on empty array does not crash', () => {
  const { mean, std } = meanStd([]);
  assert.equal(mean, 0);
  assert.equal(std, 1);
});

test('normalizeIndicator: threshold-based inverse direction (value > threshold = high score)', () => {
  const indicator = { threshold: 0.5, direction: 'inverse' };
  const series = [
    { date: '2025-01-01', value: 0.0 },   // below threshold = low risk
    { date: '2025-02-01', value: 1.0 }    // above threshold = high risk
  ];
  const { series: scored } = normalizeIndicator(series, indicator);
  assert.ok(scored[0].score < 0.5, 'value below threshold should score low');
  assert.ok(scored[1].score > 0.5, 'value above threshold should score high');
});

test('normalizeIndicator: threshold-based direct direction (value < threshold = high score)', () => {
  const indicator = { threshold: 0.0, direction: 'direct' };  // mimics yield curve
  const series = [
    { date: '2025-01-01', value: 0.5 },    // positive = healthy = low risk
    { date: '2025-02-01', value: -0.5 }    // inverted = recession signal = high risk
  ];
  const { series: scored } = normalizeIndicator(series, indicator);
  assert.ok(scored[0].score < 0.5, 'positive yield curve = low risk');
  assert.ok(scored[1].score > 0.5, 'inverted yield curve = high risk');
});

test('normalizeIndicator: z-score normalization (no threshold)', () => {
  const indicator = { threshold: null, direction: 'inverse' };
  const series = Array.from({ length: 20 }, (_, i) => ({
    date: `2025-${String(i + 1).padStart(2, '0')}-01`,
    value: i  // monotone increasing
  }));
  const { score } = normalizeIndicator(series, indicator);
  // Latest value is the max of the series → above mean → inverse direction → high score
  assert.ok(score > 0.7, `expected high score, got ${score}`);
});

test('normalizeIndicator: empty series returns zero score', () => {
  const { score, latest } = normalizeIndicator([], { threshold: 0, direction: 'direct' });
  assert.equal(score, 0);
  assert.equal(latest, null);
});

test('computeLayerScores aggregates within layer', () => {
  const indicators = [
    { layer: 'labor', weight: 0.5, score: 0.8 },
    { layer: 'labor', weight: 0.5, score: 0.2 }
  ];
  const scores = computeLayerScores(indicators);
  assert.equal(scores.labor, 50.0);
});

test('computeCompositeScore weights by LAYER_WEIGHTS', () => {
  const layerScores = {
    financial_lead: 100, labor: 0, inflation: 0, real_economy: 0, micro: 0
  };
  const composite = computeCompositeScore(layerScores);
  // financial_lead weight = 0.30, so composite = 30
  assert.equal(composite, 30.0);
});

test('alertState thresholds', () => {
  assert.equal(alertState(0), 'GREEN');
  assert.equal(alertState(29.9), 'GREEN');
  assert.equal(alertState(30), 'YELLOW');
  assert.equal(alertState(59.9), 'YELLOW');
  assert.equal(alertState(60), 'RED');
  assert.equal(alertState(100), 'RED');
});

test('ratingScore maps 0 → 1 and 100 → 10', () => {
  assert.equal(ratingScore(0), 1);
  assert.equal(ratingScore(100), 10);
});

test('ratingScore maps midpoint ~50 → 5 or 6', () => {
  const r = ratingScore(50);
  assert.ok(r >= 5 && r <= 6, `expected 5 or 6, got ${r}`);
});

test('ratingScore is bounded [1, 10] for out-of-range inputs', () => {
  assert.equal(ratingScore(-99), 1);
  assert.equal(ratingScore(200), 10);
});

test('buildSnapshot composite includes rating field', () => {
  const indicators = [
    { name: 'X', fred_id: 'X', layer: 'labor', category: 'macro', weight: 1.0,
      score: 0.0, latest: { date: '2025-01-01', value: 0 },
      threshold: null, direction: 'inverse', frequency: 'monthly' }
  ];
  const snap = buildSnapshot(indicators, '2025-05-18');
  assert.ok(typeof snap.composite.rating === 'number', 'composite.rating should be a number');
  assert.ok(snap.composite.rating >= 1 && snap.composite.rating <= 10, 'rating should be in [1, 10]');
});

test('buildSnapshot confidence = 1.0 when all indicators have data', () => {
  const indicators = [
    { name: 'X', fred_id: 'X', layer: 'labor', category: 'macro', weight: 1.0,
      score: 0.5, latest: { date: '2025-01-01', value: 5 },
      threshold: null, direction: 'inverse', frequency: 'monthly' },
    { name: 'Y', fred_id: 'Y', layer: 'labor', category: 'macro', weight: 1.0,
      score: 0.5, latest: { date: '2025-01-01', value: 3 },
      threshold: null, direction: 'inverse', frequency: 'monthly' }
  ];
  const snap = buildSnapshot(indicators, '2025-05-18');
  assert.equal(snap.composite.confidence, 1.0);
});

test('buildSnapshot confidence reflects partial data coverage', () => {
  const indicators = [
    { name: 'X', fred_id: 'X', layer: 'labor', category: 'macro', weight: 1.0,
      score: 0.5, latest: { date: '2025-01-01', value: 5 },
      threshold: null, direction: 'inverse', frequency: 'monthly' },
    { name: 'Y', fred_id: 'Y', layer: 'labor', category: 'macro', weight: 1.0,
      score: 0, latest: null,
      threshold: null, direction: 'inverse', frequency: 'monthly' }
  ];
  const snap = buildSnapshot(indicators, '2025-05-18');
  assert.equal(snap.composite.confidence, 0.5);
});

test('normalCdf basic values', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 0.001);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 0.001);
});

test('recessionProbability: inverted curve → high probability', () => {
  const pInverted = recessionProbability(-1);
  const pFlat     = recessionProbability(0);
  const pSteep    = recessionProbability(1);
  assert.ok(pInverted > pFlat, `expected ${pInverted} > ${pFlat}`);
  assert.ok(pFlat > pSteep, `expected ${pFlat} > ${pSteep}`);
  // Flat curve should be roughly 30% per Estrella-Mishkin
  assert.ok(pFlat > 0.25 && pFlat < 0.40, `expected 0.25-0.40, got ${pFlat}`);
});

test('recessionProbability: returns null for invalid input', () => {
  assert.equal(recessionProbability(null), null);
  assert.equal(recessionProbability(undefined), null);
  assert.equal(recessionProbability(NaN), null);
});

test('thresholdDwell counts trailing inversion days', () => {
  const series = [
    { date: '2025-01-01', value:  0.5 },
    { date: '2025-01-02', value: -0.1 },
    { date: '2025-01-03', value: -0.2 },
    { date: '2025-01-04', value: -0.3 }
  ];
  assert.equal(thresholdDwell(series, 0), 3);
});

test('thresholdDwell returns 0 when latest is uninverted', () => {
  const series = [
    { date: '2025-01-01', value: -0.5 },
    { date: '2025-01-02', value:  0.2 }
  ];
  assert.equal(thresholdDwell(series, 0), 0);
});

test('normalizeIndicator: momentum lifts score when risk is rising fast', () => {
  // Monotone rising risk → both level and momentum are high
  const indicator = { threshold: null, direction: 'inverse' };
  const rising = Array.from({ length: 12 }, (_, i) => ({
    date: `2025-${String(i + 1).padStart(2, '0')}-01`, value: i
  }));
  const falling = Array.from({ length: 12 }, (_, i) => ({
    date: `2025-${String(i + 1).padStart(2, '0')}-01`, value: 11 - i
  }));
  const r = normalizeIndicator(rising, indicator);
  const f = normalizeIndicator(falling, indicator);
  assert.ok(r.score > f.score, `rising momentum (${r.score}) should beat falling (${f.score})`);
  assert.ok(r.momentumScore > 0.5);
  assert.ok(f.momentumScore < 0.5);
});

test('buildSnapshot exposes recession probability and inversion days', () => {
  const indicators = [
    { name: 'YC', fred_id: 'T10Y3M', layer: 'financial_lead', category: 'macro', weight: 1.0,
      score: 0.7, latest: { date: '2025-01-04', value: -0.3 },
      series: [
        { date: '2025-01-01', value:  0.2, score: 0.4 },
        { date: '2025-01-02', value: -0.1, score: 0.6 },
        { date: '2025-01-03', value: -0.2, score: 0.65 },
        { date: '2025-01-04', value: -0.3, score: 0.7 }
      ],
      threshold: 0, direction: 'direct', frequency: 'daily' }
  ];
  const snap = buildSnapshot(indicators, '2025-01-04');
  assert.ok(snap.composite.recession_probability_12mo > 0.4,
    `expected high probability for -0.3 spread, got ${snap.composite.recession_probability_12mo}`);
  assert.equal(snap.composite.yield_curve_inversion_days, 3);
  assert.equal(snap.composite.yield_curve_spread, -0.3);
});

test('buildSnapshot embeds compact per-indicator history', () => {
  const series = Array.from({ length: 30 }, (_, i) => ({
    date: `2024-${String((i % 12) + 1).padStart(2, '0')}-15`,
    value: i, score: 0.5
  }));
  const indicators = [{
    name: 'X', fred_id: 'X', layer: 'labor', category: 'macro', weight: 1.0,
    score: 0.5, latest: series[series.length - 1], series,
    threshold: null, direction: 'inverse', frequency: 'monthly'
  }];
  const snap = buildSnapshot(indicators, '2025-05-18');
  assert.ok(Array.isArray(snap.indicators[0].history));
  assert.ok(snap.indicators[0].history.length <= 24);
  assert.ok(snap.indicators[0].history.length > 0);
});

test('buildHistoryFromSeries produces N monthly entries', () => {
  const registry = [
    { name: 'X', fred_id: 'X', layer: 'labor', category: 'macro', weight: 1.0,
      threshold: null, direction: 'inverse', frequency: 'monthly', description: '' }
  ];
  const today = new Date();
  // Build a 3-year synthetic series
  const series = [];
  for (let i = 35; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    series.push({ date: d.toISOString().slice(0, 10), value: 4 + Math.sin(i) });
  }
  const rawData = { X: series };
  const history = buildHistoryFromSeries(rawData, registry, { historyMonths: 6 });
  assert.equal(history.length, 6, 'should produce 6 monthly entries');
  for (const entry of history) {
    assert.ok(entry.date, 'entry has date');
    assert.ok(typeof entry.composite === 'number', 'entry has composite score');
    assert.ok(['GREEN','YELLOW','RED'].includes(entry.alert), 'entry has valid alert');
    assert.ok(entry.layers?.labor !== undefined, 'entry has layer scores');
  }
});

test('buildHistoryFromSeries with empty data returns zero scores', () => {
  const registry = [
    { name: 'X', fred_id: 'X', layer: 'labor', category: 'macro', weight: 1.0,
      threshold: null, direction: 'inverse', frequency: 'monthly', description: '' }
  ];
  const history = buildHistoryFromSeries({}, registry, { historyMonths: 3 });
  assert.equal(history.length, 3);
  for (const entry of history) {
    assert.equal(entry.composite, 0);
  }
});

test('buildSnapshot produces full payload schema', () => {
  const indicators = [
    { name: 'X', fred_id: 'X', layer: 'labor', category: 'macro', weight: 1.0,
      score: 0.5, latest: { date: '2025-01-01', value: 5 },
      threshold: null, direction: 'inverse', frequency: 'monthly' }
  ];
  const snap = buildSnapshot(indicators, '2025-05-18');
  assert.equal(snap.as_of, '2025-05-18');
  assert.ok(snap.composite);
  assert.ok(snap.layers);
  assert.ok(Array.isArray(snap.indicators));
  assert.equal(snap.indicators.length, 1);
});
