-- When each account last signed in and was last active, shown to the team (Admin > Team and Accounts).
alter table users add column last_login_at timestamptz, add column last_seen_at timestamptz;

create or replace function auth_create_session(p_token_hash text, p_user uuid, p_expires timestamptz)
returns void language sql security definer set search_path = public as $$
  delete from sessions where expires_at < now();
  insert into sessions (token_hash, user_id, expires_at) values (p_token_hash, p_user, p_expires);
  update users set last_login_at = now(), last_seen_at = now() where id = p_user;
$$;

-- the signed-in account for a session; marks it active at most every five minutes (no write on most requests)
drop function if exists auth_session_user(text);
create function auth_session_user(p_token_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select user_id into v from sessions where token_hash = p_token_hash and expires_at > now();
  if v is not null then
    update users set last_seen_at = now() where id = v and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  end if;
  return v;
end $$;
