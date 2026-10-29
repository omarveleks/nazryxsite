-- Three-step sign-up with a welcome from the register, and a 14-day trial of Basic Market Data on one market.
-- A manufacturer's own registrations: the companies in the registers that are this account (claimed at sign-up),
-- so its portfolio grid shows "registered by you" and its products fill in from what it already holds.
alter table manufacturer_profiles
  add column company_ids int[] not null default '{}',
  add column trial_market text references countries(code),
  add column trial_until timestamptz;

-- customers change these only through the functions below (which set the transaction-local flag); the guard stays
create or replace function guard_mfr_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is not null and not app_is_team() and coalesce(current_setting('nzx.self_service', true), '') <> 'on'
     and (new.status is distinct from old.status or new.team_note is distinct from old.team_note
       or new.reviewed_at is distinct from old.reviewed_at or new.active_plan is distinct from old.active_plan
       or new.active_since is distinct from old.active_since or new.verified_at is distinct from old.verified_at
       or new.stripe_customer is distinct from old.stripe_customer or new.stripe_subscription is distinct from old.stripe_subscription
       or (new.paid_markets is distinct from old.paid_markets and coalesce(current_setting('nzx.taking_market', true), '') <> 'on')
       or new.billing_interval is distinct from old.billing_interval
       or new.company_ids is distinct from old.company_ids or new.trial_market is distinct from old.trial_market
       or new.trial_until is distinct from old.trial_until
       or (old.sample_product_id is not null and new.sample_product_id is distinct from old.sample_product_id)) then
    raise exception 'Only the Nazryx team can change this';
  end if;
  return new;
end $$;
grant update (company_ids, trial_market, trial_until) on manufacturer_profiles to nazryx_app;

-- a company name as the registers write it: lower case, no punctuation, no legal or trade words
create or replace function company_key(p_name text) returns text language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9 ]+', ' ', 'g'),
    '\m(ltd|limited|pvt|private|plc|inc|llc|llp|co|company|corp|corporation|gmbh|ag|sa|sarl|pharma|pharmaceuticals?|pharmaceutical|laboratories|laboratory|labs?|industries|industry|international|intl|group|holdings?|the)\M', ' ', 'g')), '');
$$;

-- registrations in our markets held by companies whose name is this one (for the sign-up welcome)
create or replace function mfr_find_registrations(p_name text)
returns table (company_id int, name text, country text, registrations int, molecules int)
language sql stable security definer set search_path = public as $$
  with k as (select company_key(p_name) as key)
  select c.id, c.display_name, r.country, count(*)::int, count(distinct r.molecule_id)::int
  from k cross join companies c
  join registrations r on r.manufacturer_id = c.id and r.active
  where c.merged_into is null and k.key is not null and length(k.key) >= 4
    and (company_key(c.display_name) = k.key
         or (length(k.key) >= 6 and company_key(c.display_name) like '%' || k.key || '%')
         or (length(company_key(c.display_name)) >= 6 and k.key like '%' || company_key(c.display_name) || '%'))
  group by c.id, c.display_name, r.country
  order by count(*) desc limit 40;
$$;
revoke all on function mfr_find_registrations(text) from public;
grant execute on function mfr_find_registrations(text) to nazryx_app;

-- the account takes those companies as its own: its products fill in from their registrations (one per molecule,
-- strength and form), and registered_in records the markets. Returns how many products were added.
create or replace function mfr_claim_registrations(p_company_ids int[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if app_uid() is null or p_company_ids is null or cardinality(p_company_ids) = 0 then return 0; end if;
  perform set_config('nzx.self_service', 'on', true);
  update manufacturer_profiles set company_ids = (select array_agg(distinct x) from unnest(company_ids || p_company_ids) x),
    registered_in = (select array_agg(distinct x) from unnest(coalesce(registered_in, '{}') || array(
      select distinct r.country from registrations r where r.manufacturer_id = any(p_company_ids) and r.active)) x)
    where user_id = app_uid();
  perform set_config('nzx.self_service', '', true);
  with src as (
    select distinct on (coalesce(r.molecule_id::text, lower(r.generic_name)), lower(coalesce(r.strength, '')), lower(coalesce(r.dosage_form, r.form, '')))
      coalesce(r.generic_name, r.brand) as name, r.molecule_id, r.strength, coalesce(r.dosage_form, r.form) as dosage_form
    from registrations r where r.manufacturer_id = any(p_company_ids) and r.active and coalesce(r.generic_name, r.brand) is not null
    order by coalesce(r.molecule_id::text, lower(r.generic_name)), lower(coalesce(r.strength, '')), lower(coalesce(r.dosage_form, r.form, '')), r.reg_year desc nulls last),
  ins as (
    insert into mfr_products (user_id, name, molecule_id, strength, dosage_form)
    select app_uid(), left(s.name, 200), s.molecule_id, left(s.strength, 80), left(s.dosage_form, 120) from src s
    where not exists (select 1 from mfr_products p where p.user_id = app_uid() and p.molecule_id is not distinct from s.molecule_id
                      and lower(coalesce(p.strength, '')) = lower(coalesce(s.strength, '')) and lower(coalesce(p.dosage_form, '')) = lower(coalesce(s.dosage_form, '')))
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;
revoke all on function mfr_claim_registrations(int[]) from public;
grant execute on function mfr_claim_registrations(int[]) to nazryx_app;

-- 14 days of Basic Market Data on one market, once, for an account with no plan
create or replace function mfr_start_trial(p_market text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz;
begin
  if app_uid() is null or not exists (select 1 from countries where code = p_market) then return null; end if;
  perform set_config('nzx.self_service', 'on', true);
  update manufacturer_profiles set trial_market = p_market, trial_until = now() + interval '14 days'
    where user_id = app_uid() and active_plan is null and trial_until is null returning trial_until into t;
  perform set_config('nzx.self_service', '', true);
  return t;
end $$;
revoke all on function mfr_start_trial(text) from public;
grant execute on function mfr_start_trial(text) to nazryx_app;

-- the tier in a market: the plan where the market is covered, else the trial's market while it runs
create or replace function mfr_tier_in(p_country text) returns int
language sql stable security definer set search_path = public as $$
  select case when app_is_team() then 3 else coalesce((
    select case when active_plan = 'entry' then 3
                when active_plan is null then case when trial_until > now() and trial_market = p_country then 1 else 0 end
                when p_country = any(paid_markets) or cardinality(paid_markets) = 0 then case active_plan when 'data' then 1 when 'access' then 2 else 0 end
                else 0 end
    from manufacturer_profiles where user_id = app_uid()), 0) end
$$;
