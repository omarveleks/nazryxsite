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
                      APP_DB_PASSWORD="test-only-" + uuid.uuid4().hex[:8])
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
    assert top[0] == ("Doxycycline", 100) and ("Digoxin", 94) in [(n, float(s)) for n, s in top]
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
        assert a.execute("select stage from requests where id = %s", (req,)).fetchone()[0] == "Registration"   # accepted: on to registration
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


def test_48_hour_reminder(env):
    import reminder
    with psycopg.connect(URL) as c:
        cur = c.cursor()
        cur.execute("update registry_uploads set finished_at = now() - interval '20 hours' where status = 'applied'")
        assert reminder.status(cur)["overdue"] is False
        assert reminder.check_and_remind(cur) is False
        cur.execute("update registry_uploads set finished_at = now() - interval '50 hours' where status = 'applied'")
        st = reminder.status(cur)
        assert st["overdue"] and 49 < st["hours_since"] < 51
        before = cur.execute("select count(*) from notifications where user_id is null").fetchone()[0]
        assert reminder.check_and_remind(cur) is True             # email + WhatsApp to the team (stubbed)
        chans = cur.execute("select channel from notifications where user_id is null order by id desc limit 2").fetchall()
        assert {c[0] for c in chans} == {"email", "whatsapp"}
        assert cur.execute("select count(*) from notifications where user_id is null").fetchone()[0] == before + 2
        assert reminder.check_and_remind(cur) is False            # not again within the same 48-hour window
        c.rollback()


def test_signin_throttle_and_team_password_reset(env):
    with app_conn(env) as a:
        as_user(a, None)
        for _ in range(4):
            a.execute("select auth_record_failure('slow@example.com')")
        assert a.execute("select auth_throttled('Slow@Example.com')").fetchone()[0] is False
        a.execute("select auth_record_failure('slow@example.com')")
        assert a.execute("select auth_throttled('slow@example.com')").fetchone()[0] is True
        assert a.execute("select auth_throttled('other@example.com')").fetchone()[0] is False
        a.execute("select auth_clear_failures('slow@example.com')")
        assert a.execute("select auth_throttled('slow@example.com')").fetchone()[0] is False
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            a.execute("select * from login_failures")
        a.rollback()
    with psycopg.connect(URL) as c:
        cust = c.execute("insert into users (email, password_hash) values ('reset@example.com', 'old') returning id").fetchone()[0]
        team = c.execute("select id from users where role = 'team' limit 1").fetchone()[0]
        c.execute("insert into sessions (token_hash, user_id, expires_at) values ('h1', %s, now() + interval '1 day')", (cust,))
        c.commit()
    with app_conn(env) as a:
        as_user(a, cust)   # a customer cannot reset anyone's password
        with pytest.raises(psycopg.errors.RaiseException):
            a.execute("select admin_reset_password(%s, 'x')", (cust,))
        a.rollback()
        as_user(a, team)
        a.execute("select admin_reset_password(%s, 'newhash')", (cust,))
        a.commit()
    assert q("select password_hash from users where id = %s", cust)[0][0] == "newhash"
    assert q("select count(*) from sessions where user_id = %s", cust)[0][0] == 0


def test_confirmed_supply_does_not_change_the_score(env):
    import loader
    with psycopg.connect(URL) as c:   # the RLS test added a confirmed Doxycycline offer
        mol = c.execute("select id from molecules where inn = 'Doxycycline'").fetchone()[0]
        before = c.execute("select score from gap_scores where molecule_id = %s", (mol,)).fetchone()[0]
        loader.recompute_gaps(c.cursor(), "TZ")
        after = c.execute("select score from gap_scores where molecule_id = %s", (mol,)).fetchone()[0]
        free = c.execute("insert into users (email, password_hash) values ('free2@example.com', 'x') returning id").fetchone()[0]
        paid = c.execute("insert into users (email, password_hash, plan) values ('paid2@example.com', 'x', 'paid') returning id").fetchone()[0]
        c.commit()
    assert before == after
    with app_conn(env) as a:
        seen = []
        for uid in (free, paid):
            as_user(a, uid)
            seen.append(a.execute("select score from visible_gap_scores where molecule_id = %s", (mol,)).fetchone()[0])
        assert seen == [after, after]
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            a.execute("select score from gap_scores")
        a.rollback()


