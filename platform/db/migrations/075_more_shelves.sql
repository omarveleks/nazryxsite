-- More pharmacy shelves (pricing.py LD_SHOPS, goodlife, liki): Kenya (Pharmaplus, Goodlife), Kazakhstan (Biosfera),
-- Tanzania (DawaZetu) and Uzbekistan's first shelf prices (liki.uz: each product's price in every Tashkent pharmacy).
-- Uzbekistan now reads its official list every three days inside the run and its shelf every run: run it every 6 hours.
update data_sources set every_hours = 6 where key = 'prices_UZ';
update data_sources set run_now = true where key in ('prices_KE', 'prices_KZ', 'prices_TZ', 'prices_UZ');
