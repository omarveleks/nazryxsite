"""Integration tests: ingest job (diff, upsert, merge, history, rollback) and row-level security.

Needs a Postgres server. Set TEST_DATABASE_URL_ADMIN to a superuser/owner URL whose database can be dropped
and recreated, e.g. postgresql://nazryx:pw@localhost:5432/nazryx_test. Skipped when not set.
"""
import importlib
import os
import uuid

import psycopg
import pytest
from psycopg import sql

URL = os.environ.get("TEST_DATABASE_URL_ADMIN")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL_ADMIN not set")

HEADER = ["No", "Product Category", "Certificate Number", "Brand Name", "Classification", "Generic Name", "Dosage Form",
          "National ID No", "Active Pharmaceutical Ingredients", "Product Strength", "Registrant", "Registrant Country",
          "Local Technical Represenatative", "Manufacturer", "Manufacturing Country", "Registration Status"]
MOLS = ["Amoxicillin", "Paracetamol", "Metformin Hydrochloride", "Ciprofloxacin", "Omeprazole", "Amlodipine",
        "Ceftriaxone Sodium", "Ibuprofen", "Sodium Chloride", "Fluconazole", "Atenolol", "Salbutamol"]
LTRS = ["ALPHA PHARMA LIMITED", "Alpha Pharma Ltd", "Beta Distributors (T) Ltd", "GAMMA HEALTHCARE LTD"]


def registry_rows(n=130, extra=(), cancel=()):
    rows = []
    for i in range(n):
        cert = f"TAN 2{i % 6} HM {i:04d}"
        status = "Cancelled/Withdrawn" if cert in cancel else "Registered/Compliant"
        rows.append([str(i + 1), "Medicines", cert, f"Brand{i}", "Human Medicinal Product", MOLS[i % len(MOLS)], "Tablet", "",
                     "", "500", f"Maker {i % 7} Ltd", "INDIA", LTRS[i % len(LTRS)], f"Maker {i % 7} Ltd", "INDIA", status])
    for j, (mol, ltr) in enumerate(extra):
        rows.append([str(n + j + 1), "Medicines", f"TAN 26 HM 9{j:03d}", f"New{j}", "Human Medicinal Product", mol, "Tablet",
                     "", "", "10", "Maker 1 Ltd", "INDIA", ltr, "Maker 1 Ltd", "INDIA", "Registered/Compliant"])
    return rows


def write_registry(path, rows):
    td = lambda v: f"<td>{v}</td>"
    html = ["<table border='1'><tr><td colspan='12'><b>Registered Products</b></td></tr>",
            "<tr>" + "".join(td(h) for h in HEADER) + "</tr>"]
    html += ["<tr>" + "".join(td(v) for v in r) + "</tr>" for r in rows]
    html.append("</table>")
    path.write_text("\n".join(html))
    return str(path)


NEMLIT = """The National Essential Medicines List 2026 Edition
6.0 Anti-Infective Medicines
Amoxicillin Capsule 250mg A
Ciprofloxacin Tablet 250mg B
Doxycycline Capsule 100mg A
Ceftriaxone Injection 1 g vial B
13.0 Cardiovascular Medicines
Amlodipine Tablet 5mg A
Atenolol Tablet 50mg A
Digoxin Tablet 250mcg c
"""
WHO = "amoxicillin                     Capsule\nciprofloxacin                   Tablet\ndoxycycline\ndigoxin\n"


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("ingest")
    base = psycopg.conninfo.conninfo_to_dict(URL)
    dbname = base.get("dbname") or "nazryx_test"
    with psycopg.connect(psycopg.conninfo.make_conninfo(URL, dbname="postgres"), autocommit=True) as c:
        c.execute(sql.SQL("drop database if exists {} with (force)").format(sql.Identifier(dbname)))
        c.execute(sql.SQL("create database {}").format(sql.Identifier(dbname)))
    (tmp / "nemlit.txt").write_text(NEMLIT)
    (tmp / "who.txt").write_text(WHO)
    os.environ.update(DATABASE_URL_ADMIN=URL, NEMLIT_FILE=str(tmp / "nemlit.txt"), WHO_FILE=str(tmp / "who.txt"),
                      UPLOAD_DIR=str(tmp / "uploads"), APP_DB_PASSWORD="test-only-" + uuid.uuid4().hex[:8])
    import migrate
    import ingest_job
    importlib.reload(ingest_job)
    migrate.migrate()
    return {"tmp": tmp, "job": ingest_job}


def q(sql_text, *args):
    with psycopg.connect(URL) as c:
        return c.execute(sql_text, args).fetchall()


