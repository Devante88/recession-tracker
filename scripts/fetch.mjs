// Entrypoint for the GitHub Actions runner.
// Reads FRED_API_KEY from env, fetches all series, computes the snapshot,
// writes data/current.json, appends to data/history.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { REGISTRY } from '../src/registry.mjs';
import { fetchAllSeries } from '../src/fred.mjs';
import { normalizeIndicator, buildSnapshot } from '../src/scoring.mjs';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');

async function main() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.error('FRED_API_KEY not set');
    process.exit(1);
  }

  console.log(`Fetching ${REGISTRY.length} series...`);
  const fredIds = REGISTRY.map(x => x.fred_id);
  const rawData = await fetchAllSeries(fredIds, apiKey);

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

  // Append to history (compact form: just date + composite + layer scores)
  const historyPath = path.join(DATA_DIR, 'history.json');
  let history = [];
  try {
    const raw = await fs.readFile(historyPath, 'utf-8');
    history = JSON.parse(raw);
  } catch {
    history = [];
  }

  const historyEntry = {
    date: snapshot.as_of,
    composite: snapshot.composite.score,
    alert: snapshot.composite.alert,
    layers: Object.fromEntries(
      Object.entries(snapshot.layers).map(([k, v]) => [k, v.score])
    )
  };

  // Replace today's entry if it exists (idempotent), else append
  const idx = history.findIndex(x => x.date === historyEntry.date);
  if (idx >= 0) history[idx] = historyEntry;
  else history.push(historyEntry);

  await fs.writeFile(historyPath, JSON.stringify(history, null, 2));

  console.log(`Composite: ${snapshot.composite.score} (${snapshot.composite.alert})`);
  console.log(`Layers:`, snapshot.layers);
  console.log(`History entries: ${history.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
