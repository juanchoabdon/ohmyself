-- Hosted billing: Stripe (and later Apple) write entitlements; the trusted
-- API is the only writer. Clients may read their own row. is_pro() is
-- date-aware so trials and grandfathering expire without a cron.

create table if not exists public.entitlements (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  status                 text not null default 'free'
                           check (status in (
                             'free', 'trialing', 'active', 'past_due',
                             'canceled', 'grandfathered', 'lifetime'
                           )),
  plan                   text check (plan in ('monthly', 'annual') or plan is null),
  source                 text check (source in ('stripe', 'apple', 'grandfather') or source is null),
  stripe_customer_id     text,
  stripe_subscription_id text,
  apple_original_transaction_id text,
  current_period_end     timestamptz,
  trial_end              timestamptz,
  grandfather_until      timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists entitlements_stripe_customer_idx
  on public.entitlements (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists entitlements_stripe_subscription_idx
  on public.entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

drop trigger if exists entitlements_touch on public.entitlements;
create trigger entitlements_touch before update on public.entitlements
  for each row execute function public.touch_updated_at();

alter table public.entitlements enable row level security;

drop policy if exists entitlements_select_own on public.entitlements;
create policy entitlements_select_own on public.entitlements
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies: only the service role (webhooks) writes.

create or replace function public.is_pro(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.entitlements e
    where e.user_id = p_user_id
      and (
        e.status = 'lifetime'
        or (e.status = 'active' and (e.current_period_end is null or e.current_period_end >= now()))
        or (e.status = 'past_due' and coalesce(e.current_period_end, now()) + interval '5 days' >= now())
        or (e.status = 'trialing' and coalesce(e.trial_end, now()) >= now())
        or (e.status = 'grandfathered' and coalesce(e.grandfather_until, now()) >= now())
        or (e.status = 'canceled' and e.current_period_end is not null and e.current_period_end >= now())
      )
  );
$$;

revoke all on function public.is_pro(uuid) from public;
grant execute on function public.is_pro(uuid) to service_role;

-- Existing hosted users keep Pro for 90 days after this migration is applied,
-- so flipping OMS_ENFORCE_PRO does not cut people who already built a brain.
insert into public.entitlements (user_id, status, source, grandfather_until)
select p.id, 'grandfathered', 'grandfather', now() + interval '90 days'
from public.profiles p
on conflict (user_id) do nothing;
