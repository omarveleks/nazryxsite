-- Kazakhstan's maximum prices: list the register again, now skipping EAEU registrations (their price sits on the
-- national registration) and lapsed ones, so the first pass is shorter.
delete from source_items where source = 'prices_KZ';
update data_sources set run_now = true where kind = 'prices';
