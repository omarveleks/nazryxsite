"""Hand corrections for the OCR'd national essential medicines list and for matching.

Every entry here was checked by reading the OCR text next to the registry (see README, "Pipeline fixes").
Add to these tables rather than special-casing code. The admin review queue writes team decisions to the
database (molecule_aliases / company_aliases); this file holds the corrections that ship with the code.
"""
import re
from norm import company_key

# Top-level sections of the 2026 list. Fixed so OCR noise cannot invent or rename a category.
SECTIONS = {
    1: "Anaesthetics, Preoperative Medicines and Medical Gases",
    2: "Medicines for Pain and Palliative Care",
    3: "Anti-allergies and Medicines Used in Anaphylaxis",
    4: "Antidotes and Other Substances Used in Poisonings",
    5: "Anticonvulsants and Antiepileptics",
    6: "Anti-infective Medicines",
    7: "Antimigraine Medicines",
    8: "Antineoplastics, Immunosuppressives and Immunomodulators",
    9: "Hormones and Antihormones",
    10: "Anti-Parkinsonism and Anti-prolactinoma Medicines",
    11: "Medicines Affecting the Blood",
    12: "Blood Products of Human Origin and Plasma Substitutes",
    13: "Cardiovascular Medicines",
    14: "Dermatological Medicines",
    15: "Gastro-intestinal Medicines",
    16: "Medicines for Diabetes and Related Disorders",
    17: "Immunological Agents",
    18: "Muscle Relaxants and Cholinesterase Inhibitors",
    19: "Ophthalmological Preparations",
    20: "Oxytocics and Anti-oxytocics",
    21: "Dialysis Solutions and Related Medicines",
    22: "Psychotherapeutic and Related Medicines",
    23: "Medicines Acting on the Respiratory Tract",
    24: "Solutions Correcting Water, Electrolyte and Acid-Base Disturbances",
    25: "Vitamins and Minerals",
    26: "Phosphate Binders",
    27: "Ear, Nose and Throat Medicines",
    28: "Disinfectants and Antiseptics",
    29: "Notifiable and Neglected Tropical Diseases",
    30: "Medicines for Neonates",
    31: "Therapeutic Foods",
    32: "Other Medicines for Mothers",
    33: "Digestive and Pancreatic Enzymes",
    34: "Bisphosphonates",
}

# OCR misreads and duplicated words in molecule names: regex -> replacement (applied in order).
NAME_FIXES = [
    (r"^(.+?) \1$", r"\1"),                       # "Clotrimazole Clotrimazole", "Tetanus Vaccine Tetanus Vaccine"
    (r"\bZine\b", "Zinc"),
    (r"\blodide\b", "Iodide"), (r"\blodine\b", "Iodine"),
    (r"\bbicarbonats\b", "bicarbonate"),
    (r"\bEuphobia\b", "Euphorbia"),
    (r"\btartarate\b", "tartrate"),
    (r"\blsophane\b", "Isophane"),
    (r"^Ant (?=[a-z])", "Anti-"),
    (r"^Calcium disodium EDTA \(ethylene diamine$", "Calcium disodium EDTA"),
    (r"^Fludarabine lyophilized powder for$", "Fludarabine"),
    (r"^Darbepoetin alfa Vials \(Solution for$", "Darbepoetin alfa"),
    (r"^‘?Amoxicillin \+ Clavulanic acid.*$", "Amoxicillin + Clavulanic acid"),
    (r"^moxicillin \+ Clavulanic aci.*$", "Amoxicillin + Clavulanic acid"),
    (r"^Nifedipine Slow-release$", "Nifedipine"),
    (r"^Nystatin oral$", "Nystatin"),
    (r"^Retinol \(Vitamin A\) Capsule Gelatin$", "Retinol"),
]

# Lines the parser reads as molecules that are not molecules (form-only lines, class names, headings).
DROP = {
    "Extended-Release", "Oral", "Anti-Haemorrhoids", "Injection", "Tablets", "Tablet", "Powder", "Solution",
    "Biphasic human insulin regular NPH", "Multivitamin + Carotenoids", "Multivitamin + Minerals",
}

# Facility level fixes: level letters the OCR lost or misread. Checked against the OCR line by hand.
# Level C/S are often read as lower-case "c"/"s" (handled in the parser); these are the rest.
LEVEL_FIXES = {
    "Isoflurane": "B",
    "Oxygen": "B",
    "Azithromycin": "B",
    "Ceftriaxone": "B",
    "Cefixime": "S",
    "Dapsone": "S",
    "Cefazolin": "B",
    "Lidocaine": "A",
    "Calcium Carbonate": "B",
    "Calcium Acetate": "S",
    "Ferrous salts": "A",
    "Insulin lispro": "D",
    "Insulin Aspart": "D",
}

