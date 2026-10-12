-- 1. Manufacturer files: catalogues and the starter pack (GMP, CPP, CoA, labels), uploaded any time from My products.
-- 2. Regulatory: documents the team uploads for every country (team only, never shown), and the requirements taken from
--    them, overall and for classes, forms or single molecules. Drafts until the team publishes them.
-- 3. Competitor watch for manufacturers (on the existing watches table): new competitors in the molecules they follow.
-- 4. Weekly summary: when the worker last sent one.

-- 1. manufacturer files
create table mfr_files (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('catalogue', 'gmp', 'cpp', 'coa', 'label', 'other')),
  file_path text not null,
  file_name text not null,
  note text,
  created_at timestamptz not null default now()
);
create index mfr_files_user on mfr_files (user_id, created_at desc);
alter table mfr_files enable row level security;
create policy mfr_files_own on mfr_files for select using (user_id = app_uid() or app_is_team());
create policy mfr_files_insert on mfr_files for insert with check (user_id = app_uid() or app_is_team());
create policy mfr_files_delete on mfr_files for delete using (user_id = app_uid() or app_is_team());
grant select, insert, delete on mfr_files to nazryx_app;
grant usage on sequence mfr_files_id_seq to nazryx_app;
create policy stored_files_mfr_files_read on stored_files for select using (
  exists (select 1 from mfr_files f where f.file_path = 'db:' || stored_files.id::text));
create trigger audit_mfr_files after insert or delete on mfr_files for each row execute function audit_team_change();

