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
  if (!composite || !Array.isArray(indicators)) {
    console.error('current.json is missing composite or indicators — skipping narrative');
    return;
  }
  const redNames    = indicators.filter(i => i.alert === 'RED')   .slice(0, 5).map(i => i.name);
  const yellowNames = indicators.filter(i => i.alert === 'YELLOW').slice(0, 4).map(i => i.name);
  const greenNames  = indicators.filter(i => i.alert === 'GREEN') .slice(0, 3).map(i => i.name);

  const probPct = composite.recession_probability_12mo != null
    ? (composite.recession_probability_12mo * 100).toFixed(1) + '%'
    : 'N/A';

  const dataContext = `
Date: ${snapshot.generated_at?.slice(0, 10)}
Composite score: ${composite.score}/100  |  Alert: ${composite.alert}  |  Rating: ${composite.rating}/10
12-month recession probability (Estrella-Mishkin): ${probPct}
Yield curve 10Y-3M: ${composite.yield_curve_spread?.toFixed(2) ?? 'N/A'}%  |  Days inverted: ${composite.yield_curve_inversion_days ?? 0}
Data confidence: ${composite.confidence != null ? Math.round(composite.confidence * 100) + '%' : 'N/A'}

Layer scores (0=no risk, 100=max risk):
${Object.entries(layers).map(([k, v]) => `  ${k.padEnd(18)} ${v.score}  [${v.alert}]`).join('\n')}

Flashing RED:    ${redNames.join(', ') || 'none'}
Elevated YELLOW: ${yellowNames.join(', ') || 'none'}
Healthy GREEN:   ${greenNames.join(', ') || 'none'}
`.trim();

  const userPrompt = `You are a senior macroeconomist writing the daily recession risk briefing for a live economic dashboard.

Return ONLY a JSON object with exactly this structure (no markdown fences, no extra keys):
{
  "headline": "One-sentence headline summarizing current recession risk posture",
  "risks": [
    "Risk bullet 1: specific indicator or trend driving elevated risk",
    "Risk bullet 2: second key risk factor",
    "Risk bullet 3: third key risk factor or watch item"
  ],
  "opportunity": "One sentence: what would reduce recession risk or signals of resilience",
  "summary": "2-3 sentences of plain-English synthesis covering the overall picture and what to watch next"
}

Rules: Direct, jargon-free, present tense. Each risks bullet 15-25 words. Headline under 20 words. Summary under 80 words. No hedging about being an AI.

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
      max_tokens: 600,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Anthropic API error:', res.status, body);
    process.exit(1);
  }

  const json     = await res.json();
  const rawText  = json.content[0].text.trim();

  // Parse structured JSON response
  let structured;
  try {
    // Strip markdown code fences if present
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    structured = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('Failed to parse structured narrative JSON, falling back to plain text:', parseErr.message);
    // Fallback: wrap plain text in structured format
    structured = {
      headline: `Recession Risk: ${composite.alert} (${composite.score}/100)`,
      risks: [rawText.slice(0, 120)],
      opportunity: '',
      summary: rawText
    };
  }

  const output = {
    generated_at: new Date().toISOString(),
    score: composite.score,
    alert: composite.alert,
    // Keep legacy text field for backwards compatibility
    text: structured.summary || rawText,
    headline: structured.headline || '',
    risks: Array.isArray(structured.risks) ? structured.risks : [],
    opportunity: structured.opportunity || '',
    summary: structured.summary || ''
  };

  await fs.writeFile(path.join(DATA_DIR, 'narrative.json'), JSON.stringify(output, null, 2));
  console.log(`Narrative written: ${(output.headline || output.text).slice(0, 80)}…`);
}

main().catch(err => { console.error(err); process.exit(1); });
