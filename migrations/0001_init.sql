-- Raw events (kept 13 months, then rolled into daily_agg)
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,          -- ms since epoch
  day TEXT NOT NULL,            -- YYYY-MM-DD (UTC)
  type TEXT NOT NULL,           -- pageview | time | scroll | click | submit
  path TEXT NOT NULL,
  pv TEXT,                      -- random per-page-load id
  sid TEXT NOT NULL,            -- session id (30 min inactivity)
  vkey TEXT NOT NULL,           -- daily-rotating salted hash; not reversible
  value INTEGER,                -- seconds (time) or percent (scroll)
  target TEXT,                  -- data-track label for clicks
  ref_host TEXT, source TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, lead_ref TEXT,
  country TEXT, city TEXT, device TEXT, browser TEXT, os TEXT, lang TEXT,
  is_new INTEGER
);
CREATE INDEX IF NOT EXISTS ev_ts ON events(ts);
CREATE INDEX IF NOT EXISTS ev_path ON events(path, ts);
CREATE INDEX IF NOT EXISTS ev_vkey ON events(vkey, ts);
CREATE INDEX IF NOT EXISTS ev_ref ON events(lead_ref, ts);

CREATE TABLE IF NOT EXISTS daily_agg (
  day TEXT NOT NULL, path TEXT NOT NULL, source TEXT, country TEXT, device TEXT,
  pageviews INTEGER NOT NULL, visitors INTEGER NOT NULL, sessions INTEGER NOT NULL,
  PRIMARY KEY (day, path, source, country, device)
);

-- One random salt per UTC day; old salts are deleted so hashes can't be recomputed.
CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);

-- Login lockout, keyed by hashed IP
CREATE TABLE IF NOT EXISTS login_attempts (iph TEXT PRIMARY KEY, fails INTEGER NOT NULL, locked_until INTEGER NOT NULL, updated INTEGER NOT NULL);
