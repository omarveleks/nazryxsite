"""Therapeutic class of every molecule, from its official ATC codes and how it is actually sold.

A molecule often has several ATC codes (dexamethasone: tablets and injections H02, eye drops S01, creams D07). The class
follows the codes that match the forms registered in our markets, so timolol (mostly eye drops) is ophthalmological,
diclofenac (mostly tablets and injections) is for pain, and bromfenac (eye drops only) is ophthalmological whatever an
essential list or a registry wrote. Combinations take the class most of their ingredients share for that route.
A molecule we cannot read keeps the class it has. Runs after every registry load and on every start.
"""
import csv
import logging
import os
import re
from collections import Counter, defaultdict

log = logging.getLogger("classify")
ATC_NAMES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog", "atc_names.csv")

OPHTHALMIC, ENT, SKIN = "Ophthalmological Preparations", "Ear, Nose and Throat Medicines", "Dermatological Medicines"
# ATC prefix -> class (longest prefix wins). Names follow the essential-medicines sections the site already uses.
CLASSES = {
    "A": "Gastro-intestinal Medicines", "A01": ENT, "A07A": "Anti-infective Medicines", "A09": "Digestive and Pancreatic Enzymes",
    "A10": "Medicines for Diabetes and Related Disorders", "A11": "Vitamins and Minerals", "A12": "Vitamins and Minerals",
    "A14": "Hormones and Antihormones",
    "B": "Medicines Affecting the Blood", "B05": "Solutions Correcting Water, Electrolyte and Acid-Base Disturbances",
    "B05CA": "Disinfectants and Antiseptics",
    "C": "Cardiovascular Medicines", "D": SKIN, "D08": "Disinfectants and Antiseptics",
    "G": "Hormones and Antihormones", "G01": "Anti-infective Medicines", "G02A": "Oxytocics and Anti-oxytocics",
    "G02CB": "Anti-Parkinsonism and Anti-prolactinoma Medicines", "G02CX": "Oxytocics and Anti-oxytocics", "G04": "Urological Medicines",
    "H": "Hormones and Antihormones", "H01BB": "Oxytocics and Anti-oxytocics",
    "J": "Anti-infective Medicines", "J06": "Immunological Agents", "J07": "Immunological Agents",
    "L": "Antineoplastics, Immunosuppressives and Immunomodulators",
    "M": "Medicines for Pain and Palliative Care", "M03": "Muscle Relaxants and Cholinesterase Inhibitors",
    "M04": "Medicines for Diseases of Joints", "M05": "Bisphosphonates",
    "N": "Psychotherapeutic and Related Medicines", "N01": "Anaesthetics, Preoperative Medicines and Medical Gases",
    "N02": "Medicines for Pain and Palliative Care", "N02C": "Antimigraine Medicines", "N03": "Anticonvulsants and Antiepileptics",
    "N04": "Anti-Parkinsonism and Anti-prolactinoma Medicines", "N07AA": "Muscle Relaxants and Cholinesterase Inhibitors",
    "P": "Anti-infective Medicines",
    "R": "Medicines Acting on the Respiratory Tract", "R01": ENT, "R02": ENT,
    "R06": "Anti-allergies and Medicines Used in Anaphylaxis",
    "S": OPHTHALMIC, "S02": ENT,
    "V03AB": "Antidotes and Other Substances Used in Poisonings", "V03AC": "Antidotes and Other Substances Used in Poisonings",
    "V03AE": "Phosphate Binders", "V03AF": "Antineoplastics, Immunosuppressives and Immunomodulators",
    "V04": "Diagnostic Agents", "V08": "Diagnostic Agents", "V09": "Diagnostic Agents",
    "V07": "Solutions Correcting Water, Electrolyte and Acid-Base Disturbances",
}
PREFIXES = sorted(CLASSES, key=len, reverse=True)

