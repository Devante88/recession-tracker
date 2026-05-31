// Send an email alert via Resend when the composite alert state changes.
// Reads docs/data/current.json and docs/data/previous.json.
// Requires RESEND_API_KEY and ALERT_EMAIL env vars; exits 0 silently if missing.

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

// True only when the composite alert state actually differs from the previous
// snapshot — the gate that decides whether an alert email is worth sending.
export function stateChanged(current, previous) {
  return current?.composite?.alert !== previous?.composite?.alert;
}

// Build the alert email HTML from a current snapshot (and optional previous).
// Pure: no I/O, no env access — safe to unit test.
export function buildAlertEmailHtml(current, previous) {
  const currentAlert  = current.composite?.alert;
  const previousAlert = previous?.composite?.alert;

  const score    = current.composite?.score ?? '—';
  const ensemble = current.composite?.ensemble_score ?? '—';
  const prob     = current.composite?.recession_probability_12mo;
  const probPct  = prob != null ? (prob * 100).toFixed(1) + '%' : 'N/A';

  // Top 3 factor contributions
  const factors = (current.factor_contributions || []).slice(0, 3);
  const factorRows = factors.map(f =>
    `<tr>
      <td style="padding:6px 12px;color:#eef2ff">${f.name}</td>
      <td style="padding:6px 12px;text-align:right;color:${f.contrib > 0 ? '#ff7a7a' : '#2ddc8c'}">${f.contrib > 0 ? '+' : ''}${f.contrib.toFixed(2)}</td>
      <td style="padding:6px 12px;text-align:right;color:#7a84a8">${f.score}/100</td>
    </tr>`
  ).join('');

  const emoji = alertEmoji(currentAlert);
  const color = alertColor(currentAlert);
  const prevEmoji = previousAlert ? alertEmoji(previousAlert) : '—';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0b1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="background:#121a2f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#121a2f,#1a2340);padding:28px 28px 20px;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="font-size:13px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Recession Tracker Alert</div>
        <div style="font-size:28px;font-weight:900;color:#eef2ff">${emoji} Status changed to <span style="color:${color}">${currentAlert}</span></div>
        <div style="margin-top:8px;font-size:13px;color:#7a84a8">${prevEmoji} Previous: ${previousAlert ?? 'first run'}</div>
      </div>
      <!-- Score -->
      <div style="padding:24px 28px;display:flex;gap:20px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="flex:1;min-width:120px">
          <div style="font-size:11px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Composite Score</div>
          <div style="font-size:36px;font-weight:900;color:${color}">${score}<span style="font-size:18px;color:#7a84a8">/100</span></div>
        </div>
        <div style="flex:1;min-width:120px">
          <div style="font-size:11px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Ensemble Score</div>
          <div style="font-size:36px;font-weight:900;color:#eef2ff">${ensemble}<span style="font-size:18px;color:#7a84a8">/100</span></div>
        </div>
        <div style="flex:1;min-width:120px">
          <div style="font-size:11px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">12mo Recession Prob</div>
          <div style="font-size:36px;font-weight:900;color:#eef2ff">${probPct}</div>
        </div>
      </div>
      <!-- Top factors -->
      ${factorRows ? `<div style="padding:20px 28px;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="font-size:12px;color:#7a84a8;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Top Factor Contributions</div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid rgba(255,255,255,0.07)">
              <th style="padding:4px 12px;text-align:left;font-size:11px;color:#7a84a8;font-weight:600">Indicator</th>
              <th style="padding:4px 12px;text-align:right;font-size:11px;color:#7a84a8;font-weight:600">Contribution</th>
              <th style="padding:4px 12px;text-align:right;font-size:11px;color:#7a84a8;font-weight:600">Score</th>
            </tr>
          </thead>
          <tbody>${factorRows}</tbody>
        </table>
      </div>` : ''}
      <!-- CTA -->
      <div style="padding:24px 28px;text-align:center">
        <a href="${DASHBOARD_URL}" style="display:inline-block;padding:12px 28px;background:#66b3ff;color:#0b1020;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none">
          View Full Dashboard →
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
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.ALERT_EMAIL;

  if (!apiKey || !toEmail) {
    console.log('RESEND_API_KEY or ALERT_EMAIL not set — skipping email alert');
    process.exit(0);
  }

  const current  = await readJson(path.join(DATA_DIR, 'current.json'));
  const previous = await readJson(path.join(DATA_DIR, 'previous.json'));

  if (!current) {
    console.log('No current.json found — skipping email alert');
    process.exit(0);
  }

  const currentAlert  = current.composite?.alert;
  const previousAlert = previous?.composite?.alert;

  if (!stateChanged(current, previous)) {
    console.log(`No alert state change (${currentAlert}) — skipping email`);
    process.exit(0);
  }

  console.log(`Alert state changed: ${previousAlert ?? 'none'} → ${currentAlert}`);

  const emoji    = alertEmoji(currentAlert);
  const htmlBody = buildAlertEmailHtml(current, previous);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: [toEmail],
      subject: `${emoji} Recession Alert: Status changed to ${currentAlert}`,
      html: htmlBody
    })
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Resend API error:', res.status, body);
    process.exit(1);
  }

  const data = await res.json();
  console.log('Email alert sent:', data.id);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
