-- Products can be dietary supplements too (manufacturers' lists mix them in).
alter table mfr_products drop constraint mfr_products_kind_check;
alter table mfr_products add constraint mfr_products_kind_check check (kind in ('medicine', 'device', 'supplement'));

-- The same molecule written two ways (the English INN and the Russian name in Latin letters) split its registrations and
-- competitors in two. Merge the ones found while loading a manufacturer's ophthalmic, ENT and vitamin portfolio; the
-- registries are read again so every count follows.
create function merge_molecule(p_from text, p_to text) returns void language plpgsql as $$
declare f int; t int; k text;
begin
  select id, canonical_key into f, k from molecules where inn = p_from order by id limit 1;
  select id into t from molecules where inn = p_to order by id limit 1;
  if f is null or t is null or f = t then return; end if;
  update molecule_aliases set molecule_id = t where molecule_id = f;
  insert into molecule_aliases (alias, molecule_id, source) values (k, t, 'team') on conflict (alias) do update set molecule_id = t, source = 'team';
  update registrations set molecule_id = t where molecule_id = f;
  update price_listings set molecule_id = t where molecule_id = f;
  update mfr_products set molecule_id = t where molecule_id = f;
  insert into watches (user_id, molecule_id, created_at) select user_id, t, created_at from watches where molecule_id = f on conflict do nothing;
  delete from watches where molecule_id = f;
  update country_molecules c set molecule_id = t where molecule_id = f
    and not exists (select 1 from country_molecules x where x.molecule_id = t and x.country = c.country);
  delete from country_molecules where molecule_id = f;
end $$;

select merge_molecule('Ksilometazolin', 'Xylometazoline');
select merge_molecule('Kolekalsiferol', 'Cholecalciferol');
select merge_molecule('Hyaluronan Sodium', 'Sodium Hyaluronate');
select merge_molecule('Hyaluronic Acid', 'Sodium Hyaluronate');
select merge_molecule('Articaine + Epinephrine Bitartrata', 'Artikain + Epinefrin');
select merge_molecule('Artikain', 'Articaine');
select merge_molecule('Ipratropiy Bromid + Ksilometazolin', 'Ipratropium Bromide + Xylometazoline');
drop function merge_molecule(text, text);
update data_sources set run_now = true where kind = 'registry';
