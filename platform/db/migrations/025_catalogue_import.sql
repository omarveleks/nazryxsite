-- Catalogues add their products by themselves: CSV and text at once (web app), Excel, Word and PDF in the worker.
-- The upload records how far it got; 'manual' means the team loads it.
alter table mfr_files
  add column status text check (status in ('queued', 'reading', 'done', 'failed', 'manual')),
  add column added int,
  add column matched int,
  add column error text;
grant update (status, added, matched, error) on mfr_files to nazryx_app;
create policy mfr_files_update on mfr_files for update using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid() or app_is_team());
