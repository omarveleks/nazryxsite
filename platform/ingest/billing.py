"""Billing: applies payment events (from the Stripe webhook, or a plan the team switched on by hand) and issues the
documents that go with them: an order confirmation when a plan starts, an invoice for every payment. Documents are
stored like any upload and appear in the customer's Settings > Documents. No card data ever reaches this code."""
import html
import json
import logging
from datetime import datetime, timedelta, timezone

log = logging.getLogger("billing")

ISSUER = "Nazryx, a company of Nazir & Company International (PVT) Limited"
CONTACT = "contact@nazryx.com"


def settings(cur):
    """Our details as the team set them in Admin > Billing (defaults when the table is not there yet)."""
    try:
        cur.execute("savepoint st")
        r = cur.execute("""select issuer, address, tax_id, email, phone, payment_details, footer, terms_days, prefix, recurring
                           from invoice_settings where id = 1""").fetchone()
        cur.execute("release savepoint st")
    except Exception:
        cur.execute("rollback to savepoint st")
        r = None
    keys = ("issuer", "address", "tax_id", "email", "phone", "payment_details", "footer", "terms_days", "prefix", "recurring")
    return dict(zip(keys, r)) if r else dict(zip(keys, (ISSUER, None, None, CONTACT, None, None, None, 14, "NZX", True)))


def esc(t):
    return html.escape(t or "").replace("\n", "<br>")


PLANS = {
    "data": ("Basic Market Data", ["Complete market data", "Target distributor lists", "Portfolio analysis", "Market watch on your molecules"]),
    "access": ("Complete Market Access", ["Everything in Basic Market Data",
                                          "Distributor portfolio matching, and the potential to supply them", "Pricing analysis",
                                          "Documentation and regulatory check", "Pathway to approval"]),
    "entry": ("Complete Market Entry", ["Everything in Complete Market Access", "Distributor sourcing, done for you",
                                        "Regulatory submissions and approvals, done for you (government fees paid by you)",
                                        "Sales forecasts and strategic review", "One contact and weekly reports per market"]),
}


def money(cents, currency="usd"):
    if cents is None:
        return "As agreed with you"
    return f"{currency.upper()} {cents / 100:,.2f}"


