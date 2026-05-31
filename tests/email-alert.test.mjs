import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertEmoji,
  alertColor,
  stateChanged,
  buildAlertEmailHtml,
} from '../scripts/email-alert.mjs';

const snap = (alert, extra = {}) => ({
  composite: {
    alert,
    score: 62,
    ensemble_score: 58,
    recession_probability_12mo: 0.41,
    ...extra,
  },
  factor_contributions: [
    { name: 'Yield Curve', contrib: 1.2, score: 80 },
    { name: 'Unemployment', contrib: -0.5, score: 30 },
  ],
});

test('alertEmoji maps states to emoji', () => {
  assert.equal(alertEmoji('RED'), '🔴');
  assert.equal(alertEmoji('YELLOW'), '🟡');
  assert.equal(alertEmoji('GREEN'), '🟢');
  assert.equal(alertEmoji(undefined), '🟢');
});

test('alertColor maps states to colors', () => {
  assert.equal(alertColor('RED'), '#ff7a7a');
  assert.equal(alertColor('YELLOW'), '#f1c84a');
  assert.equal(alertColor('GREEN'), '#2ddc8c');
});

test('stateChanged is true only when alert differs', () => {
  assert.equal(stateChanged(snap('RED'), snap('YELLOW')), true);
  assert.equal(stateChanged(snap('RED'), snap('RED')), false);
  // First run: no previous snapshot → counts as a change.
  assert.equal(stateChanged(snap('GREEN'), null), true);
  assert.equal(stateChanged(snap('GREEN'), {}), true);
});

test('buildAlertEmailHtml includes score and new alert state', () => {
  const html = buildAlertEmailHtml(snap('RED'), snap('YELLOW'));
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /RED/);
  assert.match(html, /62/);            // composite score
  assert.match(html, /Yield Curve/);   // top factor
});

test('buildAlertEmailHtml handles missing previous snapshot', () => {
  const html = buildAlertEmailHtml(snap('YELLOW'), null);
  assert.match(html, /first run/);
  assert.match(html, /YELLOW/);
});
