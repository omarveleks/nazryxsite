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
MARKETS = ("KZ", "KG", "UZ", "KE", "TZ", "NG")
NEARBY = {"africa": ("GH", "ZA"),                                # nearby countries with price data (estimates only)
          "cis": ("BY", "AM", "AZ")}
# East Africa's medicines mostly come from South Asia, so its estimates draw on the South Asian makers' home prices
# (Pakistan, India, Bangladesh) and Nigeria, beside each other
SOUTH_ASIA = ("PK", "IN", "BD")
NEIGHBOURS = {"KZ": ("KG", "UZ") + NEARBY["cis"], "KG": ("KZ", "UZ") + NEARBY["cis"], "UZ": ("KZ", "KG") + NEARBY["cis"],
              "KE": ("TZ", "NG") + SOUTH_ASIA, "TZ": ("KE", "NG") + SOUTH_ASIA,
              # Nigeria's medicines come mostly from India and China and its own makers; Ghana shares its West African market
              "NG": ("GH", "KE", "TZ") + SOUTH_ASIA}
CURRENCY = {"KZ": "KZT", "KG": "KGS", "UZ": "UZS", "KE": "KES", "TZ": "TZS", "PK": "PKR", "GB": "GBP", "FR": "EUR",
            "NG": "NGN", "GH": "GHS", "ZA": "ZAR", "BY": "BYN", "AM": "AMD", "AZ": "AZN", "IN": "INR", "BD": "BDT"}
ABROAD = ("PK", "GB", "FR")    # far reference countries: last, only for molecules nothing nearer prices, Pakistan first
OTHERS = NEARBY["africa"] + NEARBY["cis"] + ABROAD + ("IN", "BD")
RANK = {"survey": 0, "retail": 0, "cap": 1, "reimbursement": 2, "tender": 3}
MIN_OVERLAP = 15          # molecules priced in both markets before their price ratio is trusted; otherwise 1.0

INJ = re.compile(r"injectable|perfusion|инъек|инфуз|ампул|амп\.|\bфл\.|д/ин|в/в|в/м|флак.*(инъ|инф)|лиофил|inject|infusion|ampoule|\bamps?\b|\bvials?\b|\binj\b|i\.v\.", re.I)
SOLID = re.compile(r"comprim|gélule|табл|таб\.|капс|драже|супп|свеч|пастил|саше|пакет|гранул.*пакет|tablet|\btabs?\b|capsul|\bcaps?\b|sachet|"
                   r"supposit|pessar|lozeng|\bsupp\b|\b\d+\s*'?s\b|\d\s*mg\s*x\s*\d", re.I)
STRENGTH = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mg|mq|мг|mcg|мкг|µg|gm|g|г|ml|мл|iu|ме|ед|%)(?![a-zа-я])", re.I)
UNIT_EN = {"мг": "mg", "mq": "mg", "мкг": "mcg", "µg": "mcg", "г": "g", "gm": "g", "мл": "ml", "ме": "IU", "ед": "IU", "iu": "IU"}


VOLUME = re.compile(r"(?<![/\d.,])(\d+(?:[.,]\d+)?)\s*(ml|mls|mils?|мл|g|gm|gms|г|гр)(?![a-zа-я/])", re.I)   # '100mils' (Tanzania)


def volume_of(text):
    """The bottle or tube size: '5мл', '100 ml', '30 g'; not the '5 ml' of '250 mg/5 ml'. (amount, 'ml' or 'g')"""
    hits = [(float(v.replace(",", ".")), "ml" if u.lower() in ("ml", "mls", "mil", "mils", "мл") else "g") for v, u in VOLUME.findall(text or "")]
    hits = [h for h in hits if h[0] > 0]
    return hits[-1] if hits else None


# MedEx's box note after the price of one bottle or strip ('15 ml drop: ৳ 20.00 (12's pack: ৳ 240.00)'): says nothing
# about what the price buys, and its '12's' is no count of tablets
BOX = re.compile(r"\([^()]*:\s*৳\s*[\d.,]+\)")
COUNTED = re.compile(r"№\s*\d|\b\d+\s*'?s\b|\bx\s*\d+", re.I)
NOT_COUNTED = re.compile(r"\d\s*(?:ml|мл|л)\b|крем|мазь|гел|сироп|капл|спрей|аэроз|сусп|раствор д/нар|cream|ointment|gel\b|syrup|"
                         r"drops|spray|suspension|lotion|shampoo|шампун|лосьон|паст", re.I)


# product types whose prices move together, for price gaps between countries: eye drops are compared with eye drops
FORM_TYPES = (("injection", None), ("eye", r"\beye|ophth|occul|ocul|глаз"), ("nasal", r"nasal|\bnose|назал|нос"),
              ("inhaled", r"inhal|nebul|aerosol|ингал|аэроз"), ("topical", r"cream|ointment|\bgel\b|lotion|крем|мазь|гель|линимент"),
              ("oral liquid", r"syrup|suspension|elixir|oral (?:solution|drops)|сироп|сусп"))
MIN_TYPE = 10             # medicines of one type priced in both countries before their price gap is measured from data
SANE = 8                  # a price this many times off the expected level (after each country's level) is a data error
BY_PRODUCT = True         # a market's price: each product (brand) one voice, at its median across shops; see product_key


def form_type(unit, text):
    """tablet, injection, eye, nasal, inhaled, topical, oral liquid or other."""
    if unit == "tablet or capsule":
        return "tablet"
    if unit == "ampoule or vial":
        return "injection"
    t = text or ""
    return next((k for k, rx in FORM_TYPES if rx and re.search(rx, t, re.I)), "other")


INHALER = re.compile(r"inhaler|evohaler|accuhaler|turbuhaler|diskus|rotacap|aerosol for inhal|inhalation aerosol|metered.dose|"
                     r"\bmdi\b|\bpuffs?\b|\b\d+\s*doses\b|аэрозоль для ингал|ингалятор|доз\b", re.I)


def unit_of(text):
    """What one unit is: a tablet or capsule, an ampoule or vial, an inhaler, else a pack of unknown size (a last resort:
    'Mesalazine 1g' could hold 10 tablets or 100)."""
    t = text or ""
    inhaler = INHALER.search(t) and not re.search(r"nasal|\bnose|назал|в нос|nazal", t, re.I)    # a nasal spray counts doses too
    return ("ampoule or vial" if INJ.search(t) else "inhaler" if inhaler else "tablet or capsule" if SOLID.search(t) else "pack")


def units_in(text):
    """How many units a pack holds, from its description; None when a counted pack does not say."""
    t = (text or "").lower().replace("х", "x").replace("×", "x").replace("’", "'")
    m = re.search(r"№\s*(\d+)(?:\s*x\s*(\d+))?", t)
    if m:
        return int(m.group(1)) * int(m.group(2) or 1)
    po = re.findall(r"по\s*(\d+)\s*(?:шт|амп|фл|пак)", t)                # 'по 10 шт ... по 3 шт' = 30
    if po:
        n = 1
        for x in po:
            n *= int(x)
        return n
    if re.search(r"\b(?:1\s+)?single\s+(?:tablet|capsule|caplet|pessary|vial|ampoule|sachet)", t):
        return 1                                                                         # '1 Single Tablet'
    m = (re.search(r"(\d+)\s*x\s*(\d+)\s*(?:tab|cap|amp|vial|sachet|supp|блист|'?s\b)", t)     # 2 x 10 tabs, 10x10's
         or re.search(r"(?:pack|box|strip|bottle) of\s*(\d+)()", t)
         or (re.search(r"\b(\d+)()\s*[',]?s\b", t) if re.search(r"\d\s*(?:tablets?|capsules?|caplets?)\b", t) else None)
         or re.search(r"(?<![\w/-])(\d+)()\s*(?:tablets?|tabs?|capsules?|caps?|sachets?|ampoules?|amps?|vials?|suppositories|"
                      r"pessaries|lozenges)\b", t)                                     # not 'Benza-200 Tablets'
         or re.search(r"\b(\d+)()\s*[',]?s\b", t)
         or re.search(r"(?:tablets?|tabs|capsules?|caps)(\d+)()\s*'?s\b", t)                       # 'tablets10s'
         or re.search(r"(?:^|\s)x\s*(\d+)()\b(?!\s*(?:ml|g)\b)", t))                    # '5mg x28', 'x100'
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


# an ampoule written as its concentration and volume ('40 mg/ml 2 ml'): its dose is the two multiplied (80 mg).
# '4 мг/2 мл' already names the dose
CONC = re.compile(r"(\d+(?:[.,]\d+)?)\s*(mg|мг|mcg|мкг|µg|iu|ме|ед)\s*/\s*(?:1\s*)?(?:ml|мл)(?![a-zа-я])", re.I)
AMP_VOL = re.compile(r"(?<![/\d.,])(?<!/\s)(\d+(?:[.,]\d+)?)\s*(?:ml|мл)(?![a-zа-я])", re.I)


