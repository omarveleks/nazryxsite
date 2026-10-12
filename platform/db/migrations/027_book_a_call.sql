-- Book a call: the team's weekly hours (in the team's time zone) and the calls customers book in them. One booking per
-- slot; customers see only that a slot is taken, never who took it.

create table call_settings (
  id int primary key default 1 check (id = 1),
  timezone text not null default 'UTC',            -- the team sets its own in Admin > Calls
  slot_minutes int not null default 30 check (slot_minutes in (15, 20, 30, 45, 60)),
  days_ahead int not null default 14 check (days_ahead between 1 and 60),
  min_notice_hours int not null default 12 check (min_notice_hours between 0 and 168),
  updated_at timestamptz not null default now()
);
insert into call_settings (id) values (1);

create table call_hours (
  id serial primary key,
  weekday int not null check (weekday between 0 and 6),          -- 0 = Sunday
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  check (end_min > start_min)
);
-- a sensible start: Monday to Friday, 10:00 to 17:00 team time
insert into call_hours (weekday, start_min, end_min) select d, 600, 1020 from generate_series(1, 5) d;

create table call_bookings (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  starts_at timestamptz not null,
  minutes int not null default 30,
  topic text,
  note text,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'done')),
  meeting_link text,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index call_bookings_one_per_slot on call_bookings (starts_at) where status = 'booked';
create index call_bookings_user on call_bookings (user_id, starts_at desc);

alter table call_settings enable row level security;
create policy call_settings_read on call_settings for select using (app_uid() is not null);
create policy call_settings_team on call_settings for update using (app_is_team()) with check (app_is_team());
grant select, update on call_settings to nazryx_app;

alter table call_hours enable row level security;
create policy call_hours_read on call_hours for select using (app_uid() is not null);
create policy call_hours_team on call_hours for all using (app_is_team()) with check (app_is_team());
grant select, insert, update, delete on call_hours to nazryx_app;
grant usage on sequence call_hours_id_seq to nazryx_app;

alter table call_bookings enable row level security;
create policy call_bookings_read on call_bookings for select using (user_id = app_uid() or app_is_team());
create policy call_bookings_insert on call_bookings for insert with check (
  user_id = app_uid() and status = 'booked' and meeting_link is null and starts_at > now());
create policy call_bookings_update on call_bookings for update using (user_id = app_uid() or app_is_team()) with check (user_id = app_uid() or app_is_team());
grant select, insert on call_bookings to nazryx_app;
grant update (status, meeting_link, note) on call_bookings to nazryx_app;
grant usage on sequence call_bookings_id_seq to nazryx_app;

-- customers may only cancel their own call; the team changes everything else
create or replace function guard_call_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is not null and not app_is_team() and (new.status <> 'cancelled' or new.meeting_link is distinct from old.meeting_link) then
    raise exception 'Only the Nazryx team can change this';
  end if;
  return new;
end $$;
create trigger guard_call_booking before update on call_bookings for each row execute function guard_call_booking();
create trigger audit_call_bookings after insert or update on call_bookings for each row execute function audit_team_change();
create trigger audit_call_hours after insert or update or delete on call_hours for each row execute function audit_team_change();

-- the slots already taken in a window (times only, no names)
create or replace function taken_call_slots(p_from timestamptz, p_to timestamptz) returns setof timestamptz
language sql stable security definer set search_path = public as $$
  select starts_at from call_bookings where status = 'booked' and starts_at >= p_from and starts_at < p_to and app_uid() is not null
$$;
revoke all on function taken_call_slots(timestamptz, timestamptz) from public;
grant execute on function taken_call_slots(timestamptz, timestamptz) to nazryx_app;
