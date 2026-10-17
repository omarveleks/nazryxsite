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
NEARBY = {"africa": ("UG", "RW", "NG", "GH", "ZA", "ET"),       # nearby countries with price data (estimates only)
          "cis": ("BY", "AM", "AZ", "GE", "RU")}
NEIGHBOURS = {"KZ": ("KG", "UZ") + NEARBY["cis"], "KG": ("KZ", "UZ") + NEARBY["cis"], "UZ": ("KZ", "KG") + NEARBY["cis"],
              "KE": ("TZ",) + NEARBY["africa"], "TZ": ("KE",) + NEARBY["africa"]}
CURRENCY = {"KZ": "KZT", "KG": "KGS", "UZ": "UZS", "KE": "KES", "TZ": "TZS", "PK": "PKR", "GB": "GBP", "FR": "EUR",
            "UG": "UGX", "RW": "RWF", "NG": "NGN", "GH": "GHS", "ZA": "ZAR", "ET": "ETB",
            "BY": "BYN", "AM": "AMD", "AZ": "AZN", "GE": "GEL", "RU": "RUB"}
ABROAD = ("PK", "GB", "FR")    # far reference countries: last, only for molecules nothing nearer prices, Pakistan first
OTHERS = NEARBY["africa"] + NEARBY["cis"] + ABROAD
RANK = {"retail": 0, "cap": 1, "reimbursement": 2, "tender": 3}
MIN_OVERLAP = 15          # molecules priced in both markets before their price ratio is trusted; otherwise 1.0

INJ = re.compile(r"injectable|perfusion|инъек|инфуз|ампул|амп\.|\bфл\.|д/ин|в/в|в/м|флак.*(инъ|инф)|лиофил|inject|infusion|ampoule|\bamps?\b|\bvials?\b|\binj\b|i\.v\.", re.I)
SOLID = re.compile(r"comprim|gélule|табл|таб\.|капс|драже|супп|свеч|пастил|саше|пакет|гранул.*пакет|tablet|\btabs?\b|capsul|\bcaps?\b|sachet|"
                   r"supposit|pessar|lozeng|\bsupp\b|\b\d+\s*'?s\b", re.I)
STRENGTH = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mg|мг|mcg|мкг|µg|gm|g|г|ml|мл|iu|ме|ед|%)(?![a-zа-я])", re.I)
UNIT_EN = {"мг": "mg", "мкг": "mcg", "µg": "mcg", "г": "g", "gm": "g", "мл": "ml", "ме": "IU", "ед": "IU", "iu": "IU"}


def unit_of(text):
    t = text or ""
    return "ampoule or vial" if INJ.search(t) else "tablet or capsule" if SOLID.search(t) else "pack"


def units_in(text):
    """How many units a pack holds, from its description; None when a counted pack does not say."""
    t = (text or "").lower().replace("х", "x").replace("×", "x").replace("’", "'")
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
    for cur_code in set(CURRENCY.values()):
        if d["rates"].get(cur_code):
            cur.execute("""insert into fx_rates (currency, per_usd) values (%s, %s) on conflict (currency)
                           do update set per_usd = excluded.per_usd, updated_at = now()""", (cur_code, d["rates"][cur_code]))


SALTS = re.compile(r"\b(?:hydrochloride|hcl|dihydrochloride|hydrobromide|sodium|disodium|potassium|calcium|magnesium|besylate|"
                   r"besilate|maleate|mesylate|mesilate|fumarate|hemifumarate|succinate|tartrate|bitartrate|citrate|hyclate|"
                   r"propanediol|monohydrate|dihydrate|trihydrate|sesquihydrate|anhydrous|acetate|phosphate|sulfate|sulphate|"
                   r"inn|usp|bp|base|trometamol|tromethamine|arginine|lysine|meglumine|dipropionate|propionate|valerate)\b")


