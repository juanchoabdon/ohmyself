-- ohmyself! — Relationship spaces (bonds ai-in-chat B2ext).
--
-- A `relationship` space is the shared brain of ONE external room (today: a
-- bonds Matrix room), keyed by `external_key` and owned by the machine account
-- that provisions it. Raw conversation is NOT vault content: transcript deltas
-- land in their own table and the journal job distills each closed day into
-- journal/ + memory/ notes, then marks the deltas digested.

alter type space_kind add value if not exists 'relationship';

-- The external system's stable key for the room (e.g. a Matrix room id).
-- Case-sensitive on purpose: Matrix localparts are case-sensitive, so this is
-- a plain unique index, not the lower() one slugs use.
alter table public.spaces add column if not exists external_key text;
create unique index if not exists spaces_external_key_uidx
  on public.spaces (external_key) where external_key is not null;

-- ── transcript_deltas ─────────────────────────────────────────────────────────
-- The keeper's inbox: message deltas pushed by the room's owner system, grouped
-- by local day. `external_id` (the source event id) dedupes replays — pushing
-- the same batch twice is safe, which also makes historical backfill a replay.
create table if not exists public.transcript_deltas (
  id          bigint generated always as identity primary key,
  space_id    uuid not null references public.spaces (id) on delete cascade,
  day         date not null,
  at          timestamptz not null,
  author      text not null,
  kind        text not null default 'text',
  body        text not null,
  external_id text,
  created_at  timestamptz not null default now(),
  digested_at timestamptz
);
-- NOT a partial index: PostgREST upserts emit `on conflict (space_id, external_id)`
-- which only matches a full index; NULL external_ids never collide anyway.
create unique index if not exists transcript_deltas_external_uidx
  on public.transcript_deltas (space_id, external_id);
create index if not exists transcript_deltas_pending_idx
  on public.transcript_deltas (space_id, day) where digested_at is null;

-- Server-only table: the trusted backend uses the service role (bypasses RLS).
-- Members may read their room's raw deltas directly; nobody writes from a client.
alter table public.transcript_deltas enable row level security;
drop policy if exists transcript_deltas_select_members on public.transcript_deltas;
create policy transcript_deltas_select_members on public.transcript_deltas
  for select using (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  );
