-- 1. Manufacturer onboarding collects the full picture: company, manufacturing, markets, catalogue and needs,
--    then suggests a subscription. 2. Plan prices the team sets. 3. The team can upload documents everywhere:
--    on requests (dossier items, shipment documents, assessments, contracts), engagements, customer accounts and suppliers.

-- 1. Manufacturer profile: everything onboarding asks
alter table manufacturer_profiles
  add column contact_role text,
  add column company_size text,
  add column dosage_forms text[] not null default '{}',
  add column therapeutic_areas text[] not null default '{}',
  add column plant_countries text,
  add column export_markets text,
  add column registered_in text[] not null default '{}',   -- target countries where they already hold registrations
  add column timeline text,
  add column approach text,
  add column services text[] not null default '{}',
  add column products_next_year int,
  add column catalogue_path text,
  add column catalogue_name text,
  add column step int not null default 1,
  add column suggested_plan text,
  add column chosen_plan text,
  add column completed_at timestamptz;
grant update (contact_role, company_size, dosage_forms, therapeutic_areas, plant_countries, export_markets, registered_in, timeline,
              approach, services, products_next_year, catalogue_path, catalogue_name, step, suggested_plan, chosen_plan, completed_at)
  on manufacturer_profiles to nazryx_app;

-- the uploaded catalogue is readable by its owner and the team
create policy stored_files_mfr_catalogue_read on stored_files for select using (
  exists (select 1 from manufacturer_profiles p where p.catalogue_path = 'db:' || stored_files.id::text));

-- 2. Plan prices: set by the team, shown to signed-in users. Empty means "priced on your scope".
create table plan_prices (
  key text primary key,
  price text,
  note text,
  updated_at timestamptz not null default now()
);
alter table plan_prices enable row level security;
create policy plan_prices_read on plan_prices for select using (app_uid() is not null);
create policy plan_prices_team on plan_prices for all using (app_is_team()) with check (app_is_team());
grant select, insert, update on plan_prices to nazryx_app;
create trigger audit_plan_prices after insert or update on plan_prices for each row execute function audit_team_change();

-- 3a. Request documents: the team uploads too, tags each file to a dossier item or shipment document,
--     and can keep a file internal (team only).
alter table request_files drop constraint if exists request_files_kind_check;
alter table request_files add constraint request_files_kind_check
  check (kind in ('attachment', 'requirement_list', 'assessment', 'dossier', 'shipment', 'quote', 'contract', 'invoice', 'other'));
alter table request_files
  add column from_team boolean not null default false,
  add column item text,
  add column internal boolean not null default false,
  add column note text;
drop policy files_read on request_files;
create policy files_read on request_files for select using (
  exists (select 1 from requests r where r.id = request_id) and (not internal or app_is_team()));
drop policy files_insert on request_files;
create policy files_insert on request_files for insert with check (
  exists (select 1 from requests r where r.id = request_id) and uploaded_by = app_uid()
  and ((from_team and app_is_team()) or (not from_team and not internal and kind in ('attachment', 'requirement_list'))));
create policy files_team_delete on request_files for delete using (app_is_team());
grant delete on request_files to nazryx_app;
create trigger audit_request_files after insert or delete on request_files for each row execute function audit_team_change();

-- 3b. Engagement documents: internal files, and the team can remove a file
alter table engagement_files add column internal boolean not null default false;
drop policy eng_files_read on engagement_files;
create policy eng_files_read on engagement_files for select using (
  exists (select 1 from engagements e where e.id = engagement_id) and (not internal or app_is_team()));
drop policy eng_files_insert on engagement_files;
create policy eng_files_insert on engagement_files for insert with check (
  (from_team and app_is_team()) or (not from_team and not internal and exists (select 1 from engagements e where e.id = engagement_id and e.user_id = app_uid())));
create policy eng_files_team_delete on engagement_files for delete using (app_is_team());
grant delete on engagement_files to nazryx_app;

-- 3c. Account documents: agreements, invoices, NDAs and other papers for one customer account.
create table account_documents (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('agreement', 'nda', 'invoice', 'receipt', 'licence', 'certificate', 'report', 'other')),
  title text,
  file_path text not null,
  file_name text not null,
  internal boolean not null default false,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index account_documents_user on account_documents (user_id, created_at desc);
alter table account_documents enable row level security;
create policy account_docs_read on account_documents for select using ((user_id = app_uid() and not internal) or app_is_team());
create policy account_docs_team on account_documents for all using (app_is_team()) with check (app_is_team());
grant select, insert, delete on account_documents to nazryx_app;
grant usage on sequence account_documents_id_seq to nazryx_app;
create policy stored_files_account_read on stored_files for select using (
  exists (select 1 from account_documents d where d.file_path = 'db:' || stored_files.id::text));
create trigger audit_account_documents after insert or delete on account_documents for each row execute function audit_team_change();

-- 3d. Supplier documents: GMP certificates, CPPs, DMFs, product lists, agreements. Team only, with expiry dates.
create table supplier_documents (
  id serial primary key,
  supplier_id int not null references suppliers(id) on delete cascade,
  kind text not null check (kind in ('gmp', 'cpp', 'dmf', 'coa', 'product_list', 'price_list', 'agreement', 'licence', 'other')),
  product text,
  expires_on date,
  file_path text not null,
  file_name text not null,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index supplier_documents_supplier on supplier_documents (supplier_id);
alter table supplier_documents enable row level security;
create policy supplier_docs_team on supplier_documents for all using (app_is_team()) with check (app_is_team());
grant select, insert, delete on supplier_documents to nazryx_app;
grant usage on sequence supplier_documents_id_seq to nazryx_app;
create trigger audit_supplier_documents after insert or delete on supplier_documents for each row execute function audit_team_change();

-- the audit log also records deletions (the removed row)
create or replace function audit_team_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  skip text[] := array['password_hash', 'data', 'totp_secret'];
  n jsonb; o jsonb; diff jsonb := '{}'::jsonb; k text;
begin
  if not app_is_team() then return null; end if;
  if tg_op = 'DELETE' then n := to_jsonb(old) - skip; else n := to_jsonb(new) - skip; end if;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old) - skip;
    for k in select jsonb_object_keys(n) loop
      if n->k is distinct from o->k then diff := diff || jsonb_build_object(k, jsonb_build_array(o->k, n->k)); end if;
    end loop;
    if to_jsonb(new)->'password_hash' is distinct from to_jsonb(old)->'password_hash' then
      diff := diff || '{"password": "reset"}'::jsonb;
    end if;
    if diff = '{}'::jsonb then return null; end if;
  else
    diff := n;
  end if;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), lower(tg_op), tg_table_name, coalesce(n->>'id', n->>'molecule_id', n->>'alias', n->>'kind'), diff);
  return null;
end $$;
