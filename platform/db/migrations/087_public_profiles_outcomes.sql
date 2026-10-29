-- Public manufacturer profiles with trust tiers, the monthly outcomes email, and the 30-day check-in marker.
alter table manufacturer_profiles
  add column if not exists public_profile boolean not null default false,
  add column if not exists public_slug text unique,
  add column if not exists audited_at timestamptz,            -- a site visit or a recognised inspection, confirmed by the team
  add column if not exists audit_note text,
  add column if not exists outcomes_sent_at timestamptz,
  add column if not exists checkin_offered_at timestamptz;

-- a slug from the company name: lower, ascii, hyphens; unique by suffix
create or replace function mfr_slug(p_name text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(translate(coalesce(p_name, ''), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')), '[^a-z0-9]+', '-', 'g'))
$$;

-- what a public profile shows: nothing private, nothing about plans or money
create or replace function public_profile(p_slug text)
returns table (company_name text, hq_country text, website text, certifications text[], dosage_forms text[], therapeutic_areas text[],
               verified boolean, audited boolean, registrations int, markets text[], classes jsonb, molecules int, since timestamptz)
language sql stable security definer set search_path = public as $$
  select p.company_name, p.hq_country, p.website, p.certifications, p.dosage_forms, p.therapeutic_areas,
         p.verified_at is not null, p.audited_at is not null,
         (select count(*)::int from registrations r where r.active and r.manufacturer_id = any(p.company_ids)),
         (select array_agg(distinct r.country order by r.country) from registrations r where r.active and r.manufacturer_id = any(p.company_ids)),
         (select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'n', x.n) order by x.n desc), '[]'::jsonb) from (
            select m.category, count(distinct m.id) as n from mfr_products pr join molecules m on m.id = pr.molecule_id
            where pr.user_id = p.user_id and m.category is not null group by m.category) x),
         (select count(distinct pr.molecule_id)::int from mfr_products pr where pr.user_id = p.user_id and pr.molecule_id is not null),
         p.created_at
  from manufacturer_profiles p join users u on u.id = p.user_id
  where p.public_profile and p.public_slug = lower(p_slug) and not u.disabled and p.status = 'approved'
$$;
revoke all on function public_profile(text) from public;
grant execute on function public_profile(text) to nazryx_app;

-- the public directory: every public, approved manufacturer
create or replace function public_profiles()
returns table (slug text, company_name text, hq_country text, verified boolean, audited boolean, registrations int, markets text[], forms text[])
language sql stable security definer set search_path = public as $$
  select p.public_slug, p.company_name, p.hq_country, p.verified_at is not null, p.audited_at is not null,
         (select count(*)::int from registrations r where r.active and r.manufacturer_id = any(p.company_ids)),
         (select array_agg(distinct r.country order by r.country) from registrations r where r.active and r.manufacturer_id = any(p.company_ids)),
         p.dosage_forms
  from manufacturer_profiles p join users u on u.id = p.user_id
  where p.public_profile and p.public_slug is not null and not u.disabled and p.status = 'approved'
  order by (p.audited_at is not null) desc, (p.verified_at is not null) desc, p.company_name
$$;
revoke all on function public_profiles() from public;
grant execute on function public_profiles() to nazryx_app;

-- customers turn their public page on; the team sets the audit tier
grant update (public_profile, public_slug) on manufacturer_profiles to nazryx_app;
grant update (audited_at, audit_note) on manufacturer_profiles to nazryx_app;

-- the guard also keeps the audit tier for the team
create or replace function guard_mfr_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if app_uid() is not null and not app_is_team() and coalesce(current_setting('nzx.self_service', true), '') <> 'on'
     and (new.status is distinct from old.status or new.team_note is distinct from old.team_note
       or new.reviewed_at is distinct from old.reviewed_at or new.active_plan is distinct from old.active_plan
       or new.active_since is distinct from old.active_since or new.verified_at is distinct from old.verified_at
       or new.stripe_customer is distinct from old.stripe_customer or new.stripe_subscription is distinct from old.stripe_subscription
       or (new.paid_markets is distinct from old.paid_markets and coalesce(current_setting('nzx.taking_market', true), '') <> 'on')
       or new.billing_interval is distinct from old.billing_interval
       or new.company_ids is distinct from old.company_ids or new.trial_market is distinct from old.trial_market
       or new.trial_until is distinct from old.trial_until
       or new.audited_at is distinct from old.audited_at or new.audit_note is distinct from old.audit_note
       or (old.sample_product_id is not null and new.sample_product_id is distinct from old.sample_product_id)) then
    raise exception 'Only the Nazryx team can change this';
  end if;
  return new;
end $$;
