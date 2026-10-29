-- Medicine imports by market: what each country reported to UN Comtrade (HS 3003 and 3004), by year, by origin and by
-- HS6 line. Public data, read monthly by the worker; readable by every account.
create table trade_flows (
  country text not null references countries(code),
  year int not null,
  hs text not null,                 -- '3004' or '3003' (totals), or an HS6 line such as '300490'
  partner text not null,            -- Comtrade partner code; '0' is the world
  partner_name text,
  partner_iso text,
  value_usd numeric,                -- CIF value of imports, US dollars
  kg numeric,                       -- net weight where reported
  source text not null default 'UN Comtrade',
  read_at timestamptz not null default now(),
  primary key (country, year, hs, partner)
);
alter table trade_flows enable row level security;
create policy trade_flows_read on trade_flows for select using (true);
grant select on trade_flows to nazryx_app;

create table hs_labels (hs text primary key, label text not null, sort int not null default 0);
insert into hs_labels (hs, label, sort) values
  ('3004', 'Medicines in doses or retail packs', 0),
  ('3003', 'Medicines in bulk, not in doses', 1),
  ('300410', 'Penicillins and streptomycins', 10),
  ('300420', 'Other antibiotics', 11),
  ('300431', 'Insulin', 12),
  ('300432', 'Corticosteroid hormones', 13),
  ('300439', 'Other hormones', 14),
  ('300441', 'Ephedrine and its salts', 15),
  ('300442', 'Pseudoephedrine and its salts', 16),
  ('300443', 'Norephedrine and its salts', 17),
  ('300449', 'Other alkaloids', 18),
  ('300450', 'Vitamins', 19),
  ('300460', 'Antimalarials', 20),
  ('300490', 'Other medicines (most generics)', 21);
grant select on hs_labels to nazryx_app;
