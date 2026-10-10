"""48-hour registry upload reminder. Overdue = no applied upload in the last 48 hours.
The team is reminded once per 48-hour window (email + WhatsApp, stubbed in notify.py)."""
from datetime import datetime, timedelta, timezone

from notify import notify_team

INTERVAL = timedelta(hours=48)


def status(cur, country="TZ", now=None):
    now = now or datetime.now(timezone.utc)
    last = cur.execute("select max(finished_at) from registry_uploads where country = %s and status = 'applied'",
                       (country,)).fetchone()[0]
    if last is None:
        return {"last": None, "due_at": now, "overdue": True, "hours_since": None}
    due = last + INTERVAL
    return {"last": last, "due_at": due, "overdue": now >= due, "hours_since": (now - last).total_seconds() / 3600}


def check_and_remind(cur, country="TZ", now=None):
    now = now or datetime.now(timezone.utc)
    st = status(cur, country, now)
    if not st["overdue"]:
        return False
    last_sent = cur.execute("select max(sent_at) from reminders_log where kind = %s", (f"registry_upload_{country}",)).fetchone()[0]
    if last_sent and now - last_sent < INTERVAL and (st["last"] is None or last_sent > st["last"]):
        return False
    since = "never uploaded" if st["last"] is None else f"last upload {st['hours_since']:.0f} hours ago"
    notify_team(cur, "Registration list update overdue",
                f"The registry export for {country} is overdue ({since}). Upload the new .xls on the admin page.")
    cur.execute("insert into reminders_log (kind, detail) values (%s, jsonb_build_object('hours_since', %s::numeric))",
                (f"registry_upload_{country}", st["hours_since"]))
    return True