def test_first_upload_into_empty_registry_is_the_baseline(env):
    """A first load sent as a normal upload must not announce every product in the market as new."""
    tmp, job = env["tmp"], env["job"]
    url = psycopg.conninfo.make_conninfo(URL, dbname="nazryx_test_first")
    with psycopg.connect(psycopg.conninfo.make_conninfo(URL, dbname="postgres"), autocommit=True) as c:
        c.execute("drop database if exists nazryx_test_first with (force)")
        c.execute("create database nazryx_test_first")
    import migrate
    os.environ["DATABASE_URL_ADMIN"] = url
    try:
        migrate.migrate()
        diff = job.run(job.create_job(write_registry(tmp / "first.xls", registry_rows()), "upload"))
        with psycopg.connect(url) as c:
            assert c.execute("select count(*) from registrations where active").fetchone()[0] == 130
            assert c.execute("select count(*) from feed_items where kind = 'registration'").fetchone()[0] == 0
            assert c.execute("select count(*) from registration_history").fetchone()[0] == 0
        assert diff["new_distributors"] == 0
    finally:
        os.environ["DATABASE_URL_ADMIN"] = URL
        with psycopg.connect(psycopg.conninfo.make_conninfo(URL, dbname="postgres"), autocommit=True) as c:
            c.execute("drop database if exists nazryx_test_first with (force)")


def test_stored_files_follow_request_access(env):
    with psycopg.connect(URL) as c:
        owner = c.execute("insert into users (email, password_hash) values ('files1@example.com', 'x') returning id").fetchone()[0]
        other = c.execute("insert into users (email, password_hash) values ('files2@example.com', 'x') returning id").fetchone()[0]
        req = c.execute("insert into requests (user_id, quantity) values (%s, '1') returning id", (owner,)).fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, owner)
        fid = a.execute("insert into stored_files (name, size, data, uploaded_by) values ('spec.pdf', 3, 'abc', %s) returning id",
                        (owner,)).fetchone()[0]
        a.execute("insert into request_files (request_id, path, file_name, uploaded_by) values (%s, %s, 'spec.pdf', %s)",
                  (req, f"db:{fid}", owner))
        a.commit()
        as_user(a, owner)
        assert bytes(a.execute("select data from stored_files where id = %s", (fid,)).fetchone()[0]) == b"abc"
        a.rollback()
        as_user(a, other)   # another customer cannot read it, even knowing the id
        assert a.execute("select count(*) from stored_files where id = %s", (fid,)).fetchone()[0] == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):   # nor upload in someone else's name
            a.execute("insert into stored_files (name, size, data, uploaded_by) values ('x', 1, 'x', %s)", (owner,))
        a.rollback()


def test_reference_lists_from_database(env):
    import storage
    tmp = env["tmp"]
    (tmp / "nemlit2.txt").write_text(NEMLIT)
    with psycopg.connect(URL) as c:
        cur = c.cursor()
        storage.set_reference(cur, "national_list", str(tmp / "nemlit2.txt"))
        local = storage.reference_file(cur, "national_list", None, str(tmp))
        assert open(local).read() == NEMLIT
        assert storage.reference_file(cur, "global_list", None) is None   # not uploaded, no fallback
        c.rollback()


def test_team_actions_are_logged_customer_actions_are_not(env):
    with psycopg.connect(URL) as c:
        cust = c.execute("insert into users (email, password_hash) values ('audit1@example.com', 'x') returning id").fetchone()[0]
        team = c.execute("insert into users (email, password_hash, role) values ('audit-team@example.com', 'x', 'team') returning id").fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, cust)
        rid = a.execute("insert into requests (user_id, quantity) values (%s, '5') returning id", (cust,)).fetchone()[0]
        a.commit()
        as_user(a, team)
        a.execute("update requests set stage = 'Regulatory check' where id = %s", (rid,))
        a.execute("select admin_reset_password(%s, 'h2')", (cust,))
        a.commit()
        as_user(a, team)
        rows = a.execute("select table_name, changes from audit_log where row_id in (%s, %s) order by id", (str(rid), str(cust))).fetchall()
        assert ("requests", {"stage": ["Product request", "Regulatory check"]}) in rows
        assert any(t == "users" and ch.get("password") == "reset" and "password_hash" not in ch for t, ch in rows)
        assert not any(t == "requests" and "quantity" in ch for t, ch in rows)    # the customer's insert is not logged
        a.rollback()
        as_user(a, cust)   # customers cannot read the log
        assert a.execute("select count(*) from audit_log").fetchone()[0] == 0


