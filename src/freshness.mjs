// Series freshness / staleness checks. Pure functions, no I/O.
//
// A series is "stale" when its most recent observation is older than the SLA
// window for its release cadence. This catches the silent-failure mode where a
// FRED series is discontinued or restructured (e.g. NAPM in 2016, the OECD CLI
// in 2022) but keeps returning an old final value instead of an error.

// Maximum age (days) of the latest observation before a series is stale,
// keyed by release cadence. Mirrors the dashboard's freshnessSlaDays.
//
// FRED dates an observation at the START of its period (April CPI is dated
// 2026-04-01) but publishes it weeks later (mid-May). So a perfectly current
// monthly series is routinely ~60 days "old" by this measure, and a quarterly
// one ~150 days, purely from period-start dating + normal publication lag.
// These windows therefore allow roughly two missed periods before flagging:
// loose enough to tolerate normal lag, tight enough to still catch a genuine
// silent discontinuation (e.g. a series frozen for many periods).
export function slaDays(frequency) {
  switch ((frequency || '').toLowerCase()) {
    case 'daily':     return 10;
    case 'weekly':    return 21;
    case 'monthly':   return 75;
    case 'quarterly': return 200;
    default:          return 75;
  }
}

// Whole days between two dates (asOf - latestDate). Null if either is missing.
export function daysStale(latestDate, asOf = new Date()) {
  if (!latestDate) return null;
  const last = new Date(latestDate);
  const ref  = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(last.getTime()) || Number.isNaN(ref.getTime())) return null;
  return Math.floor((ref - last) / 86400000);
}

// Classify one series. Returns { fred_id, latest_date, days, sla, stale, missing }.
export function checkSeries({ fred_id, frequency }, series, asOf = new Date()) {
  if (!Array.isArray(series) || series.length === 0) {
    return { fred_id, latest_date: null, days: null, sla: slaDays(frequency), stale: true, missing: true };
  }
  const latest = series[series.length - 1];
  const days   = daysStale(latest.date, asOf);
  const sla    = slaDays(frequency);
  return {
    fred_id,
    latest_date: latest.date,
    days,
    sla,
    stale: days !== null && days > sla,
    missing: false
  };
}

// Build a freshness report over the whole registry against fetched raw data.
// `rawData` is a map of fred_id -> series array. Returns the report object that
// fetch.mjs serializes to meta.json.
export function buildFreshnessReport(registry, rawData, asOf = new Date()) {
  const series = registry.map(ind => checkSeries(ind, rawData[ind.fred_id] || [], asOf));
  const stale   = series.filter(s => s.stale && !s.missing);
  const missing = series.filter(s => s.missing);
  return {
    as_of: (asOf instanceof Date ? asOf : new Date(asOf)).toISOString().slice(0, 10),
    total: series.length,
    fresh: series.filter(s => !s.stale).length,
    stale_count: stale.length,
    missing_count: missing.length,
    stale: stale.map(s => ({ fred_id: s.fred_id, latest_date: s.latest_date, days: s.days, sla: s.sla })),
    missing: missing.map(s => s.fred_id),
    series
  };
}
