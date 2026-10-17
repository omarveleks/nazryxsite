-- A government price survey (one national average per line) is its own kind of evidence, apart from single shop listings.
alter table price_listings drop constraint price_listings_kind_check;
alter table price_listings add constraint price_listings_kind_check check (kind in ('retail', 'survey', 'cap', 'tender', 'reimbursement'));
update price_listings set kind = 'survey' where source = 'ppra';

-- The Kenyan pharmacy feed mixed per tablet, per strip and per box prices with nothing to tell them apart: removed.
delete from price_listings where source = 'goodlife';
delete from source_items where source = 'prices_KE' and ref = 'goodlife';
