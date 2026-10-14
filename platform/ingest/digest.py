"""Weekly summary for manufacturers, by email and WhatsApp (each customer's settings decide which goes out).

Once a week per manufacturer: new competitors in the molecules they watch or sell, in their markets, and what moved on
the work Nazryx does for them. Nothing to say means nothing is sent; the clock still moves on. Companies stay anonymous.
"""
import logging

log = logging.getLogger("digest")
WEEK = "7 days"


def summary(cur, user_id, countries):
    """The lines of one manufacturer's weekly summary (empty when nothing happened)."""
    lines = []
    if countries:
        rows = cur.execute("""
            select k.name, count(distinct r.id) filter (where h.change = 'added'),
                   count(distinct r.id) filter (where h.change in ('removed', 'status'))
            from registration_history h join registrations r on r.id = h.registration_id join countries k on k.code = r.country
            where h.created_at > now() - interval '7 days' and r.country = any(%s)
              and (r.molecule_id in (select molecule_id from watches where user_id = %s)
                   or r.molecule_id in (select molecule_id from mfr_products where user_id = %s and molecule_id is not null))
            group by k.name order by k.name""", (countries, user_id, user_id)).fetchall()
        for name, added, gone in rows:
            bits = []
            if added:
                bits.append(f"{added} new competitor {'registration' if added == 1 else 'registrations'}")
            if gone:
                bits.append(f"{gone} lapsed or withdrawn")
            if bits:
                lines.append(f"{name}: {' and '.join(bits)} in your molecules.")
        tenders = cur.execute("""
            select count(*) filter (where t.stage = 'open'), count(*) from tenders t
            where t.country = any(%s) and t.updated_at > now() - interval '7 days'
              and exists (select 1 from mfr_products p where p.user_id = %s and p.molecule_id = any(t.molecule_ids))""",
            (countries, user_id)).fetchone()
        if tenders and tenders[1]:
            lines.append(f"{tenders[1]} public {'tender' if tenders[1] == 1 else 'tenders'} for your molecules this week"
                         + (f", {tenders[0]} still open." if tenders[0] else "."))
    moved = cur.execute("""select count(*) from engagements where user_id = %s and updated_at > now() - interval '7 days'""",
                        (user_id,)).fetchone()[0]
    if moved:
        lines.append(f"{moved} of your Nazryx projects moved forward this week.")
    due = cur.execute("""select count(*) from obligations where user_id = %s and not done and due_date < current_date + 30""",
                      (user_id,)).fetchone()[0]
    if due:
        lines.append(f"{due} renewal or compliance {'date is' if due == 1 else 'dates are'} due within 30 days.")
    return lines


def send_weekly(cur, limit=200):
    """Queue this week's summary for every manufacturer whose last one is a week old. Returns how many were queued."""
    due = cur.execute(f"""
        select p.user_id, p.target_countries from manufacturer_profiles p join users u on u.id = p.user_id
        where u.account_type = 'manufacturer' and coalesce(u.disabled, false) = false and p.completed_at is not null
          and coalesce(p.digest_sent_at, p.completed_at) < now() - interval '{WEEK}'
        order by p.digest_sent_at nulls first limit %s""", (limit,)).fetchall()
    sent = 0
    for user_id, countries in due:
        lines = summary(cur, user_id, list(countries or []))
        if lines:
            body = " ".join(lines) + " Open your Nazryx portal for the detail."
            cur.execute("""insert into notifications (user_id, channel, subject, body)
                           values (%s, 'email', 'Your week on Nazryx', %s), (%s, 'whatsapp', 'Your week on Nazryx', %s)""",
                        (user_id, body, user_id, body))
            sent += 1
        cur.execute("update manufacturer_profiles set digest_sent_at = now() where user_id = %s", (user_id,))
    if sent:
        log.info("queued %s weekly summaries", sent)
    return sent


def call_reminders(cur):
    """A reminder the day before each booked call, to the customer (email and WhatsApp) and the team. Once per call."""
    calls = cur.execute("""update call_bookings set reminded_at = now()
                           where status = 'booked' and reminded_at is null and starts_at between now() and now() + interval '24 hours'
                           returning id, user_id, starts_at, meeting_link""").fetchall()
    for _id, user_id, starts_at, link in calls:
        when = starts_at.strftime("%d %b, %H:%M UTC")
        body = f"Your call with Nazryx is on {when}." + (f" Join here: {link}" if link else " We send the meeting link before the call.")
        cur.execute("""insert into notifications (user_id, channel, subject, body)
                       values (%s, 'email', 'Your call with Nazryx tomorrow', %s), (%s, 'whatsapp', 'Your call with Nazryx', %s),
                              (null, 'email', 'Call within 24 hours', %s)""",
                    (user_id, body, user_id, body, f"Call on {when}{'' if link else ': add the meeting link in Admin > Calls'}."))
    return len(calls)