def test_signup_rate_and_upload_limits(env):
    with app_conn(env) as a:
        as_user(a, None)
        allowed = [a.execute("select rate_allow('signup', '10.0.0.9', 5, interval '1 hour')").fetchone()[0] for _ in range(6)]
        assert allowed == [True] * 5 + [False]
        assert a.execute("select rate_allow('signup', '10.0.0.10', 5, interval '1 hour')").fetchone()[0] is True
        a.commit()
    with psycopg.connect(URL) as c:
        u = c.execute("insert into users (email, password_hash) values ('uploads@example.com', 'x') returning id").fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, u)
        for i in range(60):
            a.execute("insert into stored_files (name, size, data, uploaded_by) values ('f', 1, 'x', %s)", (u,))
        with pytest.raises(psycopg.errors.RaiseException, match="60 files a day"):
            a.execute("insert into stored_files (name, size, data, uploaded_by) values ('f', 1, 'x', %s)", (u,))
        a.rollback()


def test_two_step_challenge(env):
    with psycopg.connect(URL) as c:
        u = c.execute("insert into users (email, password_hash) values ('2step@example.com', 'x') returning id").fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, u)
        a.execute("insert into user_totp (user_id, secret) values (%s, 'JBSWY3DPEHPK3PXP')", (u,))
        a.commit()
        as_user(a, None)
        assert a.execute("select auth_totp_enabled(%s)", (u,)).fetchone()[0] is False      # not confirmed yet
        a.commit()
        as_user(a, u)
        a.execute("update user_totp set enabled = true where user_id = %s", (u,))
        a.commit()
        as_user(a, None)
        assert a.execute("select auth_totp_enabled(%s)", (u,)).fetchone()[0] is True
        a.execute("select auth_create_challenge('tok', %s)", (u,))
        assert a.execute("select secret from auth_challenge('tok')").fetchone()[0] == "JBSWY3DPEHPK3PXP"
        for _ in range(5):
            a.execute("select auth_challenge_failed('tok')")
        assert a.execute("select count(*) from auth_challenge('tok')").fetchone()[0] == 0      # 5 wrong codes: dead
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            a.execute("select * from login_challenges")
        a.rollback()
        as_user(a, None)   # nobody else reads someone's secret
        assert a.execute("select count(*) from user_totp").fetchone()[0] == 0


def test_evaluations_hidden_picks_and_moves(env):
    with psycopg.connect(URL) as c:
        cust = c.execute("insert into users (email, password_hash) values ('ev1@example.com', 'x') returning id").fetchone()[0]
        other = c.execute("insert into users (email, password_hash) values ('ev2@example.com', 'x') returning id").fetchone()[0]
        team = c.execute("insert into users (email, password_hash, role) values ('evt@example.com', 'x', 'team') returning id").fetchone()[0]
        mol = c.execute("select id from molecules where inn = 'Doxycycline'").fetchone()[0]
        req = c.execute("insert into requests (user_id, molecule_id) values (%s, %s) returning id", (cust, mol)).fetchone()[0]
        c.execute("insert into portfolio_items (user_id, molecule_id) values (%s, %s)", (cust, mol))
        c.commit()
    with app_conn(env) as a:
        as_user(a, cust)   # a customer cannot write an evaluation, even on their own request
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            a.execute("insert into request_evaluations (request_id, verdict, summary) values (%s, 'go', 'x')", (req,))
        a.rollback()
        as_user(a, team)
        a.execute("insert into request_evaluations (request_id, verdict, summary, price_range) values (%s, 'go', 'Worth it', 'USD 1')", (req,))
        a.commit()
        as_user(a, cust)
        assert a.execute("select verdict, price_range from request_evaluations").fetchall() == [("go", "USD 1")]
        a.execute("insert into hidden_molecules (user_id, molecule_id) values (%s, %s)", (cust, mol))
        # the earlier diffed upload added Doxycycline products: they show as moves on this customer's portfolio
        moves = a.execute("select change, molecule from my_market_moves(3650)").fetchall()
        assert moves and all(m == "Doxycycline" for _, m in moves)
        a.commit()
        as_user(a, other)
        assert a.execute("select count(*) from request_evaluations").fetchone()[0] == 0
        assert a.execute("select count(*) from hidden_molecules").fetchone()[0] == 0
        assert a.execute("select count(*) from my_market_moves(3650)").fetchone()[0] == 0   # no portfolio, no moves
        a.rollback()
    assert q("select count(*) from audit_log where table_name = 'request_evaluations'")[0][0] == 1


