-- Review queues filled by each ingest run; the team works them on the admin page.

create table company_review_queue (
  a_key text not null, b_key text not null, similarity numeric, upload_id int,
  status text not null default 'open' check (status in ('open', 'merged', 'separate')),
  primary key (a_key, b_key)
);

create table molecule_suggestions (           -- suggested registry match for an unmatched essential molecule
  country text not null, molecule_id int not null references molecules(id) on delete cascade,
  suggested_molecule_id int references molecules(id) on delete cascade,
  confidence numeric, source text not null default 'fuzzy' check (source in ('fuzzy', 'claude')),
  reason text,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  primary key (country, molecule_id)
);

alter table company_review_queue enable row level security;
create policy crq_team on company_review_queue for all using (app_is_team()) with check (app_is_team());
grant select, update on company_review_queue to nazryx_app;

alter table molecule_suggestions enable row level security;
create policy msug_team on molecule_suggestions for all using (app_is_team()) with check (app_is_team());
grant select, update on molecule_suggestions to nazryx_app;
