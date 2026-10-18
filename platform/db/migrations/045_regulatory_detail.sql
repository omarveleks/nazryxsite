-- Regulatory, made specific per market: researched requirements carry their source and the date they were checked;
-- registration routes per country (with realistic timelines and official fees); the documents each market asks for,
-- turned into a checklist per product; and the regulators' news, collected so changes reach the products they touch.

alter table reg_requirements add column source text, add column checked date, add column confidence text,
  add column origin text not null default 'team' check (origin in ('team', 'seed', 'research'));
-- the generic starter rules written with the regulatory section (migration 024) are 'seed': researched rules replace them
update reg_requirements set origin = 'seed'
  where updated_at <= (select applied_at + interval '5 minutes' from schema_migrations where name like '024%');

create table country_routes (
  country text not null references countries(code),
  key text not null,
  label text not null,
  description text,
  months_low int, months_high int,
  fee_usd_low numeric, fee_usd_high numeric,
  eligibility text not null default 'all',     -- all | sra_or_pq (needs a stringent-regulator approval or WHO PQ) | eaeu | eac
  source text, checked date,
  sort int not null default 100,
  primary key (country, key)
);
alter table country_routes enable row level security;
create policy country_routes_read on country_routes for select using (app_uid() is not null);
create policy country_routes_team on country_routes for all using (app_is_team()) with check (app_is_team());
grant select, insert, update, delete on country_routes to nazryx_app;

create table reg_checklist (
  id serial primary key,
  country text not null references countries(code),
  name text not null,
  applies text not null default 'all' check (applies in ('all', 'class', 'atc', 'form', 'molecule')),
  match text,
  note text,
  source text,
  sort int not null default 100
);
create index reg_checklist_country on reg_checklist (country);
alter table reg_checklist enable row level security;
create policy reg_checklist_read on reg_checklist for select using (app_uid() is not null);
create policy reg_checklist_team on reg_checklist for all using (app_is_team()) with check (app_is_team());
grant select, insert, update, delete on reg_checklist to nazryx_app;
grant usage on sequence reg_checklist_id_seq to nazryx_app;

create table product_checklist (                 -- what a manufacturer has ready, per product and market
  product_id int not null references mfr_products(id) on delete cascade,
  country text not null,
  item text not null,                            -- the document's name (stable across checklist reloads)
  user_id uuid not null references users(id) on delete cascade,
  done_at timestamptz not null default now(),
  primary key (product_id, country, item)
);
alter table product_checklist enable row level security;
create policy product_checklist_own on product_checklist for all using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid());
grant select, insert, delete on product_checklist to nazryx_app;

create table reg_news (
  id bigserial primary key,
  country text not null references countries(code),
  source text not null,
  url text not null unique,
  title text not null,
  title_en text,
  published date,
  found_at timestamptz not null default now(),
  baseline boolean not null default false,       -- already there on the first read: not news
  molecule_ids int[] not null default '{}'
);
create index reg_news_recent on reg_news (country, found_at desc);
alter table reg_news enable row level security;
create policy reg_news_read on reg_news for select using (app_uid() is not null);
grant select on reg_news to nazryx_app;

alter table data_sources drop constraint data_sources_kind_check;
alter table data_sources add constraint data_sources_kind_check check (kind in ('registry', 'tenders', 'prices', 'news'));
