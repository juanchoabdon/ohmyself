-- ohmyself! — core schema
-- Content (the brain) lives as markdown files in Storage; Postgres holds only
-- users, per-user config, and a *derived* index of note frontmatter + searchable
-- text. The index is always rebuildable from the markdown files.

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────
do $$ begin
  create type visibility as enum ('public', 'private', 'secret');
exception when duplicate_object then null; end $$;

-- ── profiles: 1:1 with auth.users ────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── user_config: per-user customizable structure / taxonomy ──────────────────
create table if not exists public.user_config (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── note_index: derived index over the markdown brain ────────────────────────
-- One row per .md file. `content` is a searchable copy of the body (derived,
-- rebuildable) used only to power full-text search.
create table if not exists public.note_index (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  path       text not null,                       -- e.g. projects/rappi/_index.md
  note_id    text,                                -- frontmatter id (optional)
  title      text not null default '',
  type       text not null default 'note',
  visibility visibility not null default 'private',
  tags       text[] not null default '{}',
  links      text[] not null default '{}',
  content    text not null default '',
  created    date,
  updated    date,
  indexed_at timestamptz not null default now(),
  fts        tsvector generated always as (
               to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))
             ) stored,
  unique (user_id, path)
);

create index if not exists note_index_user_idx        on public.note_index (user_id);
create index if not exists note_index_user_type_idx   on public.note_index (user_id, type);
create index if not exists note_index_user_vis_idx    on public.note_index (user_id, visibility);
create index if not exists note_index_tags_idx        on public.note_index using gin (tags);
create index if not exists note_index_fts_idx         on public.note_index using gin (fts);

-- ── updated_at touch trigger ─────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists user_config_touch on public.user_config;
create trigger user_config_touch before update on public.user_config
  for each row execute function public.touch_updated_at();

-- ── auto-provision profile + default config on signup ────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into public.user_config (user_id, config)
  values (new.id, '{}'::jsonb)
  on conflict (user_id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.profiles    enable row level security;
alter table public.user_config enable row level security;
alter table public.note_index  enable row level security;

-- profiles: owner can read/update own row
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id);

-- user_config: owner full access
drop policy if exists user_config_all_own on public.user_config;
create policy user_config_all_own on public.user_config
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- note_index: owner full access. (Public-agent reads go through the trusted
-- server using the service role, which bypasses RLS and enforces
-- visibility='public' in application code.)
drop policy if exists note_index_all_own on public.note_index;
create policy note_index_all_own on public.note_index
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
