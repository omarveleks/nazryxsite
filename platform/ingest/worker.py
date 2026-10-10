#!/usr/bin/env python3
"""Background worker: runs queued ingest jobs (oldest first), delivers queued notifications through the stubbed
providers and sends the 48-hour upload reminder. Wakes on NOTIFY 'ingest' or every POLL_SECONDS."""
import logging
import os
import time

from db import connect
import ingest_job
import notify
import reminder

POLL = int(os.environ.get("POLL_SECONDS", "15"))
log = logging.getLogger("worker")


def tick():
    with connect() as conn:
        row = conn.execute("""select id from registry_uploads where status = 'queued' order by id limit 1""").fetchone()
    if row:
        try:
            ingest_job.run(row[0])
            if os.environ.get("SEED_DEMO") == "1":
                import seed
                seed.seed()          # once the first registry is loaded (idempotent)
            if os.environ.get("ANTHROPIC_API_KEY") and os.environ.get("CLAUDE_MATCHING", "1") != "0":
                import claude_match
                claude_match.run()   # suggestions only; the team approves them on the admin page
        except Exception:
            pass  # recorded on the job row; keep the worker alive
    with connect() as conn:
        cur = conn.cursor()
        notify.deliver_queued(cur)
        for (code,) in cur.execute("select code from countries where enabled").fetchall():
            reminder.check_and_remind(cur, code)
        conn.commit()
    return bool(row)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    if os.environ.get("RUN_BOOTSTRAP") == "1":   # hosts without a separate init step (see render.yaml)
        import bootstrap
        bootstrap.run()
    with connect() as conn:  # jobs left 'running' by a crash never committed, so live data is unchanged
        n = conn.execute("""update registry_uploads set status = 'failed', finished_at = now(),
                            error = 'Interrupted (worker restarted). Nothing was changed; upload again.'
                            where status = 'running'""").rowcount
        conn.commit()
        if n:
            log.warning("marked %s interrupted job(s) as failed", n)
    listen = connect(autocommit=True)
    listen.execute("listen ingest")
    log.info("worker started, polling every %ss", POLL)
    while True:
        try:
            busy = tick()
        except Exception as e:
            log.exception("tick failed: %s", e)
            busy = False
        if not busy:
            for _ in listen.notifies(timeout=POLL, stop_after=1):
                break


if __name__ == "__main__":
    main()
