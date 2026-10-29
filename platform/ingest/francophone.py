"""Francophone West and Central Africa: Senegal's public list of marketing authorisations (ARP, arp.sn) and Cameroon's
repertoire of approved medicines (DPML, dpml.cm), read into the one registry shape, plus the French-to-English INN
normaliser the essential lists and registries need. Côte d'Ivoire's regulator (AIRP) publishes no readable register
yet: that market stays honest and thin until it does.

arp.sn serves no robots.txt (nothing disallowed) and its list pages stream React flight data; dpml.cm answers a plain
POST with an HTML table. Both are read once a week, one request a second."""
import datetime as dt
import hashlib
import json
import re
import time
import unicodedata

ARP = "https://arp.sn/bases-de-donnees/medicaments-autorises"
DPML = "https://dpml.cm/repertoireDesAmm/func/recherche.php"
PAUSE = 1.0
TODAY = dt.date.today()

# ------------------------------------------------------------------ French INN -> English
SALTS = {"chlorure": "chloride", "sulfate": "sulfate", "gluconate": "gluconate", "bicarbonate": "bicarbonate", "carbonate": "carbonate",
         "permanganate": "permanganate", "hydroxyde": "hydroxide", "phosphate": "phosphate", "lactate": "lactate", "citrate": "citrate",
         "acetate": "acetate", "fumarate": "fumarate", "oxyde": "oxide", "nitrate": "nitrate", "iodure": "iodide", "bromure": "bromide",
         "fluorure": "fluoride", "benzoate": "benzoate", "salicylate": "salicylate", "valproate": "valproate", "folinate": "folinate",
         "chlorhydrate": "hydrochloride", "bromhydrate": "hydrobromide", "mesilate": "mesilate", "mesylate": "mesylate", "maleate": "maleate",
         "tartrate": "tartrate", "besilate": "besilate", "succinate": "succinate", "dipropionate": "dipropionate", "propionate": "propionate",
         "trihydrate": "trihydrate", "palmitate": "palmitate", "stearate": "stearate", "pamoate": "pamoate", "embonate": "embonate",
         "decanoate": "decanoate", "enantate": "enantate", "caproate": "caproate"}
METALS = {"sodium": "sodium", "potassium": "potassium", "calcium": "calcium", "magnesium": "magnesium", "zinc": "zinc", "fer": "iron",
          "aluminium": "aluminium", "lithium": "lithium", "argent": "silver", "cuivre": "copper", "ferreux": "ferrous", "ferrique": "ferric",
          "ammonium": "ammonium", "bismuth": "bismuth"}
WORDS = {"acide": "acid", "fer": "iron", "vitamine": "vitamin", "insuline": "insulin", "heparine": "heparin", "sels de rehydratation orale": "oral rehydration salts",
         "sel de rehydratation orale": "oral rehydration salts", "sro": "oral rehydration salts", "eau pour preparation injectable": "water for injection",
         "eau ppi": "water for injection", "huile": "oil", "soluble": "soluble", "humaine": "human", "ordinaire": "regular", "lente": "isophane",
         "oxygene": "oxygen", "glucose": "glucose", "serum antitetanique": "tetanus antitoxin", "vaccin": "vaccine", "contre": "against",
         "glyceryl trinitrate": "glyceryl trinitrate", "trinitrine": "glyceryl trinitrate", "paracetamol": "paracetamol", "adrenaline": "epinephrine",
         "noradrenaline": "norepinephrine", "cotrimoxazole": "sulfamethoxazole + trimethoprim", "ethinylestradiol": "ethinylestradiol",
         "ethinyl estradiol": "ethinylestradiol", "levonorgestrel": "levonorgestrel", "chlorhexidine": "chlorhexidine", "trimethoprime": "trimethoprim",
         "pyrimethamine": "pyrimethamine", "sulfadoxine": "sulfadoxine", "a": "a", "b": "b", "c": "c", "d": "d", "e": "e", "k": "k",
         "cafeine": "caffeine", "charbon active": "activated charcoal", "charbon actif": "activated charcoal", "ocytocine": "oxytocin",
         "iode": "iodine", "iodee": "iodine", "povidone iodee": "povidone iodine", "eau oxygenee": "hydrogen peroxide", "alcool": "alcohol",
         "glycerine": "glycerol", "codeine": "codeine", "theophylline": "theophylline", "guaifenesine": "guaifenesin", "ambroxol": "ambroxol"}
# endings where English drops the final e (amoxicilline -> amoxicillin); the rest keep it (morphine, chloroquine, lamivudine)
DROP_E = ("cilline", "mycine", "micine", "statine", "formine", "parine", "suline", "goxine", "farine", "tocine", "fulvine", "toxine", "zoline",
          "sporine", "mectine", "ampine", "kacine", "floxacine", "gliptine", "gabaline", "pentine", "flozine", "picine", "listine", "myxine",
          "tracine", "toine", "pressine", "rubicine", "platine", "bumine", "buline", "nesine", "cocine", "mifepristone_keep")


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn")


