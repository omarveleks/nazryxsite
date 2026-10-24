-- What the worker found checking prices and classes after each rebuild (price_checks.py), for Admin > Data:
-- how close our estimates come where we know the real shelf price (kind 'accuracy'), and what looks wrong
-- (outliers, odd unit prices, thin estimates, products without a price, products filed in the wrong class).
create table price_checks (
  id bigserial primary key,
  kind text not null,                 -- accuracy, outlier, wide_range, implausible, single_source, no_gap, no_price, fx_stale, class_*
  country text,
  molecule_id int references molecules(id) on delete cascade,
  product_id int references mfr_products(id) on delete cascade,
  form_type text,
  value numeric,                      -- accuracy: typical error (0.25 = 25%); outlier: estimate / shelf price; ...
  n int,
  detail jsonb,
  checked_at timestamptz not null default now()
);
create index price_checks_kind on price_checks (kind, country);
alter table price_checks enable row level security;
create policy price_checks_team on price_checks for select using (app_is_team());
grant select on price_checks to nazryx_app;
