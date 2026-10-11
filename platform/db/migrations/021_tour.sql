-- The guided tour after sign-up: which step a manufacturer is on (null = not touring).
alter table manufacturer_profiles add column tour_step int;
grant update (tour_step) on manufacturer_profiles to nazryx_app;
