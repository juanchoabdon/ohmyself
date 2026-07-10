-- ohmyself! — Spaces (multi-tenant brains: personal "self" + shared "company").
--
-- Key idea: a user's personal space has space.id = user.id. That keeps every
-- existing vault path (`<userId>/...`), note_index row, user_config row and the
-- storage prefix valid with ZERO data migration — the "brain key" simply becomes
-- `space_id`, which for self spaces equals the user id. Company spaces get fresh
-- uuids and their own storage prefix, index rows and taxonomy.

create extension if not exists "pgcrypto";

-- ── Enums ─────────────────────────────────────────────────────────────────────
do $$ begin create type space_kind as enum ('self', 'company'); exception when duplicate_object then null; end $$;
do $$ begin create type space_role as enum ('owner', 'admin', 'member'); exception when duplicate_object then null; end $$;

-- ── spaces ────────────────────────────────────────────────────────────────────
create table if not exists public.spaces (
  id            uuid primary key default gen_random_uuid(),
  kind          space_kind not null,
  slug          text,                       -- null for self; unique (lower) for company
  name          text not null default '',
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  theme_color   text,                       -- per-space accent (branding)
  logo_url      text,                        -- company logo (branding)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists spaces_slug_uidx on public.spaces (lower(slug)) where slug is not null;
create index if not exists spaces_owner_idx on public.spaces (owner_user_id);

-- ── space_members ─────────────────────────────────────────────────────────────
create table if not exists public.space_members (
  space_id   uuid not null references public.spaces (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       space_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
create index if not exists space_members_user_idx on public.space_members (user_id);

drop trigger if exists spaces_touch on public.spaces;
create trigger spaces_touch before update on public.spaces
  for each row execute function public.touch_updated_at();

-- ── Backfill: one self space per existing user (id = user id) + owner membership ─
insert into public.spaces (id, kind, name, owner_user_id)
select u.id, 'self',
       coalesce(nullif(p.display_name, ''), split_part(u.email, '@', 1), 'me'),
       u.id
from auth.users u
left join public.profiles p on p.id = u.id
on conflict (id) do nothing;

insert into public.space_members (space_id, user_id, role)
select id, owner_user_id, 'owner' from public.spaces where kind = 'self'
on conflict (space_id, user_id) do nothing;

-- ── note_index: re-key from user_id → space_id (self: space_id == user_id) ───────
alter table public.note_index add column if not exists space_id uuid references public.spaces (id) on delete cascade;
update public.note_index set space_id = user_id where space_id is null;
alter table public.note_index alter column space_id set not null;
-- Swap the tenant unique constraint from (user_id, path) to (space_id, path).
alter table public.note_index drop constraint if exists note_index_user_id_path_key;
create unique index if not exists note_index_space_path_uidx on public.note_index (space_id, path);
-- user_id is no longer the tenant key; keep the column but relax it.
alter table public.note_index drop constraint if exists note_index_user_id_fkey;
alter table public.note_index alter column user_id drop not null;
create index if not exists note_index_space_idx      on public.note_index (space_id);
create index if not exists note_index_space_type_idx on public.note_index (space_id, type);
create index if not exists note_index_space_vis_idx  on public.note_index (space_id, visibility);

-- ── user_config: re-key to per-space taxonomy ───────────────────────────────────
alter table public.user_config add column if not exists space_id uuid references public.spaces (id) on delete cascade;
update public.user_config set space_id = user_id where space_id is null;
alter table public.user_config alter column space_id set not null;
alter table public.user_config drop constraint if exists user_config_pkey;
alter table public.user_config add primary key (space_id);
alter table public.user_config alter column user_id drop not null;

-- ── folder-count RPC: scope by space instead of user ────────────────────────────
drop function if exists public.note_folder_counts(uuid, text[]);
create or replace function public.note_folder_counts(p_space uuid, p_allowed text[])
returns table (folder text, n bigint)
language sql
stable
as $$
  select split_part(path, '/', 1) as folder, count(*)::bigint as n
  from public.note_index
  where space_id = p_space
    and visibility::text = any (p_allowed)
  group by 1;
$$;

-- ── auto-provision self space + membership + config on signup ───────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.spaces (id, kind, name, owner_user_id)
  values (new.id, 'self',
          coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'me'),
          new.id)
  on conflict (id) do nothing;

  insert into public.space_members (space_id, user_id, role)
  values (new.id, new.id, 'owner')
  on conflict (space_id, user_id) do nothing;

  insert into public.user_config (space_id, user_id, config)
  values (new.id, new.id, '{}'::jsonb)
  on conflict (space_id) do nothing;

  return new;
end $$;

-- ── Row Level Security ──────────────────────────────────────────────────────────
alter table public.spaces        enable row level security;
alter table public.space_members enable row level security;

-- spaces: any member can read; only the owner can write metadata/branding.
drop policy if exists spaces_select_member on public.spaces;
create policy spaces_select_member on public.spaces
  for select using (
    owner_user_id = auth.uid()
    or exists (select 1 from public.space_members m where m.space_id = spaces.id and m.user_id = auth.uid())
  );
drop policy if exists spaces_write_owner on public.spaces;
create policy spaces_write_owner on public.spaces
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- space_members: you can see rows for spaces you belong to; owner manages roster.
drop policy if exists space_members_select on public.space_members;
create policy space_members_select on public.space_members
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.spaces s where s.id = space_members.space_id and s.owner_user_id = auth.uid())
  );
drop policy if exists space_members_manage_owner on public.space_members;
create policy space_members_manage_owner on public.space_members
  for all using (exists (select 1 from public.spaces s where s.id = space_members.space_id and s.owner_user_id = auth.uid()))
  with check (exists (select 1 from public.spaces s where s.id = space_members.space_id and s.owner_user_id = auth.uid()));

-- note_index + user_config: membership-based (replaces the auth.uid() = user_id gate).
-- The trusted server uses the service role (bypasses RLS) and enforces visibility
-- and roles in application code; this policy governs any direct client access.
drop policy if exists note_index_all_own on public.note_index;
create policy note_index_all_own on public.note_index
  for all using (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  ) with check (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  );

drop policy if exists user_config_all_own on public.user_config;
create policy user_config_all_own on public.user_config
  for all using (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  ) with check (
    space_id in (select m.space_id from public.space_members m where m.user_id = auth.uid())
  );
