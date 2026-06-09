// Entrypoint for the GitHub Actions runner.
// Reads FRED_API_KEY from env, fetches all series, computes the snapshot,
// writes data/current.json, data/history.json, data/backtest.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { REGISTRY } from '../src/registry.mjs';
import { fetchAllSeries } from '../src/fred.mjs';
import { normalizeIndicator, buildSnapshot, buildHistoryFromSeries } from '../src/scoring.mjs';
import { buildFreshnessReport } from '../src/freshness.mjs';
import { evaluateBacktest } from '../src/backtest-eval.mjs';
import { outOfSampleStudy } from '../src/oos-research.mjs';
import { weightStudy } from '../src/weight-opt.mjs';
import { robustnessStudy } from '../src/walk-forward.mjs';
import { LAYER_WEIGHTS } from '../src/registry.mjs';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');

// How many months at the tail of the 30-year backtest to recompute fresh on
// every run. Anything older than this essentially never changes (historical
// FRED revisions beyond ~2 years are negligible), so we reuse the cached value.
const BACKTEST_RECENT_MONTHS = 36;
const BACKTEST_TOTAL_MONTHS  = 360;
const BACKTEST_WINDOW_MONTHS = 60;

// Build the 30-year backtest, reusing cached older entries and only recomputing
// the most recent BACKTEST_RECENT_MONTHS. Falls back to a full recompute when
// the cache is missing or malformed. The returned array has the exact same
// shape and ascending date ordering that buildHistoryFromSeries produces, so
// downstream consumers (evaluateBacktest, outOfSampleStudy, weightStudy,
// robustnessStudy) see no contract change.
async function buildBacktestCached(rawData, registry, cacheFile) {
  // Always recompute the recent tail fresh.
  const recent = buildHistoryFromSeries(rawData, registry, {
    historyMonths: BACKTEST_RECENT_MONTHS,
    windowMonths: BACKTEST_WINDOW_MONTHS,
  });

  // The oldest fresh date — cached entries on/after this are superseded.
  const recentCutoff = recent.length ? recent[0].date : null;

  let cached = null;
  try {
    const parsed = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    if (Array.isArray(parsed) && parsed.every(e => e && typeof e.date === 'string')) {
      cached = parsed;
    }
  } catch {
    // Missing or unreadable cache → full recompute below.
  }

  if (!cached || recentCutoff === null) {
    console.log('Backtest cache: none usable — full recompute of 30-year backtest');
    return buildHistoryFromSeries(rawData, registry, {
      historyMonths: BACKTEST_TOTAL_MONTHS,
      windowMonths: BACKTEST_WINDOW_MONTHS,
    });
  }

  // Reuse only cached entries strictly older than the freshly recomputed tail.
  const reused = cached.filter(e => e.date < recentCutoff);
  const byDate = new Map();
  for (const e of reused) byDate.set(e.date, e);
  for (const e of recent) byDate.set(e.date, e); // fresh wins on any overlap

  let merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  // Keep the same ~360-month span the full recompute would yield, so the array
  // length/window the downstream studies see stays stable run-to-run.
  if (merged.length > BACKTEST_TOTAL_MONTHS) {
    merged = merged.slice(merged.length - BACKTEST_TOTAL_MONTHS);
  }
  console.log(`Backtest cache: reused ${reused.length} cached entries + recomputed ${recent.length} recent → ${merged.length} total`);
  return merged;
}

// Compute a spread series from two source series, matched by YYYY-MM.
function computeSpread(series10y, series3m) {
  const map3m = new Map(series3m.map(p => [p.date.slice(0, 7), p.value]));
  return series10y
    .map(p => {
      const v3m = map3m.get(p.date.slice(0, 7));
      return v3m != null ? { date: p.date, value: Number((p.value - v3m).toFixed(4)) } : null;
    })
    .filter(Boolean);
}

