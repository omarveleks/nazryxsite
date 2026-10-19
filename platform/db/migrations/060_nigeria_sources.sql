-- Nigeria's collectors: NAFDAC Greenbook (medicines and vaccines; medical devices), pharmacy prices (Bonamour, Asset
-- Pharmacy, Mariam Grey, drugstore.ng, HealthPlus, Precious Pharmacy, MedPlus), and federal procurement plans and tenders
-- (BPP NOCOPO through the Open Contracting Data Registry).
insert into data_sources (key, country, kind, label, url, every_hours, run_now) values
  ('registry_NG', 'NG', 'registry', 'Nigeria approved products (NAFDAC Greenbook)', 'https://greenbook.nafdac.gov.ng', 168, true),
  ('devices_NG', 'NG', 'devices', 'Nigeria medical devices (NAFDAC Greenbook)', 'https://greenbook.nafdac.gov.ng', 168, true),
  ('prices_NG', 'NG', 'prices', 'Nigeria pharmacy prices (Bonamour, Asset, Mariam Grey, drugstore.ng, HealthPlus, Precious, MedPlus)',
   'https://www.bonamour.com.ng', 24, true),
  ('tenders_NG', 'NG', 'tenders', 'Nigeria federal procurement for medicines (BPP NOCOPO, Open Contracting Data Registry)',
   'https://data.open-contracting.org/en/publication/64', 168, true)
on conflict (key) do nothing;
update data_sources set label = 'Prices in nearby countries (South Africa, Ghana, Azerbaijan, Armenia)' where key = 'prices_NEAR';
