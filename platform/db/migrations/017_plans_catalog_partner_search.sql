-- 1. The plan a manufacturer actually has (set by the team once agreed and invoiced), separate from what they asked for.
-- 2. A worldwide medicine list to search when adding products (Wikidata, CC0: names with WHO ATC codes).
-- 3. Distributor search for manufacturers: every distributor, filterable, with how many of the manufacturer's
--    molecules each one does not carry yet ("open to"). Names stay hidden behind codes.

-- 1. active plan, team only
alter table manufacturer_profiles add column active_plan text check (active_plan in ('data', 'access', 'entry')),
                                  add column active_since timestamptz;
grant update (active_plan, active_since) on manufacturer_profiles to nazryx_app;
create or replace function guard_mfr_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is not null and not app_is_team() and (new.status is distinct from old.status or new.team_note is distinct from old.team_note
       or new.reviewed_at is distinct from old.reviewed_at or new.active_plan is distinct from old.active_plan
       or new.active_since is distinct from old.active_since) then
    raise exception 'Only the Nazryx team can approve a manufacturer or change its plan';
  end if;
  return new;
end $$;
create policy mfr_profile_insert_no_plan on manufacturer_profiles as restrictive for insert with check (active_plan is null or app_is_team());

-- the caller's plan tier: 0 none, 1 Basic Market Data, 2 Complete Market Access, 3 Complete Market Entry (team: 3)
create or replace function mfr_tier() returns int
language sql stable security definer set search_path = public as $$
  select case when app_is_team() then 3 else coalesce((select case active_plan when 'data' then 1 when 'access' then 2 when 'entry' then 3 end
                                                      from manufacturer_profiles where user_id = app_uid()), 0) end
$$;
grant execute on function mfr_tier() to nazryx_app;

-- 2. medicine catalogue (loaded by migrate.py from ingest/data/medicines.csv when empty)
create table medicine_catalog (
  id serial primary key,
  name text not null unique,
  atc text
);
create index medicine_catalog_name_trgm on medicine_catalog using gin (name gin_trgm_ops);
create index medicine_catalog_lower on medicine_catalog (lower(name) text_pattern_ops);
alter table medicine_catalog enable row level security;
create policy medicine_catalog_read on medicine_catalog for select using (true);
grant select on medicine_catalog to nazryx_app;
alter table mfr_products add column atc text;

-- 3. distributor search
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
  -- without a plan, the five best matches; the rest stay locked
  limit case when mfr_tier() >= 1 then 200 else 5 end
$$;
revoke all on function partner_search(text, text, int, boolean, int, text) from public;
grant execute on function partner_search(text, text, int, boolean, int, text) to nazryx_app;

create trigger audit_mfr_active_plan after update of active_plan on manufacturer_profiles for each row execute function audit_team_change();

-- the team closes a manufacturer's plan request when it switches the plan on
create policy plan_requests_team_update on plan_requests for update using (app_is_team()) with check (app_is_team());
grant update (status) on plan_requests to nazryx_app;
