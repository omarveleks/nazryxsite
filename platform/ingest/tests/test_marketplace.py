"""Open tenders with a molecule become requests on the board; closed tenders leave it; the hourly gate holds."""
import os

import psycopg
import pytest

import marketplace


@pytest.fixture
def db():
    url = os.environ.get("TEST_DATABASE_URL_ADMIN")
    if not url:
        pytest.skip("TEST_DATABASE_URL_ADMIN not set")
    with psycopg.connect(url) as conn:
        if not conn.execute("select to_regclass('needs')").fetchone()[0]:
            pytest.skip("needs not migrated here")
        yield conn
        conn.rollback()


def test_tenders_become_requests_and_leave_when_closed(db):
    cur = db.cursor()
    cur.execute("select id from molecules order by id limit 1")
    mol = cur.fetchone()[0]
    cur.execute("""insert into tenders (country, source, ref, title, buyer, stage, closing, molecule_ids)
                   values ('KE', 'test', 'T-OPEN', 'Supply of tablets', 'A hospital', 'open', current_date + 10, array[%s]),
                          ('KE', 'test', 'T-DONE', 'Old supply', 'A hospital', 'open', current_date - 1, array[%s]) returning id""", (mol, mol))
    open_id, done_id = [r[0] for r in cur.fetchall()]
    marketplace._next = 0
    added = marketplace.run(cur, now=1000)
    assert added >= 1
    cur.execute("select status, country, molecule_id, deliver_by from needs where tender_id = %s", (open_id,))
    status, country, molecule_id, deliver_by = cur.fetchone()
    assert (status, country, molecule_id) == ("open", "KE", mol) and deliver_by is not None
    cur.execute("select count(*) from needs where tender_id = %s", (done_id,))
    assert cur.fetchone()[0] == 0
    # the tender closes: its request leaves the board on the next run
    cur.execute("update tenders set closing = current_date - 1 where id = %s", (open_id,))
    marketplace._next = 0
    marketplace.run(cur, now=2000)
    cur.execute("select status from needs where tender_id = %s", (open_id,))
    assert cur.fetchone()[0] == "closed"


def test_runs_once_an_hour(db):
    cur = db.cursor()
    marketplace._next = 0
    assert marketplace.run(cur, now=5000) is not None
    assert marketplace.run(cur, now=5000 + 60) is None
    assert marketplace.run(cur, now=5000 + marketplace.EVERY + 1) is not None
