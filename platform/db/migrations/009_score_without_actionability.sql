-- 1. Gap score = 100 x demand x (1 - saturation). The actionability factor is gone: it held every score between
--    0 and 30 and one confirmed supplier offer jumped a molecule to 100. Confirmed supply stays a separate,
--    paid signal (molecule_supply_confirmed), so free and paid accounts now see the same score.
drop view visible_gap_scores;
alter table gap_scores drop column actionability, drop column base_score;
update gap_scores set score = round(100 * least(greatest(demand, 0), 1) * (1 - least(greatest(saturation, 0), 1)), 1);

create view visible_gap_scores as
  select g.country, g.molecule_id, g.demand, g.saturation, g.score, g.computed_at
  from gap_scores g;
grant select on visible_gap_scores to nazryx_app;

-- 2. A first registry load sent as a normal upload (not 'initial') announced every product in the market as
--    "new". Remove those feed items and the unsent alerts it queued. Later uploads are unaffected: the worker
--    now treats any upload into an empty registry as the initial load.
with first_load as (
  select distinct on (u.country) u.country, u.kind, u.started_at, u.finished_at
  from registry_uploads u where u.status = 'applied' order by u.country, u.finished_at
)
delete from feed_items f using first_load l
 where l.kind = 'upload' and f.kind = 'registration' and f.country = l.country
   and f.created_at between l.started_at and l.finished_at;

with first_load as (
  select distinct on (u.country) u.kind, u.started_at, u.finished_at
  from registry_uploads u where u.status = 'applied' order by u.country, u.finished_at
)
delete from notifications n using first_load l
 where l.kind = 'upload' and n.subject = 'New registration' and n.status = 'queued'
   and n.created_at between l.started_at and l.finished_at;
