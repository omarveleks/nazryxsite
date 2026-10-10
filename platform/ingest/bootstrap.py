#!/usr/bin/env python3
"""First start (safe to run on every start): migrate; store the reference lists and load the registry export if
they are present in DATA_DIR/raw; make sure the team account exists; seed demo data (SEED_DEMO=1) once data is
loaded. On a host without a data folder the team uploads the three files on the admin page instead."""
import glob
import logging
import os

from db import connect
import migrate
import seed
import storage

log = logging.getLogger("bootstrap")
DATA_DIR = os.environ.get("DATA_DIR", "/data")


def _readable(path):
    if not os.access(path, os.R_OK):
        raise SystemExit(f"{path} is not readable by the container user. Run: chmod a+r data/raw/*")
    return path


def run():
    migrate.migrate()
    raw = os.path.join(DATA_DIR, "raw")
    with connect() as conn:
        cur = conn.cursor()
        for kind, pattern in (("national_list", "*nemlit*.txt"), ("global_list", "*who*.txt")):
            files = sorted(glob.glob(os.path.join(raw, pattern)))
            if files and not cur.execute("select 1 from reference_files where kind = %s", (kind,)).fetchone():
                storage.set_reference(cur, kind, _readable(files[-1]))
                log.info("stored %s from %s", kind, files[-1])
        loaded = cur.execute("select 1 from registry_uploads where status = 'applied' limit 1").fetchone()
        pending = cur.execute("select 1 from registry_uploads where status in ('queued', 'running') limit 1").fetchone()
        conn.commit()
    if not loaded and not pending:
        files = sorted(glob.glob(os.path.join(raw, "Registered_Products*.xls")))
        if files:
            import ingest_job
            ingest_job.run(ingest_job.create_job(_readable(files[-1]), "initial"))
            loaded = True
        else:
            log.info("no registry export in %s: upload it on the admin page", raw)
    if loaded and os.environ.get("SEED_DEMO", "1") == "1":
        seed.seed()
    else:
        seed.ensure_team()
    print("bootstrap done")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    run()
