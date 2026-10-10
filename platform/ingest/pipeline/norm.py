"""Shared normalisation: molecule keys, dosage forms, company names.

Molecule key
------------
The canonical molecule key is the sorted, de-duplicated set of ingredient tokens, e.g.
"Sulfamethoxazole + Trimethoprim", "Trimethoprim/Sulfamethoxazole" and
"sulfamethoxazole trimethoprim" all become "sulfamethoxazole trimethoprim".

Rules, in order:
1. lower-case, drop bracketed text, strengths and units;
2. split combinations on + / & , "with";
3. drop dosage-form words ("injection", "tablets", "inhaler", "slow-release", ...);
4. drop salt / ester words, *unless* that leaves nothing but a counter-ion, so
   "Ferrous sulphate" -> "ferrous" but "Sodium chloride", "Magnesium oxide" and
   "Potassium iodide" keep both words (the old version reduced them to "" or "oxide");
5. map spelling variants and synonyms to one name (benzhexol -> trihexyphenidyl,
   adrenaline -> epinephrine, sulphate -> sulfate, ...).
"""
import re

# Words that are never part of an ingredient name.
DESCRIPTORS = {
    "as", "base", "equivalent", "equiv", "to", "bp", "usp", "ip", "ph", "eur", "ep", "jp", "w", "v", "ww", "wv",
    "and", "of", "in", "salt", "salts", "elemental", "activated", "dihydrate", "monohydrate", "trihydrate",
    "pentahydrate", "sesquihydrate", "hemihydrate", "hydrate", "anhydrous", "micronised", "micronized",
    "purified", "sterile", "compound", "formulation", "fixed", "dose", "combination", "fdc",
}
# Dosage-form and presentation words (kept out of the molecule key; the form is stored separately).
FORM_WORDS = {
    "injection", "injections", "injectable", "inj", "infusion", "intravenous", "iv", "im", "vial", "vials", "ampoule",
    "ampoules", "tablet", "tablets", "tab", "tabs", "caplet", "caplets", "capsule", "capsules", "cap", "caps",
    "softgel", "softgels", "oral", "solution", "solutions", "suspension", "syrup", "elixir", "drops", "drop",
    "liquid", "emulsion", "powder", "powders", "granules", "sachet", "sachets", "for", "reconstitution",
    "lyophilized", "lyophilised", "concentrate", "cream", "ointment", "gel", "lotion", "paste", "topical",
    "shampoo", "spray", "patch", "patches", "foam", "eye", "ear", "nasal", "ophthalmic", "otic", "inhaler",
    "inhalation", "aerosol", "nebulizer", "nebuliser", "nebules", "respules", "rotacaps", "suppository",
    "suppositories", "pessary", "pessaries", "vaginal", "rectal", "enema", "sublingual", "buccal", "dispersible",
    "chewable", "effervescent", "film", "coated", "film-coated", "enteric", "gastro-resistant", "delayed",
    "prolonged", "extended", "sustained", "modified", "controlled", "release", "slow-release",
    "extended-release", "sustained-release", "modified-release", "prolonged-release", "slow", "retard", "sr", "xr",
    "er", "mr", "cr", "dr", "od", "forte", "plus", "ds", "pfs", "pre-filled", "prefilled", "pen", "pens",
    "cartridge", "bottle", "bag", "kit", "pack", "mouthwash", "gargle", "lozenge", "lozenges", "implant",
    "gelatin", "ml", "mg", "mcg", "g", "iu", "units", "unit", "dpi", "mdi", "hfa",
}
# Salt / ester parts: removed unless removal would leave only a counter-ion (see ANION_ONLY).
SALT_WORDS = {
    "hydrochloride", "hcl", "dihydrochloride", "hydrobromide", "sulphate", "sulfate", "bisulfate", "hemisulfate",
    "sodium", "disodium", "potassium", "dipotassium", "calcium", "magnesium", "mesylate", "mesilate", "dimesylate",
    "maleate", "hydrogen", "fumarate", "tartrate", "tartarate", "bitartrate", "succinate", "phosphate", "acetate",
    "citrate", "besylate", "besilate", "nitrate", "bromide", "chloride", "dipropionate", "valerate", "propionate",
    "furoate", "medoxomil", "axetil", "proxetil", "pivoxil", "embonate", "pamoate", "disoproxil", "alafenamide",
    "lysine", "tromethamine", "trometamol", "oxalate", "gluconate", "decanoate", "enanthate", "cypionate",
    "stearate", "palmitate", "lactate", "benzoate", "estolate", "ethylsuccinate", "monohydrochloride",
    "trihydrochloride", "malate", "napsylate", "tosylate", "xinafoate", "bromide", "iodide", "edisylate",
}
# What is left when a product IS the salt (sodium chloride, magnesium oxide ...): keep the whole name then.
ANION_ONLY = {
    "oxide", "bicarbonate", "carbonate", "hydroxide", "trisilicate", "permanganate", "iodide", "chloride",
    "sulfate", "sulphate", "phosphate", "citrate", "gluconate", "lactate", "acetate", "fluoride", "bromide",
    "dichloroisocyanurate", "hypochlorite", "nitrate", "thiosulfate", "edta", "bicarbonats",
}
# Spelling variants, British/US names, OCR typos and synonyms -> one canonical token string.
SYNONYMS = {
    "sulphate": "sulfate", "bicarbonats": "bicarbonate", "zine": "zinc", "lodide": "iodide", "lodine": "iodine",
    "euphobia": "euphorbia", "tartarate": "tartrate", "lsophane": "isophane", "fumerate": "fumarate",
    "benzhexol": "trihexyphenidyl", "adrenaline": "epinephrine", "noradrenaline": "norepinephrine",
    "chlorpheniramine": "chlorphenamine", "phenobarbitone": "phenobarbital", "frusemide": "furosemide",
    "lignocaine": "lidocaine", "aspirin": "acetylsalicylic acid", "acetaminophen": "paracetamol",
    "albuterol": "salbutamol", "cotrimoxazole": "sulfamethoxazole trimethoprim", "co-trimoxazole":
    "sulfamethoxazole trimethoprim", "methyl cobalamin": "mecobalamin", "methylcobalamin": "mecobalamin",
    "mecobalamine": "mecobalamin", "cyanocobalamine": "cyanocobalamin", "valproic acid": "valproate",
    "divalproex": "valproate", "beclomethasone": "beclometasone", "gentamycin": "gentamicin",
    "amoxycillin": "amoxicillin", "cephalexin": "cefalexin", "ceftriaxon": "ceftriaxone",
    "glibenclamide": "glibenclamide", "glyburide": "glibenclamide", "paracetamole": "paracetamol",
    "rifampin": "rifampicin", "ergometrine": "ergometrine", "ergonovine": "ergometrine", "oxytocine": "oxytocin",
    "d-penicillamine": "penicillamine", "benzyl penicillin": "benzylpenicillin",
    "low molecular weight heparin": "enoxaparin", "unfractionated heparin": "heparin",
    "regular insulin": "insulin human", "human insulin": "insulin human", "soluble insulin": "insulin human",
    "liposomal amphotericin b": "amphotericin b liposomal", "amphotericin b deoxycholate": "amphotericin b",
    "folinic acid": "calcium folinate", "leucovorin": "calcium folinate", "ferrous salt": "ferrous",
    "ferrous salts": "ferrous", "iron sucrose": "iron sucrose", "s-amlodipine": "levamlodipine",
    "salicyclic": "salicylic", "dextrose": "glucose", "vitamin a": "retinol", "vitamin k1": "phytomenadione",
    "vitamin k": "phytomenadione", "vitamin c": "ascorbic acid", "vitamin b12": "cyanocobalamin",
    "vitamin b1": "thiamine", "vitamin b6": "pyridoxine", "glyceryl trinitrate": "nitroglycerin",
    "ors": "oral rehydration", "oral rehydration": "oral rehydration", "isoprenaline": "isoprenaline",
    "hyoscine butylbromide": "hyoscine butylbromide", "metformin": "metformin", "tetanus vaccine": "tetanus toxoid",
    "phenoxymethyl penicillin": "phenoxymethylpenicillin", "mesalamine": "mesalazine", "ethinyloestradiol": "ethinylestradiol",
    "ethinyl estradiol": "ethinylestradiol", "acid tartrate": "tartrate", "riboflavine": "riboflavin",
    "clavulanate": "clavulanic acid", "co-amoxiclav": "amoxicillin clavulanic acid", "supplements": "supplement",
    "ethylene diamine tetra-acetic acid": "edta", "ethylenediamine tetra-acetic acid": "edta",
    "calcium disodium edta": "edta", "oral rehydration salts": "oral rehydration",
}
UNIT = r"(mg|mcg|µg|ug|g|kg|iu|i\.u\.?|ml|l|%|units?|mmol|meq|micrograms?|million|miu|moles?|mi)"