def test_sourcing_list_and_free_cap_counts_only_early_stages(env):
    with psycopg.connect(URL) as c:
        cust = c.execute("insert into users (email, password_hash) values ('list1@example.com', 'x') returning id").fetchone()[0]
        other = c.execute("insert into users (email, password_hash) values ('list2@example.com', 'x') returning id").fetchone()[0]
        mol = c.execute("select id from molecules where inn = 'Doxycycline'").fetchone()[0]
        for stage in ("Registration", "Shipment", "Closed"):   # products past pricing do not count toward the free cap
            c.execute("insert into requests (user_id, molecule_id, stage) values (%s, %s, %s)", (cust, mol, stage))
        c.commit()
    with app_conn(env) as a:
        as_user(a, cust)
        a.execute("insert into sourcing_list (user_id, molecule_id) values (%s, %s)", (cust, mol))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):   # a customer's list is their own
            a.execute("insert into sourcing_list (user_id, molecule_id) values (%s, %s)", (other, mol))
        a.rollback()
        as_user(a, cust)
        for _ in range(5):
            a.execute("insert into requests (user_id, molecule_id) values (%s, %s)", (cust, mol))
        with pytest.raises(psycopg.errors.RaiseException):          # the sixth early-stage request is over the free cap
            a.execute("insert into requests (user_id, molecule_id) values (%s, %s)", (cust, mol))
        a.rollback()
        as_user(a, other)
        assert a.execute("select count(*) from sourcing_list").fetchone()[0] == 0


def test_dossier_and_shipment_documents_are_team_written(env):
    with psycopg.connect(URL) as c:
        cust = c.execute("insert into users (email, password_hash) values ('dos1@example.com', 'x') returning id").fetchone()[0]
        other = c.execute("insert into users (email, password_hash) values ('dos2@example.com', 'x') returning id").fetchone()[0]
        team = c.execute("insert into users (email, password_hash, role) values ('dost@example.com', 'x', 'team') returning id").fetchone()[0]
        mol = c.execute("select id from molecules where inn = 'Doxycycline'").fetchone()[0]
        req = c.execute("insert into requests (user_id, molecule_id) values (%s, %s) returning id", (cust, mol)).fetchone()[0]
        sup = c.execute("insert into suppliers (name) values ('Dossier Supplier') returning id").fetchone()[0]
        off = c.execute("insert into supplier_offers (supplier_id, molecule_id) values (%s, %s) returning id", (sup, mol)).fetchone()[0]
        q = c.execute("""insert into quotes (request_id, supplier_offer_id, label, payment_terms, shelf_life_pct, gmp_by, supplier_type)
                         values (%s, %s, 'Supplier A', '30%% deposit', 80, 'WHO prequalified', 'manufacturer') returning id""", (req, off)).fetchone()[0]
        order = c.execute("insert into orders (request_id, quote_id, status) values (%s, %s, 'Import permit') returning id", (req, q)).fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, team)
        a.execute("insert into dossier_items (request_id, item, status) values (%s, 'gmp', 'have')", (req,))
        a.execute("insert into request_dossier (request_id, be_status) values (%s, 'needed')", (req,))
        a.execute("insert into shipment_documents (order_id, doc, ready) values (%s, 'permit', true)", (order,))
        a.commit()
        as_user(a, cust)
        assert a.execute("select status from dossier_items").fetchall() == [("have",)]
        assert a.execute("select be_status from request_dossier").fetchall() == [("needed",)]
        assert a.execute("select doc from shipment_documents").fetchall() == [("permit",)]
        assert a.execute("select shelf_life_pct, supplier_type from quotes where id = %s", (q,)).fetchone() == (80, "manufacturer")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            a.execute("insert into dossier_items (request_id, item, status) values (%s, 'cpp', 'have')", (req,))
        a.rollback()
        as_user(a, other)
        assert a.execute("select count(*) from dossier_items").fetchone()[0] == 0
        assert a.execute("select count(*) from shipment_documents").fetchone()[0] == 0
        a.rollback()


