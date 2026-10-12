-- 1. A manufacturer with an active plan is a paid account everywhere (team seats, limits); back to free when it ends.
create or replace function sync_mfr_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.active_plan is distinct from old.active_plan then
    update users set plan = case when new.active_plan is null then 'free' else 'paid' end where id = new.user_id;
  end if;
  return new;
end $$;
create trigger mfr_plan_paid after update of active_plan on manufacturer_profiles for each row execute function sync_mfr_paid();
update users set plan = 'paid' where id in (select user_id from manufacturer_profiles where active_plan is not null);

-- 2. Distributors by plan: three without a plan, a target list of ten on Basic Market Data, every distributor from
--    Complete Market Access.
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
  limit case when mfr_tier() >= 2 then 200 when mfr_tier() = 1 then 10 else 3 end
$$;
