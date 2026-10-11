-- 1. Focuses: what a customer wants from Nazryx, set during onboarding and editable in Settings.
create table user_focus (
  user_id uuid primary key references users(id) on delete cascade,
  classes text[] not null default '{}',             -- therapeutic classes they care about
  goals text[] not null default '{}',               -- expand_sales, new_molecules, new_suppliers, more_from_suppliers
  supplier_countries text[] not null default '{}',  -- where they prefer to source from
  levels text[] not null default '{}',              -- EML levels they sell into (A, B, C, D, S)
  updated_at timestamptz not null default now()
);
alter table user_focus enable row level security;
create policy focus_own on user_focus for all using (user_id = app_uid()) with check (user_id = app_uid());
create policy focus_team_read on user_focus for select using (app_is_team());
grant select, insert, update on user_focus to nazryx_app;

-- 2. Registration routes and their typical timelines, set by the team (paid feature on the molecule page).
create table registration_routes (
  key text primary key,
  label text not null,
  description text,
  months_low int check (months_low >= 0),
  months_high int check (months_high >= months_low),
  sort int not null default 0
);
insert into registration_routes (key, label, description, sort) values
  ('full', 'Full dossier', 'Complete CTD dossier assessed by TMDA.', 1),
  ('abridged', 'Abridged dossier', 'For products already approved by a stringent regulator or prequalified by WHO.', 2),
  ('eac', 'EAC joint assessment', 'Assessed jointly by East African Community regulators.', 3);
create table molecule_routes (                         -- a per-molecule override of the default route
  molecule_id int primary key references molecules(id) on delete cascade,
  route_key text not null references registration_routes(key),
  note text,
  updated_at timestamptz not null default now()
);
alter table registration_routes enable row level security;
create policy routes_read on registration_routes for select using (true);
create policy routes_team_write on registration_routes for update using (app_is_team()) with check (app_is_team());
alter table molecule_routes enable row level security;
create policy molecule_routes_paid_read on molecule_routes for select using (app_plan() = 'paid' or app_is_team());
create policy molecule_routes_team_write on molecule_routes for all using (app_is_team()) with check (app_is_team());
grant select, update on registration_routes to nazryx_app;
grant select, insert, update, delete on molecule_routes to nazryx_app;
create trigger audit_registration_routes after insert or update on registration_routes for each row execute function audit_team_change();
create trigger audit_molecule_routes after insert or update on molecule_routes for each row execute function audit_team_change();

-- 3. Ask the expert: a short question to the team, optionally about one molecule. Free plans get 3 a month.
create table expert_questions (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  molecule_id int references molecules(id) on delete set null,
  body text not null,
  answer text,
  answered_by uuid,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
create index expert_questions_open on expert_questions (created_at) where answered_at is null;
alter table expert_questions enable row level security;
create policy questions_read on expert_questions for select using (user_id = app_uid() or app_is_team());
create policy questions_insert on expert_questions for insert with check (user_id = app_uid() and answer is null);
create policy questions_team_answer on expert_questions for update using (app_is_team()) with check (app_is_team());
grant select, insert on expert_questions to nazryx_app;
grant update (answer, answered_by, answered_at) on expert_questions to nazryx_app;
grant usage on sequence expert_questions_id_seq to nazryx_app;

create or replace function limit_expert_questions() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if app_is_team() or coalesce(app_plan(), 'free') = 'paid' then return new; end if;
  select count(*) into n from expert_questions where user_id = new.user_id and created_at > now() - interval '30 days';
  if n >= 3 then raise exception 'Free plan: 3 questions a month. Upgrade for unlimited questions.'; end if;
  return new;
end $$;
create trigger expert_questions_limit before insert on expert_questions for each row execute function limit_expert_questions();
create trigger audit_expert_questions after update on expert_questions for each row execute function audit_team_change();
