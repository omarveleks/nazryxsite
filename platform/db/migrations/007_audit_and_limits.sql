-- 1. Team action log. Every insert or change a Nazryx team account makes to the tables below is recorded
--    by a trigger, so the log cannot be skipped by app code. Ingest jobs (owner role, no signed-in user) are
--    recorded on the upload row itself instead.
create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,           -- 'insert' or 'update'
  table_name text not null,
  row_id text,
  changes jsonb                   -- changed columns (update) or the new row (insert), large/secret columns left out
);
create index audit_log_at on audit_log (at desc);

create or replace function audit_team_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  skip text[] := array['password_hash', 'data', 'totp_secret'];
  n jsonb; o jsonb; diff jsonb := '{}'::jsonb; k text;
begin
  if not app_is_team() then return null; end if;
  n := to_jsonb(new) - skip;
  if tg_op = 'UPDATE' then
    o := to_jsonb(old) - skip;
    for k in select jsonb_object_keys(n) loop
      if n->k is distinct from o->k then diff := diff || jsonb_build_object(k, jsonb_build_array(o->k, n->k)); end if;
    end loop;
    if to_jsonb(new)->'password_hash' is distinct from to_jsonb(old)->'password_hash' then
      diff := diff || '{"password": "reset"}'::jsonb;
    end if;
    if diff = '{}'::jsonb then return null; end if;
  else
    diff := n;
  end if;
  insert into audit_log (actor, action, table_name, row_id, changes)
  values (app_uid(), lower(tg_op), tg_table_name, coalesce(n->>'id', n->>'molecule_id', n->>'alias', n->>'kind'), diff);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['requests', 'quotes', 'supplier_offers', 'suppliers', 'orders', 'company_claims', 'users',
                           'company_aliases', 'molecule_aliases', 'company_keep_separate', 'market_prices', 'feed_items',
                           'reference_files', 'registry_uploads', 'molecules', 'plan_requests', 'request_messages']
  loop
    execute format('create trigger audit_%1$s after insert or update on %1$I for each row execute function audit_team_change()', t);
  end loop;
end $$;

alter table audit_log enable row level security;
create policy audit_team_read on audit_log for select using (app_is_team());
grant select on audit_log to nazryx_app;

-- 2. Rate limits. Sign-ups are limited per network address and overall; uploads per account per day.
create table rate_events (
  id bigserial primary key,
  kind text not null,
  key text not null,
  at timestamptz not null default now()
);
create index rate_events_kind_key_at on rate_events (kind, key, at);

-- returns true (and records the event) when allowed, false when the limit is reached
create or replace function rate_allow(p_kind text, p_key text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from rate_events where at < now() - interval '2 days';
  select count(*) into n from rate_events where kind = p_kind and key = p_key and at > now() - p_window;
  if n >= p_max then return false; end if;
  insert into rate_events (kind, key) values (p_kind, p_key);
  return true;
end $$;

create or replace function limit_uploads() returns trigger
language plpgsql security definer set search_path = public as $$
declare files int; bytes bigint;
begin
  if app_is_team() or new.uploaded_by is null then return new; end if;
  select count(*), coalesce(sum(size), 0) into files, bytes from stored_files
   where uploaded_by = new.uploaded_by and created_at > now() - interval '1 day';
  if files >= 60 then raise exception 'Upload limit reached: 60 files a day. Try again tomorrow or contact us.'; end if;
  if bytes + new.size > 300 * 1024 * 1024 then raise exception 'Upload limit reached: 300 MB a day. Try again tomorrow or contact us.'; end if;
  return new;
end $$;
create trigger stored_files_limit before insert on stored_files for each row execute function limit_uploads();
