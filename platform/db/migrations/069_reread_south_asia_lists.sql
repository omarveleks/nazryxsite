-- South Asia's page lists now hold every generic (which to read is chosen when reading, portfolio first), so a portfolio
-- added after a list was made is read straight away instead of a month later. The lists are made again, and Bangladesh
-- and India read again: since the last release a generic we could not match stopped every South Asian run.
update source_items set checked_at = null where source in ('prices_BD', 'prices_IN') and ref = '*list';
update source_items set checked_at = null where source in ('prices_BD', 'prices_IN');
update data_sources set run_now = true, last_error = null where key = 'prices_SASIA';
