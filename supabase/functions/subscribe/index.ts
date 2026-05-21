import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { email, phone } = await req.json();
    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error } = await supabase.from('subscribers').upsert(
      { email: email.toLowerCase().trim(), phone: phone || null },
      { onConflict: 'email', ignoreDuplicates: false }
    );
    if (error) throw error;

    // Send confirmation email via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Recession Tracker <alerts@yourdomain.com>',
          to: [email],
          subject: 'You\'re subscribed to Recession Tracker alerts',
          html: `<p>You\'ll receive an email whenever the recession risk alert changes between <strong>GREEN</strong>, <strong>YELLOW</strong>, and <strong>RED</strong>.</p>
                 <p>You can also follow the <a href="${Deno.env.get('SITE_URL') || 'https://devante88.github.io/recession-tracker'}/feed.xml">RSS feed</a> for the same updates.</p>
                 <p style="color:#888;font-size:12px">Reply to unsubscribe.</p>`
        })
      });
    }

    return new Response(JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
