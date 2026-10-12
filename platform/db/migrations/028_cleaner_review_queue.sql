-- The review queue is rebuilt with stricter rules: suggested matches only for close spellings of the same medicine,
-- possible duplicate companies only for names that start alike. Clear today's open items and rebuild Tanzania once.
delete from molecule_suggestions where status = 'open' and source = 'fuzzy';
delete from company_review_queue where status = 'open';
insert into registry_uploads (country, kind, status)
select 'TZ', 'recompute', 'queued'
where exists (select 1 from registry_uploads where country = 'TZ' and status = 'applied' and file_path is not null);
