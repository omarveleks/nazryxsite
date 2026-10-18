-- Therapeutic classes are now settled from ATC codes and the forms each molecule is sold in (ingest/classify.py),
-- and eye, ear and nose products are no longer grouped as oral liquids or nasal sprays. Re-read the registries once so
-- the stored forms follow the fixed grouping; the classes are refreshed after each load and on every start.
update data_sources set run_now = true where kind = 'registry';

insert into registry_uploads (country, kind, file_name, status)
select 'TZ', 'recompute', 'recompute: forms and classes', 'queued'
where exists (select 1 from registry_uploads where country = 'TZ' and status = 'applied' and file_path is not null)
  and not exists (select 1 from registry_uploads where kind = 'recompute' and status in ('queued', 'running'));