def dose_of(text):
    """An ampoule's or vial's strength: its dose when the label gives a concentration and a volume, else as written."""
    t = text or ""
    c, v = CONC.search(t), AMP_VOL.search(CONC.sub(" ", t))
    if c and v and float(v.group(1).replace(",", ".")) > 0:
        n, u = float(c.group(1).replace(",", ".")) * float(v.group(1).replace(",", ".")), c.group(2).lower()
        return f"{round(n, 4):g} {UNIT_EN.get(u, u)}"
    return strength_of(t)


DOWN = set()         # sites that stopped answering during this run (collect.run reports them)
_FAILS = {}
DOWN_AFTER = 3       # pages in a row that do not load before a site counts as down for the rest of the run


def fresh_run():
    DOWN.clear()
    _FAILS.clear()


def page(s, url, **kw):
    """One page of a site read page by page. A page that does not load is None and is read again next run, so one slow
    page never throws away the rest of the run; after a few in a row the site is down and no longer asked this run."""
    import requests
    from urllib.parse import urlsplit
    host = urlsplit(url).netloc
    if host in DOWN:
        return None
    try:
        r = s.get(url, **kw)
    except requests.RequestException:
        _FAILS[host] = _FAILS.get(host, 0) + 1
        if _FAILS[host] >= DOWN_AFTER:
            DOWN.add(host)
        log.warning("no answer from %s", url)
        return None
    _FAILS[host] = 0
    return r


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
    """(country, molecule, kind, text, units, pack price, currency, brand) from every source. brand: True for an originator
    or international brand, False for a generic, None when the source does not say (worked out in rebuild)."""
    rows = cur.execute("""select country, molecule_id, kind, coalesce(pack, name), units, pack_price, currency, originator
                          from price_listings where molecule_id is not null and pack_price > 0""").fetchall()
    for c, m, text, price, ccy in cur.execute("""select country, molecule_id, coalesce(pack, name), max_retail, currency
                                                  from reference_prices where molecule_id is not null and max_retail > 0"""):
        rows.append((c, m, "cap", text, units_in(text), price, ccy, None))
    for c, m, title, price, ccy in cur.execute("""select country, molecule_ids[1], coalesce(title_en, title), unit_price, currency
                                                   from tenders where cardinality(molecule_ids) = 1 and unit_price > 0
                                                   and coalesce(awarded, closing, published) > current_date - 730"""):
        rows.append((c, m, "tender", title, 1, price, ccy, False))        # tenders buy generics
    return rows


def pct(xs, q):
    """The q-th percentile of sorted values (nearest rank)."""
    return xs[min(len(xs) - 1, max(0, round(q * (len(xs) - 1))))]


def originator_gap(cur, fam):
    """How a generic's price compares with the originator's for the same medicine, form and strength, on lists that say
    which is which (South Africa's). Returns (median ratio, molecules measured), or (1.0, n) when too few."""
    by = {}
    for m, text, units, price, orig in cur.execute("""select molecule_id, coalesce(pack, name), units, pack_price, originator
                                                      from price_listings where originator is not null and molecule_id is not null"""):
        u = units if units is not None else units_in(text)
        if u:
            by.setdefault((fam.get(m, m), unit_of(text), strength_of(text)), {}).setdefault(orig, []).append(float(price) / float(u))
    ratios = [statistics.median(v[False]) / statistics.median(v[True]) for v in by.values() if True in v and False in v]
    return (statistics.median(ratios) if len(ratios) >= MIN_OVERLAP else 1.0), len(ratios)


def sanity(obs):
    """Checks every price against the same medicine, form and strength elsewhere, after allowing for each country's usual
    price level. A pharmacy price far too low for a pack is read as the price of one tablet (some shops list per tablet);
    a price still more than 8 times off is dropped as a data error. obs: dicts with c, m, unit, strength, units, price,
    usd_rate (units of the listing's currency per USD) and kind. Returns the kept dicts with a 'usd' per unit."""
    import math
    for o in obs:
        o["usd"] = o["price"] / o["units"] / o["usd_rate"]
    group = {}
    for o in obs:
        group.setdefault((o["m"], o["unit"], o["strength"]), {}).setdefault(o["c"], []).append(o["usd"])
    med = {k: {c: statistics.median(v) for c, v in by_c.items()} for k, by_c in group.items()}

    def ref(k, c):
        """The median of the other countries' prices for this medicine, or None when fewer than two others price it."""
        others = [v for cc, v in med[k].items() if cc != c]
        return statistics.median(others) if len(others) >= 2 else None

    level = {}                                                     # each country's usual price level against the others
    for k, by_c in med.items():
        for c, v in by_c.items():
            r = ref(k, c)
            if r:
                level.setdefault(c, []).append(v / r)
    level = {c: statistics.median(v) for c, v in level.items() if len(v) >= 10}
    kept = []
    for o in obs:
        k = (o["m"], o["unit"], o["strength"])
        r = ref(k, o["c"])
        if r is None:
            kept.append(o)
            continue
        expect = r * level.get(o["c"], 1.0)
        # the shop lists the price of one tablet under a pack label: only when the pack reading is far off and the
        # one-tablet reading lands near the expected price (a cheap generic 100-pack is often genuinely cheap)
        if o["kind"] == "retail" and o["unit"] in ("tablet or capsule", "ampoule or vial") and o["units"] > 1 and o["usd"] < expect / SANE:
            per_tablet = o["price"] / o["usd_rate"]
            if expect / 3 <= per_tablet <= expect * 3:
                o["units"], o["usd"] = 1, per_tablet
        if 1 / SANE <= o["usd"] / expect <= SANE:
            kept.append(o)
    return kept


def product_key(text, inn_words, ref):
    """Which product a listing is, so one brand stocked by many shops counts once: its brand word ('Rocephin 1g'
    -> 'rocephin', 'Rocephine' alike). A listing named by its ingredient ('Ciprofloxacin 500mg', 'Амоксициллин') may
    be any maker's: its own product, unless it names a brand further on (see brands_in_text in rebuild)."""
    w = re.match(r"[a-zа-яё][a-zа-яё\-]{2,}", (text or "").strip().lower())
    if not w:
        return f"#{ref}"
    word = w.group(0)
    # an ingredient in any grammatical form ('цефтриаксона' is цефтриаксон): its first 5 or more letters name one
    if any(word[:k] in inn_words for k in range(5, len(word) + 1)):
        return f"#{ref}"
    return re.sub(r"(?<=\w{4})[es]$", "", word)


