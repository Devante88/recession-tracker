import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertEmoji,
  alertColor,
  shouldSendWeekly,
  buildWeeklyHtml,
} from '../scripts/weekly-summary.mjs';

const current = {
  as_of: '2026-05-25',
  composite: {
    alert: 'YELLOW',
    score: 47,
    recession_probability_12mo: 0.33,
  },
  layers: {
    financial_lead: { alert: 'RED', score: 71 },
    labor: { alert: 'GREEN', score: 22 },
  },
  factor_contributions: [
    { name: 'Credit Spreads', contrib: 0.9 },
    { name: 'Payrolls', contrib: -0.3 },
  ],
};

test('alertEmoji / alertColor map states', () => {
  assert.equal(alertEmoji('RED'), '🔴');
  assert.equal(alertColor('GREEN'), '#2ddc8c');
});

test('shouldSendWeekly returns true only on Monday (UTC)', () => {
  // 2026-06-01 is a Monday; 2026-05-31 is a Sunday.
  assert.equal(shouldSendWeekly(new Date('2026-06-01T12:00:00Z')), true);
  assert.equal(shouldSendWeekly(new Date('2026-05-31T12:00:00Z')), false);
  assert.equal(shouldSendWeekly(new Date('2026-06-02T12:00:00Z')), false);
});

test('shouldSendWeekly checks getUTCDay === 1 across the week', () => {
  // Walk a full week starting Monday 2026-06-01.
  const days = [1, 2, 3, 4, 5, 6, 7].map(
    d => shouldSendWeekly(new Date(`2026-06-0${d}T00:00:00Z`))
  );
  assert.deepEqual(days, [true, false, false, false, false, false, false]);
});

test('buildWeeklyHtml includes score, alert state, and layers', () => {
  const html = buildWeeklyHtml(current, null);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /YELLOW/);
  assert.match(html, /47/);                 // composite score
  assert.match(html, /Financial Leading/);  // layer name
  assert.match(html, /2026-05-25/);         // as_of date
});

test('buildWeeklyHtml includes recent narrative headline but omits stale one', () => {
  const fresh = buildWeeklyHtml(current, {
    headline: 'Risk creeping upward this week',
    generated_at: new Date().toISOString(),
  });
  assert.match(fresh, /Risk creeping upward this week/);

  const stale = buildWeeklyHtml(current, {
    headline: 'Old headline from a month ago',
    generated_at: '2026-01-01T00:00:00Z',
  });
  assert.doesNotMatch(stale, /Old headline from a month ago/);
});
