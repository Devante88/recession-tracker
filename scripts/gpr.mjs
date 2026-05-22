// Ingests the Caldara–Iacoviello Geopolitical Risk (GPR) index into
// docs/data/gpr.json so the dashboard can use the authoritative news-based
// signal instead of only the market-transmission proxy.
//
// Source is set via GPR_DATA_URL. Both the authors' native .xlsx export and a
// plain .csv mirror are supported (format auto-detected by the ZIP magic), so
// no spreadsheet dependency is needed — the .xlsx is unzipped with src/xlsx.mjs
// using Node's built-in zlib. The file must have a date column (month/date/...)
// and a GPR column (GPR/GPRD/GPRH). Exits 0 (no error) when GPR_DATA_URL is
// unset or the fetch fails — the app falls back to the market proxy, exactly
// like the optional narrative/alert steps.

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseXlsx } from '../src/xlsx.mjs';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');

// Map a rows-of-cells table (header + data) to [{ date, value }].
function rowsToSeries(rows) {
  if (!rows || rows.length < 2) return [];
  const header = rows[0].map(h => String(h).trim().toLowerCase());
  const dateIdx = header.findIndex(h => ['date', 'month', 'observation_date', 'time', 'yearmonth'].includes(h));
  const gprIdx = (() => {
    for (const want of ['gpr', 'gprd', 'gprh']) {
      const i = header.indexOf(want);
      if (i >= 0) return i;
    }
    return header.findIndex(h => h.startsWith('gpr'));
  })();
  if (dateIdx < 0 || gprIdx < 0) return [];

  return rows.slice(1).map(r => {
    const value = Number(r[gprIdx]);
    const date = String(r[dateIdx] ?? '').trim();
    return Number.isFinite(value) && date ? { date, value } : null;
  }).filter(Boolean);
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).filter(Boolean).map(line => line.split(','));
  return rowsToSeries(rows);
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
    const buf = Buffer.from(await res.arrayBuffer());
    const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50; // PK\x03\x04 → xlsx
    series = isZip ? rowsToSeries(parseXlsx(buf)) : parseCsv(buf.toString('utf8'));
  } catch (e) {
    console.error(`GPR fetch/parse error: ${e.message} — skipping`);
    return;
  }

  if (!series.length) { console.error('GPR source had no usable rows — skipping'); return; }

  series.sort((a, b) => a.date.localeCompare(b.date));
  const last = series[series.length - 1];
  const out = {
    latest: last.value,
    date: last.date,
    recent: series.slice(-36),
    source: 'Caldara & Iacoviello GPR index',
    source_url: url,
    ingested_at: new Date().toISOString()
  };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, 'gpr.json'), JSON.stringify(out, null, 2));
  console.log(`GPR ingested: latest ${last.value} (${last.date}), ${series.length} observations`);
}

main().catch(err => { console.error(err); process.exit(1); });
