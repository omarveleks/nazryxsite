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

INJ = re.compile(r"инъек|инфуз|ампул|амп\.|\bфл\.|д/ин|в/в|в/м|флак.*(инъ|инф)|лиофил|inject|infusion|ampoule|\bamps?\b|\bvials?\b|\binj\b|i\.v\.", re.I)
SOLID = re.compile(r"табл|таб\.|капс|драже|супп|свеч|пастил|саше|пакет|гранул.*пакет|tablet|\btabs?\b|capsul|\bcaps?\b|sachet|"
                   r"supposit|pessar|lozeng|\bsupp\b|\b\d+\s*'?s\b", re.I)
STRENGTH = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mg|мг|mcg|мкг|µg|gm|g|г|ml|мл|iu|ме|ед|%)(?![a-zа-я])", re.I)
UNIT_EN = {"мг": "mg", "мкг": "mcg", "µg": "mcg", "г": "g", "gm": "g", "мл": "ml", "ме": "IU", "ед": "IU", "iu": "IU"}


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
        # the headline is the most listed form and strength, tablets first when they are a fair share of the listings
        sizes = {}
        for o in obs:
            sizes[(o[2], o[3])] = sizes.get((o[2], o[3]), 0) + 1
        unit, usual = max(sizes, key=lambda k: (sizes[k] * (2 if k[0] == "tablet or capsule" else 1), k[1] is not None))
        strengths = {}
        for o in obs:
            if o[2] == unit and o[3]:
                strengths.setdefault(o[3], []).append((o[4] / o[6], o[5] / o[6]))
        by = sorted(({"strength": k, "unit": round(sum(u for u, _ in v) / len(v), 4), "pack": round(sum(p for _, p in v) / len(v), 2),
                      "n": len(v)} for k, v in strengths.items()), key=lambda x: -x["n"])[:6]
        local = [o[4] / o[6] for o in obs if (o[2], o[3]) == (unit, usual)]      # in the market's own currency
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


class Names:
    """A pharmacy's product name to its molecule: an INN in the name (English or Russian), else a brand registered in
    that market or its neighbours. Names naming more than one molecule (combinations) are left out."""

    def __init__(self, cur, country):
        import collect
        self.inn = collect.MoleculeIndex(cur)
        seen = {}
        region = [country, *NEIGHBOURS[country]]       # the same brands are sold across the region
        for brand, mol in cur.execute("""select brand, molecule_id from registrations where country = any(%s)
                                         and molecule_id is not null and brand is not null""", (region,)):
            w = re.match(r"[a-zа-яё][a-zа-яё\-]{3,}", brand.strip().lower())     # in Python: the database may not lower Cyrillic
            if w:
                seen.setdefault(w.group(0), []).append(mol)
        self.brand = {}
        for w, ms in seen.items():                     # the brand's molecule when at least 3 in 4 registrations agree
            top = max(set(ms), key=ms.count)
            if ms.count(top) * 4 >= len(ms) * 3:
                self.brand[w] = top

    def find(self, name, extra=""):
        mols = self.inn.find(name, extra)
        if len(mols) == 1:
            return mols[0]
        if mols:
            return None
        w = re.match(r"[a-zа-яё][a-zа-яё\-]{3,}", (name or "").strip().lower())
        return self.brand.get(w.group(0)) if w else None


def due_items(cur, source, per_run, list_items, every_days=7):
    """The next refs to read for a source read one record at a time; the list itself is refreshed every few days."""
    listed = cur.execute("select checked_at from source_items where source = %s and ref = '*list'", (source,)).fetchone()
    if not listed or listed[0] is None or (dt.datetime.now(dt.timezone.utc) - listed[0]).days >= every_days:
        for ref in list_items():
            cur.execute("insert into source_items (source, ref) values (%s, %s) on conflict do nothing", (source, str(ref)))
        cur.execute("""insert into source_items (source, ref, checked_at) values (%s, '*list', now())
                       on conflict (source, ref) do update set checked_at = now()""", (source,))
    return [r[0] for r in cur.execute("""select ref from source_items where source = %s and ref <> '*list'
                                         and (checked_at is null or checked_at < now() - make_interval(days => %s))
                                         order by checked_at nulls first limit %s""", (source, every_days, per_run)).fetchall()]


