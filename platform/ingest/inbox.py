"""The inbox: what moved in a manufacturer's markets and on its molecules since we last looked, one item per event.

Every hour, for every manufacturer: new registrations and competitors on its molecules and the molecules it watches
(registration_history), tenders on its molecules or matching its keywords, prices that moved more than a tenth in a week
(price_history), requirements the regulatory team published, and regulator notices naming its products. Each item is
written once (user, key). Once a day, the unread items go out as one email for those who want email.
"""
import logging

log = logging.getLogger("inbox")
PRICE_MOVE = 0.10          # a price change worth telling (a tenth either way, over seven days)
EVERY = "55 minutes"


def markets_of(cur, user_id):
    row = cur.execute("""select coalesce(target_countries, '{}'), coalesce(paid_markets, '{}'), trial_market, active_plan, trial_until
                         from manufacturer_profiles where user_id = %s""", (user_id,)).fetchone()
    if not row:
        return []
    targets, paid, trial, plan, trial_until = row
    return sorted(set(targets) | set(paid) | ({trial} if trial else set()))


def build(cur, user_id, since):
    """Write this manufacturer's new items since `since`. Returns how many."""
    countries = markets_of(cur, user_id)
    if not countries:
        return 0
    n = 0

    def put(kind, key, title, body=None, link=None, country=None, molecule=None):
        nonlocal n
        cur.execute("""insert into inbox_items (user_id, kind, country, molecule_id, title, body, link, key)
                       values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict (user_id, key) do nothing""",
                    (user_id, kind, country, molecule, title[:200], (body or "")[:600] or None, link, key))
        n += cur.rowcount

    # registrations added or gone on the molecules they sell or watch, in their markets
    for rid, change, country, mid, inn, brand, made, cname, mine in cur.execute("""
        select r.id, h.change, r.country, r.molecule_id, m.inn, r.brand, initcap(lower(coalesce(r.manufacturing_country, ''))), k.name,
               exists (select 1 from mfr_products p where p.user_id = %(u)s and p.molecule_id = r.molecule_id)
        from registration_history h join registrations r on r.id = h.registration_id join molecules m on m.id = r.molecule_id
        join countries k on k.code = r.country
        where h.created_at > %(since)s and r.country = any(%(c)s) and h.change in ('added', 'removed', 'status')
          and (r.molecule_id in (select molecule_id from watches where user_id = %(u)s)
               or r.molecule_id in (select molecule_id from mfr_products where user_id = %(u)s and molecule_id is not null))
        order by h.created_at desc limit 200""", dict(u=user_id, since=since, c=countries)).fetchall():
        if change == "added":
            put("competitor", f"reg:{rid}:added", f"New {inn} registered in {cname}",
                f"{'A product of yours' if mine else 'A molecule you watch'}: another {inn}{f' made in {made}' if made else ''} was registered in {cname}.",
                f"/m/products?tab=watch&market={country}", country, mid)
        else:
            put("registration", f"reg:{rid}:{change}", f"An {inn} registration lapsed in {cname}",
                f"One fewer competitor for {inn} in {cname}: a registration was removed or changed status.", f"/m/products?market={country}", country, mid)

    # tenders on their molecules, or matching a keyword they watch
    for tid, country, title, buyer, stage, when, cname, mine in cur.execute("""
        select t.id, t.country, coalesce(t.title_en, t.title), coalesce(t.buyer_en, t.buyer), t.stage, coalesce(t.closing, t.published), k.name,
               exists (select 1 from mfr_products p where p.user_id = %(u)s and p.molecule_id = any(t.molecule_ids))
        from tenders t join countries k on k.code = t.country
        where t.updated_at > %(since)s and t.country = any(%(c)s)
          and (exists (select 1 from mfr_products p where p.user_id = %(u)s and p.molecule_id = any(t.molecule_ids))
               or exists (select 1 from tender_watches w where w.user_id = %(u)s and coalesce(t.title_en, t.title) ilike '%%' || w.term || '%%'))
        order by t.updated_at desc limit 100""", dict(u=user_id, since=since, c=countries)).fetchall():
        put("tender", f"tender:{tid}:{stage}", f"{'Open tender' if stage == 'open' else stage.capitalize() + ' tender'} in {cname}: {title[:80]}",
            f"{buyer or 'A public buyer'}{f', closing {when:%d %b %Y}' if when and stage == 'open' else ''}. {'On a molecule you sell.' if mine else 'Matches a keyword you watch.'}",
            f"/m/tenders/{tid}", country)

    # prices that moved a tenth or more in a week on their molecules
    for country, mid, inn, cname, now_p, then_p, ccy in cur.execute("""
        select h.country, h.molecule_id, m.inn, k.name, h.unit_price, b.unit_price, k.currency
        from price_history h join price_history b on b.country = h.country and b.molecule_id = h.molecule_id and b.day = h.day - 7
        join molecules m on m.id = h.molecule_id join countries k on k.code = h.country
        where h.day = current_date and h.country = any(%(c)s) and h.confidence <> 'estimated' and b.confidence <> 'estimated'
          and h.molecule_id in (select molecule_id from mfr_products where user_id = %(u)s and molecule_id is not null)
          and abs(h.unit_price / nullif(b.unit_price, 0) - 1) >= %(move)s""", dict(u=user_id, c=countries, move=PRICE_MOVE)).fetchall():
        pct = (float(now_p) / float(then_p) - 1) * 100
        put("price", f"price:{country}:{mid}:{cur.execute('select current_date').fetchone()[0]}", f"{inn} is {abs(pct):.0f}% {'dearer' if pct > 0 else 'cheaper'} in {cname}",
            f"The shelf price moved from {ccy} {float(then_p):,.2f} to {ccy} {float(now_p):,.2f} per unit over the last week.",
            f"/m/products?market={country}", country, mid)

    # requirements published by the regulatory team in their markets
    for rq, country, topic, title, cname in cur.execute("""
        select r.id, r.country, r.topic, r.title, k.name from reg_requirements r join countries k on k.code = r.country
        where r.status = 'published' and r.updated_at > %(since)s and r.country = any(%(c)s) order by r.updated_at desc limit 50""",
            dict(since=since, c=countries)).fetchall():
        put("regulatory", f"req:{rq}", f"{cname}: {title[:90]}", f"A requirement under {topic} was published or updated.", f"/m/regulatory?market={country}", country)

    # saved searches: a molecule that newly matches one
    for sid, sname, country, params, seen, cname in cur.execute("""
        select s.id, s.name, s.country, s.params, s.seen_ids, k.name from saved_searches s join countries k on k.code = s.country
        where s.user_id = %(u)s and (s.checked_at is null or s.checked_at < now() - interval '50 minutes')""", dict(u=user_id)).fetchall():
        p = params or {}
        found = {mid: inn for mid, inn in cur.execute("""select molecule_id, inn from find_opportunities(%s, %s, %s, %s, %s, %s, %s, false, false)""",
                                                     (country, p.get("category"), p.get("demand"), p.get("max"), bool(p.get("essential")), p.get("form"), p.get("price"))).fetchall()}
        new = sorted(set(found) - set(seen or []))
        if seen is not None and new:         # the first run only records what is there
            inns = ", ".join(found[m] for m in new[:6]) + (f" and {len(new) - 6} more" if len(new) > 6 else "")
            put("opportunity", f"search:{sid}:{cur.execute('select current_date').fetchone()[0]}:{len(new)}",
                f"{len(new)} new {'molecule matches' if len(new) == 1 else 'molecules match'} \"{sname}\" in {cname}",
                f"{inns}.", f"/m/finder?market={country}&" + "&".join(f"{k}={1 if v is True else v}" for k, v in p.items() if v is not None and v is not False and v != ""), country)
        cur.execute("update saved_searches set seen_ids = %s, checked_at = now() where id = %s", (sorted(found), sid))

    # dates a week away: renewals and obligations, task due dates, target launches, their own calendar entries
    for key, kind_label, title, when, country, link in cur.execute("""
        select 'ob' || o.id, o.kind, coalesce(m.inn, p.name), o.due_date, o.country, '/m/calendar' from obligations o
          left join mfr_products p on p.id = o.product_id left join molecules m on m.id = p.molecule_id where o.user_id = %(u)s and not o.done
        union all
        select 'tk' || k.id, 'task', k.title, k.due_date, pr.country, '/m/projects/' || pr.id from project_tasks k join projects pr on pr.id = k.project_id
          where pr.user_id = %(u)s and k.done_at is null and k.due_date is not null
        union all
        select 'tg' || pr.id, 'target launch', coalesce(m.inn, p.name), pr.target_date, pr.country, '/m/projects/' || pr.id from projects pr
          join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id where pr.user_id = %(u)s and pr.target_date is not null and pr.stage <> 'launched'
        union all
        select 'ce' || e.id, replace(e.kind, '_', ' '), e.title, e.on_date, e.country, '/m/calendar' from calendar_entries e where e.user_id = %(u)s""",
            dict(u=user_id)).fetchall():
        if when is None:
            continue
        days = (when - cur.execute("select current_date").fetchone()[0]).days
        if days < 0 or days > 7:
            continue
        label = {"renewal": "Renewal", "variation": "Variation", "safety_report": "Safety report", "other": "Obligation", "task": "Task", "own": "Your date",
                 "gmp expiry": "GMP certificate expires", "registration expiry": "Registration expires", "meeting": "Meeting", "target launch": "Target launch date"}.get(kind_label, kind_label.capitalize())
        put("deadline", f"due:{key}:{when}", f"{label}: {title[:80]} {'today' if days == 0 else 'tomorrow' if days == 1 else f'in {days} days'}",
            f"Due {when:%d %b %Y}.", link, country)

    # regulator notices naming their products
    cur.execute("savepoint inbox_news")
    try:
        for nid, country, title, cname in cur.execute("""
            select n.id, n.country, n.title, k.name from reg_news n join countries k on k.code = n.country
            where not n.baseline and n.found_at > %(since)s and n.country = any(%(c)s)
              and exists (select 1 from mfr_products p where p.user_id = %(u)s and p.molecule_id = any(n.molecule_ids))
            order by n.found_at desc limit 50""", dict(u=user_id, since=since, c=countries)).fetchall():
            put("notice", f"news:{nid}", f"Regulator notice in {cname} names your product", (title or "")[:300], f"/m/regulatory?market={country}", country)
        cur.execute("release savepoint inbox_news")
    except Exception:                      # no reg_news yet in this database
        cur.execute("rollback to savepoint inbox_news")
    return n


