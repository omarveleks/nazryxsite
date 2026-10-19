-- Each market's own currency (reference prices on product pages are shown in it).
update countries set currency = c from (values ('TZ', 'TZS'), ('KE', 'KES'), ('NG', 'NGN'), ('KZ', 'KZT'), ('KG', 'KGS'), ('UZ', 'UZS'),
  ('UG', 'UGX'), ('SN', 'XOF'), ('CI', 'XOF'), ('CM', 'XAF'), ('HT', 'HTG')) v(code_, c) where code = code_;
