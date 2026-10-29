-- Senegal, Côte d'Ivoire and Cameroon join as markets: countries, currencies, costs from ex-works to the shelf, and the
-- data sources the collector reads. Honest about depth: registers come from the regulators' public lists (Senegal, Cameroon),
-- Côte d'Ivoire's regulator publishes none yet; prices and tenders start thin.
--
-- Costs (estimates, flagged as such on the coverage page until surveyed):
--  SN: medicines in TEC category 0 (no duty) plus the UEMOA/ECOWAS levies and statistical fee (~2.3%); VAT exempt (CGI);
--      regulated public price through coefficients (arrêté 000188/MSHP/DPM of 15 Jan 2003: 1.85 on the CIF price for ordinary
--      medicines), read here as wholesaler 30% and pharmacy 42%; freight, port and clearing about 10%.
--  CI: same UEMOA tariff (category 0, levies ~2.3%); medicines VAT exempt; regulated margins read as 25% + 33%; freight ~10%.
--  CM: CEMAC common external tariff, medicines in the 5% band; medicines VAT exempt at sale (input VAT not recoverable, so
--      part of the cost); margins read as 25% + 35%; freight to Douala and clearing ~12%.
insert into countries (code, name, enabled, currency) values ('SN', 'Senegal', true, 'XOF'), ('CI', 'Côte d''Ivoire', true, 'XOF'), ('CM', 'Cameroon', true, 'XAF')
  on conflict (code) do update set enabled = true, currency = excluded.currency, name = excluded.name;
insert into market_costs (country, freight, duty, distributor, pharmacy, vat) values
  ('SN', 0.10, 0.023, 0.30, 0.42, 0), ('CI', 0.10, 0.023, 0.25, 0.33, 0), ('CM', 0.12, 0.05, 0.25, 0.35, 0)
  on conflict (country) do nothing;
-- the CFA francs are pegged to the euro at 655.957; the worker refreshes every rate daily
insert into fx_rates (currency, per_usd) values ('XOF', 584), ('XAF', 584) on conflict do nothing;

insert into data_sources (key, country, kind, label, url, every_hours, run_now) values
  ('registry_SN', 'SN', 'registry', 'Senegal marketing authorisations (ARP public list)', 'https://arp.sn/bases-de-donnees/medicaments-autorises', 168, true),
  ('registry_CM', 'CM', 'registry', 'Cameroon approved medicines (DPML repertoire)', 'https://dpml.cm/repertoireDesAmm/index.php', 168, true)
on conflict (key) do nothing;
