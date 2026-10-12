-- Pay per market and annual billing. A plan covers the markets in paid_markets (one included, $49 a month for each
-- extra); billing is monthly or annual (annual = ten months, two free). Only the team, the payment webhook and the
-- worker change these. Complete Market Entry covers every market.

alter table manufacturer_profiles
  add column paid_markets text[] not null default '{}',
  add column billing_interval text not null default 'month' check (billing_interval in ('month', 'year'));

-- plans active before markets were priced keep every market they chose
update manufacturer_profiles set paid_markets = target_countries where active_plan is not null and cardinality(paid_markets) = 0;

create or replace function guard_mfr_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is not null and not app_is_team() and (new.status is distinct from old.status or new.team_note is distinct from old.team_note
       or new.reviewed_at is distinct from old.reviewed_at or new.active_plan is distinct from old.active_plan
       or new.active_since is distinct from old.active_since or new.verified_at is distinct from old.verified_at
       or new.stripe_customer is distinct from old.stripe_customer or new.stripe_subscription is distinct from old.stripe_subscription
       or new.paid_markets is distinct from old.paid_markets or new.billing_interval is distinct from old.billing_interval
       or (old.sample_product_id is not null and new.sample_product_id is distinct from old.sample_product_id)) then
    raise exception 'Only the Nazryx team can change this';
  end if;
  return new;
end $$;
grant update (paid_markets, billing_interval) on manufacturer_profiles to nazryx_app;   -- the guard lets only the team through

-- the price of each extra market, per month, in whole US dollars
insert into plan_prices (key, amount_usd) values ('mfr_market', 49)
on conflict (key) do update set amount_usd = coalesce(plan_prices.amount_usd, excluded.amount_usd);

-- payment events carry the markets and the interval; a change of markets on a running subscription is its own event
alter table payment_events drop constraint payment_events_kind_check;
alter table payment_events add constraint payment_events_kind_check
  check (kind in ('checkout_completed', 'invoice_paid', 'subscription_ended', 'manual_activation', 'markets_changed'));
alter table payment_events
  add column markets text[],
  add column billing_interval text check (billing_interval in ('month', 'year'));
drop policy payment_events_insert on payment_events;
create policy payment_events_insert on payment_events for insert with check (
  (app_uid() is null and kind <> 'manual_activation') or (app_is_team() and kind in ('manual_activation', 'markets_changed')));

-- an extra market bought by card is its own small subscription (cancel one market without touching the plan)
alter table payment_events drop constraint payment_events_plan_check;
alter table payment_events add constraint payment_events_plan_check check (plan in ('data', 'access', 'entry', 'market'));
create table market_subscriptions (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  country text not null references countries(code),
  stripe_subscription text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table market_subscriptions enable row level security;
create policy market_subscriptions_read on market_subscriptions for select using (user_id = app_uid() or app_is_team());
grant select on market_subscriptions to nazryx_app;

-- the plan tier for one market: the plan's tier where the market is covered (Complete Market Entry and the team cover all)
create or replace function mfr_tier_in(p_country text) returns int
language sql stable security definer set search_path = public as $$
  select case when app_is_team() then 3 else coalesce((
    select case when active_plan = 'entry' then 3
                -- a plan with no markets recorded (set up before markets were priced) covers every market
                when p_country = any(paid_markets) or cardinality(paid_markets) = 0 then case active_plan when 'data' then 1 when 'access' then 2 else 0 end
                else 0 end
    from manufacturer_profiles where user_id = app_uid()), 0) end
$$;
grant execute on function mfr_tier_in(text) to nazryx_app;

-- distributor lists follow the market's tier
create or replace function partner_search(p_country text, p_category text default null, p_molecule int default null,
                                          p_local boolean default false, p_min_products int default 0, p_sort text default 'open')
returns table (code text, products int, molecules int, in_class int, classes int, top_classes text, carries_mine int, open_to int,
               carries boolean, local_maker boolean, total int, mine int)
language sql stable security definer set search_path = public as $$
  with mine as (select distinct molecule_id from mfr_products where user_id = app_uid() and molecule_id is not null),
  base as (
    select c.id, s.registrations as products, s.molecules, s.categories as classes, c.is_manufacturer as local_maker,
           (select count(distinct r.molecule_id)::int from registrations r join molecules m on m.id = r.molecule_id
              where r.ltr_id = c.id and r.country = p_country and r.active and m.category = p_category) as in_class,
           (select count(distinct r.molecule_id)::int from registrations r join mine on mine.molecule_id = r.molecule_id
              where r.ltr_id = c.id and r.country = p_country and r.active) as carries_mine,
           p_molecule is not null and exists (select 1 from registrations r where r.ltr_id = c.id and r.country = p_country
                                                and r.active and r.molecule_id = p_molecule) as carries
    from companies c join company_stats s on s.company_id = c.id and s.country = p_country
    where c.is_ltr and c.merged_into is null and s.registrations > 0 and app_uid() is not null
      and (not p_local or c.is_manufacturer) and s.registrations >= coalesce(p_min_products, 0)
  ),
  filtered as (
    select b.*, (select count(*)::int from mine) - b.carries_mine as open_to, count(*) over ()::int as total
    from base b where p_category is null or b.in_class > 0
  )
  select partner_code(f.id), f.products, f.molecules, f.in_class, f.classes,
         (select string_agg(x.category, ', ' order by x.n desc, x.category) from (
            select m.category, count(*) as n from registrations r join molecules m on m.id = r.molecule_id
            where r.ltr_id = f.id and r.country = p_country and r.active and m.category is not null
            group by 1 order by 2 desc, 1 limit 3) x),
         f.carries_mine, f.open_to, f.carries, f.local_maker, f.total, (select count(*)::int from mine)
  from filtered f
  order by case p_sort when 'size' then f.products when 'class' then f.in_class else f.open_to end desc, f.products desc
  limit case when mfr_tier_in(p_country) >= 2 then 200 when mfr_tier_in(p_country) = 1 then 10 else 3 end
$$;

