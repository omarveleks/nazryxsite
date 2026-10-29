"""Medicine imports by market, from UN Comtrade: what each country reported importing under HS 3004 (medicines in doses)
and HS 3003 (bulk), by year, by origin country and by HS6 line. Read once a month per market, one market per worker
tick, with the public preview API (no key; a few hundred rows a call, politely paced). Values are CIF US dollars.
"""
import json
import logging
import os
from datetime import date

import requests

log = logging.getLogger("trade")
API = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
HS6 = ["300410", "300420", "300431", "300432", "300439", "300441", "300442", "300443", "300449", "300450", "300460", "300490"]
REPORTERS = {"TZ": 834, "KE": 404, "KZ": 398, "KG": 417, "UZ": 860, "NG": 566, "UG": 800, "SN": 686, "CI": 384, "CM": 120, "HT": 332}
EVERY_DAYS = 30
YEARS_BACK = 3            # the latest years a country may have reported; Comtrade lags one to two years
HERE = os.path.dirname(os.path.abspath(__file__))
_partners = None


def partners():
    global _partners
    if _partners is None:
        with open(os.path.join(HERE, "comtrade_partners.json"), encoding="utf-8") as f:
            _partners = json.load(f)
    return _partners


def fetch(session, reporter, year, cmd, partner=None):
    """One preview call (one period is the preview's limit); a 429 or 5xx is retried by the session. Returns the data
    rows, or None when the call failed."""
    params = {"reporterCode": reporter, "period": str(year), "cmdCode": cmd, "flowCode": "M", "motCode": 0, "customsCode": "C00"}
    if partner is not None:
        params["partnerCode"] = partner
    try:
        r = session.get(API, params=params, timeout=90)
        if r.status_code != 200:
            log.warning("comtrade %s %s: %s", reporter, cmd, r.status_code)
            return None
        return r.json().get("data", [])
    except (requests.RequestException, ValueError) as e:
        log.warning("comtrade %s %s failed: %s", reporter, cmd, e)
        return None


def rows_from(country, data):
    """Comtrade rows to (country, year, hs, partner, name, iso, value_usd, kg). Partner 2 and modes are already World."""
    out = []
    for r in data or []:
        if r.get("flowCode") != "M" or r.get("primaryValue") is None:
            continue
        code = str(r.get("partnerCode", 0))
        p = partners().get(code, {})
        out.append((country, int(r["refYear"]), str(r["cmdCode"]), code, p.get("name") or ("World" if code == "0" else None), p.get("iso"),
                    float(r["primaryValue"]), float(r["netWgt"]) if r.get("netWgt") not in (None, 0) else None))
    return out


def write(cur, rows):
    for row in rows:
        cur.execute("""insert into trade_flows (country, year, hs, partner, partner_name, partner_iso, value_usd, kg, read_at)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, now())
                       on conflict (country, year, hs, partner) do update set value_usd = excluded.value_usd, kg = excluded.kg,
                         partner_name = coalesce(excluded.partner_name, trade_flows.partner_name), read_at = now()""", row)
    return len(rows)


def due(cur):
    """The enabled market with a (year, line) still unread this month, if any: one call per tick keeps the worker quick."""
    for code, in cur.execute("select code from countries where enabled order by code").fetchall():
        if code in REPORTERS and next_call(cur, code):
            return code
    return None


# the three calls per year, and the World row each one leaves behind (its marker; a null value marks "nothing reported")
CALLS = (("3004", None, "3004"), ("3003", 0, "3003"), (",".join(HS6), 0, "300490"))


def next_call(cur, country):
    """The first (year, cmd, partner, marker) not read in the last month for a market, or None when the month is done."""
    years = list(range(date.today().year - YEARS_BACK, date.today().year))
    for year in years:
        for cmd, partner, marker in CALLS:
            fresh = cur.execute("""select 1 from trade_flows where country = %s and year = %s and hs = %s and partner = '0'
                                   and read_at > now() - make_interval(days => %s)""", (country, year, marker, EVERY_DAYS)).fetchone()
            if not fresh:
                return year, cmd, partner, marker
    return None


def read_country(cur, country, session=None):
    """One call for the market: the next (year, line) due. Returns rows written (0 when nothing was reported, which is
    recorded so the next call moves on)."""
    session = session or requests.Session()
    nxt = next_call(cur, country)
    if not nxt:
        return 0
    year, cmd, partner, marker = nxt
    data = fetch(session, REPORTERS[country], year, cmd, partner)
    if data is None:                      # the call failed: try again next tick
        return 0
    n = write(cur, rows_from(country, data))
    if not any(r[2] == marker and r[3] == "0" for r in rows_from(country, data)):
        cur.execute("""insert into trade_flows (country, year, hs, partner, partner_name, value_usd, read_at) values (%s, %s, %s, '0', 'World', null, now())
                       on conflict (country, year, hs, partner) do update set read_at = now()""", (country, year, marker))
    log.info("trade %s %s %s: %s rows", country, year, marker, n)
    return n


def run(cur, session=None):
    """Read the next due call for the next due market. Off when COMTRADE=0."""
    if os.environ.get("COMTRADE", "1") == "0":
        return 0
    country = due(cur)
    if not country:
        return 0
    return read_country(cur, country, session)
