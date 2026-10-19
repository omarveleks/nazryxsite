-- Nigeria's sources first ran on the worker still running the release before them (KeyError: 'NG'), and one Greenbook
-- product page stopped the device run before broken pages were skipped; Kenya's shop run was lost to one slow page.
-- All run again now.
update data_sources set run_now = true where key in ('registry_NG', 'devices_NG', 'prices_NG', 'tenders_NG', 'prices_KE');
