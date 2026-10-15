-- The 5-molecule watch limit belongs to the paused distributor free plan; manufacturers' competitor watch is governed by
-- their own plan in the app. Without this, "Watch all my products" failed for any manufacturer with over 5 medicines.
create or replace function enforce_plan_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim plan_limits; n int;
begin
  if app_uid() is null or exists (select 1 from users where id = new.user_id and account_type = 'manufacturer') then
    return new;
  end if;
  select * into lim from plan_limits where plan = coalesce(app_plan(), 'free');
  if tg_table_name = 'follows' and lim.max_follows is not null then
    select count(*) into n from follows where user_id = new.user_id;
    if n >= lim.max_follows then raise exception 'Free plan: follow up to % companies', lim.max_follows; end if;
  elsif tg_table_name = 'watches' and lim.max_watches is not null then
    select count(*) into n from watches where user_id = new.user_id;
    if n >= lim.max_watches then raise exception 'Free plan: watch up to % molecules', lim.max_watches; end if;
  elsif tg_table_name = 'requests' and lim.max_active_requests is not null then
    select count(*) into n from requests where user_id = new.user_id and stage not in ('Registration', 'Shipment', 'Closed');
    if n >= lim.max_active_requests then
      raise exception 'Free plan: up to % active requests', lim.max_active_requests;
    end if;
  end if;
  return new;
end $$;

-- Kyrgyzstan tender results (winners pages of the state procurement portal), daily
insert into data_sources (key, country, kind, label, url, every_hours) values
  ('tenders_KG', 'KG', 'tenders', 'Kyrgyzstan public tender results (zakupki.gov.kg)', 'https://zakupki.gov.kg', 24)
on conflict (key) do nothing;
update data_sources set label = 'Uzbekistan e-tenders and completed deals (UZEX)' where key = 'tenders_UZ';
