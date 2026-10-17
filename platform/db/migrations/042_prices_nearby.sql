-- Prices in nearby countries feed the estimates beside our own markets: South Africa, Ghana and Nigeria for East
-- Africa; Azerbaijan and Armenia (Belarus comes with the reference prices) for Central Asia.
insert into data_sources (key, country, kind, label, url, every_hours) values
  ('prices_NEAR', 'NEAR', 'prices', 'Prices in nearby countries (South Africa, Ghana, Nigeria, Azerbaijan, Armenia)', 'https://www.health.gov.za', 24);
insert into fx_rates (currency, per_usd) values ('NGN', 1550), ('GHS', 15.5), ('ZAR', 18), ('BYN', 3.3), ('AMD', 390), ('AZN', 1.7)
  on conflict do nothing;
