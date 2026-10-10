-- Uploaded files live in Postgres, so the web app and the worker need no shared disk (hosting platforms run
-- them as separate services). Rows that reference a file store its path as 'db:<uuid>'.

create table stored_files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  size int not null,
  data bytea not null,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

alter table stored_files enable row level security;
-- anyone signed in can upload; a file is readable by its uploader, the team, and whoever can read the row
-- that references it (RLS on request_files / company_claims applies inside these checks)
create policy stored_files_insert on stored_files for insert with check (app_uid() is not null and uploaded_by = app_uid());
create policy stored_files_read on stored_files for select using (
  app_is_team()
  or uploaded_by = app_uid()
  or exists (select 1 from request_files rf where rf.path = 'db:' || stored_files.id::text)
  or exists (select 1 from company_claims c where c.licence_path = 'db:' || stored_files.id::text
                                              or c.catalogue_path = 'db:' || stored_files.id::text));
grant select, insert on stored_files to nazryx_app;

-- The national essential medicines list (OCR text) and the global list (text) used by every ingest run.
create table reference_files (
  kind text primary key check (kind in ('national_list', 'global_list')),
  file_id uuid not null references stored_files(id),
  name text not null,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now()
);
alter table reference_files enable row level security;
create policy reference_files_team on reference_files for all using (app_is_team()) with check (app_is_team());
grant select, insert, update on reference_files to nazryx_app;
