-- The registry welcome matched a new manufacturer called "X Generics" to a company named just "Generics": a company whose
-- whole name is one generic trade word no longer matches by containment, only exactly. (The wizard also stopped
-- pre-ticking the companies it finds.)
create or replace function mfr_find_registrations(p_name text)
returns table (company_id int, name text, country text, registrations int, molecules int)
language sql stable security definer set search_path = public as $$
  with k as (select company_key(p_name) as key),
       generic as (select unnest(array['generics', 'generic', 'pharma', 'pharmaceuticals', 'pharmaceutical', 'laboratories', 'laboratory', 'labs',
                                       'medical', 'medicines', 'medicine', 'healthcare', 'health', 'industries', 'industry', 'international',
                                       'limited', 'company', 'group', 'chemicals', 'biotech', 'remedies', 'drugs']) as w)
  select c.id, c.display_name, r.country, count(*)::int, count(distinct r.molecule_id)::int
  from k cross join companies c
  join registrations r on r.manufacturer_id = c.id and r.active
  where c.merged_into is null and k.key is not null and length(k.key) >= 4
    and (company_key(c.display_name) = k.key
         or (length(k.key) >= 6 and company_key(c.display_name) like '%' || k.key || '%' and k.key not in (select w from generic))
         or (length(company_key(c.display_name)) >= 6 and k.key like '%' || company_key(c.display_name) || '%'
             and company_key(c.display_name) not in (select w from generic)))
  group by c.id, c.display_name, r.country
  order by count(*) desc limit 40;
$$;
revoke all on function mfr_find_registrations(text) from public;
grant execute on function mfr_find_registrations(text) to nazryx_app;
