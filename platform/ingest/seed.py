#!/usr/bin/env python3
"""Seed demo accounts and demo activity on top of the loaded registry data.

  python seed.py                 # needs the registry loaded first (ingest_job.py --initial ...)

Accounts (emails can be changed with env vars):
  SEED_TEAM_EMAIL   (default team@nazryx.test)      role team
  DEMO_FREE_EMAIL   (default demo-free@nazryx.test) free plan, portfolio, requests in every stage
  DEMO_PAID_EMAIL   (default demo-paid@nazryx.test) paid plan
Passwords come from SEED_TEAM_PASSWORD / DEMO_PASSWORD. When unset, random ones are generated and printed
once. Nothing secret is written to the repository. Demo suppliers are fictional.
"""
import base64
import hashlib
import os
import secrets

from db import connect
from loader import recompute_gaps

COUNTRY = "TZ"


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=16384, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)
    return f"scrypt$16384$8$1${base64.b64encode(salt).decode()}${base64.b64encode(h).decode()}"


def password(var):
    pw = os.environ.get(var)
    generated = not pw
    return (pw or secrets.token_urlsafe(12)), generated


def upsert_user(cur, email, name, pw, generated=False, **cols):
    """Create the account, or update it. A generated password never overwrites an existing one."""
    row = cur.execute("select id from users where email = %s", (email,)).fetchone()
    if row:
        uid = row[0]
        if not generated:
            cur.execute("update users set password_hash = %s where id = %s", (hash_password(pw), uid))
    else:
        uid = cur.execute("insert into users (email, name, password_hash, onboarded) values (%s, %s, %s, true) returning id",
                          (email, name, hash_password(pw))).fetchone()[0]
    for k, v in cols.items():
        cur.execute(f"update users set {k} = %s where id = %s", (v, uid))
    return uid


def mol(cur, name):
    r = cur.execute("""select m.id from molecules m join country_molecules cm on cm.molecule_id = m.id and cm.country = %s
                       where lower(m.inn) = lower(%s) order by cm.registrations desc limit 1""", (COUNTRY, name)).fetchone()
    return r[0] if r else None


