-- ohmyself! — images and video uploaded into notes.
--
-- The bucket is PRIVATE, unlike `space-logos`. A screenshot pasted into a
-- `secret` finance note is as sensitive as the note itself, so the bytes are
-- never reachable by URL alone: the server mints a short-lived signed URL per
-- read, after checking the caller belongs to the space.
--
-- Markdown therefore stores a stable logical reference (`oms-asset:<id>`)
-- rather than the signed URL, which would expire inside the note body. The id
-- resolves through `POST /v1/assets/resolve` at render time.

-- 50 MB matches MAX_VIDEO_BYTES in server/src/core/assets.ts; uploads are
-- buffered in memory by the API, so the ceiling is container memory.
insert into storage.buckets (id, name, public, file_size_limit)
values ('note-assets', 'note-assets', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

create table if not exists public.note_assets (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces (id) on delete cascade,
  -- Note the asset was first inserted into. Kept for attribution and for a
  -- future sweep of assets whose note is gone; a body can be copied elsewhere,
  -- so this is a provenance hint, never an access check.
  path          text,
  storage_key   text not null unique,
  mime          text not null,
  size_bytes    bigint not null,
  -- Intrinsic dimensions, when the uploader could measure them. Lets the
  -- renderer reserve space before the signed URL resolves.
  width         integer,
  height        integer,
  original_name text,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists note_assets_space_idx on public.note_assets (space_id, created_at desc);
create index if not exists note_assets_path_idx  on public.note_assets (space_id, path);

-- ── Row Level Security (mirrors note_comments: membership-based) ──────────────
-- The trusted server uses the service role (bypasses RLS) and additionally
-- enforces space membership in application code; this policy governs any direct
-- client access so a member can only ever touch their own spaces' assets.
alter table public.note_assets enable row level security;

drop policy if exists note_assets_all_member on public.note_assets;
create policy note_assets_all_member on public.note_assets
  for all using (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  ) with check (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  );
