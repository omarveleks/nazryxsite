"""Notification hooks. Every message is written to the `notifications` outbox.

Email goes out over SMTP when EMAIL_PROVIDER=smtp and SMTP_HOST are set. WhatsApp goes out through the WhatsApp Business
Cloud API when WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are set; WHATSAPP_TEMPLATE names an approved message template with one
body variable (WhatsApp only allows free text inside 24 hours of the customer's last message). Without them both channels
are logged as stubbed. Secrets stay in the deployment environment, never in the repository.
"""
import json
import logging
import os
import re
import urllib.request

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


def whatsapp_payload(to, body, template=None, lang="en"):
    """The Cloud API message: a template with the text as its one variable, or plain text. Template variables may not
    contain line breaks, tabs or long runs of spaces."""
    number = re.sub(r"\D", "", to or "")
    if template:
        text = re.sub(r"\s+", " ", body).strip()[:1000]
        return {"messaging_product": "whatsapp", "to": number, "type": "template",
                "template": {"name": template, "language": {"code": lang},
                             "components": [{"type": "body", "parameters": [{"type": "text", "text": text}]}]}}
    return {"messaging_product": "whatsapp", "to": number, "type": "text", "text": {"body": body[:4000]}}


def send_whatsapp(to, body):
    token, phone_id = os.environ.get("WHATSAPP_TOKEN"), os.environ.get("WHATSAPP_PHONE_ID")
    if not (token and phone_id and re.sub(r"\D", "", to or "")):
        log.info("[whatsapp stub] to=%s body=%s", to, body[:80])
        return "stubbed"
    payload = whatsapp_payload(to, body, os.environ.get("WHATSAPP_TEMPLATE"), os.environ.get("WHATSAPP_TEMPLATE_LANG", "en"))
    version = os.environ.get("WHATSAPP_API_VERSION", "v21.0")
    req = urllib.request.Request(f"https://graph.facebook.com/{version}/{phone_id}/messages", data=json.dumps(payload).encode(),
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return "sent" if 200 <= r.status < 300 else "failed"
    except Exception as e:  # never log the token; the status code and message are enough
        log.warning("whatsapp send failed: %s", getattr(e, "code", type(e).__name__))
        return "failed"


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
    wa_status = "stubbed"
    for p in phones:
        wa_status = send_whatsapp(p, f"{subject}: {body}")
    cur.execute("insert into notifications (user_id, channel, subject, body, status, sent_at) values (null, 'email', %s, %s, %s, now())",
                (subject, body, status))
    cur.execute("insert into notifications (user_id, channel, subject, body, status, sent_at) values (null, 'whatsapp', %s, %s, %s, now())",
                (subject, body, wa_status))


def deliver_queued(cur):
    """Send queued notifications (written by the web app and the worker) through the providers."""
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
            status = send_whatsapp(wa, f"{subj}: {body}" if subj else body)
        cur.execute("update notifications set status = %s, sent_at = now() where id = %s", (status, nid))
    return len(rows)
