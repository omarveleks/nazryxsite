-- Price gaps from the October 2026 manual check (PRICING.md, section 8).
-- Kazakhstan, Kyrgyzstan and Uzbekistan, measured on the October 2026 shelf basket (13-16
-- medicines priced in both markets; median of the ratios). With no gap stored, an estimate carried a neighbour's price
-- over at 1.0, so Uzbekistan and Kyrgyzstan came out too high and Kazakhstan too low. A gap measured from 10 or more
-- medicines of one product type still wins over these.
insert into price_gaps (country, source, form_type, ratio, n, basis, note) values
  ('KZ', 'KG', 'all', 1.4, 13, 'set', 'Oct 2026 shelf basket, 13 medicines (middle half 0.85-2.7)'),
  ('KG', 'KZ', 'all', 0.71, 13, 'set', 'Oct 2026 shelf basket, 13 medicines'),
  ('KZ', 'UZ', 'all', 1.55, 16, 'set', 'Oct 2026 shelf basket, 16 medicines (middle half 0.83-2.2)'),
  ('UZ', 'KZ', 'all', 0.65, 16, 'set', 'Oct 2026 shelf basket, 16 medicines'),
  ('KG', 'UZ', 'all', 0.76, 13, 'set', 'Oct 2026 shelf basket, 13 medicines (middle half 0.69-0.98)'),
  ('UZ', 'KG', 'all', 1.31, 13, 'set', 'Oct 2026 shelf basket, 13 medicines'),
  -- Kenya's and Tanzania's nasal drops follow their eye drops (South Asia caps both): the old 1.4-1.9 'as eye drops'
  -- figures were left behind when 068 measured eye drops at 5-7x. The basket's two nasal medicines put Kenya at 1.2-63x
  -- South Asia (originator-heavy shelves), too few to set a nasal gap of their own.
  ('KE', 'IN', 'nasal', 6.9, 0, 'set', 'as eye drops (068)'), ('KE', 'PK', 'nasal', 7.4, 0, 'set', 'as eye drops (068)'),
  ('KE', 'BD', 'nasal', 5.3, 0, 'set', 'as eye drops (068)'), ('TZ', 'IN', 'nasal', 2.1, 0, 'set', 'as eye drops (068)'),
  ('TZ', 'PK', 'nasal', 2.1, 0, 'set', 'as eye drops (068)'), ('TZ', 'BD', 'nasal', 1.5, 0, 'set', 'as eye drops (068)'),
  -- tablets, where the basket (each brand one voice, as prices are now built) disagrees with the earlier check by a
  -- third or more; a gap measured from 10 or more medicines in the live data still wins
  ('NG', 'KE', 'tablet', 0.63, 17, 'set', 'Oct 2026 shelf basket, 17 medicines (was 1.0)'),
  ('NG', 'PK', 'tablet', 1.9, 16, 'set', 'Oct 2026 shelf basket, 16 medicines (was 3.2)')
on conflict (country, source, form_type, basis) do update set ratio = excluded.ratio, n = excluded.n, note = excluded.note, updated_at = now();
-- MedEx box notes saved as listings of one unit ('(12's pack' at the price of 12 bottles, '(5 x 5' at 25 ampoules): the
-- reader now skips them; the ones stored go
delete from price_listings where source = 'medex' and ref like '%|(%';
-- estimates again with these
update data_sources set run_now = true where key in ('prices_KZ', 'prices_KG', 'prices_UZ', 'prices_SASIA');
