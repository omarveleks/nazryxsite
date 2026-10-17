-- Prices compared like for like: drops, syrups and creams per ml or g with the usual pack size; originator or generic
-- where a list says so; measured factors (a generic's price against the originator, the shelf price against an official
-- maximum). And the cost chain from ex-works to shelf per market, for the margin check.
alter table price_listings add column originator boolean;
alter table molecule_prices add column pack_size numeric;      -- for ml and g: the usual bottle or tube size

create table price_factors (
  key text primary key,          -- 'generic_vs_originator', 'shelf_vs_max'
  value numeric not null,
  n int not null default 0,      -- molecules it was measured on
  updated_at timestamptz not null default now()
);
alter table price_factors enable row level security;
create policy price_factors_read on price_factors for select using (app_uid() is not null);
grant select on price_factors to nazryx_app;

create table market_costs (       -- typical shares added on the way from ex-works to the shelf
  country text primary key references countries(code),
  freight numeric not null,        -- freight, insurance and clearance
  duty numeric not null,           -- import duty and fees
  distributor numeric not null,    -- distributor mark-up
  pharmacy numeric not null,       -- pharmacy mark-up
  vat numeric not null,            -- VAT on medicines
  updated_at timestamptz not null default now()
);
insert into market_costs (country, freight, duty, distributor, pharmacy, vat) values
  ('KE', 0.08, 0.045, 0.25, 0.35, 0), ('TZ', 0.08, 0.02, 0.25, 0.35, 0), ('KZ', 0.08, 0, 0.25, 0.35, 0),
  ('KG', 0.08, 0, 0.25, 0.35, 0), ('UZ', 0.08, 0, 0.25, 0.35, 0.12);
alter table market_costs enable row level security;
create policy market_costs_read on market_costs for select using (app_uid() is not null);
create policy market_costs_team on market_costs for update using (app_is_team()) with check (app_is_team());
grant select, update on market_costs to nazryx_app;

-- re-read South Africa's list so each price carries its originator or generic flag and its pack volume
delete from source_items where source = 'prices_NEAR' and ref = 'za';
update data_sources set run_now = true where key = 'prices_NEAR';
