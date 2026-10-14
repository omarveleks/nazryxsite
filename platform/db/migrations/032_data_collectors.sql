-- Data the worker collects by itself (ingest/collect.py): one row per source with its health, the medicine tenders
-- it finds, and regulated prices. A registry pull that is much smaller than what is loaded waits for the team
-- ("held") instead of replacing good data. No supplier or personal names are stored for tenders.

create table data_sources (
  key text primary key,
  country text not null references countries(code),
  kind text not null check (kind in ('registry', 'tenders', 'prices')),
  label text not null,
  url text not null,
  every_hours int not null,
  enabled boolean not null default true,
  run_now boolean not null default false,
  last_run timestamptz,
  last_ok timestamptz,
  last_rows int,
  last_error text,
  held_path text,
  held_rows int,
  release_held boolean not null default false
);
insert into data_sources (key, country, kind, label, url, every_hours) values
  ('registry_KZ', 'KZ', 'registry', 'Kazakhstan medicine register (NDDA)', 'https://register.ndda.kz', 168),
  ('registry_UZ', 'UZ', 'registry', 'Uzbekistan drug catalogue (Pharmaceutical Agency)', 'https://api.pharmagency.uz', 168),
  ('registry_KG', 'KG', 'registry', 'Kyrgyzstan medicine register (national drug database)', 'https://ndb.med.kg', 168),
  ('registry_KE', 'KE', 'registry', 'Kenya registered products (Pharmacy and Poisons Board)', 'https://products.pharmacyboardkenya.org', 168),
  ('registry_TZ', 'TZ', 'registry', 'Tanzania registered medicines (TMDA)', 'https://imis2.tmda.go.tz', 168),
  ('tenders_KZ', 'KZ', 'tenders', 'Kazakhstan single distributor lots (SK-Pharmacy)', 'https://fms.ecc.kz', 24),
  ('tenders_KE', 'KE', 'tenders', 'Kenya public tenders (PPIP open data)', 'https://tenders.go.ke', 24),
  ('tenders_TZ', 'TZ', 'tenders', 'Tanzania public tenders (NeST open data)', 'https://nest.go.tz', 24),
  ('tenders_UZ', 'UZ', 'tenders', 'Uzbekistan e-tenders (UZEX)', 'https://etender.uzex.uz', 24),
  ('prices_UZ', 'UZ', 'prices', 'Uzbekistan reference and maximum prices', 'https://api.pharmagency.uz', 72);

alter table data_sources enable row level security;
create policy data_sources_team on data_sources for select using (app_is_team());
create policy data_sources_team_update on data_sources for update using (app_is_team()) with check (app_is_team());
grant select on data_sources to nazryx_app;
grant update (enabled, run_now, release_held) on data_sources to nazryx_app;

create table tenders (
  id bigserial primary key,
  country text not null references countries(code),
  source text not null,
  ref text not null,
  title text not null,
  buyer text,
  stage text not null check (stage in ('open', 'awarded', 'closed')),
  published date,
  closing date,
  awarded date,
  value numeric,
  currency text,
  quantity numeric,
  unit_price numeric,
  bidders int,
  url text,
  molecule_ids int[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (source, ref)
);
create index tenders_molecules on tenders using gin (molecule_ids);
create index tenders_recent on tenders (country, coalesce(awarded, closing, published) desc);
alter table tenders enable row level security;
create policy tenders_read on tenders for select using (app_uid() is not null);
grant select on tenders to nazryx_app;

create table reference_prices (
  id bigserial primary key,
  country text not null references countries(code),
  certificate_no text not null,
  name text,
  pack text,
  molecule_id int references molecules(id) on delete set null,
  currency text,
  reference_price numeric,
  max_wholesale numeric,
  max_retail numeric,
  updated_at timestamptz not null default now(),
  unique (country, certificate_no, pack)
);
create index reference_prices_molecule on reference_prices (molecule_id, country);
alter table reference_prices enable row level security;
create policy reference_prices_read on reference_prices for select using (app_uid() is not null);
grant select on reference_prices to nazryx_app;
