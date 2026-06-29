-- ohmyself! — external connector connections
-- One row per (user, provider). Holds the encrypted credential (e.g. a Granola
-- API key) plus sync state and per-connection settings. The plaintext key is
-- never stored: `credential_enc` is AES-256-GCM ciphertext (see core/connections.ts).
-- The server reads/writes with the service role; RLS keeps any direct client
-- access owner-only and never exposes the credential to the browser.

create table if not exists public.connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  provider       text not null,                       -- e.g. 'granola'
  credential_enc text not null,                       -- AES-256-GCM ciphertext
  status         text not null default 'active',      -- active | error | disabled
  last_sync_at   timestamptz,
  last_error     text,
  settings       jsonb not null default '{}'::jsonb,  -- folder, visibility, autoSync, enrich, lookbackMonths
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists connections_user_idx on public.connections (user_id);
create index if not exists connections_active_idx on public.connections (status)
  where status = 'active';

drop trigger if exists connections_touch on public.connections;
create trigger connections_touch before update on public.connections
  for each row execute function public.touch_updated_at();

alter table public.connections enable row level security;

-- Owner full access for direct client reads (the credential column is only ever
-- read server-side with the service role, which bypasses RLS).
drop policy if exists connections_all_own on public.connections;
create policy connections_all_own on public.connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
