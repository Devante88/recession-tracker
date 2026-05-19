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

  if (successCount === 0) {
    console.error('All FRED fetches failed — aborting to avoid overwriting data with zeros.');
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

  console.log(`\nComposite: ${snapshot.composite.score} (${snapshot.composite.alert})`);
  console.log(`Layers:`, Object.fromEntries(
    Object.entries(snapshot.layers).map(([k, v]) => [k, v.score])
  ));
  console.log(`History entries: ${history.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