def rebuild(cur):
    fx = dict(cur.execute("select currency, per_usd from fx_rates").fetchall())
    sources = tuple(c for c in MARKETS + OTHERS if CURRENCY[c] in fx)       # a country without an exchange rate sits out
    fam, members = {}, {}                      # every spelling of a molecule shares its prices
    for mid, inn in cur.execute("select id, inn from molecules where inn is not null"):
        k = family(inn)
        if k:
            fam[mid] = k
            members.setdefault(k, []).append(mid)
    raw = []
    obs_all = observations(cur)
    # brand names known from makers (a multinational's product anywhere): the same name in a shop without a maker is a brand
    inn_words = {w for (inn,) in cur.execute("select inn from molecules where inn is not null") for w in re.findall(r"[a-z]{4,}", inn.lower())}
    from country_load import load_ru
    inn_words |= {w for ru in load_ru() for w in re.findall(r"[а-яё]{4,}", ru)}
    brand_words = {w.group(0) for (*_, text, _u, _p, _c, b) in obs_all if b and (w := re.match(r"[a-z][a-z\-]{3,}", (text or "").lower()))
                   and w.group(0) not in inn_words}
    for c, m, kind, text, units, price, ccy, brand in obs_all:
        if c not in sources or ccy not in fx:
            continue
        text = BOX.sub(" ", text or "")
        units = units if units is not None else units_in(text)
        if not units:
            continue                                  # a counted pack that does not say how many: no unit price
        unit, volume = unit_of(text), None
        if unit == "pack" and (vol := volume_of(text)):
            unit, volume, units = vol[1], vol[0], float(units) * vol[0]    # drops, syrups, creams: per ml or g
        if brand is None:
            w = re.match(r"[a-z][a-z\-]{3,}", (text or "").lower())
            brand = bool(w and w.group(0) in brand_words)
        # a bottle's or tube's size is not its strength ('5 ml' of 0.09% drops, a '20g' tube of cream)
        st = strength_of(VOLUME.sub(" ", text or "")) if unit in ("ml", "g") else dose_of(text) if unit == "ampoule or vial" \
            else strength_of(text)
        if unit in ("ml", "g") and st and re.fullmatch(r"[\d.]+ (ml|g)", st):
            st = None
        raw.append(dict(c=c, m=fam.get(m, m), kind=kind, unit=unit, strength=st, units=float(units), brand=brand, text=text,
                        product=product_key(text, inn_words, len(raw)),
                        price=float(price), usd_rate=float(fx[ccy]), volume=volume, countable=bool(COUNTED.search(text or "")
                                                                                             and not NOT_COUNTED.search(text or ""))))
    # 'ЦЕФТРИАКСОН 1г №1' names no form: a counted item takes the form the medicine usually comes in (a vial here)
    forms = {}
    for o in raw:
        if o["unit"] != "pack":
            f = forms.setdefault(o["m"], {})
            f[o["unit"]] = f.get(o["unit"], 0) + 1
    for o in raw:
        if o["unit"] == "pack" and o["countable"] and o["m"] in forms:
            o["unit"] = max(forms[o["m"]], key=forms[o["m"]].get)
    # an ingredient-named listing that names a brand further on ('Ceftriaxone 1g (Rocephin)') is that brand's
    brands = {}
    for o in raw:
        if not o["product"].startswith("#"):
            brands.setdefault(o["m"], set()).add(o["product"])
    for o in raw:
        if o["product"].startswith("#") and o["m"] in brands:
            words = {re.sub(r"(?<=\w{4})[es]$", "", w) for w in re.findall(r"[a-zа-яё][a-zа-яё\-]{3,}", (o["text"] or "").lower())}
            hit = sorted(words & brands[o["m"]])
            if hit:
                o["product"] = hit[0]
    groups, kept = {}, sanity(raw)
    for o in kept:
        local = float(fx[CURRENCY[o["c"]]])               # into the market's own currency
        groups.setdefault((o["c"], o["m"]), []).append((RANK[o["kind"]], o["kind"], o["unit"], o["strength"],
                                                         o["usd"] * o["usd_rate"], o["price"], o["usd_rate"] / local, o.get("volume"),
                                                         form_type(o["unit"], o["text"]), o["product"]))
    # every market's headline is the molecule's usual form and strength across all countries (paracetamol 500 mg tablet),
    # so markets compare like for like; tablets count double when choosing it
    usual_form = {}
    for (c, m), obs in groups.items():
        for o in obs:
            if o[3]:
                k = usual_form.setdefault(m, {})
                k[(o[2], o[3])] = k.get((o[2], o[3]), 0) + (2 if o[2] == "tablet or capsule" else 1)
    # a pack of unknown size says nothing per unit: it is the usual form only when nothing else prices the molecule
    # ties go the same way every run (by the form and strength itself), so the same data always gives the same prices
    usual_form = {m: max(v, key=lambda k: (k[0] != "pack", v[k], str(k))) for m, v in usual_form.items()}
    out, weak = {}, {}
    for (c, m), obs in groups.items():
        if any(o[2] != "pack" for o in obs):
            obs = [o for o in obs if o[2] != "pack"]                   # packs of unknown size only when nothing else is known
        best = min(o[0] for o in obs)
        obs = [o for o in obs if o[0] == best]                         # the best kind of evidence this market has
        sizes = {}
        for o in obs:
            sizes[(o[2], o[3])] = sizes.get((o[2], o[3]), 0) + 1
        want = usual_form.get(m)
        if want and want not in sizes and want[0] in ("ml", "g") and (want[0], None) in sizes:
            unit, usual = want[0], None  # the same bottle or tube, sold without stating its strength
        elif want and want not in sizes and (want[0] == "tablet or capsule" or not any(k[1] for k in sizes)):
            continue                     # this market only prices another form (an infusion, a gel): estimate the usual one
        else:
            unit, usual = want if want in sizes else max(sizes, key=lambda k: (sizes[k] * (2 if k[0] == "tablet or capsule" else 1),
                                                                               k[1] is not None, str(k)))
        # in our own markets, one or two listings without a strength (or one shop listing) are not enough to call it market
        # data; a country we only borrow from keeps every price as evidence for the estimate
        if c in MARKETS and usual is None and sizes[(unit, usual)] < 3:
            if unit in ("ml", "g") and all(o[1] == "retail" for o in obs if (o[2], o[3]) == (unit, usual)):
                # a bottle or tube on this market's own shelf ('Unibrom Eye Drops 5ml'): one voice in its estimate
                mine = [o for o in obs if (o[2], o[3]) == (unit, usual)]
                weak[(c, m)] = (unit, usual, statistics.median(o[4] / o[6] for o in mine) / float(fx[CURRENCY[c]]), mine[0][8])
            continue
        if c in MARKETS and sizes[(unit, usual)] == 1 and all(o[1] == "retail" for o in obs if (o[2], o[3]) == (unit, usual)):
            o = next(o for o in obs if (o[2], o[3]) == (unit, usual))
            weak[(c, m)] = (unit, usual, o[4] / o[6] / float(fx[CURRENCY[c]]), o[8])
            continue                     # a single shop listing (often one brand) is weaker than the blended estimate:
                                         # it counts as one voice in this market's estimate below
        strengths = {}
        for o in obs:
            if o[2] == unit and o[3]:
                strengths.setdefault(o[3], []).append((o[4] / o[6], o[5] / o[6]))
        by = sorted(({"strength": k, "unit": round(sum(u for u, _ in v) / len(v), 4), "pack": round(sum(p for _, p in v) / len(v), 2),
                      "n": len(v)} for k, v in strengths.items()), key=lambda x: -x["n"])[:6]
        mine = [o for o in obs if (o[2], o[3]) == (unit, usual)]
        if BY_PRODUCT:      # one voice per product: a brand every shop stocks (often the originator) cannot pull the price
            per = {}
            for o in mine:
                per.setdefault(o[9], []).append(o[4] / o[6])
            local = sorted(statistics.median(v) for v in per.values())
        else:
            local = sorted(o[4] / o[6] for o in mine)     # in the market's own currency
        avg = statistics.median(local)               # one premium brand or promotion cannot pull it
        vols = [o[7] for o in obs if (o[2], o[3]) == (unit, usual) and o[7]]
        types = [o[8] for o in obs if (o[2], o[3]) == (unit, usual)]
        out[(c, m)] = dict(basis="listings", kinds=sorted({o[1] for o in obs}), unit=unit, strength=usual, unit_price=avg,
                           unit_usd=avg / float(fx[CURRENCY[c]]), lo=pct(local, 0.1), hi=pct(local, 0.9), n=len(mine), by=by,
                           products=len(local),
                           pack_size=statistics.median_low(vols) if vols else None, ftype=max(sorted(set(types), key=str), key=types.count))
    # where a market only publishes official maximums, the shelf price is the maximum times how shelf prices compare with
    # maximums where both are known (measured on our data)
    both = []
    for (c, m), obs in groups.items():
        by = {}
        for o in obs:
            if o[1] in ("retail", "cap"):
                by.setdefault((o[2], o[3]), {}).setdefault(o[1], []).append(o[4] / o[6])
        both += [statistics.median(v["retail"]) / statistics.median(v["cap"]) for v in by.values() if "retail" in v and "cap" in v]
    shelf_vs_max = statistics.median(both) if len(both) >= MIN_OVERLAP else 1.0
    for v in out.values():
        if v["kinds"] == ["cap"]:
            for f in ("unit_price", "unit_usd", "lo", "hi"):
                v[f] *= shelf_vs_max
    generic_vs_originator, pairs = originator_gap(cur, fam)
    for key, value, n in (("shelf_vs_max", shelf_vs_max, len(both)), ("generic_vs_originator", generic_vs_originator, pairs)):
        cur.execute("""insert into price_factors (key, value, n) values (%s, %s, %s) on conflict (key)
                       do update set value = excluded.value, n = excluded.n, updated_at = now()""", (key, round(value, 4), n))
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
    # price gaps between a market and each country it borrows from, one per product type: the median ratio over at least
    # MIN_TYPE medicines of that type priced in both; else the ratio set for that pair and type, else for the pair; else 1.0
    markets = tuple(c for c in MARKETS if c in sources)
    measured = {}
    for c in markets:
        for n in NEIGHBOURS[c]:
            by_type = {}
            for (cc, m) in direct:
                a_, b_ = direct[(cc, m)], direct.get((n, m))
                if cc == c and b_ and b_["unit_usd"] > 0 and (a_["unit"], a_["strength"]) == (b_["unit"], b_["strength"]) \
                        and a_.get("ftype") == b_.get("ftype"):
                    by_type.setdefault(a_["ftype"], []).append(a_["unit_usd"] / b_["unit_usd"])
            for t, r in by_type.items():
                measured[(c, n, t)] = (statistics.median(r), len(r))
    set_gaps = {(c, n, t): float(r) for c, n, t, r in cur.execute("select country, source, form_type, ratio from price_gaps where basis = 'set'")}
    cur.execute("delete from price_gaps where basis = 'measured'")
    for (c, n, t), (r, k) in measured.items():
        cur.execute("insert into price_gaps (country, source, form_type, ratio, n, basis) values (%s, %s, %s, %s, %s, 'measured')",
                    (c, n, t, round(r, 4), k))

    def gap(c, n, t="all"):
        """(ratio, medicines behind it, how good): price in c over price in n for this product type."""
        r, k = measured.get((c, n, t), (None, 0))
        if r is not None and k >= MIN_TYPE:
            return r, k, 0
        if (c, n, t) in set_gaps:
            return set_gaps[(c, n, t)], k, 1
        if (c, n, "all") in set_gaps:
            return set_gaps[(c, n, "all")], k, 2
        return 1.0, k, 3

    # an estimate is the median of every country that prices the molecule, each scaled by its measured price gap with this
    # market, so no single source (or a source with one or two prices) decides it. Sources whose gap is measured, directly
    # or through a neighbour, and our neighbouring markets count; others only when nothing better exists.
    by_mol = {}
    for (n, m), v in direct.items():
        by_mol.setdefault(m, []).append((n, v))

    def estimate(c, m, own_shelf=True):
        """What market c's price for molecule m would be from its neighbours (and its own few shelf prices), or None.
        own_shelf=False leaves this market's own prices out: what we would say if we knew nothing here (the backtest)."""
        rate = float(fx[CURRENCY[c]])
        priced = by_mol.get(m, [])
        cands = []
        for n, v in priced:
            if n not in NEIGHBOURS[c]:                       # only neighbouring markets price alike: no Central Asia for East Africa
                continue
            factor, overlap, tier = gap(c, n, v.get("ftype", "all"))
            cands.append((tier <= 3, v["strength"], v["unit"], v["unit_usd"] * factor, v["lo"] / float(fx[CURRENCY[n]]) * factor,
                          v["hi"] / float(fx[CURRENCY[n]]) * factor, v["n"], n, v["kinds"], factor, overlap, v.get("pack_size"),
                          v.get("ftype")))
        for n in NEIGHBOURS[c]:                              # a neighbour's own single shelf price is a voice too
            if (n, m) in weak and (n, m) not in direct:
                u_, st_, usd_, t_ = weak[(n, m)]
                f_ = gap(c, n, t_ or "all")[0]
                cands.append((True, st_, u_, usd_ * f_, usd_ * f_, usd_ * f_, 1, n, ["retail"], f_, 0, None, t_))
        own = []
        if own_shelf and (c, m) in weak:                     # this market's own shelf price: it counts double
            u_, st_, usd_, t_ = weak[(c, m)]
            own = [(True, st_, u_, usd_, usd_, usd_, 1, c, ["retail"], 1.0, 0, None, t_),
                   (True, st_, u_, usd_, usd_, usd_, 0, c, ["retail"], 1.0, 0, None, t_)]
        if not cands and not own:
            return None
        if any(x[0] for x in cands):
            cands = [x for x in cands if x[0]]
        # the form and strength compared: the one most sources price (this market's own voice does not choose it)
        usual = max({(x[2], x[1]) for x in cands or own}, key=lambda k: (sum(1 for x in cands or own if (x[2], x[1]) == k), k == usual_form.get(m), str(k)))
        # one form and strength, like for like; a bottle or tube that does not state its strength compares per ml or g
        like = lambda x: (x[2], x[1]) == usual or (x[2] == usual[0] and usual[0] in ("ml", "g") and None in (x[1], usual[1]))
        cands = [x for x in cands if like(x)] + [x for x in own if like(x)]
        usd = statistics.median(x[3] for x in cands)
        main = min(cands, key=lambda x: abs(x[3] - usd))
        return dict(basis="estimate", kinds=main[8], unit=usual[0], strength=usual[1], unit_price=usd * rate, unit_usd=usd,
                    lo=statistics.median(x[4] for x in cands) * rate, hi=statistics.median(x[5] for x in cands) * rate,
                    n=sum(x[6] for x in cands), by=[], from_country=main[7], factor=main[9], overlap=len(cands),
                    pack_size=statistics.median_low([x[11] for x in cands if x[11]] or [0]) or None,
                    ftype=main[12] or next((x[12] for x in cands if x[12]), None),
                    voices=len({x[7] for x in cands}), gap_tiers=sorted({gap(c, x[7], x[12] or "all")[2] for x in cands if x[7] != c}))

    for c in markets:
        for m in by_mol.keys() | {m for (cc, m) in weak if cc == c}:
            if (c, m) not in out and (e := estimate(c, m)):
                out[(c, m)] = e
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
                               from_country=None, factor=combo_factor, overlap=len(samples), ftype=out[(c, parts[0])].get("ftype"))
            added = True
        if added and mid not in members.setdefault(k, []):
            members[k].append(mid)

    # the other forms a medicine comes in (vitamin D3 drops beside its usual capsules), each priced the same way for the
    # products sold in that form: this market's own shelf (three or more prices decide; fewer count double), its
    # neighbours carried over by the price gap for that kind of product, the median of these
    by_unit = {}
    for (c, m), obs in groups.items():
        for o in obs:
            if o[0] == RANK["retail"]:
                by_unit.setdefault((m, o[2]), []).append((c, o))
    for (m, u), items in by_unit.items():
        named = [o[3] for _, o in items if o[3]]
        st_ = max(sorted(set(named)), key=named.count) if named else None
        per = {}
        for c, o in items:
            if st_ is None or o[3] == st_ or (o[3] is None and u in ("ml", "g")):
                per.setdefault(c, []).append((o[4] / o[6] / float(fx[CURRENCY[c]]), o[7], o[8]))
        for c in markets:
            if (c, m) not in out or out[(c, m)]["unit"] == u:
                continue
            own = [x[0] for x in per.get(c, [])]
            if len(own) >= 3:
                voices, basis = own, "listings"
            else:
                voices, basis = ([statistics.median(own)] * 2 if own else []), "estimate"
                for n in NEIGHBOURS[c]:
                    if n in per and n in sources:
                        t_ = next((x[2] for x in per[n] if x[2]), "all")
                        voices.append(statistics.median(x[0] for x in per[n]) * gap(c, n, t_)[0])
            if not voices:
                continue
            rate, usd = float(fx[CURRENCY[c]]), statistics.median(voices)
            sizes = [x[1] for k in (c, *NEIGHBOURS[c]) for x in per.get(k, []) if x[1]]
            out[(c, m)].setdefault("forms", {})[u] = dict(
                basis=basis, strength=st_, unit_price=round(usd * rate, 4), unit_usd=round(usd, 6),
                lo=round(min(voices) * rate, 4), hi=round(max(voices) * rate, 4), n=sum(len(per.get(k, [])) for k in (c, *NEIGHBOURS[c])),
                pack_size=statistics.median_low(sizes) if sizes else None)

    # a generic and a brand price for each medicine and market, for the form and strength shown: this market's own
    # listings, else its neighbours' (East Africa: each other, Nigeria and South Asia), scaled by the measured price gap;
    # a brand with no price anywhere near is the generic marked up by how brands compare with generics on our data
    split = {}
    for o in kept:
        split.setdefault((o["c"], o["m"], o["unit"], o["strength"]), {}).setdefault(o["brand"], []).append(o["usd"])
    for (c, m), v in out.items():
        if c not in markets:
            continue
        key = (m, v["unit"], v["strength"])
        mine = split.get((c,) + key, {})

        def near(brand):
            vals = []
            for n in NEIGHBOURS[c]:
                # same form and strength; a bottle or tube that does not state its strength still compares per ml or g
                got = split.get((n,) + key, {}).get(brand) or (split.get((n, m, v["unit"], None), {}).get(brand) if v["unit"] in ("ml", "g") else None)
                if n in sources and got:
                    vals.append(statistics.median(got) * gap(c, n, v.get("ftype", "all"))[0])
            return statistics.median(vals) if vals else None
        gen = statistics.median(mine[False]) if len(mine.get(False, [])) >= 2 else near(False)
        if gen is None and mine.get(False):
            gen = mine[False][0]
        brand = statistics.median(mine[True]) if mine.get(True) else near(True)
        if brand is None and gen is not None and generic_vs_originator < 1:
            brand = gen / generic_vs_originator
        rate = float(fx[CURRENCY[c]])
        if brand is None and gen is not None and v["basis"] == "listings" and v.get("hi") and v["hi"] / rate > gen * 1.2:
            brand = v["hi"] / rate                       # no maker on the shelf: the premium end of this market's own prices
        if gen is None and brand is not None and generic_vs_originator < 1:
            gen = brand * generic_vs_originator
        v["generic"] = gen * rate if gen else None
        v["brand"] = brand * rate if brand and (gen is None or brand >= gen) else None

    # checks: how close estimates come where the shelf price is known, and what looks wrong (Admin > Data)
    cur.execute("savepoint checks")
    try:
        import price_checks
        set_n = {(c, s, t): n for c, s, t, n in cur.execute("select country, source, form_type, n from price_gaps where basis = 'set'")}
        gap_used = {}
        for c in markets:
            for s in NEIGHBOURS[c]:
                for t in dict.fromkeys(["tablet", "injection", *(k for k, _ in FORM_TYPES), "all"]):
                    r, k, tier = gap(c, s, t)
                    if tier in (0, 1) or (tier == 2 and t == "all"):
                        gap_used[(c, s, t)] = (r, k if tier == 0 else set_n.get((c, s, t), 0), "measured" if tier == 0 else "set")
        n_checks = price_checks.run(cur, direct, out, estimate, gap_used, fx, markets, members) + price_checks.class_checks(cur)
        cur.execute("release savepoint checks")
        log.info("price checks: %s", n_checks)
    except Exception:
        cur.execute("rollback to savepoint checks")
        log.exception("price checks failed")

    import json
    cur.execute("delete from molecule_prices")
    with cur.copy("""copy molecule_prices (country, molecule_id, basis, kinds, currency, unit, strength, unit_price, unit_usd, lo, hi, n,
                     from_country, factor, overlap, by_strength, pack_size, generic_price, brand_price, forms) from stdin""") as cp:
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
                              json.dumps(v["by"], ensure_ascii=False), v.get("pack_size"),
                              round(v["generic"], 4) if v.get("generic") else None, round(v["brand"], 4) if v.get("brand") else None,
                              json.dumps(v["forms"]) if v.get("forms") else None))
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


