-- The market a manufacturer is looking at across the portal; switched from the market picker (with more than one market).
alter table manufacturer_profiles add column primary_market text references countries(code);
grant update (primary_market) on manufacturer_profiles to nazryx_app;