def run(cur, limit=300):
    """Build items for every manufacturer not looked at for an hour. Returns how many items were written."""
    total = 0
    for (uid, since) in cur.execute(f"""select p.user_id, coalesce(p.inbox_checked_at, now() - interval '14 days') from manufacturer_profiles p
                                        join users u on u.id = p.user_id where not u.disabled
                                        and (p.inbox_checked_at is null or p.inbox_checked_at < now() - interval '{EVERY}')
                                        order by p.inbox_checked_at nulls first limit %s""", (limit,)).fetchall():
        cur.execute("savepoint inbox_user")
        try:
            total += build(cur, uid, since)
            cur.execute("update manufacturer_profiles set inbox_checked_at = now() where user_id = %s", (uid,))
            cur.execute("release savepoint inbox_user")
        except Exception:
            cur.execute("rollback to savepoint inbox_user")
            log.exception("inbox for %s failed", uid)
    return total


def mail_daily(cur, limit=200):
    """Once a day, the unread items as one email for manufacturers who take email. Returns how many were queued."""
    n = 0
    for uid, email, name, items in cur.execute("""
        select u.id, u.email, coalesce(p.company_name, u.name), (select count(*) from inbox_items i where i.user_id = u.id and i.read_at is null
                                                                 and i.created_at > coalesce(p.inbox_mailed_at, now() - interval '1 day'))
        from users u join manufacturer_profiles p on p.user_id = u.id
        where not u.disabled and u.notify_email and (p.inbox_mailed_at is null or p.inbox_mailed_at < now() - interval '23 hours')
        limit %s""", (limit,)).fetchall():
        cur.execute("update manufacturer_profiles set inbox_mailed_at = now() where user_id = %s", (uid,))
        if not items:
            continue
        lines = [t for (t,) in cur.execute("""select title from inbox_items where user_id = %s and read_at is null
                                              order by created_at desc limit 12""", (uid,)).fetchall()]
        body = f"{name}, {items} {'thing' if items == 1 else 'things'} moved in your markets:\n\n" + "\n".join(f"- {t}" for t in lines)
        if items > len(lines):
            body += f"\n- and {items - len(lines)} more"
        body += "\n\nOpen your inbox: /m/inbox"
        cur.execute("insert into notifications (user_id, channel, subject, body) values (%s, 'email', %s, %s)",
                    (uid, f"{items} {'thing' if items == 1 else 'things'} moved in your markets", body))
        n += 1
    return n
