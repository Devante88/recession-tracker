// Generate docs/feed.xml from history.json.
// Also writes docs/data/alert-log.json with the full state-change history.

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');
const FEED_PATH = path.join(process.cwd(), 'docs', 'feed.xml');
const SITE_URL  = 'https://devante88.github.io/recession-tracker';

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function describeChange(prev, curr) {
  if (!prev) return `Initial reading: ${curr.alert} at ${curr.composite}.`;
  const dir = curr.composite > prev.composite ? 'rose' : 'fell';
  return `Composite ${dir} from ${prev.composite} (${prev.alert}) to ${curr.composite} (${curr.alert}).`;
}

async function main() {
  let history;
  try {
    history = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'history.json'), 'utf8'));
  } catch (err) {
    console.error('Could not read history.json:', err.message);
    process.exit(1);
  }

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const items  = [];
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    if (!prev || prev.alert !== curr.alert) {
      items.push({ ...curr, change: describeChange(prev, curr) });
    }
  }

  const ordered = items.reverse().slice(0, 30);

  // Write alert-log.json for the dashboard alert history section
  const alertLog = ordered.map(it => ({
    date:   it.date,
    alert:  it.alert,
    score:  it.composite,
    change: it.change
  }));
  await fs.writeFile(path.join(DATA_DIR, 'alert-log.json'), JSON.stringify(alertLog, null, 2));
  console.log(`alert-log.json written with ${alertLog.length} entries`);

  // Write RSS feed
  const now      = new Date().toUTCString();
  const rssItems = ordered.map(it => `
    <item>
      <title>${escapeXml(`${it.alert} — composite ${it.composite} (as of ${it.date})`)}</title>
      <link>${SITE_URL}/?date=${it.date}</link>
      <guid isPermaLink="false">recession-tracker-${it.date}-${it.alert}</guid>
      <pubDate>${new Date(it.date + 'T12:00:00Z').toUTCString()}</pubDate>
      <description>${escapeXml(it.change)}</description>
    </item>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Recession Tracker — alert state changes</title>
    <link>${SITE_URL}</link>
    <description>Updates when the composite recession risk alert changes between GREEN, YELLOW, and RED.</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    ${rssItems}
  </channel>
</rss>
`;

  await fs.writeFile(FEED_PATH, xml);
  console.log(`feed.xml written with ${ordered.length} state-change items`);
}

main().catch(err => { console.error(err); process.exit(1); });