def page(title, body, st=None):
    """A self-contained, printable HTML document in the Nazryx style (flat, Inter, blue), with our details."""
    st = st or {"issuer": ISSUER, "email": CONTACT}
    who = " · ".join(x for x in (esc(st["issuer"]), esc(st.get("address")), (f"Tax / registration no. {esc(st['tax_id'])}" if st.get("tax_id") else ""),
                                 esc(st["email"]), esc(st.get("phone"))) if x)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>body{{font-family:Inter,Arial,sans-serif;color:#141413;max-width:720px;margin:40px auto;padding:0 24px;line-height:1.5}}
h1{{font-size:28px;margin:24px 0 4px}}.muted{{color:#5E5E58}}table{{width:100%;border-collapse:collapse;margin:20px 0}}
td,th{{text-align:left;padding:10px 0;border-bottom:1px solid #ECEAE3}}td.r,th.r{{text-align:right}}
.brand{{color:#0066FF;font-weight:700;font-size:20px}}.box{{background:#F7F6F2;border-radius:12px;padding:16px;margin:20px 0}}
@page{{size:A4;margin:16mm}}@media print{{body{{margin:0 auto}}}}</style>
</head><body><div class="brand"><svg viewBox="0 0 837 346" width="40" height="17" aria-hidden="true" style="vertical-align:-2px;margin-right:8px"><path d="M171 0 L403 0 L613 210 L613 0 L837 0 L837 198 L689 346 L461 346 L295 179 L131 346 L0 346 L0 174 Z" fill="#0066FF"/></svg><span style="color:#141413">Nazryx</span></div>{body}{f'<p class="muted" style="margin-top:24px">{esc(st.get("footer"))}</p>' if st.get("footer") else ''}
<p class="muted" style="margin-top:40px">{who}</p></body></html>"""


def store_document(cur, user_id, kind, title, file_name, content, team_id=None):
    data = content.encode("utf-8")
    fid = cur.execute("insert into stored_files (name, size, data, uploaded_by) values (%s, %s, %s, %s) returning id",
                      (file_name, len(data), data, team_id)).fetchone()[0]
    return cur.execute("""insert into account_documents (user_id, kind, title, file_path, file_name, uploaded_by)
                          values (%s, %s, %s, %s, %s, %s) returning id""",
                       (user_id, kind, title, f"db:{fid}", file_name, team_id)).fetchone()[0]


def customer(cur, user_id):
    r = cur.execute("""select u.email, u.name, coalesce(p.company_name, u.name, u.email), p.hq_country
                       from users u left join manufacturer_profiles p on p.user_id = u.id where u.id = %s""", (user_id,)).fetchone()
    return {"email": r[0], "name": r[1], "company": r[2], "country": r[3] or ""} if r else None


def next_number(cur, when, prefix="NZX"):
    n = cur.execute("select count(*) + 1 from invoices where extract(year from issued_at) = %s", (when.year,)).fetchone()[0]
    while cur.execute("select 1 from invoices where number = %s", (f"{prefix}-{when.year}-{n:04d}",)).fetchone():
        n += 1
    return f"{prefix}-{when.year}-{n:04d}"


def country_names(cur, codes):
    if not codes:
        return []
    names = dict(cur.execute("select code, name from countries where code = any(%s)", (list(codes),)).fetchall())
    return [names.get(c, c) for c in codes]


def order_confirmation(cur, user_id, plan, amount_cents, paid_by_card, when, markets=None, interval="month"):
    c = customer(cur, user_id)
    if plan == "market":
        name, includes = f"Extra market: {', '.join(country_names(cur, markets))}", ["Everything in your plan, for this market too"]
    else:
        name, includes = PLANS[plan]
        if markets and plan != "entry":
            includes = includes + [f"Markets: {', '.join(country_names(cur, markets))}"]
    items = "".join(f"<li>{html.escape(i)}</li>" for i in includes)
    per = " per year" if interval == "year" else " per month"
    body = f"""<h1>Order confirmation</h1><p class="muted">{when:%d %B %Y}</p>
<table><tr><td>For</td><td class="r">{html.escape(c['company'])}<br><span class="muted">{html.escape(c['email'])}</span></td></tr>
<tr><td>Plan</td><td class="r"><b>{html.escape(name)}</b></td></tr>
<tr><td>Price</td><td class="r">{money(amount_cents)}{per if amount_cents else ''}</td></tr>
<tr><td>Billing</td><td class="r">{('Annual' if interval == 'year' else 'Monthly') + (', by card' if paid_by_card else ', invoiced by Nazryx')}</td></tr>
<tr><td>Starts</td><td class="r">{when:%d %B %Y}</td></tr></table>
<div class="box"><b>What is included</b><ul>{items}</ul></div>
<p class="muted">Government and regulator fees are paid by you, at cost. Questions about this order: {esc(settings(cur)["email"])}.</p>"""
    title = f"Order confirmation: {name}"
    return store_document(cur, user_id, "agreement", title, f"Order confirmation {name} {when:%Y-%m-%d}.html", page(title, body, settings(cur)))


def invoice(cur, user_id, plan, amount_cents, currency, paid, when, markets=None, lines=None, note=None, period=None):
    """Writes the invoice, files it in the customer's documents and records it. `lines`: [{text, qty, unit_cents}]."""
    st = settings(cur)
    c = customer(cur, user_id)
    if not lines:
        name = (f"Extra market: {', '.join(country_names(cur, markets))}" if plan == "market"
                else PLANS.get(plan, (plan or "Nazryx services",))[0])
        lines = [{"text": f"{name}, {when:%B %Y}", "qty": 1, "unit_cents": amount_cents}]
    if all(x.get("unit_cents") is not None for x in lines):
        amount_cents = sum(round(float(x.get("qty") or 1) * x["unit_cents"]) for x in lines)
    number = next_number(cur, when, st["prefix"])
    due = None if paid else when + timedelta(days=st["terms_days"])
    status = "Paid" if paid else f"Due by {due:%d %B %Y}"
    rows = "".join(f"""<tr><td>{esc(x['text'])}</td><td class="r">{float(x.get('qty') or 1):g}</td>
<td class="r">{money(x.get('unit_cents'), currency)}</td>
<td class="r">{money(None if x.get('unit_cents') is None else round(float(x.get('qty') or 1) * x['unit_cents']), currency)}</td></tr>""" for x in lines)
    pay = (f'<div class="box"><b>How to pay</b><br>{esc(st["payment_details"])}<br><span class="muted">Please quote {number}.</span></div>'
           if st.get("payment_details") else '<p>Your Nazryx contact sends the payment details.</p>')
    body = f"""<h1>Invoice {number}</h1><p class="muted">Issued {when:%d %B %Y} · {status}</p>
<table><tr><td>From</td><td class="r">{esc(st['issuer'])}{('<br><span class="muted">' + esc(st['address']) + '</span>') if st.get('address') else ''}{('<br><span class="muted">Tax / registration no. ' + esc(st['tax_id']) + '</span>') if st.get('tax_id') else ''}</td></tr>
<tr><td>Billed to</td><td class="r">{html.escape(c['company'])}<br><span class="muted">{html.escape(c['email'])}{(' · ' + html.escape(c['country'])) if c['country'] else ''}</span></td></tr></table>
<table><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Amount</th></tr>{rows}
<tr><td colspan="3"><b>Total</b></td><td class="r"><b>{money(amount_cents, currency)}</b></td></tr></table>
{f'<p>{esc(note)}</p>' if note else ''}{'' if paid else pay}"""
    doc = store_document(cur, user_id, "invoice", f"Invoice {number}", f"Invoice {number}.html", page(f"Invoice {number}", body, st))
    cur.execute("""insert into invoices (number, user_id, plan, amount_cents, currency, status, issued_at, due_at, document_id, lines,
                   paid_at, interval_key) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (number, user_id, plan, amount_cents, currency, "paid" if paid else "due", when, due, doc, json.dumps(lines),
                 when if paid else None, period))
    notify(cur, user_id, f"Invoice {number}", f"Invoice {number} for {money(amount_cents, currency)} is in Settings, Documents."
           + ("" if paid else f" Due by {due:%d %B %Y}."))
    return number


def orders(cur):
    """Invoices the team wrote in Admin > Billing."""
    for oid, uid, lines, currency, note, paid in cur.execute("""select id, user_id, lines, currency, note, paid from invoice_orders
                                                               where processed_at is null and error is null order by id limit 20""").fetchall():
        try:
            cur.execute("savepoint io")
            n = invoice(cur, uid, None, None, currency, paid, datetime.now(timezone.utc), lines=lines, note=note)
            cur.execute("update invoice_orders set processed_at = now(), number = %s where id = %s", (n, oid))
            cur.execute("release savepoint io")
        except Exception as e:
            cur.execute("rollback to savepoint io")
            cur.execute("update invoice_orders set error = %s where id = %s", (str(e)[:500], oid))
            log.exception("invoice order %s failed", oid)


def recurring(cur):
    """Invoiced plans (not paid by card): the next invoice when a billing period has passed since the last one,
    for the same amount. A plan with no invoice yet waits for the team's first one."""
    if not settings(cur)["recurring"]:
        return 0
    due = cur.execute("""select p.user_id, p.active_plan, i.amount_cents, i.currency, coalesce(p.billing_interval, 'month')
                         from manufacturer_profiles p
                         join lateral (select amount_cents, currency, issued_at from invoices x where x.user_id = p.user_id
                                       and x.plan = p.active_plan order by issued_at desc limit 1) i on true
                         where p.active_plan is not null and p.stripe_subscription is null and i.amount_cents is not null
                           and i.issued_at + case when p.billing_interval = 'year' then interval '1 year' else interval '1 month' end
                               <= now()""").fetchall()
    now = datetime.now(timezone.utc)
    for uid, plan, cents, currency, per in due:
        period = f"{now:%Y}" if per == "year" else f"{now:%Y-%m}"
        if cur.execute("select 1 from invoices where user_id = %s and plan = %s and interval_key = %s", (uid, plan, period)).fetchone():
            continue
        label = f"{PLANS.get(plan, (plan,))[0]}, {now:%Y}" if per == "year" else f"{PLANS.get(plan, (plan,))[0]}, {now:%B %Y}"
        invoice(cur, uid, plan, cents, currency, False, now, lines=[{"text": label, "qty": 1, "unit_cents": cents}], period=period)
    return len(due)


def notify(cur, user_id, subject, body):
    cur.execute("insert into notifications (user_id, channel, subject, body) values (%s, 'email', %s, %s)", (user_id, subject, body))


def set_markets(cur, user_id):
    """The markets a plan covers: those bought with the plan (kept in paid_markets) plus every active extra market."""
    cur.execute("""update manufacturer_profiles p set paid_markets = (
                     select coalesce(array_agg(distinct m order by m), '{}') from (
                       select unnest(p.paid_markets) as m
                       union select country from market_subscriptions s where s.user_id = p.user_id and s.active) x)
                   where p.user_id = %s""", (user_id,))


def apply(cur, ev):
    eid, kind, user_id, plan, amount, currency, customer_id, sub, markets, interval = ev
    now = datetime.now(timezone.utc)
    interval = interval or "month"
    if kind == "checkout_completed" and plan == "market":
        country = (markets or [None])[0]
        cur.execute("""insert into market_subscriptions (user_id, country, stripe_subscription) values (%s, %s, %s)
                       on conflict (stripe_subscription) do update set active = true, ended_at = null""", (user_id, country, sub))
        cur.execute("update manufacturer_profiles set paid_markets = array_append(paid_markets, %s) where user_id = %s and not (%s = any(paid_markets))",
                    (country, user_id, country))
        order_confirmation(cur, user_id, plan, amount, True, now, [country], interval)
        notify(cur, user_id, "Market added", f"{', '.join(country_names(cur, [country]))} is now in your plan.")
    elif kind == "checkout_completed":
        cur.execute("""update manufacturer_profiles set active_plan = %s, active_since = now(), stripe_customer = %s,
                       stripe_subscription = %s, billing_interval = %s,
                       paid_markets = case when cardinality(%s::text[]) > 0 then %s::text[]
                                           when primary_market is not null then array[primary_market] else target_countries[1:1] end
                       where user_id = %s""", (plan, customer_id, sub, interval, markets or [], markets or [], user_id))
        set_markets(cur, user_id)
        cur.execute("update plan_requests set status = 'done' where user_id = %s and status = 'open' and wanted like 'mfr:%%'", (user_id,))
        order_confirmation(cur, user_id, plan, amount, True, now, markets, interval)
        notify(cur, user_id, "Your plan is active", f"{PLANS[plan][0]} is active. Everything it includes is unlocked.")
    elif kind == "invoice_paid":
        ms = cur.execute("select user_id, country from market_subscriptions where stripe_subscription = %s", (sub,)).fetchone()
        if ms:
            invoice(cur, ms[0], "market", amount, currency or "usd", True, now, [ms[1]])
            return
        if not plan:
            row = cur.execute("select active_plan from manufacturer_profiles where stripe_subscription = %s", (sub,)).fetchone()
            plan = row[0] if row else None
        if not user_id:
            row = cur.execute("select user_id from manufacturer_profiles where stripe_subscription = %s", (sub,)).fetchone()
            user_id = row[0] if row else None
        if user_id:
            invoice(cur, user_id, plan, amount, currency or "usd", True, now)
    elif kind == "subscription_ended":
        ms = cur.execute("""update market_subscriptions set active = false, ended_at = now() where stripe_subscription = %s
                            returning user_id, country""", (sub,)).fetchone()
        if ms:
            cur.execute("update manufacturer_profiles set paid_markets = array_remove(paid_markets, %s) where user_id = %s", (ms[1], ms[0]))
            notify(cur, ms[0], "Market removed", f"{', '.join(country_names(cur, [ms[1]]))} has left your plan. Its data locks again; your products stay.")
            return
        row = cur.execute("""update manufacturer_profiles set active_plan = null, active_since = null, stripe_subscription = null,
                             paid_markets = '{}' where stripe_subscription = %s returning user_id""", (sub,)).fetchone()
        if row:
            notify(cur, row[0], "Your plan has ended", "Your subscription has ended. Your data stays; locked screens open again when you resubscribe.")
    elif kind == "markets_changed":
        cur.execute("update manufacturer_profiles set paid_markets = %s where user_id = %s", (markets or [], user_id))
        set_markets(cur, user_id)
    elif kind == "manual_activation":
        if markets:
            cur.execute("update manufacturer_profiles set paid_markets = %s, billing_interval = %s where user_id = %s", (markets, interval, user_id))
        else:
            cur.execute("""update manufacturer_profiles set paid_markets = target_countries, billing_interval = %s
                           where user_id = %s and cardinality(paid_markets) = 0""", (interval, user_id))
        order_confirmation(cur, user_id, plan, amount, False, now, markets, interval)
        invoice(cur, user_id, plan, amount, currency or "usd", False, now)


def process(cur):
    """Apply every unprocessed payment event, oldest first. A failing event is marked with its error and skipped."""
    events = cur.execute("""select id, kind, user_id, plan, amount_cents, currency, stripe_customer, stripe_subscription,
                                   markets, billing_interval
                            from payment_events where processed_at is null and error is null order by id limit 50""").fetchall()
    for ev in events:
        try:
            cur.execute("savepoint ev")
            apply(cur, ev)
            cur.execute("update payment_events set processed_at = now() where id = %s", (ev[0],))
            cur.execute("release savepoint ev")
        except Exception as e:  # keep going; the team sees the error on the event
            cur.execute("rollback to savepoint ev")
            cur.execute("update payment_events set error = %s where id = %s", (str(e)[:500], ev[0]))
            log.exception("payment event %s failed", ev[0])
    orders(cur)
    cur.execute("savepoint rec")
    try:
        recurring(cur)
    except Exception:
        cur.execute("rollback to savepoint rec")
        log.exception("recurring invoices failed")
    return len(events)
