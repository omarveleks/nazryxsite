-- Why a product has no molecule yet, for the team (Admin > Accounts): set by the worker's re-matching
-- (catalogue.rematch), cleared when it is matched.
alter table mfr_products add column if not exists match_note text;
