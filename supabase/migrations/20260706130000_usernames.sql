-- ohmyself! — public @handles
-- Every account gets a unique, public @handle (separate from their private
-- email) so friends can find and share with each other by name instead of
-- needing to know an exact email address.

alter table public.profiles add column if not exists username text;

-- Slugify a candidate into handle-safe characters: lowercase letters,
-- digits, underscores only.
create or replace function public.slugify_username(raw text)
returns text language sql immutable as $$
  select nullif(
    regexp_replace(regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9_]+', '_', 'g'), '^_+|_+$', '', 'g'),
    ''
  );
$$;

-- Turn a candidate base string into a free, unique handle by appending a
-- numeric suffix on collision (case-insensitive).
create or replace function public.unique_username(base text)
returns text language plpgsql as $$
declare
  root      text := coalesce(nullif(public.slugify_username(base), ''), 'user');
  candidate text;
  suffix    int := 0;
begin
  root := substr(root, 1, 20);
  candidate := root;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    suffix := suffix + 1;
    candidate := substr(root, 1, greatest(1, 20 - length(suffix::text) - 1)) || '_' || suffix;
  end loop;
  return candidate;
end $$;

-- Backfill existing accounts that predate handles, one row at a time (not a
-- single bulk UPDATE) so each call to unique_username() sees the handles
-- already assigned earlier in the same backfill — otherwise two accounts
-- with the same display name could race to the same suffix.
do $$
declare
  r record;
begin
  for r in select id, display_name, email from public.profiles where username is null loop
    update public.profiles
    set username = public.unique_username(coalesce(r.display_name, split_part(r.email, '@', 1)))
    where id = r.id;
  end loop;
end $$;

alter table public.profiles alter column username set not null;

create unique index if not exists profiles_username_unique_idx on public.profiles (lower(username));
create index if not exists profiles_display_name_idx on public.profiles (lower(display_name));

-- Assign a handle to every new signup too.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, email, display_name, username)
  values (new.id, new.email, base, public.unique_username(base))
  on conflict (id) do nothing;

  insert into public.user_config (user_id, config)
  values (new.id, '{}'::jsonb)
  on conflict (user_id) do nothing;

  return new;
end $$;
