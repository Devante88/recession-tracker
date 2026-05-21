# Setting Up Email & SMS Alerts

## Prerequisites
- [Supabase](https://supabase.com) account (free tier works)
- [Resend](https://resend.com) account (free: 3,000 emails/month)
- [Twilio](https://twilio.com) account (optional, for SMS — ~$0.01/SMS)

## Steps

### 1. Create Supabase project
1. Go to supabase.com → New project
2. Run the SQL in `supabase/migrations/001_subscribers.sql` in the SQL editor
3. Deploy Edge Functions:
   ```bash
   npx supabase functions deploy subscribe
   npx supabase functions deploy notify
   ```
4. Set Edge Function secrets:
   ```bash
   npx supabase secrets set RESEND_API_KEY=re_xxx
   npx supabase secrets set NOTIFY_SECRET=your-random-secret-string
   npx supabase secrets set SITE_URL=https://devante88.github.io/recession-tracker
   # Optional SMS:
   npx supabase secrets set TWILIO_ACCOUNT_SID=ACxxx
   npx supabase secrets set TWILIO_AUTH_TOKEN=xxx
   npx supabase secrets set TWILIO_FROM_NUMBER=+1xxxxxxxxxx
   ```

### 2. Update index.html
In `docs/index.html`, find:
```js
window.SUPABASE_SUBSCRIBE_URL = '';
```
Change to your subscribe function URL:
```js
window.SUPABASE_SUBSCRIBE_URL = 'https://YOUR_PROJECT.supabase.co/functions/v1/subscribe';
```

### 3. Set GitHub Secrets
In your repo: Settings → Secrets → Actions → New secret:
- `SUPABASE_NOTIFY_URL` = `https://YOUR_PROJECT.supabase.co/functions/v1/notify`
- `NOTIFY_SECRET` = same random string from step 1

### 4. Confirm email domain with Resend
- Go to resend.com → Domains → Add your domain
- Update the `from` address in both Edge Functions to use your domain