def _clean_part(p):
    p = re.sub(r"[^a-z0-9\- ]", " ", p)
    p = re.sub(r"\b\d[\d\-]*\b", " ", p)            # leftover numbers
    p = re.sub(r"\s+", " ", p).strip()
    for k in sorted(SYNONYMS, key=len, reverse=True):  # multi-word synonyms first
        if " " in k and re.search(rf"\b{re.escape(k)}\b", p):
            p = re.sub(rf"\b{re.escape(k)}\b", SYNONYMS[k], p)
    toks = [SYNONYMS.get(t, t) for t in p.split()]
    toks = [t for t in " ".join(toks).split() if t not in DESCRIPTORS and t not in FORM_WORDS and len(t) > 1]
    if not toks:
        return ""
    core = [t for t in toks if t not in SALT_WORDS]
    if not core or all(t in ANION_ONLY for t in core):
        core = toks  # the salt is the medicine (sodium chloride, magnesium oxide, potassium iodide)
    s = " ".join(core)
    return SYNONYMS.get(s, s)


def molecule_parts(name):
    """Ingredient names of a product, normalised, in input order (used for display and matching)."""
    s = str(name if isinstance(name, str) else "").lower().replace("’", "'")
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", s)
    s = re.sub(rf"\b[\d.,]+\s*{UNIT}(?=[\s/+,;)]|$)", " ", s)
    s = re.sub(r"\b\d+\s*/\s*\d+\b", " ", s)          # ratios like 30/70
    s = s.replace("&", "+").replace(" with ", " + ").replace("/", "+").replace(",", "+").replace(";", "+")
    parts = [_clean_part(p) for p in s.split("+")]
    out = []
    for p in parts:
        if len(p) > 2 and p not in out:
            out.append(p)
    return out


