-- A medicine's price in the other forms it comes in (vitamin D3 drops beside its usual capsules), for products sold in
-- that form: {unit: {basis, strength, unit_price, unit_usd, lo, hi, n, pack_size}}.
alter table molecule_prices add column if not exists forms jsonb;
-- South Asia's vitamins are read under their ingredient names now ('Vitamin D3' is cholecalciferol): read them again
update source_items set checked_at = null where source in ('prices_BD', 'prices_IN') and ref ~* 'vitamin|calciferol';
update data_sources set run_now = true where key = 'prices_SASIA';
