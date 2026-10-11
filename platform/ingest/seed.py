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


DEMO_DOC = b"Demo document. Test data, not a real document."


def seed_manufacturer(cur, maker, team):
    """A fictional manufacturer with a small catalogue and two engagements, to show the manufacturer side."""
    cur.execute("""insert into manufacturer_profiles (user_id, company_name, hq_country, certifications, target_countries, status, reviewed_at)
                   values (%s, 'Demo Generics Manufacturing', 'India', '{WHO GMP,PIC/S}', '{TZ,KE,KZ}', 'approved', now())
                   on conflict (user_id) do nothing""", (maker,))
    # the onboarding answers (also on demo databases seeded before onboarding asked them)
    cur.execute("""update manufacturer_profiles set company_size = '250-1,000 people', contact_role = 'Export or business development',
                   dosage_forms = '{Tablets,Capsules,Oral liquids}', therapeutic_areas = '{Anti-infectives,Cardiovascular,Diabetes}',
                   plant_countries = 'India', export_markets = 'Nigeria, Ghana, Vietnam', registered_in = '{}', timeline = '6m',
                   approach = 'partner', goals = '{launch,grow}', services = '{launch,distributor,register,pricing}',
                   launch_scope = 'data_first', step = 7, suggested_plan = 'access', completed_at = coalesce(completed_at, now())
                   where user_id = %s and completed_at is null""", (maker,))
    if not cur.execute("select 1 from account_documents where user_id = %s", (maker,)).fetchone():
        fid = cur.execute("""insert into stored_files (name, size, data, uploaded_by) values ('demo-agreement.txt', %s, %s, %s) returning id""",
                          (len(DEMO_DOC), DEMO_DOC, team)).fetchone()[0]
        cur.execute("""insert into account_documents (user_id, kind, title, file_path, file_name, uploaded_by)
                       values (%s, 'agreement', 'Services agreement (demo)', %s, 'demo-agreement.txt', %s)""", (maker, f"db:{fid}", team))
    if cur.execute("select 1 from mfr_products where user_id = %s", (maker,)).fetchone():
        return
    for name, inn, who_pq in (("Doxycycline 100mg capsules", "Doxycycline", True), ("Amoxicillin 500mg capsules", "Amoxicillin", False),
                              ("Glibenclamide 5mg tablets", "Glibenclamide", False), ("Hydralazine 25mg tablets", "Hydralazine", False),
                              ("Metformin 500mg tablets", "Metformin Hydrochloride", False), ("Atenolol 50mg tablets", "Atenolol", False)):
        cur.execute("""insert into mfr_products (user_id, name, molecule_id, strength, dosage_form, who_pq, ctd_ready)
                       values (%s, %s, %s, %s, %s, %s, true)""", (maker, name, mol(cur, inn), name.split()[1], name.split()[-1], who_pq))
    pid = cur.execute("select id from mfr_products where user_id = %s and name like 'Doxycycline%%'", (maker,)).fetchone()[0]
    eid = cur.execute("""insert into engagements (user_id, kind, country, product_id, detail, stage, updated_at)
                         values (%s, 'market_entry', 'TZ', %s, 'Start with doxycycline, then the cardiovascular range.', 'Market assessment', now())
                         returning id""", (maker, pid)).fetchone()[0]
    cur.execute("""insert into engagement_messages (engagement_id, from_team, author_id, body) values (%s, true, %s,
                   'We have started the market assessment. Please upload your doxycycline dossier index in the dossier room.')""", (eid, team))
    cur.execute("""insert into engagements (user_id, kind, country, report_type, detail, due_at)
                   values (%s, 'report', 'KE', 'country', 'Which of our products should go to Kenya first?', now() + interval '20 hours')""", (maker,))


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
        maker = upsert_user(cur, os.environ.get("DEMO_MAKER_EMAIL", "demo-maker@nazryx.test"), "Demo Manufacturer", demo_pw, g2,
                            account_type="manufacturer", plan="paid")
        seed_manufacturer(cur, maker, team)
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
            # a GMP certificate on file that expires soon, to show expiry tracking
            fid = cur.execute("insert into stored_files (name, size, data, uploaded_by) values ('demo-gmp.txt', %s, %s, %s) returning id",
                              (len(DEMO_DOC), DEMO_DOC, team)).fetchone()[0]
            cur.execute("""insert into supplier_documents (supplier_id, kind, product, expires_on, file_path, file_name, uploaded_by)
                           values (%s, 'gmp', 'Oral solids', current_date + 40, %s, 'demo-gmp.txt', %s)""", (sups[0], f"db:{fid}", team))

            def request(molecule, stage, qty, notes, days_ago):
                m = mol(cur, molecule)
                rid = cur.execute("""insert into requests (user_id, molecule_id, molecule_text, quantity, unit, target_price, deliver_by,
                                     notes, stage, created_at, updated_at)
                                     values (%s, %s, %s, %s, 'packs', 'USD 1.10 per pack', current_date + 60, %s, %s,
                                             now() - make_interval(days => %s), now() - make_interval(days => %s))
                                     returning id""", (free, m, None if m else molecule, qty, notes, stage, days_ago, max(0, days_ago - 2))).fetchone()[0]
                for s in ("Product request", "Regulatory check", "Regulatory analysis", "Pricing and logistics", "Registration", "Shipment"):
                    cur.execute("insert into request_stage_history (request_id, stage, changed_by) values (%s, %s, %s)", (rid, s, team))
                    if s == stage:
                        break
                return rid, m

            request("Ceftriaxone", "Product request", "20,000", "1 g vials, GMP certificate needed.", 1)
            r2, _ = request("Metformin", "Regulatory check", "100,000", "500 mg tablets, blister packs.", 4)
            cur.execute("""insert into request_evaluations (request_id, verdict, summary, regulatory_check, evaluated_by)
                           values (%s, 'maybe', 'Widely registered, so price decides. Worth it with a strong supplier.',
                                   'Several companies hold active registrations. No restriction on the product.', %s)""", (r2, team))
            cur.execute("insert into request_messages (request_id, from_team, author_id, body) values (%s, true, %s, %s)",
                        (r2, team, "Thanks. Which pack size do you register under, 10x10 or 3x10?"))
            cur.execute("insert into request_messages (request_id, from_team, author_id, body) values (%s, false, %s, '10x10, please.')", (r2, free))
            r3, _ = request("Amlodipine", "Regulatory analysis", "60,000", "5 mg and 10 mg.", 7)
            cur.execute("""insert into request_evaluations (request_id, verdict, summary, regulatory_check, route, evaluated_by)
                           values (%s, 'go', 'Few competitors and steady demand at every level of care.',
                                   'Three active registrations, none restricted.', 'Abridged dossier with a reference product. About 9 to 12 months.', %s)""",
                        (r3, team))
            r4, m4 = request("Doxycycline", "Pricing and logistics", "50,000", "100 mg capsules.", 9)
            cur.execute("""insert into request_evaluations (request_id, verdict, summary, regulatory_check, route, supply, price_range, evaluated_by)
                           values (%s, 'go', 'Open molecule on the official list; supply is ready.', 'Nobody holds an active registration.',
                                   'Full dossier, about 12 months.', 'Three GMP suppliers, 4 to 8 weeks.', 'USD 0.95-1.30 per pack', %s)""", (r4, team))
            cur.execute("""insert into market_prices (country, molecule_id, price_low, price_high, currency, unit, kind, note)
                           values ('TZ', %s, 1.60, 2.10, 'USD', 'pack', 'suggested', 'Wholesale, pack of 100')""", (m4,))
            for i, (sid, price, moq, lt, certs, pvt) in enumerate(((sups[0], 0.95, "20,000 packs", 6, "GMP, WHO PQ", "below"),
                                                                   (sups[1], 1.05, "50,000 packs", 8, "GMP", "at"),
                                                                   (sups[2], 1.30, "10,000 packs", 4, "GMP", "above"))):
                oid = cur.execute("""insert into supplier_offers (supplier_id, molecule_id, price, unit, moq, lead_time_weeks, certs)
                                     values (%s, %s, %s, 'pack', %s, %s, %s) returning id""", (sid, m4, price, moq, lt, certs)).fetchone()[0]
                cur.execute("""insert into quotes (request_id, supplier_offer_id, label, moq, lead_time_weeks, certs, price_vs_target,
                                                  payment_terms, shelf_life_pct, gmp_by, supplier_type)
                               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                            (r4, oid, f"Supplier {'ABC'[i]}", moq, lt, certs, pvt,
                             ("30% deposit, 70% before shipment", "50% deposit, 50% on arrival", "100% before shipment")[i], (85, 80, 75)[i],
                             ("WHO prequalified", "TMDA inspected", "Other national authority")[i], ("manufacturer", "manufacturer", "trader")[i]))
            cur.execute("insert into request_messages (request_id, from_team, author_id, body) values (%s, true, %s, %s)",
                        (r4, team, "Three quotes are ready. Compare them and accept the one you want."))
            cur.execute("""insert into feed_items (kind, title, link, user_id) values ('request', 'Quote ready on your Doxycycline request', %s, %s)""",
                        (f"/requests/{r4}", free))
            # a finished request: accepted quote and an order in transit
            r5, m5 = request("Ivermectin", "Shipment", "30,000", "3 mg tablets.", 30)
            oid = cur.execute("""insert into supplier_offers (supplier_id, molecule_id, price, unit, moq, lead_time_weeks, certs)
                                 values (%s, %s, 0.42, 'pack', '10,000 packs', 5, 'GMP') returning id""", (sups[0], m5)).fetchone()[0]
            qid = cur.execute("""insert into quotes (request_id, supplier_offer_id, label, moq, lead_time_weeks, certs, price_vs_target, accepted, accepted_at)
                                 values (%s, %s, 'Supplier A', '10,000 packs', 5, 'GMP', 'below', true, now() - interval '20 days') returning id""",
                              (r5, oid)).fetchone()[0]

            cur.execute("""update quotes set payment_terms = %s, shelf_life_pct = 80, gmp_by = 'WHO prequalified',
                           supplier_type = 'manufacturer' where id = %s""", ("30% deposit, 70% before shipment", qid))
            oid5 = cur.execute("insert into orders (request_id, quote_id, status, eta) values (%s, %s, 'Shipped', current_date + 18) returning id",
                               (r5, qid)).fetchone()[0]
            for doc, ready in (("proforma", True), ("invoice", True), ("coa", True), ("packing", True), ("permit", True), ("bl", True), ("insurance", False)):
                cur.execute("insert into shipment_documents (order_id, doc, ready) values (%s, %s, %s)", (oid5, doc, ready))
            cur.execute("insert into request_dossier (request_id, be_status, be_note) values (%s, 'needed', 'Supplier holds a BE study against the reference product.')", (r5,))
            cur.execute("insert into request_dossier (request_id, be_status) values (%s, 'needed')", (r4,))
            for rid, items in ((r5, ("application", "labels", "api", "quality", "stability", "gmp", "cpp", "be", "coa", "samples")),
                               (r4, ("application", "api", "gmp", "cpp"))):
                for it in items:
                    cur.execute("insert into dossier_items (request_id, item, status) values (%s, %s, 'have')", (rid, it))
            cur.execute("insert into dossier_items (request_id, item, status, note) values (%s, 'stability', 'missing', 'Zone IVb data due from the supplier')", (r4,))
            cur.execute("""insert into feed_items (kind, title, body) values
                           ('regulatory', 'Demo: regulatory notes from the Nazryx team appear here', 'Short updates that matter for registrations and imports.')""")
            cur.execute("insert into plan_requests (user_id, wanted, note) values (%s, 'paid', 'Demo upgrade request')", (free,))
            print("demo activity seeded")
        conn.commit()
    print("\nDemo accounts (sign in at /signup?mode=signin):")
    print(f"  team:      {os.environ.get('SEED_TEAM_EMAIL', 'team@nazryx.test')}" + (f"  password: {team_pw}" if g1 else "  password: from SEED_TEAM_PASSWORD"))
    for e in (os.environ.get("DEMO_FREE_EMAIL", "demo-free@nazryx.test"), os.environ.get("DEMO_PAID_EMAIL", "demo-paid@nazryx.test"),
              os.environ.get("DEMO_MAKER_EMAIL", "demo-maker@nazryx.test")):
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