def molecule_key(name):
    """Canonical key: sorted unique ingredient tokens. '' when nothing usable is left."""
    toks = sorted({t for p in molecule_parts(name) for t in p.split()})
    # repeated OCR names ("clotrimazole clotrimazole") collapse naturally through the set
    return " ".join(toks)


PHARMACOPOEIA = r"\b(bp|usp|ip|ph\.?\s?eur|eur|ep|jp|nf)\b\.?"
WORD_CASE = {"hcl": "HCl", "hci": "HCl", "hbr": "HBr", "edta": "EDTA", "ors": "ORS", "dha": "DHA", "epa": "EPA"}
SMALL_WORDS = {"of", "for", "in", "with", "de"}
NOT_INGREDIENTS = {"inert", "placebo", "inert tablets", "placebo tablets"}


def _title(part, all_caps):
    """'DICLOFENAC SODIUM' -> 'Diclofenac Sodium', 'l-ornithine' -> 'L-Ornithine', 'Oil of Anise' stays.
    Words already mixed or upper case inside normal text ('B12', 'HCI') are left alone."""
    words = []
    for i, w in enumerate(part.split()):
        low = w.lower()
        if low in WORD_CASE:
            words.append(WORD_CASE[low])
        elif i and low in SMALL_WORDS:
            words.append(low)
        elif w.islower() or (all_caps and w.isupper()):
            words.append("-".join(x[:1].upper() + x[1:].lower() for x in w.split("-")))
        else:
            words.append(w)
    return " ".join(words)


def display_name(name):
    """Readable ingredient name for a registry molecule: no strengths, pharmacopoeia marks or trailing form words,
    one ' + ' between ingredients. 'Diclofenac Sodium BP 50mg/Paracetamol BP 325mg tablets' ->
    'Diclofenac Sodium + Paracetamol'."""
    if not isinstance(name, str) or not name.strip():
        return ""
    s = name.replace("’", "'")
    s = re.sub(r"\((?:[+-]|\+/-|±)\)-?", "-", s)             # S(-)-Amlodipine -> S-Amlodipine
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", s)
    s = re.sub(rf"\b[\d.,]+\s*(?:{UNIT[1:-1]}|gm|gms)\b\.?", " ", s, flags=re.I)
    s = re.sub(r"\b\d+\s*/\s*\d+\b", " ", s)
    s = re.sub(PHARMACOPOEIA, " ", s, flags=re.I)
    all_caps = not re.search(r"[a-z]", s)
    out = []
    for p in re.split(r"\s*(?:\+|&|/|,|;|\bwith\b|\band\b)\s*", s, flags=re.I):
        words = re.sub(r"\s+", " ", p).strip(" -.").split()
        while len(words) > 1 and words[-1].lower().strip(".") in FORM_WORDS:
            words.pop()
        p = " ".join(words)
        if len(p) < 2 or not re.search(r"[A-Za-z]", p) or p.lower() in NOT_INGREDIENTS or p.lower() in FORM_WORDS:
            continue
        p = _title(p, all_caps)
        if p.lower() not in (o.lower() for o in out):
            out.append(p)
    return " + ".join(out) or name.strip()


