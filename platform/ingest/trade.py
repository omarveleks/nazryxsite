"""Medicine imports by market, from UN Comtrade: what each country reported importing under HS 3004 (medicines in doses)
and HS 3003 (bulk), by year, by origin country and by HS6 line. Read once a month per market, one market per worker
tick, with the public preview API (no key; a few hundred rows a call, politely paced). Values are CIF US dollars.
"""
import json
import logging
import os
import time
from datetime import date

import requests

log = logging.getLogger("trade")
API = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
HS6 = ["300410", "300420", "300431", "300432", "300439", "300441", "300442", "300443", "300449", "300450", "300460", "300490"]
REPORTERS = {"TZ": 834, "KE": 404, "KZ": 398, "KG": 417, "UZ": 860, "NG": 566, "UG": 800, "SN": 686, "CI": 384, "CM": 120, "HT": 332}
EVERY_DAYS = 30
YEARS_BACK = 3            # the latest years a country may have reported; Comtrade lags one to two years
PAUSE = 8                 # seconds between calls: the preview API allows a handful a minute, one period a call
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
    """The enabled market longest since its last read, if any is older than a month (or never read)."""
    for code, in cur.execute("select code from countries where enabled order by code").fetchall():
        if code not in REPORTERS:
            continue
        last = cur.execute("select max(read_at) from trade_flows where country = %s", (code,)).fetchone()[0]
        if last is None or (date.today() - last.date()).days >= EVERY_DAYS:
            return code
    return None


def read_country(cur, country, session=None):
    """Totals by origin for 3004 and 3003, and the World total by HS6 line, for the latest years. Returns rows written."""
    session = session or requests.Session()
    years = list(range(date.today().year - YEARS_BACK, date.today().year))
    reporter = REPORTERS[country]
    n = 0
    for year in years:
        for cmd, partner in (("3004", None), ("3003", 0), (",".join(HS6), 0)):   # doses by origin; bulk and the HS6 lines for the world
            data = fetch(session, reporter, year, cmd, partner)
            if data is None:
                break
            n += write(cur, rows_from(country, data))
            time.sleep(PAUSE)
    if n == 0:   # nothing reported: still mark the read so the next market gets its turn, and we try again in a month
        cur.execute("""insert into trade_flows (country, year, hs, partner, partner_name, value_usd) values (%s, %s, '3004', '0', 'World', null)
                       on conflict (country, year, hs, partner) do update set read_at = now()""", (country, years[-1]))
    log.info("trade %s: %s rows", country, n)
    return n


def run(cur, session=None):
    """Read the one market that is due. Off when COMTRADE=0."""
    if os.environ.get("COMTRADE", "1") == "0":
        return 0
    country = due(cur)
    if not country:
        return 0
    return read_country(cur, country, session)