def test_focus_questions_and_routes(env):
    with psycopg.connect(URL) as c:
        free = c.execute("insert into users (email, password_hash) values ('fq1@example.com', 'x') returning id").fetchone()[0]
        other = c.execute("insert into users (email, password_hash) values ('fq2@example.com', 'x') returning id").fetchone()[0]
        paid = c.execute("insert into users (email, password_hash, plan) values ('fq3@example.com', 'x', 'paid') returning id").fetchone()[0]
        mol = c.execute("select id from molecules where inn = 'Doxycycline'").fetchone()[0]
        c.execute("insert into molecule_routes (molecule_id, route_key, note) values (%s, 'abridged', 'WHO PQ reference exists')", (mol,))
        c.commit()
    with app_conn(env) as a:
        as_user(a, free)
        a.execute("insert into user_focus (user_id, classes, goals) values (%s, %s, %s)", (free, ["Anti-infective Medicines"], ["new_molecules"]))
        for i in range(3):
            a.execute("insert into expert_questions (user_id, body) values (%s, %s)", (free, f"q{i}"))
        with pytest.raises(psycopg.errors.RaiseException):          # the fourth question this month is over the free limit
            a.execute("insert into expert_questions (user_id, body) values (%s, 'q4')", (free,))
        a.rollback()
        as_user(a, free)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):   # customers cannot answer their own questions
            a.execute("insert into expert_questions (user_id, body, answer) values (%s, 'x', 'self answer')", (free,))
        a.rollback()
        as_user(a, free)
        assert a.execute("select count(*) from molecule_routes").fetchone()[0] == 0     # route detail is paid
        assert a.execute("select count(*) from registration_routes").fetchone()[0] == 3
        as_user(a, other)
        assert a.execute("select count(*) from user_focus").fetchone()[0] == 0
        assert a.execute("select count(*) from expert_questions").fetchone()[0] == 0
        as_user(a, paid)
        assert a.execute("select route_key from molecule_routes where molecule_id = %s", (mol,)).fetchone()[0] == "abridged"
        a.rollback()


def test_manufacturer_side_privacy(env):
    with psycopg.connect(URL) as c:
        maker = c.execute("insert into users (email, password_hash, account_type, onboarded) values ('mk1@example.com', 'x', 'manufacturer', true) returning id").fetchone()[0]
        other = c.execute("insert into users (email, password_hash, account_type, onboarded) values ('mk2@example.com', 'x', 'manufacturer', true) returning id").fetchone()[0]
        team = c.execute("insert into users (email, password_hash, role) values ('mkt@example.com', 'x', 'team') returning id").fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, maker)
        a.execute("insert into manufacturer_profiles (user_id, company_name) values (%s, 'Maker One')", (maker,))
        pid = a.execute("insert into mfr_products (user_id, name) values (%s, 'Doxycycline 100mg capsules') returning id", (maker,)).fetchone()[0]
        eid = a.execute("insert into engagements (user_id, kind, country, product_id) values (%s, 'market_entry', 'TZ', %s) returning id", (maker, pid)).fetchone()[0]
        a.commit()
        as_user(a, maker)
        with pytest.raises(psycopg.errors.RaiseException):          # cannot approve itself
            a.execute("update manufacturer_profiles set status = 'approved' where user_id = %s", (maker,))
        a.rollback()
        as_user(a, maker)
        with pytest.raises(psycopg.errors.RaiseException):          # cannot switch account type after onboarding
            a.execute("update users set account_type = 'distributor' where id = %s", (maker,))
        a.rollback()
        as_user(a, maker)
        assert a.execute("update engagements set stage = 'Approved' where id = %s", (eid,)).rowcount == 0   # only the team moves stages
        profiles = a.execute("select * from partner_profiles('Anti-infective Medicines', null)").fetchall()
        assert profiles and all(len(p[0]) == 8 for p in profiles)                                        # codes, no names
        with pytest.raises(psycopg.errors.RaiseException):          # only the team turns a code into a company
            a.execute("select partner_company(%s)", (profiles[0][0],))
        a.rollback()
        as_user(a, other)
        assert a.execute("select count(*) from mfr_products").fetchone()[0] == 0
        assert a.execute("select count(*) from engagements").fetchone()[0] == 0
        assert a.execute("select count(*) from manufacturer_profiles").fetchone()[0] == 0
        a.rollback()
        as_user(a, team)
        code = a.execute("select code from partner_profiles('Anti-infective Medicines', null) limit 1").fetchone()[0]
        assert a.execute("select partner_company(%s)", (code,)).fetchone()[0] is not None
        a.execute("update manufacturer_profiles set status = 'approved' where user_id = %s", (maker,))
        a.execute("update engagements set stage = 'Market assessment' where id = %s", (eid,))
        a.commit()
    assert q("select status from manufacturer_profiles where user_id = %s", maker)[0][0] == "approved"


