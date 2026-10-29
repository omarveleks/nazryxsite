-- Market entry projects: one per product and market, with stages, tasks, deadlines and an owner. Launches become
-- projects; obligations and engagements attach to them. Plus the calendar's own entries and API keys for the read API.

create table projects (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  product_id int not null references mfr_products(id) on delete cascade,
  country text not null references countries(code),
  stage text not null default 'assess' check (stage in ('assess', 'dossier', 'submitted', 'approved', 'distributor', 'launched', 'parked')),
  owner_id uuid references users(id) on delete set null,       -- a seat on the account
  target_date date,                                            -- when they want to be on the shelf
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, country)
);
alter table projects enable row level security;
-- the account and its seats share projects; the team reads all
create policy projects_own on projects for all
  using (user_id = app_uid() or user_id = (select owner_id from users where id = app_uid()) or app_is_team())
  with check (user_id = app_uid() or user_id = (select owner_id from users where id = app_uid()));
grant select, insert, update, delete on projects to nazryx_app;
grant usage on sequence projects_id_seq to nazryx_app;

create table project_tasks (
  id serial primary key,
  project_id int not null references projects(id) on delete cascade,
  title text not null,
  stage text,                                                  -- the stage it belongs to, if any
  due_date date,
  done_at timestamptz,
  assignee_id uuid references users(id) on delete set null,
  source text not null default 'manual',                       -- manual, checklist, nazryx
  created_at timestamptz not null default now()
);
alter table project_tasks enable row level security;
create policy project_tasks_own on project_tasks for all
  using (exists (select 1 from projects p where p.id = project_id))
  with check (exists (select 1 from projects p where p.id = project_id));
grant select, insert, update, delete on project_tasks to nazryx_app;
grant usage on sequence project_tasks_id_seq to nazryx_app;

-- an engagement (a Nazryx service) can belong to a project stage
alter table engagements add column if not exists project_id int references projects(id) on delete set null;
alter table obligations add column if not exists project_id int references projects(id) on delete set null;

-- every launch tracker entry becomes a project at the matching stage
insert into projects (user_id, product_id, country, stage, created_at, updated_at)
select l.user_id, l.product_id, l.country,
       case l.stage when 'selected' then 'assess' when 'dossier' then 'dossier' when 'filed' then 'submitted' when 'approved' then 'approved' when 'launched' then 'launched' else 'assess' end,
       l.created_at, l.updated_at
from launches l on conflict (product_id, country) do nothing;

-- the calendar: the manufacturer's own dates (a GMP expiry, a board meeting, a distributor visit) next to the ones we track
create table calendar_entries (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  on_date date not null,
  kind text not null default 'own' check (kind in ('own', 'gmp_expiry', 'registration_expiry', 'meeting')),
  country text references countries(code),
  product_id int references mfr_products(id) on delete cascade,
  project_id int references projects(id) on delete cascade,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);
alter table calendar_entries enable row level security;
create policy calendar_entries_own on calendar_entries for all
  using (user_id = app_uid() or user_id = (select owner_id from users where id = app_uid()) or app_is_team())
  with check (user_id = app_uid() or user_id = (select owner_id from users where id = app_uid()));
grant select, insert, update, delete on calendar_entries to nazryx_app;
grant usage on sequence calendar_entries_id_seq to nazryx_app;

-- the read API: keys are stored hashed; the plain key is shown once
create table api_keys (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  prefix text not null,                                        -- the first 8 characters, to recognise it in the list
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table api_keys enable row level security;
create policy api_keys_own on api_keys for all using (user_id = app_uid()) with check (user_id = app_uid());
grant select, insert, update, delete on api_keys to nazryx_app;
grant usage on sequence api_keys_id_seq to nazryx_app;

-- the API resolves a key to its account without a session (security definer, by hash only)
create or replace function api_key_user(p_hash text) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from api_keys where key_hash = p_hash and revoked_at is null
$$;
revoke all on function api_key_user(text) from public;
grant execute on function api_key_user(text) to nazryx_app;
create or replace function api_key_touch(p_hash text) returns void
language sql security definer set search_path = public as $$
  update api_keys set last_used_at = now() where key_hash = p_hash
$$;
revoke all on function api_key_touch(text) from public;
grant execute on function api_key_touch(text) to nazryx_app;

-- the global search: molecules, companies (by code, and by name where the plan allows), tenders and the account's products
create or replace function search_all(p_q text, p_countries text[])
returns table (kind text, id text, label text, sub text, country text)
language sql stable security definer set search_path = public as $$
  with q as (select lower(trim(p_q)) as q)
  (select 'molecule', m.id::text, m.inn, m.category, null::text from molecules m, q
     where m.inn ilike '%' || q.q || '%' and exists (select 1 from country_molecules cm where cm.molecule_id = m.id and cm.country = any(p_countries))
     order by (lower(m.inn) = q.q) desc, position(q.q in lower(m.inn)), m.inn limit 6)
  union all
  (select 'product', p.id::text, p.name, coalesce(m.inn, ''), null from mfr_products p left join molecules m on m.id = p.molecule_id, q
     where p.user_id = app_uid() and (p.name ilike '%' || q.q || '%' or m.inn ilike '%' || q.q || '%') order by p.name limit 4)
  union all
  (select 'company', partner_code(c.id), case when app_is_team() or mfr_tier_in(s.country) >= 2 then c.display_name else 'Distributor ' || partner_code(c.id) end,
          s.registrations || ' products', s.country
     from companies c join company_stats s on s.company_id = c.id, q
     where s.country = any(p_countries) and c.merged_into is null
       and (upper(partner_code(c.id)) = upper(q.q) or ((app_is_team() or mfr_tier_in(s.country) >= 2) and c.display_name ilike '%' || q.q || '%'))
     order by s.registrations desc limit 5)
  union all
  (select 'tender', t.id::text, coalesce(t.title_en, t.title), coalesce(t.buyer_en, t.buyer, ''), t.country from tenders t, q
     where t.country = any(p_countries) and (t.ref ilike '%' || q.q || '%' or coalesce(t.title_en, t.title) ilike '%' || q.q || '%')
     order by coalesce(t.awarded, t.closing, t.published) desc nulls last limit 5)
$$;
revoke all on function search_all(text, text[]) from public;
grant execute on function search_all(text, text[]) to nazryx_app;

-- reminders a week before a date land in the inbox as their own kind
alter table inbox_items drop constraint inbox_items_kind_check;
alter table inbox_items add constraint inbox_items_kind_check
  check (kind in ('registration', 'competitor', 'tender', 'price', 'regulatory', 'notice', 'system', 'opportunity', 'deadline'));