async function main() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.error('FRED_API_KEY not set');
    process.exit(1);
  }

  // Identify FRED IDs to fetch. EURYLDCRV is computed, not fetched directly.
  const fredIds = REGISTRY.map(x => x.fred_id).filter(id => id !== 'EURYLDCRV');

  // Source series for EU yield curve spread
  const EU_SOURCES = ['IRLTLT01EZM156N', 'IR3TIB01EZM156N'];
  const allIds = [...new Set([...fredIds, ...EU_SOURCES])];

  console.log(`Fetching ${fredIds.length} registry series + ${EU_SOURCES.length} EU yield curve sources...`);
  const { data: rawData, successCount, failureCount } = await fetchAllSeries(allIds, apiKey);
  console.log(`\nFetch complete: ${successCount} succeeded, ${failureCount} failed`);

  const total = successCount + failureCount;
  // Increased from 40% to 50% tolerance to handle FRED rate-limit scenarios
  // and transient API instability during recovery. Real failures (continuously
  // degraded) are caught by freshness check below. This 50% is temporary and
  // can be reduced to 40% once stability is confirmed.
  if (successCount === 0 || failureCount / total > 0.50) {
    console.error(`Too many fetch failures (${failureCount}/${total}) — aborting.`);
    process.exit(1);
  }

  // Compute EU yield curve spread from source series
  const eu10y = rawData['IRLTLT01EZM156N'] || [];
  const eu3m  = rawData['IR3TIB01EZM156N'] || [];
  rawData['EURYLDCRV'] = computeSpread(eu10y, eu3m);
  console.log(`EU yield curve spread computed: ${rawData['EURYLDCRV'].length} observations`);

  const normalized = REGISTRY.map(indicator => {
    const series = rawData[indicator.fred_id] || [];
    const result = normalizeIndicator(series, indicator);
    return { ...indicator, ...result };
  });

  // Optional GPR index reading (written by scripts/gpr.mjs when GPR_DATA_URL is
  // configured). Ignore the committed seed/demo sentinel so it never leaks into
  // a production snapshot — only a real ingested reading counts.
  let gpr = null;
  try {
    const g = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'gpr.json'), 'utf8'));
    if (g && !/seed/i.test(g.source || '')) gpr = g;
    else console.log('GPR file is the seed sentinel — using market proxy headline');
  } catch {}

  const asOf     = new Date().toISOString().slice(0, 10);
  const snapshot = buildSnapshot(normalized, asOf, { gpr });

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'current.json'), JSON.stringify(snapshot, null, 2));

  console.log('\nBuilding 24-month history...');
  const history = buildHistoryFromSeries(rawData, REGISTRY);
  await fs.writeFile(path.join(DATA_DIR, 'history.json'), JSON.stringify(history, null, 2));

  console.log('Building 30-year backtest...');
  const backtestFile = path.join(DATA_DIR, 'backtest.json');
  const backtest = await buildBacktestCached(rawData, REGISTRY, backtestFile);
  await fs.writeFile(backtestFile, JSON.stringify(backtest));

  // Model validation: score the backtest replay against NBER recession dates.
  const validation = {
    generated_at: new Date().toISOString(),
    yellow: evaluateBacktest(backtest, { flagAt: 'YELLOW' }),
    red:    evaluateBacktest(backtest, { flagAt: 'RED' })
  };
  await fs.writeFile(path.join(DATA_DIR, 'validation.json'), JSON.stringify(validation, null, 2));
  const v = validation.yellow;
  console.log(`Validation (≥YELLOW): hit ${v.hit_rate ?? '—'}, FPR ${v.false_positive_rate ?? '—'}, lead ${v.avg_lead_months ?? '—'}mo, Brier ${v.brier ?? '—'}`);

  // Out-of-sample study: optimize alert cutoffs on the older half of history,
  // freeze them, and measure skill on the held-out recent recessions.
  const oos = outOfSampleStudy(backtest);
  await fs.writeFile(path.join(DATA_DIR, 'oos.json'), JSON.stringify(oos, null, 2));
  if (oos.valid) {
    console.log(`OOS AUC: train ${oos.auc.train} → test ${oos.auc.test}  |  RED cutoff ${oos.red.train.cutoff}: J ${oos.red.train.youden_j} → ${oos.red.test.youden_j} (gap ${oos.red.generalization_gap})`);
  } else {
    console.log(`OOS study skipped: ${oos.reason}`);
  }

  // Out-of-sample layer-weight study: does tuning the composite weights on the
  // train window beat the doctrinal weights on held-out recessions?
  const weights = weightStudy(backtest, { base: LAYER_WEIGHTS });
  await fs.writeFile(path.join(DATA_DIR, 'weights.json'), JSON.stringify(weights, null, 2));
  if (weights.valid) {
    console.log(`Weight study: doctrinal test AUC ${weights.doctrinal.test_auc} vs optimized ${weights.optimized.test_auc} (gain ${weights.test_auc_gain}) — ${weights.verdict}`);
  }

  // Robustness: walk-forward folds + block-bootstrap AUC confidence interval.
  const robustness = robustnessStudy(backtest);
  await fs.writeFile(path.join(DATA_DIR, 'robustness.json'), JSON.stringify(robustness, null, 2));
  if (robustness.walk_forward.valid) {
    const wf = robustness.walk_forward.summary, b = robustness.bootstrap_auc;
    console.log(`Walk-forward: ${wf.n_folds} folds, mean test AUC ${wf.mean_test_auc} [${wf.min_test_auc}–${wf.max_test_auc}]`);
    if (b) console.log(`Bootstrap AUC: ${b.point} (95% CI ${b.ci95[0]}–${b.ci95[1]})`);
  }

  // Freshness guard: detect series that have silently stopped updating (the
  // discontinued/restructured FRED failure mode). Write a health report and
  // abort if a meaningful share of series are stale so a degraded composite
  // never ships unnoticed.
  const freshness = buildFreshnessReport(REGISTRY, rawData, new Date());
  freshness.fetch = { succeeded: successCount, failed: failureCount };
  await fs.writeFile(path.join(DATA_DIR, 'meta.json'), JSON.stringify(freshness, null, 2));

  if (freshness.stale_count || freshness.missing_count) {
    console.warn(`\n⚠ Freshness: ${freshness.stale_count} stale, ${freshness.missing_count} missing of ${freshness.total}`);
    for (const s of freshness.stale)   console.warn(`  STALE   ${s.fred_id} — last ${s.latest_date} (${s.days}d > ${s.sla}d SLA)`);
    for (const id of freshness.missing) console.warn(`  MISSING ${id} — no observations returned`);
  } else {
    console.log(`\n✓ Freshness: all ${freshness.total} series within SLA`);
  }

  const degraded = freshness.stale_count + freshness.missing_count;
  if (degraded / freshness.total > 0.15) {
    console.error(`Too many stale/missing series (${degraded}/${freshness.total} > 15%) — aborting before publish.`);
    process.exit(1);
  }

  console.log(`\nComposite: ${snapshot.composite.score} (${snapshot.composite.alert}) — Rating: ${snapshot.composite.rating}/10`);
  console.log(`Ensemble:  ${snapshot.composite.ensemble_score}`);
  console.log(`Layers:`, Object.fromEntries(Object.entries(snapshot.layers).map(([k, v]) => [k, v.score])));
}

main().catch(err => { console.error(err); process.exit(1); });
