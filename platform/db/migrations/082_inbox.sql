-- The inbox: what moved in a manufacturer's markets and on its molecules while it was away. The worker (inbox.py)
-- writes one item per event every hour; the page shows them newest first and marks them read; a daily email sums up
-- the unread ones. Watches: molecules (watches) and companies (follows) exist; tender keywords are new.
create table inbox_items (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('registration', 'competitor', 'tender', 'price', 'regulatory', 'notice', 'system')),
  country text,
  molecule_id int references molecules(id) on delete cascade,
  title text not null,
  body text,
  link text,
  key text,                                  -- one item per event per user: 'reg:123', 'tender:456', 'price:KE:7:2026-10-29'
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, key)
);
create index inbox_items_user on inbox_items (user_id, read_at, created_at desc);
alter table inbox_items enable row level security;
create policy inbox_items_own on inbox_items for select using (user_id = app_uid() or app_is_team());
create policy inbox_items_read on inbox_items for update using (user_id = app_uid()) with check (user_id = app_uid());
grant select, update (read_at) on inbox_items to nazryx_app;

create table tender_watches (
  user_id uuid not null references users(id) on delete cascade,
  term text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, term)
);
alter table tender_watches enable row level security;
create policy tender_watches_own on tender_watches for all using (user_id = app_uid()) with check (user_id = app_uid());
grant select, insert, delete on tender_watches to nazryx_app;

alter table manufacturer_profiles add column inbox_checked_at timestamptz, add column inbox_mailed_at timestamptz;