def test_initial_load_then_diffed_upload(env):
    tmp, job = env["tmp"], env["job"]
    first = write_registry(tmp / "r1.xls", registry_rows())
    job.run(job.create_job(first, "initial"))
    assert q("select count(*) from registrations where active")[0][0] == 130
    # the two spellings of Alpha Pharma are one company
    alpha = q("select count(distinct ltr_id) from registrations r join company_aliases a on a.company_id = r.ltr_id "
              "where a.alias in ('ALPHA PHARMA LIMITED', 'Alpha Pharma Ltd')")[0][0]
    assert alpha == 1
    # essential molecules with no registrations score highest; Digoxin is level C and unregistered
    top = q("select m.inn, g.score from gap_scores g join molecules m on m.id = g.molecule_id order by g.score desc, m.inn")
    assert top[0] == ("Doxycycline", 30) and ("Digoxin", 28.2) in [(n, float(s)) for n, s in top]
    before_scores = dict(q("select m.inn, g.score from gap_scores g join molecules m on m.id = g.molecule_id"))

    # second upload: 2 new doxycycline products (one from a new distributor), one product cancelled, one removed
    rows = registry_rows(n=129, extra=[("Doxycycline", "Delta Medics Ltd"), ("Doxycycline", "Beta Distributors (T) Ltd")],
                         cancel={"TAN 20 HM 0006"})
    second = write_registry(tmp / "r2.xls", rows)
    diff = job.run(job.create_job(second, "upload"))
    assert diff["new_registrations"] == 2
    assert diff["removed_or_cancelled"] == 2          # row 129 missing + TAN 20 HM 0006 cancelled
    assert diff["new_distributors"] == 1
    assert diff["gap_scores_moved"] >= 1
    after = dict(q("select m.inn, g.score from gap_scores g join molecules m on m.id = g.molecule_id"))
    assert float(after["Doxycycline"]) < float(before_scores["Doxycycline"])
    changes = dict(q("select change, count(*) from registration_history group by change"))
    assert changes["added"] == 2 and changes["removed"] == 1 and changes["status"] == 1
    assert q("select count(*) from feed_items where kind = 'registration'")[0][0] == 2


def test_failed_upload_rolls_back(env):
    tmp, job = env["tmp"], env["job"]
    before = q("select count(*), sum(id) from registrations where active")[0]
    gaps_before = q("select sum(score) from gap_scores")[0]
    # a partial export (far fewer rows than last time) must be rejected
    partial = write_registry(tmp / "partial.xls", registry_rows(n=110))
    rows_before = q("select count(*) from registrations")[0][0]
    job.MIN_RATIO = 0.9
    try:
        jid = job.create_job(partial, "upload")
        with pytest.raises(ValueError):
            job.run(jid)
    finally:
        job.MIN_RATIO = 0.6
    # a file that is not the registry at all
    bad = tmp / "bad.xls"
    bad.write_text("<table><tr><td>No</td><td>Something</td></tr><tr><td>1</td><td>x</td></tr></table>")
    jid2 = job.create_job(str(bad), "upload")
    with pytest.raises(Exception):
        job.run(jid2)
    status = dict(q("select id, status from registry_uploads where id in (%s, %s)", jid, jid2))
    assert status == {jid: "failed", jid2: "failed"}
    assert q("select count(*), sum(id) from registrations where active")[0] == before
    assert q("select count(*) from registrations")[0][0] == rows_before
    assert q("select sum(score) from gap_scores")[0] == gaps_before
    assert q("select error from registry_uploads where id = %s", jid)[0][0].startswith("Only")


def app_conn(env):
    info = psycopg.conninfo.conninfo_to_dict(URL)
    return psycopg.connect(psycopg.conninfo.make_conninfo(URL, user="nazryx_app", password=os.environ["APP_DB_PASSWORD"]))


def as_user(conn, uid):
    conn.execute("select set_config('app.user_id', %s, true)", (str(uid) if uid else "",))


