// Seeds docs/data/ with a realistic May 2026 snapshot.
// Generates synthetic 36-month series with proper mean/std so z-score
// normalization produces meaningful scores. Overwrites with live data
// on first GitHub Actions run.

import fs from 'node:fs/promises';
import path from 'node:path';
import { REGISTRY } from '../src/registry.mjs';
import { normalizeIndicator, buildSnapshot, buildHistoryFromSeries } from '../src/scoring.mjs';

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
};

/**
 * Build a 36-month series ending at `latest`, with historical values
 * normalized to exactly the target mean and std. This ensures z-score
 * normalization produces predictable scores.
 */
function makeSeries(fredId) {
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

  // Append the true latest value
  series.push({ date: '2026-05-01', value: latest });
  return series;
}

async function main() {
  const normalized = REGISTRY.map(indicator => {
    const series = SEED[indicator.fred_id] ? makeSeries(indicator.fred_id) : [];
    const result = normalizeIndicator(series, indicator);
    return { ...indicator, ...result };
  });

  const snapshot = buildSnapshot(normalized, '2026-05-19');

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'current.json'), JSON.stringify(snapshot, null, 2));

  // Build 24-month computed history from the synthetic series
  const rawData = Object.fromEntries(
    REGISTRY.map(ind => [ind.fred_id, SEED[ind.fred_id] ? makeSeries(ind.fred_id) : []])
  );
  const history = buildHistoryFromSeries(rawData, REGISTRY);

  await fs.writeFile(path.join(DATA_DIR, 'history.json'), JSON.stringify(history, null, 2));

  // Long backtest: synthetic seed only goes back 4 years so this matches.
  // In production, fetch.mjs writes 30 years here.
  const backtest = buildHistoryFromSeries(rawData, REGISTRY, { historyMonths: 36, windowMonths: 24 });
  await fs.writeFile(path.join(DATA_DIR, 'backtest.json'), JSON.stringify(backtest));

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
