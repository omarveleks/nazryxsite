-- The team can suspend a customer account (no sign-in, everything kept, reversible) and an owner can delete one for
-- good: the account, its team seats, everything they entered and every file they or the team uploaded for them.
-- Invoices stay (tax and accounting records): each keeps its own full copy (who was billed, the lines, the page) and
-- loses only the link to the account and to the PDF filed in the account's documents.
alter table invoices drop constraint invoices_user_id_fkey,
  add constraint invoices_user_id_fkey foreign key (user_id) references users(id) on delete set null;

-- 'accounts' permission, or an owner
create or replace function app_team_can(p_perm text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = app_uid() and role = 'team' and not disabled and (team_owner or p_perm = any(team_permissions)))
$$;
grant execute on function app_team_can(text) to nazryx_app;

create or replace function admin_set_disabled(p_user uuid, p_disabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_team_can('accounts') then raise exception 'Only the team can suspend accounts'; end if;
  if exists (select 1 from users where id = p_user and role = 'team') then
    raise exception 'Team members are removed from Admin > Team';
  end if;
  update users set disabled = p_disabled where id = p_user or owner_id = p_user;     -- the account and its seats
  if p_disabled then
    delete from sessions where user_id in (select id from users where id = p_user or owner_id = p_user);
  end if;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), case when p_disabled then 'suspend' else 'restore' end, 'users', p_user::text, null);
end $$;
grant execute on function admin_set_disabled(uuid, boolean) to nazryx_app;

create or replace function admin_delete_account(p_user uuid, p_email text) returns int
language plpgsql security definer set search_path = public as $$
declare v_email text; v_ids uuid[]; v_files int;
begin
  if not app_is_owner() then raise exception 'Only an owner can delete accounts'; end if;
  select email into v_email from users where id = p_user and role <> 'team';
  if v_email is null then raise exception 'No such customer account (team members are removed from Admin > Team)'; end if;
  if lower(trim(coalesce(p_email, ''))) <> v_email then raise exception 'Type the account''s email exactly to confirm'; end if;
  v_ids := array(select id from users where id = p_user or owner_id = p_user);

  -- every file belonging to the account: uploaded by them, or by the team onto their account; never an invoice's copy
  with paths as (
    select file_path as p from account_documents where user_id = any(v_ids)
    union all select catalogue_path from company_claims where user_id = any(v_ids)
    union all select licence_path from company_claims where user_id = any(v_ids)
    union all select catalogue_path from manufacturer_profiles where user_id = any(v_ids)
    union all select file_path from mfr_files where user_id = any(v_ids)
    union all select f.file_path from engagement_files f join engagements e on e.id = f.engagement_id where e.user_id = any(v_ids)
    union all select f.path from request_files f join requests r on r.id = f.request_id where r.user_id = any(v_ids)
  ), gone as (
    delete from stored_files s
    where s.uploaded_by = any(v_ids) or s.id::text in (select substr(p, 4) from paths where p like 'db:%')
    returning 1
  ) select count(*) into v_files from gone;

  update invoices set document_id = null where user_id = any(v_ids);
  delete from users where owner_id = p_user;
  delete from users where id = p_user;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), 'delete account', 'users', p_user::text, jsonb_build_object('email', v_email, 'seats', cardinality(v_ids) - 1, 'files', v_files));
  return v_files;
end $$;
grant execute on function admin_delete_account(uuid, text) to nazryx_app;
