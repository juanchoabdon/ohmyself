-- ohmyself! — OAuth 2.1 authorization server
-- Self-hosted AS so the MCP server can be an official Claude / ChatGPT connector.
-- Supports Dynamic Client Registration (RFC 7591), Authorization Code + PKCE
-- (S256), and refresh-token rotation. Secrets (codes + tokens) are stored only
-- as SHA-256 hashes. All tables are server-managed via the service role; RLS is
-- enabled with no permissive policies so anon/authenticated clients can't read
-- them directly.

-- Clients registered dynamically by MCP clients (Claude, ChatGPT, …).
create table if not exists public.oauth_clients (
  client_id                 text primary key,
  client_name               text not null default 'MCP client',
  redirect_uris             text[] not null default '{}',
  grant_types               text[] not null default '{authorization_code,refresh_token}',
  token_endpoint_auth_method text not null default 'none',
  created_at                timestamptz not null default now()
);

-- Short-lived, single-use authorization codes bound to a PKCE challenge.
create table if not exists public.oauth_auth_codes (
  code_hash             text primary key,
  client_id             text not null,
  user_id               uuid not null references auth.users (id) on delete cascade,
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  scope                 visibility not null default 'private',
  expires_at            timestamptz not null,
  used                  boolean not null default false,
  created_at            timestamptz not null default now()
);

create index if not exists oauth_auth_codes_expiry_idx on public.oauth_auth_codes (expires_at);

-- Access (oma_) + refresh (omr_) tokens. `scope` is the effective brain scope
-- the user consented to (caps what the connected agent can read/write).
create table if not exists public.oauth_tokens (
  token_hash    text primary key,
  kind          text not null check (kind in ('access', 'refresh')),
  client_id     text not null,
  user_id       uuid not null references auth.users (id) on delete cascade,
  scope         visibility not null default 'private',
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists oauth_tokens_user_idx on public.oauth_tokens (user_id);
create index if not exists oauth_tokens_client_idx on public.oauth_tokens (client_id);
create index if not exists oauth_tokens_expiry_idx on public.oauth_tokens (expires_at);

alter table public.oauth_clients enable row level security;
alter table public.oauth_auth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) touches these.
