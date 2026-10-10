#!/usr/bin/env python3
"""First start: migrate, load the registry export if nothing is loaded yet, then seed demo data (SEED_DEMO=1)."""
import glob
import logging
import os

from db import connect
import migrate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
DATA_DIR = os.environ.get("DATA_DIR", "/data")

migrate.migrate()
with connect() as conn:
    loaded = conn.execute("select 1 from registry_uploads where status = 'applied' limit 1").fetchone()
if not loaded:
    files = sorted(glob.glob(os.path.join(DATA_DIR, "raw", "Registered_Products*.xls")))
    if not files:
        raise SystemExit(f"No registry export found in {DATA_DIR}/raw. Copy the handoff's pipeline/data/* there (see README).")
    if not os.access(files[-1], os.R_OK):
        raise SystemExit(f"{files[-1]} is not readable by the container user. Run: chmod a+r data/raw/*")
    import ingest_job
    ingest_job.run(ingest_job.create_job(files[-1], "initial"))
if os.environ.get("SEED_DEMO", "1") == "1":
    import seed
    seed.seed()
print("bootstrap done")
