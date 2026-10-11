-- Three simple manufacturer plans: Basic Market Data, Complete Market Access, Complete Market Entry.
-- Onboarding asks goals and the services from nazryx.com/manufacturers, and how many products could launch
-- (including "depends on what the data shows") instead of a bare number.
alter table manufacturer_profiles
  add column goals text[] not null default '{}',
  add column launch_scope text;
grant update (goals, launch_scope) on manufacturer_profiles to nazryx_app;

-- old plan keys to the new ones
update manufacturer_profiles set suggested_plan = case suggested_plan when 'insight' then 'data' when 'regional' then 'entry' else suggested_plan end,
                                 chosen_plan = case chosen_plan when 'insight' then 'data' when 'regional' then 'entry' else chosen_plan end;
update manufacturer_profiles set services = array_remove(services, 'eac');
update manufacturer_profiles set launch_scope = case when products_next_year is null then null when products_next_year <= 3 then '1_3'
                                                     when products_next_year <= 10 then '4_10' else '10_plus' end;
delete from plan_prices where key in ('mfr_insight', 'mfr_regional') or key like 'addon_%';
