// Entrypoint for the GitHub Actions runner.
// Reads FRED_API_KEY from env, fetches all series, computes the snapshot,
// writes data/current.json, data/history.json, data/backtest.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { REGISTRY } from '../src/registry.mjs';
import { fetchAllSeries } from '../src/fred.mjs';
import { normalizeIndicator, buildSnapshot, buildHistoryFromSeries } from '../src/scoring.mjs';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');

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
  if (successCount === 0 || failureCount / total > 0.25) {
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

  const asOf     = new Date().toISOString().slice(0, 10);
  const snapshot = buildSnapshot(normalized, asOf);

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'current.json'), JSON.stringify(snapshot, null, 2));

  console.log('\nBuilding 24-month history...');
  const history = buildHistoryFromSeries(rawData, REGISTRY);
  await fs.writeFile(path.join(DATA_DIR, 'history.json'), JSON.stringify(history, null, 2));

  console.log('Building 30-year backtest...');
  const backtest = buildHistoryFromSeries(rawData, REGISTRY, { historyMonths: 360, windowMonths: 60 });
  await fs.writeFile(path.join(DATA_DIR, 'backtest.json'), JSON.stringify(backtest));

  console.log(`\nComposite: ${snapshot.composite.score} (${snapshot.composite.alert}) — Rating: ${snapshot.composite.rating}/10`);
  console.log(`Ensemble:  ${snapshot.composite.ensemble_score}`);
  console.log(`Layers:`, Object.fromEntries(Object.entries(snapshot.layers).map(([k, v]) => [k, v.score])));
}

main().catch(err => { console.error(err); process.exit(1); });