def test_team_documents_everywhere_and_internal_files(env):
    with psycopg.connect(URL) as c:
        cust = c.execute("insert into users (email, password_hash, onboarded) values ('doc1@example.com', 'x', true) returning id").fetchone()[0]
        other = c.execute("insert into users (email, password_hash, onboarded) values ('doc2@example.com', 'x', true) returning id").fetchone()[0]
        team = c.execute("insert into users (email, password_hash, role) values ('doct@example.com', 'x', 'team') returning id").fetchone()[0]
        rid = c.execute("insert into requests (user_id, molecule_text) values (%s, 'Doc test') returning id", (cust,)).fetchone()[0]
        sid = c.execute("insert into suppliers (name) values ('Doc Supplier') returning id").fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, team)
        f1 = a.execute("insert into stored_files (name, size, data, uploaded_by) values ('a.pdf', 1, 'x', %s) returning id", (team,)).fetchone()[0]
        f2 = a.execute("insert into stored_files (name, size, data, uploaded_by) values ('b.pdf', 1, 'x', %s) returning id", (team,)).fetchone()[0]
        f3 = a.execute("insert into stored_files (name, size, data, uploaded_by) values ('c.pdf', 1, 'x', %s) returning id", (team,)).fetchone()[0]
        a.execute("""insert into request_files (request_id, path, file_name, kind, item, from_team, internal, uploaded_by)
                     values (%s, %s, 'gmp.pdf', 'dossier', 'gmp', true, false, %s), (%s, %s, 'margin.pdf', 'other', null, true, true, %s)""",
                  (rid, f"db:{f1}", team, rid, f"db:{f2}", team))
        a.execute("""insert into account_documents (user_id, kind, file_path, file_name, internal, uploaded_by)
                     values (%s, 'agreement', %s, 'agreement.pdf', false, %s), (%s, 'other', %s, 'notes.pdf', true, %s)""",
                  (cust, f"db:{f3}", team, cust, f"db:{f2}", team))
        a.execute("insert into supplier_documents (supplier_id, kind, file_path, file_name, uploaded_by) values (%s, 'gmp', %s, 'gmp.pdf', %s)",
                  (sid, f"db:{f1}", team))
        a.execute("insert into plan_prices (key, price) values ('mfr_entry', 'USD 1 / month') on conflict (key) do update set price = excluded.price")
        a.commit()
        as_user(a, cust)
        assert [r[0] for r in a.execute("select file_name from request_files where request_id = %s", (rid,))] == ["gmp.pdf"]   # internal hidden
        assert [r[0] for r in a.execute("select file_name from account_documents")] == ["agreement.pdf"]
        assert a.execute("select count(*) from supplier_documents").fetchone()[0] == 0                                   # team only
        assert a.execute("select count(*) from stored_files where id = %s", (f2,)).fetchone()[0] == 0                    # internal file body too
        assert a.execute("select count(*) from stored_files where id = %s", (f3,)).fetchone()[0] == 1
        assert a.execute("select price from plan_prices where key = 'mfr_entry'").fetchone()[0] == "USD 1 / month"
        assert a.execute("delete from request_files where request_id = %s", (rid,)).rowcount == 0                       # only the team removes
        with pytest.raises(psycopg.errors.InsufficientPrivilege):                                                       # cannot pose as the team
            a.execute("""insert into request_files (request_id, path, file_name, kind, from_team, uploaded_by)
                         values (%s, %s, 'fake.pdf', 'dossier', true, %s)""", (rid, f"db:{f3}", cust))
        a.rollback()
        as_user(a, other)
        assert a.execute("select count(*) from account_documents").fetchone()[0] == 0
        assert a.execute("select count(*) from request_files where request_id = %s", (rid,)).fetchone()[0] == 0
        a.rollback()
        as_user(a, team)
        assert a.execute("delete from request_files where request_id = %s and internal", (rid,)).rowcount == 1
        a.commit()
    assert q("select count(*) from audit_log where table_name = 'request_files' and action = 'delete'")[0][0] >= 1


