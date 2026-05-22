// Ingests the Caldara–Iacoviello Geopolitical Risk (GPR) index into
// docs/data/gpr.json so the dashboard can use the authoritative news-based
// signal instead of only the market-transmission proxy.
//
// The GPR index is published as .xls/.dta from matteoiacoviello.com (not the
// FRED API), so we read it from a CSV mirror at GPR_DATA_URL. The CSV must have
// a date column (month/date/DATE) and a GPR column (GPR/GPRD/GPRH). Exits 0
// (no error) when GPR_DATA_URL is unset or the fetch fails — the app falls back
// to the market proxy, exactly like the optional narrative/alert steps.

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim());
  const lower  = header.map(h => h.toLowerCase());
  const dateIdx = lower.findIndex(h => ['date', 'month', 'observation_date', 'time'].includes(h));
  // Prefer the benchmark monthly GPR, then daily GPRD, then any GPR* column.
  const gprIdx = (() => {
    for (const want of ['gpr', 'gprd', 'gprh']) {
      const i = lower.indexOf(want);
      if (i >= 0) return i;
    }
    return lower.findIndex(h => h.startsWith('gpr'));
  })();
  if (dateIdx < 0 || gprIdx < 0) return [];

  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const value = Number(cells[gprIdx]);
    const date  = (cells[dateIdx] || '').trim();
    return Number.isFinite(value) && date ? { date, value } : null;
  }).filter(Boolean);
}

async function main() {
  const url = process.env.GPR_DATA_URL;
  if (!url) {
    console.log('GPR_DATA_URL not set — skipping GPR ingestion (dashboard uses market proxy)');
    return;
  }

  let series;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'recession-tracker/1.0' } });
    if (!res.ok) { console.error(`GPR fetch failed: HTTP ${res.status} — skipping`); return; }
    series = parseCsv(await res.text());
  } catch (e) {
    console.error(`GPR fetch error: ${e.message} — skipping`);
    return;
  }

  if (!series.length) { console.error('GPR CSV had no usable rows — skipping'); return; }

  series.sort((a, b) => a.date.localeCompare(b.date));
  const recent = series.slice(-36);
  const last   = series[series.length - 1];

  const out = {
    latest: last.value,
    date: last.date,
    recent,
    source: 'Caldara & Iacoviello GPR index',
    source_url: url,
    ingested_at: new Date().toISOString()
  };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'gpr.json'), JSON.stringify(out, null, 2));
  console.log(`GPR ingested: latest ${last.value} (${last.date}), ${series.length} observations`);
}

main().catch(err => { console.error(err); process.exit(1); });