def spelling_variants(counts, known=(), min_len=7):
    """Registry keys that differ from another key by one letter in one ingredient ('cetrizine' / 'cetirizine',
    'artemther lumefantrine' / 'artemether lumefantrine') are the same medicine misspelt. Returns
    {variant key: key to use}: a spelling found on the essential lists (known) wins, else the most-registered. Tokens that start with a hyphen
    ('-amlodipine', from 'S-amlodipine') are a different product and never merge."""
    from rapidfuzz.distance import Levenshtein
    keys = sorted(k for k in counts if k)
    parent = {k: k for k in keys}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    by_len = {}
    for k in keys:
        by_len.setdefault(len(k.split()), []).append(k)
    for group in by_len.values():
        for i, a in enumerate(group):
            ta = a.split()
            for b in group[i + 1:]:
                tb = b.split()
                diff = [(x, y) for x, y in zip(ta, tb) if x != y]
                if len(diff) != 1:
                    continue
                x, y = diff[0]
                if min(len(x), len(y)) < min_len or x.startswith("-") or y.startswith("-"):
                    continue
                if Levenshtein.distance(x, y) <= 1:
                    parent[find(a)] = find(b)
    groups = {}
    for k in keys:
        groups.setdefault(find(k), []).append(k)
    out = {}
    for members in groups.values():
        if len(members) > 1:
            best = max(members, key=lambda k: (k in known, counts[k], -len(k), [-ord(c) for c in k]))
            out.update({k: best for k in members if k != best})
    return out


FORMS = [
    ("injection", r"inject|infusion|vial|ampoul|for reconstitution|powder for (solution|inj)"),
    ("tablet", r"tablet|tab\b|caplet|lozenge|dispersible|chewable"),
    ("capsule", r"capsule|softgel|caps\b"),
    ("oral liquid", r"syrup|suspension|oral solution|oral liquid|elixir|drops|emulsion|solution for oral|powder for oral"),
    ("topical", r"cream|ointment|gel|lotion|paste|topical|shampoo|spray|patch|foam"),
    ("eye/ear/nose", r"eye|ophthalm|ear\b|otic|nasal"),
    ("inhalation", r"inhal|aerosol|nebul|respules"),
    ("suppository/pessary", r"suppos|pessar|enema|rectal|vaginal"),
]


def form_of(s):
    s = (s if isinstance(s, str) else "").lower()
    for k, rx in FORMS:
        if re.search(rx, s):
            return k
    return "other"


CO_STOP = (r"\b(limited|ltd|llc|pvt|private|plc|inc|co|company|corporation|corp|gmbh|sa|s a|ag|bv|nv|srl|spa|the|"
           r"tanzania|tz|t|a|e a|ea|east africa|africa|pharma|pharmaceuticals?|pharmaceutical|pharmacy|pharmacies|"
           r"laboratories|laboratory|labs?|healthcare|health|care|industries|industry|enterprises?|trading|"
           r"distributors?|suppliers?|international|intl|group|holdings?|and|ab|kg|lp|sdn|bhd|labo|m s)\b")


def company_key(name):
    """Comparable company key: lower-case, punctuation and legal / generic words removed.
    'J.D. Pharmacy Ltd' and 'J. D. PHARMACY LIMITED' both become 'jd'."""
    s = str(name if isinstance(name, str) else "").lower().replace("&", " and ")
    s = re.sub(r"\(.*?\)", " ", s)                  # (T), (EA), (A)
    s = re.sub(r"\b([a-z])\.\s*(?=[a-z]\b)", r"\1", s)  # J. D. -> JD
    s = re.sub(r"\b([a-z])\s+(?=[a-z]\b)", r"\1", s)    # J D -> JD
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(CO_STOP, " ", s)
    return re.sub(r"\s+", " ", s).strip()
