-- Medical devices (eye lubricants, eye-surgery viscoelastics, joint injections, nasal saline...) are registered apart from
-- medicines. Kenya (PPB) and Tanzania (TMDA) publish their device registers; we read them weekly. Manufacturers can name the
-- competitor brands they meet, and see per market whether each is registered and what it sells for.
create table devices (
  id bigserial primary key,
  country text not null,
  ref text not null,                    -- the register's own id or certificate number
  certificate_no text,
  brand text not null,
  description text,                     -- generic name or GMDN term
  intended_use text,
  risk_class text,
  manufacturer text,
  manufacturing_country text,
  holder text,
  ltr text,
  reg_year int,
  expires date,
  active boolean not null default true,
  use_group text,                       -- eye_drops, eye_surgery, joint, nasal (see ingest/devices.py)
  seen date not null default current_date,
  unique (country, ref)
);
create index devices_brand on devices (lower(brand));
alter table devices enable row level security;
create policy devices_read on devices for select using (app_uid() is not null);
grant select on devices to nazryx_app;

alter table price_listings add column description text;   -- the shop's own words, to tell lubricants from medicated drops
-- shop listings are public prices: signed-in users may read them (brand lookups); molecule summaries stay as they were
create policy price_listings_read on price_listings for select using (app_uid() is not null);
grant select on price_listings to nazryx_app;

alter table mfr_products add column use_group text;
create table mfr_competitors (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  product_id int not null references mfr_products(id) on delete cascade,
  brand text not null check (length(brand) between 2 and 80),
  created_at timestamptz not null default now(),
  unique (product_id, brand)
);
alter table mfr_competitors enable row level security;
create policy mfr_competitors_own on mfr_competitors for all using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid());
grant select, insert, delete on mfr_competitors to nazryx_app;
grant usage on sequence mfr_competitors_id_seq to nazryx_app;

alter table data_sources drop constraint data_sources_kind_check;
alter table data_sources add constraint data_sources_kind_check check (kind in ('registry', 'tenders', 'prices', 'news', 'devices'));
insert into data_sources (key, country, kind, label, url, every_hours, run_now) values
  ('devices_KE', 'KE', 'devices', 'Kenya medical device register (PPB, retained devices)',
   'https://products.pharmacyboardkenya.org/ppb_admin/pages/public_view_md_retained.php', 168, true),
  ('devices_TZ', 'TZ', 'devices', 'Tanzania medical device register (TMDA)', 'https://imis2.tmda.go.tz/publicaccess', 168, true)
on conflict (key) do nothing;
update data_sources set label = 'Kenya medicine prices (PPRA survey) and pharmacy listings (MyDawa)', run_now = true where key = 'prices_KE';
update data_sources set run_now = true where key = 'prices_TZ';
-- Tanzania's pharmacy pages are read again so devices and other products without a matched medicine are kept too
update source_items set checked_at = null where source = 'prices_TZ';
