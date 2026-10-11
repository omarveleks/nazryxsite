-- 1. Dossier readiness: what the supplier's registration dossier holds, item by item, and whether a
--    bioequivalence (BE) study is needed. The team fills it in; the request's owner reads it.
create table dossier_items (
  request_id int not null references requests(id) on delete cascade,
  item text not null,
  status text not null check (status in ('have', 'missing', 'not_needed')),
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (request_id, item)
);
alter table dossier_items enable row level security;
create policy dossier_read on dossier_items for select using (exists (select 1 from requests r where r.id = request_id));
create policy dossier_team_write on dossier_items for all using (app_is_team()) with check (app_is_team());
grant select, insert, update, delete on dossier_items to nazryx_app;

create table request_dossier (
  request_id int primary key references requests(id) on delete cascade,
  be_status text check (be_status in ('needed', 'biowaiver', 'not_needed')),
  be_note text,
  updated_at timestamptz not null default now()
);
alter table request_dossier enable row level security;
create policy request_dossier_read on request_dossier for select using (exists (select 1 from requests r where r.id = request_id));
create policy request_dossier_team_write on request_dossier for all using (app_is_team()) with check (app_is_team());
grant select, insert, update on request_dossier to nazryx_app;

-- 2. Terms on every quote, visible before accepting (the supplier stays anonymous until then).
alter table quotes add column payment_terms text;                  -- e.g. "30% deposit, 70% before shipment"
alter table quotes add column shelf_life_pct int check (shelf_life_pct between 0 and 100);   -- minimum remaining on arrival
alter table quotes add column gmp_by text;                         -- who certified GMP: WHO PQ, stringent regulator, TMDA ...
alter table quotes add column supplier_type text check (supplier_type in ('manufacturer', 'trader'));
alter table quotes add column exclusive boolean not null default false;

-- 3. Shipments follow the import route, with the documents each consignment needs.
alter table orders drop constraint if exists orders_status_check;
update orders set status = 'Shipped' where status = 'In transit';
alter table orders add constraint orders_status_check check (status in
  ('Confirming', 'In production', 'Import permit', 'Shipped', 'Arrived', 'Sampling and release', 'Delivered', 'Cancelled'));
alter table orders add column eta date;
grant update (status, updated_at, eta) on orders to nazryx_app;

create table shipment_documents (
  order_id int not null references orders(id) on delete cascade,
  doc text not null,
  ready boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (order_id, doc)
);
alter table shipment_documents enable row level security;
create policy shipment_docs_read on shipment_documents for select using (exists (select 1 from orders o where o.id = order_id));
create policy shipment_docs_team_write on shipment_documents for all using (app_is_team()) with check (app_is_team());
grant select, insert, update, delete on shipment_documents to nazryx_app;

create trigger audit_request_dossier after insert or update on request_dossier for each row execute function audit_team_change();
create trigger audit_dossier_items after insert or update on dossier_items for each row execute function audit_team_change();
create trigger audit_shipment_documents after insert or update on shipment_documents for each row execute function audit_team_change();
