// FRED API client. Server-side only (runs in GitHub Actions, not browser).

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

/**
 * Fetch a FRED series and return time-ordered observations.
 * Implements exponential backoff with jitter for 429 rate-limit responses.
 * @param {string} fredId
 * @param {string} apiKey
 * @param {object} opts
 * @returns {Promise<Array<{date: string, value: number}>>}
 */
export async function fetchFredSeries(fredId, apiKey, opts = {}) {
  const limit = opts.limit ?? 2000;
  const url = `${FRED_BASE}?series_id=${fredId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const headers = { 'User-Agent': 'recession-tracker/1.0 (github.com/Devante88/recession-tracker)' };

  for (let attempt = 1; attempt <= 5; attempt++) {
    let res;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        res = await fetch(url, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch (netErr) {
      if (attempt < 5) { 
        const baseWait = Math.pow(2, attempt - 1) * 1000;
        const jitter = Math.random() * 500;
        await new Promise(r => setTimeout(r, baseWait + jitter)); 
        continue; 
      }
      throw new Error(`FRED network error for ${fredId}: ${netErr.message}`);
    }

    if (res.status === 429) {
      // Exponential backoff: 1s, 2s, 4s, 8s with jitter
      const baseWait = Math.pow(2, attempt - 1) * 1000;
      const jitter = Math.random() * 500;
      const wait = baseWait + jitter;
      console.warn(`  Rate limited on ${fredId}, waiting ${Math.round(wait)}ms (attempt ${attempt}/5)...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 4xx errors (except 429) are likely permanent; don't retry
      if (res.status >= 400 && res.status < 500) {
        console.warn(`  HTTP ${res.status} for ${fredId} — permanent error, skipping`);
        return [];
      }
      // 5xx errors are transient; retry
      if (attempt < 5) {
        const baseWait = Math.pow(2, attempt - 1) * 1000;
        const jitter = Math.random() * 500;
        await new Promise(r => setTimeout(r, baseWait + jitter));
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${fredId} — ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    return (json.observations || [])
      .filter(x => x.value !== '.')
      .map(x => ({ date: x.date, value: Number(x.value) }))
      .filter(x => Number.isFinite(x.value))
      .reverse();
  }
  throw new Error(`FRED fetch failed for ${fredId} after 5 attempts`);
}

/**
 * Fetch all series with serial throttling. FRED allows 120 req/min;
 * serial requests with 600ms inter-request delay respects that ceiling.
 * Returns { data, successCount, failureCount }.
 * 
 * Retry strategy per series:
 * - 5 attempts with exponential backoff (1s → 2s → 4s → 8s → 16s)
 * - 429 rate-limit errors: backoff and retry
 * - 4xx permanent errors (401, 404, etc): skip (return empty array)
 * - 5xx transient errors (502, 503, etc): retry with backoff
 * - Network timeouts (15s per request): retry with backoff
 * 
 * Failure tolerance: Job succeeds if <50% of series fail
 * (increased from 40% for resilience during FRED API instability)
 * Real data degradation caught by freshness SLA check (15% threshold)
 */
export async function fetchAllSeries(fredIds, apiKey, { delayMs = 600 } = {}) {
  const data = {};
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < fredIds.length; i++) {
    const id = fredIds[i];
    try {
      const result = await fetchFredSeries(id, apiKey);
      data[id] = result;
      successCount++;
      console.log(`  ✓ ${id}: ${result.length} observations`);
    } catch (err) {
      data[id] = [];
      failureCount++;
      console.error(`  ✗ ${id}: ${err.message}`);
    }
    
    // Throttle between requests to respect FRED's 120 req/min limit (~500ms minimum)
    // Using 600ms provides safety margin for processing overhead
    if (i < fredIds.length - 1 && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return { data, successCount, failureCount };
}
