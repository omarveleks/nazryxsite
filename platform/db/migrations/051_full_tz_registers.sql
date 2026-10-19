-- Tanzania's public lists were read for four sub-modules only: 1,627 of 4,606 registered devices and 5,834 of 5,842
-- medicines. Both are now read whole; read them again now.
update data_sources set run_now = true where key in ('devices_TZ', 'registry_TZ');
