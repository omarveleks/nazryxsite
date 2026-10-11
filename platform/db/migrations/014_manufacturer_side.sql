-- Manufacturer side: foreign manufacturers expanding into new markets. Subscription screens read public market data;
-- agency services (market entry, dossier review, local representative, EAC roll-out, post-registration, partner
-- introductions, 24-hour reports) run as engagements the Nazryx team works on.

insert into countries (code, name, enabled) values
  ('UZ', 'Uzbekistan', false), ('CM', 'Cameroon', false), ('SN', 'Senegal', false), ('KZ', 'Kazakhstan', false), ('KE', 'Kenya', false)
on conflict (code) do nothing;

-- 1. Account type. Distributors stay the default; manufacturers get their own pages and navigation.
alter table users add column account_type text not null default 'distributor' check (account_type in ('distributor', 'manufacturer'));
grant update (account_type) on users to nazryx_app;
-- the account type is picked at sign-up; after onboarding only the team can change it
create or replace function guard_account_type() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account_type is distinct from old.account_type and old.onboarded and app_uid() is not null and not app_is_team() then
    raise exception 'Ask the Nazryx team to change your account type';
  end if;
  return new;
end $$;
create trigger users_account_type_guard before update on users for each row execute function guard_account_type();

create table manufacturer_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  company_name text not null,
  hq_country text,
  website text,
  certifications text[] not null default '{}',     -- WHO PQ, EU GMP, US FDA, PIC/S, national GMP ...
  target_countries text[] not null default '{}',   -- country codes they want to enter
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  team_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table manufacturer_profiles enable row level security;
create policy mfr_profile_own on manufacturer_profiles for select using (user_id = app_uid() or app_is_team());
create policy mfr_profile_insert on manufacturer_profiles for insert with check (user_id = app_uid() and status = 'pending');
create policy mfr_profile_update_own on manufacturer_profiles for update using (user_id = app_uid() or app_is_team())
  with check (user_id = app_uid() or app_is_team());
-- the manufacturer edits its own details; only the team approves (status, note, review date)
create or replace function guard_mfr_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is not null and not app_is_team() and (new.status is distinct from old.status or new.team_note is distinct from old.team_note
                            or new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'Only the Nazryx team can approve a manufacturer';
  end if;
  return new;
end $$;
create trigger mfr_profile_guard before update on manufacturer_profiles for each row execute function guard_mfr_profile();
grant select, insert, update (company_name, hq_country, website, certifications, target_countries) on manufacturer_profiles to nazryx_app;
grant update (status, team_note, reviewed_at) on manufacturer_profiles to nazryx_app;

-- 2. Product catalogue with a dossier self-check (what the manufacturer says it has; the team verifies in a dossier review).
create table mfr_products (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,                               -- as the manufacturer wrote it
  molecule_id int references molecules(id),         -- matched molecule, if any
  strength text, dosage_form text,
  who_pq boolean not null default false,            -- WHO prequalified
  sra_approved boolean not null default false,      -- approved by a stringent regulator (EU, US, UK, Japan ...)
  ctd_ready boolean not null default false,         -- dossier in CTD format
  be_study boolean not null default false,          -- bioequivalence study available
  zone_ivb boolean not null default false,          -- stability data for climatic zone IVb
  created_at timestamptz not null default now()
);
create index mfr_products_user on mfr_products (user_id);
alter table mfr_products enable row level security;
create policy mfr_products_own on mfr_products for all using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid() or app_is_team());
grant select, insert, update, delete on mfr_products to nazryx_app;
grant usage on sequence mfr_products_id_seq to nazryx_app;

-- 3. Agency engagements: each service the team delivers, with a milestone stage the client can follow.
create table engagements (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('market_entry', 'dossier_review', 'local_rep', 'eac_rollout', 'post_registration', 'partner_intro', 'report')),
  country text references countries(code),
  product_id int references mfr_products(id) on delete set null,
  report_type text,                                  -- for kind = report
  detail text,                                       -- what the client asked for
  stage text not null default 'Requested',
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_at timestamptz,                                -- reports: 24 hours after ordering
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index engagements_user on engagements (user_id, updated_at desc);
alter table engagements enable row level security;
create policy engagements_own on engagements for select using (user_id = app_uid() or app_is_team());
create policy engagements_insert on engagements for insert with check (user_id = app_uid() and stage = 'Requested' and status = 'open');
create policy engagements_team_update on engagements for update using (app_is_team()) with check (app_is_team());
grant select, insert on engagements to nazryx_app;
grant update (stage, status, updated_at, due_at) on engagements to nazryx_app;
grant usage on sequence engagements_id_seq to nazryx_app;

create table engagement_messages (
  id serial primary key,
  engagement_id int not null references engagements(id) on delete cascade,
  from_team boolean not null default false,
  author_id uuid,
  body text not null,
  created_at timestamptz not null default now()
);
alter table engagement_messages enable row level security;
create policy eng_msgs_read on engagement_messages for select using (exists (select 1 from engagements e where e.id = engagement_id));
create policy eng_msgs_insert on engagement_messages for insert with check (
  (from_team and app_is_team()) or (not from_team and exists (select 1 from engagements e where e.id = engagement_id and e.user_id = app_uid())));
