-- 1. Sign-in throttling: after 5 failed attempts for an email within 15 minutes, sign-in is refused until the
--    window passes. The app role has no direct access to the attempts table.
create table login_failures (
  id bigserial primary key,
  email text not null,
  at timestamptz not null default now()
);
create index login_failures_email_at on login_failures (email, at);

create or replace function auth_throttled(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) >= 5 from login_failures where email = lower(trim(p_email)) and at > now() - interval '15 minutes'
$$;

create or replace function auth_record_failure(p_email text) returns void
language sql security definer set search_path = public as $$
  delete from login_failures where at < now() - interval '1 day';
  insert into login_failures (email) values (lower(trim(p_email)));
$$;

create or replace function auth_clear_failures(p_email text) returns void
language sql security definer set search_path = public as $$
  delete from login_failures where email = lower(trim(p_email));
$$;

-- 2. No reset email yet: a team member sets a temporary password. All of that user's sessions end.
create or replace function admin_reset_password(p_user uuid, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  update users set password_hash = p_hash where id = p_user;
  delete from sessions where user_id = p_user;
  delete from login_failures where email = (select email from users where id = p_user);
end $$;

-- 3. Gap scores as customers see them. A confirmed supplier offer lifts actionability (A) and so the score;
--    that is paid information ("supplier availability"), so free accounts see the score without it.
alter table gap_scores add column base_score numeric;
update gap_scores set base_score = case when actionability >= 1 then round(score * 0.3, 1) else score end;
alter table gap_scores alter column base_score set not null;

create or replace view visible_gap_scores as
  select g.country, g.molecule_id, g.demand, g.saturation,
         case when app_plan() = 'paid' or app_is_team() then g.actionability else 0.3 end as actionability,
         case when app_plan() = 'paid' or app_is_team() then g.score else g.base_score end as score,
         g.computed_at
  from gap_scores g;
-- the view runs with its owner's rights, so the app reads scores only through it
revoke select on gap_scores from nazryx_app;
grant select on visible_gap_scores to nazryx_app;
