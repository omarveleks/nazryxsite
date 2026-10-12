"""Billing: applies payment events (from the Stripe webhook, or a plan the team switched on by hand) and issues the
documents that go with them: an order confirmation when a plan starts, an invoice for every payment. Documents are
stored like any upload and appear in the customer's Settings > Documents. No card data ever reaches this code."""
import html
import logging
from datetime import datetime, timedelta, timezone

log = logging.getLogger("billing")

ISSUER = "Nazryx, a company of Nazir & Company International (PVT) Limited"
CONTACT = "contact@nazryx.com"
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


def page(title, body):
    """A self-contained, printable HTML document in the Nazryx style (flat, Inter, blue)."""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>body{{font-family:Inter,Arial,sans-serif;color:#141413;max-width:720px;margin:40px auto;padding:0 24px;line-height:1.5}}
h1{{font-size:28px;margin:24px 0 4px}}.muted{{color:#5E5E58}}table{{width:100%;border-collapse:collapse;margin:20px 0}}
td,th{{text-align:left;padding:10px 0;border-bottom:1px solid #ECEAE3}}td.r,th.r{{text-align:right}}
.brand{{color:#0066FF;font-weight:700;font-size:20px}}.box{{background:#F7F6F2;border-radius:12px;padding:16px;margin:20px 0}}</style>
</head><body><div class="brand">Nazryx</div>{body}<p class="muted" style="margin-top:40px">{html.escape(ISSUER)} · {CONTACT}</p></body></html>"""


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


def next_number(cur, when):
    n = cur.execute("select count(*) + 1 from invoices where extract(year from issued_at) = %s", (when.year,)).fetchone()[0]
    return f"NZX-{when.year}-{n:04d}"


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
<p class="muted">Government and regulator fees are paid by you, at cost. Questions about this order: {CONTACT}.</p>"""
    title = f"Order confirmation: {name}"
    return store_document(cur, user_id, "agreement", title, f"Order confirmation {name} {when:%Y-%m-%d}.html", page(title, body))


def invoice(cur, user_id, plan, amount_cents, currency, paid, when, markets=None):
    c = customer(cur, user_id)
    name = (f"Extra market: {', '.join(country_names(cur, markets))}" if plan == "market"
            else PLANS.get(plan, (plan or "Nazryx services",))[0])
    number = next_number(cur, when)
    due = None if paid else when + timedelta(days=14)
    status = "Paid by card" if paid else f"Due by {due:%d %B %Y}"
    body = f"""<h1>Invoice {number}</h1><p class="muted">Issued {when:%d %B %Y} · {status}</p>
<table><tr><td>Billed to</td><td class="r">{html.escape(c['company'])}<br><span class="muted">{html.escape(c['email'])}{(' · ' + html.escape(c['country'])) if c['country'] else ''}</span></td></tr></table>
<table><tr><th>Item</th><th class="r">Amount</th></tr>
<tr><td>{html.escape(name)}, {when:%B %Y}</td><td class="r">{money(amount_cents, currency)}</td></tr>
<tr><td><b>Total</b></td><td class="r"><b>{money(amount_cents, currency)}</b></td></tr></table>
{'' if paid else f'<p>Please pay by {due:%d %B %Y}. Your Nazryx contact sends the payment details.</p>'}"""
    doc = store_document(cur, user_id, "invoice", f"Invoice {number}", f"Invoice {number}.html", page(f"Invoice {number}", body))
    cur.execute("""insert into invoices (number, user_id, plan, amount_cents, currency, status, issued_at, due_at, document_id)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (number, user_id, plan, amount_cents, currency, "paid" if paid else "due", when, due, doc))
    return number


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
    return len(events)
