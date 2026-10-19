-- Starting price gaps for East Africa (price in the market / price in the source country, per unit in USD), from a
-- hands-on check in October 2026: 77 generics priced in Kenya (PPRA Market Price Reference Guide, September 2026) and
-- Tanzania (AfyaDepot pharmacy) against Bangladesh (MedEx), Pakistan (dawaai) and India (1mg), same molecule, strength
-- and form; the median per product type. Measured gaps (rebuilt from the data) replace these once a type has at least
-- 10 medicines priced in both countries. Types without enough medicines in the check use the pair's 'all' figure.
insert into price_gaps (country, source, form_type, ratio, n, basis, note) values
  ('KE', 'BD', 'tablet', 2.5, 28, 'set', 'Oct 2026 check'),
  ('KE', 'PK', 'tablet', 2.8, 27, 'set', 'Oct 2026 check'),
  ('KE', 'IN', 'tablet', 2.1, 28, 'set', 'Oct 2026 check'),
  ('KE', 'PK', 'injection', 1.1, 9, 'set', 'Oct 2026 check'),
  ('KE', 'IN', 'injection', 0.9, 8, 'set', 'Oct 2026 check'),
  ('KE', 'BD', 'injection', 1.0, 0, 'set', 'no Bangladesh injections in the check: India and Pakistan level'),
  ('KE', 'BD', 'all', 2.4, 40, 'set', 'Oct 2026 check'),
  ('KE', 'PK', 'all', 2.5, 41, 'set', 'Oct 2026 check'),
  ('KE', 'IN', 'all', 1.9, 41, 'set', 'Oct 2026 check'),
  ('KE', 'TZ', 'all', 0.7, 20, 'set', 'Oct 2026 check (Kenya survey vs Tanzania pharmacy)'),
  ('KE', 'NG', 'all', 1.0, 3, 'set', 'too few Nigerian generics in the check: level until measured'),
  ('TZ', 'BD', 'tablet', 2.45, 14, 'set', 'Oct 2026 check'),
  ('TZ', 'PK', 'tablet', 4.0, 14, 'set', 'Oct 2026 check (median 5.4, wide spread; 4.0 keeps it in line with India and Kenya)'),
  ('TZ', 'IN', 'tablet', 2.3, 14, 'set', 'Oct 2026 check'),
  ('TZ', 'KE', 'tablet', 1.5, 13, 'set', 'Oct 2026 check'),
  ('TZ', 'PK', 'injection', 1.5, 3, 'set', 'Oct 2026 check, few medicines'),
  ('TZ', 'IN', 'injection', 1.3, 3, 'set', 'Oct 2026 check, few medicines'),
  ('TZ', 'BD', 'injection', 1.3, 0, 'set', 'no Bangladesh injections in the check: India level'),
  ('TZ', 'BD', 'all', 2.2, 20, 'set', 'Oct 2026 check'),
  ('TZ', 'PK', 'all', 4.0, 22, 'set', 'Oct 2026 check'),
  ('TZ', 'IN', 'all', 1.9, 19, 'set', 'Oct 2026 check'),
  ('TZ', 'KE', 'all', 1.4, 20, 'set', 'Oct 2026 check'),
  ('TZ', 'NG', 'all', 1.0, 0, 'set', 'too few Nigerian generics in the check: level until measured'),
  -- eye and nasal drops: Pakistan's price controls hold its tablets far below other products, so its tablet gap does not
  -- carry over; the check's eye drops (timolol, gentamicin, ciprofloxacin, bromfenac) sit 1.4-1.9x South Asia
  ('KE', 'BD', 'eye', 1.9, 2, 'set', 'Oct 2026 check, few medicines'),
  ('KE', 'IN', 'eye', 1.5, 0, 'set', 'Oct 2026 check: from Tanzania''s eye drops and Kenya''s tablets'),
  ('KE', 'PK', 'eye', 1.5, 1, 'set', 'Oct 2026 check, few medicines'),
  ('TZ', 'BD', 'eye', 1.8, 1, 'set', 'Oct 2026 check (timolol), few medicines'),
  ('TZ', 'IN', 'eye', 1.4, 1, 'set', 'Oct 2026 check (timolol), few medicines'),
  ('TZ', 'PK', 'eye', 1.5, 0, 'set', 'between India and Bangladesh, as Pakistan eye drops price'),
  ('KE', 'BD', 'nasal', 1.9, 0, 'set', 'as eye drops'), ('KE', 'IN', 'nasal', 1.5, 0, 'set', 'as eye drops'),
  ('KE', 'PK', 'nasal', 1.5, 0, 'set', 'as eye drops'), ('TZ', 'BD', 'nasal', 1.8, 0, 'set', 'as eye drops'),
  ('TZ', 'IN', 'nasal', 1.4, 0, 'set', 'as eye drops'), ('TZ', 'PK', 'nasal', 1.5, 0, 'set', 'as eye drops'),
  ('KE', 'BD', 'topical', 1.45, 5, 'set', 'Oct 2026 check'), ('KE', 'IN', 'topical', 1.1, 2, 'set', 'Oct 2026 check, few medicines'),
  ('KE', 'PK', 'topical', 1.9, 2, 'set', 'Oct 2026 check, few medicines'), ('TZ', 'BD', 'topical', 1.6, 3, 'set', 'Oct 2026 check, few medicines'),
  ('TZ', 'IN', 'topical', 1.3, 0, 'set', 'from Kenya''s topical gap and Tanzania vs Kenya'), ('TZ', 'PK', 'topical', 2.0, 3, 'set', 'Oct 2026 check, few medicines (median 4.1)'),
  ('KE', 'BD', 'oral liquid', 2.8, 3, 'set', 'Oct 2026 check'), ('KE', 'IN', 'oral liquid', 2.9, 2, 'set', 'Oct 2026 check'),
  ('KE', 'PK', 'oral liquid', 2.4, 2, 'set', 'Oct 2026 check'), ('TZ', 'BD', 'oral liquid', 2.2, 2, 'set', 'Oct 2026 check'),
  ('TZ', 'IN', 'oral liquid', 2.0, 1, 'set', 'Oct 2026 check, few medicines'), ('TZ', 'PK', 'oral liquid', 1.3, 2, 'set', 'Oct 2026 check')
on conflict (country, source, form_type, basis) do update set ratio = excluded.ratio, n = excluded.n, note = excluded.note, updated_at = now();
update data_sources set run_now = true where key in ('prices_TZ', 'prices_KE', 'prices_SASIA');
