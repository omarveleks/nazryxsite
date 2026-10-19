-- Starting price gaps for Nigeria (price in Nigeria / price in the source country, per unit in USD), from the same
-- hands-on check as Kenya and Tanzania (October 2026): the 77-generic basket priced in Nigeria's pharmacies (Bonamour,
-- Asset, Mariam Grey, drugstore.ng, HealthPlus, Precious) against Bangladesh, Pakistan, India, Kenya and Tanzania.
-- Nigeria prices about level with Kenya and 2-3x South Asia. Measured gaps replace these at 10 medicines of a type.
-- Kenya and Tanzania's gaps to Nigeria, set to 1.0 until now, are replaced by the measured ones.
insert into price_gaps (country, source, form_type, ratio, n, basis, note) values
  ('NG', 'BD', 'tablet', 2.4, 29, 'set', 'Oct 2026 check'), ('NG', 'PK', 'tablet', 3.2, 28, 'set', 'Oct 2026 check'),
  ('NG', 'IN', 'tablet', 2.0, 29, 'set', 'Oct 2026 check'), ('NG', 'KE', 'tablet', 1.0, 29, 'set', 'Oct 2026 check'),
  ('NG', 'TZ', 'tablet', 1.1, 14, 'set', 'Oct 2026 check'),
  ('NG', 'PK', 'injection', 2.0, 10, 'set', 'Oct 2026 check'), ('NG', 'IN', 'injection', 1.5, 10, 'set', 'Oct 2026 check'),
  ('NG', 'BD', 'injection', 1.5, 0, 'set', 'no Bangladesh injections in the check: India level'),
  ('NG', 'KE', 'injection', 0.8, 8, 'set', 'Oct 2026 check'),
  ('NG', 'BD', 'eye', 2.8, 8, 'set', 'Oct 2026 check'), ('NG', 'IN', 'eye', 2.0, 3, 'set', 'Oct 2026 check, few medicines'),
  ('NG', 'PK', 'eye', 2.4, 2, 'set', 'between India and Bangladesh (median of 2 was 5.0)'),
  ('NG', 'BD', 'nasal', 2.8, 0, 'set', 'as eye drops'), ('NG', 'IN', 'nasal', 2.0, 0, 'set', 'as eye drops'),
  ('NG', 'PK', 'nasal', 2.4, 0, 'set', 'as eye drops'),
  ('NG', 'BD', 'topical', 1.9, 5, 'set', 'Oct 2026 check'), ('NG', 'KE', 'topical', 1.8, 4, 'set', 'Oct 2026 check, few medicines'),
  ('NG', 'TZ', 'topical', 1.2, 5, 'set', 'Oct 2026 check'),
  ('NG', 'BD', 'oral liquid', 3.8, 4, 'set', 'Oct 2026 check'), ('NG', 'PK', 'oral liquid', 4.7, 4, 'set', 'Oct 2026 check'),
  ('NG', 'IN', 'oral liquid', 4.0, 3, 'set', 'Oct 2026 check'),
  ('NG', 'BD', 'all', 2.7, 47, 'set', 'Oct 2026 check'), ('NG', 'PK', 'all', 3.2, 47, 'set', 'Oct 2026 check'),
  ('NG', 'IN', 'all', 1.95, 46, 'set', 'Oct 2026 check'), ('NG', 'KE', 'all', 1.1, 45, 'set', 'Oct 2026 check'),
  ('NG', 'TZ', 'all', 1.3, 25, 'set', 'Oct 2026 check'), ('NG', 'GH', 'all', 1.0, 0, 'set', 'not measured: level until measured'),
  ('KE', 'NG', 'tablet', 1.0, 29, 'set', 'Oct 2026 check'), ('KE', 'NG', 'all', 0.9, 45, 'set', 'Oct 2026 check'),
  ('TZ', 'NG', 'tablet', 0.9, 14, 'set', 'Oct 2026 check'), ('TZ', 'NG', 'all', 0.8, 25, 'set', 'Oct 2026 check')
on conflict (country, source, form_type, basis) do update set ratio = excluded.ratio, n = excluded.n, note = excluded.note, updated_at = now();
