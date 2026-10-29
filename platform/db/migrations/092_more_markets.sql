-- Ethiopia, Uganda, Ghana, Azerbaijan, Armenia and Belarus join as markets: countries, currencies, landed-cost estimates
-- and the registers the collector reads (Ghana's FDA registry, Azerbaijan's open-data register, Belarus's RCETH register,
-- Armenia's SCDMTE database). Ethiopia's eRIS needs a login and Uganda's register sits behind a bot challenge: those two
-- carry the essential list and the regulatory facts and say so on the coverage page.
--
-- Costs (estimates until surveyed, flagged on the coverage page):
--  ET: medicines need an EFDA import permit; 15% VAT applies unless exempt (OTC medicines taxed from 2025); low duty band;
--      wholesale and retail mark-ups regulated (about 15% and 25%); freight to Addis and clearing ~12%.
--  UG: 0% under the EAC common external tariff, VAT exempt; margins about 25% + 33%; freight ~10%.
--  GH: VAT exempt for registered pharmaceuticals, duty-free under ECOWAS for most finished medicines, FDA levy 1.8% of CIF;
--      margins about 25% + 33%; freight ~10%.
--  AZ: 18% VAT and a low duty band unless on an exemption list; prices capped by the Tariff Council, read here as 15% + 20%.
--  AM: EAEU tariff (mostly 0 to 5% on medicines), 20% VAT; margins about 15% + 25%.
--  BY: EAEU tariff, 10% VAT on registered medicines, regulated mark-ups read as 10% + 25%.
insert into countries (code, name, enabled, currency) values
  ('ET', 'Ethiopia', true, 'ETB'), ('UG', 'Uganda', true, 'UGX'), ('GH', 'Ghana', true, 'GHS'),
  ('AZ', 'Azerbaijan', true, 'AZN'), ('AM', 'Armenia', true, 'AMD'), ('BY', 'Belarus', true, 'BYN')
  on conflict (code) do update set enabled = true, currency = excluded.currency, name = excluded.name;
insert into market_costs (country, freight, duty, distributor, pharmacy, vat) values
  ('ET', 0.12, 0.05, 0.15, 0.25, 0.15), ('UG', 0.10, 0.00, 0.25, 0.33, 0), ('GH', 0.10, 0.018, 0.25, 0.33, 0),
  ('AZ', 0.08, 0.05, 0.15, 0.20, 0.18), ('AM', 0.08, 0.03, 0.15, 0.25, 0.20), ('BY', 0.06, 0.03, 0.10, 0.25, 0.10)
  on conflict (country) do nothing;
insert into fx_rates (currency, per_usd) values ('ETB', 150), ('UGX', 3700) on conflict do nothing;

insert into data_sources (key, country, kind, label, url, every_hours, run_now) values
  ('registry_GH', 'GH', 'registry', 'Ghana registered products (FDA public registry)', 'https://verifypermit.fdaghana.gov.gh/publicsearch', 168, true),
  ('registry_AZ', 'AZ', 'registry', 'Azerbaijan state register of medicines (open data)', 'https://opendata.az/en/@azerbaycan-respublikasinin-sehiyye-nazirliyi/derman-vasitelerinin-dovlet-reyestri', 168, true),
  ('registry_BY', 'BY', 'registry', 'Belarus state register of medicines (RCETH)', 'https://www.rceth.by/Refbank/reestr_lekarstvennih_sredstv/results', 168, true),
  ('registry_AM', 'AM', 'registry', 'Armenia registered medicines (SCDMTE database)', 'https://pharm.am/index.php/en/find-medicine', 168, true)
on conflict (key) do nothing;
