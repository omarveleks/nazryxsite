-- 1. Requests follow the pharmaceutical route: product request, regulatory check (what is registered and by whom),
--    regulatory analysis (the route to register it), pricing and logistics (quotes), registration, shipment.
alter table requests drop constraint if exists requests_stage_check;
update requests r set stage = case
    when r.stage = 'Submitted' then 'Product request'
    when r.stage = 'Reviewing' then 'Regulatory check'
    when r.stage in ('Suppliers found', 'Quote ready') then 'Pricing and logistics'
    when r.stage = 'Closed' and r.closed_reason = 'Quote accepted'
         and exists (select 1 from orders o where o.request_id = r.id and o.status not in ('Delivered', 'Cancelled')) then 'Shipment'
    else r.stage end;
update request_stage_history set stage = case stage
    when 'Submitted' then 'Product request' when 'Reviewing' then 'Regulatory check'
    when 'Suppliers found' then 'Pricing and logistics' when 'Quote ready' then 'Pricing and logistics' else stage end;
alter table requests alter column stage set default 'Product request';
alter table requests add constraint requests_stage_check check (stage in
  ('Product request', 'Regulatory check', 'Regulatory analysis', 'Pricing and logistics', 'Registration', 'Shipment', 'Closed'));

drop policy requests_insert on requests;
create policy requests_insert on requests for insert with check (user_id = app_uid() and stage = 'Product request');
drop policy stage_hist_insert on request_stage_history;
create policy stage_hist_insert on request_stage_history for insert with check (
  app_is_team() or (stage = 'Product request' and exists (select 1 from requests r where r.id = request_id and r.user_id = app_uid())));

-- accepting a quote picks the supplier and moves the product on to registration; the request stays open
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
  update requests set stage = 'Registration', updated_at = now() where id = r.id;
  insert into request_stage_history (request_id, stage, changed_by) values (r.id, 'Registration', app_uid());
  insert into notifications (user_id, channel, subject, body)
    values (null, 'email', 'Quote accepted', 'Request #' || r.id || ': ' || q.label || ' accepted. Next: registration. Order #' || v_order || '.');
  return v_order;
end $$;

-- the free-plan cap counts requests we are still working up, not products already in registration or shipping
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
    select count(*) into n from requests where user_id = new.user_id and stage not in ('Registration', 'Shipment', 'Closed');
    if n >= lim.max_active_requests then
      raise exception 'Free plan: up to % active requests', lim.max_active_requests;
    end if;
  end if;
  return new;
end $$;

-- the evaluation gets its own regulatory-check finding (what is registered, by whom, any restriction)
alter table request_evaluations add column regulatory_check text;

-- 2. Suggested pricing: the team's recommended price band for a molecule (paid plans, like market prices).
alter table market_prices add column kind text not null default 'observed' check (kind in ('observed', 'suggested'));
alter table market_prices add column note text;

-- 3. Sourcing list: molecules a customer collects before requesting them together.
create table sourcing_list (
  user_id uuid not null references users(id) on delete cascade,
  molecule_id int not null references molecules(id) on delete cascade,
  quantity text,
  added_at timestamptz not null default now(),
  primary key (user_id, molecule_id)
);
alter table sourcing_list enable row level security;
create policy sourcing_list_own on sourcing_list for all using (user_id = app_uid()) with check (user_id = app_uid());
grant select, insert, update, delete on sourcing_list to nazryx_app;