def family(inn):
    """One key for every spelling of a molecule: salts dropped, and English and Russian-style Latin spellings alike
    ('Xylometazoline hydrochloride' and 'Ksilometazolin' -> 'ksilometazolin'). Combinations: each part, sorted."""
    parts = []
    for part in re.split(r"\s*\+\s*|\s*/\s*|\s+and\s+", (inn or "").lower()):
        t = SALTS.sub(" ", re.sub(r"\(.*?\)", " ", part))
        t = re.sub(r"[^a-z]", "", t)
        for a_, b_ in (("ph", "f"), ("th", "t"), ("x", "ks"), ("qu", "kv"), ("w", "v"), ("y", "i"), ("kh", "h"), ("h", "g"),
                       ("ce", "tse"), ("ci", "tsi"), ("c", "k"), ("j", "i")):
            t = t.replace(a_, b_)
        t = re.sub(r"(.)\1+", r"\1", t).replace("ts", "s")       # Uzbek Latin writes ц as s
        t = re.sub(r"[e]$", "", t)
        if "atsid" in t or "asid" in t:                            # clavulanic acid = clavulanate
            t = re.sub(r"ik?a?t?s?id$", "", t.replace("atsid", "asid")).rstrip("a")
            t = re.sub(r"ik$", "", t) + "at"
        if t:
            parts.append(t)
    return "+".join(sorted(set(parts)))


SALT_WORDS = ("hydrochloride", "dihydrochloride", "hydrobromide", "bromide", "butylbromide", "sulphate", "sulfate", "citrate",
              "maleate", "fumarate", "besylate", "besilate", "mesylate", "mesilate", "potassium", "sodium", "disodium", "magnesium",
              "calcium", "meglumine", "dimeglumine", "monohydrate", "dihydrate", "trihydrate", "anhydrous", "acetate", "phosphate",
              "lactate", "gluconate", "tartrate", "succinate", "propionate", "dipropionate", "valerate", "hyclate", "equivalent",
              "contains", "tablet", "tablets", "capsule", "capsules", "coated", "orally", "dispersible", "disintegrating",
              "injection", "solution", "syrup", "suspension", "cream", "ointment", "sachet", "drops", "chewable", "prolonged",
              "release", "modified", "extended", "infusion", "powder", "film")
FILLER = {"each", "contains", "to", "of", "as", "with", "for", "the", "and", "in", "acid", "base", "free", "usp", "bp", "ip", "inn", "eq", "equivalent"}


def ingredients(name, singles):
    """The single-molecule families in a free-text name ('Each tablet contains: Telmirsatan …', 'Clobetasol Proprionate
    Gentamycin Sulphate'), or None unless every meaningful word is recognised (close spellings allowed)."""
    from rapidfuzz import process, fuzz
    words = re.findall(r"[a-z][a-z\-]{3,}", re.sub(r"\(.*?\)", " ", (name or "").lower()))
    found = []
    for w in words:
        if w in FILLER or process.extractOne(w, SALT_WORDS, scorer=fuzz.ratio, score_cutoff=85):
            continue                                    # salts and label words, typos included ('hydrohloride')
        k = family(w)
        if not k or len(k) < 5:
            continue
        if k in singles:
            found.append(k)
            continue
        # a typo, not another medicine: very close, same start, same length within one letter (prednisolone is not prednisone)
        hits = [h for h, score, _ in process.extract(k, singles, scorer=fuzz.ratio, score_cutoff=90, limit=3)
                if h[:3] == k[:3] and abs(len(h) - len(k)) <= 1]
        if not hits:
            return None                                 # a word we do not know: do not guess
        found.append(hits[0])
    return "+".join(sorted(set(found))) or None


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


def pct(xs, q):
    """The q-th percentile of sorted values (nearest rank)."""
    return xs[min(len(xs) - 1, max(0, round(q * (len(xs) - 1))))]