def test_supplier_confidentiality_rls(env):
    with psycopg.connect(URL) as c:   # owner: create users, a supplier, an offer and two quotes
        cust = c.execute("insert into users (email, password_hash) values ('c@example.com', 'x') returning id").fetchone()[0]
        other = c.execute("insert into users (email, password_hash) values ('o@example.com', 'x') returning id").fetchone()[0]
        team = c.execute("insert into users (email, password_hash, role) values ('t@example.com', 'x', 'team') returning id").fetchone()[0]
        mol = c.execute("select id from molecules where inn = 'Doxycycline'").fetchone()[0]
        sup = c.execute("insert into suppliers (name, country) values ('Secret Supplier', 'IN') returning id").fetchone()[0]
        c.execute("insert into supplier_notes (supplier_id, notes) values (%s, 'internal')", (sup,))
        sup2 = c.execute("insert into suppliers (name, country) values ('Other Supplier', 'CN') returning id").fetchone()[0]
        off = c.execute("insert into supplier_offers (supplier_id, molecule_id, price) values (%s, %s, 1.25) returning id", (sup, mol)).fetchone()[0]
        off2 = c.execute("insert into supplier_offers (supplier_id, molecule_id, price) values (%s, %s, 0.99) returning id", (sup2, mol)).fetchone()[0]
        req = c.execute("insert into requests (user_id, molecule_id, quantity) values (%s, %s, '10000') returning id", (cust, mol)).fetchone()[0]
        q1 = c.execute("insert into quotes (request_id, supplier_offer_id, label) values (%s, %s, 'Supplier A') returning id", (req, off)).fetchone()[0]
        c.execute("insert into quotes (request_id, supplier_offer_id, label) values (%s, %s, 'Supplier B')", (req, off2))
        c.commit()

    with app_conn(env) as a:
        as_user(a, cust)
        assert a.execute("select count(*) from suppliers").fetchone()[0] == 0
        assert a.execute("select count(*) from supplier_offers").fetchone()[0] == 0
        assert a.execute("select label from quotes order by label").fetchall() == [("Supplier A",), ("Supplier B",)]
        assert a.execute("select count(*) from accepted_supplier").fetchone()[0] == 0
        assert a.execute("select molecule_supply_confirmed(%s)", (mol,)).fetchone()[0] is None   # free plan: hidden
        # RLS: the team-only update policy matches no rows for a customer, so nothing changes
        assert a.execute("update quotes set accepted = true where id = %s", (q1,)).rowcount == 0
        assert a.execute("update supplier_offers set price = 0 where id = %s", (off,)).rowcount == 0
        a.rollback()

        as_user(a, other)   # another customer cannot accept someone else's quote
        with pytest.raises(psycopg.errors.RaiseException):
            a.execute("select accept_quote(%s)", (q1,))
        a.rollback()

        as_user(a, cust)
        a.execute("select accept_quote(%s)", (q1,))
        assert a.execute("select name from suppliers").fetchall() == [("Secret Supplier",)]   # only the accepted one
        assert a.execute("select price from supplier_offers").fetchall()[0][0] == 1.25
        assert a.execute("select supplier_name, price from accepted_supplier").fetchall() == [("Secret Supplier", 1.25)]
        assert a.execute("select count(*) from supplier_notes").fetchone()[0] == 0
        assert a.execute("select stage from requests where id = %s", (req,)).fetchone()[0] == "Closed"
        a.commit()

        as_user(a, other)
        assert a.execute("select count(*) from suppliers").fetchone()[0] == 0
        assert a.execute("select count(*) from quotes").fetchone()[0] == 0
        assert a.execute("select count(*) from requests").fetchone()[0] == 0
        a.rollback()

        as_user(a, team)
        assert a.execute("select count(*) from suppliers").fetchone()[0] == 2
        assert a.execute("select count(*) from supplier_notes").fetchone()[0] == 1
        a.rollback()

        as_user(a, None)   # signed out sees nothing private
        assert a.execute("select count(*) from quotes").fetchone()[0] == 0
        assert a.execute("select count(*) from users").fetchone()[0] == 0


def test_free_plan_limits_in_database(env):
    with psycopg.connect(URL) as c:
        u = c.execute("insert into users (email, password_hash, credits) values ('f@example.com', 'x', 1) returning id").fetchone()[0]
        mols = [r[0] for r in c.execute("select id from molecules order by id limit 6").fetchall()]
        comps = [r[0] for r in c.execute("select id from companies order by id limit 4").fetchall()]
        c.commit()
    with app_conn(env) as a:
        as_user(a, u)
        assert a.execute("select enrich_molecule(%s)", (mols[0],)).fetchone()[0] == 0
        assert a.execute("select enrich_molecule(%s)", (mols[0],)).fetchone()[0] == 0     # re-open is free
        with pytest.raises(psycopg.errors.RaiseException):
            a.execute("select enrich_molecule(%s)", (mols[1],))
        a.rollback()
        as_user(a, u)
        for i in range(5):
            a.execute("insert into requests (user_id, molecule_id) values (%s, %s)", (u, mols[i]))
        with pytest.raises(psycopg.errors.RaiseException):
            a.execute("insert into requests (user_id, molecule_id) values (%s, %s)", (u, mols[5]))
        a.rollback()
        as_user(a, u)
        for cid in comps[:3]:
            a.execute("insert into follows (user_id, company_id) values (%s, %s)", (u, cid))
        with pytest.raises(psycopg.errors.RaiseException):
            a.execute("insert into follows (user_id, company_id) values (%s, %s)", (u, comps[3]))
        a.rollback()
        as_user(a, u)   # customers cannot change their own plan or credits
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            a.execute("update users set plan = 'paid' where id = %s", (u,))
