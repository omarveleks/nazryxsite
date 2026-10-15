-- Kazakhstan tenders read with lxml only (no html5lib fallback): run them again now.
update data_sources set run_now = true, last_error = null where key = 'tenders_KZ';
