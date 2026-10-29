-- Distributor names open on Complete Market Access (tier 2) in the markets the plan covers; the introduction stays
-- Nazryx's service. Basic Market Data and free accounts keep the codes. The team sees every name, as before.
create or replace function partner_names(p_country text) returns table (code text, name text, home text)
language sql stable security definer set search_path = public as $$
  select partner_code(c.id), c.display_name, c.country from companies c
  where (app_is_team() or mfr_tier_in(p_country) >= 2) and c.merged_into is null and (
    exists (select 1 from company_stats s where s.company_id = c.id and s.country = p_country)
    or exists (select 1 from devices d where d.company_id = c.id and d.country = p_country))
$$;
revoke all on function partner_names(text) from public;
grant execute on function partner_names(text) to nazryx_app;
