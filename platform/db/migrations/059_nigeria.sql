-- Nigeria joins as a full market: country, the costs from ex-works to the shelf, and its data sources.
-- Costs: duty 0% on retail-packed medicines (ECOWAS CET, HS 3004) plus levies; importer + distributor ~30% and pharmacy
-- ~30% (WHO/HAI Nigeria survey); VAT zero-rated under the Nigeria Tax Act 2025 (from 1 Jan 2026); freight, port,
-- NAFDAC inspection and clearing about 12% (estimate).
insert into countries (code, name, enabled, currency) values ('NG', 'Nigeria', true, 'NGN')
  on conflict (code) do update set enabled = true, currency = 'NGN';
insert into market_costs (country, freight, duty, distributor, pharmacy, vat) values ('NG', 0.12, 0.02, 0.30, 0.30, 0)
  on conflict (country) do nothing;
insert into fx_rates (currency, per_usd) values ('NGN', 1330) on conflict do nothing;
