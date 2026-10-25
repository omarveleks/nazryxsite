-- Customer usage for the team (Admin > Customers > Usage, and each account's page): every page an account opens and
-- every sign-in, from now on. Before this only the last sign-in and last activity were kept; the pages rebuild earlier
-- days from what accounts created (products, files, requests, questions, bookings) and their sign-ins still on record.
create table usage_events (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('view', 'sign_in')),
  path text                                   -- the page, without its query string
);
create index usage_events_user_at on usage_events (user_id, at desc);
create index usage_events_at on usage_events (at desc);
alter table usage_events enable row level security;
create policy usage_events_team on usage_events for select using (app_is_team());
grant select on usage_events to nazryx_app;

-- a page opened by the account behind a session (the team viewing an account is recorded as the team member, not the
-- customer); the same page again within ten seconds is one view
create or replace function auth_record_view(p_token_hash text, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select user_id into v from sessions where token_hash = p_token_hash and expires_at > now();
  if v is null or p_path is null then return; end if;
  if exists (select 1 from usage_events where user_id = v and kind = 'view' and path = left(p_path, 300)
             and at > now() - interval '10 seconds') then return; end if;
  insert into usage_events (user_id, kind, path) values (v, 'view', left(p_path, 300));
end $$;
revoke all on function auth_record_view(text, text) from public;
grant execute on function auth_record_view(text, text) to nazryx_app;

create or replace function auth_create_session(p_token_hash text, p_user uuid, p_expires timestamptz)
returns void language sql security definer set search_path = public as $$
  delete from sessions where expires_at < now();
  insert into sessions (token_hash, user_id, expires_at) values (p_token_hash, p_user, p_expires);
  update users set last_login_at = now(), last_seen_at = now() where id = p_user;
  insert into usage_events (user_id, kind) values (p_user, 'sign_in');
$$;

-- every dated sign of accounts being there, for the team only: pages and sign-ins recorded here, sign-ins from before
-- still on record (when each session began; never its token), and what accounts created (products, files, requests...)
create or replace function usage_signs(p_days int)
returns table (user_id uuid, at timestamptz, kind text, path text, what text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_team() then return; end if;
  return query
    with since as (select now() - make_interval(days => p_days) as t)
    select e.user_id, e.at, case when e.kind = 'view' then 'view' else 'sign_in' end, e.path, null::text
      from usage_events e, since where e.at > since.t
    union all select s.user_id, s.created_at, 'sign_in', null, null from sessions s, since
      where s.created_at > since.t and not exists (select 1 from usage_events e where e.user_id = s.user_id and e.kind = 'sign_in'
                                                   and abs(extract(epoch from e.at - s.created_at)) < 5)
    union all select a.user_id, a.created_at, 'action', null, a.what from (
      select x.user_id, x.created_at, 'Added products' as what from mfr_products x
      union all select x.user_id, x.created_at, 'Uploaded a file' from mfr_files x
      union all select x.user_id, x.created_at, 'Sent a request' from requests x
      union all select x.user_id, x.created_at, 'Asked a question' from expert_questions x
      union all select x.user_id, x.created_at, 'Asked for a plan' from plan_requests x
      union all select x.user_id, x.created_at, 'Booked a call' from call_bookings x
      union all select x.user_id, x.created_at, 'Followed a medicine' from follows x
      union all select x.user_id, x.created_at, 'Set a watch' from watches x
      union all select x.user_id, x.created_at, 'Added a launch' from launches x
      union all select x.user_id, x.created_at, 'Added a market' from market_subscriptions x
      union all select x.user_id, x.created_at, 'Claimed a company' from company_claims x
      union all select x.user_id, x.created_at, 'Filled in the profile' from manufacturer_profiles x
      union all select x.user_id, x.created_at, 'Added a supplier' from customer_suppliers x
      union all select x.user_id, x.created_at, 'Added competitors' from mfr_competitors x
      union all select x.user_id, x.created_at, 'Placed an order' from invoice_orders x) a, since
      where a.created_at > since.t and a.user_id is not null;
end $$;
revoke all on function usage_signs(int) from public;
grant execute on function usage_signs(int) to nazryx_app;
