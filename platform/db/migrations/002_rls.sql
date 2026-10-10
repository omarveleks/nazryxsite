-- Row-level security and the restricted app role.
--
-- The web app connects as `nazryx_app` (no BYPASSRLS, owns nothing). Each request runs in a transaction that
-- first sets `app.user_id` to the signed-in user's id (set_config(..., true) = transaction-local).
-- Policies read that setting through app_uid(). Privileged changes (credits, plan, accepting a quote, approving
-- a claim) go through SECURITY DEFINER functions that check the caller themselves.
--
-- Supplier confidentiality: `suppliers` and `supplier_offers` are readable only by Nazryx team accounts, plus the
-- one supplier / offer behind a quote the customer has accepted on their own request. Quotes carry only an
-- anonymous label and non-identifying terms. Nothing in the UI can widen this.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'nazryx_app') then
    create role nazryx_app login nobypassrls;
  end if;
end $$;

grant usage on schema public to nazryx_app;

-- ---------------------------------------------------------------- helpers
create or replace function app_uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_is_team() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = app_uid() and role = 'team')
$$;

-- plan of the caller; a team seat inherits the plan of the account that owns it
create or replace function app_plan() returns text language sql stable security definer set search_path = public as $$
  select coalesce(o.plan, u.plan) from users u left join users o on o.id = u.owner_id where u.id = app_uid()
$$;

-- ---------------------------------------------------------------- public registry data: read-only for the app
grant select on countries, molecules, molecule_aliases, country_molecules, companies, company_aliases,
  registrations, gap_scores, company_stats to nazryx_app;

-- team can record review-queue decisions (applied by the next ingest / recompute job)
alter table molecule_aliases enable row level security;
create policy molecule_aliases_read on molecule_aliases for select using (true);
create policy molecule_aliases_team on molecule_aliases for insert with check (app_is_team());
grant insert on molecule_aliases to nazryx_app;

alter table company_aliases enable row level security;
create policy company_aliases_read on company_aliases for select using (true);
create policy company_aliases_team on company_aliases for insert with check (app_is_team());
grant insert on company_aliases to nazryx_app;

alter table company_keep_separate enable row level security;
create policy keep_separate_team on company_keep_separate for all using (app_is_team()) with check (app_is_team());
grant select, insert on company_keep_separate to nazryx_app;

alter table company_merges enable row level security;
create policy company_merges_team on company_merges for select using (app_is_team());
grant select on company_merges to nazryx_app;

-- molecule use-case text is edited by the team
grant update (use_case, category) on molecules to nazryx_app;
alter table molecules enable row level security;
create policy molecules_read on molecules for select using (true);
create policy molecules_team_update on molecules for update using (app_is_team()) with check (app_is_team());

-- ---------------------------------------------------------------- ingest bookkeeping: team only
alter table registry_uploads enable row level security;
create policy uploads_team on registry_uploads for all using (app_is_team()) with check (app_is_team());
grant select, insert on registry_uploads to nazryx_app;
grant usage on sequence registry_uploads_id_seq to nazryx_app;

alter table registration_history enable row level security;
create policy reg_history_team on registration_history for select using (app_is_team());
grant select on registration_history to nazryx_app;

alter table gap_score_history enable row level security;
create policy gap_history_team on gap_score_history for select using (app_is_team());
grant select on gap_score_history to nazryx_app;

alter table reminders_log enable row level security;
create policy reminders_team on reminders_log for select using (app_is_team());
grant select on reminders_log to nazryx_app;

-- ---------------------------------------------------------------- users and sessions
alter table users enable row level security;
create policy users_self_or_team on users for select using (id = app_uid() or app_is_team() or owner_id = app_uid());
create policy users_self_update on users for update using (id = app_uid()) with check (id = app_uid());
grant select on users to nazryx_app;
-- customers may change only these columns; plan, role, credits and company go through definer functions
grant update (name, whatsapp, notify_email, notify_whatsapp, language, country, onboarded) on users to nazryx_app;

-- sessions are never readable by the app role directly
revoke all on sessions from nazryx_app;

