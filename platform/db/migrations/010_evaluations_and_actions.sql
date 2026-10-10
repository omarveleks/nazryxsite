-- 1. Evaluation inside a sourcing request. The customer asks us to source a molecule; the team evaluates it first
--    (worth it or not, supply, price range, registration route) and writes the result here. Team writes, the
--    request's owner reads.
create table request_evaluations (
  request_id int primary key references requests(id) on delete cascade,
  verdict text not null check (verdict in ('go', 'maybe', 'no')),
  summary text not null,                       -- two or three lines: why
  supply text,                                 -- e.g. "Two GMP suppliers confirmed"
  price_range text,                            -- indicative, e.g. "USD 0.80-1.10 per pack of 100"
  route text,                                  -- registration route and how long it takes
  evaluated_by uuid,
  evaluated_at timestamptz not null default now()
);
alter table request_evaluations enable row level security;
create policy evaluations_read on request_evaluations for select
  using (app_is_team() or exists (select 1 from requests r where r.id = request_id and r.user_id = app_uid()));
create policy evaluations_team_write on request_evaluations for all using (app_is_team()) with check (app_is_team());
grant select, insert, update on request_evaluations to nazryx_app;
create trigger audit_request_evaluations after insert or update on request_evaluations
  for each row execute function audit_team_change();

-- 2. Molecules a customer hid from "Picked for you".
create table hidden_molecules (
  user_id uuid not null references users(id) on delete cascade,
  molecule_id int not null references molecules(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, molecule_id)
);
alter table hidden_molecules enable row level security;
create policy hidden_own on hidden_molecules for all using (user_id = app_uid()) with check (user_id = app_uid());
grant select, insert, delete on hidden_molecules to nazryx_app;

-- 3. Competitor moves that touch the caller: products registered or dropped in the last p_days days for molecules
--    the caller carries (or, without a portfolio, nothing). Registration history itself stays team-only; this
--    returns only public registration facts.
create or replace function my_market_moves(p_days int default 60)
returns table (change text, molecule_id int, molecule text, company_id int, company text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select h.change, r.molecule_id, m.inn, c.id, c.display_name, h.created_at
  from registration_history h
  join registrations r on r.id = h.registration_id
  join molecules m on m.id = r.molecule_id
  left join companies c on c.id = r.ltr_id
  where h.created_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
    and (h.change in ('added', 'removed') or (h.change = 'status' and (h.after->>'active')::boolean is false))
    and r.molecule_id in (select p.molecule_id from portfolio_items p where p.user_id = app_uid())
  order by h.created_at desc
  limit 20
$$;
revoke all on function my_market_moves(int) from public;
grant execute on function my_market_moves(int) to nazryx_app;
