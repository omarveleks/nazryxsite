# Nazryx Intelligence Platform

Software for pharma distributors: see competitors, find market gaps, and request sourcing. Tanzania first.
Next.js web app, one Postgres database, Python ingest jobs. This folder is separate from the marketing site
(`../site`, Cloudflare Pages) and is not published by it.

| Path | What |
|---|---|
| `web/` | Next.js 15 app (App Router, server components, server actions). Connects as the restricted DB role `nazryx_app`. |
| `ingest/` | Python: data pipeline, ingest job, worker (jobs, notifications, 48-hour reminder), demo seed, tests |
| `ingest/pipeline/` | The handoff pipeline, fixed: `build.py`, `norm.py`, `gap.py`, `companies.py`, `corrections.py` |
| `db/migrations/` | Schema (extends the handoff's `db/schema.sql`), row-level security, review-queue and team functions |
| `data/raw/` | **Not committed.** Registry export, essential-list OCR text, global list text |
| `docker-compose.yml`, `.env.example` | Local stack |
| `../render.yaml` | Hosted stack on Render (see "Hosting on Render") |

## Run it (Docker Compose)

1. Put the source files in `data/raw/` (they are not in git; the repo ignores spreadsheets and data folders):
   ```
   mkdir -p data/raw
   cp <handoff>/pipeline/data/* data/raw/
   chmod a+r data/raw/*        # the .xls ships with 0600; the containers run as a non-root user
   ```
2. `cp .env.example .env` and set `POSTGRES_PASSWORD` and `APP_DB_PASSWORD` to long random strings.
   Optionally set `SEED_TEAM_PASSWORD` and `DEMO_PASSWORD`; if blank, the init service prints random ones once.
3. `docker compose up --build`
   - `init` migrates, runs the first registry load (about 20 s) and seeds demo data, then exits.
   - `worker` runs upload jobs, delivers (stubbed) notifications and sends the 48-hour reminder.
   - `web` serves http://localhost:3000
4. Sign in at `/signup?mode=signin`:
   - `team@nazryx.test` (Nazryx team: sees **Admin**)
   - `demo-free@nazryx.test` (free plan: portfolio, requests in every stage, three anonymous quotes on Doxycycline)
   - `demo-paid@nazryx.test` (paid plan)

## Run it without Docker

Postgres 16, Python 3.12+, Node 22.
```
cd ingest && pip install -r requirements.txt
export DATABASE_URL_ADMIN=postgresql://<owner>:<pw>@localhost:5432/nazryx APP_DB_PASSWORD=<pw> DATA_DIR=$PWD/../data
python bootstrap.py                                 # migrate, store the reference lists, first load, demo seed
python worker.py &                                  # upload jobs, reminders, notifications
cd ../web && npm ci
DATABASE_URL=postgresql://nazryx_app:<pw>@localhost:5432/nazryx npm run dev
```
To re-run only the pipeline and inspect its CSVs: `python ingest/pipeline/build.py --registry ... --nemlit ... --who ... --out data/out`.

## Tests

```
cd ingest
python -m pytest -q                                                                # pipeline unit tests
TEST_DATABASE_URL_ADMIN=postgresql://<owner>:<pw>@localhost:5432/nazryx_test python -m pytest -q   # + database tests
cd ../web && npm run typecheck && npm run build
```
The database URL must point at a throwaway database: the tests drop and recreate it.

Browser smoke test (34 checks: sign-up, claim, enrich, request, quote acceptance, team two-step set-up, admin pages,
activity log, upload through the worker, phone width) on synthetic data, the same way CI runs it:
```
python e2e/make_fixture.py /tmp/nzx && DATA_DIR=/tmp/nzx python ingest/bootstrap.py   # plus the env vars above
# start the web app and worker, then:
cd e2e && npm ci && npx playwright install chromium
BASE=http://localhost:3000 DEMO_PASSWORD=... SEED_TEAM_PASSWORD=... XLS=/tmp/nzx/raw/Registered_Products_test.xls node smoke.mjs
```
CI (`.github/workflows/platform.yml`) runs the Python tests against Postgres, the web build, both Docker image
builds and this smoke test on every push to `platform/`.

| Test file | Covers |
|---|---|
| `test_gap.py` | Gap score D × (1 − S): weights, saturation cap, clamping, full 0–100 range |
| `test_companies.py` | Distributor merging: legal-suffix and punctuation variants, typos, short names, numbered sites, team aliases and keep-separate pairs, order independence |
| `test_norm.py`, `test_parser.py` | Molecule keys (salts, synonyms, OCR typos), essential-list parsing (OCR levels, continuation lines), global-list parsing, certificate years |
| `test_ingest_db.py` | Ingest diff (new, removed, cancelled, new distributors, moved scores, history, feed), rollback of a partial or broken upload, RLS supplier confidentiality, free-plan limits enforced in the database, the 48-hour reminder, sign-in throttling, team password reset, free-plan score view |
| `test_claude_match.py` | Claude suggestion parsing (only offered candidates are accepted) |

## How it works

### Screens
Sign up, Claim your company (onboarding), Home, Search, Molecule, Market (Snapshot, Whitespace), Competitors
(Directory, Compare, Tracker), Company, My portfolio (Coverage, Suppliers, Benchmark), Requests, Request detail,
New request, Settings, Admin (team only). No tenders, no registration tracking pages, no document vault
(documents live inside requests). The UI never names a data source: the national list is shown as
"Nazryx Official Medicines List - Tanzania", the WHO list as "global essential list", the registry as
"registration data".

### Free and paid
| | Free | Paid |
|---|---|---|
| Countries | 1 (Tanzania) | more as they launch |
| Molecule pages | 20 enrich credits a month, 1 per molecule, re-opening is free | unlimited |
| Competitors, statuses, use case | yes | yes |
| Whitespace | top 3 | full ranked list |
| Price band, supplier availability | no | yes |
| Company page manufacturers | 2 | all |
| Compare | 1 company | 2 companies, peer detail |
| Follows / watches | 3 / 5 | unlimited, alert on every new registration |
| Active requests | 5 | unlimited |
| Team seats | 1 | add teammates |

Every plan sees the same gap score. Whether Nazryx holds confirmed supply is a separate, paid signal on the molecule
page (`molecule_supply_confirmed`); the app reads scores through the `visible_gap_scores` view.

Credits, request, follow and watch limits are enforced **in Postgres** (definer function and triggers), not only in
the UI. Billing is manual for now: "Upgrade" files a request; the team sets the plan on Admin › Accounts.

### Supplier confidentiality (row-level security)
The app connects as `nazryx_app`, which owns nothing and cannot bypass RLS. Each request sets `app.user_id` for its
transaction. `suppliers` and `supplier_offers` are readable only by team accounts, plus the single supplier and offer
behind a quote the customer accepted on their own request. Quotes carry only an anonymous label, MOQ, lead time,
certificates and a "below / at / above your target price" note; the price and the supplier's name and contact unlock
on acceptance (`accept_quote()` checks ownership, opens an order, closes the request). Internal supplier notes live
in a separate table that stays team-only even after acceptance. `test_supplier_confidentiality_rls` proves this
against a real database.

### Accounts and security
- Passwords are hashed with scrypt; sessions are random tokens stored hashed in Postgres (HttpOnly cookie).
- After five wrong passwords for an email within 15 minutes, sign-in is refused until the window passes.
- Two-step sign-in with an authenticator app (Settings › Two-step sign-in). **Required for team accounts**: Admin
  does not open until it is on (`TEAM_2FA_REQUIRED=0` turns that off for local testing only). A team member can reset
  it for someone who lost their phone on Admin › Accounts.
- No reset email yet: a team member sets a temporary password on Admin › Accounts, which signs that user out everywhere.
- Limits enforced in Postgres: 5 new accounts per network address per hour (200 overall), 60 uploaded files or
  300 MB per customer per day.
- Admin › Activity: every change a team account makes (stages, quotes, offers, claims, plans, merges, uploads,
  password and two-step resets) is recorded by database triggers, not by app code, so it cannot be skipped.
- Error monitoring (Sentry) in the web app and the worker when `SENTRY_DSN` is set; no personal data is sent.
- Help and contact page at `/help` (`SUPPORT_EMAIL`, `SUPPORT_WHATSAPP`).

### Requests
New request → "Our team will reach out to you for more info" → the request shows its stage (Submitted, Reviewing,
Suppliers found, Quote ready, Closed). The team moves stages, messages the customer and adds offers and anonymous
quotes on Admin › Requests; each change notifies the customer (email + WhatsApp, stubbed) and appears in their feed.

### Claim your company
The customer picks their company from the registered distributor list (or types a name), uploads a licence and
chooses how to load the portfolio. Admin › Claims shows the licence, whether the work-email domain matches the
company, and approve / reject. Approval verifies the company and, if asked, pre-fills the portfolio from its
registrations.

### Admin and ingest
Admin › Data updates shows the time since the last registry upload; it turns red after 48 hours and the worker
emails and WhatsApps the team (stubbed) once per 48-hour window. Uploading the `.xls` queues a job. The worker runs it
in **one transaction**: validate (columns, row count, under 60 % of the last active count is rejected as partial),
build, diff by product fingerprint, upsert molecules, companies and registrations, record history (added, removed,
status changes), merge duplicate companies, recompute gap scores (history kept), refresh company stats, queue
review items and feed items. Any error rolls everything back and the job shows "Failed, rolled back"; a job
interrupted by a crash is marked failed at the next worker start. Review queue decisions (molecule matches, company
merges, keep-separate) apply on the next upload or "Recompute now".

If `ANTHROPIC_API_KEY` is set, the worker also asks Claude (`ingest/claude_match.py`) to suggest registry matches for
unmatched essential molecules. Suggestions only: the team accepts or rejects each one.

### Gap score
`100 × D × (1 − S)` (weights are first guesses, from the handoff): D = 0.5 if on the national list
+ 0.3 × facility-level weight + 0.2 if on the global list; S = registrants / 8, capped. So 100 = on both lists, used at
every level, nobody registered; 0 = eight or more registrants or no demand signal. The handoff's actionability factor
(× 0.3 until Nazryx held a confirmed offer) was dropped: it kept every score under 30 and one offer jumped a molecule
to 100 (migration 009). Molecules the list says to prepare locally (medical oxygen, coal tar, ...) stay
in coverage but are left out of whitespace ranking. Programme-channel classes (vaccines, ARVs, TB, malaria, blood,
hormones and contraceptives, cancer, NTDs) are flagged "check before pitching".

## Pipeline fixes (before trusting the scores)

| | Handoff pipeline | Now |
|---|---|---|
| Essential molecules parsed | 513 | 585 |
| Facility level blank | 352 | 180 (the rest are missing from the OCR text itself) |
| Matched to the global list | 87 | 292 |
| Essential molecules with no registration | 186 | 175 |

- **Essential list (OCR):** fixed 34-section list (OCR could rename or skip sections, e.g. "Oxytocic's"); level letters
  read as `s`, `Ss`, `c`, `Cc`; levels on continuation lines; form-only lines ("Oral", "Extended-Release") no longer
  become molecules; duplicates keep the widest level; name fixes (Zine → Zinc, Potassium lodide → Iodide, Sodium
  bicarbonats, Euphobia, doubled names like "Clotrimazole Clotrimazole"); category fixes. All in `corrections.py`.
- **Molecule keys:** salt-only medicines kept (sodium chloride and potassium chloride used to vanish, magnesium oxide
  became "oxide"); dosage-form words removed ("Ephedrine injection", "Budesonide inhaler"); synonyms (benzhexol =
  trihexyphenidyl, adrenaline = epinephrine, mesalamine = mesalazine, ...); combinations matched regardless of order
  or separator.
- **Registry:** vaccines and other biologicals now count (they are a separate classification, so every essential
  vaccine looked unregistered); animal-health products filed as biologicals are excluded; exact duplicate rows
  removed; certificate year only from dated numbers ("TAN 00,050 …" is not year 2000).
- **Hand check of the top 100 gaps:** each one was searched in the raw registry. Wrong "gaps" fixed with recorded
  matches (calamine lotion = calamine + zinc oxide, magnesium trisilicate compound, hepatitis B vaccine registered by
  antigen, phenoxymethyl penicillin, ethinyloestradiol spelling). Most remaining top gaps are genuinely absent from
  this export (for example ivermectin is registered only for veterinary use).
- **Companies:** one clustering over registrant, LTR and manufacturer names; fuzzy merges only for long names, never
  across different numbers; local technical representatives get country Tanzania (the old file gave them the foreign
  registrant's country); near-misses go to a review queue instead of merging silently.

## Hosting on Render

`render.yaml` (repository root) describes the hosted setup: a Postgres 16 database, the web app and the worker,
all in Frankfurt. Uploaded files are stored in Postgres, so the services share no disk.

1. Sign up at render.com and connect your GitHub account.
2. **New › Blueprint**, pick this repository and the branch that has `render.yaml`. Render asks for:
   - `SEED_TEAM_EMAIL` and `SEED_TEAM_PASSWORD`: the first Nazryx team login.
   - `DEMO_PASSWORD`: password for the demo customer accounts (set `SEED_DEMO` to `0` on the worker to skip demo data).
   - `TEAM_ALERT_EMAILS` and `ANTHROPIC_API_KEY`: optional, can stay empty.
3. Apply. The first build takes a few minutes. The worker migrates the database and creates the team account.
4. Open the web service's `https://…onrender.com` address, sign in with the team account, go to **Admin**:
   - First, set up two-step sign-in when asked (team accounts need it).
   - **Reference lists**: upload `tz_nemlit_ocr.txt` and `who_eml_2025.txt` from the handoff. The registry upload
     stays disabled until both are loaded.
   - **Upload new list**: upload `Registered_Products_….xls`. About 30 seconds later the data is live, and the demo
     accounts `demo-free@nazryx.test` / `demo-paid@nazryx.test` exist.
5. Optional: add your own domain (e.g. `app.nazryx.com`) under the web service's Settings › Custom Domains.

**Staging.** Render's preview environments give every pull request its own copy (web, worker and an empty
database) and delete it when the pull request closes. They need a Pro workspace. To turn them on, add this at the top
of `render.yaml`, then put `[render preview]` in a pull request's title:
```yaml
previews:
  generation: manual
  expireAfterDays: 7
```
Secrets marked `sync: false` are not copied into previews; put them in a manually created environment group.

The default instance sizes are the smallest paid ones (web and worker `0.5c-512mb`, database `0.1c-256mb`); check
render.com/pricing for current prices. Every push to the chosen branch redeploys.

If the database user is not allowed to create roles, the worker log says so; run the printed
`CREATE ROLE nazryx_app ...` once in Render's database shell with the `APP_DB_PASSWORD` value from the
`nazryx-shared` environment group, then restart the worker.

## Deploying elsewhere

- Any host that runs Docker images next to Postgres 16 works (Railway, Fly.io, a VM). Run the ingest image once with
  `python bootstrap.py` (or set `RUN_BOOTSTRAP=1` on the worker), keep `worker.py` running, and serve the web image
  behind HTTPS.
- The web app needs `DATABASE_URL` for the `nazryx_app` role, or `DATABASE_URL_BASE` (any URL for the database;
  only its host and name are used) plus `APP_DB_PASSWORD`. The worker needs `DATABASE_URL_ADMIN` (owner role).
- Secrets (database passwords, SMTP, WhatsApp, `ANTHROPIC_API_KEY`) go in the host's secret settings, never in the repo.
- Email: set `EMAIL_PROVIDER=smtp` and the `SMTP_*` variables. WhatsApp: implement `send_whatsapp` in
  `ingest/notify.py` against the WhatsApp Business API.
