-- Team members with permissions. Owners (the account that runs Nazryx) see everything, add team members, choose
-- what each one can open, and remove them. A removed member can no longer sign in. Existing team accounts become owners.
alter table users
  add column team_owner boolean not null default false,
  add column team_permissions text[] not null default '{}',
  add column disabled boolean not null default false;
update users set team_owner = true where role = 'team';

-- a removed (disabled) team member is no longer team, and cannot sign in
create or replace function app_is_team() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = app_uid() and role = 'team' and not disabled)
$$;
create or replace function app_is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = app_uid() and role = 'team' and team_owner and not disabled)
$$;
grant execute on function app_is_owner() to nazryx_app;
create or replace function auth_find_user(p_email text)
returns table (id uuid, password_hash text) language sql stable security definer set search_path = public as $$
  select id, password_hash from users where email = lower(trim(p_email)) and not disabled
$$;

create or replace function team_valid_permissions(p text[]) returns boolean language sql immutable as $$
  select coalesce(p <@ array['data', 'content', 'claims', 'requests', 'manufacturers', 'questions', 'accounts', 'documents', 'activity']::text[], false)
$$;

create or replace function team_add_member(p_email text, p_name text, p_hash text, p_permissions text[], p_owner boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not app_is_owner() then raise exception 'Only an owner can add team members'; end if;
  if not team_valid_permissions(p_permissions) then raise exception 'Unknown permission'; end if;
  if exists (select 1 from users where email = lower(trim(p_email))) then raise exception 'That email already has an account'; end if;
  insert into users (email, name, password_hash, role, plan, onboarded, team_owner, team_permissions)
  values (lower(trim(p_email)), p_name, p_hash, 'team', 'paid', true, coalesce(p_owner, false), p_permissions) returning id into v;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), 'insert', 'team_members', v::text, jsonb_build_object('email', lower(trim(p_email)), 'permissions', p_permissions, 'owner', p_owner));
  return v;
end $$;

create or replace function team_set_member(p_user uuid, p_permissions text[], p_owner boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_is_owner() then raise exception 'Only an owner can change permissions'; end if;
  if not team_valid_permissions(p_permissions) then raise exception 'Unknown permission'; end if;
  if p_user = app_uid() and not p_owner then raise exception 'You cannot remove your own owner rights'; end if;
  update users set team_permissions = p_permissions, team_owner = p_owner where id = p_user and role = 'team';
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), 'update', 'team_members', p_user::text, jsonb_build_object('permissions', p_permissions, 'owner', p_owner));
end $$;

create or replace function team_remove_member(p_user uuid, p_remove boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_is_owner() then raise exception 'Only an owner can remove team members'; end if;
  if p_user = app_uid() then raise exception 'You cannot remove yourself'; end if;
  update users set disabled = p_remove where id = p_user and role = 'team';
  if p_remove then delete from sessions where user_id = p_user; end if;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), 'update', 'team_members', p_user::text, jsonb_build_object('removed', p_remove));
end $$;

-- only an owner can reset another team member's password or two-step sign-in
create or replace function admin_reset_password(p_user uuid, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  if exists (select 1 from users where id = p_user and role = 'team') and not app_is_owner() then
    raise exception 'Only an owner can reset a team member''s password';
  end if;
  update users set password_hash = p_hash where id = p_user;
  delete from sessions where user_id = p_user;
  delete from login_failures where email = (select email from users where id = p_user);
end $$;
create or replace function admin_reset_totp(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  if exists (select 1 from users where id = p_user and role = 'team') and not app_is_owner() then
    raise exception 'Only an owner can reset a team member''s two-step sign-in';
  end if;
  delete from user_totp where user_id = p_user;
  delete from sessions where user_id = p_user;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), 'update', 'user_totp', p_user::text, '{"two_step": "reset"}');
end $$;

revoke all on function team_add_member(text, text, text, text[], boolean) from public;
revoke all on function team_set_member(uuid, text[], boolean) from public;
revoke all on function team_remove_member(uuid, boolean) from public;
grant execute on function team_add_member(text, text, text, text[], boolean), team_set_member(uuid, text[], boolean),
  team_remove_member(uuid, boolean) to nazryx_app;
