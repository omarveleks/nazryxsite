-- Catalogue products now keep their form from the catalogue's form column. Files already read get one refresh that
-- only fills missing forms and strengths on the products they added: nothing is added back, nothing is removed.
alter table mfr_files add column refresh_only boolean not null default false;
update mfr_files f set status = 'queued', refresh_only = true
where f.kind = 'catalogue' and f.status = 'done' and f.file_name ~* '\.(xlsx|xls|csv)$'
  and exists (select 1 from mfr_products p where p.user_id = f.user_id and p.dosage_form is null);