def checked(cur, source, ref, state=None):
    cur.execute("update source_items set checked_at = now(), state = coalesce(%s, state) where source = %s and ref = %s",
                (state, source, ref))


def save_listing(cur, country, source, kind, ref, name, pack, molecule, units, price, currency):
    cur.execute("""insert into price_listings (country, source, kind, ref, name, pack, molecule_id, units, pack_price, currency)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (source, ref) do update set name = excluded.name, pack = excluded.pack, molecule_id = excluded.molecule_id,
                   units = excluded.units, pack_price = excluded.pack_price, currency = excluded.currency, seen = current_date""",
                (country, source, kind, str(ref)[:200], (name or "")[:300], (pack or "")[:300], molecule, units, price, currency))


NDDA = "https://register.ndda.kz/register/api/v1/PharmaRegister"
KZ_PER_RUN = 400          # registrations checked per run (one request each), so a full pass takes about three days


def prices_KZ(cur, s):
    """Maximum price per unit for each registration (NDDA): the register's ids are listed weekly, and each run checks
    the registrations looked at longest ago."""
    import time

    def ids():
        page, today = 1, dt.date.today().isoformat()
        while True:
            d = s.post(f"{NDDA}/list/paged", json={"currentPage": page, "perPage": 200}, timeout=120).json()
            for x in d.get("data", []):
                if not (x.get("expirationDate") and x["expirationDate"][:10] < today):   # lapsed ones carry no price
                    yield x["id"]
            if page >= int(d.get("lastPage") or 0) or not d.get("data"):
                return
            page += 1
            time.sleep(0.5)

    mols, n, today = Molecules(cur, "KZ"), 0, dt.date.today().isoformat()
    for rid in due_items(cur, "prices_KZ", KZ_PER_RUN, ids, every_days=3):
        for x in s.get(f"{NDDA}/GetPriceList", params={"registerId": rid}, timeout=60).json() or []:
            if x.get("endDate") and x["endDate"][:10] < today or not x.get("maxPrice"):
                continue
            pack = f"{x.get('dosageFormRu') or ''} · per {x.get('measurementUnitRu') or 'unit'}"
            save_listing(cur, "KZ", "prices_KZ", "cap", f"{rid}:{x.get('uniqueCode') or x.get('rowNumber')}", x.get("tradeNameRu"), pack,
                         mols.find(cur, x.get("registrationCertificate"), x.get("internationalNonproprietaryNameRu")), 1,
                         x["maxPrice"], "KZT")
            n += 1
        checked(cur, "prices_KZ", rid)
        time.sleep(0.3)
    return n + europharma(cur, s)


def sitemap_urls(s, url, keep):
    """Page URLs from a sitemap, following one level of sitemap indexes."""
    xml = s.get(url, timeout=120).text
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)
    if "<sitemapindex" in xml:
        return [u for sm in locs if "product" in sm for u in sitemap_urls(s, sm, keep)]
    return [u for u in locs if keep(u)]


def ld_products(page):
    """schema.org Product objects in a page's JSON-LD."""
    import html as htmllib
    import json
    out = []
    for block in re.findall(r"<script[^>]*ld\+json[^>]*>(.*?)</script>", page, re.S):
        try:
            d = json.loads(htmllib.unescape(block))
        except ValueError:
            continue
        for x in (d.get("@graph") or [d]) if isinstance(d, dict) else d:
            kind = x.get("@type") if isinstance(x, dict) else None
            if kind == "Product" or isinstance(kind, list) and "Product" in kind:
                out.append(x)
    return out


EUROPHARMA = "https://europharma.kz/sitemap_ru.xml"
EP_PER_RUN = 150          # product pages a run, one a second: the whole chain about every five days