def trimmed(xs):
    xs = sorted(xs)
    if len(xs) >= 5:
        k = max(1, len(xs) // 10)
        xs = xs[k:-k]
    return xs


def rebuild(cur):
    fx = dict(cur.execute("select currency, per_usd from fx_rates").fetchall())
    sources = tuple(c for c in MARKETS + OTHERS if CURRENCY[c] in fx)       # a country without an exchange rate sits out
    fam, members = {}, {}                      # every spelling of a molecule shares its prices
    for mid, inn in cur.execute("select id, inn from molecules where inn is not null"):
        k = family(inn)
        if k:
            fam[mid] = k
            members.setdefault(k, []).append(mid)
    groups = {}
    for c, m, kind, text, units, price, ccy in observations(cur):
        m = fam.get(m, m)
        if c not in sources or ccy not in fx:
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
        local = sorted(o[4] / o[6] for o in obs if (o[2], o[3]) == (unit, usual))      # in the market's own currency
        t = trimmed(local)
        avg = sum(t) / len(t)
        out[(c, m)] = dict(basis="listings", kinds=sorted({o[1] for o in obs}), unit=unit, strength=usual, unit_price=avg,
                           unit_usd=avg / float(fx[CURRENCY[c]]), lo=pct(local, 0.1), hi=pct(local, 0.9), n=len(local), by=by)
    # molecules whose name only differs by typos, salts or label text share the family that has prices
    priced = {k for (_, k) in out}
    singles = sorted(k for k in priced if isinstance(k, str) and "+" not in k)
    for mid, inn in cur.execute("select id, inn from molecules where inn is not null").fetchall():
        if fam.get(mid) in priced:
            continue
        k = ingredients(inn, singles)
        if k in priced and k != fam.get(mid):
            members.setdefault(k, []).append(mid)
            members.get(fam.get(mid), []).remove(mid) if mid in members.get(fam.get(mid), []) else None
            fam[mid] = k
    # estimates for what a market lacks: from the market whose prices compare best with it (neighbours first, then the
    # market sharing the most priced molecules), adjusted by the median price ratio between the two markets
    direct = dict(out)
    factors = {}
    markets = tuple(c for c in MARKETS if c in sources)
    abroad = tuple(c for c in ABROAD if c in sources)
    for c in markets:
        for n in sources:
            if n == c:
                continue
            ratios = [direct[(c, m)]["unit_usd"] / direct[(n, m)]["unit_usd"] for (cc, m) in direct
                      if cc == c and (n, m) in direct and direct[(n, m)]["unit_usd"] > 0
                      and (direct[(n, m)]["unit"], direct[(n, m)]["strength"]) == (direct[(c, m)]["unit"], direct[(c, m)]["strength"])]
            factors[(c, n)] = (statistics.median(ratios) if len(ratios) >= MIN_OVERLAP else 1.0, len(ratios))

    def gap(c, n):
        """(factor, molecules behind it, how good): measured between the two markets, else borrowed from a neighbour of
        c that has it measured (neighbours price alike), else none (1.0)."""
        f, k = factors[(c, n)]
        if k >= MIN_OVERLAP:
            return f, k, 0 if n in NEIGHBOURS[c] else 1
        if n in NEIGHBOURS[c]:
            return 1.0, k, 2
        via = [factors[(nb, n)] for nb in NEIGHBOURS[c] if nb != n and factors.get((nb, n), (1, 0))[1] >= MIN_OVERLAP]
        return (max(via, key=lambda x: x[1]) + (3,)) if via else (1.0, k, 4)

    for c in markets:
        # our markets and nearby countries first, in order of how well their prices compare; far reference countries last
        order = sorted((n for n in sources if n != c and n not in ABROAD), key=lambda n: (gap(c, n)[2], -gap(c, n)[1])) \
            + sorted(abroad, key=lambda n: (gap(c, n)[2] > 1, ABROAD.index(n)))
        for n in order:
            factor, overlap, _ = gap(c, n)
            rate, rate_n = float(fx[CURRENCY[c]]), float(fx[CURRENCY[n]])
            for (nn, m), v in direct.items():
                if nn != n or (c, m) in out:
                    continue
                out[(c, m)] = dict(basis="estimate", kinds=v["kinds"], unit=v["unit"], strength=v["strength"],
                                   unit_price=v["unit_usd"] * factor * rate, unit_usd=v["unit_usd"] * factor,
                                   lo=v["lo"] / rate_n * factor * rate, hi=v["hi"] / rate_n * factor * rate,
                                   n=v["n"], by=[], from_country=n, factor=factor, overlap=overlap)
    # combinations nobody prices: their ingredients' prices added up, scaled by how combination packs compare with their
    # ingredients where both are priced (measured on our data)
    samples = []
    for (c, k), v in direct.items():
        parts = k.split("+") if isinstance(k, str) and "+" in k else []
        if parts and all((c, p) in direct and direct[(c, p)]["unit"] == v["unit"] for p in parts):
            samples.append(v["unit_usd"] / sum(direct[(c, p)]["unit_usd"] for p in parts))
    combo_factor = statistics.median(samples) if len(samples) >= MIN_OVERLAP else 1.0
    singles = sorted(k for (_, k) in out if isinstance(k, str) and "+" not in k)
    for mid, inn in cur.execute("select id, inn from molecules where inn is not null").fetchall():
        k = fam.get(mid)
        k = k if isinstance(k, str) and "+" in k else ingredients(inn, singles)
        if not k or "+" not in k:
            continue
        parts, added = k.split("+"), False
        for c in markets:
            if (c, k) in out or (c, fam.get(mid)) in out or not all((c, p) in out for p in parts) \
                    or len({out[(c, p)]["unit"] for p in parts}) > 1:
                continue
            usd, rate = sum(out[(c, p)]["unit_usd"] for p in parts) * combo_factor, float(fx[CURRENCY[c]])
            out[(c, k)] = dict(basis="estimate", kinds=["ingredients"], unit=out[(c, parts[0])]["unit"], strength=None,
                               unit_price=usd * rate, unit_usd=usd, lo=sum(out[(c, p)]["lo"] for p in parts) * combo_factor,
                               hi=sum(out[(c, p)]["hi"] for p in parts) * combo_factor, n=len(parts), by=[],
                               from_country=None, factor=combo_factor, overlap=len(samples))
            added = True
        if added and mid not in members.setdefault(k, []):
            members[k].append(mid)

    import json
    cur.execute("delete from molecule_prices")
    with cur.copy("""copy molecule_prices (country, molecule_id, basis, kinds, currency, unit, strength, unit_price, unit_usd, lo, hi, n,
                     from_country, factor, overlap, by_strength) from stdin""") as cp:
        written = set()                                 # a molecule in two families keeps the first (best) price
        for (c, k), v in out.items():
            if c not in MARKETS:
                continue
            for m in members.get(k, [k]):
                if (c, m) in written:
                    continue
                written.add((c, m))
                cp.write_row((c, m, v["basis"], v["kinds"], CURRENCY[c], v["unit"], v["strength"], round(v["unit_price"], 4), round(v["unit_usd"], 6),
                              round(v["lo"], 4), round(v["hi"], 4), v["n"], v.get("from_country"), v.get("factor"), v.get("overlap"),
                              json.dumps(v["by"], ensure_ascii=False)))
    log.info("molecule prices: %s", len(written))
    return len(written)


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
        self.fam, self.combos = {}, {}
        for mid, inn in cur.execute("select id, inn from molecules where inn is not null"):
            k = family(inn)
            self.fam[mid] = k
            if "+" in k:
                self.combos.setdefault(k, mid)
        self.brand = {}
        for w, ms in seen.items():                     # the brand's molecule when at least 3 in 4 registrations agree
            top = max(set(ms), key=ms.count)
            if ms.count(top) * 4 >= len(ms) * 3:
                self.brand[w] = top

    def find(self, name, extra=""):
        mols = self.inn.find(name, extra)
        if len(mols) == 1:
            return mols[0]
        if mols:                                       # several ingredients: the combination of exactly those, if we know it
            return self.combos.get("+".join(sorted({self.fam.get(m, "") for m in mols})))
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


ITEM_SOURCES = {"KZ": ("prices_KZ", "prices_KZ_ep"), "TZ": ("prices_TZ",), "INTL": ("prices_INTL_pk",)}


def catching_up(cur, country):
    """True while a source read one record at a time has records it has never read: it then runs again straight away."""
    return bool(cur.execute("""select 1 from source_items where source = any(%s) and ref <> '*list' and checked_at is null
                               limit 1""", (list(ITEM_SOURCES.get(country, ())),)).fetchone())


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
KZ_PER_RUN = 800          # registrations checked per run, about one a second (runs back to back until the first pass is done)


def prices_KZ(cur, s):
    """Maximum price per unit for each registration (NDDA): the register's ids are listed weekly, and each run checks
    the registrations looked at longest ago."""
    import time

    def ids():
        page, today = 1, dt.date.today().isoformat()
        while True:
            d = s.post(f"{NDDA}/list/paged", json={"currentPage": page, "perPage": 200}, timeout=120).json()
            for x in d.get("data", []):
                # lapsed registrations carry no price, and an EAEU registration's price sits on the national one
                if x.get("sourceType") != "Eaes" and not (x.get("expirationDate") and x["expirationDate"][:10] < today):
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
        time.sleep(0.5)
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
EP_PER_RUN = 300          # product pages a run, one a second


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
TZ_PER_RUN = 300


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


# Abroad (third tier): official price lists of an exporting country and two reference countries, read in bulk.
DRAP = "https://e.dra.gov.pk/public/price"
DRAP_PER_RUN = 150            # pages of 20 medicines, two seconds apart
NHS_TARIFF = "https://www.nhsbsa.nhs.uk/pharmacies-gp-practices-and-appliance-contractors/drug-tariff/drug-tariff-part-viii"
BDPM = "https://base-donnees-publique.medicaments.gouv.fr/download/file/"


def english_molecule(cur, names, generics, text):
    """An English or French INN in a product name, or None."""
    return names.find(text) if names.inn.find(text) else generics.molecule(cur, text)


FR_SALT = re.compile(r"^(?:di|hémi|mono)?(?:chlorhydrate|bromhydrate|fumarate|maléate|succinate|tartrate|sulfate|citrate|acétate|"
                     r"mésilate|mésylate|bésilate|bésylate|tosilate|phosphate|lactate|gluconate|valérate|propionate|butyrate|"
                     r"chlorure|bromure|nitrate|oxalate|malate|énanthate|décanoate|palmitate|pamoate|furoate|xinafoate)"
                     r"\s+(?:de\s+|d['’]\s*)", re.I)
FR_SUFFIX = re.compile(r"\s+(?:sodique|disodique|calcique|potassique|magnésique|monohydraté|trihydraté|dihydraté|anhydre)\b.*$", re.I)


def french_base(name):
    """'FUMARATE DE QUÉTIAPINE' -> 'QUÉTIAPINE', 'ÉNOXAPARINE SODIQUE' -> 'ÉNOXAPARINE'."""
    return FR_SUFFIX.sub("", FR_SALT.sub("", (name or "").strip())).strip()


def prices_INTL(cur, s):
    import csv
    import io
    import time
    from catalogue import Generics
    from urllib.parse import urljoin
    import pandas as pd
    names, generics, n = Names(cur, "KE"), Generics(cur), 0
    # UK Drug Tariff Part VIIIA (monthly CSV; prices in pence)
    page = s.get(NHS_TARIFF, timeout=60).text
    link = next(iter(re.findall(r'href="([^"]*Part%20VIIIA[^"]*\.csv)"', page)), None)
    done = cur.execute("select state from source_items where source = 'prices_INTL' and ref = 'nhs'").fetchone()
    if link and (not done or done[0] != link):
        rows = list(csv.reader(io.StringIO(s.get(urljoin(NHS_TARIFF, link), timeout=120).content.decode("utf-8-sig", "ignore"))))
        head = next(i for i, r in enumerate(rows) if r and r[0] == "Medicine")
        for r in rows[head + 1:]:
            if len(r) < 7 or not num(r[6]):
                continue
            counted = re.match(r"tablet|capsule|ampoule|vial|sachet|suppositor|pessar|lozenge", r[2] or "", re.I)
            save_listing(cur, "GB", "nhs_tariff", "cap", r[4] or r[0], r[0], f"{r[0]} · {r[1]} {r[2]}",
                         english_molecule(cur, names, generics, r[0]), num(r[1]) if counted else 1, num(r[6]) / 100, "GBP")
            n += 1
        cur.execute("""insert into source_items (source, ref, checked_at, state) values ('prices_INTL', 'nhs', now(), %s)
                       on conflict (source, ref) do update set checked_at = now(), state = excluded.state""", (link,))
    # France: reimbursed public prices (weekly), single-substance medicines only
    done = cur.execute("select checked_at from source_items where source = 'prices_INTL' and ref = 'bdpm'").fetchone()
    if not done or (dt.datetime.now(dt.timezone.utc) - done[0]).days >= 7:
        get = lambda f, enc: s.get(BDPM + f, timeout=300).content.decode(enc, "ignore").splitlines()
        forms = {r.split("\t")[0]: r.split("\t")[2] for r in get("CIS_bdpm.txt", "latin-1") if r.count("\t") > 2}
        sa, ft = {}, {}                  # active substance as named (often a salt), and its active part where stated
        for r in get("CIS_COMPO_bdpm.txt", "latin-1"):
            c = r.split("\t")
            if len(c) > 6 and c[6] in ("SA", "FT"):
                (sa if c[6] == "SA" else ft).setdefault(c[0], []).append((c[3], c[4]))
        subst = {k: ft[k] if len(ft.get(k, [])) == 1 else v for k, v in sa.items()}
        for r in get("CIS_CIP_bdpm.txt", "utf-8"):
            c = r.split("\t")
            raw = re.sub(r"[\s\u00a0]", "", c[9] if len(c) > 9 else "")
            price = num(raw.replace(",", "", raw.count(",") - 1).replace(",", "."))      # '3,982,28' is 3982.28
            if len(c) < 10 or len(subst.get(c[0], [])) != 1 or not price:
                continue
            inn, dose = subst[c[0]][0]
            unit_words = r"(?:comprimé|gélule|capsule|ampoule|flacon|sachet|suppositoire|seringue|stylo)"
            boxes = re.search(r"(\d+)\s+(?:plaquettes?|étuis?|flacons?|boîtes?)\b.*?de\s+(\d+)\s+" + unit_words, c[2])
            m = re.search(r"(\d+)\s*" + unit_words, c[2])
            pack = f"{forms.get(c[0], '')} {dose} · {c[2]}"
            units = int(boxes.group(1)) * int(boxes.group(2)) if boxes else int(m.group(1)) if m else \
                (None if unit_of(pack) == "tablet or capsule" else 1)
            save_listing(cur, "FR", "bdpm", "cap", c[1], inn, pack, generics.molecule(cur, inn) or generics.molecule(cur, french_base(inn)), units,
                         price, "EUR")
            n += 1
        cur.execute("""insert into source_items (source, ref, checked_at) values ('prices_INTL', 'bdpm', now())
                       on conflict (source, ref) do update set checked_at = now()""")

    # Pakistan: notified maximum retail prices of essential medicines, a page at a time
    def pages():
        first = s.get(DRAP, params={"category": "Essential Drugs", "page": 1}, timeout=60).text
        last = max([int(x) for x in re.findall(r"page=(\d+)", first)] or [1])
        return range(1, last + 1)

    for p in due_items(cur, "prices_INTL_pk", DRAP_PER_RUN, pages, every_days=30):
        r = s.get(DRAP, params={"category": "Essential Drugs", "page": p}, timeout=60)
        for t in (pd.read_html(io.StringIO(r.text)) if r.ok and "<table" in r.text else []):
            if "Price" not in t.columns:
                continue
            for _, x in t.iterrows():
                name, price = str(x.get("Product Name") or ""), num(re.sub(r"[^\d.]", "", str(x.get("Price") or "")))
                mol = english_molecule(cur, names, generics, name) if price else None
                if mol:
                    save_listing(cur, "PK", "drap", "cap", str(x.get("Reg. Number")), name, f"{name} · {x.get('Pack Size')}",
                                 mol, None, price, "PKR")
                    n += 1
        checked(cur, "prices_INTL_pk", str(p))
        time.sleep(2)
    return n
