-- A source's run in progress shows as running (its previous error no longer reads as the current state), and a run cut
-- off by a worker restart is marked interrupted and run again.
alter table data_sources add column if not exists running_since timestamptz;