ITEM_SOURCES = {"KZ": ("prices_KZ", "prices_KZ_ep"), "TZ": ("prices_TZ",), "KE": ("prices_KE_shop",), "INTL": ("prices_INTL_pk", "prices_INTL_by"),
                "SASIA": ("prices_BD", "prices_IN", "prices_PK_shop"), "NG": ("prices_NG",)}


SASIA_MORE = False        # South Asia: more pages worth reading than one run reads (its lists hold every generic)


def catching_up(cur, country):
    """True while a source read one record at a time has records it has never read: it then runs again straight away."""
    if country == "SASIA":
        return SASIA_MORE
    return bool(cur.execute("""select 1 from source_items where source = any(%s) and ref <> '*list' and checked_at is null
                               limit 1""", (list(ITEM_SOURCES.get(country, ())),)).fetchone())


def checked(cur, source, ref, state=None):
    cur.execute("update source_items set checked_at = now(), state = coalesce(%s, state) where source = %s and ref = %s",
                (state, source, ref))


def save_listing(cur, country, source, kind, ref, name, pack, molecule, units, price, currency, originator=None, description=None):
    cur.execute("""insert into price_listings (country, source, kind, ref, name, pack, molecule_id, units, pack_price, currency, originator,
                                               description)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (source, ref) do update set name = excluded.name, pack = excluded.pack, molecule_id = excluded.molecule_id,
                   units = excluded.units, pack_price = excluded.pack_price, currency = excluded.currency,
                   originator = excluded.originator, description = coalesce(excluded.description, price_listings.description),
                   seen = current_date""",
                (country, source, kind, str(ref)[:200], (name or "")[:300], (pack or "")[:300], molecule, units, price, currency, originator,
                 (description or "")[:600] or None))


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
        r = page(s, url, timeout=60)
        if r is None:
            continue
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


