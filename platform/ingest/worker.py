#!/usr/bin/env python3
"""Background worker: runs queued ingest jobs (oldest first), applies payments, delivers queued notifications through the stubbed
providers, sends the weekly manufacturer summary and the 48-hour upload reminder, and reads regulatory documents. Wakes on NOTIFY 'ingest' or every POLL_SECONDS."""
import logging
import os
import time

from db import connect
import billing
import catalogue
import digest
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
        catalogue.run(cur)            # catalogues (Excel, Word, PDF) into the manufacturer's products
        billing.process(cur)          # plans switched on or off, invoices and order confirmations
        digest.send_weekly(cur)       # the weekly summary for manufacturers (email and WhatsApp)
        digest.call_reminders(cur)    # the day before a booked call
        notify.deliver_queued(cur)
        for (code,) in cur.execute("select code from countries where enabled").fetchall():
            reminder.check_and_remind(cur, code)
        reminder.remind_questions(cur)
        conn.commit()
    if not row and os.environ.get("COLLECT", "1") != "0":
        try:
            import collect
            with connect() as conn:
                collect.run(conn)         # the next due source: registers weekly, tenders daily, prices every 3 days
        except Exception:
            log.exception("collector failed")
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            import reg_extract
            reg_extract.run()         # drafts requirements from uploaded regulatory documents; the team publishes them
        except Exception:
            log.exception("regulatory reading failed")
    return bool(row)


def init_monitoring():
    """Error monitoring (Sentry), off unless SENTRY_DSN is set. Logged errors (failed jobs, crashed ticks) are sent."""
    if os.environ.get("SENTRY_DSN"):
        import sentry_sdk
        sentry_sdk.init(dsn=os.environ["SENTRY_DSN"], environment=os.environ.get("SENTRY_ENVIRONMENT", "production"),
                        send_default_pii=False, traces_sample_rate=0)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    init_monitoring()
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
        # a source run cut off by the restart (a deploy, a crash) saved nothing: it runs again
        n = conn.execute("""update data_sources set running_since = null, run_now = true,
                            last_error = 'Interrupted (worker restarted); runs again now'
                            where running_since is not null""").rowcount
        conn.commit()
        if n:
            log.warning("re-queued %s interrupted source run(s)", n)
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
