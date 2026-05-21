create table if not exists public.subscribers (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  phone       text,
  confirmed   boolean not null default false,
  token       text unique not null default encode(gen_random_bytes(32), 'hex'),
  created_at  timestamptz not null default now()
);

-- Indexes
create index if not exists subscribers_token_idx on public.subscribers(token);
create index if not exists subscribers_email_idx on public.subscribers(email);

-- RLS: only service role can read
alter table public.subscribers enable row level security;
create policy "service only" on public.subscribers using (false);