# How a product is used, read from its dosage form and name (English, Russian, transliterated Russian).
# Products we cannot read have no route: they never overrule a class, only help fill an empty one.
ROUTES = [
    ("systemic", r"для приема внутрь|dlya priema vnutr|for oral susp|oral suspension|gel for oral"),
    ("eye", r"\beye|ophthalm|ocular|intravitreal|глаз|glaz"),
    ("ear", r"\bear\b|\bears\b|\botic\b|auricular|ушн|ushn"),
    ("nose", r"nasal|\bnose\b|назал|в нос|dlya nosa|nazal"),
    ("inhaled", r"inhal|nebul|respule|ингал|ingal"),
    ("mouth", r"lozenge|throat|mouthwash|mouth wash|gargle|oromucosal|oral gel|oral spray|sprey oraln|slizist|rassasyv|пастилк|для горла|rotovoy|polosti rta|ledents|dlya gorla"),
    ("vaginal", r"vagin|pessar|вагин"),
    ("systemic", r"transderm|трансдерм|sublingu|subling|подъязыч|podyazych"),
    ("skin", r"cream|ointment|\bgel\b|lotion|liniment|shampoo|topical|cutaneous|dusting powder|external|крем|мазь|гель|наружн|"
             r"krem|\bmaz\b|naruzh"),
    ("systemic", r"tablet|\btab\b|caplet|capsul|inject|infus|\bvial|ampoul|syrup|suspension|oral|elixir|sachet|granul|"
                 r"suppos|rectal|pen\b|cartridge|prefilled|powder for (solution|suspension|concentrate)|таблет|капсул|инъек|"
                 r"инфуз|сироп|суспенз|внутрь|ректал|суппоз|tabletk|kapsul|inyekts|infuz|sirop|suspenz|vnutr|rektal|suppoz"),
]
# ATC groups for each local route, most typical first; everything else works through the body ("systemic")
LOCAL = {"eye": ("S01", "S03"), "ear": ("S02", "S03"), "nose": ("R01",), "mouth": ("R02", "A01"), "vaginal": ("G01", "G02B"),
         "skin": ("D", "M02", "C05"), "inhaled": ("R03",)}
NOT_SYSTEMIC = ("S", "R01", "R02", "A01", "M02", "G01", "G02B", "G02CC", "C05", "B05CA", "D02", "D03", "D04", "D06", "D07", "D08",
                "D09", "D11", "D01A", "D05A", "D10A")
# A product put on the skin, in the mouth or breathed in may be classed by that use too
ROUTE_CLASS = {"skin": SKIN, "mouth": ENT, "inhaled": "Medicines Acting on the Respiratory Tract"}
# Second uses that should not decide a class on their own: lidocaine is an anaesthetic before it is an antiarrhythmic,
# misoprostol an oxytocic before an ulcer medicine, prednisolone a corticosteroid before a bowel anti-inflammatory.
SECONDARY = ("C01BB", "C01EB", "A02BB", "A07E", "A06AB", "C05", "R05CB05", "V04CA", "V03AB16", "L01XX33")
# Helpers that do not decide what a combination is for (a cold tablet with caffeine is not a stimulant)
ADJUVANTS = {"kafein", "fenilefrin", "pseudoefedrin", "simetikon", "metilkobalamin", "sianokobalamin", "piridoksin", "tiamin",
             "riboflavin", "nikotinamid", "askorbat", "lidokain"}
# Uses the ATC index does not list but our markets sell (checked by hand)
KNOWN = {"geksoprenalin": "Oxytocics and Anti-oxytocics", "glisin": "Psychotherapeutic and Related Medicines",
         "aflibersept": OPHTHALMIC, "iodid": "Hormones and Antihormones", "benzidamin": ENT,
         "atropin": "Anaesthetics, Preoperative Medicines and Medical Gases", "inosin": "Cardiovascular Medicines",
         "interferon": "Antineoplastics, Immunosuppressives and Immunomodulators", "gidrogenperoksid": "Disinfectants and Antiseptics"}
# Metals name many different medicines ("aluminium phosphate" is an antacid, "aluminium chloride" an antiperspirant)
METALS = {"aluminium", "zink", "silver", "koper", "bismut", "iron", "ferum", "litium"}
# Words that are left of an inorganic salt once its metal is dropped ('zinc oxide' -> 'oxide'): not a molecule on their own
ANIONS = {"oksid", "iodid", "kglorid", "karbonat", "bikarbonat", "sitrat", "sulfat", "fosfat", "glukonat", "laktat", "asetat",
          "gidroksid", "fluorid", "bromid", "nitrat", "trisilikat", "aspartat", "asparaginat", "oroat", "glisinat"}


def atc_class(code):
    code = (code or "").strip().upper()
    if not code:
        return None
    if code.startswith("V") and not any(code.startswith(p) for p in PREFIXES if p.startswith("V")):
        return None
    return next((CLASSES[p] for p in PREFIXES if code.startswith(p)), None)


