-- Devices and medicines as one market: the companies importing devices are the same distributors as for medicines
-- (one company record), registrations carry the same use groups as devices, and regulatory detail has a scope.
alter table devices add column company_id int references companies(id) on delete set null;
create index devices_company on devices (country, company_id);
alter table registrations add column use_group text;
create index registrations_use_group on registrations (country, use_group) where use_group is not null;
alter table mfr_products add column kind text check (kind in ('medicine', 'device'));
alter table reg_requirements add column scope text not null default 'medicine' check (scope in ('medicine', 'device'));
alter table country_routes add column scope text not null default 'medicine' check (scope in ('medicine', 'device'));
alter table reg_checklist add column scope text not null default 'medicine' check (scope in ('medicine', 'device'));

-- Distributors who carry a product group (eye lubricants, eye-surgery viscoelastics, joint injections, nasal saline),
-- counted over registered medicines and registered devices together. Codes only, like partner_search.
create function group_partners(p_country text, p_group text)
returns table (code text, products int, devices int, in_group int, group_devices int, local_maker boolean, origins text, total int)
language sql stable security definer set search_path = public as $$
  with md as (select not exists (select 1 from registrations where country = p_country and active and ltr_id is not null) as holder,
                     (select upper(name) from countries where code = p_country) as cname),
  held as (
    select case when md.holder then r.registrant_id else r.ltr_id end as company_id, 'm' as kind, r.use_group, r.manufacturing_country as made
    from registrations r cross join md where r.country = p_country and r.active and app_uid() is not null
    union all
    select d.company_id, 'd', d.use_group, d.manufacturing_country from devices d
    where d.country = p_country and d.active and d.company_id is not null and app_uid() is not null
  ),
  agg as (
    select company_id, count(*)::int as products, count(*) filter (where kind = 'd')::int as devices,
           count(*) filter (where use_group = p_group)::int as in_group,
           count(*) filter (where use_group = p_group and kind = 'd')::int as group_devices,
           string_agg(distinct initcap(lower(made)), ', ') filter (where use_group = p_group and made is not null) as origins
    from held where company_id is not null group by company_id
  )
  select partner_code(c.id), a.products, a.devices, a.in_group, a.group_devices,
         upper(coalesce(c.country, '')) = (select cname from md), a.origins, count(*) over ()::int
  from agg a join companies c on c.id = a.company_id
  where c.merged_into is null and a.in_group > 0
  order by a.in_group desc, a.products desc
  limit case when mfr_tier_in(p_country) >= 2 then 200 when mfr_tier_in(p_country) = 1 then 10 else 3 end
$$;
revoke all on function group_partners(text, text) from public;
grant execute on function group_partners(text, text) to nazryx_app;

-- the team's names behind the codes now include companies that only import devices
create or replace function team_partner_names(p_country text) returns table (code text, name text, home text)
language sql stable security definer set search_path = public as $$
  select partner_code(c.id), c.display_name, c.country from companies c
  where app_is_team() and c.merged_into is null and (
    exists (select 1 from company_stats s where s.company_id = c.id and s.country = p_country)
    or exists (select 1 from devices d where d.company_id = c.id and d.country = p_country))
$$;
-- registers are read again so registrations get their use groups and devices their companies
update data_sources set run_now = true where kind in ('registry', 'devices');
