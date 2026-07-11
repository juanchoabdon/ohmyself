-- MCP tool-usage telemetry. This is the hard gate for the contract-v2 tool
-- consolidation: we only deprecate/remove a redundant tool once telemetry shows
-- active skills/clients have stopped calling it. Privacy: we record ONLY the
-- tool name, tenant, outcome, and latency — never arguments or note content.

create table if not exists public.tool_usage (
  id          bigint generated always as identity primary key,
  space_id    uuid,
  user_id     uuid,
  tool        text not null,
  ok          boolean not null default true,
  error_code  text,
  latency_ms  integer,
  deprecated  boolean not null default false,
  via         text,               -- how the caller authed (jwt/token/oauth/public)
  client      text,               -- optional client hint (mcp client name)
  created_at  timestamptz not null default now()
);

create index if not exists tool_usage_tool_idx    on public.tool_usage (tool);
create index if not exists tool_usage_created_idx  on public.tool_usage (created_at desc);
create index if not exists tool_usage_space_idx    on public.tool_usage (space_id);
create index if not exists tool_usage_deprecated_idx on public.tool_usage (deprecated) where deprecated;

-- Server writes with the service role (bypasses RLS). Enable RLS with no public
-- policies so the anon/authenticated keys can never read usage data.
alter table public.tool_usage enable row level security;

-- Convenience rollup: usage per tool over a trailing window (for the migration
-- gate — "is anything still calling the deprecated tool?").
create or replace function public.tool_usage_summary(p_since timestamptz default now() - interval '30 days')
returns table (
  tool        text,
  calls       bigint,
  errors      bigint,
  deprecated  boolean,
  p50_ms      numeric,
  p95_ms      numeric,
  last_call   timestamptz
)
language sql
stable
as $$
  select
    tool,
    count(*)                                             as calls,
    count(*) filter (where not ok)                       as errors,
    bool_or(deprecated)                                  as deprecated,
    percentile_cont(0.5) within group (order by latency_ms)  as p50_ms,
    percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
    max(created_at)                                      as last_call
  from public.tool_usage
  where created_at >= p_since
  group by tool
  order by calls desc;
$$;
