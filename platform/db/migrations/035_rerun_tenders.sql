-- Tender collectors changed (live tenders for every market): run each once now instead of waiting a day.
update data_sources set run_now = true where kind = 'tenders';
