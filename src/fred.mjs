// FRED API client. Server-side only (runs in GitHub Actions, not browser).

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

/**
 * Fetch a FRED series and return time-ordered observations.
 * @param {string} fredId
 * @param {string} apiKey
 * @param {object} opts
 * @returns {Promise<Array<{date: string, value: number}>>}
 */
export async function fetchFredSeries(fredId, apiKey, opts = {}) {
  const limit = opts.limit ?? 2000;  // ~5 years of daily, much more for monthly
  const url = `${FRED_BASE}?series_id=${fredId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'recession-tracker/1.0 (github.com/Devante88/recession-tracker)' }
  });
  if (!res.ok) {
    throw new Error(`FRED fetch failed for ${fredId}: HTTP ${res.status}`);
  }
  const json = await res.json();
  const observations = json.observations || [];
  return observations
    .filter(x => x.value !== '.')
    .map(x => ({ date: x.date, value: Number(x.value) }))
    .filter(x => Number.isFinite(x.value))
    .reverse();  // ascending order
}

/**
 * Fetch all series with simple sequential calls and a small delay to be polite.
 * FRED's rate limit is generous (120 req/min) but sequential keeps us safe.
 * Returns { data, successCount, failureCount }.
 */
export async function fetchAllSeries(fredIds, apiKey, delayMs = 200) {
  const data = {};
  let successCount = 0;
  let failureCount = 0;
  for (const id of fredIds) {
    try {
      data[id] = await fetchFredSeries(id, apiKey);
      successCount++;
      console.log(`  ✓ ${id}: ${data[id].length} observations`);
    } catch (err) {
      console.error(`  ✗ ${id}: ${err.message}`);
      data[id] = [];
      failureCount++;
    }
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  }
  return { data, successCount, failureCount };
}
