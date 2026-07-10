-- ohmyself! — fix signup: restore username in handle_new_user().
--
-- 20260706130000_usernames made public.profiles.username NOT NULL and taught
-- handle_new_user() to assign a unique handle on signup. But 20260710000000_spaces
-- redefined handle_new_user() to also provision the self space / membership /
-- config — and in doing so dropped `username` from the profiles INSERT. Since
-- username is NOT NULL with no default, every new signup now fails the insert and
-- Supabase Auth returns "Database error saving new user" (existing users were
-- unaffected because they were backfilled). Redefine the function to insert the
-- username AND do the space provisioning.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, email, display_name, username)
  values (new.id, new.email, base, public.unique_username(base))
  on conflict (id) do nothing;

  insert into public.spaces (id, kind, name, owner_user_id)
  values (new.id, 'self', coalesce(nullif(base, ''), 'me'), new.id)
  on conflict (id) do nothing;

  insert into public.space_members (space_id, user_id, role)
  values (new.id, new.id, 'owner')
  on conflict (space_id, user_id) do nothing;

  insert into public.user_config (space_id, user_id, config)
  values (new.id, new.id, '{}'::jsonb)
  on conflict (space_id) do nothing;

  return new;
end $$;
