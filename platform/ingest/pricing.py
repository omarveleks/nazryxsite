"""What a molecule sells for in each of the five markets. Every price the collectors find goes into price_listings
(plus Uzbekistan's official prices and tender unit prices, read where they already are). rebuild() turns them into one
average price per unit for each molecule and market (molecule_prices).

Best evidence first: pharmacy listings, then official maximum prices, then reimbursement amounts and tender prices.
Where a market has nothing for a molecule, the price is estimated from a neighbouring market: the neighbour's price
in USD times how the two markets' prices compare on the molecules priced in both (the median ratio)."""
import datetime as dt
import logging
import re
import statistics

log = logging.getLogger("pricing")
MARKETS = ("KZ", "KG", "UZ", "KE", "TZ")
NEIGHBOURS = {"KZ": ("KG", "UZ"), "KG": ("KZ", "UZ"), "UZ": ("KZ", "KG"), "KE": ("TZ",), "TZ": ("KE",)}
CURRENCY = {"KZ": "KZT", "KG": "KGS", "UZ": "UZS", "KE": "KES", "TZ": "TZS"}
RANK = {"retail": 0, "cap": 1, "reimbursement": 2, "tender": 3}
MIN_OVERLAP = 15          # molecules priced in both markets before their price ratio is trusted; otherwise 1.0

INJ = re.compile(r"инъек|инфуз|ампул|амп\.|флак.*(инъ|инф)|лиофил|inject|infusion|ampoule|\bamps?\b|\bvials?\b|\binj\b|i\.v\.", re.I)
SOLID = re.compile(r"табл|таб\.|капс|драже|супп|свеч|пастил|саше|пакет|гранул.*пакет|tablet|\btabs?\b|capsul|\bcaps?\b|sachet|"
                   r"supposit|pessar|lozeng|\bsupp\b|\b\d+\s*'?s\b", re.I)
STRENGTH = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mg|мг|mcg|мкг|µg|g|г|ml|мл|iu|ме|ед|%)(?![a-zа-я])", re.I)
UNIT_EN = {"мг": "mg", "мкг": "mcg", "µg": "mcg", "г": "g", "мл": "ml", "ме": "IU", "ед": "IU", "iu": "IU"}


def unit_of(text):
    t = text or ""
    return "ampoule or vial" if INJ.search(t) else "tablet or capsule" if SOLID.search(t) else "pack"


def units_in(text):
    """How many units a pack holds, from its description; None when a counted pack does not say."""
    t = (text or "").lower().replace("х", "x").replace("×", "x")
    m = re.search(r"№\s*(\d+)(?:\s*x\s*(\d+))?", t)
    if m:
        return int(m.group(1)) * int(m.group(2) or 1)
    m = (re.search(r"(\d+)\s*x\s*(\d+)\s*(?:tab|cap|amp|vial|sachet|supp|блист)", t)
         or re.search(r"(?:pack|box|strip|bottle) of\s*(\d+)()", t)
         or re.search(r"(\d+)()\s*(?:tablets?|tabs?|capsules?|caps?|sachets?|ampoules?|amps?|vials?|suppositories|pessaries|lozenges)\b", t)
         or re.search(r"\b(\d+)()\s*'?s\b", t))
    if m:
        return int(m.group(1)) * int(m.group(2) or 1)
    return None if unit_of(text) == "tablet or capsule" else 1     # a single vial, bottle or tube


def strength_of(text):
    """'500 mg', '1 g' and '1000 mg' alike as '1000 mg'; ml, IU and % as written."""
    m = STRENGTH.search(text or "")
    if not m:
        return None
    v, u = float(m.group(1).replace(",", ".")), UNIT_EN.get(m.group(2).lower(), m.group(2).lower())
    if u == "g":
        v, u = v * 1000, "mg"
    return f"{v:g} {u}"


def refresh_fx(cur, s):
    d = s.get("https://open.er-api.com/v6/latest/USD", timeout=30).json()
    if d.get("result") != "success":
        return
    for cur_code in set(CURRENCY.values()) | {"EUR", "RUB"}:
        if d["rates"].get(cur_code):
            cur.execute("""insert into fx_rates (currency, per_usd) values (%s, %s) on conflict (currency)
                           do update set per_usd = excluded.per_usd, updated_at = now()""", (cur_code, d["rates"][cur_code]))


