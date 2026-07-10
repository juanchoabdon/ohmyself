-- ohmyself! — fix the connections upsert conflict target.
-- The previous unique index was FUNCTIONAL: (user_id, provider, coalesce(account_email,'')).
-- Postgres ON CONFLICT requires the target to match a unique index by its exact
-- columns; a plain column list (user_id, provider, account_email) does NOT match
-- an expression index, so upserts failed and no connection was ever stored.
--
-- Replace it with a plain unique index on the same columns. Postgres 15+ lets us
-- treat NULL account_email as equal via NULLS NOT DISTINCT, preserving the
-- single-account (no email) collapse semantics while matching the column-list
-- ON CONFLICT the code uses.

drop index if exists public.connections_user_provider_account_uidx;

create unique index if not exists connections_user_provider_account_uidx
  on public.connections (user_id, provider, account_email) nulls not distinct;
