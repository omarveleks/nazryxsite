-- Read the pharmacy shops again now: the price reader takes manufacturers' products and their competitors first.
update data_sources set run_now = true where kind = 'prices' and key in ('prices_KE', 'prices_TZ');
