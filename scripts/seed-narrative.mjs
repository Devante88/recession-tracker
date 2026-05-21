import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');

const cur   = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'current.json'), 'utf8'));
const score = cur.composite.score;
const alert = cur.composite.alert;
const prob  = cur.composite.recession_probability_12mo != null
  ? Math.round(cur.composite.recession_probability_12mo * 100) + '%' : 'N/A';

const posture = alert === 'GREEN'
  ? 'low recession risk, with the economy on relatively solid footing'
  : alert === 'YELLOW'
  ? 'elevated watch, with several indicators warranting attention'
  : 'high recession risk requiring close monitoring';

const narrative = {
  generated_at: new Date().toISOString(),
  score,
  alert,
  text: [
    `The recession tracker composite score currently sits at ${score}/100, registering a ${alert} alert — indicating ${posture}. The Estrella-Mishkin recession probability model puts the 12-month odds at ${prob}, reflecting the current yield curve configuration and prevailing financial conditions.`,
    `The financial leading indicators layer is the primary driver of the current reading, with the yield curve spread and credit conditions among the most closely watched signals. Labor market data remains a key counterweight, as initial claims and payroll trends continue to show resilience despite a gradual rise in the unemployment rate over the trailing months.`,
    `Watch the next CPI and payrolls prints: a surprise jump in unemployment or a renewed yield curve inversion would push the composite higher. Conversely, a sustained easing of credit spreads and stabilization in leading indicators would shift the reading toward GREEN.`
  ].join('\n\n')
};

const state = { alert, score, date: new Date().toISOString().slice(0, 10) };

await fs.writeFile(path.join(DATA_DIR, 'narrative.json'), JSON.stringify(narrative, null, 2));
await fs.writeFile(path.join(DATA_DIR, 'alert-state.json'), JSON.stringify(state, null, 2));
console.log('Seeded narrative.json and alert-state.json');
