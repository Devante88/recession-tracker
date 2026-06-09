// Snapshot integrity gate. Runs after fetch.mjs and before the git commit in
// the refresh workflow. Its job is to refuse to publish a structurally broken
// or implausible current.json, so a compromised dependency, a corrupted write,
// or a MITM on the FRED API cannot inject arbitrary data into the published
// dashboard. Pure structural/range checks — no network, no secrets.

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');
const ALERTS = new Set(['GREEN', 'YELLOW', 'ORANGE', 'RED']);

function fail(msg) {
  console.error(`✗ Snapshot integrity check failed: ${msg}`);
  process.exit(1);
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);

const raw = await fs.readFile(path.join(DATA_DIR, 'current.json'), 'utf8')
  .catch(() => fail('current.json missing or unreadable'));

let d;
try { d = JSON.parse(raw); } catch { fail('current.json is not valid JSON'); }

// Required top-level shape.
if (!d || typeof d !== 'object') fail('snapshot is not an object');
if (typeof d.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.as_of)) {
  fail(`as_of is not a YYYY-MM-DD date (got ${JSON.stringify(d.as_of)})`);
}
if (!d.composite || typeof d.composite !== 'object') fail('composite block missing');

// Composite score: a finite number in the published 0–100 range.
const score = d.composite.score;
if (!isNum(score) || score < 0 || score > 100) {
  fail(`composite.score out of range or non-numeric (got ${JSON.stringify(score)})`);
}
if (!ALERTS.has(d.composite.alert)) {
  fail(`composite.alert not one of ${[...ALERTS].join('/')} (got ${JSON.stringify(d.composite.alert)})`);
}
const rating = d.composite.rating;
if (!isNum(rating) || rating < 0 || rating > 10) {
  fail(`composite.rating out of 0–10 range (got ${JSON.stringify(rating)})`);
}

// Layers and indicators must be present and non-empty — an empty snapshot is a
// silent fetch failure we must not publish over the last good one.
if (!d.layers || typeof d.layers !== 'object' || Object.keys(d.layers).length === 0) {
  fail('layers block missing or empty');
}
if (!Array.isArray(d.indicators) || d.indicators.length === 0) {
  fail('indicators array missing or empty');
}

// Guard against a stale-dated snapshot being published: as_of should not be in
// the future, and not absurdly far in the past (clock/corruption sanity check).
const asOf = new Date(d.as_of + 'T00:00:00Z');
const now  = new Date();
const ageDays = Math.floor((now - asOf) / 86400000);
if (ageDays < -1) fail(`as_of is in the future (${d.as_of})`);
if (ageDays > 30) fail(`as_of is ${ageDays} days old (${d.as_of}) — refusing to publish a stale snapshot`);

console.log(`✓ Snapshot integrity OK — ${d.as_of}, score ${score} (${d.composite.alert}), ${d.indicators.length} indicators`);
