-- ohmyself! — multi-account support for connectors.
-- A user can connect several accounts of the same provider (e.g. two Google
-- Workspace accounts for Drive/Gemini meeting notes). We add the account
-- identity columns and move the uniqueness from (user, provider) to
-- (user, provider, account_email). Providers with a single account (no email)
-- collapse to the empty string via coalesce so the old semantics still hold.
--
-- NOTE: originally authored as 20260706120000 but that version collided with
-- the friend_shares migration, so it was never applied remotely. Re-dated to a
-- unique, later version so `supabase db push` picks it up.

alter table public.connections
  add column if not exists account_email text,
  add column if not exists account_label text;

-- Drop the old (user_id, provider) uniqueness (auto-named by Postgres).
alter table public.connections drop constraint if exists connections_user_id_provider_key;

create unique index if not exists connections_user_provider_account_uidx
  on public.connections (user_id, provider, coalesce(account_email, ''));
