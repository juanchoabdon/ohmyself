-- Paid tier: basic (notes + MCP) vs pro (unlimited + meetings/wikis).
-- Null tier on a paying row is treated as Pro (grandfather + existing Stripe).

alter table public.entitlements
  add column if not exists tier text
  check (tier in ('basic', 'pro') or tier is null);
