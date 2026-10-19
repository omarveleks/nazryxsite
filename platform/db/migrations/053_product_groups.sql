-- Use groups, corrected and extended.
-- 1. A medicine with another active ingredient is not an eye lubricant or nasal saline (glaucoma drops, NSAID drops,
--    decongestant sprays were tagged by name alone).
-- 2. Three more groups for devices: contact lens care, dermal fillers, inhaled (nebuliser) saline. Same rules as
--    ingest/devices.py and web/lib/segments.ts; the weekly device read re-tags with the same rules.
update mfr_products p set use_group = null from molecules m
 where m.id = p.molecule_id and p.use_group in ('eye_drops', 'nasal') and coalesce(p.kind, 'medicine') <> 'device'
   and m.inn !~* '(hyaluron|carmellose|carboxymethyl|hypromellose|hydroxypropyl|carbomer|polyvinyl|povidone|trehalose|dexpanthenol|glycerin|glycerol|polyethylene glycol|propylene glycol|dextran|sodium chloride|sea ?water|saline|hylan)';

do $$
declare
  lens text := '(contact lens|lens care|multi-?(purpose|function[a-z]*) solution|aquaoptic|renu\M|opti-?free|biotrue|complete revitalens|solo-?care|avizor)';
  neb  text := '(hypertonic[^,]*inhal|inhal[^,]*hypertonic|nebuli[sz][a-z]*[^,]*(saline|sodium chloride)|ingasalin|hyaneb|nebusal|mucoclear|hyper-?sal\M)';
  fill text := '((dermal|facial|lip|hyaluronic[^,]*) filler|bellarti|juvederm|restylane|belotero|teosyal|stylage|profhilo|radiesse|sculptra)';
begin
  update mfr_products set use_group = 'contact_lens' where use_group is null and name ~* lens;
  update mfr_products set use_group = 'inhaled_saline' where use_group is null and name ~* neb;
  update mfr_products set use_group = 'dermal_filler' where use_group is null and name ~* fill;
  update devices set use_group = 'contact_lens' where use_group is null and (brand || ' ' || coalesce(description, '') || ' ' || coalesce(intended_use, '')) ~* lens;
  update devices set use_group = 'inhaled_saline' where use_group is null and (brand || ' ' || coalesce(description, '') || ' ' || coalesce(intended_use, '')) ~* neb;
  update devices set use_group = 'dermal_filler' where use_group is null and (brand || ' ' || coalesce(description, '') || ' ' || coalesce(intended_use, '')) ~* fill;
  update registrations set use_group = 'inhaled_saline' where use_group is null and (brand || ' ' || coalesce(generic_name, '') || ' ' || coalesce(dosage_form, '')) ~* neb;
end $$;
