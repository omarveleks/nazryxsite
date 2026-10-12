-- Competitor watch, one table per market: competitors are the companies holding a registration (the local holder
-- where the registry names one, else the registration holder or maker, as in Kazakhstan and Kyrgyzstan), and the last
-- 90 days are counted in the same row (new, gone, when) instead of a separate list of every move.
drop function if exists my_competitor_summary(text);
create function my_competitor_summary(p_country text)
returns table (molecule_id int, molecule text, category text, competitors int, products int, new_90 int, gone_90 int,
               last_move timestamptz, made_in text, watched_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.molecule_id, m.inn, m.category,
         (select count(distinct coalesce(r.ltr_id, r.registrant_id, r.manufacturer_id))::int from registrations r
            where r.molecule_id = w.molecule_id and r.country = p_country and r.active),
         (select count(*)::int from registrations r where r.molecule_id = w.molecule_id and r.country = p_country and r.active),
         mv.added, mv.gone, mv.last_at,
         (select string_agg(x.c, ', ' order by x.n desc) from (
            select initcap(lower(r.manufacturing_country)) as c, count(*) as n from registrations r
            where r.molecule_id = w.molecule_id and r.country = p_country and r.active and r.manufacturing_country is not null
            group by 1 order by 2 desc limit 3) x),
         w.created_at
  from watches w join molecules m on m.id = w.molecule_id
  cross join lateral (
    select count(*) filter (where h.change in ('added', 'reactivated'))::int as added,
           count(*) filter (where h.change = 'removed' or (h.change = 'status' and (h.after->>'active')::boolean is false))::int as gone,
           max(h.created_at) filter (where h.change in ('added', 'reactivated', 'removed')
                                        or (h.change = 'status' and (h.after->>'active')::boolean is false)) as last_at
    from registration_history h join registrations r on r.id = h.registration_id
    where r.molecule_id = w.molecule_id and r.country = p_country and h.created_at > now() - interval '90 days') mv
  where w.user_id = app_uid()
  order by (mv.added + mv.gone) > 0 desc, m.inn
$$;
revoke all on function my_competitor_summary(text) from public;
grant execute on function my_competitor_summary(text) to nazryx_app;

-- Catalogues read before the reader knew generic-name columns (DCI, INN) and separate sheets: read them again. The
-- products already added keep their place and get their molecule; nothing is deleted.
update mfr_files set status = 'queued'
where kind = 'catalogue' and status = 'done' and coalesce(added, 0) > 0 and coalesce(matched, 0) * 2 < added
  and file_name ~* '\.(xlsx|xls|csv)$';

-- Partners where the registry names no local distributor (Kazakhstan, Kyrgyzstan): the companies holding the
-- registrations instead, local companies first. Markets with distributors (Tanzania, Kenya, Uzbekistan) are unchanged.
drop function if exists partner_search(text, text, int, boolean, int, text);
create function partner_search(p_country text, p_category text default null, p_molecule int default null,
                               p_local boolean default false, p_min_products int default 0, p_sort text default 'open')
returns table (code text, products int, molecules int, in_class int, classes int, top_classes text, carries_mine int, open_to int,
               carries boolean, local_maker boolean, total int, mine int, by_holder boolean)
language sql stable security definer set search_path = public as $$
  with md as (select not exists (select 1 from registrations where country = p_country and active and ltr_id is not null) as holder,
                     (select upper(name) from countries where code = p_country) as cname),
  mine as (select distinct molecule_id from mfr_products where user_id = app_uid() and molecule_id is not null),
  held as (
    select case when md.holder then r.registrant_id else r.ltr_id end as company_id, r.molecule_id, m.category
    from registrations r cross join md left join molecules m on m.id = r.molecule_id
    where r.country = p_country and r.active and app_uid() is not null
  ),
  agg as (
    select h.company_id,
           count(distinct h.molecule_id) filter (where h.category = p_category)::int as in_class,
           count(distinct h.molecule_id) filter (where h.molecule_id in (select molecule_id from mine))::int as carries_mine,
           coalesce(bool_or(h.molecule_id = p_molecule), false) as carries
    from held h where h.company_id is not null group by h.company_id
  ),
  base as (
    select c.id, s.registrations as products, s.molecules, s.categories as classes, a.in_class, a.carries_mine,
           p_molecule is not null and a.carries as carries, md.holder,
           case when md.holder then upper(coalesce(c.country, '')) = md.cname else c.is_manufacturer end as local_maker
    from agg a join companies c on c.id = a.company_id join company_stats s on s.company_id = c.id and s.country = p_country
    cross join md
    where c.merged_into is null and s.registrations > 0 and (md.holder or c.is_ltr)
      and s.registrations >= coalesce(p_min_products, 0)
  ),
  filtered as (
    select b.*, (select count(*)::int from mine) - b.carries_mine as open_to, count(*) over ()::int as total
    from base b where (p_category is null or b.in_class > 0) and (not p_local or b.local_maker)
    order by b.holder and b.local_maker desc,
             case p_sort when 'size' then b.products when 'class' then b.in_class else b.carries_mine * -1 end desc, b.products desc
    limit case when mfr_tier_in(p_country) >= 2 then 200 when mfr_tier_in(p_country) = 1 then 10 else 3 end
  )
  select partner_code(f.id), f.products, f.molecules, f.in_class, f.classes,
         (select string_agg(x.category, ', ' order by x.n desc, x.category) from (
            select m.category, count(*) as n from registrations r join molecules m on m.id = r.molecule_id
            where r.country = p_country and r.active and m.category is not null
              and case when f.holder then r.registrant_id = f.id else r.ltr_id = f.id end
            group by 1 order by 2 desc, 1 limit 3) x),
         f.carries_mine, f.open_to, f.carries, f.local_maker, f.total, (select count(*)::int from mine), f.holder
  from filtered f
  order by f.holder and f.local_maker desc,
           case p_sort when 'size' then f.products when 'class' then f.in_class else f.open_to end desc, f.products desc
$$;
revoke all on function partner_search(text, text, int, boolean, int, text) from public;
grant execute on function partner_search(text, text, int, boolean, int, text) to nazryx_app;
