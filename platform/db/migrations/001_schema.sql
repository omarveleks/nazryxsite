-- Nazryx Intelligence Platform schema (Postgres 16).
-- Extends the starting schema from the handoff (db/schema.sql). Owner: the migration role.
-- The web app connects as the restricted role `nazryx_app` (see 002_rls.sql); ingest jobs run as the owner.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- reference data
create table countries (
  code text primary key,
  name text not null,
  enabled boolean not null default false,
  currency text not null default 'USD'
);

create table molecules (
  id serial primary key,
  canonical_key text unique not null,          -- sorted ingredient tokens (see ingest/pipeline/norm.py)
  inn text not null,                           -- display name
  strength text,
  dosage_form text,
  category text,                               -- therapeutic class (from the national list sections)
  use_case text,                               -- short indication / typical use, team-edited
  created_at timestamptz not null default now()
);
create index molecules_inn_trgm on molecules using gin (inn gin_trgm_ops);

create table molecule_aliases (
  alias text primary key,                      -- a molecule key that maps to this molecule
  molecule_id int not null references molecules(id) on delete cascade,
  source text not null default 'auto' check (source in ('auto', 'team', 'suggested')),
  created_at timestamptz not null default now()
);

create table country_molecules (
  country text references countries(code),
  molecule_id int references molecules(id) on delete cascade,
  list_name text,                              -- name as written on the national list
  on_national_list boolean not null default false,
  on_who_eml boolean not null default false,
  facility_level text,                         -- A, B, C, D, S or null (not stated)
  channel_flag text,                           -- 'programme' (donor / public programmes) or 'open market'
  note text,                                   -- e.g. 'Medical gas, supplied locally'
  rankable boolean not null default true,      -- false: kept out of whitespace ranking
  registrations int not null default 0,
  registrants int not null default 0,
  ltrs int not null default 0,
  manufacturers int not null default 0,
  local_made int not null default 0,
  in_combinations int not null default 0,
  forms text,
  primary key (country, molecule_id)
);

-- ---------------------------------------------------------------- companies (public registry data)
create table companies (
  id serial primary key,
  display_name text not null,
  cluster_key text unique not null,
  country text,                                -- home country (LTRs are local)
  is_ltr boolean not null default false,
  is_registrant boolean not null default false,
  is_manufacturer boolean not null default false,
  city text,
  claimed_by uuid,
  verified boolean not null default false,
  merged_into int references companies(id),
  created_at timestamptz not null default now()
);
create index companies_name_trgm on companies using gin (display_name gin_trgm_ops);

create table company_aliases (
  alias text primary key,                      -- a raw name or company key
  company_id int not null references companies(id) on delete cascade,
  source text not null default 'auto' check (source in ('auto', 'team'))
);

create table company_keep_separate (
  a_key text not null, b_key text not null, decided_by uuid, created_at timestamptz not null default now(),
  primary key (a_key, b_key)
);

