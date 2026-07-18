-- Binary Yjs state per collab room. Restarts must restore the SAME Y history:
-- re-hydrating from markdown creates new Y items, and clients that reconnect
-- with old state then merge duplicate content.
create table if not exists public.collab_docs (
  space_id uuid not null,
  path text not null,
  state_b64 text not null,
  updated_at timestamptz not null default now(),
  primary key (space_id, path)
);

-- Service-role only (same defense-in-depth as the rest of the brain tables).
alter table public.collab_docs enable row level security;
