-- Teams: seat roles, comments with mentions on products and projects, read-only share links; the activity feed; the Ask log.

alter table users add column if not exists seat_role text check (seat_role in ('owner', 'regulatory', 'sales', 'viewer'));
update users set seat_role = 'owner' where owner_id is null and seat_role is null and account_type = 'manufacturer';

-- the owner sets a seat's role (seats cannot change their own); viewers read, the rest write
create or replace function set_seat_role(p_seat uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_role not in ('regulatory', 'sales', 'viewer') then raise exception 'Pick regulatory, sales or viewer.'; end if;
  if not exists (select 1 from users where id = p_seat and owner_id = app_uid()) then raise exception 'not allowed'; end if;
  update users set seat_role = p_role where id = p_seat;
end $$;
revoke all on function set_seat_role(uuid, text) from public;
grant execute on function set_seat_role(uuid, text) to nazryx_app;
create or replace function remove_seat(p_seat uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from users where id = p_seat and owner_id = app_uid()) then raise exception 'not allowed'; end if;
  update users set disabled = true where id = p_seat;
end $$;
revoke all on function remove_seat(uuid) from public;
grant execute on function remove_seat(uuid) to nazryx_app;

-- the account an actor works in (the owner's id), so seats and owner share everything
create or replace function app_account() returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(owner_id, id) from users where id = app_uid()
$$;
grant execute on function app_account() to nazryx_app;

create table comments (
  id serial primary key,
  account_id uuid not null references users(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  target_kind text not null check (target_kind in ('project', 'product', 'molecule', 'tender', 'company')),
  target_id text not null,
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index on comments (account_id, target_kind, target_id);
alter table comments enable row level security;
create policy comments_account on comments for all using (account_id = app_account() or app_is_team()) with check (account_id = app_account());
grant select, insert, delete on comments to nazryx_app;
grant usage on sequence comments_id_seq to nazryx_app;

-- read-only links for the person who signs: a project, with its tasks and checklist
create table share_links (
  token text primary key,
  account_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('project')),
  target_id text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz
);
alter table share_links enable row level security;
create policy share_links_account on share_links for all using (account_id = app_account() or app_is_team()) with check (account_id = app_account());
grant select, insert, update on share_links to nazryx_app;

-- the shared view, by token, without a session: the project, its tasks and its checklist state
create or replace function shared_project(p_token text)
returns table (name text, country text, stage text, target_date date, note text, company text, tasks jsonb, checklist jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(m.inn, p.name), pr.country, pr.stage, pr.target_date, pr.note, mp.company_name,
         (select coalesce(jsonb_agg(jsonb_build_object('title', k.title, 'done', k.done_at is not null, 'due', k.due_date, 'stage', k.stage) order by k.done_at nulls first, k.id), '[]'::jsonb) from project_tasks k where k.project_id = pr.id),
         (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'ready', exists (select 1 from product_checklist x where x.product_id = pr.product_id and x.country = pr.country and x.item = c.name)) order by c.sort), '[]'::jsonb)
            from reg_checklist c where c.country = pr.country and c.scope = 'medicine'),
         pr.updated_at
  from share_links s join projects pr on pr.id = s.target_id::int join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id
  left join manufacturer_profiles mp on mp.user_id = pr.user_id
  where s.token = p_token and s.kind = 'project' and s.revoked_at is null and s.expires_at > now()
$$;
revoke all on function shared_project(text) from public;
grant execute on function shared_project(text) to nazryx_app;

-- the activity feed: what moved in the account, by whom, newest first
create or replace function account_activity(p_limit int default 100)
returns table (at timestamptz, actor text, kind text, title text, href text)
language sql stable security definer set search_path = public as $$
  (select c.created_at, coalesce(a.name, a.email), 'comment', left(c.body, 140),
          case c.target_kind when 'project' then '/m/projects/' || c.target_id when 'product' then '/m/products/' || c.target_id when 'molecule' then '/m/molecules/' || c.target_id when 'tender' then '/m/tenders/' || c.target_id else '/m/companies/' || c.target_id end
     from comments c left join users a on a.id = c.author_id where c.account_id = app_account())
  union all
  (select k.done_at, null, 'task', k.title || ' · ' || coalesce(m.inn, p.name), '/m/projects/' || pr.id from project_tasks k join projects pr on pr.id = k.project_id
     join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id where pr.user_id = app_account() and k.done_at is not null)
  union all
  (select pr.updated_at, coalesce(o.name, o.email), 'project', coalesce(m.inn, p.name) || ' · ' || pr.country || ' · ' || pr.stage, '/m/projects/' || pr.id from projects pr
     join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id left join users o on o.id = pr.owner_id where pr.user_id = app_account())
  union all
  (select f.created_at, coalesce(a.name, a.email), 'file', f.file_name || ' · ' || f.item, '/m/products/' || f.product_id || '/dossier?market=' || f.country from dossier_files f left join users a on a.id = f.uploaded_by where f.user_id = app_account())
  union all
  (select e.updated_at, null, 'nazryx', e.kind || ' · ' || e.stage, '/m/engagements/' || e.id from engagements e where e.user_id = app_account())
  union all
  (select p.created_at, null, 'product', p.name, '/m/products/' || p.id from mfr_products p where p.user_id = app_account())
  order by 1 desc nulls last limit p_limit
$$;
revoke all on function account_activity(int) from public;
grant execute on function account_activity(int) to nazryx_app;

-- Ask Nazryx: every question and answer kept, with the pages it cited
create table ask_log (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  question text not null,
  answer text,
  cites jsonb not null default '[]',
  tools int not null default 0,
  ms int,
  created_at timestamptz not null default now()
);
alter table ask_log enable row level security;
create policy ask_log_own on ask_log for all using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid());
grant select, insert on ask_log to nazryx_app;
grant usage on sequence ask_log_id_seq to nazryx_app;

-- a mention lands in the mentioned seat's inbox
alter table inbox_items drop constraint inbox_items_kind_check;
alter table inbox_items add constraint inbox_items_kind_check
  check (kind in ('registration', 'competitor', 'tender', 'price', 'regulatory', 'notice', 'system', 'opportunity', 'deadline', 'mention'));
grant insert on inbox_items to nazryx_app;