grant select, insert on engagement_messages to nazryx_app;
grant usage on sequence engagement_messages_id_seq to nazryx_app;

-- documents: the client uploads dossier documents; the team marks each accepted or a gap, and delivers reports here
create table engagement_files (
  id serial primary key,
  engagement_id int not null references engagements(id) on delete cascade,
  item text,                                         -- dossier item key, or 'report' for a delivered report
  file_path text not null,
  file_name text not null,
  from_team boolean not null default false,
  review text not null default 'submitted' check (review in ('submitted', 'accepted', 'gap')),
  team_comment text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
alter table engagement_files enable row level security;
create policy eng_files_read on engagement_files for select using (exists (select 1 from engagements e where e.id = engagement_id));
create policy eng_files_insert on engagement_files for insert with check (
  (from_team and app_is_team()) or (not from_team and exists (select 1 from engagements e where e.id = engagement_id and e.user_id = app_uid())));
create policy eng_files_team_update on engagement_files for update using (app_is_team()) with check (app_is_team());
grant select, insert on engagement_files to nazryx_app;
grant update (review, team_comment) on engagement_files to nazryx_app;
grant usage on sequence engagement_files_id_seq to nazryx_app;

-- stored files linked to an engagement are readable by the engagement's owner
create policy stored_files_engagement_read on stored_files for select using (
  exists (select 1 from engagement_files f join engagements e on e.id = f.engagement_id
          where f.file_path = 'db:' || stored_files.id::text and (e.user_id = app_uid() or app_is_team())));

-- 4. After registration: renewals, variations and safety-reporting deadlines per product and country (team keeps them).
create table obligations (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  product_id int references mfr_products(id) on delete cascade,
  country text references countries(code),
  kind text not null check (kind in ('renewal', 'variation', 'safety_report', 'other')),
  due_date date not null,
  note text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table obligations enable row level security;
create policy obligations_read on obligations for select using (user_id = app_uid() or app_is_team());
create policy obligations_team_write on obligations for all using (app_is_team()) with check (app_is_team());
grant select, insert, update, delete on obligations to nazryx_app;
grant usage on sequence obligations_id_seq to nazryx_app;

-- 5. Partner finder: distributor profiles without names. Each profile carries an opaque code; only the team can
--    turn a code back into a company, through an introduction request.
create table app_secrets (name text primary key, value text not null);
insert into app_secrets values ('partner_code', md5(random()::text || clock_timestamp()::text)) on conflict do nothing;
revoke all on app_secrets from public;

create or replace function partner_code(p_company int) returns text
language sql stable security definer set search_path = public as $$
  select upper(substr(md5(p_company::text || (select value from app_secrets where name = 'partner_code')), 1, 8))
$$;
revoke all on function partner_code(int) from public;

-- distributor profiles strong in a class: products, molecules, classes and levels reached, whether they carry a molecule
create or replace function partner_profiles(p_category text, p_molecule int default null)
returns table (code text, products int, molecules int, in_class int, classes int, levels text, carries boolean, local_maker boolean)
language sql stable security definer set search_path = public as $$
  select partner_code(c.id), s.registrations, s.molecules,
         (select count(distinct r.molecule_id)::int from registrations r join molecules m on m.id = r.molecule_id
            where r.ltr_id = c.id and r.active and m.category = p_category),
         s.categories,
         (select string_agg(distinct cm.facility_level, '' order by cm.facility_level) from registrations r
            join country_molecules cm on cm.molecule_id = r.molecule_id and cm.country = r.country
            where r.ltr_id = c.id and r.active and cm.facility_level is not null),
         p_molecule is not null and exists (select 1 from registrations r where r.ltr_id = c.id and r.active and r.molecule_id = p_molecule),
         c.is_manufacturer
  from companies c join company_stats s on s.company_id = c.id and s.country = 'TZ'
  where c.is_ltr and c.merged_into is null and s.registrations > 0
    and app_uid() is not null
    and exists (select 1 from registrations r join molecules m on m.id = r.molecule_id
                where r.ltr_id = c.id and r.active and m.category = p_category)
  order by 4 desc, s.registrations desc
  limit 25
$$;
revoke all on function partner_profiles(text, int) from public;
grant execute on function partner_profiles(text, int) to nazryx_app;

-- the team side of an introduction: which company a code stands for (team only)
create or replace function partner_company(p_code text) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  return (select c.id from companies c where partner_code(c.id) = upper(p_code) limit 1);
end $$;
revoke all on function partner_company(text) from public;
grant execute on function partner_company(text) to nazryx_app;

create trigger audit_manufacturer_profiles after insert or update on manufacturer_profiles for each row execute function audit_team_change();
create trigger audit_engagements after insert or update on engagements for each row execute function audit_team_change();
create trigger audit_engagement_files after update on engagement_files for each row execute function audit_team_change();
create trigger audit_obligations after insert or update on obligations for each row execute function audit_team_change();
