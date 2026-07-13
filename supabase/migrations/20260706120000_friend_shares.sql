-- ohmyself! — friend shares (read-only cross-brain access)
-- One row per (owner, viewer): the owner shares their brain, read-only, up to
-- `max_visibility`, with the viewer. This is a one-way grant the OWNER
-- controls entirely — like sharing a doc, no acceptance needed from the
-- viewer. Ceiling can be public, private, or secret (full bucket; still
-- read-only for the viewer). Revoking = deleting the row.

do $$ begin
  create type friend_visibility as enum ('public', 'private');
exception when duplicate_object then null; end $$;

create table if not exists public.friend_shares (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users (id) on delete cascade,
  viewer_id      uuid not null references auth.users (id) on delete cascade,
  max_visibility friend_visibility not null default 'public',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);

create index if not exists friend_shares_owner_idx  on public.friend_shares (owner_id);
create index if not exists friend_shares_viewer_idx on public.friend_shares (viewer_id);

drop trigger if exists friend_shares_touch on public.friend_shares;
create trigger friend_shares_touch before update on public.friend_shares
  for each row execute function public.touch_updated_at();

alter table public.friend_shares enable row level security;

-- Owner manages the grants they've given (create / update level / revoke).
drop policy if exists friend_shares_owner_all on public.friend_shares;
create policy friend_shares_owner_all on public.friend_shares
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Viewer can see (read-only) who has shared with them.
drop policy if exists friend_shares_viewer_select on public.friend_shares;
create policy friend_shares_viewer_select on public.friend_shares
  for select using (auth.uid() = viewer_id);

-- Exact-email lookup to resolve who to share with (case-insensitive).
create index if not exists profiles_email_idx on public.profiles (lower(email));
