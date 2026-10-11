-- 1. Markets: Tanzania, Kazakhstan, Kyrgyzstan, Uzbekistan, Kenya with market data; Senegal, Cameroon, Côte d'Ivoire, Haiti
--    worked by the team. 2. Card payments for Basic Market Data and Complete Market Access (Stripe; keys only in the host),
--    invoices and order confirmations issued by the worker. 3. Launch tracker. 4. Market watch for manufacturers.
--    5. Verified manufacturer badge and a free full read of one product.

-- 1. countries
insert into countries (code, name, enabled) values
  ('KG', 'Kyrgyzstan', false), ('CI', 'Côte d''Ivoire', false), ('HT', 'Haiti', false),
  ('KZ', 'Kazakhstan', false), ('UZ', 'Uzbekistan', false), ('KE', 'Kenya', false), ('SN', 'Senegal', false), ('CM', 'Cameroon', false)
on conflict (code) do nothing;

-- 2. prices in whole US dollars per month (Complete Market Entry is always quoted)
alter table plan_prices add column amount_usd int check (amount_usd > 0);
insert into plan_prices (key, amount_usd) values ('mfr_data', 199), ('mfr_access', 999)
on conflict (key) do update set amount_usd = coalesce(plan_prices.amount_usd, excluded.amount_usd);

-- manufacturer billing and badges (team or the worker only)
alter table manufacturer_profiles
  add column verified_at timestamptz,
  add column sample_product_id int references mfr_products(id) on delete set null,
  add column stripe_customer text,
  add column stripe_subscription text;
grant update (verified_at, sample_product_id) on manufacturer_profiles to nazryx_app;
create or replace function guard_mfr_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is not null and not app_is_team() and (new.status is distinct from old.status or new.team_note is distinct from old.team_note
       or new.reviewed_at is distinct from old.reviewed_at or new.active_plan is distinct from old.active_plan
       or new.active_since is distinct from old.active_since or new.verified_at is distinct from old.verified_at
       or new.stripe_customer is distinct from old.stripe_customer or new.stripe_subscription is distinct from old.stripe_subscription
       or (old.sample_product_id is not null and new.sample_product_id is distinct from old.sample_product_id)) then
    raise exception 'Only the Nazryx team can change this';
  end if;
  return new;
end $$;

-- payment events: written by the Stripe webhook (no signed-in user) or by the team (manual activation); the worker
-- applies them (plan on or off) and issues the documents
create table payment_events (
  id serial primary key,
  stripe_event_id text unique,
  kind text not null check (kind in ('checkout_completed', 'invoice_paid', 'subscription_ended', 'manual_activation')),
  user_id uuid references users(id) on delete set null,
  plan text check (plan in ('data', 'access', 'entry')),
  amount_cents int,
  currency text not null default 'usd',
  stripe_customer text,
  stripe_subscription text,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
alter table payment_events enable row level security;
create policy payment_events_insert on payment_events for insert with check (
  (app_uid() is null and kind <> 'manual_activation') or (app_is_team() and kind = 'manual_activation'));
create policy payment_events_read on payment_events for select using (user_id = app_uid() or app_is_team());
grant select, insert on payment_events to nazryx_app;
grant usage on sequence payment_events_id_seq to nazryx_app;

create table invoices (
  id serial primary key,
  number text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  plan text,
  amount_cents int,
  currency text not null default 'usd',
  status text not null check (status in ('paid', 'due')),
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  document_id int references account_documents(id) on delete set null
);
alter table invoices enable row level security;
create policy invoices_read on invoices for select using (user_id = app_uid() or app_is_team());
grant select on invoices to nazryx_app;

-- 3. launch tracker: each product per market, from chosen to launched
create table launches (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  product_id int not null references mfr_products(id) on delete cascade,
  country text not null references countries(code),
  stage text not null default 'selected' check (stage in ('selected', 'dossier', 'filed', 'approved', 'launched')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, country)
);
alter table launches enable row level security;
create policy launches_own on launches for all using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid() or app_is_team());
grant select, insert, update, delete on launches to nazryx_app;
grant usage on sequence launches_id_seq to nazryx_app;
create trigger audit_launches after insert or update on launches for each row execute function audit_team_change();

-- 4. market watch: changes in the caller's molecules in the given markets. Companies stay anonymous on this side.
create or replace function my_market_watch(p_countries text[], p_days int default 90)
returns table (change text, country text, molecule_id int, molecule text, made_in text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select h.change, r.country, r.molecule_id, m.inn, initcap(lower(r.manufacturing_country)), h.created_at
  from registration_history h
  join registrations r on r.id = h.registration_id
  join molecules m on m.id = r.molecule_id
  where h.created_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
    and r.country = any(p_countries)
    and (h.change in ('added', 'removed', 'reactivated') or (h.change = 'status' and (h.after->>'active')::boolean is false))
    and r.molecule_id in (select p.molecule_id from mfr_products p where p.user_id = app_uid() and p.molecule_id is not null)
  order by h.created_at desc
  limit 50
$$;
revoke all on function my_market_watch(text[], int) from public;
grant execute on function my_market_watch(text[], int) to nazryx_app;

create trigger audit_payment_events after insert on payment_events for each row execute function audit_team_change();