def test_manufacturer_onboarding_answers(env):
    with psycopg.connect(URL) as c:
        maker = c.execute("insert into users (email, password_hash, account_type) values ('mk9@example.com', 'x', 'manufacturer') returning id").fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, maker)
        a.execute("insert into manufacturer_profiles (user_id, company_name) values (%s, 'Maker Nine')", (maker,))
        a.execute("""update manufacturer_profiles set dosage_forms = '{Tablets}', target_countries = '{TZ,KE,UZ}', timeline = 'now',
                     goals = '{launch}', services = '{register,sales}', launch_scope = 'data_first', step = 6, suggested_plan = 'entry', chosen_plan = 'entry',
                     completed_at = now() where user_id = %s""", (maker,))
        a.execute("update users set onboarded = true where id = %s", (maker,))
        a.commit()
        as_user(a, maker)
        with pytest.raises(psycopg.errors.RaiseException):          # still cannot approve itself
            a.execute("update manufacturer_profiles set status = 'approved' where user_id = %s", (maker,))
        a.rollback()
    assert q("select chosen_plan, step from manufacturer_profiles where user_id = %s", maker)[0] == ("entry", 6)


def test_plan_tier_partner_search_and_catalog(env):
    with psycopg.connect(URL) as c:
        maker = c.execute("insert into users (email, password_hash, account_type, onboarded) values ('mk7@example.com', 'x', 'manufacturer', true) returning id").fetchone()[0]
        team = c.execute("insert into users (email, password_hash, role) values ('mk7t@example.com', 'x', 'team') returning id").fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, maker)
        a.execute("insert into manufacturer_profiles (user_id, company_name) values (%s, 'Maker Seven')", (maker,))
        mol = a.execute("""select molecule_id from registrations where active and country = 'TZ' group by 1 order by count(*) desc limit 1""").fetchone()[0]
        a.execute("insert into mfr_products (user_id, name, molecule_id) values (%s, 'Top molecule', %s)", (maker, mol))
        a.commit()
        as_user(a, maker)
        assert a.execute("select mfr_tier()").fetchone()[0] == 0
        rows = a.execute("select code, open_to, carries_mine, total, mine from partner_search('TZ')").fetchall()
        assert 0 < len(rows) <= 5 and rows[0][3] >= len(rows)                     # no plan: five rows, total still known
        assert all(r[1] + r[2] == r[4] == 1 for r in rows)                          # open to + carries = my molecules
        with pytest.raises(psycopg.errors.RaiseException):                          # cannot give itself a plan
            a.execute("update manufacturer_profiles set active_plan = 'entry' where user_id = %s", (maker,))
        a.rollback()
        assert a.execute("select count(*) from medicine_catalog").fetchone()[0] >= 0  # readable by everyone signed in
        a.rollback()
        as_user(a, team)
        a.execute("update manufacturer_profiles set active_plan = 'data', active_since = now() where user_id = %s", (maker,))
        a.commit()
        as_user(a, maker)
        assert a.execute("select mfr_tier()").fetchone()[0] == 1
        full = a.execute("select total from partner_search('TZ')").fetchall()
        assert len(full) == min(full[0][0], 200)                                     # with a plan: every distributor
        a.rollback()


