-- What a molecule sells for in each market (ingest/pricing.py). price_listings holds every price the collectors find:
-- pharmacy listings (retail), official maximum prices (cap), tender unit prices (tender) and reimbursement amounts.
-- molecule_prices is the summary pages read: the average price per unit from listings, or, where a market publishes
-- nothing for the molecule, an estimate from a neighbouring market adjusted by how the two markets' prices compare.
create table price_listings (
  id bigserial primary key,
  country text not null references countries(code),
  source text not null,
  kind text not null check (kind in ('retail', 'cap', 'tender', 'reimbursement')),
  ref text not null,
  name text,
  pack text,
  molecule_id int references molecules(id) on delete set null,
  units numeric,                       -- tablets, capsules, ampoules... in the pack; null when not stated
  pack_price numeric not null,
  currency text not null,
  seen date not null default current_date,
  unique (source, ref)
);
create index price_listings_molecule on price_listings (molecule_id, country);
alter table price_listings enable row level security;   -- worker only: pages read molecule_prices

create table fx_rates (
  currency text primary key,
  per_usd numeric not null,
  updated_at timestamptz not null default now()
);
insert into fx_rates (currency, per_usd) values ('USD', 1), ('KZT', 452), ('UZS', 12000), ('KGS', 87.5), ('KES', 130), ('TZS', 2630);

create table molecule_prices (
  country text not null references countries(code),
  molecule_id int not null references molecules(id) on delete cascade,
  basis text not null check (basis in ('listings', 'estimate')),
  kinds text[] not null default '{}',  -- what the listings are: retail, cap, tender, reimbursement
  currency text not null,
  unit text not null,                  -- what one unit is: 'tablet or capsule', 'ampoule or vial', 'pack'
  strength text,                       -- the usual strength the average is for (others in by_strength)
  unit_price numeric not null,         -- average per unit (tablet, capsule, ampoule, bottle) in local currency
  unit_usd numeric not null,
  lo numeric, hi numeric,              -- typical range per unit, local currency
  n int not null default 0,            -- listings behind it (for an estimate: the neighbour's)
  from_country text references countries(code),
  factor numeric,                      -- estimate: this market's price level against the neighbour's
  overlap int,                         -- estimate: molecules priced in both markets behind that factor
  by_strength jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (country, molecule_id)
);
alter table molecule_prices enable row level security;
create policy molecule_prices_read on molecule_prices for select using (app_uid() is not null);
grant select on molecule_prices to nazryx_app;
alter table fx_rates enable row level security;
create policy fx_rates_read on fx_rates for select using (app_uid() is not null);
grant select on fx_rates to nazryx_app;

-- Sources read one record at a time (Kazakhstan's maximum price per registration) keep their place here.
create table source_items (
  source text not null,
  ref text not null,
  checked_at timestamptz,
  primary key (source, ref)
);
alter table source_items enable row level security;   -- worker only

insert into data_sources (key, country, kind, label, url, every_hours) values
  ('prices_KZ', 'KZ', 'prices', 'Kazakhstan maximum prices per registration (NDDA)', 'https://register.ndda.kz', 1);
update data_sources set label = 'Uzbekistan official reference and maximum prices' where key = 'prices_UZ';
