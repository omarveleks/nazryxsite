-- Pharmacy and survey prices for Kenya and Tanzania (ingest/pricing.py), read a little each hour so no site is loaded.
alter table source_items add column state text;
insert into data_sources (key, country, kind, label, url, every_hours) values
  ('prices_KE', 'KE', 'prices', 'Kenya medicine prices (PPRA market price survey, pharmacy listings)', 'https://ppra.go.ke/market-price-index/', 1),
  ('prices_TZ', 'TZ', 'prices', 'Tanzania pharmacy prices (online pharmacy listings)', 'https://afyadepot.co.tz', 1);
delete from source_items where source = 'prices_KZ:list';   -- the first version kept the list date here
insert into data_sources (key, country, kind, label, url, every_hours) values
  ('prices_KG', 'KG', 'prices', 'Kyrgyzstan pharmacy prices and maximum price register (DLSMI)', 'https://dlsmi.kg/ru/price_regulation/', 24);
update data_sources set label = 'Kazakhstan maximum prices (NDDA) and pharmacy prices' where key = 'prices_KZ';