-- 2a. regulatory documents (guidelines, circulars, checklists) per country: team only
create table reg_documents (
  id serial primary key,
  country text not null references countries(code),
  title text not null,
  file_path text not null,
  file_name text not null,
  status text not null default 'queued' check (status in ('queued', 'reading', 'done', 'failed', 'manual')),
  error text,
  found int,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table reg_documents enable row level security;
create policy reg_documents_team on reg_documents for all using (app_is_team()) with check (app_is_team());
grant select, insert, update, delete on reg_documents to nazryx_app;
grant usage on sequence reg_documents_id_seq to nazryx_app;
create policy stored_files_reg_documents_read on stored_files for select using (
  app_is_team() and exists (select 1 from reg_documents d where d.file_path = 'db:' || stored_files.id::text));
create trigger audit_reg_documents after insert or update or delete on reg_documents for each row execute function audit_team_change();

-- 2b. requirements: applies to every product ('all'), or to a therapeutic class, an ATC code prefix, a dosage form or one molecule
create table reg_requirements (
  id serial primary key,
  country text not null references countries(code),
  topic text not null,
  applies text not null default 'all' check (applies in ('all', 'class', 'atc', 'form', 'molecule')),
  match text check ((applies = 'all') = (match is null)),
  title text not null,
  body text not null,
  status text not null default 'published' check (status in ('draft', 'published')),
  document_id int references reg_documents(id) on delete set null,
  sort int not null default 100,
  updated_at timestamptz not null default now()
);
create index reg_requirements_country on reg_requirements (country, status);
alter table reg_requirements enable row level security;
create policy reg_requirements_read on reg_requirements for select using ((status = 'published' and app_uid() is not null) or app_is_team());
create policy reg_requirements_team on reg_requirements for all using (app_is_team()) with check (app_is_team());
grant select, insert, update, delete on reg_requirements to nazryx_app;
grant usage on sequence reg_requirements_id_seq to nazryx_app;
create trigger audit_reg_requirements after insert or update or delete on reg_requirements for each row execute function audit_team_change();

-- starting content for the five data markets; the team edits it in Admin > Regulatory
-- (Tanzania is normally added after the migrations; make sure it exists first)
insert into countries (code, name, enabled) values ('TZ', 'Tanzania', true) on conflict (code) do nothing;
insert into reg_requirements (country, topic, applies, match, title, body, sort) values
  ('TZ', 'Route', 'all', null, 'Regulator and route', 'TMDA assesses a full dossier in CTD format. Products approved by a stringent regulator or prequalified by WHO can take a shorter, abridged route.', 10),
  ('TZ', 'Local representative', 'all', null, 'Local technical representative', 'A local technical representative registered in Tanzania files and holds the application for you.', 20),
  ('TZ', 'Site and GMP', 'all', null, 'GMP clearance of every site', 'Each manufacturing site needs GMP clearance, by inspection or by review of recent inspection reports.', 30),
  ('TZ', 'Dossier', 'all', null, 'Stability for hot, humid climates', 'Long-term stability data at 30 °C / 75% RH (climatic zone IVb).', 40),
  ('TZ', 'Labelling', 'all', null, 'Labels', 'Labels and leaflet in English or Kiswahili, with name, strength, batch, expiry and storage on every pack.', 50),
  ('TZ', 'Samples', 'all', null, 'Samples for testing', 'Commercial samples go with the dossier for laboratory testing.', 60),
  ('TZ', 'After approval', 'all', null, 'Keeping the registration', 'An annual retention fee keeps the product on the register. Changes to the product or site need approval first.', 70),
  ('KE', 'Route', 'all', null, 'Regulator and route', 'The Pharmacy and Poisons Board assesses a CTD dossier, filed online. Products approved by a stringent regulator or prequalified by WHO can rely on that approval.', 10),
  ('KE', 'Local representative', 'all', null, 'Local technical representative', 'A local technical representative licensed in Kenya files and holds the registration.', 20),
  ('KE', 'Site and GMP', 'all', null, 'GMP inspection', 'Each manufacturing site needs a GMP inspection or recognition of a recent one.', 30),
  ('KE', 'Dossier', 'all', null, 'Stability for hot, humid climates', 'Long-term stability data at 30 °C / 75% RH (climatic zone IVb).', 40),
  ('KE', 'Labelling', 'all', null, 'Labels', 'Labels and leaflet in English.', 50),
  ('KE', 'Samples', 'all', null, 'Samples for testing', 'Samples go with the application for laboratory testing.', 60),
  ('KE', 'After approval', 'all', null, 'Keeping the registration', 'An annual retention fee keeps the product registered; renewal is periodic. Changes need approval first.', 70),
  ('KZ', 'Route', 'all', null, 'Regulator and route', 'New registrations follow the EAEU rules, with Kazakhstan as the reference state. Other EAEU states can then recognise the approval.', 10),
  ('KZ', 'Local representative', 'all', null, 'Representative', 'A representative in the region handles the application and safety reporting.', 20),
  ('KZ', 'Site and GMP', 'all', null, 'EAEU GMP inspection', 'The manufacturing site is inspected to EAEU GMP, or a recent inspection is recognised.', 30),
  ('KZ', 'Dossier', 'all', null, 'Dossier and stability', 'A CTD dossier with long-term stability data for climatic zone II (25 °C / 60% RH).', 40),
  ('KZ', 'Labelling', 'all', null, 'Labels in Kazakh and Russian', 'Packs and the patient leaflet carry Kazakh and Russian text.', 50),
  ('KZ', 'Marking', 'all', null, 'Pack marking', 'Plan for a Data Matrix code on every pack for national track and trace.', 60),
  ('KZ', 'Samples', 'all', null, 'Samples and standards', 'Samples and reference standards for laboratory testing during the assessment.', 70),
  ('KG', 'Route', 'all', null, 'Regulator and route', 'New registrations follow the EAEU rules, or a national procedure. An approval from another EAEU state can be recognised.', 10),
  ('KG', 'Local representative', 'all', null, 'Representative', 'A representative in the region handles the application and safety reporting.', 20),
  ('KG', 'Site and GMP', 'all', null, 'EAEU GMP inspection', 'The manufacturing site is inspected to EAEU GMP, or a recent inspection is recognised.', 30),
  ('KG', 'Dossier', 'all', null, 'Dossier and stability', 'A CTD dossier with long-term stability data for climatic zone II (25 °C / 60% RH).', 40),
  ('KG', 'Labelling', 'all', null, 'Labels in Russian', 'Packs and the patient leaflet carry Russian text, with Kyrgyz where required.', 50),
  ('UZ', 'Route', 'all', null, 'Regulator and route', 'A national registration. Uzbekistan is not in the EAEU, so an EAEU approval does not cover it. Products approved by a stringent regulator can take a faster route.', 10),
  ('UZ', 'Site and GMP', 'all', null, 'GMP', 'A site inspection, or recognition of your GMP certificates.', 20),
  ('UZ', 'Labelling', 'all', null, 'Labels in Uzbek and Russian', 'Packs and the patient leaflet carry Uzbek and Russian text.', 30),
  ('UZ', 'Marking', 'all', null, 'Digital marking', 'Every pack carries a Data Matrix code in the national track-and-trace system.', 40),
  ('UZ', 'Samples', 'all', null, 'Samples for testing', 'Samples for laboratory testing during the assessment.', 50);

-- the same rules for product types in every data market
insert into reg_requirements (country, topic, applies, match, title, body, sort)
select c, t.topic, t.applies, t.match, t.title, t.body, t.sort from unnest(array['TZ', 'KE', 'KZ', 'KG', 'UZ']) as c,
  (values
    ('Dossier', 'form', 'tablet', 'Bioequivalence', 'Oral solid generics need a bioequivalence study against the reference product, or a justified biowaiver.', 200),
    ('Dossier', 'form', 'capsule', 'Bioequivalence', 'Oral solid generics need a bioequivalence study against the reference product, or a justified biowaiver.', 200),
    ('Dossier', 'form', 'inject', 'Sterile product', 'Sterility assurance, validation of the sterile steps and endotoxin data.', 210),
    ('Dossier', 'form', 'infusion', 'Sterile product', 'Sterility assurance, validation of the sterile steps and endotoxin data.', 210),
    ('Import', 'atc', 'N02A', 'Controlled medicine', 'Opioids are controlled: every shipment needs import and export permits, on top of registration.', 220),
    ('Import', 'atc', 'N05BA', 'Controlled medicine', 'Benzodiazepines are controlled: every shipment needs import and export permits, on top of registration.', 220),
    ('Import', 'atc', 'N05CD', 'Controlled medicine', 'Benzodiazepines are controlled: every shipment needs import and export permits, on top of registration.', 220),
    ('Import', 'atc', 'N06BA', 'Controlled medicine', 'Stimulants are controlled: every shipment needs import and export permits, on top of registration.', 220),
    ('Dossier', 'atc', 'J07', 'Vaccine', 'Plan for lot release testing or reliance on WHO prequalification, and cold-chain data for transport and storage.', 230),
    ('Dossier', 'atc', 'A10A', 'Insulin', 'A biological product: comparability data with the reference product rather than a bioequivalence study, and cold-chain data.', 230)
  ) as t(topic, applies, match, title, body, sort);

-- 3. competitor watch: new, lapsed and returning registrations in the molecules this manufacturer follows.
--    Companies stay anonymous: only the country where the product is made.
create or replace function my_competitor_watch(p_countries text[], p_days int default 90)
returns table (change text, country text, molecule_id int, molecule text, made_in text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select h.change, r.country, r.molecule_id, m.inn, initcap(lower(r.manufacturing_country)), h.created_at
  from registration_history h
  join registrations r on r.id = h.registration_id
  join molecules m on m.id = r.molecule_id
  where h.created_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
    and r.country = any(p_countries)
    and (h.change in ('added', 'removed', 'reactivated') or (h.change = 'status' and (h.after->>'active')::boolean is false))
    and r.molecule_id in (select w.molecule_id from watches w where w.user_id = app_uid())
  order by h.created_at desc
  limit 100
$$;
revoke all on function my_competitor_watch(text[], int) from public;
grant execute on function my_competitor_watch(text[], int) to nazryx_app;

-- per watched molecule in one market: competitors now, new ones lately, where their products are made
create or replace function my_competitor_summary(p_country text)
returns table (molecule_id int, molecule text, category text, competitors int, products int, new_90 int, made_in text, watched_at timestamptz)
language sql stable security definer set search_path = public as $$
  select w.molecule_id, m.inn, m.category,
         (select count(distinct r.ltr_id)::int from registrations r where r.molecule_id = w.molecule_id and r.country = p_country and r.active),
         (select count(*)::int from registrations r where r.molecule_id = w.molecule_id and r.country = p_country and r.active),
         (select count(*)::int from registration_history h join registrations r on r.id = h.registration_id
            where r.molecule_id = w.molecule_id and r.country = p_country and h.change = 'added' and h.created_at > now() - interval '90 days'),
         (select string_agg(x.c, ', ' order by x.n desc) from (
            select initcap(lower(r.manufacturing_country)) as c, count(*) as n from registrations r
            where r.molecule_id = w.molecule_id and r.country = p_country and r.active and r.manufacturing_country is not null
            group by 1 order by 2 desc limit 3) x),
         w.created_at
  from watches w join molecules m on m.id = w.molecule_id
  where w.user_id = app_uid()
  order by m.inn
$$;
revoke all on function my_competitor_summary(text) from public;
grant execute on function my_competitor_summary(text) to nazryx_app;

-- 4. weekly summary (worker only)
alter table manufacturer_profiles add column digest_sent_at timestamptz;

-- 5. a team permission for the regulatory library
create or replace function team_valid_permissions(p text[]) returns boolean language sql immutable as $$
  select coalesce(p <@ array['data', 'content', 'claims', 'requests', 'manufacturers', 'questions', 'accounts', 'documents', 'activity', 'regulatory']::text[], false)
$$;
