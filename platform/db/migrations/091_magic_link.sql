-- Sign in by email link: a one-time link, valid 15 minutes, mailed through the notifications outbox. Nothing about whether
-- an email has an account leaks to the form: the function answers the same either way.
create table login_links (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
revoke all on login_links from nazryx_app;

create or replace function auth_request_login_link(p_email text, p_hash text, p_link text, p_lang text default 'en') returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid; subj text; body text;
begin
  select id into uid from users where lower(email) = lower(p_email) and not disabled limit 1;
  if uid is null then return; end if;
  delete from login_links where user_id = uid and (used_at is not null or expires_at < now());
  insert into login_links (token_hash, user_id, expires_at) values (p_hash, uid, now() + interval '15 minutes');
  if p_lang = 'fr' then
    subj := 'Votre lien de connexion Nazryx';
    body := 'Cliquez pour vous connecter à Nazryx (valable 15 minutes, une seule fois) :' || E'\n\n' || p_link || E'\n\n' ||
            'Si vous n''avez pas demandé ce lien, ignorez ce message : rien ne change sur votre compte.';
  elsif p_lang = 'ru' then
    subj := 'Ваша ссылка для входа в Nazryx';
    body := 'Нажмите, чтобы войти в Nazryx (действует 15 минут, один раз):' || E'\n\n' || p_link || E'\n\n' ||
            'Если вы не запрашивали ссылку, просто проигнорируйте это письмо: с вашим аккаунтом ничего не произойдёт.';
  else
    subj := 'Your Nazryx sign-in link';
    body := 'Click to sign in to Nazryx (valid 15 minutes, once):' || E'\n\n' || p_link || E'\n\n' ||
            'If you did not ask for this link, ignore this message: nothing changes on your account.';
  end if;
  insert into notifications (user_id, channel, subject, body) values (uid, 'email', subj, body);
end $$;
revoke all on function auth_request_login_link(text, text, text, text) from public;
grant execute on function auth_request_login_link(text, text, text, text) to nazryx_app;

create or replace function auth_consume_login_link(p_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  update login_links set used_at = now() where token_hash = p_hash and used_at is null and expires_at > now() returning user_id into uid;
  return uid;
end $$;
revoke all on function auth_consume_login_link(text) from public;
grant execute on function auth_consume_login_link(text) to nazryx_app;