create table company_merges (
  id serial primary key,
  from_company int not null, into_company int not null references companies(id),
  upload_id int, decided_by uuid, reason text, created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- registry
create table registry_uploads (
  id serial primary key,
  country text not null default 'TZ' references countries(code),
  kind text not null default 'upload' check (kind in ('upload', 'recompute', 'initial')),
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  file_name text,
  file_path text,
  rows int,
  status text not null default 'queued' check (status in ('queued', 'running', 'applied', 'failed')),
  diff jsonb,
  summary jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz
);

create table registrations (
  id serial primary key,
  country text not null references countries(code),
  fingerprint text not null,                   -- hash of the product's identifying fields
  certificate_no text,
  molecule_id int references molecules(id),
  brand text,
  generic_name text,
  dosage_form text,
  form text,                                   -- normalised form group
  strength text,
  api_text text,
  registrant_id int references companies(id),
  ltr_id int references companies(id),
  manufacturer_id int references companies(id),
  manufacturing_country text,
  status text,
  active boolean not null default true,
  reg_year int,                                -- from the certificate number
  first_upload_id int references registry_uploads(id),
  last_upload_id int references registry_uploads(id),
  removed_upload_id int references registry_uploads(id),
  unique (country, fingerprint)
);
create index registrations_molecule on registrations (country, molecule_id) where active;
create index registrations_ltr on registrations (ltr_id) where active;
create index registrations_registrant on registrations (registrant_id) where active;
create index registrations_manufacturer on registrations (manufacturer_id) where active;
create index registrations_brand_trgm on registrations using gin (brand gin_trgm_ops);

create table registration_history (
  id bigserial primary key,
  upload_id int not null references registry_uploads(id),
  registration_id int references registrations(id) on delete cascade,
  change text not null check (change in ('added', 'removed', 'status', 'reactivated')),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index registration_history_upload on registration_history (upload_id);

create table gap_scores (
  country text references countries(code),
  molecule_id int references molecules(id) on delete cascade,
  demand numeric not null,
  saturation numeric not null,
  actionability numeric not null default 0.3,
  score numeric not null,
  computed_at timestamptz not null default now(),
  upload_id int,
  primary key (country, molecule_id)
);

create table gap_score_history (
  id bigserial primary key,
  country text, molecule_id int, previous_score numeric, score numeric, upload_id int,
  computed_at timestamptz not null default now()
);

create table company_stats (
  country text, company_id int references companies(id) on delete cascade,
  registrations int not null default 0,        -- products they represent (LTR / registrant) or make
  molecules int not null default 0,
  categories int not null default 0,
  new_recent int not null default 0,           -- certificates from this year or last
  manufacturers int not null default 0,        -- manufacturers behind their products
  primary key (country, company_id)
);

-- ---------------------------------------------------------------- accounts
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null default '',
  password_hash text not null,
  role text not null default 'customer' check (role in ('customer', 'team')),
  plan text not null default 'free' check (plan in ('free', 'paid')),
  country text references countries(code) default 'TZ',
  company_id int references companies(id),    -- set when a claim is approved
  owner_id uuid references users(id),          -- team seat: the paying account this seat belongs to
  credits int not null default 20,
  credits_reset_at timestamptz not null default now(),
  whatsapp text,
  notify_email boolean not null default true,
  notify_whatsapp boolean not null default false,
  language text not null default 'en',
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table company_claims (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  company_id int references companies(id),
  company_name text,                           -- when the company is not in the list
  email_domain text,
  domain_match boolean,                        -- work email domain looks like the company name
  licence_path text,
  licence_name text,
  portfolio_source text check (portfolio_source in ('registry', 'catalogue', 'scratch')),
  catalogue_path text,
  catalogue_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table portfolio_items (
  user_id uuid not null references users(id) on delete cascade,
  molecule_id int not null references molecules(id) on delete cascade,
  source text not null default 'manual',
  added_at timestamptz not null default now(),
  primary key (user_id, molecule_id)
);

create table customer_suppliers (             -- the customer's OWN supplier list (not Nazryx suppliers)
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  molecule_ids int[] not null default '{}',
  created_at timestamptz not null default now()
);

create table enrichments (
  user_id uuid not null references users(id) on delete cascade,
  molecule_id int not null references molecules(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, molecule_id)
);

create table credit_ledger (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  delta int not null, reason text not null, molecule_id int,
  created_at timestamptz not null default now()
);

create table watches (
  user_id uuid not null references users(id) on delete cascade,
  molecule_id int not null references molecules(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, molecule_id)
);

create table follows (
  user_id uuid not null references users(id) on delete cascade,
  company_id int not null references companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create table plan_requests (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  wanted text not null,                        -- 'paid', 'countries', 'seats'
  note text,
  status text not null default 'open' check (status in ('open', 'done', 'declined')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- sourcing (confidential)
create table suppliers (                       -- team only
  id serial primary key,
  name text not null,
  country text,
  contact text,
  created_at timestamptz not null default now()
);

create table supplier_notes (                  -- team only, always (kept out of `suppliers` on purpose)
  supplier_id int primary key references suppliers(id) on delete cascade,
  notes text not null default ''
);

create table supplier_offers (                 -- team only until a quote on it is accepted
  id serial primary key,
  supplier_id int not null references suppliers(id),
  molecule_id int references molecules(id),
  price numeric,
  currency text not null default 'USD',
  unit text,
  moq text,
  lead_time_weeks int,
  certs text,
  confirmed boolean not null default true,     -- confirmed supply (feeds actionability A in the gap score)
  created_at timestamptz not null default now()
);

create table requests (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  country text not null default 'TZ' references countries(code),
  molecule_id int references molecules(id),
  molecule_text text,                          -- free text when the molecule is not in the list
  quantity text,
  unit text,
  target_price text,
  deliver_by date,
  notes text,
  stage text not null default 'Submitted'
    check (stage in ('Submitted', 'Reviewing', 'Suppliers found', 'Quote ready', 'Closed')),
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table request_stage_history (
  id serial primary key,
  request_id int not null references requests(id) on delete cascade,
  stage text not null, changed_by uuid, created_at timestamptz not null default now()
);

create table request_files (
  id serial primary key,
  request_id int not null references requests(id) on delete cascade,
  path text not null,
  file_name text not null,
  kind text not null default 'attachment' check (kind in ('attachment', 'requirement_list')),
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create table request_messages (
  id serial primary key,
  request_id int not null references requests(id) on delete cascade,
  from_team boolean not null default false,
  author_id uuid,
  body text not null,
  created_at timestamptz not null default now()
);

create table quotes (
  id serial primary key,
  request_id int not null references requests(id) on delete cascade,
  supplier_offer_id int not null references supplier_offers(id),
  label text not null,                         -- 'Supplier A': what the customer sees before accepting
  moq text,                                    -- terms the customer may see before accepting
  lead_time_weeks int,
  certs text,
  price_vs_target text check (price_vs_target in ('below', 'at', 'above')),
  accepted boolean not null default false,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_accepted_quote_per_request on quotes (request_id) where accepted;

create table orders (
  id serial primary key,
  request_id int not null references requests(id) on delete cascade,
  quote_id int not null references quotes(id),
  status text not null default 'Confirming'
    check (status in ('Confirming', 'In production', 'In transit', 'Delivered', 'Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- feed, prices, notifications
create table feed_items (
  id bigserial primary key,
  country text not null default 'TZ',
  kind text not null check (kind in ('registration', 'regulatory', 'request')),
  title text not null,
  body text,
  link text,
  molecule_id int, company_id int,
  user_id uuid references users(id) on delete cascade,   -- null = visible to everyone in the country
  created_at timestamptz not null default now()
);
create index feed_items_country on feed_items (country, created_at desc);

create table market_prices (                   -- market price observations (paid plan), never supplier prices
  id serial primary key,
  country text not null references countries(code),
  molecule_id int not null references molecules(id) on delete cascade,
  price_low numeric not null, price_high numeric not null,
  currency text not null default 'USD', unit text not null default 'unit',
  observed_at date not null default current_date,
  created_by uuid
);

create table notifications (                   -- outbox; providers are stubbed (see ingest/notify.py)
  id bigserial primary key,
  user_id uuid references users(id) on delete cascade,   -- null = Nazryx team
  channel text not null check (channel in ('email', 'whatsapp', 'inapp')),
  subject text,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'stubbed', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table reminders_log (
  id serial primary key,
  kind text not null,
  sent_at timestamptz not null default now(),
  detail jsonb
);
