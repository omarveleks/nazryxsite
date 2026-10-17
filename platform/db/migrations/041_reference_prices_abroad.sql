-- Third tier of prices: official prices in exporting and reference countries (Pakistan's notified maximum prices, the
-- UK Drug Tariff, France's reimbursed prices). Used only to estimate a molecule no market of ours prices, scaled by
-- the measured price gap between that country and the market. These rows carry the source country's code (PK, GB, FR).
alter table price_listings drop constraint price_listings_country_fkey;
alter table molecule_prices drop constraint molecule_prices_from_country_fkey;
alter table data_sources drop constraint data_sources_country_fkey;
insert into data_sources (key, country, kind, label, url, every_hours) values
  ('prices_INTL', 'INTL', 'prices', 'Reference prices abroad (Pakistan DRAP, UK Drug Tariff, France BDPM)', 'https://e.dra.gov.pk/public/price', 24);
insert into fx_rates (currency, per_usd) values ('PKR', 280), ('GBP', 0.76), ('EUR', 0.89) on conflict do nothing;
