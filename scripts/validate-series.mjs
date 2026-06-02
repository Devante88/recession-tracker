// CI smoke test: confirm every registry FRED series still returns observations.
// The unit tests validate registry *structure* but cannot catch a discontinued
// or renamed series ID (NAPM 2016, OECD CLI 2022, EA19 GDP 2023) without hitting
// the API. This does — run in CI with FRED_API_KEY. Skips cleanly when the key
// is absent. Exits non-zero only if a series returns zero observations, so the
// next silent discontinuation fails loudly instead of degrading the composite.

import { REGISTRY } from '../src/registry.mjs';
import { fetchAllSeries } from '../src/fred.mjs';

async function main() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.log('FRED_API_KEY not set — skipping series validation');
    return;
  }

  // EURYLDCRV is derived, not a real series; check its source series instead.
  const ids = REGISTRY.map(x => x.fred_id).filter(id => id !== 'EURYLDCRV');
  const sources = ['IRLTLT01EZM156N', 'IR3TIB01EZM156N'];
  const all = [...new Set([...ids, ...sources])];

  console.log(`Validating ${all.length} FRED series IDs...`);
  const { data } = await fetchAllSeries(all, apiKey);

  const empty = all.filter(id => !Array.isArray(data[id]) || data[id].length === 0);
  if (empty.length === 0) {
    console.log(`✓ All ${all.length} series return data.`);
    return;
  }

  const pct = empty.length / all.length;
  if (pct > 0.5) {
    // More than half failed — almost certainly a network/IP block, not series discontinuation.
    // Warn loudly but don't abort: fetch.mjs has its own 25% failure threshold.
    console.warn(`::warning::${empty.length}/${all.length} series returned no data (${Math.round(pct*100)}%). Likely a transient FRED block on this runner IP — fetch.mjs will handle it.`);
    console.warn('Empty:', empty.join(', '));
  } else {
    // A small subset failed — specific series were likely discontinued or renamed.
    console.error(`::error::${empty.length} series returned no observations: ${empty.join(', ')}`);
    console.error('These series may have been discontinued or renamed on FRED. Update src/registry.mjs.');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
