-- One owner: the account named by TEAM_OWNER_EMAIL (set on every worker start by bootstrap.py). Owner rights cannot be
-- given or taken in the app: team_add_member and team_set_member never change them, and the owner cannot be removed.
create or replace function team_add_member(p_email text, p_name text, p_hash text, p_permissions text[], p_owner boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not app_is_owner() then raise exception 'Only the owner can add team members'; end if;
  if not team_valid_permissions(p_permissions) then raise exception 'Unknown permission'; end if;
  if exists (select 1 from users where email = lower(trim(p_email))) then raise exception 'That email already has an account'; end if;
  insert into users (email, name, password_hash, role, plan, onboarded, team_owner, team_permissions)
  values (lower(trim(p_email)), p_name, p_hash, 'team', 'paid', true, false, p_permissions) returning id into v;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), 'insert', 'team_members', v::text, jsonb_build_object('email', lower(trim(p_email)), 'permissions', p_permissions));
  return v;
end $$;

create or replace function team_set_member(p_user uuid, p_permissions text[], p_owner boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_is_owner() then raise exception 'Only the owner can change permissions'; end if;
  if not team_valid_permissions(p_permissions) then raise exception 'Unknown permission'; end if;
  update users set team_permissions = p_permissions where id = p_user and role = 'team';
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), 'update', 'team_members', p_user::text, jsonb_build_object('permissions', p_permissions));
end $$;

create or replace function team_remove_member(p_user uuid, p_remove boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_is_owner() then raise exception 'Only the owner can remove team members'; end if;
  if exists (select 1 from users where id = p_user and team_owner) then raise exception 'The owner cannot be removed'; end if;
  update users set disabled = p_remove where id = p_user and role = 'team';
  if p_remove then delete from sessions where user_id = p_user; end if;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), 'update', 'team_members', p_user::text, jsonb_build_object('removed', p_remove));
end $$;
