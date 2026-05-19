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
 * Fetch all series in parallel batches. FRED allows 120 req/min; batches of 8
 * with a 500ms inter-batch pause stay well under that while cutting total fetch
 * time from ~5s (sequential) to under 1s for 24 series.
 * Returns { data, successCount, failureCount }.
 */
export async function fetchAllSeries(fredIds, apiKey, { batchSize = 8, delayMs = 500 } = {}) {
  const data = {};
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < fredIds.length; i += batchSize) {
    const batch = fredIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(id => fetchFredSeries(id, apiKey))
    );
    results.forEach((result, idx) => {
      const id = batch[idx];
      if (result.status === 'fulfilled') {
        data[id] = result.value;
        successCount++;
        console.log(`  ✓ ${id}: ${result.value.length} observations`);
      } else {
        data[id] = [];
        failureCount++;
        console.error(`  ✗ ${id}: ${result.reason.message}`);
      }
    });
    if (i + batchSize < fredIds.length && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return { data, successCount, failureCount };
}
