-- The team sees who stands behind each anonymous partner code (customers never do).
create or replace function team_partner_names(p_country text) returns table (code text, name text, home text)
language sql stable security definer set search_path = public as $$
  select partner_code(c.id), c.display_name, c.country
  from companies c join company_stats s on s.company_id = c.id and s.country = p_country
  where app_is_team() and c.merged_into is null
$$;
revoke all on function team_partner_names(text) from public;
grant execute on function team_partner_names(text) to nazryx_app;
