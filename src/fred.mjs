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
  const limit = opts.limit ?? 2000;
  const url = `${FRED_BASE}?series_id=${fredId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const headers = { 'User-Agent': 'recession-tracker/1.0 (github.com/Devante88/recession-tracker)' };

  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (netErr) {
      if (attempt < 3) { await new Promise(r => setTimeout(r, attempt * 1500)); continue; }
      throw new Error(`FRED network error for ${fredId}: ${netErr.message}`);
    }

    if (res.status === 429) {
      const wait = attempt * 5000;
      console.warn(`  Rate limited on ${fredId}, waiting ${wait}ms (attempt ${attempt}/3)...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} for ${fredId} — ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    return (json.observations || [])
      .filter(x => x.value !== '.')
      .map(x => ({ date: x.date, value: Number(x.value) }))
      .filter(x => Number.isFinite(x.value))
      .reverse();
  }
  throw new Error(`FRED fetch failed for ${fredId} after 3 attempts`);
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