def europharma(cur, s):
    """A national pharmacy chain's medicine pages: the INN is stated, the price is the Almaty price when in stock."""
    import time
    mols, n = Molecules(cur, "KZ"), 0
    pages = due_items(cur, "prices_KZ_ep", EP_PER_RUN, lambda: sitemap_urls(s, EUROPHARMA, lambda u: "europharma.kz/" in u))
    for url in pages:
        r = s.get(url, timeout=60)
        for x in ld_products(r.text if r.ok else ""):
            offer = x.get("offers") or {}
            price = num(offer.get("price")) if isinstance(offer, dict) else None
            if price and x.get("nonProprietaryName"):
                save_listing(cur, "KZ", "europharma", "retail", url, x.get("name"), x.get("name"),
                             mols.find(cur, None, x["nonProprietaryName"]), None, price, offer.get("priceCurrency") or "KZT")
                n += 1
        checked(cur, "prices_KZ_ep", url)
        time.sleep(1)
    return n


# Kyrgyzstan: a pharmacy chain's whole catalogue in one open list, and the drug department's register of maximum prices.
BIMED = "https://bimed.kg/api/products/"
DLSMI = "https://dlsmi.kg/ru/price_regulation/"


def prices_KG(cur, s):
    import io
    import pandas as pd
    from urllib.parse import urljoin
    names, mols, n = Names(cur, "KG"), Molecules(cur, "KG"), 0
    for x in s.get(BIMED, timeout=300).json():
        price, mol = num(x.get("price")), names.find(x.get("name") or "")
        if price and mol:
            save_listing(cur, "KG", "bimed", "retail", x["id"], x.get("name"), x.get("name"), mol, None, price, "KGS")
            n += 1
    page = s.get(DLSMI, timeout=60).text
    files = [h for h in re.findall(r'href="([^"]+\.xlsx)"', page) if "сайт" in h and "расход" not in h]
    if files:
        url = urljoin(DLSMI.rstrip("/"), files[0])        # links are relative to the page without its trailing slash
        sheet = pd.read_excel(io.BytesIO(s.get(url, timeout=300).content), header=None, dtype=str)
        rows = sheet.values.tolist()
        head = next((i for i, r in enumerate(rows) if any("МНН" in str(c) for c in r)), None)
        if head is not None:
            cols = [str(c) for c in rows[head]]
            col = lambda word: next(i for i, c in enumerate(cols) if word in c)
            name_c, inn_c, retail_c = col("Лекарственное"), col("МНН"), col("розничн")
            for r in rows[head + 1:]:
                price = num(r[retail_c])
                if price and isinstance(r[name_c], str):
                    save_listing(cur, "KG", "dlsmi", "cap", r[name_c], r[name_c], r[name_c], mols.find(cur, None, r[inn_c]),
                                 None, price, "KGS")
                    n += 1
    return n


# Kenya: the procurement regulator's quarterly market price survey (national average of five towns), and a pharmacy
# chain's open product feed, prescription medicines (its robots.txt asks for 30 seconds between requests).
PPRA = "https://ppra.go.ke/market-price-index/"
GOODLIFE = "https://www.goodlife.co.ke/wp-json/wc/store/v1/products"
GOODLIFE_RX = 8156         # its "Prescription Products" category: medicines, not cosmetics or supplements
GOODLIFE_PAGES = 6         # 100 products a page, 30 s apart
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september",
                                      "october", "november", "december"], 1)}


def ppra_rows(pdf):
    """Medicine rows of the Market Price Reference Guide: (item, unit, quantity, national average KES)."""
    import io
    import pypdf
    out, inside = [], False
    for page in pypdf.PdfReader(io.BytesIO(pdf)).pages:
        for line in page.extract_text(extraction_mode="layout").splitlines():
            if re.search(r"PPRA\d{3}\s*[–-]", line):
                inside = "PHARMACEUTICAL" in line.upper()
                continue
            if not inside:
                continue
            cells = re.split(r"\s{2,}", re.sub(r"\s*Page \d+ of \d+.*$", "", line).strip())
            if re.match(r"\d+\.$", cells[0]) and len(cells) >= 6 and re.match(r"\d{8}$", cells[1]):
                avg = num(cells[-1])
                out.append([cells[2], cells[3], num(cells[4]), avg])
            elif out and len(cells) == 1 and not re.search(r"S/No|UNSPSC|Code|Average", line):
                out[-1][0] += " " + cells[0]          # an item name wrapped onto the next line
    return [r for r in out if r[2] and r[3]]


