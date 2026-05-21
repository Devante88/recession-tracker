import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  // Verify secret header so only GitHub Actions can call this
  const secret = req.headers.get('x-notify-secret');
  if (secret !== Deno.env.get('NOTIFY_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { alert, score, date, change, prev_alert } = await req.json();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: subscribers } = await supabase
    .from('subscribers')
    .select('email, phone')
    .eq('confirmed', true);

  if (!subscribers?.length) return new Response('No subscribers', { status: 200 });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const siteUrl = Deno.env.get('SITE_URL') || 'https://devante88.github.io/recession-tracker';

  const alertColor = alert === 'RED' ? '#ff7a7a' : alert === 'YELLOW' ? '#f1c84a' : '#2ddc8c';
  const subject = `Recession Tracker: Alert changed to ${alert} (score: ${score})`;
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2 style="color:${alertColor}">⚠ Alert State: ${alert}</h2>
      <p>${change}</p>
      <p><strong>Composite score:</strong> ${score} &nbsp;|&nbsp; <strong>Date:</strong> ${date}</p>
      <p><a href="${siteUrl}" style="background:${alertColor};color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">View Dashboard →</a></p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="color:#888;font-size:12px">You're receiving this because you subscribed to Recession Tracker alerts. Reply to unsubscribe.</p>
    </div>`;

  // Send emails via Resend batch
  if (resendKey && subscribers.length) {
    const emails = subscribers.map((s: { email: string }) => s.email);
    // Resend supports up to 100 recipients per call
    for (let i = 0; i < emails.length; i += 100) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Recession Tracker <alerts@yourdomain.com>', to: emails.slice(i, i+100), subject, html })
      });
    }
  }

  // SMS via Twilio (optional)
  const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const twilioToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const twilioFrom = Deno.env.get('TWILIO_FROM_NUMBER');
  if (twilioSid && twilioToken && twilioFrom) {
    const phones = subscribers.filter((s: { phone: string | null }) => s.phone).map((s: { phone: string | null }) => s.phone);
    for (const phone of phones) {
      const body = `Recession Tracker: Alert → ${alert} (score ${score}). ${change} View: ${siteUrl}`;
      const auth = btoa(`${twilioSid}:${twilioToken}`);
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: twilioFrom, To: phone!, Body: body }).toString()
      });
    }
  }

  return new Response(JSON.stringify({ notified: subscribers.length }), { status: 200 });
});
