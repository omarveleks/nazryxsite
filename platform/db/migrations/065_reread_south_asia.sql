-- India's pages were read while their prices were dropped (character set) and Pakistan's while '20x10' packs were
-- priced per box instead of per strip: both are read again now, the portfolio's medicines first.
update source_items set checked_at = null where source in ('prices_IN', 'prices_PK_shop') and ref <> '*list';
delete from price_listings where source = 'dawaai';
update data_sources set run_now = true where key = 'prices_SASIA';
