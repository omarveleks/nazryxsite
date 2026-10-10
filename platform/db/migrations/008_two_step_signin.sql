-- Two-step sign-in with an authenticator app (TOTP). Required for Nazryx team accounts (the app sends them to
-- set-up before Admin opens), optional for customers.

create table user_totp (
  user_id uuid primary key references users(id) on delete cascade,
  secret text not null,                 -- base32; readable only by its own user (and definer functions below)
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  enabled_at timestamptz
);
alter table user_totp enable row level security;
create policy totp_own on user_totp for all using (user_id = app_uid()) with check (user_id = app_uid());
grant select, insert, update, delete on user_totp to nazryx_app;

-- After a correct password, accounts with two-step on get a short-lived challenge instead of a session.
create table login_challenges (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  attempts int not null default 0
);
revoke all on login_challenges from nazryx_app;

create or replace function auth_totp_enabled(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled from user_totp where user_id = p_user), false)
$$;

create or replace function auth_create_challenge(p_token_hash text, p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from login_challenges where expires_at < now();
  insert into login_challenges (token_hash, user_id, expires_at) values (p_token_hash, p_user, now() + interval '10 minutes');
$$;

-- the challenge's user and secret, while it is valid and has attempts left (5 per challenge)
create or replace function auth_challenge(p_token_hash text) returns table (user_id uuid, secret text)
language sql stable security definer set search_path = public as $$
  select c.user_id, t.secret from login_challenges c join user_totp t on t.user_id = c.user_id and t.enabled
  where c.token_hash = p_token_hash and c.expires_at > now() and c.attempts < 5
$$;

create or replace function auth_challenge_failed(p_token_hash text) returns void
language sql security definer set search_path = public as $$
  update login_challenges set attempts = attempts + 1 where token_hash = p_token_hash;
$$;

create or replace function auth_challenge_done(p_token_hash text) returns void
language sql security definer set search_path = public as $$
  delete from login_challenges where token_hash = p_token_hash;
$$;

-- a team member turns off two-step for someone who lost their phone (logged in audit_log via users trigger below)
create or replace function admin_reset_totp(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  delete from user_totp where user_id = p_user;
  delete from sessions where user_id = p_user;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), 'update', 'user_totp', p_user::text, '{"two_step": "reset"}');
end $$;
