-- Price estimates now come only from neighbouring markets; rebuild them with the next price read.
update data_sources set run_now = true where kind = 'prices' and key in ('prices_KE', 'prices_TZ', 'prices_KZ', 'prices_KG', 'prices_UZ');
