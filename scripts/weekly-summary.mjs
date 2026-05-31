// Send a weekly summary email via Resend every Monday.
// Reads docs/data/current.json.
// Requires RESEND_API_KEY and ALERT_EMAIL env vars; exits 0 silently if missing or not Monday.

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'docs', 'data');
const DASHBOARD_URL = 'https://devante88.github.io/recession-tracker/';

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

export function alertEmoji(state) {
  if (state === 'RED')    return '🔴';
  if (state === 'YELLOW') return '🟡';
  return '🟢';
}

export function alertColor(state) {
  if (state === 'RED')    return '#ff7a7a';
  if (state === 'YELLOW') return '#f1c84a';
  return '#2ddc8c';
}

const LAYER_NAMES = {
  financial_lead: 'Financial Leading',
  labor:          'Labor Market',
  inflation:      'Inflation',
  real_economy:   'Real Economy',
  micro:          'Micro / Business',
  global:         'Global'
};

// The weekly digest only goes out on Mondays (UTC). Returns true only when the
// given date falls on a Monday. Defaults to "now".
export function shouldSendWeekly(date = new Date()) {
  return date.getUTCDay() === 1;
}

// Build the weekly summary email HTML from a current snapshot (and optional
// narrative). Pure: no I/O, no env access — safe to unit test.
export function buildWeeklyHtml(current, narrative) {
  const composite = current.composite || {};
  const layers    = current.layers || {};
  const factors   = (current.factor_contributions || []).slice(0, 3);
  const alert     = composite.alert || 'GREEN';
  const score     = composite.score ?? '—';
  const emoji     = alertEmoji(alert);
  const color     = alertColor(alert);
  const prob      = composite.recession_probability_12mo;
  const probPct   = prob != null ? (prob * 100).toFixed(1) + '%' : 'N/A';
  const asOf      = current.as_of || new Date().toISOString().slice(0, 10);

  // Layer scores rows
  const layerRows = Object.entries(layers).map(([key, val]) => {
    const lAlert = val.alert || 'GREEN';
    const lColor = alertColor(lAlert);
    return `<tr>
      <td style="padding:8px 12px;color:#eef2ff">${LAYER_NAMES[key] || key}</td>
      <td style="padding:8px 12px;text-align:right">
        <span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;background:${lColor}22;color:${lColor}">${lAlert}</span>
      </td>
      <td style="padding:8px 12px;text-align:right;font-weight:700;color:${lColor}">${val.score}</td>
    </tr>`;
  }).join('');

  // Top risk factors rows
  const factorRows = factors.map(f =>
    `<tr>
      <td style="padding:6px 12px;color:#eef2ff">${f.name}</td>
      <td style="padding:6px 12px;text-align:right;color:${f.contrib > 0 ? '#ff7a7a' : '#2ddc8c'}">${f.contrib > 0 ? '+' : ''}${f.contrib.toFixed(2)}</td>
    </tr>`
  ).join('');

  // Narrative headline if available and recent enough
  let narrativeHtml = '';
  if (narrative?.headline && narrative?.generated_at) {
    const ageDays = (Date.now() - new Date(narrative.generated_at).getTime()) / 86400000;
    if (ageDays <= 7) {
      narrativeHtml = `
      <div style="padding:20px 28px;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="font-size:12px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px">AI Briefing Headline</div>
        <div style="font-size:16px;font-weight:700;color:#eef2ff;line-height:1.5">${narrative.headline}</div>
      </div>`;
    }
  }

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0b1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="background:#121a2f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#121a2f,#1a2340);padding:28px 28px 20px;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="font-size:13px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Weekly Recession Tracker Digest</div>
        <div style="font-size:28px;font-weight:900;color:#eef2ff">Week of ${asOf}</div>
        <div style="margin-top:8px;font-size:13px;color:#7a84a8">Current status: ${emoji} <span style="color:${color};font-weight:700">${alert}</span></div>
      </div>
      <!-- Composite -->
      <div style="padding:24px 28px;display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="flex:1;min-width:120px">
          <div style="font-size:11px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Composite Score</div>
          <div style="font-size:36px;font-weight:900;color:${color}">${score}<span style="font-size:18px;color:#7a84a8">/100</span></div>
        </div>
        <div style="flex:1;min-width:120px">
          <div style="font-size:11px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">12mo Recession Prob</div>
          <div style="font-size:36px;font-weight:900;color:#eef2ff">${probPct}</div>
        </div>
      </div>
      <!-- AI Narrative -->
      ${narrativeHtml}
      <!-- Layer scores -->
      <div style="padding:20px 28px;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="font-size:12px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Layer Scores</div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.07)">
              <th style="padding:4px 12px;text-align:left;font-size:11px;color:#7a84a8;font-weight:600">Layer</th>
              <th style="padding:4px 12px;text-align:right;font-size:11px;color:#7a84a8;font-weight:600">Alert</th>
              <th style="padding:4px 12px;text-align:right;font-size:11px;color:#7a84a8;font-weight:600">Score</th>
            </tr>
          </thead>
          <tbody>${layerRows}</tbody>
        </table>
      </div>
      <!-- Top risk factors -->
      ${factorRows ? `<div style="padding:20px 28px;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="font-size:12px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Top 3 Risk Factors</div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.07)">
              <th style="padding:4px 12px;text-align:left;font-size:11px;color:#7a84a8;font-weight:600">Indicator</th>
              <th style="padding:4px 12px;text-align:right;font-size:11px;color:#7a84a8;font-weight:600">Contribution</th>
            </tr>
          </thead>
          <tbody>${factorRows}</tbody>
        </table>
      </div>` : ''}
      <!-- CTA -->
      <div style="padding:24px 28px;text-align:center">
        <a href="${DASHBOARD_URL}" style="display:inline-block;padding:12px 28px;background:#66b3ff;color:#0b1020;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none">
          Open Dashboard →
        </a>
        <div style="margin-top:16px;font-size:12px;color:#7a84a8">
          Recession Tracker · <a href="${DASHBOARD_URL}" style="color:#66b3ff">${DASHBOARD_URL}</a>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#7a84a8">
          Generated ${new Date().toUTCString()}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

  return htmlBody;
}

async function main() {
  // Only run on Mondays
  if (!shouldSendWeekly()) {
    console.log('Not Monday — skipping weekly summary');
    process.exit(0);
  }

  const apiKey  = process.env.RESEND_API_KEY;
  const toEmail = process.env.ALERT_EMAIL;

  if (!apiKey || !toEmail) {
    console.log('RESEND_API_KEY or ALERT_EMAIL not set — skipping weekly summary');
    process.exit(0);
  }

  const current = await readJson(path.join(DATA_DIR, 'current.json'));
  if (!current) {
    console.log('No current.json found — skipping weekly summary');
    process.exit(0);
  }

  const narrative = await readJson(path.join(DATA_DIR, 'narrative.json'));

  const composite = current.composite || {};
  const alert     = composite.alert || 'GREEN';
  const score     = composite.score ?? '—';
  const emoji     = alertEmoji(alert);
  const asOf      = current.as_of || new Date().toISOString().slice(0, 10);

  const htmlBody = buildWeeklyHtml(current, narrative);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: [toEmail],
      subject: `${emoji} Weekly Recession Tracker — ${alert} · Score ${score} · ${asOf}`,
      html: htmlBody
    })
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Resend API error:', res.status, body);
    process.exit(1);
  }

  const data = await res.json();
  console.log('Weekly summary email sent:', data.id);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
