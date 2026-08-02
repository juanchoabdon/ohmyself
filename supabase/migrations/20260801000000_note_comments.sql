-- ohmyself! — inline comments on notes (multiplayer: humans in the web UI and
-- agents over MCP write into the same threads).
--
-- Comments live OUTSIDE the markdown. The note body is the source of truth that
-- agents read, and the collab Y doc re-serializes the whole body on every store,
-- so an in-document comment mark would either pollute the markdown or be lost.
-- Instead a thread anchors to a text-quote selector (`anchor`) resolved against
-- the current body at render time; when the quoted text disappears the thread
-- survives as an orphan instead of silently vanishing.
--
-- A thread is its root comment: the root carries the anchor, replies share its
-- `thread_id` and carry `parent_id`.

create table if not exists public.note_comments (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references public.spaces (id) on delete cascade,
  path           text not null,
  thread_id      uuid not null,
  parent_id      uuid references public.note_comments (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null,
  author_kind    text not null default 'human',   -- 'human' | 'agent'
  author_label   text,                            -- agent/client label for MCP writes
  body           text not null,
  anchor         jsonb,                           -- { quote, prefix, suffix, offset }; null = note-level
  resolved_at    timestamptz,
  resolved_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint note_comments_author_kind_chk check (author_kind in ('human', 'agent'))
);

-- Threads of one open note (the hot path) and reply fan-out within a thread.
create index if not exists note_comments_space_path_idx on public.note_comments (space_id, path, created_at);
create index if not exists note_comments_thread_idx     on public.note_comments (thread_id, created_at);
-- Space-wide "what's still open" sweep, used by the MCP inbox tool.
create index if not exists note_comments_open_idx       on public.note_comments (space_id, created_at desc)
  where resolved_at is null and deleted_at is null and parent_id is null;

-- ── Row Level Security (mirrors note_versions: membership-based) ────────────────
-- The trusted server uses the service role (bypasses RLS) and additionally
-- enforces note visibility in application code; this policy governs any direct
-- client access so a member can only ever touch their own spaces' comments.
alter table public.note_comments enable row level security;

drop policy if exists note_comments_all_member on public.note_comments;
create policy note_comments_all_member on public.note_comments
  for all using (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  ) with check (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  );
