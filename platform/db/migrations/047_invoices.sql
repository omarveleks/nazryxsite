-- Invoices with our own details on them, made automatically: one when a plan starts or is paid by card (as before),
-- one each billing period for invoiced plans, and any the team writes in Admin > Billing.
create table invoice_settings (
  id int primary key default 1 check (id = 1),
  issuer text not null default 'Nazryx, a company of Nazir & Company International (PVT) Limited',
  address text,
  tax_id text,
  email text not null default 'contact@nazryx.com',
  phone text,
  payment_details text,
  footer text,
  terms_days int not null default 14 check (terms_days between 0 and 120),
  prefix text not null default 'NZX' check (prefix ~ '^[A-Z0-9-]{1,10}$'),
  recurring boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into invoice_settings default values;
alter table invoice_settings enable row level security;
create policy invoice_settings_team on invoice_settings for all using (app_is_team()) with check (app_is_team());
grant select, update on invoice_settings to nazryx_app;

-- An invoice the team asked for; the worker writes it out and files it with the customer's documents
create table invoice_orders (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  lines jsonb not null,                       -- [{"text": ..., "qty": n, "unit_cents": n}]
  currency text not null default 'usd' check (currency in ('usd', 'eur', 'gbp')),
  note text,
  paid boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  number text,
  error text
);
alter table invoice_orders enable row level security;
create policy invoice_orders_team on invoice_orders for all using (app_is_team()) with check (app_is_team());
grant select, insert on invoice_orders to nazryx_app;
grant usage on sequence invoice_orders_id_seq to nazryx_app;

alter table invoices add column lines jsonb, add column paid_at timestamptz, add column interval_key text;
create policy invoices_team on invoices for update using (app_is_team()) with check (app_is_team());
grant update (status, paid_at) on invoices to nazryx_app;
