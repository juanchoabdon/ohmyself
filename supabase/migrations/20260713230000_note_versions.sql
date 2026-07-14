-- ohmyself! — note version history (durable, per-space, visibility-scoped).
--
-- Replaces the on-disk shadow-git experiment: history lives in the same durable
-- store as everything else (Supabase), so it inherits encryption-at-rest,
-- backups and RLS, and never duplicates secret content onto a separate volume.
-- One row per write (create/update/restore/delete/move). `raw` is the full
-- serialized markdown snapshot; `id` is the opaque version token used by restore.

create table if not exists public.note_versions (
  id          bigint generated always as identity primary key,
  space_id    uuid not null references public.spaces (id) on delete cascade,
  path        text not null,
  title       text not null default '',
  visibility  visibility not null default 'private',
  author      text not null default 'agent',   -- 'human' | 'agent:token' | 'agent:oauth' | ...
  summary     text,
  op          text not null default 'update',   -- create | update | restore | delete | move
  raw         text,                             -- full serialized note snapshot (null for delete)
  created_at  timestamptz not null default now()
);

-- Per-note timeline (newest first) and per-space activity feed.
create index if not exists note_versions_space_path_idx on public.note_versions (space_id, path, id desc);
create index if not exists note_versions_space_idx      on public.note_versions (space_id, id desc);

-- ── Row Level Security (mirrors note_index: membership-based) ────────────────────
-- The trusted server uses the service role (bypasses RLS) and additionally
-- enforces visibility scope in application code; this policy governs any direct
-- client access so a member can only ever touch their own spaces' history.
alter table public.note_versions enable row level security;

drop policy if exists note_versions_all_member on public.note_versions;
create policy note_versions_all_member on public.note_versions
  for all using (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  ) with check (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  );

-- Retention helper: keep the newest N versions per (space, path). Optional; the
-- server can call this to cap unbounded growth on hot notes.
create or replace function public.prune_note_versions(p_space uuid, p_path text, p_keep int default 100)
returns integer
language sql
as $$
  with doomed as (
    select id from public.note_versions
    where space_id = p_space and path = p_path
    order by id desc
    offset greatest(p_keep, 1)
  ), deleted as (
    delete from public.note_versions v using doomed d where v.id = d.id
    returning v.id
  )
  select count(*)::int from deleted;
$$;
