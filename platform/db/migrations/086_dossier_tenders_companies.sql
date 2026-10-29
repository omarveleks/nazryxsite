-- The dossier builder (uploads and assignments per checklist item), the tender desk's numbers, and company pages.

create table dossier_files (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  product_id int not null references mfr_products(id) on delete cascade,
  country text not null references countries(code),
  item text not null,
  file_path text not null,
  file_name text not null,
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table dossier_files enable row level security;
create policy dossier_files_own on dossier_files for all
  using (user_id = app_uid() or user_id = (select owner_id from users where id = app_uid()) or app_is_team())
  with check (user_id = app_uid() or user_id = (select owner_id from users where id = app_uid()));
grant select, insert, update, delete on dossier_files to nazryx_app;
grant usage on sequence dossier_files_id_seq to nazryx_app;

create table dossier_meta (
  product_id int not null references mfr_products(id) on delete cascade,
  country text not null references countries(code),
  item text not null,
  assignee_id uuid references users(id) on delete set null,
  due_date date,
  note text,
  updated_at timestamptz not null default now(),
  primary key (product_id, country, item)
);
alter table dossier_meta enable row level security;
create policy dossier_meta_own on dossier_meta for all
  using (exists (select 1 from mfr_products p where p.id = product_id))
  with check (exists (select 1 from mfr_products p where p.id = product_id));
grant select, insert, update, delete on dossier_meta to nazryx_app;

-- the tender desk: what past awards say about a tender's molecules and its buyer
create or replace function tender_stats(p_tender bigint)
returns table (past_awards int, median_unit numeric, low_unit numeric, high_unit numeric, currency text, buyer_tenders int, buyer_awarded int,
               avg_bidders numeric, last_award date)
language sql stable security definer set search_path = public as $$
  with t as (select * from tenders where id = p_tender),
  same as (select x.* from tenders x, t where x.country = t.country and x.id <> t.id and x.stage = 'awarded' and x.unit_price is not null
             and x.molecule_ids && t.molecule_ids and coalesce(x.awarded, x.closing, x.published) > current_date - interval '3 years'),
  buyer as (select x.* from tenders x, t where x.country = t.country and x.id <> t.id and coalesce(x.buyer_en, x.buyer) = coalesce(t.buyer_en, t.buyer))
  select (select count(*)::int from same), (select percentile_cont(0.5) within group (order by unit_price) from same),
         (select min(unit_price) from same), (select max(unit_price) from same), (select max(currency) from same),
         (select count(*)::int from buyer), (select count(*)::int from buyer where stage = 'awarded'),
         (select avg(bidders) from same where bidders is not null), (select max(awarded) from same)
$$;
revoke all on function tender_stats(bigint) from public;
grant execute on function tender_stats(bigint) to nazryx_app;

-- a company page: the holder, distributor or maker behind a code, in one market. Names follow the plan.
create or replace function company_profile(p_code text, p_country text)
returns table (company_id int, name text, home text, is_ltr boolean, is_manufacturer boolean, is_registrant boolean, verified boolean,
               registrations int, molecules int, classes int, first_year int, latest_year int, recent int, local_maker boolean)
language sql stable security definer set search_path = public as $$
  select c.id, case when app_is_team() or mfr_tier_in(p_country) >= 2 then c.display_name end, c.country, c.is_ltr, c.is_manufacturer, c.is_registrant, c.verified,
         s.registrations, s.molecules, s.categories,
         (select min(r.reg_year) from registrations r where r.country = p_country and (r.ltr_id = c.id or r.registrant_id = c.id or r.manufacturer_id = c.id) and r.reg_year > 1990),
         (select max(r.reg_year) from registrations r where r.country = p_country and (r.ltr_id = c.id or r.registrant_id = c.id or r.manufacturer_id = c.id)),
         s.new_recent, c.is_manufacturer
  from companies c join company_stats s on s.company_id = c.id and s.country = p_country
  where partner_code(c.id) = upper(p_code) and c.merged_into is null and app_uid() is not null
$$;
revoke all on function company_profile(text, text) from public;
grant execute on function company_profile(text, text) to nazryx_app;

-- what a company holds in a market: every active registration, with the molecule, class, form, year and origin
create or replace function company_products(p_code text, p_country text)
returns table (id int, brand text, molecule_id int, inn text, category text, form text, strength text, reg_year int, made_in text, role text,
               mine boolean, unit_usd numeric, unit text)
language sql stable security definer set search_path = public as $$
  with c as (select c.id from companies c where partner_code(c.id) = upper(p_code) and c.merged_into is null limit 1)
  select r.id, r.brand, r.molecule_id, m.inn, m.category, coalesce(r.dosage_form, r.form), r.strength, r.reg_year, initcap(lower(r.manufacturing_country)),
         case when r.ltr_id = c.id then 'distributor' when r.manufacturer_id = c.id then 'maker' else 'holder' end,
         exists (select 1 from mfr_products p where p.user_id = app_uid() and p.molecule_id = r.molecule_id),
         mp.unit_usd, mp.unit
  from c join registrations r on (r.ltr_id = c.id or r.registrant_id = c.id or r.manufacturer_id = c.id) and r.country = p_country and r.active
  left join molecules m on m.id = r.molecule_id
  left join molecule_prices mp on mp.molecule_id = r.molecule_id and mp.country = p_country
  where app_uid() is not null
  order by m.category nulls last, m.inn, r.brand limit 500
$$;
revoke all on function company_products(text, text) from public;
grant execute on function company_products(text, text) to nazryx_app;

-- the companies around one: for a maker, the distributors carrying it; for a distributor, the makers it carries
create or replace function company_links(p_code text, p_country text)
returns table (code text, name text, role text, products int)
language sql stable security definer set search_path = public as $$
  with c as (select c.id, c.is_ltr from companies c where partner_code(c.id) = upper(p_code) and c.merged_into is null limit 1),
  links as (
    select case when r.ltr_id = c.id then r.manufacturer_id else r.ltr_id end as other_id,
           case when r.ltr_id = c.id then 'maker' else 'distributor' end as role
    from c join registrations r on (r.ltr_id = c.id or r.manufacturer_id = c.id) and r.country = p_country and r.active)
  select partner_code(o.id), case when app_is_team() or mfr_tier_in(p_country) >= 2 then o.display_name end, l.role, count(*)::int
  from links l join companies o on o.id = l.other_id and o.merged_into is null
  where l.other_id is not null and l.other_id <> (select id from c) and app_uid() is not null
  group by o.id, l.role order by count(*) desc limit 20
$$;
revoke all on function company_links(text, text) from public;
grant execute on function company_links(text, text) to nazryx_app;

-- where a company ranks by registrations in a market (codes are resolved inside: the code function stays private)
create or replace function company_rank(p_code text, p_country text) returns table (rank int, of int)
language sql stable security definer set search_path = public as $$
  with s as (select s.company_id, s.registrations, rank() over (order by s.registrations desc) as r, count(*) over () as n
             from company_stats s join companies c on c.id = s.company_id and c.merged_into is null where s.country = p_country)
  select r::int, n::int from s where partner_code(s.company_id) = upper(p_code) and app_uid() is not null
$$;
revoke all on function company_rank(text, text) from public;
grant execute on function company_rank(text, text) to nazryx_app;
