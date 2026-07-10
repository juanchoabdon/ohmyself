-- ohmyself! — fix the (space-scoped) connections upsert conflict target.
--
-- 20260709190000 fixed this once for the USER-scoped index: Postgres ON CONFLICT
-- requires the arbiter to be a unique index whose columns match the target
-- EXACTLY. A functional index over (…, coalesce(account_email,'')) does NOT match
-- a plain column list (…, account_email), so upserts error with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- 20260710020000_connections_space_scope re-introduced the very same mismatch by
-- creating connections_space_provider_account_uidx as a FUNCTIONAL index over
-- (space_id, provider, coalesce(account_email,'')). The code upserts with
-- onConflict: "space_id,provider,account_email" (a plain column list), so every
-- connection upsert fails and no new Google account can ever be connected.
--
-- Replace it with a plain unique index on the same columns, using
-- NULLS NOT DISTINCT (Postgres 15+) so a null account_email still collapses to a
-- single row per (space, provider) — matching the column-list ON CONFLICT.

drop index if exists public.connections_space_provider_account_uidx;

create unique index if not exists connections_space_provider_account_uidx
  on public.connections (space_id, provider, account_email) nulls not distinct;
