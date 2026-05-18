import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  logistic, meanStd, normalizeIndicator,
  computeLayerScores, computeCompositeScore, alertState, buildSnapshot
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