# Kenya: the procurement regulator's quarterly market price survey (national average of five towns). A pharmacy chain's
# feed was tried and left out: its prices mix per tablet, per strip and per box with nothing to tell them apart.
PPRA = "https://ppra.go.ke/market-price-index/"
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
                save_listing(cur, "KE", "ppra", "survey", f"{item}|{unit}|{qty:g}", item, f"{item} · {qty:g} {unit}",
                             names.find(item), qty if counted else 1, avg, "KES")
                n += 1
            cur.execute("""insert into source_items (source, ref, checked_at, state) values ('prices_KE', 'ppra', now(), %s)
                           on conflict (source, ref) do update set checked_at = now(), state = excluded.state""", (url,))
    return n + mydawa(cur, s, names)


# Kenya: an online pharmacy's product pages (schema.org prices; robots.txt allows product pages), every product kept
MYDAWA = "https://mydawa.com"


def portfolio_first(cur):
    """Sort key for shop pages: manufacturers' own products, their ingredients and named competitors, and device groups first."""
    from devices import GROUPS
    words = {w for (w,) in cur.execute("""select distinct lower(brand) from mfr_competitors
                                          union select distinct lower(split_part(m.inn, ' ', 1)) from mfr_products p join molecules m on m.id = p.molecule_id
                                          union select distinct lower(split_part(regexp_replace(p.name, '[^A-Za-z ]', ' ', 'g'), ' ', 1))
                                          from mfr_products p""").fetchall() if w and len(w) >= 4}
    keys = [re.sub(r"[^a-z0-9]+", "-", w).strip("-") for w in words]
    return lambda u: not (any(k and k in u.lower() for k in keys) or any(re.search(rx, u.replace("-", " ")) for _, rx in GROUPS))


def mydawa(cur, s, names):
    import time

    def urls():
        xml = s.get(f"{MYDAWA}/sitemap-products.xml", timeout=120).text
        return [u for u in re.findall(r"<loc>([^<]+)</loc>", xml) if u.count("/") >= 4]

    due = due_items(cur, "prices_KE_shop", 100000, urls)      # all due pages; the portfolio first, below
    seen = set(due)
    due += [r for (r,) in cur.execute("""select ref from source_items where source = 'prices_KE_shop' and ref <> '*list'
                                         and checked_at is null""").fetchall() if r not in seen]
    first = portfolio_first(cur)
    n = 0
    for url in sorted(due, key=first)[:TZ_PER_RUN]:
        r = page(s, url, timeout=60)
        if r is None:
            continue
        for x in ld_products(r.text if r.ok else ""):
            offer = x.get("offers") or {}
            price = num(offer.get("price")) if isinstance(offer, dict) else None
            if price:
                mol = names.find(x.get("name") or "", x.get("description") or "")
                save_listing(cur, "KE", "mydawa", "retail", url, x.get("name"), x.get("name"), mol, None, price,
                             offer.get("priceCurrency") or "KES", description=x.get("description"))
                n += 1
        checked(cur, "prices_KE_shop", url)
        time.sleep(1)
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
    # every page due, manufacturers' products and their competitors first
    for url in sorted(due_items(cur, "prices_TZ", 100000, urls), key=portfolio_first(cur))[:TZ_PER_RUN]:
        r = page(s, url, timeout=60)
        if r is None:
            continue
        for x in ld_products(r.text if r.ok else ""):
            offer = x.get("offers") or {}
            price = num(offer.get("price")) if isinstance(offer, dict) else None
            mol = names.find(x.get("name") or "", x.get("description") or "") if price else None
            if price:      # kept even without a matched medicine: devices and brands are looked up by name
                save_listing(cur, "TZ", "afyadepo", "retail", url, x.get("name"), x.get("name"), mol, None, price,
                             offer.get("priceCurrency") or "TZS", description=x.get("description"))
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
    """An English or French INN in a product name, or None. A combination ('A + B') never counts as one of its parts."""
    m = names.find(text) if names.inn.find(text) else generics.molecule(cur, text)
    return None if m and "+" in (text or "") and "+" not in names.fam.get(m, "+") else m


RCETH = "https://www.rceth.by/Refbank/reestr_drugregpricenew/results"
RCETH_LETTERS = "абвгдежзийклмнопрстуфхцчшэюя"


def rceth_search(s, letter, page=1, qs=None):
    """One page of Belarus' maximum-price register for INNs containing a letter (the site's own search form)."""
    form = [("QueryStringFind", qs or ""), ("IsPostBack", "True" if page > 1 else ""), ("PropSubmit", "FOpt_PageN" if page > 1 else ""),
            ("ValueSubmit", str(page) if page > 1 else ""), ("VFiles", "")]
    for i, name in enumerate(["DrugTradeName", "mnn", "PackageName", "Manufacture", "Holder", "NREG"]):
        form += [(f"FProps[{i}].IsText", "True"), (f"FProps[{i}].Name", name), (f"FProps[{i}].CritElems[0].Num", "1"),
                 (f"FProps[{i}].CritElems[0].Val", letter if name == "mnn" else ""), (f"FProps[{i}].CritElems[0].Crit", "Like"),
                 (f"FProps[{i}].CritElems[0].Excl", "false")]
    for i, name in ((6, "DateResolutionMH"), (7, "ReestrDate")):
        form += [(f"FProps[{i}].IsDate", "True"), (f"FProps[{i}].Name", name), (f"FProps[{i}].CritElemsD.Val1", ""),
                 (f"FProps[{i}].CritElemsD.Crit", "Equal"), (f"FProps[{i}].CritElemsD.Val2", "")]
    return s.post(RCETH, data=form, timeout=180).text


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
    by_ru = Molecules(cur, "BY")
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

    # Belarus: the register of maximum selling prices, searched letter by letter (it has no full download)
    for letter in due_items(cur, "prices_INTL_by", 40, lambda: list(RCETH_LETTERS), every_days=30):
        page, last, qs = 1, 1, None
        while page <= last:
            html_ = rceth_search(s, letter, page, qs)
            qs = (re.search(r'name="QueryStringFind" type="hidden" value="([^"]*)"', html_) or [None, qs])[1]
            last = int((re.search(r"Страница\s*(?:&nbsp;)?\s*\d+\s*из\s*(\d+)", html_) or [0, 1])[1])
            for t in pd.read_html(io.StringIO(html_)):
                if "МНН" not in t.columns:
                    continue
                for _, x in t.iterrows():
                    price = num(str(x.get("Предельная отпускная цена") or "").replace("BYN", "").replace(",", ".").strip())
                    form, inn = str(x.get("Лекарственная форма") or ""), str(x.get("МНН") or "")
                    if price:
                        save_listing(cur, "BY", "rceth", "cap", f"{x.get('Номер регистрационного удостоверения')}|{form[:120]}",
                                     x.get("Торговое наименование"), f"{inn} {form}", by_ru.find(cur, None, inn), None, price, "BYN")
                        n += 1
            page += 1
            time.sleep(2)
        checked(cur, "prices_INTL_by", letter)

    # Pakistan: notified maximum retail prices of essential medicines, a page at a time
    def pages():
        out = []
        for cat in ("Essential Drugs", "Low Price Drugs"):
            first = s.get(DRAP, params={"category": cat, "page": 1}, timeout=60).text
            out += [f"{cat}|{p}" for p in range(1, max([int(x) for x in re.findall(r"page=(\d+)", first)] or [1]) + 1)]
        return out

    for p in due_items(cur, "prices_INTL_pk", DRAP_PER_RUN, pages, every_days=30):
        cat, page_no = p.split("|") if "|" in p else ("Essential Drugs", p)
        r = s.get(DRAP, params={"category": cat, "page": page_no}, timeout=60)
        for t in (pd.read_html(io.StringIO(r.text)) if r.ok and "<table" in r.text else []):
            if "Price" not in t.columns:
                continue
            for _, x in t.iterrows():
                name, price = str(x.get("Product Name") or ""), num(re.sub(r"[^\d.]", "", str(x.get("Price") or "")))
                mol = english_molecule(cur, names, generics, name) if price else None
                if mol:
                    save_listing(cur, "PK", "drap", "cap", str(x.get("Reg. Number")), name, f"{name} · {x.get('Pack Size')}",
                                 mol, None, price, "PKR", originator=is_brand(str(x.get("Manufacturer") or "")),
                                 description=str(x.get("Manufacturer") or "") or None)
                    n += 1
        checked(cur, "prices_INTL_pk", str(p))
        time.sleep(2)
    return n