def num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


def prices_KE(cur, s):
    import time
    names, n = Names(cur, "KE"), 0
    # the survey: when a new quarter is out
    links = re.findall(r'"(https://ppra\.go\.ke/download/(?:mprg|market-price[a-z-]*)-([a-z]+)-(\d{4})/\?wpdmdl=\d+)"',
                       s.get(PPRA, timeout=60).text)
    if links:
        url, month, year = max(links, key=lambda x: (int(x[2]), MONTHS.get(x[1], 0)))
        got = cur.execute("select state from source_items where source = 'prices_KE' and ref = 'ppra'").fetchone()
        if not got or got[0] != url:
            for item, unit, qty, avg in ppra_rows(s.get(url, timeout=300).content):
                counted = re.match(r"tablet|capsule|ampoule|vial|sachet|suppositor|pessar", unit, re.I)
                save_listing(cur, "KE", "ppra", "retail", f"{item}|{unit}|{qty:g}", item, f"{item} · {qty:g} {unit}",
                             names.find(item), qty if counted else 1, avg, "KES")
                n += 1
            cur.execute("""insert into source_items (source, ref, checked_at, state) values ('prices_KE', 'ppra', now(), %s)
                           on conflict (source, ref) do update set checked_at = now(), state = excluded.state""", (url,))
    # the pharmacy feed, a few pages a run
    row = cur.execute("select state from source_items where source = 'prices_KE' and ref = 'goodlife'").fetchone()
    page = int(row[0]) if row and row[0] else 1
    for _ in range(GOODLIFE_PAGES):
        r = s.get(GOODLIFE, params={"per_page": 100, "page": page, "category": GOODLIFE_RX}, timeout=120)
        items = r.json() if r.ok else []
        for x in items:
            p = x.get("prices") or {}
            price = num(p.get("price"))
            mol = names.find(x.get("name") or "", re.sub(r"<[^>]+>", " ", x.get("short_description") or ""))
            if price and mol:
                save_listing(cur, "KE", "goodlife", "retail", x["id"], x.get("name"), x.get("name"), mol, None,
                             price / 10 ** int(p.get("currency_minor_unit") or 0), p.get("currency_code") or "KES")
                n += 1
        page = 1 if len(items) < 100 else page + 1
        if page == 1:
            break
        time.sleep(30)
    cur.execute("""insert into source_items (source, ref, checked_at, state) values ('prices_KE', 'goodlife', now(), %s)
                   on conflict (source, ref) do update set checked_at = now(), state = excluded.state""", (str(page),))
    return n


# Tanzania: no official or survey price list is public; an online pharmacy's product pages (schema.org prices).
AFYADEPO = "https://afyadepot.co.tz"
TZ_PER_RUN = 120


def prices_TZ(cur, s):
    import time

    def urls():
        xml = s.get(f"{AFYADEPO}/sitemap.xml", timeout=60).text
        return re.findall(r"<loc>([^<]+/product/[^<]+)</loc>", xml)

    names, n = Names(cur, "TZ"), 0
    for url in due_items(cur, "prices_TZ", TZ_PER_RUN, urls):
        r = s.get(url, timeout=60)
        for x in ld_products(r.text if r.ok else ""):
            offer = x.get("offers") or {}
            price = num(offer.get("price")) if isinstance(offer, dict) else None
            mol = names.find(x.get("name") or "", x.get("description") or "") if price else None
            if mol:
                save_listing(cur, "TZ", "afyadepo", "retail", url, x.get("name"), x.get("name"), mol, None, price,
                             offer.get("priceCurrency") or "TZS")
                n += 1
        checked(cur, "prices_TZ", url)
        time.sleep(1)
    return n
