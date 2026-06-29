-- ohmyself! — personal API tokens
-- Long-lived tokens users paste into MCP clients / tools (Claude, ChatGPT, etc.).
-- We store only a SHA-256 hash of the token; the plaintext is shown once on
-- creation. Each token carries a scope (public/private/secret) that caps what
-- the connected agent can read/write.

create table if not exists public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null default 'token',
  scope        visibility not null default 'secret',
  token_hash   text not null unique,
  preview      text not null default '',         -- e.g. "oms_ab12…" for display
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists api_tokens_user_idx on public.api_tokens (user_id);
create index if not exists api_tokens_hash_idx on public.api_tokens (token_hash);

alter table public.api_tokens enable row level security;

-- Owner full access. (The server resolves tokens with the service role, which
-- bypasses RLS; this policy is for any direct client access.)
drop policy if exists api_tokens_all_own on public.api_tokens;
create policy api_tokens_all_own on public.api_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