def test_payments_invoices_launches_and_watch(env):
    import billing
    with psycopg.connect(URL) as c:
        maker = c.execute("insert into users (email, password_hash, account_type, onboarded) values ('pay1@example.com', 'x', 'manufacturer', true) returning id").fetchone()[0]
        other = c.execute("insert into users (email, password_hash, account_type, onboarded) values ('pay2@example.com', 'x', 'manufacturer', true) returning id").fetchone()[0]
        team = c.execute("insert into users (email, password_hash, role) values ('payt@example.com', 'x', 'team') returning id").fetchone()[0]
        c.execute("insert into manufacturer_profiles (user_id, company_name) values (%s, 'Pay Pharma'), (%s, 'Other Pharma')", (maker, other))
        c.commit()
    with app_conn(env) as a:
        # the webhook (no signed-in user) records a payment; a signed-in customer cannot
        a.execute("""insert into payment_events (stripe_event_id, kind, user_id, plan, amount_cents, stripe_customer, stripe_subscription)
                     values ('evt_1', 'checkout_completed', %s, 'data', 19900, 'cus_1', 'sub_1'),
                            ('evt_2', 'invoice_paid', %s, 'data', 19900, 'cus_1', 'sub_1')""", (maker, maker))
        a.commit()
        as_user(a, maker)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            a.execute("insert into payment_events (kind, user_id, plan) values ('checkout_completed', %s, 'entry')", (maker,))
        a.rollback()
    with psycopg.connect(URL) as c:
        assert billing.process(c.cursor()) == 2
        c.commit()
    plan, docs, inv = q("""select p.active_plan, (select count(*) from account_documents d where d.user_id = p.user_id),
                           (select status from invoices i where i.user_id = p.user_id) from manufacturer_profiles p where p.user_id = %s""", maker)[0]
    assert plan == "data" and docs == 2 and inv == "paid"           # plan on, order confirmation and paid invoice issued
    with app_conn(env) as a:
        as_user(a, maker)
        assert a.execute("select count(*) from invoices").fetchone()[0] == 1
        pid = a.execute("insert into mfr_products (user_id, name) values (%s, 'X') returning id", (maker,)).fetchone()[0]
        a.execute("insert into launches (user_id, product_id, country, stage) values (%s, %s, 'TZ', 'selected')", (maker, pid))
        assert a.execute("select count(*) from my_market_watch(array['TZ'], 90)").fetchone()[0] >= 0
        a.commit()
        as_user(a, other)
        assert a.execute("select count(*) from launches").fetchone()[0] == 0
        assert a.execute("select count(*) from invoices").fetchone()[0] == 0
        assert a.execute("select count(*) from account_documents").fetchone()[0] == 0
        a.rollback()
        as_user(a, team)                                                     # an invoiced plan, switched on by the team
        a.execute("insert into payment_events (kind, user_id, plan, amount_cents) values ('manual_activation', %s, 'entry', 500000)", (other,))
        a.commit()
    with psycopg.connect(URL) as c:
        billing.process(c.cursor())
        c.execute("""insert into payment_events (stripe_event_id, kind, stripe_subscription) values ('evt_3', 'subscription_ended', 'sub_1')""")
        billing.process(c.cursor())
        c.commit()
    assert q("select status from invoices where user_id = %s", other)[0][0] == "due"
    assert q("select active_plan from manufacturer_profiles where user_id = %s", maker)[0][0] is None   # cancelled subscription ends the plan


def test_team_members_and_permissions(env):
    with psycopg.connect(URL) as c:
        owner = c.execute("insert into users (email, password_hash, role, team_owner) values ('own@example.com', 'x', 'team', true) returning id").fetchone()[0]
        c.commit()
    with app_conn(env) as a:
        as_user(a, owner)
        member = a.execute("select team_add_member('mem@example.com', 'Member', 'h', array['requests'], false)").fetchone()[0]
        a.commit()
        with pytest.raises(psycopg.errors.RaiseException):           # unknown permission
            as_user(a, owner)
            a.execute("select team_add_member('x@example.com', 'X', 'h', array['everything'], false)")
        a.rollback()
        as_user(a, member)
        assert a.execute("select app_is_team(), app_is_owner()").fetchone() == (True, False)
        for sql_text, args in (("select team_add_member('y@example.com', 'Y', 'h', array['requests'], true)", ()),   # members cannot add
                               ("select team_set_member(%s, array['accounts'], true)", (member,)),                  # nor promote themselves
                               ("select admin_reset_password(%s, 'h2')", (owner,))):                                # nor take over an owner
            with pytest.raises(psycopg.errors.RaiseException):
                a.execute(sql_text, args)
            a.rollback()
            as_user(a, member)
        a.rollback()
        as_user(a, owner)
        a.execute("select team_set_member(%s, array[]::text[], false)", (owner,))   # owner rights are not changed in the app
        assert q("select team_owner from users where id = %s", owner)[0][0] is True
        with pytest.raises(psycopg.errors.RaiseException):           # and the owner cannot be removed
            a.execute("select team_remove_member(%s, true)", (owner,))
        a.rollback()
        as_user(a, owner)
        a.execute("select team_remove_member(%s, true)", (member,))
        a.commit()
        as_user(a, member)
        assert a.execute("select app_is_team()").fetchone()[0] is False  # removed: no longer team
        assert a.execute("select count(*) from auth_find_user('mem@example.com')").fetchone()[0] == 0   # and cannot sign in
        a.rollback()
