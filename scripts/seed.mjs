// Seeds docs/data/ with a realistic May 2026 snapshot.
// Generates synthetic 36-month series with proper mean/std so z-score
// normalization produces meaningful scores. Overwrites with live data
// on first GitHub Actions run.

import fs from 'node:fs/promises';
import path from 'node:path';
import { REGISTRY } from '../src/registry.mjs';
import { normalizeIndicator, buildSnapshot, buildHistoryFromSeries } from '../src/scoring.mjs';
import { buildFreshnessReport } from '../src/freshness.mjs';
import { evaluateBacktest } from '../src/backtest-eval.mjs';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');

// Approximate May 2026 economic conditions.
// latest: most recent FRED value (in FRED native units)
// mean:   36-month mean of the series
// std:    36-month standard deviation
const SEED = {
  // ── Financial leading ────────────────────────────────────────────────────
  // Yield curve was deeply inverted 2023-2024, now normalized positive
  T10Y3M:        { latest:  0.58,    mean: -0.40, std: 0.85 },
  T10Y2Y:        { latest:  0.42,    mean: -0.20, std: 0.70 },
  // Credit spreads tight; threshold=3.0
  BAA10YM:       { latest:  2.22,    mean:  2.55, std: 0.45 },
  // Financial conditions loose; threshold=0.5
  NFCI:          { latest: -0.40,    mean: -0.10, std: 0.30 },
  // VIX subdued (below 25 threshold); occasional spikes
  VIXCLS:        { latest: 16.8,     mean: 18.5,  std: 5.5  },
  // HY spread tight (below 5.0 threshold)
  BAMLH0A0HYM2:  { latest:  3.45,    mean:  4.15, std: 0.95 },

  // ── Labor ────────────────────────────────────────────────────────────────
  // Unemployment rose from 3.4% lows to 4.2%; z-score picks this up
  UNRATE:        { latest:  4.2,     mean:  3.78, std: 0.52 },
  // Sahm Rule: 0.23, well below 0.5 trigger
  SAHMREALTIME:  { latest:  0.23,    mean:  0.08, std: 0.17 },
  // Claims healthy; threshold=300000
  ICSA:          { latest: 219000,   mean: 234000, std: 27000 },
  // Payrolls growing steadily
  PAYEMS:        { latest: 159480,   mean: 156300, std: 2500  },
  // Quits rate still above 2.0 threshold
  JTSQUR:        { latest:  2.68,    mean:  2.90, std: 0.32  },

  // ── Inflation ────────────────────────────────────────────────────────────
  // All inflation measures declining from 2022-2023 highs
  CPIAUCSL:      { latest:  2.76,    mean:  3.65, std: 0.92  },
  CPILFESL:      { latest:  2.65,    mean:  3.35, std: 0.78  },
  PCEPI:         { latest:  2.44,    mean:  2.98, std: 0.68  },
  // Fed cut from 5.5% peak; now ~3.75%
  FEDFUNDS:      { latest:  3.75,    mean:  4.90, std: 0.78  },
  // Wages still elevated vs 3yr mean
  CES0500000003: { latest: 35.53,    mean: 34.05, std: 1.15  },

  // ── Real economy ─────────────────────────────────────────────────────────
  GDPC1:         { latest: 23105,    mean: 22380, std: 460   },
  INDPRO:        { latest:  103.4,   mean: 102.0, std: 2.6   },
  RSAFS:         { latest: 722000,   mean: 698000, std: 19000 },
  W875RX1:       { latest:  15870,   mean: 15480, std: 295   },
  // Housing subdued by elevated rates
  HOUST:         { latest:   1388,   mean:  1375, std: 158   },

  // ── Micro ────────────────────────────────────────────────────────────────
  NEWORDER:      { latest:    498.5, mean:  488,  std: 22    },
  // Lending standards easing; threshold=20
  DRTSCILM:      { latest:      8.4, mean:    5,  std: 11    },
  // Delinquency near 3.0 threshold
  DRCCLACBS:     { latest:      2.88, mean:  2.42, std: 0.52 },
  // NFIB just above 95 threshold
  NFIBOPTMI:     { latest:     97.3, mean:  99.5, std: 4.8   },
  // FRED reports in thousands; threshold=5500 (= 5.5M openings)
  JTSJOL:        { latest:   7580,   mean:  8350, std: 960   },

  // ── Real economy (WEI added) ─────────────────────────────────────────────────
  WEI:           { latest:  2.1,     mean:  1.8,  std: 1.4  },

  // ── New Tier 1 indicators ────────────────────────────────────────────────────
  T10YIE:    { latest:  2.35,   mean:  2.15,  std: 0.45  },  // TIPS breakeven
  WALCL:     { latest: 6850000, mean: 7200000, std: 680000 }, // Fed balance sheet ($M)
  UMCSENT:   { latest: 67.4,    mean: 74.2,   std: 8.5   },  // UMich sentiment, depressed
  PSAVERT:   { latest:  4.8,    mean:  5.9,   std: 1.8   },  // saving rate low
  CSUSHPISA: { latest: 318.5,   mean: 285.0,  std: 28.0  },  // Case-Shiller elevated
  PPIACO:    { latest: 272.4,   mean: 258.0,  std: 18.5  },  // PPI elevated

  // ── New Part A indicators ────────────────────────────────────────────────────
  M2SL:    { latest: 21800, mean: 20500, std: 1200 },
  CIVPART: { latest: 62.7,  mean: 62.2,  std: 0.6  },
  TCU:     { latest: 77.8,  mean: 78.5,  std: 1.4  },

  // ── New indicators (upgrade) ─────────────────────────────────────────────────
  // St. Louis Financial Stress Index: 0 = average; negative = below-average stress
  STLFSI3:  { latest: -0.42,  mean:  0.00,  std: 0.85 },
  // Building permits, SAAR thousands; broad decline leads recessions 2-3 months
  PERMIT:   { latest:  1443,  mean:  1480,  std: 210  },
  // Nominal broad trade-weighted dollar index; strong USD = global financial tightening
  DTWEXBGS: { latest: 117.0,  mean: 110.5,  std: 6.8  },

  // ── Global / International ──────────────────────────────────────────────────
  // G7 CLI: below 100 = below trend; threshold=100 (replaces OECDLOLITOAASTSAM, discontinued Nov 2022)
  G7LOLITOAASTSAM:   { latest:  99.7,  mean: 100.1, std: 0.7  },
  // EU yield curve spread (10Y - 3M, derived); threshold=0
  EURYLDCRV:         { latest:   0.72, mean:  0.15, std: 1.05 },
  // Euro area harmonized unemployment; z-score
  LRHUTTTTEZM156S:   { latest:   6.5,  mean:  7.1,  std: 0.8  },
  // Euro area real GDP, chained 2010 EUR millions (ECB/Eurostat, replaces frozen NAEXKP01EZQ661S)
  CLVMNACSCAB1GQEA:  { latest: 2886191, mean: 2750000, std: 95000 },
};

