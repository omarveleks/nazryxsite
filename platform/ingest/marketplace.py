"""The request board: open tenders with a known molecule become requests next to the needs distributors post; tenders that
closed take their request off the board. The SQL function does the work; this runs it once an hour."""
import logging
import time

log = logging.getLogger("marketplace")
EVERY = 3600
_next = 0.0


def run(cur, now=None):
    """Once an hour: add requests for new open tenders and close the ones whose tender closed. Returns rows added or None."""
    global _next
    t = now if now is not None else time.time()
    if t < _next:
        return None
    _next = t + EVERY
    cur.execute("select to_regproc('needs_from_tenders') is not null")
    if not cur.fetchone()[0]:
        return None
    cur.execute("select needs_from_tenders()")
    n = cur.fetchone()[0]
    if n:
        log.info("marketplace: %d tenders added to the request board", n)
    return n
