import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slaDays, daysStale, checkSeries, buildFreshnessReport } from '../src/freshness.mjs';

test('slaDays maps cadence to expected windows', () => {
  assert.equal(slaDays('daily'), 10);
  assert.equal(slaDays('weekly'), 21);
  assert.equal(slaDays('monthly'), 75);
  assert.equal(slaDays('quarterly'), 200);
  assert.equal(slaDays('unknown'), 75);
});

test('daysStale computes whole-day difference', () => {
  assert.equal(daysStale('2026-05-01', new Date('2026-05-11')), 10);
  assert.equal(daysStale(null), null);
  assert.equal(daysStale('not-a-date'), null);
});

test('checkSeries flags a fresh daily series as not stale', () => {
  const series = [{ date: '2026-05-18', value: 1 }];
  const r = checkSeries({ fred_id: 'X', frequency: 'daily' }, series, new Date('2026-05-19'));
  assert.equal(r.stale, false);
  assert.equal(r.missing, false);
  assert.equal(r.days, 1);
});

test('checkSeries flags an old daily series as stale', () => {
  const series = [{ date: '2026-04-01', value: 1 }];
  const r = checkSeries({ fred_id: 'X', frequency: 'daily' }, series, new Date('2026-05-19'));
  assert.equal(r.stale, true);
});

test('checkSeries flags an empty series as missing and stale', () => {
  const r = checkSeries({ fred_id: 'X', frequency: 'monthly' }, [], new Date('2026-05-19'));
  assert.equal(r.missing, true);
  assert.equal(r.stale, true);
  assert.equal(r.latest_date, null);
});

test('buildFreshnessReport aggregates stale and missing counts', () => {
  const registry = [
    { fred_id: 'FRESH', frequency: 'daily' },
    { fred_id: 'STALE', frequency: 'daily' },
    { fred_id: 'GONE',  frequency: 'monthly' }
  ];
  const raw = {
    FRESH: [{ date: '2026-05-18', value: 1 }],
    STALE: [{ date: '2026-01-01', value: 1 }],
    GONE:  []
  };
  const rep = buildFreshnessReport(registry, raw, new Date('2026-05-19'));
  assert.equal(rep.total, 3);
  assert.equal(rep.fresh, 1);
  assert.equal(rep.stale_count, 1);
  assert.equal(rep.missing_count, 1);
  assert.deepEqual(rep.missing, ['GONE']);
  assert.equal(rep.stale[0].fred_id, 'STALE');
});
