-- Scope connections (Google Drive/Gemini meeting sync, etc.) to a SPACE, not
-- just a user. Before this, a connection was keyed by user_id and everything it
-- ingested landed in the user's personal (self) brain — so connecting an
-- account "inside a company space" would cross over into the personal wiki.
--
-- Now each connection belongs to a space: its transcripts/people/decisions are
-- ingested into THAT space's brain. `user_id` is retained as "who connected it"
-- (for auditing / OAuth ownership), but the tenant key for sync + uniqueness is
-- space_id. Existing rows backfill to the owner's self space (space.id == user.id).

alter table public.connections
  add column if not exists space_id uuid references public.spaces (id) on delete cascade;

-- Existing connections belong to their owner's self space (id == user_id).
update public.connections set space_id = user_id where space_id is null;

alter table public.connections alter column space_id set not null;

-- Uniqueness moves from (user, provider, account) to (space, provider, account):
-- the same person can connect the same Google account into both their personal
-- space and a company space as two independent connections.
drop index if exists public.connections_user_provider_account_uidx;
create unique index if not exists connections_space_provider_account_uidx
  on public.connections (space_id, provider, coalesce(account_email, ''));

create index if not exists connections_space_idx on public.connections (space_id);

-- RLS: any member of the space can see its connections (credential column is
-- only ever read server-side with the service role, which bypasses RLS).
drop policy if exists connections_all_own on public.connections;
create policy connections_all_own on public.connections
  for all
  using (
    exists (
      select 1 from public.space_members m
      where m.space_id = connections.space_id and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.space_members m
      where m.space_id = connections.space_id and m.user_id = auth.uid()
    )
  );
