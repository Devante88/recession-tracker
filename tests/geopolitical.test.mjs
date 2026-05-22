import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGeopoliticalFlag, flagFor } from '../src/geopolitical.mjs';

const ind = (fred_id, value, extra = {}) => ({ fred_id, latest: { value }, ...extra });

test('flagFor maps score to bands', () => {
  assert.equal(flagFor(10), 'CALM');
  assert.equal(flagFor(33), 'ELEVATED');
  assert.equal(flagFor(50), 'ELEVATED');
  assert.equal(flagFor(66), 'ACUTE');
  assert.equal(flagFor(90), 'ACUTE');
});

test('returns null when no channels have data', () => {
  assert.equal(computeGeopoliticalFlag([ind('UNRATE', 4.0)]), null);
  assert.equal(computeGeopoliticalFlag([]), null);
});

test('calm markets produce a CALM flag', () => {
  const r = computeGeopoliticalFlag([
    ind('VIXCLS', 15),
    ind('BAMLH0A0HYM2', 3.2),
    ind('DTWEXBGS', 110, { norm_mean: 110, norm_std: 7 })
  ]);
  assert.equal(r.flag, 'CALM');
  assert.equal(r.firing.length, 0);
});

test('acute shock across all channels produces ACUTE and lists firing channels', () => {
  const r = computeGeopoliticalFlag([
    ind('VIXCLS', 45),
    ind('BAMLH0A0HYM2', 9.0),
    ind('DTWEXBGS', 130, { norm_mean: 110, norm_std: 7 }) // ~2.9σ → strong-dollar surge
  ]);
  assert.equal(r.flag, 'ACUTE');
  assert.equal(r.firing.length, 3);
  assert.ok(r.score >= 66);
});

test('a single firing channel registers but stays below ACUTE', () => {
  const r = computeGeopoliticalFlag([
    ind('VIXCLS', 42),          // firing
    ind('BAMLH0A0HYM2', 3.3),   // calm
    ind('DTWEXBGS', 109, { norm_mean: 110, norm_std: 7 }) // calm
  ]);
  assert.ok(r.firing.includes('Equity volatility (VIX)'));
  assert.notEqual(r.flag, 'ACUTE');
});

test('renormalizes weights when a channel is missing', () => {
  const r = computeGeopoliticalFlag([
    ind('VIXCLS', 40),
    ind('BAMLH0A0HYM2', 8.0)
    // no DTWEXBGS
  ]);
  assert.equal(r.channels.length, 2);
  assert.ok(r.score > 80); // both present channels near max
});

test('DTWEXBGS without z-score params is skipped', () => {
  const r = computeGeopoliticalFlag([
    ind('VIXCLS', 20),
    ind('DTWEXBGS', 130) // no norm_mean/norm_std
  ]);
  assert.ok(r.channels.every(c => c.fred_id !== 'DTWEXBGS'));
});