def _word(w):
    """One French INN word to its English spelling."""
    if w in WORDS:
        return WORDS[w]
    if w.endswith("ique") and len(w) > 5:
        return w[:-4] + "ic"
    if w.endswith("ene") and len(w) > 6:
        return w[:-3] + "en"                       # ibuprofene -> ibuprofen, ketoprofene -> ketoprofen, tamoxifene -> tamoxifen
    if w.endswith("ine"):
        return w[:-1] if any(w.endswith(e) for e in DROP_E if not e.endswith("_keep")) else w
    if w.endswith("ium") or w.endswith("ol") or w.endswith("ide") or w.endswith("ate") or w.endswith("one") or w.endswith("azole"):
        return w
    if w.endswith("ure") and len(w) > 5:
        return w[:-3] + "ide"                      # chlorure -> chloride (when not caught as a salt)
    return w


def fr_inn(name):
    """A French INN or list entry in English-like spelling, good enough for the fuzzy molecule matcher:
    'Amoxicilline + Acide clavulanique' -> 'amoxicillin + clavulanic acid', 'Chlorure de sodium' -> 'sodium chloride'."""
    s = strip_accents(name).lower().replace("’", "'")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"\b(?:en|sous forme de|forme)\s+(?:comprime|gelule|sirop|solution|poudre|suspension|injectable)s?\b.*$", " ", s)
    s = re.sub(r"[+/]|\bet\b|\bou\b|\bassocie[e]?s? a\b", " + ", s)
    parts = []
    for part in s.split("+"):
        words = [w for w in re.split(r"[\s\-]+", part.strip(" .,;:")) if w]
        if not words:
            continue
        phrase = " ".join(words)
        if phrase in WORDS:
            parts.append(WORDS[phrase])
            continue
        # 'chlorure de sodium' -> 'sodium chloride'; 'sulfate ferreux' -> 'ferrous sulfate'; 'acide folique' -> 'folic acid'
        m = re.match(r"^(\w+)\s+(?:de\s+|d')(\w+)(?:\s+(.*))?$", phrase)
        if m and m.group(1) in SALTS:
            base = METALS.get(m.group(2)) or _word(m.group(2))          # 'chlorure de sodium', 'chlorhydrate d'ambroxol'
            parts.append(f"{base} {SALTS[m.group(1)]}" + (f" {m.group(3)}" if m.group(3) else ""))
            continue
        if len(words) == 2 and words[0] in SALTS and words[1] in METALS:
            parts.append(f"{METALS[words[1]]} {SALTS[words[0]]}")
            continue
        if words[0] == "acide" and len(words) >= 2:
            parts.append(" ".join(_word(w) for w in words[1:]) + " acid")
            continue
        words = [w for w in words if w not in ("de", "d'", "du", "des", "la", "le", "les")]
        parts.append(" ".join(_word(w) for w in words))
    return re.sub(r"\s+", " ", " + ".join(p for p in parts if p)).strip()


# ------------------------------------------------------------------ Senegal: arp.sn flight payloads
def flight(text):
    """id -> parsed JSON for the lines of a React flight payload that carry one."""
    out = {}
    for line in text.split("\n"):
        m = re.match(r"^([0-9a-f]+):(.*)$", line)
        if m and m.group(2)[:1] in "[{\"":
            try:
                out[m.group(1)] = json.loads(m.group(2))
            except ValueError:
                pass
    return out


def _resolve(node, chunks, depth=0):
    if depth > 60:
        return node
    if isinstance(node, str) and node.startswith("$L"):
        return _resolve(chunks.get(node[2:]), chunks, depth + 1)
    if isinstance(node, list):
        return [_resolve(x, chunks, depth + 1) for x in node]
    if isinstance(node, dict):
        return {k: _resolve(v, chunks, depth + 1) for k, v in node.items()}
    return node


def _text(node):
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        if len(node) == 4 and node[0] == "$" and isinstance(node[3], dict):
            return _text(node[3].get("children"))
        return " ".join(t for t in (_text(x) for x in node) if t)
    if isinstance(node, dict):
        return _text(node.get("children"))
    return ""


def sn_rows(text):
    """The table rows of one arp.sn list page: {column key: text}, column keys as the site names them
    (product_name, dci, dosage, presentation, dosage_form, route, laboratory, therapeutic_class)."""
    chunks = flight(text)
    out = []

    def walk(node):
        if isinstance(node, list):
            if len(node) == 4 and node[0] == "$" and node[1] == "tr" and isinstance(node[3], dict) and node[3].get("className") == "align-top":
                cells = _resolve(node[3].get("children"), chunks)
                flat = []
                stack = [cells]
                while stack:
                    x = stack.pop()
                    if isinstance(x, list):
                        if len(x) == 4 and x[0] == "$" and x[1] == "td":
                            flat.append(x)
                        else:
                            stack.extend(reversed(x))
                out.append({c[2]: _text(c[3].get("children")).strip() for c in flat if isinstance(c[3], dict)})
                return
            for x in node:
                walk(x)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)

    for v in chunks.values():
        walk(v)
    return out


