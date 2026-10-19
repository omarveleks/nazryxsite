-- East African price estimates draw on South Asia (Pakistan, India, Bangladesh) and Nigeria, and every medicine gets a
-- generic and a brand price. Listings from South Asia say who makes them, so a multinational's product is a brand.
insert into data_sources (key, country, kind, label, url, every_hours) values
  ('prices_SASIA', 'SASIA', 'prices', 'South Asian prices (Bangladesh MedEx, India 1mg, Pakistan dawaai)', 'https://medex.com.bd', 24)
  on conflict (key) do nothing;
insert into fx_rates (currency, per_usd) values ('INR', 88), ('BDT', 122) on conflict do nothing;
alter table molecule_prices add column generic_price numeric, add column brand_price numeric;   -- per unit, local currency
update data_sources set run_now = true where key in ('prices_SASIA', 'prices_INTL', 'prices_NEAR');
