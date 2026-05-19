// Entrypoint for the GitHub Actions runner.
// Reads FRED_API_KEY from env, fetches all series, computes the snapshot,
// writes data/current.json, appends to data/history.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { REGISTRY } from '../src/registry.mjs';
import { fetchAllSeries } from '../src/fred.mjs';
import { normalizeIndicator, buildSnapshot, buildHistoryFromSeries } from '../src/scoring.mjs';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');

async function main() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.error('FRED_API_KEY not set');
    process.exit(1);
  }

  console.log(`Fetching ${REGISTRY.length} series...`);
  const fredIds = REGISTRY.map(x => x.fred_id);
  const { data: rawData, successCount, failureCount } = await fetchAllSeries(fredIds, apiKey);
  console.log(`\nFetch complete: ${successCount} succeeded, ${failureCount} failed`);

  const total = successCount + failureCount;
  const MIN_SUCCESS_RATIO = 0.75;
  if (successCount === 0 || failureCount / total > (1 - MIN_SUCCESS_RATIO)) {
    console.error(`Too many fetch failures (${failureCount}/${total}) — aborting to avoid publishing a degraded snapshot.`);
    process.exit(1);
  }

  const normalized = REGISTRY.map(indicator => {
    const series = rawData[indicator.fred_id] || [];
    const result = normalizeIndicator(series, indicator);
    return { ...indicator, ...result };
  });

  const asOf = new Date().toISOString().slice(0, 10);
  const snapshot = buildSnapshot(normalized, asOf);

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    path.join(DATA_DIR, 'current.json'),
    JSON.stringify(snapshot, null, 2)
  );

  // Rebuild full 24-month history from FRED series data (rolling 36-month z-score window)
  console.log('\nBuilding 24-month history from series data...');
  const history = buildHistoryFromSeries(rawData, REGISTRY);
  await fs.writeFile(
    path.join(DATA_DIR, 'history.json'),
    JSON.stringify(history, null, 2)
  );

  // Long-horizon backtest (30 years if FRED has it). Used by /backtest.html.
  console.log('\nBuilding 30-year backtest from series data...');
  const backtest = buildHistoryFromSeries(rawData, REGISTRY, { historyMonths: 360, windowMonths: 60 });
  await fs.writeFile(
    path.join(DATA_DIR, 'backtest.json'),
    JSON.stringify(backtest)   // no pretty-printing — this file is large
  );

  console.log(`\nComposite: ${snapshot.composite.score} (${snapshot.composite.alert}) — Rating: ${snapshot.composite.rating}/10 — Confidence: ${Math.round(snapshot.composite.confidence * 100)}%`);
  console.log(`Layers:`, Object.fromEntries(
    Object.entries(snapshot.layers).map(([k, v]) => [k, v.score])
  ));
  console.log(`History entries: ${history.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
