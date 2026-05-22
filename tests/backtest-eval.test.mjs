import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBacktest, inRecession } from '../src/backtest-eval.mjs';

test('inRecession identifies NBER months', () => {
  assert.equal(inRecession('2008-09-30'), true);   // GFC
  assert.equal(inRecession('2020-03-15'), true);   // COVID
  assert.equal(inRecession('2015-01-01'), false);  // mid-expansion
});

test('evaluateBacktest returns nulls on empty input', () => {
  const r = evaluateBacktest([]);
  assert.equal(r.months, 0);
  assert.equal(r.hit_rate, null);
});

test('perfect classifier scores hit_rate 1 and FPR 0', () => {
  // RED during the 2008 recession, GREEN otherwise.
  const entries = [];
  for (let y = 2007; y <= 2009; y++) {
    for (let m = 1; m <= 12; m++) {
      const date = `${y}-${String(m).padStart(2, '0')}-28`;
      const rec = inRecession(date);
      entries.push({ date, composite: rec ? 80 : 10, alert: rec ? 'RED' : 'GREEN' });
    }
  }
  const r = evaluateBacktest(entries, { flagAt: 'RED' });
  assert.equal(r.hit_rate, 1);
  assert.equal(r.false_positive_rate, 0);
  assert.equal(r.precision, 1);
  assert.ok(r.brier < 0.05);
});

test('lead time credits continuous pre-recession flagging', () => {
  // Flag YELLOW for 3 months before the 2008-12 ... use GFC start 2007-12.
  const entries = [
    { date: '2007-09-30', composite: 45, alert: 'YELLOW' },
    { date: '2007-10-31', composite: 45, alert: 'YELLOW' },
    { date: '2007-11-30', composite: 45, alert: 'YELLOW' },
    { date: '2007-12-31', composite: 70, alert: 'RED' },   // recession start
    { date: '2008-01-31', composite: 70, alert: 'RED' }
  ];
  const r = evaluateBacktest(entries, { flagAt: 'YELLOW' });
  const gfc = r.episodes.find(e => e.start === '2007-12');
  assert.ok(gfc);
  assert.equal(gfc.lead_months, 3);
  assert.equal(gfc.detected, true);
});

test('weighted flag level changes classification', () => {
  const entries = [
    { date: '2008-03-31', composite: 45, alert: 'YELLOW' }, // recession month, only YELLOW
    { date: '2015-06-30', composite: 10, alert: 'GREEN' }
  ];
  const atYellow = evaluateBacktest(entries, { flagAt: 'YELLOW' });
  const atRed    = evaluateBacktest(entries, { flagAt: 'RED' });
  assert.equal(atYellow.hit_rate, 1); // YELLOW counts as a flag
  assert.equal(atRed.hit_rate, 0);    // RED required, YELLOW doesn't count
});
