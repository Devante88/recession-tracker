import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGeopoliticalFlag, marketStress, gprReading, flagFor, gprFlagFor
} from '../src/geopolitical.mjs';

const ind = (fred_id, value, extra = {}) => ({ fred_id, latest: { value }, ...extra });
const calmMarket = [
  ind('VIXCLS', 15),
  ind('BAMLH0A0HYM2', 3.2),
  ind('DTWEXBGS', 110, { norm_mean: 110, norm_std: 7 })
];
const acuteMarket = [
  ind('VIXCLS', 45),
  ind('BAMLH0A0HYM2', 9.0),
  ind('DTWEXBGS', 130, { norm_mean: 110, norm_std: 7 })
];

test('flagFor maps proxy score to bands', () => {
  assert.equal(flagFor(10), 'CALM');
  assert.equal(flagFor(40), 'ELEVATED');
  assert.equal(flagFor(70), 'ACUTE');
});

test('gprFlagFor uses documented GPR anchors', () => {
  assert.equal(gprFlagFor(90), 'CALM');
  assert.equal(gprFlagFor(150), 'ELEVATED');
  assert.equal(gprFlagFor(230), 'ACUTE'); // ~Russia–Ukraine Feb 2022
});

test('gprReading maps a raw index value to score+flag', () => {
  assert.equal(gprReading(null), null);
  assert.equal(gprReading({ latest: NaN }), null);
  const r = gprReading({ latest: 96.4, date: '2026-05-01' });
  assert.equal(r.flag, 'CALM');
  assert.equal(r.value, 96.4);
  assert.ok(r.score >= 0 && r.score <= 100);
});

test('marketStress returns null without channel data', () => {
  assert.equal(marketStress([ind('UNRATE', 4.0)]), null);
});

test('acute market shock fires all channels', () => {
  const m = marketStress(acuteMarket);
  assert.equal(m.flag, 'ACUTE');
  assert.equal(m.firing.length, 3);
});

test('proxy-only when no GPR: headline source is market-proxy', () => {
  const g = computeGeopoliticalFlag(calmMarket);
  assert.equal(g.source, 'market-proxy');
  assert.equal(g.gpr, null);
  assert.equal(g.corroboration, null);
  assert.equal(g.flag, 'CALM');
});

test('GPR present: headline source is GPR, market kept as corroboration', () => {
  const g = computeGeopoliticalFlag(calmMarket, { latest: 96.4, date: '2026-05-01' });
  assert.equal(g.source, 'GPR');
  assert.equal(g.flag, 'CALM');
  assert.ok(g.market);                 // proxy still computed
  assert.equal(g.corroboration, 'calm');
});

test('corroboration: GPR acute but calm market = news-leads-market', () => {
  const g = computeGeopoliticalFlag(calmMarket, { latest: 240 });
  assert.equal(g.flag, 'ACUTE');
  assert.equal(g.corroboration, 'news-leads-market');
});

test('corroboration: calm GPR but stressed market = market-stress-not-geopolitical', () => {
  const g = computeGeopoliticalFlag(acuteMarket, { latest: 95 });
  assert.equal(g.corroboration, 'market-stress-not-geopolitical');
});

test('corroboration: both stressed = confirmed', () => {
  const g = computeGeopoliticalFlag(acuteMarket, { latest: 230 });
  assert.equal(g.corroboration, 'confirmed');
});

test('returns null when neither GPR nor market data present', () => {
  assert.equal(computeGeopoliticalFlag([ind('UNRATE', 4)], null), null);
});
