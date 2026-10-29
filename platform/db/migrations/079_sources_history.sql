-- Where every price comes from and how sure we are, shown on the pages: the sources behind a market's price (shops,
-- registers, or the neighbouring markets an estimate rests on), the newest reading, and a confidence
-- (measured: three or more products from two or more sources; thin: fewer; estimated: from neighbours).
alter table molecule_prices
  add column sources jsonb not null default '[]',
  add column read_at date,
  add column confidence text not null default 'estimated' check (confidence in ('measured', 'thin', 'estimated'));

-- the price of every molecule in every market, one row a day, so the pages can show how prices move
create table price_history (
  country text not null,
  molecule_id int not null references molecules(id) on delete cascade,
  day date not null,
  basis text not null,
  confidence text not null,
  unit text not null,
  strength text,
  unit_price numeric not null,
  unit_usd numeric not null,
  n int not null,
  primary key (country, molecule_id, day)
);
create index price_history_mol on price_history (molecule_id, country, day desc);
alter table price_history enable row level security;
create policy price_history_read on price_history for select using (app_uid() is not null);
grant select on price_history to nazryx_app;

-- the readers' names, for the pages (customers see the kind of source and its count, never a shop's name unless it is
-- a public register)
create table price_source_labels (
  source text primary key,
  label text not null,          -- 'pharmacy', 'price survey', 'maximum prices', 'reference prices', 'register'
  public boolean not null default false
);
insert into price_source_labels (source, label, public) values
  ('mydawa', 'pharmacy', false), ('pharmaplus', 'pharmacy', false), ('goodlife', 'pharmacy', false), ('afyadepo', 'pharmacy', false),
  ('dawazetu', 'pharmacy', false), ('europharma', 'pharmacy', false), ('biosfera', 'pharmacy', false), ('bimed', 'pharmacy', false),
  ('liki', 'pharmacies (median across the city)', false), ('bonamour', 'pharmacy', false), ('asset', 'pharmacy', false),
  ('mariamgrey', 'pharmacy', false), ('drugstore', 'pharmacy', false), ('healthplus', 'pharmacy', false), ('precious', 'pharmacy', false),
  ('medplus', 'pharmacy', false), ('medex', 'pharmacy price list', false), ('1mg', 'pharmacy', false), ('dawaai', 'pharmacy', false),
  ('ppra', 'national price survey', true), ('prices_KZ (NDDA)', 'national maximum prices', true), ('dlsmi', 'national maximum prices', true),
  ('reference', 'national reference prices', true), ('tender', 'public tender award', true);
alter table price_source_labels enable row level security;
create policy price_source_labels_read on price_source_labels for select using (app_uid() is not null);
grant select on price_source_labels to nazryx_app;