def observations(cur):
    """(country, molecule, kind, text, units, pack price, currency) from every source."""
    rows = cur.execute("""select country, molecule_id, kind, coalesce(pack, name), units, pack_price, currency from price_listings
                          where molecule_id is not null and pack_price > 0""").fetchall()
    for c, m, text, price, ccy in cur.execute("""select country, molecule_id, coalesce(pack, name), max_retail, currency
                                                  from reference_prices where molecule_id is not null and max_retail > 0"""):
        rows.append((c, m, "cap", text, units_in(text), price, ccy))
    for c, m, title, price, ccy in cur.execute("""select country, molecule_ids[1], coalesce(title_en, title), unit_price, currency
                                                   from tenders where cardinality(molecule_ids) = 1 and unit_price > 0
                                                   and coalesce(awarded, closing, published) > current_date - 730"""):
        rows.append((c, m, "tender", title, 1, price, ccy))
    return rows


def trimmed(xs):
    xs = sorted(xs)
    if len(xs) >= 5:
        k = max(1, len(xs) // 10)
        xs = xs[k:-k]
    return xs


def rebuild(cur):
    fx = dict(cur.execute("select currency, per_usd from fx_rates").fetchall())
    groups = {}
    for c, m, kind, text, units, price, ccy in observations(cur):
        if c not in MARKETS or ccy not in fx:
            continue
        units = units if units is not None else units_in(text)
        if not units:
            continue                                  # a counted pack that does not say how many: no unit price
        unit = unit_of(text)
        groups.setdefault((c, m), []).append((RANK[kind], kind, unit, strength_of(text), float(price) / float(units),
                                              float(price), float(fx[ccy]) / float(fx[CURRENCY[c]])))
    out = {}
    for (c, m), obs in groups.items():
        best = min(o[0] for o in obs)
        obs = [o for o in obs if o[0] == best]                         # the best kind of evidence this market has
        unit = statistics.mode([o[2] for o in obs])                     # the usual unit (tablets, ampoules or packs)
        obs = [o for o in obs if o[2] == unit]
        strengths = {}
        for o in obs:
            if o[3]:
                strengths.setdefault(o[3], []).append((o[4] / o[6], o[5] / o[6]))
        by = sorted(({"strength": k, "unit": round(sum(u for u, _ in v) / len(v), 4), "pack": round(sum(p for _, p in v) / len(v), 2),
                      "n": len(v)} for k, v in strengths.items()), key=lambda x: -x["n"])[:6]
        usual = by[0]["strength"] if by else None                         # the average is for the most listed strength
        local = [o[4] / o[6] for o in obs if usual is None or o[3] == usual]      # in the market's own currency
        t = trimmed(local)
        avg = sum(t) / len(t)
        out[(c, m)] = dict(basis="listings", kinds=sorted({o[1] for o in obs}), unit=unit, strength=usual, unit_price=avg,
                           unit_usd=avg / float(fx[CURRENCY[c]]), lo=t[0], hi=t[-1], n=len(local), by=by)
    # estimates for what a market lacks, from its neighbours
    for c in MARKETS:
        have = {m for (cc, m) in out if cc == c}
        for n in NEIGHBOURS[c]:
            both = [(out[(c, m)]["unit_usd"], out[(n, m)]["unit_usd"]) for m in have
                    if (n, m) in out and out[(n, m)]["basis"] == "listings"
                    and (out[(n, m)]["unit"], out[(n, m)]["strength"]) == (out[(c, m)]["unit"], out[(c, m)]["strength"])]
            ratios = [a / b for a, b in both if b > 0]
            factor = statistics.median(ratios) if len(ratios) >= MIN_OVERLAP else 1.0
            for (nn, m), v in list(out.items()):
                if nn != n or v["basis"] != "listings" or (c, m) in out:
                    continue
                usd = v["unit_usd"] * factor
                rate = float(fx[CURRENCY[c]])
                out[(c, m)] = dict(basis="estimate", kinds=v["kinds"], unit=v["unit"], strength=v["strength"], unit_price=usd * rate, unit_usd=usd,
                                   lo=v["lo"] / float(fx[CURRENCY[n]]) * factor * rate, hi=v["hi"] / float(fx[CURRENCY[n]]) * factor * rate,
                                   n=v["n"], by=[], from_country=n, factor=factor, overlap=len(ratios))
    import json
    cur.execute("delete from molecule_prices")
    with cur.copy("""copy molecule_prices (country, molecule_id, basis, kinds, currency, unit, strength, unit_price, unit_usd, lo, hi, n,
                     from_country, factor, overlap, by_strength) from stdin""") as cp:
        for (c, m), v in out.items():
            cp.write_row((c, m, v["basis"], v["kinds"], CURRENCY[c], v["unit"], v["strength"], round(v["unit_price"], 4), round(v["unit_usd"], 6),
                          round(v["lo"], 4), round(v["hi"], 4), v["n"], v.get("from_country"), v.get("factor"), v.get("overlap"),
                          json.dumps(v["by"], ensure_ascii=False)))
    log.info("molecule prices: %s", len(out))
    return len(out)


# ------------------------------------------------------------------ collectors
class Molecules:
    """A price row's molecule: through its registration number when we hold it, else its INN (English or Russian)."""

    def __init__(self, cur, country):
        from catalogue import Generics
        from country_load import load_ru
        self.g, self.ru = Generics(cur), load_ru()
        self.by_cert = dict(cur.execute("""select certificate_no, min(molecule_id) from registrations where country = %s
                                           and molecule_id is not null group by 1""", (country,)).fetchall())

    def find(self, cur, cert=None, inn=None):
        if cert and cert in self.by_cert:
            return self.by_cert[cert]
        inn = (inn or "").strip().lower()
        return self.g.molecule(cur, self.ru.get(inn) or inn) if inn else None


def save_listing(cur, country, source, kind, ref, name, pack, molecule, units, price, currency):
    cur.execute("""insert into price_listings (country, source, kind, ref, name, pack, molecule_id, units, pack_price, currency)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (source, ref) do update set name = excluded.name, pack = excluded.pack, molecule_id = excluded.molecule_id,
                   units = excluded.units, pack_price = excluded.pack_price, currency = excluded.currency, seen = current_date""",
                (country, source, kind, str(ref)[:200], (name or "")[:300], (pack or "")[:300], molecule, units, price, currency))


NDDA = "https://register.ndda.kz/register/api/v1/PharmaRegister"
KZ_PER_RUN = 400          # registrations checked per run (one request each), so a full pass takes about three days


def prices_KZ(cur, s):
    """Maximum price per unit for each registration (NDDA). The register's ids are listed weekly; each run checks the
    registrations looked at longest ago."""
    import time
    listed = cur.execute("select checked_at from source_items where source = 'prices_KZ:list' and ref = 'all'").fetchone()
    if not listed or listed[0] is None or (dt.datetime.now(dt.timezone.utc) - listed[0]).days >= 7:
        page = 1
        while True:
            d = s.post(f"{NDDA}/list/paged", json={"currentPage": page, "perPage": 200}, timeout=120).json()
            for x in d.get("data", []):
                if x.get("expirationDate") and x["expirationDate"][:10] < dt.date.today().isoformat():
                    continue                              # lapsed registrations carry no current price
                cur.execute("insert into source_items (source, ref) values ('prices_KZ', %s) on conflict do nothing", (str(x["id"]),))
            if page >= int(d.get("lastPage") or 0) or not d.get("data"):
                break
            page += 1
            time.sleep(0.5)
        cur.execute("""insert into source_items (source, ref, checked_at) values ('prices_KZ:list', 'all', now())
                       on conflict (source, ref) do update set checked_at = now()""")
    ids = [r[0] for r in cur.execute("""select ref from source_items where source = 'prices_KZ'
                                        order by checked_at nulls first limit %s""", (KZ_PER_RUN,)).fetchall()]
    mols, n, today = Molecules(cur, "KZ"), 0, dt.date.today().isoformat()
    for rid in ids:
        rows = s.get(f"{NDDA}/GetPriceList", params={"registerId": rid}, timeout=60).json() or []
        for x in rows:
            if x.get("endDate") and x["endDate"][:10] < today or not x.get("maxPrice"):
                continue
            pack = f"{x.get('dosageFormRu') or ''} · per {x.get('measurementUnitRu') or 'unit'}"
            save_listing(cur, "KZ", "prices_KZ", "cap", f"{rid}:{x.get('uniqueCode') or x.get('rowNumber')}", x.get("tradeNameRu"), pack,
                         mols.find(cur, x.get("registrationCertificate"), x.get("internationalNonproprietaryNameRu")), 1,
                         x["maxPrice"], "KZT")
            n += 1
        cur.execute("update source_items set checked_at = now() where source = 'prices_KZ' and ref = %s", (rid,))
        time.sleep(0.3)
    return n
