-- Price gaps between a market and the countries its estimates borrow from, per product type (tablet, injection, eye,
-- nasal, inhaled, topical, oral liquid, other; 'all' for any). 'measured' rows are rebuilt from the data (used once at
-- least 10 medicines of that type are priced in both); 'set' rows are the starting ratios, used until then. Ratio = price
-- in the market / price in the source country, per unit in USD.
create table price_gaps (
  country text not null,
  source text not null,
  form_type text not null default 'all',
  ratio numeric not null check (ratio > 0),
  n int not null default 0,
  basis text not null check (basis in ('set', 'measured')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (country, source, form_type, basis)
);
alter table price_gaps enable row level security;     -- worker and team only
