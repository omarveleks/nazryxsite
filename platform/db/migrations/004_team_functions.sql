-- Team decisions from the admin review queue. They are recorded here and applied by the next recompute job,
-- so live data only ever changes inside an ingest transaction.

create or replace function team_match_molecule(p_from int, p_to int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  if p_from = p_to then raise exception 'pick a different molecule'; end if;
  update molecule_aliases set molecule_id = p_to, source = 'team' where molecule_id = p_from;
  update molecule_suggestions set status = 'accepted' where molecule_id = p_from;
end $$;

create or replace function team_reject_suggestion(p_from int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  update molecule_suggestions set status = 'rejected' where molecule_id = p_from;
end $$;

create or replace function team_merge_companies(p_keep text, p_merge text) returns void
language plpgsql security definer set search_path = public as $$
declare keep_id int;
begin
  if not app_is_team() then raise exception 'team only'; end if;
  select id into keep_id from companies where cluster_key = p_keep;
  if keep_id is null then raise exception 'company not found'; end if;
  insert into company_aliases (alias, company_id, source) values (p_merge, keep_id, 'team')
    on conflict (alias) do update set company_id = excluded.company_id, source = 'team';
  update company_review_queue set status = 'merged'
    where (a_key = p_keep and b_key = p_merge) or (a_key = p_merge and b_key = p_keep);
end $$;

create or replace function team_keep_separate(p_a text, p_b text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  insert into company_keep_separate (a_key, b_key, decided_by) values (least(p_a, p_b), greatest(p_a, p_b), app_uid())
    on conflict do nothing;
  update company_review_queue set status = 'separate' where (a_key = p_a and b_key = p_b) or (a_key = p_b and b_key = p_a);
end $$;

-- queue a rebuild from the last applied export (after review decisions or new supplier offers)
create or replace function team_queue_recompute() returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not app_is_team() then raise exception 'team only'; end if;
  select id into v from registry_uploads where status in ('queued', 'running') and kind = 'recompute' limit 1;
  if v is null then
    insert into registry_uploads (kind, uploaded_by, file_name, status) values ('recompute', app_uid(), 'recompute', 'queued') returning id into v;
  end if;
  perform pg_notify('ingest', v::text);
  return v;
end $$;
