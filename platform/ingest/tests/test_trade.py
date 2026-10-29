"""Comtrade rows become trade_flows rows: partners named from the reference list, the World kept, exports and empty values dropped."""
import os

import psycopg
import pytest

import trade


@pytest.fixture
def db():
    """The test database once the ingest tests have built it; everything written here is rolled back."""
    url = os.environ.get("TEST_DATABASE_URL_ADMIN")
    if not url:
        pytest.skip("TEST_DATABASE_URL_ADMIN not set")
    with psycopg.connect(url) as conn:
        if not conn.execute("select to_regclass('trade_flows')").fetchone()[0]:
            pytest.skip("trade_flows not migrated here")
        yield conn
        conn.rollback()


def row(**kw):
    base = {"refYear": 2023, "flowCode": "M", "cmdCode": "3004", "partnerCode": 699, "primaryValue": 225_500_000.0, "netWgt": 10_811_817.9}
    base.update(kw)
    return base


def test_rows_from_names_partners_and_keeps_world():
    rows = trade.rows_from("TZ", [row(), row(partnerCode=0, primaryValue=365e6), row(partnerCode=156, netWgt=None)])
    assert rows[0] == ("TZ", 2023, "3004", "699", "India", "IN", 225_500_000.0, 10_811_817.9)
    assert rows[1][3:6] == ("0", "World", None)
    assert rows[2][4] == "China" and rows[2][7] is None


def test_rows_from_drops_exports_and_empty_values():
    assert trade.rows_from("KE", [row(flowCode="X"), row(primaryValue=None)]) == []


def test_every_market_has_a_reporter_code():
    for c in ("TZ", "KE", "KZ", "KG", "UZ", "NG"):
        assert c in trade.REPORTERS


def test_write_upserts(db):
    cur = db.cursor()
    rows = trade.rows_from("TZ", [row(), row(primaryValue=1.0, partnerCode=0)])
    assert trade.write(cur, rows) == 2
    assert trade.write(cur, trade.rows_from("TZ", [row(primaryValue=2.0)])) == 1
    assert cur.execute("select value_usd from trade_flows where country = 'TZ' and year = 2023 and hs = '3004' and partner = '699'").fetchone()[0] == 2.0
    assert cur.execute("select count(*) from trade_flows where country = 'TZ'").fetchone()[0] == 2