# South Asia: where most generics sold in East Africa are made, and the generic price level East African prices follow.
# Bangladesh (MedEx: every brand of a generic, with company and price), India (1mg: a generic's brands, then each brand's
# packs) and Pakistan (dawaai: product pages with the generic, strength, form and maker). All three allow these pages in
# robots.txt. Listings carry the maker, so a multinational's brand counts as a brand and the rest as generics.
MEDEX = "https://medex.com.bd"
ONEMG = "https://www.1mg.com"
DAWAAI = "https://dawaai.pk"
SA_PER_RUN = 250          # pages a run per country, about one a second
# companies whose products are originator or international brands (their local arms too); everyone else sells generics
BRAND_MAKERS = re.compile(r"pfizer|novartis(?! *sandoz)|glaxo|\bgsk\b|sanofi|astra ?zeneca|\bmsd\b|merck sharp|bayer|roche|janssen|"
                          r"johnson|allergan|abbvie|alcon|bausch|santen|boehringer|eli lilly|novo ?nordisk|takeda|servier|astellas|"
                          r"bristol[- ]myers|organon|\bucb\b|ipsen|menarini|lundbeck|gr[uü]nenthal|wyeth|galderma|th[eé]a\b|ursapharm|"
                          r"reckitt|haleon|mundipharma|otsuka|daiichi|eisai", re.I)


def is_brand(maker):
    return bool(maker and BRAND_MAKERS.search(maker))


# the same ingredient under another name in another market's lists
WORD_SYNONYMS = {"adrenalin": "epinefrin", "noradrenalin": "norepinefrin", "lignokain": "lidokain", "frusemid": "furosemid",
                 "albuterol": "salbutamol", "acetaminofen": "parasetamol", "kgolekalsiferol": "kolekalsiferol", "glukoz": "dekstroz"}


# vitamins by their ingredient names, as our molecules are named ('Vitamin D3', 'vitamin-b12', 'Cholecalciferol [Vitamin D3]')
VITAMINS = [(r"\bvit(?:amin)?[\s-]*d3?\b", "cholecalciferol"), (r"\bvit(?:amin)?[\s-]*d2\b", "ergocalciferol"),
            (r"\bvit(?:amin)?[\s-]*b12\b", "cyanocobalamin"), (r"\bvit(?:amin)?[\s-]*b1\b", "thiamine"),
            (r"\bvit(?:amin)?[\s-]*b2\b", "riboflavin"), (r"\bvit(?:amin)?[\s-]*b6\b", "pyridoxine"),
            (r"\bvit(?:amin)?[\s-]*b9\b", "folic acid"), (r"\bvit(?:amin)?[\s-]*c\b", "ascorbic acid"),
            (r"\bvit(?:amin)?[\s-]*a\b", "retinol"), (r"\bvit(?:amin)?[\s-]*e\b", "tocopherol"),
            (r"\bvit(?:amin)?[\s-]*k1?\b", "phytomenadione")]


def ingredient_text(t):
    """A generic's name as ingredients: bracketed notes dropped, vitamins by their ingredient names."""
    t = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", (t or "").lower().replace("-", " "))
    for rx, name in VITAMINS:
        t = re.sub(rx, name, t)
    return t


def word_key(w):
    """One spelling of one ingredient word: 'Ksilometazolin' and 'xylometazoline', 'adrenaline' and 'epinephrine'."""
    k = family(w) or w
    return WORD_SYNONYMS.get(k, k)


def tracked_words(cur):
    """Words of the molecules worth pricing first: in a manufacturer's portfolio, or registered in our East African markets."""
    words, first = set(), set()
    for inn, mine in cur.execute("""select m.inn, bool_or(p.id is not null) from molecules m
                                    left join mfr_products p on p.molecule_id = m.id
                                    where p.id is not null or exists (select 1 from registrations r where r.molecule_id = m.id
                                      and r.country in ('KE', 'TZ', 'NG') and r.active)
                                    group by m.inn""").fetchall():
        w = {word_key(x) for x in re.findall(r"[a-z]{4,}", (inn or "").lower())}
        words |= w
        if mine:
            first |= w
    return words, first


