-- The opportunity finder, saved searches that alert, and the distributor pipeline.

-- every molecule in a market with what decides whether to register it: demand, who sells it, the price, the forms.
-- One function for the page and for the worker (saved searches), so both see the same list.
create or replace function find_opportunities(p_country text, p_category text default null, p_min_demand numeric default null,
                                              p_max_registrants int default null, p_essential boolean default false,
                                              p_form text default null, p_min_price_usd numeric default null, p_only_mine boolean default false,
                                              p_exclude_mine boolean default false)
returns table (molecule_id int, inn text, category text, registrants int, registrations int, on_national_list boolean, on_who_eml boolean,
               demand numeric, score numeric, forms text, unit_usd numeric, unit text, confidence text, mine boolean, local_made int)
language sql stable security definer set search_path = public as $$
  select cm.molecule_id, m.inn, m.category, cm.registrants, cm.registrations, cm.on_national_list, cm.on_who_eml, g.demand, g.score, cm.forms,
         mp.unit_usd, mp.unit, mp.confidence,
         exists (select 1 from mfr_products p where p.user_id = app_uid() and p.molecule_id = cm.molecule_id) as mine, cm.local_made
  from country_molecules cm join molecules m on m.id = cm.molecule_id
  left join visible_gap_scores g on g.molecule_id = cm.molecule_id and g.country = cm.country
  left join molecule_prices mp on mp.molecule_id = cm.molecule_id and mp.country = cm.country
  where cm.country = p_country and cm.rankable and m.inn is not null
    and (p_category is null or m.category = p_category)
    and (p_min_demand is null or g.demand >= p_min_demand)
    and (p_max_registrants is null or cm.registrants <= p_max_registrants)
    and (not p_essential or cm.on_national_list)
    and (p_form is null or coalesce(cm.forms, '') ilike '%' || p_form || '%' or coalesce(m.dosage_form, '') ilike '%' || p_form || '%')
    and (p_min_price_usd is null or mp.unit_usd >= p_min_price_usd)
    and (not p_only_mine or exists (select 1 from mfr_products p where p.user_id = app_uid() and p.molecule_id = cm.molecule_id))
    and (not p_exclude_mine or not exists (select 1 from mfr_products p where p.user_id = app_uid() and p.molecule_id = cm.molecule_id))
  order by g.score desc nulls last, cm.registrants, m.inn limit 500
$$;
revoke all on function find_opportunities(text, text, numeric, int, boolean, text, numeric, boolean, boolean) from public;
grant execute on function find_opportunities(text, text, numeric, int, boolean, text, numeric, boolean, boolean) to nazryx_app;

create table saved_searches (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  country text not null references countries(code),
  params jsonb not null default '{}',          -- category, min_demand, max_registrants, essential, form, min_price_usd, exclude_mine
  seen_ids int[] not null default '{}',        -- the molecules it matched last time, so new ones can be told
  created_at timestamptz not null default now(),
  checked_at timestamptz
);
alter table saved_searches enable row level security;
create policy saved_searches_own on saved_searches for all using (user_id = app_uid()) with check (user_id = app_uid());
grant select, insert, update, delete on saved_searches to nazryx_app;
grant usage on sequence saved_searches_id_seq to nazryx_app;

-- the distributor pipeline: each distributor a manufacturer is courting in a market, and where it stands
create table partner_pipeline (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  country text not null references countries(code),
  company_id int not null references companies(id) on delete cascade,
  stage text not null default 'shortlisted' check (stage in ('shortlisted', 'intro_requested', 'in_talks', 'nda', 'signed', 'dropped')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, country, company_id)
);
alter table partner_pipeline enable row level security;
create policy partner_pipeline_own on partner_pipeline for all using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid());
grant select, insert, update, delete on partner_pipeline to nazryx_app;
grant usage on sequence partner_pipeline_id_seq to nazryx_app;

-- the pipeline's rows with the distributor's profile (the code and, on Complete Market Access, the name)
create or replace function my_pipeline(p_country text)
returns table (id int, company_id int, code text, name text, stage text, note text, updated_at timestamptz, products int, molecules int, classes int,
               top_classes text, open_to int)
language sql stable security definer set search_path = public as $$
  select pl.id, pl.company_id, partner_code(pl.company_id),
         case when app_is_team() or mfr_tier_in(p_country) >= 2 then c.display_name end,
         pl.stage, pl.note, pl.updated_at, s.registrations, s.molecules, s.categories,
         (select string_agg(x.category, ', ') from (select m.category from registrations r join molecules m on m.id = r.molecule_id
            where r.country = p_country and r.active and (r.ltr_id = pl.company_id or r.registrant_id = pl.company_id) and m.category is not null
            group by m.category order by count(*) desc limit 2) x),
         (select count(distinct p.molecule_id)::int from mfr_products p where p.user_id = app_uid() and p.molecule_id is not null
            and not exists (select 1 from registrations r where r.country = p_country and r.active and r.molecule_id = p.molecule_id
                            and (r.ltr_id = pl.company_id or r.registrant_id = pl.company_id)))
  from partner_pipeline pl join companies c on c.id = pl.company_id
  left join company_stats s on s.company_id = pl.company_id and s.country = p_country
  where pl.user_id = app_uid() and pl.country = p_country
  order by array_position(array['signed', 'nda', 'in_talks', 'intro_requested', 'shortlisted', 'dropped'], pl.stage), pl.updated_at desc
$$;
revoke all on function my_pipeline(text) from public;
grant execute on function my_pipeline(text) to nazryx_app;

-- the molecule page: every registered product of a molecule in a market; holders named on Complete Market Access
create or replace function molecule_registrations(p_molecule int, p_country text)
returns table (id int, brand text, strength text, form text, reg_year int, made_in text, holder text, holder_code text, lapsed boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.brand, r.strength, coalesce(r.dosage_form, r.form), r.reg_year, initcap(lower(r.manufacturing_country)),
         case when app_is_team() or mfr_tier_in(p_country) >= 2 then c.display_name end, partner_code(c.id), not r.active
  from registrations r left join companies c on c.id = coalesce(r.ltr_id, r.registrant_id)
  where r.molecule_id = p_molecule and r.country = p_country
  order by r.active desc, r.reg_year desc nulls last, r.brand limit 300
$$;
revoke all on function molecule_registrations(int, text) from public;
grant execute on function molecule_registrations(int, text) to nazryx_app;

-- a saved search that finds new molecules writes an inbox item of its own kind
alter table inbox_items drop constraint inbox_items_kind_check;
alter table inbox_items add constraint inbox_items_kind_check
  check (kind in ('registration', 'competitor', 'tender', 'price', 'regulatory', 'notice', 'system', 'opportunity'));

-- a manufacturer resolves a distributor's code only among the profiles of a market it can see (shortlisting, introductions)
create or replace function partner_in_market(p_country text, p_code text) returns int
language sql stable security definer set search_path = public as $$
  select c.id from companies c
  where c.merged_into is null and upper(p_code) ~ '^[0-9A-F]{8}$' and partner_code(c.id) = upper(p_code)
    and (exists (select 1 from company_stats s where s.company_id = c.id and s.country = p_country)
         or exists (select 1 from devices d where d.company_id = c.id and d.country = p_country))
  limit 1
$$;
revoke all on function partner_in_market(text, text) from public;
grant execute on function partner_in_market(text, text) to nazryx_app;