/**
 * Build a 36-month series ending at `latest`, with historical values
 * normalized to exactly the target mean and std. This ensures z-score
 * normalization produces predictable scores.
 */
// Days since the snapshot's as_of that a series of the given cadence would
// realistically have last reported. Keeps the seeded demo's freshness card
// truthful instead of flagging every series as stale.
function latestLagDays(frequency) {
  switch ((frequency || '').toLowerCase()) {
    case 'daily':     return 1;
    case 'weekly':    return 4;
    case 'monthly':   return 0;
    case 'quarterly': return 0;
    default:          return 0;
  }
}

function makeSeries(fredId, frequency = 'monthly') {
  const { latest, mean, std } = SEED[fredId];
  const MONTHS = 48; // 4 years — enough for 24-month history with 36-month z-score window
  const now = new Date('2026-05-01');

  // Generate MONTHS-1 raw pseudo-random values using deterministic hash
  const raw = [];
  for (let i = 1; i < MONTHS; i++) {
    const h = Math.sin(i * 2.9 + fredId.charCodeAt(0) * 0.7)   * 0.6
            + Math.sin(i * 1.1 + fredId.charCodeAt(fredId.length - 1) * 1.3) * 0.4;
    raw.push(h);
  }

  // Normalize raw values to mean=0, std=1
  const rawMean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const rawStd  = Math.sqrt(raw.reduce((a, b) => a + (b - rawMean) ** 2, 0) / raw.length) || 1;
  const normalized = raw.map(v => (v - rawMean) / rawStd);

  // Scale to target distribution and build dated series
  const series = normalized.map((n, idx) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (MONTHS - 1 - idx));
    return { date: d.toISOString().slice(0, 7) + '-01', value: Number((mean + n * std).toFixed(4)) };
  });

  // Append the true latest value, dated by the series' release cadence relative
  // to the as_of date (2026-05-19) so daily/weekly series look freshly reported.
  const latestDate = new Date('2026-05-19');
  latestDate.setDate(latestDate.getDate() - latestLagDays(frequency));
  series.push({ date: latestDate.toISOString().slice(0, 10), value: latest });
  return series;
}

