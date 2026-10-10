"""Notification hooks. Email and WhatsApp are STUBBED: messages are written to the `notifications` outbox and logged.

To go live, implement send_email / send_whatsapp with your provider (e.g. SMTP or an email API; the WhatsApp
Business Cloud API) and set the matching environment variables. Secrets stay in the deployment environment,
never in the repository.
"""
import logging
import os

log = logging.getLogger("notify")


def send_email(to, subject, body):
    if os.environ.get("EMAIL_PROVIDER") == "smtp" and os.environ.get("SMTP_HOST"):
        import smtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["From"] = os.environ.get("EMAIL_FROM", "contact@nazryx.com")
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "587"))) as s:
            s.starttls()
            if os.environ.get("SMTP_USER"):
                s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASSWORD", ""))
            s.send_message(msg)
        return "sent"
    log.info("[email stub] to=%s subject=%s", to, subject)
    return "stubbed"


def send_whatsapp(to, body):
    # Stub: wire the WhatsApp Business API here (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID).
    log.info("[whatsapp stub] to=%s body=%s", to, body[:80])
    return "stubbed"


def team_recipients(cur):
    emails = [e.strip() for e in os.environ.get("TEAM_ALERT_EMAILS", "").split(",") if e.strip()]
    if not emails:
        emails = [r[0] for r in cur.execute("select email from users where role = 'team'").fetchall()]
    phones = [p.strip() for p in os.environ.get("TEAM_ALERT_WHATSAPP", "").split(",") if p.strip()]
    if not phones:
        phones = [r[0] for r in cur.execute("select whatsapp from users where role = 'team' and whatsapp is not null").fetchall()]
    return emails, phones


def notify_team(cur, subject, body):
    """Email + WhatsApp to the Nazryx team, recorded in the outbox."""
    emails, phones = team_recipients(cur)
    status = "stubbed"
    for e in emails:
        status = send_email(e, subject, body)
    for p in phones:
        send_whatsapp(p, f"{subject}: {body}")
    cur.execute("insert into notifications (user_id, channel, subject, body, status, sent_at) values (null, 'email', %s, %s, %s, now())",
                (subject, body, status))
    cur.execute("insert into notifications (user_id, channel, subject, body, status, sent_at) values (null, 'whatsapp', %s, %s, 'stubbed', now())",
                (subject, body))


def deliver_queued(cur):
    """Send queued customer notifications (written by the web app) through the stubbed providers."""
    rows = cur.execute("""select n.id, n.channel, n.subject, n.body, u.email, u.whatsapp, u.notify_email, u.notify_whatsapp
                          from notifications n left join users u on u.id = n.user_id
                          where n.status = 'queued' order by n.id limit 200""").fetchall()
    for nid, ch, subj, body, email, wa, n_email, n_wa in rows:
        status = "stubbed"
        if email is None:  # team notification queued by the app
            emails, phones = team_recipients(cur)
            for e in emails:
                status = send_email(e, subj or "Nazryx", body)
        elif ch == "email" and n_email:
            status = send_email(email, subj or "Nazryx", body)
        elif ch == "whatsapp" and n_wa and wa:
            status = send_whatsapp(wa, body)
        cur.execute("update notifications set status = %s, sent_at = now() where id = %s", (status, nid))
    return len(rows)
