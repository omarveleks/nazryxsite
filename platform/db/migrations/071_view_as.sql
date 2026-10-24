-- The team can open a customer's portal as they see it (Admin > Accounts > View as), to check what they see and find
-- errors. A view is read-only, lasts an hour, rides on the team member's own signed-in session (it ends when that
-- session does or when the member loses the 'accounts' permission), never marks the customer active, and is logged.
create table view_sessions (
  token_hash text primary key,
  admin_id uuid not null references users(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table view_sessions enable row level security;   -- reached only through the functions below

create or replace function admin_start_view(p_token_hash text, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_team_can('accounts') then raise exception 'Only the team can view an account'; end if;
  if not exists (select 1 from users where id = p_user and role <> 'team') then
    raise exception 'No such customer account';
  end if;
  delete from view_sessions where expires_at < now() or admin_id = app_uid();
  insert into view_sessions (token_hash, admin_id, user_id, expires_at) values (p_token_hash, app_uid(), p_user, now() + interval '1 hour');
  insert into audit_log (actor, action, table_name, row_id, changes) values (app_uid(), 'view as', 'users', p_user::text, null);
end $$;
grant execute on function admin_start_view(text, uuid) to nazryx_app;

-- the account being viewed, when the view is live and the team member's own session and permission still are
create or replace function auth_view_user(p_view_hash text, p_session_hash text) returns uuid
language sql stable security definer set search_path = public as $$
  select v.user_id from view_sessions v
  join sessions s on s.token_hash = p_session_hash and s.user_id = v.admin_id and s.expires_at > now()
  join users a on a.id = v.admin_id and a.role = 'team' and not a.disabled and (a.team_owner or 'accounts' = any(a.team_permissions))
  where v.token_hash = p_view_hash and v.expires_at > now()
$$;
grant execute on function auth_view_user(text, text) to nazryx_app;

create or replace function auth_end_view(p_view_hash text) returns uuid
language sql security definer set search_path = public as $$
  delete from view_sessions where token_hash = p_view_hash returning user_id
$$;
grant execute on function auth_end_view(text) to nazryx_app;