async function main() {
  const normalized = REGISTRY.map(indicator => {
    const series = SEED[indicator.fred_id] ? makeSeries(indicator.fred_id, indicator.frequency) : [];
    const result = normalizeIndicator(series, indicator);
    return { ...indicator, ...result };
  });

  const snapshot = buildSnapshot(normalized, '2026-05-19');

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'current.json'), JSON.stringify(snapshot, null, 2));

  // Prior snapshot: rebuild with each series' final (latest) observation dropped,
  // approximating last month's reading. Lets the "What Changed" panel show a real
  // diff on the seeded demo. In production the workflow archives the prior run.
  const prevNormalized = REGISTRY.map(indicator => {
    const full = SEED[indicator.fred_id] ? makeSeries(indicator.fred_id, indicator.frequency) : [];
    const series = full.slice(0, -1);
    const result = normalizeIndicator(series, indicator);
    return { ...indicator, ...result };
  });
  const prevSnapshot = buildSnapshot(prevNormalized, '2026-04-19');
  await fs.writeFile(path.join(DATA_DIR, 'previous.json'), JSON.stringify(prevSnapshot, null, 2));

  // Build 24-month computed history from the synthetic series
  const rawData = Object.fromEntries(
    REGISTRY.map(ind => [ind.fred_id, SEED[ind.fred_id] ? makeSeries(ind.fred_id, ind.frequency) : []])
  );
  const history = buildHistoryFromSeries(rawData, REGISTRY);

  await fs.writeFile(path.join(DATA_DIR, 'history.json'), JSON.stringify(history, null, 2));

  // Long backtest: synthetic seed only goes back 4 years so this matches.
  // In production, fetch.mjs writes 30 years here.
  const backtest = buildHistoryFromSeries(rawData, REGISTRY, { historyMonths: 36, windowMonths: 24 });
  await fs.writeFile(path.join(DATA_DIR, 'backtest.json'), JSON.stringify(backtest));

  // Model validation against NBER recessions (degenerate on the 3-year synthetic
  // seed since no NBER recession falls in range; production replays 30 years).
  const validation = {
    generated_at: new Date().toISOString(),
    yellow: evaluateBacktest(backtest, { flagAt: 'YELLOW' }),
    red:    evaluateBacktest(backtest, { flagAt: 'RED' })
  };
  await fs.writeFile(path.join(DATA_DIR, 'validation.json'), JSON.stringify(validation, null, 2));

  // Alert log: state transitions from history, newest first
  const alertLog = [];
  let prevAlert = null;
  for (const snap of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    if (snap.alert !== prevAlert) {
      if (prevAlert !== null) {
        alertLog.push({ date: snap.date, alert: snap.alert, score: snap.composite, change: `${prevAlert} → ${snap.alert}` });
      }
      prevAlert = snap.alert;
    }
  }
  await fs.writeFile(path.join(DATA_DIR, 'alert-log.json'), JSON.stringify(alertLog.reverse(), null, 2));

  // Freshness report (mirrors production fetch.mjs) — dates are seeded by cadence
  const freshness = buildFreshnessReport(REGISTRY, rawData, new Date('2026-05-19'));
  freshness.fetch = { succeeded: REGISTRY.length, failed: 0 };
  await fs.writeFile(path.join(DATA_DIR, 'meta.json'), JSON.stringify(freshness, null, 2));

  // Print summary
  console.log(`\nComposite: ${snapshot.composite.score} (${snapshot.composite.alert})\n`);
  console.log('Layers:');
  for (const [layer, data] of Object.entries(snapshot.layers)) {
    const bar = '█'.repeat(Math.round(data.score / 5));
    console.log(`  ${layer.padEnd(18)} ${String(data.score).padStart(5)}  ${bar}  [${data.alert}]`);
  }
  console.log('\nIndicators:');
  for (const ind of snapshot.indicators) {
    const flag = ind.alert === 'RED' ? '🔴' : ind.alert === 'YELLOW' ? '🟡' : '🟢';
    console.log(`  ${flag} ${ind.name.padEnd(32)} ${String(ind.score).padStart(5)}  latest=${ind.latest_value}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