def sn_pages(text):
    """How many list pages the site offers (from its pagination links)."""
    return max([int(n) for n in re.findall(r"[?&]page=(\d+)", text)] or [1])


def sn_registry(s, log=None):
    """Every marketing authorisation on arp.sn, one request a second."""
    first = s.get(ARP, headers={"RSC": "1"}, timeout=120)
    first.raise_for_status()
    text = first.content.decode("utf-8", "replace")      # the flight payload carries no charset header; it is UTF-8
    rows, pages = sn_rows(text), sn_pages(text)
    for page in range(2, pages + 1):
        time.sleep(PAUSE)
        r = s.get(ARP, params={"page": page}, headers={"RSC": "1"}, timeout=120)
        if r.status_code != 200:
            if log:
                log.warning("arp.sn page %s: HTTP %s", page, r.status_code)
            continue
        rows += sn_rows(r.content.decode("utf-8", "replace"))
    return [sn_row(r) for r in rows if r.get("product_name") or r.get("dci")]


def sn_row(r):
    key = "|".join(r.get(k, "") for k in ("product_name", "dci", "dosage", "presentation", "laboratory"))
    dash = lambda v: None if not v or v.strip() in ("—", "-", "") else v.strip()
    lab = dash(r.get("laboratory"))
    return dict(certificate_no="SN-" + hashlib.sha1(key.encode()).hexdigest()[:12], brand=dash(r.get("product_name")),
                generic=fr_inn(r.get("dci") or "") or None, generic_local=dash(r.get("dci")), atc=None, dosage_form=dash(r.get("dosage_form")),
                strength=dash(r.get("dosage")), manufacturer=lab, manufacturing_country=None, holder=lab, ltr=None, reg_year=None,
                status="Registered", active=True, route=dash(r.get("route")), therapeutic_class=dash(r.get("therapeutic_class")))


# ------------------------------------------------------------------ Cameroon: dpml.cm repertoire
ROLE = re.compile(r"\s+(?:Fabrication|Lib[ée]ration|Conditionnement|Contr[ôo]le|Mise en forme|Fabricant)\b.*$", re.I)
FORM_WORDS = re.compile(r"comprim|g[ée]lule|capsule|sirop|solution|suspension|poudre|pommade|cr[èe]me|gel\b|collyre|gouttes|suppositoire|ovule|"
                        r"injectable|perfusion|a[ée]rosol|inhal|sachet|granul|[ée]mulsion|lotion|spray|patch|implant|tablet|syrup|injection|"
                        r"ointment|cream|drops|lyophilisat|kit\b|pastille|shampo|bain de bouche|dispositif", re.I)


def cm_rows(page):
    """(amm, designation, dci, holder, maker, granted, expires) from the repertoire's HTML table."""
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) == 7:
            out.append(cells)
    return out


def cm_date(v):
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", v or "")
    try:
        return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None
    except ValueError:
        return None


def cm_row(c):
    amm, designation, dci, holder, maker, granted, expires = c
    parts = [p.strip() for p in designation.split(",")]
    brand = parts[0] if parts else designation
    strength = next((p for p in parts[1:] if re.search(r"\d", p) and not FORM_WORDS.search(p)), None)
    form = next((p.split("/")[0].strip() for p in parts[1:] if FORM_WORDS.search(p)), None)
    maker_name = ROLE.sub("", maker.split(",")[0]).strip(" .") if maker else None
    maker_name = re.sub(r"\s+(?:IND|CHN|FRA|GBR|USA|DEU|ITA|ESP|PAK|BGD|EGY|MAR|TUN|TUR|KOR|JPN|VNM|CMR|NGA|GHA|KEN|ZAF|CHE|BEL|NLD|PRT|POL|GRC|ROU|CZE|HUN|UKR|RUS|ARE|JOR|IRN|IDN|MYS|THA|BRA|ARG|MEX|CAN|AUS|SEN|CIV)$", "", maker_name or "")
    exp, got = cm_date(expires), cm_date(granted)
    active = exp is None or exp >= TODAY
    return dict(certificate_no=amm.strip() or None, brand=brand or None, generic=fr_inn(dci) or None, generic_local=dci or None, atc=None,
                dosage_form=form, strength=strength, manufacturer=maker_name or holder or None, manufacturing_country=None,
                holder=holder.strip() or None, ltr=None, reg_year=got.year if got else None,
                status="Registered" if active else "Expired", active=active)


def cm_registry(s, log=None):
    """The whole repertoire in one date-range query (the site answers it in a few seconds), de-duplicated by AMM number."""
    r = s.post(DPML, data={"date1": "01/01/1990", "date2": f"31/12/{TODAY.year + 6}"}, timeout=300)
    r.raise_for_status()
    seen, out = set(), []
    for c in cm_rows(r.text):
        if c[0] in seen:
            continue
        seen.add(c[0])
        out.append(cm_row(c))
    if log:
        log.info("dpml.cm: %d authorisations, %d active", len(out), sum(x["active"] for x in out))
    return out
