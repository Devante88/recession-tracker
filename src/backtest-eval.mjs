// Backtest evaluation against NBER-dated US recessions. Pure functions, no I/O.
//
// Turns the composite backtest replay into measurable forecast skill: hit rate,
// false-positive rate, average lead time, and a Brier score. This is what makes
// the model's confidence *earned* rather than asserted — the alert thresholds
// and layer weights are doctrinal, so we report how they actually perform.

// NBER business-cycle peak→trough dates (recession months inclusive).
export const NBER_RECESSIONS = [
  { start: '1990-07', end: '1991-03', label: '1990–91' },
  { start: '2001-03', end: '2001-11', label: '2001 (dot-com)' },
  { start: '2007-12', end: '2009-06', label: '2007–09 (GFC)' },
  { start: '2020-02', end: '2020-04', label: '2020 (COVID)' }
];

const ym = d => (d || '').slice(0, 7);

export function inRecession(date, recessions = NBER_RECESSIONS) {
  const m = ym(date);
  return recessions.some(r => m >= r.start && m <= r.end);
}

// Add `months` to a YYYY-MM string.
function addMonths(yyyymm, months) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

const ALERT_RANK = { GREEN: 0, YELLOW: 1, RED: 2 };

/**
 * Evaluate a backtest series against NBER recessions.
 *
 * @param entries  Array of { date, composite, alert } (any order)
 * @param opts.flagAt   Minimum alert that counts as a "recession flag" (default YELLOW)
 * @param opts.leadWindow  Months before a recession start to credit early warning (default 12)
 * @returns { months, recession_months, expansion_months, hit_rate, false_positive_rate,
 *            precision, avg_lead_months, brier, episodes: [...], flag_level }
 */
export function evaluateBacktest(entries, { flagAt = 'YELLOW', leadWindow = 12, recessions = NBER_RECESSIONS } = {}) {
  const rows = (entries || [])
    .filter(e => e && e.date && typeof e.composite === 'number')
    .map(e => ({ m: ym(e.date), composite: e.composite, alert: e.alert, flagged: ALERT_RANK[e.alert] >= ALERT_RANK[flagAt] }))
    .sort((a, b) => a.m.localeCompare(b.m));

  if (!rows.length) {
    return { months: 0, recession_months: 0, expansion_months: 0, hit_rate: null,
             false_positive_rate: null, precision: null, avg_lead_months: null, brier: null,
             episodes: [], flag_level: flagAt, coverage: [] };
  }

  // Confusion matrix over every replayed month.
  let tp = 0, fp = 0, tn = 0, fn = 0, brierSum = 0;
  for (const r of rows) {
    const truth = inRecession(r.m, recessions);
    if (truth && r.flagged) tp++;
    else if (truth && !r.flagged) fn++;
    else if (!truth && r.flagged) fp++;
    else tn++;
    const p = Math.min(1, Math.max(0, r.composite / 100));
    brierSum += (p - (truth ? 1 : 0)) ** 2;
  }

  // Per-recession coverage + lead time. Lead = months of continuous flagging
  // immediately before the recession start (capped at leadWindow).
  const byMonth = new Map(rows.map(r => [r.m, r]));
  const span = { first: rows[0].m, last: rows[rows.length - 1].m };
  const episodes = [];
  for (const rec of recessions) {
    if (rec.end < span.first || rec.start > span.last) continue; // outside replay window
    const recMonths = rows.filter(r => r.m >= rec.start && r.m <= rec.end);
    if (!recMonths.length) continue;
    const flaggedDuring = recMonths.filter(r => r.flagged).length;

    let lead = 0;
    for (let i = 1; i <= leadWindow; i++) {
      const prev = byMonth.get(addMonths(rec.start, -i));
      if (prev && prev.flagged) lead = i;
      else break;
    }
    episodes.push({
      label: rec.label,
      start: rec.start,
      flagged_share: Number((flaggedDuring / recMonths.length).toFixed(2)),
      detected: flaggedDuring > 0,
      lead_months: lead
    });
  }

  const detected = episodes.filter(e => e.detected);
  const recMonths = tp + fn;
  const expMonths = fp + tn;

  return {
    flag_level: flagAt,
    months: rows.length,
    span,
    recession_months: recMonths,
    expansion_months: expMonths,
    hit_rate: recMonths ? Number((tp / recMonths).toFixed(3)) : null,
    false_positive_rate: expMonths ? Number((fp / expMonths).toFixed(3)) : null,
    precision: (tp + fp) ? Number((tp / (tp + fp)).toFixed(3)) : null,
    avg_lead_months: detected.length ? Number((detected.reduce((a, e) => a + e.lead_months, 0) / detected.length).toFixed(1)) : null,
    brier: Number((brierSum / rows.length).toFixed(4)),
    confusion: { tp, fp, tn, fn },
    episodes
  };
}
