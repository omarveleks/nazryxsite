-- Pharmaplus (Kenya) asks for ten seconds between pages: it now reads only pages whose address names a medicine (about
-- two thirds of its 15,000 products). The pages listed before that, not yet read, go; the list is read again on the
-- next run with medicines only.
delete from source_items where source = 'prices_KE_pp' and (checked_at is null or ref = '*list');
update data_sources set run_now = true where key = 'prices_KE';
