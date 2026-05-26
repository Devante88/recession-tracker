import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkForward, bootstrapAucCI, robustnessStudy } from '../src/walk-forward.mjs';
import { inRecession } from '../src/backtest-eval.mjs';

// 1985–2023 monthly history; composite tracks recessions with overlap so AUC<1.
function history({ noise = 18 } = {}) {
  const out = [];
  let s = 3;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 1985; y <= 2023; y++) for (let m = 1; m <= 12; m++) {
    const date = `${y}-${String(m).padStart(2, '0')}-28`;
    const rec = inRecession(date);
    const base = rec ? 60 : 35;
    out.push({ date, composite: Number((base + (rnd() - 0.5) * noise).toFixed(1)), alert: 'NA' });
  }
  return out;
}

test('walkForward produces multiple folds with out-of-sample AUC', () => {
  const wf = walkForward(history(), { minTrainMonths: 120, stepMonths: 24, testMonths: 60 });
  assert.equal(wf.valid, true);
  assert.ok(wf.summary.n_folds >= 2);
  assert.ok(wf.summary.mean_test_auc > 0.5);
  for (const f of wf.folds) {
    assert.ok(f.test_auc >= 0 && f.test_auc <= 1);
    assert.ok(f.test_recession_months >= 1);
  }
});

test('walkForward invalid without enough history', () => {
  const short = history().slice(0, 50);
  const wf = walkForward(short, { minTrainMonths: 120 });
  assert.equal(wf.valid, false);
});

test('bootstrapAucCI returns an ordered 95% interval bracketing the point estimate', () => {
  const b = bootstrapAucCI(history(), { blockLen: 12, iterations: 300 });
  assert.ok(b);
  assert.ok(b.ci95[0] <= b.ci95[1]);
  assert.ok(b.ci95[0] >= 0 && b.ci95[1] <= 1);
  // point estimate should sit within (or extremely close to) the CI
  assert.ok(b.point >= b.ci95[0] - 0.05 && b.point <= b.ci95[1] + 0.05);
});

test('bootstrapAucCI is deterministic for a fixed seed', () => {
  const a = bootstrapAucCI(history(), { iterations: 200, seed: 42 });
  const b = bootstrapAucCI(history(), { iterations: 200, seed: 42 });
  assert.deepEqual(a.ci95, b.ci95);
});

test('tighter signal yields higher mean AUC than noisier signal', () => {
  const clean = bootstrapAucCI(history({ noise: 6 }),  { iterations: 300 });
  const noisy = bootstrapAucCI(history({ noise: 40 }), { iterations: 300 });
  assert.ok(clean.mean > noisy.mean);
});

test('robustnessStudy bundles both analyses', () => {
  const r = robustnessStudy(history());
  assert.ok(r.walk_forward.valid);
  assert.ok(r.bootstrap_auc.ci95);
  assert.ok(r.generated_at);
});
