-- New plan prices (monthly, US dollars; yearly stays ten months): Basic Market Data $499 with one market and $299 for
-- each extra; Complete Market Access $1,999 with four markets and $499 for each extra. Each plan has its own price for
-- an extra market (mfr_market_<plan>), replacing the one price for all (mfr_market). Card subscriptions already running
-- keep the price they were bought at.
insert into plan_prices (key, amount_usd) values ('mfr_data', 499), ('mfr_access', 1999), ('mfr_market_data', 299), ('mfr_market_access', 499)
on conflict (key) do update set amount_usd = excluded.amount_usd, updated_at = now();
delete from plan_prices where key = 'mfr_market';

-- markets a plan includes before extra markets are charged
create or replace function mfr_plan_markets(p_plan text) returns int language sql immutable as $$
  select case p_plan when 'data' then 1 when 'access' then 4 else 0 end;
$$;

-- the profile guard lets one change through from a customer: paid_markets, inside mfr_take_included_market (which
-- sets the transaction-local flag below; customers cannot run SQL of their own)
create or replace function guard_mfr_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is not null and not app_is_team() and (new.status is distinct from old.status or new.team_note is distinct from old.team_note
       or new.reviewed_at is distinct from old.reviewed_at or new.active_plan is distinct from old.active_plan
       or new.active_since is distinct from old.active_since or new.verified_at is distinct from old.verified_at
       or new.stripe_customer is distinct from old.stripe_customer or new.stripe_subscription is distinct from old.stripe_subscription
       or (new.paid_markets is distinct from old.paid_markets and coalesce(current_setting('nzx.taking_market', true), '') <> 'on')
       or new.billing_interval is distinct from old.billing_interval
       or (old.sample_product_id is not null and new.sample_product_id is distinct from old.sample_product_id)) then
    raise exception 'Only the Nazryx team can change this';
  end if;
  return new;
end $$;

-- a manufacturer on a plan with included markets still free takes one of them (Complete Market Access bought with fewer
-- than four markets chosen): the only way a customer changes paid_markets themselves
create or replace function mfr_take_included_market(p_country text) returns boolean
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select active_plan, paid_markets into p from manufacturer_profiles where user_id = app_uid() for update;
  if p.active_plan is null or p_country = any(p.paid_markets) then return false; end if;
  if not exists (select 1 from countries where code = p_country) then return false; end if;
  if cardinality(array(select unnest(p.paid_markets) except select country from market_subscriptions
                        where user_id = app_uid() and active)) >= mfr_plan_markets(p.active_plan) then return false; end if;
  perform set_config('nzx.taking_market', 'on', true);
  update manufacturer_profiles set paid_markets = array_append(paid_markets, p_country) where user_id = app_uid();
  perform set_config('nzx.taking_market', '', true);
  return true;
end $$;
revoke all on function mfr_take_included_market(text) from public;
grant execute on function mfr_take_included_market(text) to nazryx_app;
