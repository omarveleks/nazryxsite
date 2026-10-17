-- Tender titles and buyers in English (ingest/translate.py). Each distinct text is translated once and kept in
-- translations, so the same buyer or title across many tenders costs one translation.
alter table tenders add column title_en text, add column buyer_en text;

create table translations (
  src text primary key,
  en text not null,
  created_at timestamptz not null default now()
);
alter table translations enable row level security;   -- worker only: the app reads the English on tenders

-- translate the tenders already collected on the next worker run
update data_sources set run_now = true where key in ('tenders_KZ', 'tenders_KG', 'tenders_UZ');
