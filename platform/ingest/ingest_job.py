#!/usr/bin/env python3
"""Run one registry ingest job: validate the uploaded export, build, diff against live data, upsert, recompute gap
scores, merge duplicate companies, keep history. All database changes happen in one transaction: if anything
fails, it is rolled back, the job is marked failed and live data is unchanged.

Usage:
  python ingest_job.py --job 12              # process a queued job created by the admin page
  python ingest_job.py --initial FILE.xls    # first load (no per-row history or feed items)
"""
import argparse
import json
import logging
import os
import shutil
import sys
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "pipeline"))

from db import connect  # noqa: E402
from build import build  # noqa: E402
from loader import apply_out  # noqa: E402
from notify import notify_team  # noqa: E402

log = logging.getLogger("ingest")
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(HERE, "..", "data"))
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(HERE, "..", "uploads"))
NEMLIT = os.environ.get("NEMLIT_FILE", os.path.join(DATA_DIR, "raw", "tz_nemlit_ocr.txt"))
WHO = os.environ.get("WHO_FILE", os.path.join(DATA_DIR, "raw", "who_eml_2025.txt"))
MIN_RATIO = 0.6   # a new export with fewer than 60% of the last one's active products is rejected


def team_decisions(cur):
    from norm import company_key
    aliases = {}
    for alias, ckey in cur.execute("""select a.alias, c.cluster_key from company_aliases a join companies c on c.id = a.company_id
                                       where a.source = 'team'""").fetchall():
        aliases[company_key(alias) or alias] = ckey
    separate = {frozenset(r) for r in cur.execute("select a_key, b_key from company_keep_separate").fetchall()}
    matches = dict(cur.execute("""select a.alias, m.canonical_key from molecule_aliases a join molecules m on m.id = a.molecule_id
                                  where a.source = 'team'""").fetchall())
    return aliases, separate, matches


def run(job_id):
    with connect() as conn:
        job = conn.execute("select id, kind, file_path, file_name, country from registry_uploads where id = %s for update", (job_id,)).fetchone()
        if job is None:
            raise SystemExit(f"job {job_id} not found")
        conn.execute("update registry_uploads set status = 'running', started_at = now(), error = null where id = %s", (job_id,))
        conn.commit()
    _, kind, path, name, country = job
    out = tempfile.mkdtemp(prefix=f"ingest-{job_id}-")
    try:
        with connect() as conn:
            cur = conn.cursor()
            if kind == "recompute":  # rebuild from the last applied file with the team's latest decisions
                row = cur.execute("""select file_path from registry_uploads where status = 'applied' and file_path is not null
                                     and country = %s order by finished_at desc limit 1""", (country,)).fetchone()
                if not row:
                    raise ValueError("No applied upload to recompute from")
                path = row[0]
            if not path or not os.path.exists(path):
                raise ValueError(f"Uploaded file not found: {name}")
            aliases, separate, matches = team_decisions(cur)
            summary = build(path, NEMLIT, WHO, out, company_aliases=aliases, keep_separate=separate, manual_matches=matches)
            prev = cur.execute("""select (summary->>'human_active')::int from registry_uploads where status = 'applied'
                                  and country = %s order by finished_at desc limit 1""", (country,)).fetchone()
            if prev and prev[0] and summary["human_active"] < MIN_RATIO * prev[0]:
                raise ValueError(f"Only {summary['human_active']} active products against {prev[0]} last time. "
                                 "This looks like a partial export, so nothing was changed.")
            diff = apply_out(conn, out, job_id, country, initial=(kind == "initial"))
            cur.execute("""update registry_uploads set status = 'applied', finished_at = now(), rows = %s,
                           diff = %s, summary = %s where id = %s""",
                        (summary["registry_rows"], json.dumps(diff), json.dumps(summary), job_id))
            conn.commit()   # the only commit: everything above is one transaction
        log.info("job %s applied: %s", job_id, diff)
        return diff
    except Exception as e:
        log.error("job %s failed: %s", job_id, e)
        msg = str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}"
        with connect() as conn:  # the failed transaction was rolled back when its connection closed
            conn.execute("update registry_uploads set status = 'failed', finished_at = now(), error = %s where id = %s",
                         (msg[:2000], job_id))
            notify_team(conn.cursor(), "Registry upload failed", f"Upload #{job_id} ({name}) was rolled back: {msg[:300]}")
            conn.commit()
        if os.environ.get("INGEST_DEBUG"):
            traceback.print_exc()
        raise
    finally:
        shutil.rmtree(out, ignore_errors=True)


def create_job(file_path, kind="upload", uploaded_by=None, country="TZ"):
    os.makedirs(os.path.join(UPLOAD_DIR, "registry"), exist_ok=True)
    with connect() as conn:  # the insert is committed only after the copy succeeds
        jid = conn.execute("""insert into registry_uploads (country, kind, uploaded_by, file_name, status)
                              values (%s, %s, %s, %s, 'queued') returning id""",
                           (country, kind, uploaded_by, os.path.basename(file_path))).fetchone()[0]
        dest = os.path.join(UPLOAD_DIR, "registry", f"{jid}-{os.path.basename(file_path)}")
        shutil.copyfile(file_path, dest)   # raises before commit, so no orphan job row is left behind
        conn.execute("update registry_uploads set file_path = %s where id = %s", (dest, jid))
        conn.commit()
    return jid


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    a = argparse.ArgumentParser()
    a.add_argument("--job", type=int)
    a.add_argument("--initial")
    a.add_argument("--upload")
    x = a.parse_args()
    if x.initial:
        print(json.dumps(run(create_job(x.initial, "initial")), indent=1))
    elif x.upload:
        print(json.dumps(run(create_job(x.upload, "upload")), indent=1))
    elif x.job:
        print(json.dumps(run(x.job), indent=1))
    else:
        a.print_help()
