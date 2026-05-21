// Sends a webhook notification when the composite alert state changes.
// Reads docs/data/current.json and docs/data/alert-state.json (previous state).
// POSTs a Slack-compatible JSON payload to ALERT_WEBHOOK_URL when alert changes.
// Also calls Supabase notify Edge Function to email/SMS all subscribers.
// Compatible with Slack, Discord (append /slack to webhook URL), Make.com, Zapier, n8n.
// Exits 0 if ALERT_WEBHOOK_URL is unset.

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR   = path.join(process.cwd(), 'docs', 'data');
const STATE_FILE = path.join(DATA_DIR, 'alert-state.json');
const DASHBOARD  = 'https://devante88.github.io/recession-tracker/';

const EMOJI  = { RED: '🔴', YELLOW: '🟡', GREEN: '🟢' };
const COLOR  = { RED: '#ff7a7a', YELLOW: '#f1c84a', GREEN: '#2ddc8c' };

async function main() {
  const webhookUrl  = process.env.ALERT_WEBHOOK_URL;
  const notifyUrl   = process.env.SUPABASE_NOTIFY_URL;
  const notifySecret = process.env.NOTIFY_SECRET;

  if (!webhookUrl && !notifyUrl) {
    console.log('ALERT_WEBHOOK_URL and SUPABASE_NOTIFY_URL not set — skipping alert notification');
    return;
  }

  const snapshot = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, 'current.json'), 'utf8')
  );

  const cur = {
    alert: snapshot.composite.alert,
    score: snapshot.composite.score,
    date:  snapshot.generated_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  };

  let prev = null;
  try { prev = JSON.parse(await fs.readFile(STATE_FILE, 'utf8')); } catch {}

  // Always persist latest state
  await fs.writeFile(STATE_FILE, JSON.stringify(cur, null, 2));

  if (!prev) {
    console.log(`No previous state found — baseline set to ${cur.alert} (${cur.score})`);
    return;
  }

  if (prev.alert === cur.alert) {
    console.log(`Alert unchanged: ${cur.alert} (${cur.score})`);
    return;
  }

  // State changed — fire webhook and subscriber notifications
  const e    = EMOJI[cur.alert] ?? '⚪';
  const ep   = EMOJI[prev.alert] ?? '⚪';
  const prob = snapshot.composite?.recession_probability_12mo != null
    ? `${(snapshot.composite.recession_probability_12mo * 100).toFixed(1)}%`
    : 'N/A';
  const changeDesc = `Alert changed from ${prev.alert} to ${cur.alert}. Composite score: ${cur.score}. Recession probability: ${prob}.`;

  // Fire Slack/Discord/webhook if configured
  if (webhookUrl) {
    const payload = {
      text: `${ep} → ${e}  Recession Tracker alert changed: *${prev.alert} → ${cur.alert}*`,
      attachments: [
        {
          color: COLOR[cur.alert] ?? '#7a84a8',
          fields: [
            { title: 'Previous', value: `${ep} ${prev.alert}  (score ${prev.score})`, short: true },
            { title: 'Current',  value: `${e} ${cur.alert}  (score ${cur.score})`,   short: true },
            { title: 'Recession probability (12mo)', value: prob, short: true },
            { title: 'Date', value: cur.date, short: true }
          ],
          footer: `Recession Tracker · <${DASHBOARD}|Open dashboard>`,
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log(`Webhook fired (${res.status}): ${prev.alert} → ${cur.alert}`);
    if (!res.ok) {
      const body = await res.text();
      console.error('Webhook error body:', body);
      process.exit(1);
    }
  }

  // Fire Supabase notify Edge Function to email/SMS all subscribers
  if (notifyUrl && notifySecret) {
    try {
      await fetch(notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-notify-secret': notifySecret },
        body: JSON.stringify({
          alert: cur.alert,
          score: cur.score,
          date: cur.date,
          change: changeDesc,
          prev_alert: prev.alert
        })
      });
      console.log('Subscriber notifications triggered');
    } catch (e) {
      console.error('Notify failed:', e.message);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