def prices_SASIA(cur, s):
    import html as htmllib
    import json
    import time
    from catalogue import Generics
    names, generics, n = Names(cur, "KE"), Generics(cur), 0
    words, first = tracked_words(cur)
    salts = {word_key(x) for x in SALT_WORDS}
    parts = lambda t: {word_key(x) for x in re.findall(r"[a-z]{4,}", ingredient_text(t))} - salts
    useful = lambda t: bool(parts(t)) and parts(t) <= words           # every ingredient is one we track
    # portfolio first, single ingredients before combinations
    order = lambda ref: (0 if parts(ref.split("|")[-1]) <= first else 1, "+" in ref or ref.count("-") > 2)
    text = lambda h: htmllib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h))).strip()

    # Bangladesh: the generics index, then each generic's brand list (all brands on one page)
    def medex_list():
        out, page = [], 1
        while True:
            h = s.get(f"{MEDEX}/generics", params={"page": page}, timeout=60).text
            got = re.findall(r'href="https://medex\.com\.bd/generics/(\d+/[a-z0-9-]+)"[^>]*>.*?dcind-title">\s*([^<]+?)\s*<', h, re.S)
            out += [f"{g}|{t}" for g, t in got]            # every generic: which to read is chosen when reading
            if not got or page > 150:
                return out
            page += 1
            time.sleep(1)

    global SASIA_MORE
    SASIA_MORE = False
    due = [r for r in due_items(cur, "prices_BD", 100000, medex_list, every_days=30) if useful(r.split("|", 1)[-1])]
    SASIA_MORE |= len(due) > SA_PER_RUN
    for ref in sorted(due, key=order)[:SA_PER_RUN]:
        path, title = ref.split("|", 1)
        mol = english_molecule(cur, names, generics, ingredient_text(title).replace(" + ", "+").replace("+", " + "))
        if not mol:                                       # an ingredient we track, in a name we cannot match
            checked(cur, "prices_BD", ref)
            continue
        r = page(s, f"{MEDEX}/generics/{path}/brand-names", timeout=60)
        if r is None:
            continue
        for row in re.findall(r'<tr class="brand-row"(.*?)</tr>', r.text if r.ok else "", re.S):
            cells = [text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(cells) < 5:
                continue
            brand, form, strength, maker, price = cells[:5]
            for amount, label in [(m.group(2), m.group(1)) for m in re.finditer(r"([^:৳]+?):\s*৳\s*([\d,.]+)", price)]:
                label = label.strip()
                if label.startswith("("):                       # '(12's pack: ৳ 240.00)': the box the unit before it comes in
                    continue
                if label.lower().startswith("unit price"):        # a tablet, capsule or sachet: the price of one
                    save_listing(cur, "BD", "medex", "retail", f"{path}|{brand}|{strength}|unit", brand, f"{brand} {strength} {form} · 1 unit",
                                 mol, 1, num(amount.replace(",", "")), "BDT", originator=is_brand(maker), description=maker)
                    n += 1
                    break
                save_listing(cur, "BD", "medex", "retail", f"{path}|{brand}|{strength}|{label}", brand, f"{brand} {strength} {form} · {label}",
                             mol, 1, num(amount.replace(",", "")), "BDT", originator=is_brand(maker), description=maker)
                n += 1
        checked(cur, "prices_BD", ref)
        time.sleep(1)

    # India: a generic's page names its brands; each brand page lists its packs and prices
    def onemg_list():
        out = []
        for i in (1, 2, 3):
            xml = s.get(f"{ONEMG}/sitemap_generics_{i}.xml", timeout=120)
            out += [u.rsplit("/", 1)[1] for u in re.findall(r"<loc>([^<]+/generics/[^<]+)</loc>", xml.text if xml.ok else "")]
        return out

    due = [g for g in due_items(cur, "prices_IN", 100000, onemg_list, every_days=30) if useful(re.sub(r"-\d+$", "", g))]
    SASIA_MORE |= len(due) > SA_PER_RUN // 5
    for slug in sorted(due, key=order)[:SA_PER_RUN // 5]:
        r = page(s, f"{ONEMG}/generics/{slug}", timeout=60)
        if r is None:
            continue
        page_ = r.content.decode("utf-8", "ignore") if r.ok else ""         # 1mg does not declare its character set
        title = re.search(r"<h1[^>]*>(.*?)</h1>", page_, re.S)
        mol = english_molecule(cur, names, generics, ingredient_text(text(title.group(1)))) if title else None
        brands = re.findall(r'"name":"([^"]+)","manufacturer_name":"([^"]*)","price_range":\{[^}]*\},"variants_available":"[^"]*","slug":"(/brands/[^"]+)"',
                            page_ if mol else "")
        missed = False
        for brand, maker, bslug in list(dict.fromkeys(brands))[:8]:
            b = page(s, ONEMG + bslug, timeout=60)
            if b is None:
                missed = True
                continue
            # the page's data in either of the two shapes 1mg serves: {skuId, header, subText, ..., price: {mrp}} or {header, ..., price: '₹216', skuId, subText}
            bpage = b.content.decode("utf-8", "ignore") if b.ok else ""
            skus = {sku: (header, price, sub) for sku, header, sub, price in re.findall(
                r'"skuId":(\d+),"header":"([^"]+)","subText":"([^"]*)",[^\]]*?"price":\{"mrp":([\d.]+)', bpage)}
            for header, price, sku, sub in re.findall(r'"header":"([^"]+)",(?:"[a-zA-Z]+":"[^"]*",)*"price":"[^\d"]*([\d,.]+)","quantity":\d+,'
                                                      r'(?:"[a-zA-Z]+":\{[^{}]*\},)*"skuId":"(\d+)","subText":"([^"]*)"', bpage):
                skus.setdefault(sku, (header, price, sub))
            for sku, (header, price, sub) in skus.items():
                units = re.search(r"(?:strip|bottle|box|packet|pack|tube|vial)?\s*of\s*(\d+)\s*(?:tablet|capsule|ampoule|vial|sachet|lozenge)", sub, re.I)
                save_listing(cur, "IN", "1mg", "retail", sku, header, f"{header} · {sub}", mol, int(units.group(1)) if units else 1,
                             num(price.replace(",", "")), "INR", originator=is_brand(maker), description=maker)
                n += 1
            time.sleep(1)
        if missed:                 # a brand page did not load: the generic is read again next run
            continue
        checked(cur, "prices_IN", slug)
        time.sleep(1)

    # Pakistan: pharmacy product pages (schema.org Product and Drug: generic, strength, form, maker, price per pack)
    # the generic pages (one per generic, listing its brands) point to the products worth reading first
    gen_urls = set()

    def dawaai_list():
        out, sitemap = [], []
        for sm in ("sitemap.xml", "sitemap_second.xml", "sitemap_new.xml"):
            xml = s.get(f"{DAWAAI}/{sm}", timeout=120)
            sitemap += re.findall(r"<loc>(https://dawaai\.pk/(?:medicine|generic)/[a-z0-9-]+(?:-\d+\.html)?)</loc>", xml.text if xml.ok else "")
        for g in sorted({u for u in sitemap if "/generic/" in u and useful(u.rsplit("/", 1)[1])}):
            r = page(s, g, timeout=60)
            gen_urls.update(re.findall(r'href="(https://dawaai\.pk/medicine/[a-z0-9-]+-\d+\.html)"', r.text if r is not None and r.ok else ""))
            time.sleep(1)
        return sorted(gen_urls | {u for u in sitemap if "/medicine/" in u})

    due = due_items(cur, "prices_PK_shop", 100000, dawaai_list, every_days=30)
    for u in gen_urls:                                   # remembered between runs
        cur.execute("update source_items set state = 'generic' where source = 'prices_PK_shop' and ref = %s", (u,))
    tracked = {r for (r,) in cur.execute("select ref from source_items where source = 'prices_PK_shop' and state = 'generic'")}
    pf = portfolio_first(cur)
    SASIA_MORE |= len(due) > SA_PER_RUN
    for url in sorted(due, key=lambda u: (u not in tracked, pf(u)))[:SA_PER_RUN]:
        r = page(s, url, timeout=60)
        if r is None:
            continue
        blocks = []
        for b in re.findall(r"<script[^>]*ld\+json[^>]*>(.*?)</script>", r.text if r.ok else "", re.S):
            try:
                blocks.append(json.loads(htmllib.unescape(b)))
            except ValueError:
                pass
        prod = next((b for b in blocks if isinstance(b, dict) and b.get("@type") == "Product"), None)
        drug = next((b for b in blocks if isinstance(b, dict) and b.get("@type") == "Drug"), None)
        price = num((prod or {}).get("offers", {}).get("price")) if prod else None
        if price and drug and drug.get("nonProprietaryName"):
            # 'Latanoprost, Timolol' is a combination
            mol = english_molecule(cur, names, generics, re.sub(r"\s*(?:,|\band\b|&|/)\s*", " + ", drug["nonProprietaryName"]))
            if mol:
                desc = prod.get("description") or ""
                pack = re.search(r"Order (.+?) and avail", desc)
                label = pack.group(1) if pack else f"{prod.get('name')} {drug.get('drugUnit') or ''} {drug.get('dosageForm') or ''}"
                # dawaai sells '20x10's' by the strip: the price is for the 10, not the box of 200
                strip = re.search(r"(\d+)\s*x\s*(\d+)\s*'?s?\b", label, re.I)
                save_listing(cur, "PK", "dawaai", "retail", url, prod.get("name"), label, mol, int(strip.group(2)) if strip else None, price, "PKR",
                             originator=is_brand(drug.get("manufacturer")), description=drug.get("manufacturer"))
                n += 1
        checked(cur, "prices_PK_shop", url)
        time.sleep(1)
    return n


# Nigeria: pharmacy catalogues (NGN), read a page at a time; every product kept, matched to a medicine where we can.
# All allow these reads in robots.txt (Asset Pharmacy asks for 3 seconds between requests).
NG_WOO = {"bonamour": "https://www.bonamour.com.ng", "asset": "https://assetpharmacy.com", "mariamgrey": "https://mariamgrey.com"}
NG_SHOPIFY = {"healthplus": "https://healthplusnigeria.com", "precious": "https://precious-pharmacy.com"}
NG_DELAY = {"asset": 3}
NG_PER_RUN = 300                 # pages a run


def prices_NG(cur, s):
    import html as htmllib
    import time

    class Unread(Exception):
        """A catalogue page that did not load: read again next run."""

    def get(url, **kw):
        r = page(s, url, **kw)
        if r is None:
            raise Unread(url)
        return r

    def pages():
        out = []
        for k, base in NG_WOO.items():
            r = page(s, f"{base}/wp-json/wc/store/v1/products", params={"per_page": 100, "page": 1}, timeout=120)
            out += [f"{k}|{p}" for p in range(1, int(r.headers.get("X-WP-TotalPages") or 0) + 1)] if r is not None and r.ok else []
            time.sleep(NG_DELAY.get(k, 1))
        d = page(s, "https://api.drugstore.ng/get/drugs", params={"page": 1}, timeout=120)
        out += [f"drugstore|{p}" for p in range(1, (d.json()["data"]["drugs"].get("last_page") or 0) + 1)] if d is not None and d.ok else []
        for k in NG_SHOPIFY:
            out += [f"{k}|{p}" for p in range(1, 41)]             # Shopify: pages until one comes back empty
        h = page(s, "https://medplusnig.com/products", params={"data_from": "latest", "page": 1}, timeout=120)
        last = max([int(x) for x in re.findall(r"[?&](?:amp;)?page=(\d+)", h.text if h is not None and h.ok else "")] or [0])
        out += [f"medplus|{p}" for p in range(1, (last or 200) + 1)]      # no page links found: read until pages come back empty
        return out

    def items(ref):
        """(ref, name, price) for every product on one catalogue page."""
        src, p = ref.split("|")
        if src in NG_WOO:
            r = get(f"{NG_WOO[src]}/wp-json/wc/store/v1/products", params={"per_page": 100, "page": p}, timeout=120)
            for x in r.json() if r.ok else []:
                pr = x.get("prices") or {}
                if x.get("is_in_stock") is False:          # out of stock: its price is often months old
                    continue
                if pr.get("price"):
                    yield x.get("id"), x.get("name"), int(pr["price"]) / 10 ** int(pr.get("currency_minor_unit") or 0)
        elif src == "drugstore":
            r = get("https://api.drugstore.ng/get/drugs", params={"page": p}, timeout=120)
            for x in (r.json()["data"]["drugs"]["data"] if r.ok else []):
                yield x.get("id"), x.get("name"), num((x.get("price") or {}).get("digit"))
        elif src in NG_SHOPIFY:
            r = get(f"{NG_SHOPIFY[src]}/products.json", params={"limit": 250, "page": p}, timeout=120)
            for x in (r.json().get("products", []) if r.ok else []):
                for v in x.get("variants") or []:
                    if v.get("available") is False:          # out of stock: its price is often months old
                        continue
                    vt = v.get("title") or ""
                    title = x.get("title") + ("" if vt in ("", "Default Title") or vt.lower() in x.get("title", "").lower() else f" {vt}")
                    yield v.get("id"), title, num(v.get("price"))
        elif src == "medplus":
            r = get("https://medplusnig.com/products", params={"data_from": "latest", "page": p}, timeout=120)
            for slug, name, price in re.findall(r'<a href="https://medplusnig\.com/product/([^"]+)">\s*([^<]+?)\s*</a>.*?'
                                                 r'<span class="text-accent[^"]*">\s*₦([\d,.]+)', r.text if r.ok else "", re.S):
                # the card shortens long names; the slug has the whole one
                full = re.sub(r"-[a-z0-9]{6,}$", "", slug).replace("-", " ")
                yield slug, full if len(full) > len(name) else name, num(price.replace(",", ""))

    names, n = Names(cur, "NG"), 0
    for ref in due_items(cur, "prices_NG", NG_PER_RUN, pages):
        src = ref.split("|")[0]
        try:
            got = list(items(ref))
        except Unread:
            continue
        for key, name, price in got:
            name = htmllib.unescape(name or "").strip()
            if name and price:
                save_listing(cur, "NG", src, "retail", f"{src}|{key}", name, name, names.find(name), None, price, "NGN")
                n += 1
        checked(cur, "prices_NG", ref)
        time.sleep(NG_DELAY.get(src, 1))
    return n


# Nearby countries (second tier, beside our own markets): official lists and one pharmacy catalogue, read in bulk.
SA_MEDIA = "https://www.health.gov.za/wp-json/wp/v2/media"
GHANA = "https://www.nhis.gov.gh/medlist.aspx"
HEALTHPLUS = "https://healthplusnigeria.com/products.json"
AZ_TARIFF = "https://tariff.gov.az/derman-vasiteleri/qiymet"
NATALI = "https://natalipharm.am/ups/files/natali_price.xls"


def new_version(cur, ref, version):
    """True when a source published something we have not read yet (a new file name or date)."""
    got = cur.execute("select state from source_items where source = 'prices_NEAR' and ref = %s", (ref,)).fetchone()
    return bool(version) and (not got or got[0] != version)


def read_version(cur, ref, version):
    cur.execute("""insert into source_items (source, ref, checked_at, state) values ('prices_NEAR', %s, now(), %s)
                   on conflict (source, ref) do update set checked_at = now(), state = excluded.state""", (ref, version))


def prices_NEAR(cur, s):
    import io
    import pandas as pd
    from catalogue import Generics
    from urllib.parse import urljoin
    names, generics, n = Names(cur, "KE"), Generics(cur), 0
    ru = Molecules(cur, "AM")
    # South Africa: Single Exit Price database (regulated retail ceiling per pack, ZAR)
    files = s.get(SA_MEDIA, params={"search": "database of medicine prices", "per_page": 10, "_fields": "source_url,date"}, timeout=60).json()
    url = next((f["source_url"] for f in files if str(f.get("source_url", "")).endswith(".xlsx")), None)
    if new_version(cur, "za", url):
        rows = pd.read_excel(io.BytesIO(s.get(url, timeout=300).content), dtype=str).fillna("").values.tolist()
        for i, r in enumerate(rows):
            if not r[3]:
                continue                                  # a combination's extra ingredient, read with its product
            inn = [r[7]]
            for x in rows[i + 1:]:                    # a combination's other ingredients follow on rows without a code
                if x[3]:
                    break
                if x[7]:
                    inn.append(x[7])
            price, form = num(r[16]), r[10].strip().upper()
            if not price:
                continue
            solid = form in ("TAB", "CAP", "TBC", "TBD", "TBE", "CPS", "TAF")
            units = (num(r[11]) or 1) * (num(r[12]) or 1) if solid else (num(r[12]) or 1)
            text = " + ".join(inn)
            volume = "" if solid or not num(r[11]) else f" · {r[11]} {'g' if r[9].strip().lower().endswith('/g') else 'ml'}"
            save_listing(cur, "ZA", "sep", "cap", r[3], text, f"{text} {r[8]} {r[9]} {'tablet' if solid else form}{volume}",
                         english_molecule(cur, names, generics, text), units, price, "ZAR",
                         originator={"originator": True, "generic": False}.get(str(r[20]).strip().lower()))
            n += 1
        read_version(cur, "za", url)
    # Ghana: NHIS medicines list (price per tablet, vial or bottle, GHS)
    page = s.get(GHANA, timeout=60).text
    pdf = next((urljoin(GHANA, h) for h in re.findall(r'href="([^"]+\.pdf)"', page) if "ML" in h.upper() or "MEDICINE" in h.upper()), None)
    if new_version(cur, "gh", pdf):
        import pypdf
        lines = [ln for pg in pypdf.PdfReader(io.BytesIO(s.get(pdf, timeout=300).content)).pages
                 for ln in pg.extract_text(extraction_mode="layout").splitlines()]
        for i, ln in enumerate(lines):
            m = re.match(r"^([A-Z0-9]{6,12})\s{2,}(.+?)\s{2,}(\S[\w ]*?)\s*$", ln)
            nxt = next((x for x in lines[i + 1:i + 3] if x.strip()), "")
            p_ = re.match(r"^\s+([\d,]+\.\d+)\s+\S+\s*$", nxt)
            if m and p_:
                save_listing(cur, "GH", "nhis", "reimbursement", m.group(1), m.group(2), f"{m.group(2)} · per {m.group(3)}",
                             english_molecule(cur, names, generics, m.group(2)), 1, num(p_.group(1)), "GHS")
                n += 1
        read_version(cur, "gh", pdf)
    # Azerbaijan: Tariff Council maximum prices (PDF; AZN incl. VAT, retail)
    page = s.get(AZ_TARIFF, timeout=60).text
    pdfs = re.findall(r'href="([^"]+/storage/media/(\d+)/[^"]+\.pdf)"', page)
    pdf = urljoin(AZ_TARIFF, max(pdfs, key=lambda x: int(x[1]))[0]) if pdfs else None     # the newest upload is the full list
    if new_version(cur, "az", pdf):
        import pypdf
        for pg in pypdf.PdfReader(io.BytesIO(s.get(pdf, timeout=600).content)).pages:
            for ln in pg.extract_text(extraction_mode="layout").splitlines():
                c = re.split(r"\s{2,}", ln.strip())
                if len(c) >= 11 and c[0].isdigit() and re.match(r"\d+(?:[.,]\d+)?$", c[9].replace(",", "")):
                    inn, dose, form, qty, retail = c[2], c[3], c[4], c[6], num(c[9].replace(",", ""))
                    save_listing(cur, "AZ", "tariff_az", "cap", f"{c[0]}", c[1], f"{inn} {dose.replace('mq', 'mg')} {form} №{qty}",
                                 english_molecule(cur, names, generics, inn), None, retail, "AZN")
                    n += 1
        read_version(cur, "az", pdf)
    # Armenia: a wholesaler's weekly price list (AMD); the INN is stated in Russian
    head = s.head(NATALI, timeout=60)
    if new_version(cur, "am", head.headers.get("last-modified")):
        sheets = pd.read_excel(io.BytesIO(s.get(NATALI, timeout=300).content), header=None, sheet_name=None, dtype=str)
        for sheet in sheets.values():
            rows = sheet.fillna("").values.tolist()
            h = next((i for i, r in enumerate(rows[:10]) if "Международное название" in r), None)
            if h is None:
                continue
            for r in rows[h + 2:]:
                price = num(r[5])
                if price and r[3]:
                    save_listing(cur, "AM", "natali", "cap", r[0], r[1], f"{r[1]} {r[2]}", ru.find(cur, None, r[3]), None, price, "AMD")
                    n += 1
        read_version(cur, "am", head.headers.get("last-modified"))
    return n