def route_of(text):
    t = (text or "").lower()
    return next((r for r, rx in ROUTES if re.search(rx, t)), None)


def atc_codes():
    """{name family: [ATC codes]} from the WHO ATC index we ship."""
    from pricing import family
    out, names = defaultdict(list), defaultdict(set)
    with open(ATC_NAMES, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = (row.get("en") or "").strip()
            if not name or "," in name or " and " in name or "combination" in name.lower():
                continue
            k = family(name)
            if k in ANIONS:
                k = re.sub(r"[^a-z]", "", name.lower())          # 'magnesium oxide' stays itself
            if k and "+" not in k and row["atc"] not in out[k]:
                out[k].append(row["atc"])
                names[k].add(name.lower())
    for k, ns in list(names.items()):          # 'mometasone furoate' is mometasone: one list of uses for both
        for n in ns:
            words = n.split()
            first = family(words[0]) if len(words) == 2 and re.search(r"(ate|ide|ite)$", words[1]) else None
            if first and first != k and first in out and first not in ANIONS and first not in METALS:
                both = out[first] + [c for c in out[k] if c not in out[first]]
                out[first], out[k] = both, list(both)
    return out


def parts_of(name, singles, close=True):
    """Ingredient families of a molecule name, in the order written; None when a word is not recognised.
    With close=False only exact names count (no typo matching): enough to fill a class, not to overrule one."""
    from pricing import family, ingredients, FILLER, SALT_WORDS
    whole = family(name)
    if whole in singles:
        return [whole]
    raw = re.sub(r"[^a-z]", "", (name or "").lower())
    if raw in singles:
        return [raw]
    words = [family(w) for w in re.findall(r"[a-z][a-z\-]{3,}", re.sub(r"\(.*?\)", " ", (name or "").lower()))
             if w not in FILLER and w not in SALT_WORDS]
    words = [w for w in words if w and len(w) >= 5]
    if not close:
        return words if words and all(w in singles for w in words) and not set(words) & ANIONS else None
    found = ingredients(name, singles)
    if not found:
        return None
    keys = found.split("+")
    if set(keys) & ANIONS:
        return None
    pos = {k: next((i for i, w in enumerate(words) if w == k or (w[:3] == k[:3] and abs(len(w) - len(k)) <= 1)), 99) for k in keys}
    return sorted(keys, key=lambda k: pos[k])


def classes_of(codes, route):
    """Classes one ingredient can carry when used by `route`, most likely first; None when the index cannot tell."""
    if route in LOCAL:
        local = sorted((c for c in codes if c.startswith(LOCAL[route])),
                       key=lambda c: next(i for i, p in enumerate(LOCAL[route]) if c.startswith(p)))
        local = [ENT if route in ("ear", "nose", "mouth") and c.startswith("S03") else atc_class(c) for c in local]
        if route in ROUTE_CLASS:      # creams, throat sprays, inhalers: often more than one use, all fair
            rest = [atc_class(c) for c in codes if atc_class(c)]
            if local:
                return local + [ROUTE_CLASS[route]] + rest
            return rest + [ROUTE_CLASS[route]] if all(c.startswith(NOT_SYSTEMIC) for c in codes) else None
        if local:
            return local
        if route == "ear":
            return [ENT]
        route = "systemic"           # a hormone sprayed in the nose, an antiviral in the eye with no eye code
    pool = codes if route is None else [c for c in codes if not c.startswith(NOT_SYSTEMIC)] or codes   # eye-only medicines
    if route is None and len({atc_class(c) for c in codes}) > 1:
        return None                  # several uses and no way to tell which
    main = [c for c in pool if not c.startswith(SECONDARY)] or pool
    out = [atc_class(c) for c in main if atc_class(c)]
    return out or None


def decide(name, route, current, codes, singles):
    """Keeps the class a molecule has unless its ATC codes rule it out; fills it in when there is none."""
    from pricing import family
    if family(name) in KNOWN:
        return KNOWN[family(name)]
    parts = parts_of(name, singles, close=not current)
    if not parts:
        return current
    if route in ("eye", "ear", "nose"):      # eye drops of a decongestant and an antihistamine: the eye part decides
        local = [p for p in parts if any(c.startswith(LOCAL[route]) for c in codes[p])]
        parts = local or parts
    per = [classes_of(codes[p], route) for p in parts]
    if current and any(c is None or current in c for c in per):
        return current
    per = [c or classes_of(codes[p], "systemic") for p, c in zip(parts, per)]     # nothing better to go on
    main = [c for p, c in zip(parts, per) if c and p not in ADJUVANTS] or [c for c in per if c]
    if not main:
        return current
    counts = Counter(c for classes in main for c in set(classes))     # the class most ingredients can carry
    top = max(counts.values())
    return next(c for classes in main for c in classes if counts[c] == top)


def routes(cur):
    """Usual route of each molecule: the most common among its registered products we can read (else the forms the
    essential lists name)."""
    seen = defaultdict(Counter)
    for mid, form, generic in cur.execute("select molecule_id, dosage_form, generic_name from registrations where molecule_id is not null"):
        r = route_of(form) or route_of(generic)
        if r:
            seen[mid][r] += 1
    for mid, forms in cur.execute("select molecule_id, string_agg(forms, ',') from country_molecules where forms is not null group by 1"):
        if mid not in seen:
            for f in re.split(r"[,;]", forms or ""):
                if route_of(f):
                    seen[mid][route_of(f)] += 1
    return {m: c.most_common(1)[0][0] for m, c in seen.items()}


def pick_code(codes, route):
    """The ATC code of an ingredient used by `route`: the eye code of eye drops, the systemic code of a tablet."""
    if route in LOCAL:
        local = sorted((c for c in codes if c.startswith(LOCAL[route])),
                       key=lambda c: next(i for i, p in enumerate(LOCAL[route]) if c.startswith(p)))
        if local:
            return local[0]
    systemic = [c for c in codes if not c.startswith(NOT_SYSTEMIC)]
    main = [c for c in systemic if not c.startswith(SECONDARY)] or systemic
    return (main or list(codes) or [None])[0]


def fits(code, route):
    """Whether a stored code suits how the product is used."""
    if route in LOCAL:
        return code.startswith(LOCAL[route])
    return not code.startswith(NOT_SYSTEMIC + SECONDARY)


def fix_codes(cur, codes, usual=None):
    """One ATC code per medicine name and per product, chosen for its form: the catalogue once kept the first code it
    met (dexamethasone as an acne cream, D10AA03), which then decided which regulatory rules a product matched."""
    from pricing import family
    n = 0
    sold = {}                              # how each molecule is mostly sold, by name family
    for mid, inn in cur.execute("select id, inn from molecules").fetchall():
        if (usual or {}).get(mid):
            sold.setdefault(family(inn), usual[mid])
    for cid, name, atc in cur.execute("select id, name, atc from medicine_catalog where atc is not null").fetchall():
        k = family(name)
        if sold.get(k) == "systemic" and k not in KNOWN and len(codes.get(k, ())) > 1 and atc in codes[k] and not fits(atc, None):
            best = pick_code(codes[k], None)
            if best and best != atc and fits(best, None):
                cur.execute("update medicine_catalog set atc = %s where id = %s", (best, cid))
                n += 1
    for pid, name, form, atc, inn in cur.execute("""select p.id, p.name, p.dosage_form, p.atc, m.inn from mfr_products p
                                                    left join molecules m on m.id = p.molecule_id where p.atc is not null""").fetchall():
        k = family(inn or "")
        k = k if k in codes else next((family(w) for w in re.findall(r"[A-Za-z][A-Za-z\-]{3,}", name or "") if family(w) in codes), None)
        if not k or atc not in codes[k]:
            continue                       # a combination or a code typed by hand: leave it
        route = route_of(form) or route_of(name)
        if not fits(atc, route):
            best = pick_code(codes[k], route)
            if best and best != atc and fits(best, route):
                cur.execute("update mfr_products set atc = %s where id = %s", (best, pid))
                n += 1
    return n


def run(cur):
    codes = atc_codes()
    singles = set(codes)
    usual = routes(cur)
    changed = 0
    for mid, inn, current in cur.execute("select id, inn, category from molecules").fetchall():
        new = decide(inn, usual.get(mid), current, codes, singles)
        if new and new != current:
            cur.execute("update molecules set category = %s where id = %s", (new, mid))
            changed += 1
    log.info("classes: %s molecules changed, %s ATC codes set for their form", changed, fix_codes(cur, codes, usual))
    return changed
