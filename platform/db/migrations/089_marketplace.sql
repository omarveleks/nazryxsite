-- The marketplace: distributors sign up free and post needs; manufacturers see an RFQ board (needs plus open tenders),
-- raise a hand, and talk to the distributor in a thread the Nazryx team can join; a catalogue of fixed-price services
-- attached to project stages.

-- ---------------------------------------------------------------- distributors
create table distributor_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  company_name text not null,
  country text not null references countries(code),
  markets text[] not null default '{}',
  categories text[] not null default '{}',
  about text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table distributor_profiles enable row level security;
create policy dist_own on distributor_profiles for all using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid());
grant select, insert on distributor_profiles to nazryx_app;
grant update (company_name, country, markets, categories, about) on distributor_profiles to nazryx_app;
-- the team verifies a distributor
create or replace function set_distributor_verified(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_team() then raise exception 'not allowed'; end if;
  update distributor_profiles set verified_at = case when p_on then now() else null end where user_id = p_user;
end $$;
revoke all on function set_distributor_verified(uuid, boolean) from public;
grant execute on function set_distributor_verified(uuid, boolean) to nazryx_app;

-- ---------------------------------------------------------------- needs: the RFQ board
create table needs (
  id serial primary key,
  user_id uuid references users(id) on delete cascade,      -- the distributor; null for a need read from a tender
  source text not null default 'distributor' check (source in ('distributor', 'tender')),
  tender_id int unique references tenders(id) on delete cascade,
  country text not null references countries(code),
  molecule_id int references molecules(id) on delete set null,
  molecule_text text,
  dosage_form text,
  quantity text,
  target_price text,
  deliver_by date,
  note text,
  status text not null default 'open' check (status in ('open', 'matched', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index needs_open on needs (status, country, molecule_id);
alter table needs enable row level security;
create policy needs_own on needs for all using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid());
grant select, insert on needs to nazryx_app;
grant update (molecule_text, dosage_form, quantity, target_price, deliver_by, note, status, updated_at) on needs to nazryx_app;
grant usage on sequence needs_id_seq to nazryx_app;

-- a manufacturer raises a hand on a need; one thread per need and manufacturer account
create table leads (
  id serial primary key,
  need_id int not null references needs(id) on delete cascade,
  maker_id uuid not null references users(id) on delete cascade,     -- the manufacturer account (owner)
  created_at timestamptz not null default now(),
  unique (need_id, maker_id)
);
alter table leads enable row level security;
create policy leads_parties on leads for select using (maker_id = app_account() or app_is_team()
  or exists (select 1 from needs n where n.id = leads.need_id and n.user_id = app_uid()));
grant select on leads to nazryx_app;

-- ---------------------------------------------------------------- threads: the two sides talk; the team can step in
create table threads (
  id serial primary key,
  need_id int references needs(id) on delete set null,
  maker_id uuid references users(id) on delete cascade,     -- manufacturer account
  dist_id uuid references users(id) on delete cascade,      -- distributor account
  subject text not null,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  maker_seen_at timestamptz,
  dist_seen_at timestamptz,
  team_seen_at timestamptz
);
create index threads_maker on threads (maker_id, last_at desc);
create index threads_dist on threads (dist_id, last_at desc);
alter table threads enable row level security;
create policy threads_parties on threads for select using (maker_id = app_account() or dist_id = app_uid() or app_is_team());
grant select on threads to nazryx_app;

create table thread_messages (
  id serial primary key,
  thread_id int not null references threads(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  from_team boolean not null default false,
  body text not null,
  created_at timestamptz not null default now()
);
create index thread_messages_thread on thread_messages (thread_id, id);
alter table thread_messages enable row level security;
create policy thread_messages_parties on thread_messages for select using (
  exists (select 1 from threads t where t.id = thread_messages.thread_id and (t.maker_id = app_account() or t.dist_id = app_uid() or app_is_team())));
grant select on thread_messages to nazryx_app;

alter table inbox_items drop constraint inbox_items_kind_check;
alter table inbox_items add constraint inbox_items_kind_check
  check (kind in ('registration', 'competitor', 'tender', 'price', 'regulatory', 'notice', 'system', 'opportunity', 'deadline', 'mention', 'message', 'lead'));

-- the board a manufacturer sees: open needs on its markets, the poster shown as "a distributor in X", never by name
create or replace function rfq_board(p_countries text[])
returns table (id int, source text, tender_id int, country text, molecule_id int, molecule text, dosage_form text, quantity text,
               target_price text, deliver_by date, note text, created_at timestamptz, verified boolean, leads int, mine boolean, thread_id int)
language sql stable security definer set search_path = public as $$
  select n.id, n.source, n.tender_id, n.country, n.molecule_id, coalesce(m.inn, n.molecule_text), n.dosage_form, n.quantity, n.target_price,
         n.deliver_by, n.note, n.created_at,
         exists (select 1 from distributor_profiles d where d.user_id = n.user_id and d.verified_at is not null),
         (select count(*)::int from leads l where l.need_id = n.id),
         exists (select 1 from leads l where l.need_id = n.id and l.maker_id = app_account()),
         (select t.id from threads t where t.need_id = n.id and t.maker_id = app_account() limit 1)
  from needs n left join molecules m on m.id = n.molecule_id
  where n.status = 'open' and (p_countries is null or n.country = any(p_countries))
  order by n.created_at desc limit 300
$$;
revoke all on function rfq_board(text[]) from public;
grant execute on function rfq_board(text[]) to nazryx_app;

-- a manufacturer raises a hand: the lead, the thread and a first message; the distributor hears about it
create or replace function raise_hand(p_need int, p_body text) returns int
language plpgsql security definer set search_path = public as $$
declare n needs; acct uuid := app_account(); t int; who text;
begin
  select * into n from needs where id = p_need and status = 'open';
  if n.id is null then raise exception 'This need is closed.'; end if;
  if not exists (select 1 from users where id = acct and account_type = 'manufacturer') then raise exception 'not allowed'; end if;
  select t2.id into t from threads t2 where t2.need_id = p_need and t2.maker_id = acct;
  if t is null then
    insert into leads (need_id, maker_id) values (p_need, acct) on conflict do nothing;
    select coalesce(p.company_name, u.name) into who from users u left join manufacturer_profiles p on p.user_id = u.id where u.id = acct;
    insert into threads (need_id, maker_id, dist_id, subject) values (p_need, acct, n.user_id, coalesce((select inn from molecules where id = n.molecule_id), n.molecule_text, 'Request') || ' · ' || n.country)
      returning id into t;
    if n.user_id is not null then
      insert into inbox_items (user_id, kind, title, body, link, key) values (n.user_id, 'lead', who || ' can supply this', left(p_body, 200), '/d/threads/' || t, 'lead:' || t);
    end if;
  end if;
  insert into thread_messages (thread_id, author_id, from_team, body) values (t, app_uid(), false, p_body);
  update threads set last_at = now(), maker_seen_at = now() where id = t;
  return t;
end $$;
revoke all on function raise_hand(int, text) from public;
grant execute on function raise_hand(int, text) to nazryx_app;

-- a distributor writes to a manufacturer with a public page
create or replace function contact_maker(p_slug text, p_body text) returns int
language plpgsql security definer set search_path = public as $$
declare maker uuid; t int; dist uuid := app_uid(); who text;
begin
  select p.user_id into maker from manufacturer_profiles p join users u on u.id = p.user_id
    where p.public_profile and p.public_slug = lower(p_slug) and p.status = 'approved' and not u.disabled;
  if maker is null then raise exception 'No such manufacturer.'; end if;
  if not exists (select 1 from distributor_profiles where user_id = dist) then raise exception 'Complete your distributor profile first.'; end if;
  select t2.id into t from threads t2 where t2.maker_id = maker and t2.dist_id = dist and t2.need_id is null;
  if t is null then
    select company_name into who from distributor_profiles where user_id = dist;
    insert into threads (maker_id, dist_id, subject) values (maker, dist, who) returning id into t;
    insert into inbox_items (user_id, kind, title, body, link, key) values (maker, 'message', who || ' wrote to you', left(p_body, 200), '/m/threads/' || t, 'thread:' || t);
  end if;
  insert into thread_messages (thread_id, author_id, from_team, body) values (t, dist, false, p_body);
  update threads set last_at = now(), dist_seen_at = now() where id = t;
  return t;
end $$;
revoke all on function contact_maker(text, text) from public;
grant execute on function contact_maker(text, text) to nazryx_app;

-- anyone in the thread posts; the other side gets one inbox item per thread until they read it
create or replace function thread_post(p_thread int, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare t threads; me uuid := app_uid(); acct uuid := app_account(); team boolean := app_is_team(); other uuid; who text; href text;
begin
  select * into t from threads where id = p_thread;
  if t.id is null or not (team or t.maker_id = acct or t.dist_id = me) then raise exception 'not allowed'; end if;
  insert into thread_messages (thread_id, author_id, from_team, body) values (p_thread, me, team, p_body);
  if team then
    update threads set last_at = now(), team_seen_at = now() where id = p_thread;
    who := 'Nazryx';
  elsif t.maker_id = acct then
    update threads set last_at = now(), maker_seen_at = now() where id = p_thread;
    select coalesce(p.company_name, u.name) into who from users u left join manufacturer_profiles p on p.user_id = u.id where u.id = acct;
  else
    update threads set last_at = now(), dist_seen_at = now() where id = p_thread;
    select coalesce(d.company_name, u.name) into who from users u left join distributor_profiles d on d.user_id = u.id where u.id = me;
  end if;
  -- tell whoever is on the other side (both sides when the team writes)
  for other, href in
    select t.maker_id, '/m/threads/' || p_thread where t.maker_id is not null and t.maker_id <> acct
    union all select t.dist_id, '/d/threads/' || p_thread where t.dist_id is not null and t.dist_id <> me
  loop
    insert into inbox_items (user_id, kind, title, body, link, key) values (other, 'message', who || ': ' || left(t.subject, 60), left(p_body, 200), href, 'thread:' || p_thread || ':' || other)
      on conflict (user_id, key) do update set title = excluded.title, body = excluded.body, created_at = now(), read_at = null;
  end loop;
end $$;
revoke all on function thread_post(int, text) from public;
grant execute on function thread_post(int, text) to nazryx_app;

create or replace function thread_seen(p_thread int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app_is_team() then update threads set team_seen_at = now() where id = p_thread;
  elsif exists (select 1 from threads where id = p_thread and maker_id = app_account()) then update threads set maker_seen_at = now() where id = p_thread;
  else update threads set dist_seen_at = now() where id = p_thread and dist_id = app_uid(); end if;
  update inbox_items set read_at = now() where user_id = app_uid() and key like 'thread:' || p_thread || ':%' and read_at is null;
end $$;
revoke all on function thread_seen(int) from public;
grant execute on function thread_seen(int) to nazryx_app;

-- what each side sees of the other: a company name and a trust mark, never an email
create or replace function thread_list()
returns table (id int, need_id int, subject text, last_at timestamptz, unread boolean, other_name text, other_verified boolean, other_side text, country text, last_body text)
language sql stable security definer set search_path = public as $$
  select t.id, t.need_id, t.subject, t.last_at,
         case when app_is_team() then t.team_seen_at is null or t.team_seen_at < t.last_at
              when t.maker_id = app_account() then t.maker_seen_at is null or t.maker_seen_at < t.last_at
              else t.dist_seen_at is null or t.dist_seen_at < t.last_at end,
         case when t.maker_id = app_account() and not app_is_team() then coalesce(d.company_name, 'A distributor')
              else coalesce(mp.company_name, 'A manufacturer') || case when app_is_team() and d.company_name is not null then ' · ' || d.company_name else '' end end,
         case when t.maker_id = app_account() and not app_is_team() then d.verified_at is not null else mp.verified_at is not null end,
         case when t.maker_id = app_account() and not app_is_team() then 'distributor' else 'manufacturer' end,
         n.country,
         (select left(m.body, 120) from thread_messages m where m.thread_id = t.id order by m.id desc limit 1)
  from threads t left join needs n on n.id = t.need_id
       left join distributor_profiles d on d.user_id = t.dist_id left join manufacturer_profiles mp on mp.user_id = t.maker_id
  where t.maker_id = app_account() or t.dist_id = app_uid() or app_is_team()
  order by t.last_at desc limit 200
$$;
revoke all on function thread_list() from public;
grant execute on function thread_list() to nazryx_app;

create or replace function thread_messages_of(p_thread int)
returns table (id int, body text, created_at timestamptz, from_team boolean, mine boolean, who text)
language sql stable security definer set search_path = public as $$
  select m.id, m.body, m.created_at, m.from_team,
         m.author_id = app_uid() or (not m.from_team and exists (select 1 from users a where a.id = m.author_id and coalesce(a.owner_id, a.id) = app_account())),
         case when m.from_team then 'Nazryx'
              when exists (select 1 from users a where a.id = m.author_id and coalesce(a.owner_id, a.id) = t.maker_id) then coalesce(mp.company_name, 'Manufacturer')
              else coalesce(d.company_name, 'Distributor') end
  from thread_messages m join threads t on t.id = m.thread_id
       left join distributor_profiles d on d.user_id = t.dist_id left join manufacturer_profiles mp on mp.user_id = t.maker_id
  where m.thread_id = p_thread and (t.maker_id = app_account() or t.dist_id = app_uid() or app_is_team())
  order by m.id
$$;
revoke all on function thread_messages_of(int) from public;
grant execute on function thread_messages_of(int) to nazryx_app;

-- ---------------------------------------------------------------- the service catalogue
create table service_catalog (
  code text primary key,
  title text not null,
  what text not null,
  stage text not null,                 -- the project stage it belongs to
  provider text not null default 'Nazryx',
  price_usd numeric,                   -- null: quoted on request
  days int,
  engagement_kind text not null,       -- which engagement it opens
  active boolean not null default true,
  sort int not null default 100
);
grant select on service_catalog to nazryx_app;
grant update (title, what, price_usd, days, provider, active) on service_catalog to nazryx_app;
insert into service_catalog (code, title, what, stage, provider, price_usd, days, engagement_kind, sort) values
  ('market_read', 'Market read', 'The market for one product in one country: prices, who sells it, who registers it, the route in. A written read in 24 hours.', 'assess', 'Nazryx', null, 1, 'report', 10),
  ('gap_check', 'Dossier gap check', 'We read your CTD against the market’s checklist and list what is missing, in order of effort.', 'dossier', 'Nazryx', null, 5, 'dossier_review', 20),
  ('dossier_review', 'Full dossier review', 'Module by module, with the fixes written up so your team can close them.', 'dossier', 'Nazryx', null, 15, 'dossier_review', 21),
  ('translation', 'Certified translation', 'Labels, leaflets and summaries into the market’s language, by a vetted pharma translator.', 'dossier', 'Vetted partner', null, 10, 'dossier_review', 22),
  ('local_rep', 'Local representative', 'A local technical representative and registration holder in your name.', 'submitted', 'Nazryx', null, 30, 'local_rep', 30),
  ('submission', 'Submission and follow-up', 'We file, answer the regulator’s questions and keep the clock moving until the certificate is out.', 'submitted', 'Nazryx', null, null, 'market_entry', 31),
  ('partner_intro', 'Distributor introduction', 'A shortlist, our introduction and a first meeting with the right distributor.', 'distributor', 'Nazryx', null, 21, 'partner_intro', 40),
  ('launch', 'Launch with the distributor', 'Pricing, the first order, the launch plan with the distributor’s sales team.', 'launched', 'Nazryx', null, 60, 'market_entry', 50),
  ('post_registration', 'Post-registration', 'Renewals, variations and safety reporting kept on time for you.', 'launched', 'Nazryx', null, null, 'post_registration', 51);

-- ---------------------------------------------------------------- needs read from open tenders (the worker keeps this up)
create or replace function needs_from_tenders() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into needs (source, tender_id, country, molecule_id, molecule_text, quantity, deliver_by, note, created_at)
  select 'tender', t.id, t.country, t.molecule_ids[1], coalesce(t.title_en, t.title), t.quantity, t.closing, coalesce(t.buyer_en, t.buyer), coalesce(t.published, now())
  from tenders t where t.closing >= current_date and coalesce(array_length(t.molecule_ids, 1), 0) > 0
    and not exists (select 1 from needs n where n.tender_id = t.id);
  get diagnostics n = row_count;
  update needs set status = 'closed', updated_at = now() where source = 'tender' and status = 'open'
    and tender_id in (select id from tenders where closing < current_date);
  return n;
end $$;