def seed():
    with connect() as conn:
        cur = conn.cursor()
        if not cur.execute("select 1 from registry_uploads where status = 'applied' limit 1").fetchone():
            raise SystemExit("Load the registry first: python ingest_job.py --initial <export.xls>")
        team_pw, g1 = password("SEED_TEAM_PASSWORD")
        demo_pw, g2 = password("DEMO_PASSWORD")
        new_team = not cur.execute("select 1 from users where email = %s", (os.environ.get("SEED_TEAM_EMAIL", "team@nazryx.test"),)).fetchone()
        new_demo = not cur.execute("select 1 from users where email = %s", (os.environ.get("DEMO_FREE_EMAIL", "demo-free@nazryx.test"),)).fetchone()
        team = upsert_user(cur, os.environ.get("SEED_TEAM_EMAIL", "team@nazryx.test"), "Nazryx team", team_pw, g1, role="team", plan="paid")
        free = upsert_user(cur, os.environ.get("DEMO_FREE_EMAIL", "demo-free@nazryx.test"), "Demo Distributor", demo_pw, g2,
                           credits=17, whatsapp="+255 700 000 000", notify_whatsapp=True)
        paid = upsert_user(cur, os.environ.get("DEMO_PAID_EMAIL", "demo-paid@nazryx.test"), "Demo Paid Distributor", demo_pw, g2, plan="paid")
        g1, g2 = g1 and new_team, g2 and new_demo   # only print passwords that were actually set now

        already = cur.execute("select count(*) from requests where user_id = %s", (free,)).fetchone()[0]
        if already:
            print("demo activity already seeded; passwords updated")
        else:
            # portfolio: the most-registered molecules in two classes, as a typical distributor would carry
            for uid, cats, n in ((free, ("Anti-infective Medicines", "Cardiovascular Medicines"), 14),
                                 (paid, ("Anti-infective Medicines", "Medicines for Diabetes and Related Disorders",
                                         "Medicines for Pain and Palliative Care"), 12)):
                for cat in cats:
                    cur.execute("""insert into portfolio_items (user_id, molecule_id, source)
                                   select %s, m.id, 'demo' from molecules m join country_molecules cm on cm.molecule_id = m.id and cm.country = %s
                                   where m.category = %s and cm.registrations > 0 order by cm.registrations desc limit %s
                                   on conflict do nothing""", (uid, COUNTRY, cat, n))
            cur.execute("""insert into company_claims (user_id, company_name, email_domain, domain_match, portfolio_source, status)
                           values (%s, 'Demo Distributor Ltd', 'nazryx.test', false, 'scratch', 'pending')""", (free,))
            for name in ("Doxycycline", "Ivermectin", "Amoxicillin"):
                m = mol(cur, name)
                if m:
                    cur.execute("insert into enrichments (user_id, molecule_id) values (%s, %s) on conflict do nothing", (free, m))
                    cur.execute("insert into credit_ledger (user_id, delta, reason, molecule_id) values (%s, -1, 'enrich', %s)", (free, m))
            for name in ("Ivermectin", "Doxycycline"):
                m = mol(cur, name)
                if m:
                    cur.execute("insert into watches (user_id, molecule_id) values (%s, %s) on conflict do nothing", (free, m))
            for (cid,) in cur.execute("""select c.id from companies c join company_stats s on s.company_id = c.id
                                         where c.is_ltr order by s.registrations desc limit 2""").fetchall():
                cur.execute("insert into follows (user_id, company_id) values (%s, %s) on conflict do nothing", (free, cid))

            # fictional suppliers (team only)
            sups = []
            for name, country in (("Demo Supplier One", "India"), ("Demo Supplier Two", "China"), ("Demo Supplier Three", "Egypt")):
                sid = cur.execute("insert into suppliers (name, country, contact) values (%s, %s, %s) returning id",
                                  (name, country, "sales@example.com")).fetchone()[0]
                cur.execute("insert into supplier_notes (supplier_id, notes) values (%s, 'Demo supplier for the walkthrough')", (sid,))
                sups.append(sid)

            def request(molecule, stage, qty, notes, days_ago):
                m = mol(cur, molecule)
                rid = cur.execute("""insert into requests (user_id, molecule_id, molecule_text, quantity, unit, target_price, deliver_by,
                                     notes, stage, created_at, updated_at)
                                     values (%s, %s, %s, %s, 'packs', 'USD 1.10 per pack', current_date + 60, %s, %s,
                                             now() - make_interval(days => %s), now() - make_interval(days => %s))
                                     returning id""", (free, m, None if m else molecule, qty, notes, stage, days_ago, max(0, days_ago - 2))).fetchone()[0]
                for s in ("Submitted", "Reviewing", "Suppliers found", "Quote ready", "Closed"):
                    cur.execute("insert into request_stage_history (request_id, stage, changed_by) values (%s, %s, %s)", (rid, s, team))
                    if s == stage:
                        break
                return rid, m

            request("Ceftriaxone", "Submitted", "20,000", "1 g vials, GMP certificate needed.", 1)
            r2, _ = request("Metformin", "Reviewing", "100,000", "500 mg tablets, blister packs.", 4)
            cur.execute("insert into request_messages (request_id, from_team, author_id, body) values (%s, true, %s, %s)",
                        (r2, team, "Thanks. Which pack size do you register under, 10x10 or 3x10?"))
            cur.execute("insert into request_messages (request_id, from_team, author_id, body) values (%s, false, %s, '10x10, please.')", (r2, free))
            request("Amlodipine", "Suppliers found", "60,000", "5 mg and 10 mg.", 7)
            r4, m4 = request("Doxycycline", "Quote ready", "50,000", "100 mg capsules.", 9)
            for i, (sid, price, moq, lt, certs, pvt) in enumerate(((sups[0], 0.95, "20,000 packs", 6, "GMP, WHO PQ", "below"),
                                                                   (sups[1], 1.05, "50,000 packs", 8, "GMP", "at"),
                                                                   (sups[2], 1.30, "10,000 packs", 4, "GMP", "above"))):
                oid = cur.execute("""insert into supplier_offers (supplier_id, molecule_id, price, unit, moq, lead_time_weeks, certs)
                                     values (%s, %s, %s, 'pack', %s, %s, %s) returning id""", (sid, m4, price, moq, lt, certs)).fetchone()[0]
                cur.execute("""insert into quotes (request_id, supplier_offer_id, label, moq, lead_time_weeks, certs, price_vs_target)
                               values (%s, %s, %s, %s, %s, %s, %s)""", (r4, oid, f"Supplier {'ABC'[i]}", moq, lt, certs, pvt))
            cur.execute("insert into request_messages (request_id, from_team, author_id, body) values (%s, true, %s, %s)",
                        (r4, team, "Three quotes are ready. Compare them and accept the one you want."))
            cur.execute("""insert into feed_items (kind, title, link, user_id) values ('request', 'Quote ready on your Doxycycline request', %s, %s)""",
                        (f"/requests/{r4}", free))
            # a finished request: accepted quote and an order in transit
            r5, m5 = request("Ivermectin", "Quote ready", "30,000", "3 mg tablets.", 30)
            oid = cur.execute("""insert into supplier_offers (supplier_id, molecule_id, price, unit, moq, lead_time_weeks, certs)
                                 values (%s, %s, 0.42, 'pack', '10,000 packs', 5, 'GMP') returning id""", (sups[0], m5)).fetchone()[0]
            qid = cur.execute("""insert into quotes (request_id, supplier_offer_id, label, moq, lead_time_weeks, certs, price_vs_target, accepted, accepted_at)
                                 values (%s, %s, 'Supplier A', '10,000 packs', 5, 'GMP', 'below', true, now() - interval '20 days') returning id""",
                              (r5, oid)).fetchone()[0]
            cur.execute("update requests set stage = 'Closed', closed_reason = 'Quote accepted' where id = %s", (r5,))
            cur.execute("insert into request_stage_history (request_id, stage, changed_by) values (%s, 'Closed', %s)", (r5, free))
            cur.execute("insert into orders (request_id, quote_id, status) values (%s, %s, 'In transit')", (r5, qid))
            cur.execute("""insert into feed_items (kind, title, body) values
                           ('regulatory', 'Demo: regulatory notes from the Nazryx team appear here', 'Short updates that matter for registrations and imports.')""")
            cur.execute("insert into plan_requests (user_id, wanted, note) values (%s, 'paid', 'Demo upgrade request')", (free,))
            moved = recompute_gaps(cur, COUNTRY)   # confirmed offers lift actionability for those molecules
            print(f"demo activity seeded; gap scores recomputed ({moved} moved)")
        conn.commit()
    print("\nDemo accounts (sign in at /signup?mode=signin):")
    print(f"  team:      {os.environ.get('SEED_TEAM_EMAIL', 'team@nazryx.test')}" + (f"  password: {team_pw}" if g1 else "  password: from SEED_TEAM_PASSWORD"))
    for e in (os.environ.get("DEMO_FREE_EMAIL", "demo-free@nazryx.test"), os.environ.get("DEMO_PAID_EMAIL", "demo-paid@nazryx.test")):
        print(f"  customer:  {e}" + (f"  password: {demo_pw}" if g2 else "  password: from DEMO_PASSWORD"))


def ensure_team():
    """Make sure the team account exists (used before any data is loaded)."""
    email = os.environ.get("SEED_TEAM_EMAIL", "team@nazryx.test")
    pw, generated = password("SEED_TEAM_PASSWORD")
    with connect() as conn:
        cur = conn.cursor()
        is_new = not cur.execute("select 1 from users where email = %s", (email,)).fetchone()
        upsert_user(cur, email, "Nazryx team", pw, generated, role="team", plan="paid")
        conn.commit()
    if generated and is_new:
        print(f"team account: {email}  password: {pw}")
    elif is_new or not generated:
        print(f"team account: {email}  password: from SEED_TEAM_PASSWORD")


if __name__ == "__main__":
    seed()