create or replace function auth_find_user(p_email text)
returns table (id uuid, password_hash text) language sql stable security definer set search_path = public as $$
  select id, password_hash from users where email = lower(trim(p_email))
$$;

create or replace function auth_create_user(p_email text, p_name text, p_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  insert into users (email, name, password_hash) values (lower(trim(p_email)), p_name, p_hash) returning id into v;
  return v;
end $$;

create or replace function auth_create_session(p_token_hash text, p_user uuid, p_expires timestamptz)
returns void language sql security definer set search_path = public as $$
  delete from sessions where expires_at < now();
  insert into sessions (token_hash, user_id, expires_at) values (p_token_hash, p_user, p_expires);
$$;

create or replace function auth_session_user(p_token_hash text)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from sessions where token_hash = p_token_hash and expires_at > now()
$$;

create or replace function auth_delete_session(p_token_hash text)
returns void language sql security definer set search_path = public as $$
  delete from sessions where token_hash = p_token_hash
$$;

create or replace function auth_set_password(p_user uuid, p_hash text)
returns void language sql security definer set search_path = public as $$
  update users set password_hash = p_hash where id = p_user and (p_user = app_uid() or app_is_team());
$$;

-- ---------------------------------------------------------------- team-only account changes
create or replace function admin_set_plan(p_user uuid, p_plan text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  update users set plan = p_plan where id = p_user;
  update plan_requests set status = 'done' where user_id = p_user and status = 'open';
end $$;

create or replace function admin_grant_credits(p_user uuid, p_credits int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'team only'; end if;
  update users set credits = credits + p_credits where id = p_user;
  insert into credit_ledger (user_id, delta, reason) values (p_user, p_credits, 'granted by Nazryx');
end $$;

-- a paid account adds a teammate (seat); the seat signs in with its own password
create or replace function add_seat(p_email text, p_name text, p_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; owner users;
begin
  select * into owner from users where id = app_uid();
  if owner.id is null or owner.owner_id is not null then raise exception 'not allowed'; end if;
  if owner.plan <> 'paid' then raise exception 'Team seats are on the paid plan'; end if;
  insert into users (email, name, password_hash, owner_id, country, company_id, plan, onboarded)
  values (lower(trim(p_email)), p_name, p_hash, owner.id, owner.country, owner.company_id, 'paid', true) returning id into v;
  return v;
end $$;

-- ---------------------------------------------------------------- enrich credits
create table if not exists plan_limits (plan text primary key, monthly_credits int, max_active_requests int,
  max_follows int, max_watches int);
insert into plan_limits values ('free', 20, 5, 3, 5), ('paid', null, null, null, null) on conflict do nothing;
grant select on plan_limits to nazryx_app;

-- spend one credit to open (enrich) a molecule. Re-opening is free. Paid plans do not spend credits.
-- returns the credits left (null for unlimited)
create or replace function enrich_molecule(p_molecule int) returns int
language plpgsql security definer set search_path = public as $$
declare u users; v_plan text := app_plan(); lim int;
begin
  select * into u from users where id = app_uid() for update;
  if u.id is null then raise exception 'sign in first'; end if;
  if exists (select 1 from enrichments where user_id = u.id and molecule_id = p_molecule) then
    return case when v_plan = 'paid' then null else u.credits end;
  end if;
  if v_plan = 'paid' or u.role = 'team' then
    insert into enrichments (user_id, molecule_id) values (u.id, p_molecule);
    return null;
  end if;
  select monthly_credits into lim from plan_limits where plan = 'free';
  if u.credits_reset_at < date_trunc('month', now()) then
    u.credits := lim;
    update users set credits = lim, credits_reset_at = now() where id = u.id;
    insert into credit_ledger (user_id, delta, reason) values (u.id, lim, 'monthly credits');
  end if;
  if u.credits <= 0 then raise exception 'No enrich credits left this month'; end if;
  update users set credits = credits - 1 where id = u.id;
  insert into enrichments (user_id, molecule_id) values (u.id, p_molecule);
  insert into credit_ledger (user_id, delta, reason, molecule_id) values (u.id, -1, 'enrich', p_molecule);
  return u.credits - 1;
end $$;

alter table enrichments enable row level security;
create policy enrichments_own on enrichments for select using (user_id = app_uid() or app_is_team());
grant select on enrichments to nazryx_app;

alter table credit_ledger enable row level security;
create policy ledger_own on credit_ledger for select using (user_id = app_uid() or app_is_team());
grant select on credit_ledger to nazryx_app;

-- ---------------------------------------------------------------- the customer's own data
alter table portfolio_items enable row level security;
create policy portfolio_own on portfolio_items for all using (user_id = app_uid()) with check (user_id = app_uid());
create policy portfolio_team_read on portfolio_items for select using (app_is_team());
grant select, insert, delete on portfolio_items to nazryx_app;

alter table customer_suppliers enable row level security;
create policy csup_own on customer_suppliers for all using (user_id = app_uid()) with check (user_id = app_uid());
grant select, insert, delete on customer_suppliers to nazryx_app;
grant usage on sequence customer_suppliers_id_seq to nazryx_app;

alter table watches enable row level security;
create policy watches_own on watches for all using (user_id = app_uid()) with check (user_id = app_uid());
grant select, insert, delete on watches to nazryx_app;

alter table follows enable row level security;
create policy follows_own on follows for all using (user_id = app_uid()) with check (user_id = app_uid());
grant select, insert, delete on follows to nazryx_app;

-- free-plan limits on follows and watches, enforced in the database
create or replace function enforce_plan_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim plan_limits; n int;
begin
  select * into lim from plan_limits where plan = coalesce(app_plan(), 'free');
  if tg_table_name = 'follows' and lim.max_follows is not null then
    select count(*) into n from follows where user_id = new.user_id;
    if n >= lim.max_follows then raise exception 'Free plan: follow up to % companies', lim.max_follows; end if;
  elsif tg_table_name = 'watches' and lim.max_watches is not null then
    select count(*) into n from watches where user_id = new.user_id;
    if n >= lim.max_watches then raise exception 'Free plan: watch up to % molecules', lim.max_watches; end if;
  elsif tg_table_name = 'requests' and lim.max_active_requests is not null then
    select count(*) into n from requests where user_id = new.user_id and stage <> 'Closed';
    if n >= lim.max_active_requests then
      raise exception 'Free plan: up to % active requests', lim.max_active_requests;
    end if;
  end if;
  return new;
end $$;
create trigger follows_limit before insert on follows for each row execute function enforce_plan_limits();
create trigger watches_limit before insert on watches for each row execute function enforce_plan_limits();

alter table plan_requests enable row level security;
create policy plan_requests_own on plan_requests for select using (user_id = app_uid() or app_is_team());
create policy plan_requests_insert on plan_requests for insert with check (user_id = app_uid());
grant select, insert on plan_requests to nazryx_app;
grant usage on sequence plan_requests_id_seq to nazryx_app;

-- ---------------------------------------------------------------- company claims (manual verification)
alter table company_claims enable row level security;
create policy claims_own on company_claims for select using (user_id = app_uid() or app_is_team());
create policy claims_insert on company_claims for insert with check (user_id = app_uid() and status = 'pending');
grant select, insert on company_claims to nazryx_app;
grant usage on sequence company_claims_id_seq to nazryx_app;

create or replace function review_claim(p_claim int, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c company_claims;
begin
  if not app_is_team() then raise exception 'team only'; end if;
  select * into c from company_claims where id = p_claim for update;
  if c.id is null or c.status <> 'pending' then raise exception 'claim is not pending'; end if;
  update company_claims set status = case when p_approve then 'approved' else 'rejected' end,
    review_note = p_note, reviewed_by = app_uid(), reviewed_at = now() where id = p_claim;
  if p_approve then
    update users set company_id = c.company_id where id = c.user_id or owner_id = c.user_id;
    if c.company_id is not null then
      update companies set claimed_by = c.user_id, verified = true where id = c.company_id;
      if c.portfolio_source = 'registry' then
        insert into portfolio_items (user_id, molecule_id, source)
        select distinct c.user_id, r.molecule_id, 'registry' from registrations r
        where r.active and r.molecule_id is not null and (r.ltr_id = c.company_id or r.registrant_id = c.company_id)
        on conflict do nothing;
      end if;
    end if;
  end if;
  insert into notifications (user_id, channel, subject, body) values
    (c.user_id, 'email', 'Your company claim',
     case when p_approve then 'Your company is verified. Your profile is unlocked.'
          else 'We could not verify your company yet. ' || coalesce(p_note, '') end);
end $$;

-- ---------------------------------------------------------------- requests
alter table requests enable row level security;
create policy requests_read on requests for select using (user_id = app_uid() or app_is_team());
create policy requests_insert on requests for insert with check (user_id = app_uid() and stage = 'Submitted');
create policy requests_team_update on requests for update using (app_is_team()) with check (app_is_team());
grant select, insert on requests to nazryx_app;
grant update (stage, closed_reason, updated_at) on requests to nazryx_app;
grant usage on sequence requests_id_seq to nazryx_app;
create trigger requests_limit before insert on requests for each row execute function enforce_plan_limits();

alter table request_stage_history enable row level security;
create policy stage_hist_read on request_stage_history for select using (
  exists (select 1 from requests r where r.id = request_id));     -- inherits the requests policy
create policy stage_hist_insert on request_stage_history for insert with check (
  app_is_team() or (stage = 'Submitted' and exists (select 1 from requests r where r.id = request_id and r.user_id = app_uid())));
grant select, insert on request_stage_history to nazryx_app;
grant usage on sequence request_stage_history_id_seq to nazryx_app;

alter table request_files enable row level security;
create policy files_read on request_files for select using (exists (select 1 from requests r where r.id = request_id));
create policy files_insert on request_files for insert with check (
  exists (select 1 from requests r where r.id = request_id) and uploaded_by = app_uid());
grant select, insert on request_files to nazryx_app;
grant usage on sequence request_files_id_seq to nazryx_app;

alter table request_messages enable row level security;
create policy messages_read on request_messages for select using (exists (select 1 from requests r where r.id = request_id));
create policy messages_insert on request_messages for insert with check (
  author_id = app_uid() and exists (select 1 from requests r where r.id = request_id)
  and from_team = app_is_team());
grant select, insert on request_messages to nazryx_app;
grant usage on sequence request_messages_id_seq to nazryx_app;

-- ---------------------------------------------------------------- confidential sourcing data
alter table suppliers enable row level security;
alter table supplier_offers enable row level security;
alter table quotes enable row level security;
alter table orders enable row level security;

-- quotes: customers see the quotes on their own requests (anonymous label + terms); only the team writes them
create policy quotes_read on quotes for select using (
  app_is_team() or exists (select 1 from requests r where r.id = request_id and r.user_id = app_uid()));
create policy quotes_team_write on quotes for insert with check (app_is_team());
create policy quotes_team_update on quotes for update using (app_is_team()) with check (app_is_team());
grant select, insert, update on quotes to nazryx_app;
grant usage on sequence quotes_id_seq to nazryx_app;

-- offers (price, MOQ ...): team, or the customer who accepted a quote on this very offer
create policy offers_read on supplier_offers for select using (
  app_is_team() or exists (
    select 1 from quotes q join requests r on r.id = q.request_id
    where q.supplier_offer_id = supplier_offers.id and q.accepted and r.user_id = app_uid()));
create policy offers_team_write on supplier_offers for insert with check (app_is_team());
create policy offers_team_update on supplier_offers for update using (app_is_team()) with check (app_is_team());
grant select, insert, update on supplier_offers to nazryx_app;
grant usage on sequence supplier_offers_id_seq to nazryx_app;

-- supplier identity: team, or the customer who accepted a quote backed by this supplier
create policy suppliers_read on suppliers for select using (
  app_is_team() or exists (
    select 1 from supplier_offers o join quotes q on q.supplier_offer_id = o.id join requests r on r.id = q.request_id
    where o.supplier_id = suppliers.id and q.accepted and r.user_id = app_uid()));
create policy suppliers_team_write on suppliers for insert with check (app_is_team());
create policy suppliers_team_update on suppliers for update using (app_is_team()) with check (app_is_team());
grant select, insert, update on suppliers to nazryx_app;

-- internal notes live in their own table and stay team-only even after a quote is accepted
alter table supplier_notes enable row level security;
create policy supplier_notes_team on supplier_notes for all using (app_is_team()) with check (app_is_team());
grant select, insert, update on supplier_notes to nazryx_app;
grant usage on sequence suppliers_id_seq to nazryx_app;

-- what a customer sees once a quote is accepted (security_invoker: RLS of the caller applies)
create or replace view accepted_supplier as
  select q.id as quote_id, q.request_id, s.name as supplier_name, s.country as supplier_country, s.contact,
         o.price, o.currency, o.unit, o.moq, o.lead_time_weeks, o.certs
  from quotes q
  join supplier_offers o on o.id = q.supplier_offer_id
  join suppliers s on s.id = o.supplier_id
  where q.accepted;
alter view accepted_supplier set (security_invoker = true);
grant select on accepted_supplier to nazryx_app;

create policy orders_read on orders for select using (exists (select 1 from requests r where r.id = request_id));
create policy orders_team_update on orders for update using (app_is_team()) with check (app_is_team());
grant select on orders to nazryx_app;
grant update (status, updated_at) on orders to nazryx_app;

-- the customer accepts one quote: reveals that supplier (via the policies above) and opens an order
create or replace function accept_quote(p_quote int) returns int
language plpgsql security definer set search_path = public as $$
declare q quotes; r requests; v_order int;
begin
  select * into q from quotes where id = p_quote for update;
  if q.id is null then raise exception 'quote not found'; end if;
  select * into r from requests where id = q.request_id for update;
  if r.user_id is distinct from app_uid() then raise exception 'not your request'; end if;
  if r.stage = 'Closed' then raise exception 'request is closed'; end if;
  if exists (select 1 from quotes where request_id = r.id and accepted) then raise exception 'a quote is already accepted'; end if;
  update quotes set accepted = true, accepted_at = now() where id = q.id;
  insert into orders (request_id, quote_id) values (r.id, q.id) returning id into v_order;
  update requests set stage = 'Closed', closed_reason = 'Quote accepted', updated_at = now() where id = r.id;
  insert into request_stage_history (request_id, stage, changed_by) values (r.id, 'Closed', app_uid());
  insert into notifications (user_id, channel, subject, body)
    values (null, 'email', 'Quote accepted', 'Request #' || r.id || ': ' || q.label || ' accepted. Order #' || v_order || ' opened.');
  return v_order;
end $$;

-- "Confirmed supply exists" for the molecule page: paid plans only, never names or prices
create or replace function molecule_supply_confirmed(p_molecule int) returns boolean
language sql stable security definer set search_path = public as $$
  select case when app_plan() = 'paid' or app_is_team()
    then exists (select 1 from supplier_offers where molecule_id = p_molecule and confirmed) else null end
$$;

-- ---------------------------------------------------------------- feed, prices, notifications
alter table feed_items enable row level security;
create policy feed_read on feed_items for select using (user_id is null or user_id = app_uid() or app_is_team());
create policy feed_team_insert on feed_items for insert with check (app_is_team());
grant select, insert on feed_items to nazryx_app;
grant usage on sequence feed_items_id_seq to nazryx_app;

alter table market_prices enable row level security;
create policy prices_paid on market_prices for select using (app_plan() = 'paid' or app_is_team());
create policy prices_team on market_prices for insert with check (app_is_team());
grant select, insert on market_prices to nazryx_app;
grant usage on sequence market_prices_id_seq to nazryx_app;

alter table notifications enable row level security;
create policy notif_read on notifications for select using (user_id = app_uid() or app_is_team());
create policy notif_insert on notifications for insert with check (
  app_is_team() or user_id is null or user_id = app_uid());
grant select, insert on notifications to nazryx_app;
grant usage on sequence notifications_id_seq to nazryx_app;

-- the app may not create or alter anything else
revoke create on schema public from nazryx_app;
