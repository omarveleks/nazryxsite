-- The portal carries prices over from neighbouring countries with the same price gaps the worker uses.
create policy price_gaps_read on price_gaps for select using (app_uid() is not null);
grant select on price_gaps to nazryx_app;
-- read South Asia again for portfolio medicines written in other spellings (Russian transliterations, synonyms)
delete from source_items where source in ('prices_BD', 'prices_IN') and ref = '*list';
update data_sources set run_now = true where key = 'prices_SASIA';
