-- Eye drops, measured on shelf prices (Oct 2026: MyDawa Kenya, AfyaDepot Tanzania, 1mg India, dawaai Pakistan,
-- MedEx Bangladesh; median price per ml for each ingredient, then the median of the ratios). India, Pakistan and
-- Bangladesh cap eye-drop prices, so Kenya sells them at 5-7x; Tanzania at about 2x, under a third of Kenya's level.
-- The earlier figures (1.4-1.9x, from one or two medicines) put Kenya's estimates far too low, and with no eye-drop gap
-- between Tanzania and Kenya, Tanzania took Kenya's prices at the all-medicines 1.4x: about five times too high.
insert into price_gaps (country, source, form_type, ratio, n, basis, note) values
  ('KE', 'IN', 'eye', 6.9, 27, 'set', 'Oct 2026 eye-drop check, 27 medicines (middle half 3.9-14.6)'),
  ('KE', 'PK', 'eye', 7.4, 19, 'set', 'Oct 2026 eye-drop check, 19 medicines (middle half 4.9-11.9)'),
  ('KE', 'BD', 'eye', 5.3, 33, 'set', 'Oct 2026 eye-drop check, 33 medicines (middle half 3.6-8.7)'),
  ('KE', 'TZ', 'eye', 3.4, 10, 'set', 'Oct 2026 eye-drop check, 10 medicines'),
  ('TZ', 'KE', 'eye', 0.29, 10, 'set', 'Oct 2026 eye-drop check, 10 medicines'),
  ('TZ', 'IN', 'eye', 2.1, 7, 'set', 'Oct 2026 eye-drop check: 2.2 on 7 medicines, 2.0 through Kenya'),
  ('TZ', 'PK', 'eye', 2.1, 7, 'set', 'Oct 2026 eye-drop check: 2.0 on 7 medicines, 2.15 through Kenya'),
  ('TZ', 'BD', 'eye', 1.5, 8, 'set', 'Oct 2026 eye-drop check: 1.5 on 8 medicines, 1.5 through Kenya'),
  -- Nigeria against its East African neighbours, through each one's gap with South Asia
  ('NG', 'KE', 'eye', 0.32, 0, 'set', 'through South Asia (Nigeria 2-2.8x, Kenya 5-7x)'),
  ('KE', 'NG', 'eye', 3.1, 0, 'set', 'through South Asia'),
  ('NG', 'TZ', 'eye', 1.15, 0, 'set', 'through South Asia'),
  ('TZ', 'NG', 'eye', 0.88, 0, 'set', 'through South Asia'),
  -- the other product types between the three markets, where nothing direct is stored: through South Asia
  ('TZ', 'KE', 'injection', 1.35, 0, 'set', 'through South Asia'), ('KE', 'TZ', 'injection', 0.73, 0, 'set', 'through South Asia'),
  ('TZ', 'KE', 'topical', 1.1, 0, 'set', 'through South Asia'), ('KE', 'TZ', 'topical', 0.91, 0, 'set', 'through South Asia'),
  ('TZ', 'KE', 'oral liquid', 0.7, 0, 'set', 'through South Asia'), ('KE', 'TZ', 'oral liquid', 1.45, 0, 'set', 'through South Asia'),
  ('KE', 'TZ', 'tablet', 0.67, 13, 'set', 'Oct 2026 check (the inverse of Tanzania vs Kenya)'),
  ('KE', 'NG', 'injection', 0.6, 0, 'set', 'through South Asia'),
  ('NG', 'TZ', 'injection', 1.15, 0, 'set', 'through South Asia'), ('TZ', 'NG', 'injection', 0.87, 0, 'set', 'through South Asia'),
  ('NG', 'KE', 'oral liquid', 1.4, 0, 'set', 'through South Asia'), ('KE', 'NG', 'oral liquid', 0.72, 0, 'set', 'through South Asia'),
  ('NG', 'TZ', 'oral liquid', 2.0, 0, 'set', 'through South Asia'), ('TZ', 'NG', 'oral liquid', 0.5, 0, 'set', 'through South Asia')
on conflict (country, source, form_type, basis) do update set ratio = excluded.ratio, n = excluded.n, note = excluded.note, updated_at = now();
-- estimates again with these
update data_sources set run_now = true where key = 'prices_SASIA';
