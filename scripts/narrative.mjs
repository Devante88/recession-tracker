// Generates a daily AI-written recession risk briefing using the Anthropic API.
// Reads docs/data/current.json → calls Claude → writes docs/data/narrative.json.
// Requires ANTHROPIC_API_KEY environment variable; exits 0 (no error) if unset.

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('ANTHROPIC_API_KEY not set — skipping AI narrative');
    return;
  }

  const snapshot = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, 'current.json'), 'utf8')
  );

  const { composite, layers, indicators } = snapshot;
  const redNames    = indicators.filter(i => i.alert === 'RED')   .slice(0, 5).map(i => i.name);
  const yellowNames = indicators.filter(i => i.alert === 'YELLOW').slice(0, 4).map(i => i.name);
  const greenNames  = indicators.filter(i => i.alert === 'GREEN') .slice(0, 3).map(i => i.name);

  const probPct = snapshot.recession_probability_12mo != null
    ? (snapshot.recession_probability_12mo * 100).toFixed(1) + '%'
    : 'N/A';

  const dataContext = `
Date: ${snapshot.generated_at?.slice(0, 10)}
Composite score: ${composite.score}/100  |  Alert: ${composite.alert}  |  Rating: ${composite.rating}/10
12-month recession probability (Estrella-Mishkin): ${probPct}
Yield curve 10Y-3M: ${snapshot.yield_curve_spread?.toFixed(2) ?? 'N/A'}%  |  Days inverted: ${snapshot.yield_curve_inversion_days ?? 0}
Data confidence: ${composite.confidence != null ? Math.round(composite.confidence * 100) + '%' : 'N/A'}

Layer scores (0=no risk, 100=max risk):
${Object.entries(layers).map(([k, v]) => `  ${k.padEnd(18)} ${v.score}  [${v.alert}]`).join('\n')}

Flashing RED:    ${redNames.join(', ') || 'none'}
Elevated YELLOW: ${yellowNames.join(', ') || 'none'}
Healthy GREEN:   ${greenNames.join(', ') || 'none'}
`.trim();

  const userPrompt = `You are a senior macroeconomist writing the daily recession risk briefing for a live economic dashboard. Write exactly 3 short paragraphs — no headers, no bullet points, no markdown:

Paragraph 1 — Overall posture: Interpret the composite score and alert state in plain English. Is recession risk rising, falling, or stable? Put the number in context.

Paragraph 2 — Key drivers: Name the top 2–3 indicators driving the current reading and explain in plain English what each signals economically.

Paragraph 3 — What to watch: Identify 1–2 specific data points or events that would change the current assessment (higher OR lower risk). Be concrete.

Rules: Under 180 words total. Direct, jargon-free, no hedging about being an AI. Present tense.

Data:
${dataContext}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Anthropic API error:', res.status, body);
    process.exit(1);
  }

  const json   = await res.json();
  const text   = json.content[0].text.trim();
  const output = { generated_at: new Date().toISOString(), score: composite.score, alert: composite.alert, text };

  await fs.writeFile(path.join(DATA_DIR, 'narrative.json'), JSON.stringify(output, null, 2));
  console.log(`Narrative written (${text.split(' ').length} words): ${text.slice(0, 80)}…`);
}

main().catch(err => { console.error(err); process.exit(1); });