# Category fixes where the OCR page order put a molecule under the wrong section.
CATEGORY_FIXES = {
    "Fludrocortisone": "Hormones and Antihormones",
    "Phenoxybenzamine": "Cardiovascular Medicines",
}

# Essential-list molecule -> registry generic name, confirmed by hand (different INN spelling or salt).
MANUAL_MATCHES = {
    "Ferrous salts": "Ferrous Sulphate",
    "Ferrous salt + folic acid": "Ferrous Sulphate + Folic Acid",
    "Benzhexol": "Trihexyphenidyl",
    "Unfractionated Heparin": "Heparin",
    "Low molecular Weight Heparin": "Enoxaparin",
    "Regular insulin": "Human Insulin",
    "Methyl cobalamin": "Mecobalamin",
    "Sodium bicarbonate": "Sodium Bicarbonate",
    "Calamine": "Calamine + Zinc Oxide",                       # Calamine Lotion BP contains zinc oxide
    "Magnesium trisilicate": "Magnesium Trisilicate + Aluminium Hydroxide",  # listed as the compound tablet
    "Hepatitis B Vaccine": "Hepatitis B virus",                # vaccines are registered by antigen name
    "L-Ornithine L-Aspartate": "LOrnithine LAspartate IH",     # registry drops the hyphens
    "Euphorbia prostrata extract": "Euphorbia prostrata",
    "Pneumococcal polysaccharide vaccine": "Pneumococcal polysaccharide Serotype",
}

# Essential-list molecules that are not sourcing gaps: medical gases made locally and preparations the list
# says to prepare from raw materials. They stay on the list (coverage) but are left out of whitespace ranking.
NOT_A_SOURCING_GAP = {
    "Oxygen": "Medical gas, supplied locally",
    "Sucrose solution": "Prepared locally",
    "Coal tar": "Prepared from raw materials",
    "Salicylic acid": "Prepared from raw materials",
    "Cresol saponated solution": "Prepared locally",
    "Formaldehyde": "Prepared locally",
}

# Molecules confirmed on the WHO list that the text parse misses (multi-line names in the PDF text).
WHO_EXTRA = {
    "Ferrous salts", "Ferrous salt + folic acid", "Charcoal, activated", "Amoxicillin + Clavulanic acid",
    "Sulfamethoxazole + Trimethoprim", "Rifampicin + Isoniazid", "Rifampicin + Isoniazid + Pyrazinamide",
    "Rifampicin + Isoniazid + Pyrazinamide + Ethambutol", "Lidocaine + epinephrine", "Oral Rehydration Salts",
    "Diphtheria antitoxin", "BCG Vaccine", "Hepatitis B Vaccine", "Measles-Rubella Vaccine", "Tetanus Vaccine",
    "Insulin human", "Isophane insulin",
}

# Words that start WHO list lines but are not medicine names.
WHO_NOT_NAMES = {
    "therapeutic", "complementary", "core", "page", "who", "list", "and", "or", "for", "with", "in", "the",
    "injection", "tablet", "oral", "solid", "powder", "capsule", "inhalation", "topical", "eye", "solution",
    "suppository", "dental", "concentrate", "cream", "ointment", "gel", "lotion", "vial", "ampoule", "note",
    "medicines", "a", "an", "as", "see", "used", "equivalent", "each", "this", "only", "use", "including",
    "applies", "where", "pending", "when", "children", "age", "lozenge", "granules", "suspension", "liquid",
}

# Company name -> cluster key, for spellings the fuzzy match cannot tie together.
COMPANY_ALIASES = {
}

# Company keys that look alike but are different companies (never merge).
KEEP_SEPARATE = set()


def company_alias_key(name):
    return company_key(name) or name


def apply_nemlit_corrections(d):
    d = d.copy()
    for rx, rep in NAME_FIXES:
        d["molecule"] = d.molecule.str.replace(rx, rep, regex=True)
    d["molecule"] = d.molecule.str.strip(" ,+-")
    d = d[~d.molecule.isin(DROP)]
    for name, lv in LEVEL_FIXES.items():
        d.loc[(d.molecule.str.lower() == name.lower()) & (d.level == ""), "level"] = lv
    for name, cat in CATEGORY_FIXES.items():
        d.loc[d.molecule.str.lower() == name.lower(), "category"] = cat
    return d
