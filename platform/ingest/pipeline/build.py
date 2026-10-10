#!/usr/bin/env python3
"""Build Tanzania gap scores, the company list and clean registrations from the three source files.

Usage:
  python build.py --registry Registered_Products.xls --nemlit tz_nemlit_ocr.txt --who who_eml_2025.txt --out out/

Re-run on every new registry upload (the admin page queues it as an ingest job; see ../ingest_job.py).

Changes from the first version (see README "Pipeline fixes"):
* essential-list parser: fixed section list, OCR level letters (s, Ss, c, Cc), continuation lines,
  form-only lines ("Oral", "Extended-Release") no longer read as molecules, duplicates keep the widest level;
* hand corrections (corrections.py) for OCR'd names, levels and categories, checked against the top gaps;
* molecule keys keep the salt when the salt is the medicine (sodium chloride, magnesium oxide);
* vaccines and other biologicals, antiseptics and herbal products count as human products;
* WHO list parser reads names on their own line and therapeutic alternatives (was 87 matches);
* stricter fuzzy matching (short names only match exactly);
* companies: one clustering across registrant, LTR and manufacturer names; LTR companies are local.
"""
import argparse
import hashlib
import json
import os
import re

import pandas as pd
from rapidfuzz import fuzz, process

from norm import molecule_key, molecule_parts, form_of
from gap import score_molecule, best_level, SATURATION_CAP
from companies import cluster_names, possible_duplicates
import corrections as C

REQUIRED_COLUMNS = ["Certificate Number", "Brand Name", "Classification", "Generic Name", "Dosage Form",
                    "Registrant", "Registrant Country", "LTR", "Manufacturer", "Manufacturing Country",
                    "Registration Status"]
INACTIVE = {"Cancelled/Withdrawn", "Suspended", "Revoked"}
EXCLUDED_CLASSES = re.compile(r"veterinar", re.I)
# Animal-health products filed under "Biologicals including Vaccines" (or misfiled elsewhere)
VET_TERMS = re.compile(r"newcastle|bursal|gumboro|marek|avian|poultry|fowl|turkey|galli|ruminant|canine|feline|bovine|"
                       r"porcine|ovine|caprine|capri|distemper|erysipelothrix|fluralaner|coryza|lumpy skin|"
                       r"foot.and.mouth|parvovirus|mycoplasma|for (?:cattle|dogs|cats|poultry|animals)", re.I)

DOSE = (r"(Tablets?|Injection|Injectable|Intrathecal|Capsules?|Syrup|Suspension|Powder|Oral|Cream|Ointment|Solution|"
        r"Eye|Ear|Gel|Inhal\w*|Suppositor\w*|Pessar\w*|Lotion|Drops|Infusion|Rectal|Granules|Nasal|Sachet|Patch\w*|"
        r"Spray|Emulsion|Lozenge|Mouth\w*|Dispersible|Chewable|Gas|Vaginal|Paste|Implant|Elixir|Respules|Liquid|"
        r"Cylinder|Concentrate|Shampoo|IV|Vial|Ampoule|Topical|Enema|Sublingual|Transdermal|Dry|Lyophili[sz]ed|Kit)")
LEVEL_TOKEN = r"(A|B|C|D|S|Ss|SS|Cc|CC|s|c)"
NAME = r"([A-Z‘'][A-Za-z\-]+(?:[ ,+/()\-]+[A-Za-z\-]+){0,6}?)"


def _level(tok):
    return {"SS": "S", "CC": "C"}.get(tok.upper(), tok.upper()) if tok else ""


def parse_nemlit(path):
    """Parse the OCR text of the national essential medicines list.
    Returns one row per molecule key: molecule, category, level, key, line."""
    text = open(path, errors="ignore").read().replace("’", "'")
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if "Essential Medicines List 2026 Edition" in l), 0)
    rows, cat, last_section = [], "", 0
    for i, raw in enumerate(lines[start:], start=start + 1):
        ln = raw.strip()
        if not ln:
            continue
        m = re.match(r"^(\d{1,2})(?:\.0|\.)\s+([A-Z].+)$", ln)
        if m and int(m.group(1)) in C.SECTIONS and int(m.group(1)) >= last_section:
            last_section = int(m.group(1))
            cat = C.SECTIONS[last_section]
            continue
        if not cat:
            continue
        m = re.match(r"^" + NAME + r"\s+(?:\(.*?\)\s+)?" + DOSE + r"\b.*$", ln)
        lv = re.search(r"\s" + LEVEL_TOKEN + r"\s*$", ln)
        if m:
            name = m.group(1).strip(" ,+-‘'")
            if re.fullmatch(DOSE + r"(\s.*)?", name, flags=re.I):
                name = ""  # a form-only continuation line, e.g. "Oral Tablets: 667 mg s"
            if name and len(name) > 3 and not name.lower().startswith(("note", "for ", "level ")):
                rows.append({"molecule": name, "category": cat, "level": _level(lv.group(1)) if lv else "", "line": i})
                continue
        # continuation line that carries the level of the molecule above it
        if lv and rows and not rows[-1]["level"] and rows[-1]["line"] >= i - 3:
            rows[-1]["level"] = _level(lv.group(1))
    d = pd.DataFrame(rows)
    d = C.apply_nemlit_corrections(d)
    d["key"] = d.molecule.map(molecule_key)
    d = d[d.key != ""]
    # one row per molecule key, keep the first category and the widest level
    lv = d.groupby("key")["level"].agg(lambda s: best_level(list(s)))
    d = d.drop_duplicates("key").copy()
    d["level"] = d.key.map(lv)
    return d.reset_index(drop=True)


def parse_who(path):
    """Names from the WHO list text: a lower-case name at the start of a line (optionally after '- ' for
    therapeutic alternatives), followed by the formulation column or by nothing."""
    names = set()
    rx = re.compile(r"^\s{0,10}(?:-\s+)?([a-z][a-z\-]+(?:[ ,]+\(?[a-z\-]+\)?){0,4}(?:\s*\+\s*[a-z\-]+(?: \(?[a-z\-]+\)?){0,3})*)\*?\s*(?:\[[a-z]\])?(?:\s{3,}\S.*)?$")
    for ln in open(path, errors="ignore"):
        ln = ln.rstrip("\n")
        m = rx.match(ln)
        if not m:
            continue
        name = m.group(1).strip()
        if name.split()[0] in C.WHO_NOT_NAMES:
            continue
        k = molecule_key(name)
        if k:
            names.add(k)
    return names


def load_registry(path):
    """The registry 'xls' export is an HTML table with a letterhead above the header row."""
    tables = pd.read_html(path, flavor="lxml")
    d = max(tables, key=len)
    hdr = d.index[d.iloc[:, 0].astype(str).str.strip() == "No"][0]
    d.columns = [str(c).strip() for c in d.iloc[hdr]]
    d = d.iloc[hdr + 1:].reset_index(drop=True)
    d = d.rename(columns={"Local Technical Represenatative": "LTR", "Local Technical Representative": "LTR"})
    return d


def validate_registry(reg):
    """Raise ValueError with a readable message if the export does not look like the registry."""
    missing = [c for c in REQUIRED_COLUMNS if c not in reg.columns]
    if missing:
        raise ValueError(f"Missing columns: {', '.join(missing)}")
    if len(reg) < 100:
        raise ValueError(f"Only {len(reg)} rows; expected thousands")
    blank = reg["Certificate Number"].isna().mean()
    if blank > 0.05:
        raise ValueError(f"{blank:.0%} of rows have no certificate number")
    return True


def cert_year(c):
    # dated formats only: "TAN 23 HM 0101", "TZ 19 H 300". Old "TAN 00,050 G01A ..." numbers carry no year.
    m = re.match(r"^\s*(?:TAN|TZ)\s+(\d{2})\s+[A-Z]", str(c or ""))
    if not m:
        return None
    yy = int(m.group(1))
    return 2000 + yy if yy <= 60 else 1900 + yy


def fix_mojibake(v):
    """UTF-8 text that was read as Latin-1 somewhere upstream ('SantÃ©' -> 'Santé'). Left alone if it doesn't fit."""
    if not isinstance(v, str) or not re.search("[ÃÂâ][\x80-\xbf\u0152-\u2122]", v):
        return v
    try:
        return v.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        try:
            return v.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return v


def clean_registry(reg):
    reg = reg.copy()
    for c in reg.columns:
        if reg[c].dtype == object or str(reg[c].dtype).startswith("str"):
            reg[c] = reg[c].map(lambda v: re.sub(r"\s+", " ", fix_mojibake(v)).strip() if isinstance(v, str) else v)
    reg["certificate_no"] = reg["Certificate Number"].str.replace(r"\s+", " ", regex=True).str.strip()
    reg["active"] = ~reg["Registration Status"].isin(INACTIVE)
    vet_text = reg["Generic Name"].fillna("") + " " + reg["Active Pharmaceutical Ingredients"].fillna("")
    reg["human"] = ~reg.Classification.fillna("").str.contains(EXCLUDED_CLASSES) & ~vet_text.str.contains(VET_TERMS)
    reg["key"] = reg["Generic Name"].map(molecule_key)
    reg["form"] = reg["Dosage Form"].map(form_of)
    reg["reg_year"] = reg.certificate_no.map(cert_year)
    return reg


def match_keys(keys, targets, threshold=92, min_len=6):
    """Exact key match, else a fuzzy match for long names only. Returns {key: (target, score)}."""
    tset = set(targets)
    tlist = list(targets)
    out = {}
    for k in keys:
        if k in tset:
            out[k] = (k, 100.0)
            continue
        if len(k) < min_len or not tlist:
            out[k] = (None, 0.0)
            continue
        best, s, _ = process.extractOne(k, tlist, scorer=fuzz.token_sort_ratio)
        out[k] = (best, s) if (s >= threshold and len(best) >= min_len) else (None, s)
    return out


def build(registry, nemlit, who, out, cap=SATURATION_CAP, company_aliases=None, keep_separate=None, manual_matches=None):
    """company_aliases {name or key: cluster_key}, keep_separate {frozenset(key_a, key_b)} and
    manual_matches {essential key: registry key} come from team decisions stored in the database."""
    os.makedirs(out, exist_ok=True)
    reg = clean_registry(load_registry(registry))
    validate_registry(reg)
    fp_cols = ["certificate_no", "Brand Name", "Generic Name", "Dosage Form", "Product Strength",
               "Active Pharmaceutical Ingredients", "Registrant", "LTR", "Manufacturer"]
    reg["fingerprint"] = reg[fp_cols].map(lambda v: "" if pd.isna(v) else str(v)).agg("|".join, axis=1).map(
        lambda s: hashlib.sha1(s.lower().encode()).hexdigest()[:20])
    h_all = reg[reg.human & (reg.key != "")].drop_duplicates("fingerprint").copy()
    h = h_all[h_all.active].copy()

    # ---- companies: one clustering across every role ----
    all_names = pd.concat([h.Registrant, h.LTR, h.Manufacturer]).dropna()
    known = {C.company_alias_key(a): b for a, b in C.COMPANY_ALIASES.items()}
    known.update(company_aliases or {})
    name_to_cluster, display = cluster_names(all_names, known_aliases=known,
                                             keep_separate=set(C.KEEP_SEPARATE) | set(keep_separate or ()))
    h["registrant_cluster"] = h.Registrant.map(name_to_cluster)
    h["ltr_cluster"] = h.LTR.map(name_to_cluster).fillna(h.registrant_cluster)
    h["manufacturer_cluster"] = h.Manufacturer.map(name_to_cluster)

    em = parse_nemlit(nemlit)
    who_set = parse_who(who)

    # ---- molecule-level registry stats ----
    def agg(g):
        return pd.Series({
            "registrations": len(g), "registrants": g.registrant_cluster.nunique(), "ltrs": g.ltr_cluster.nunique(),
            "manufacturers": g.manufacturer_cluster.nunique(),
            "india_pk_bd_share": round(g["Manufacturing Country"].isin(["INDIA", "PAKISTAN", "BANGLADESH"]).mean(), 2),
            "local_made": int((g["Manufacturing Country"] == "TANZANIA").sum()),
            "forms": ", ".join(sorted(g.form.unique())),
            "display": g["Generic Name"].value_counts().index[0]})
    stats = h.groupby("key").apply(agg, include_groups=False).reset_index()

    # ---- essential list -> registry and WHO ----
    mm = match_keys(em.key, stats.key)
    em["reg_key"] = em.key.map(lambda k: mm[k][0])
    em["match_score"] = em.key.map(lambda k: round(mm[k][1], 1))
    matches = {molecule_key(k): molecule_key(t) for k, t in C.MANUAL_MATCHES.items()}
    matches.update(manual_matches or {})
    for k, target in matches.items():  # team-confirmed matches
        if target in set(stats.key):
            em.loc[em.key == k, ["reg_key", "match_score"]] = [target, 100.0]
    wm = match_keys(em.key, sorted(who_set), threshold=94, min_len=7)
    em["in_who"] = em.key.map(lambda k: wm[k][0] is not None) | em.key.isin({molecule_key(x) for x in C.WHO_EXTRA})
    # registered only inside combination products (e.g. calamine in calamine + zinc oxide)
    key_tokens = {k: (set(k.split()), n) for k, n in zip(stats.key, stats.registrations)}
    em["in_combinations"] = em.key.map(lambda k: int(sum(
        n for rk, (t, n) in key_tokens.items() if rk != k and set(k.split()) < t)))

    g = em.merge(stats, left_on="reg_key", right_on="key", how="left", suffixes=("", "_r")).drop(columns=["key_r"])
    for c in ["registrations", "registrants", "ltrs", "manufacturers", "local_made"]:
        g[c] = g[c].fillna(0).astype(int)
    sc = g.apply(lambda r: score_molecule(True, bool(r.in_who), r.level, r.registrants, cap=cap), axis=1)
    g["D"] = sc.map(lambda x: x["D"]); g["S"] = sc.map(lambda x: x["S"]); g["A"] = sc.map(lambda x: x["A"])
    g["gap_score"] = sc.map(lambda x: x["gap_score"])
    donor = r"vaccine|immunolog|antiretro|anti-tuberc|tubercul|malaria|blood|sera|hormones|contracept|antineoplastic|neglected tropical"
    is_donor = g.category.str.lower().str.contains(donor, na=False) | g.molecule.str.lower().str.contains(
        r"vaccine|antitoxin|immunoglobulin|antiretro", na=False)
    g["channel_flag"] = is_donor.map({True: "programme", False: "open market"})
    g["unregistered_essential"] = g.registrations == 0
    excl = {k.lower(): v for k, v in C.NOT_A_SOURCING_GAP.items()}
    g["note"] = g.molecule.str.lower().map(excl).fillna("")
    g["rankable"] = g.note == ""
    g = g.sort_values(["gap_score", "D", "molecule"], ascending=[False, False, True])
    g.drop(columns=["line"]).to_csv(f"{out}/molecules_gap.csv", index=False)

    # ---- every registry molecule (for search), with its WHO flag ----
    wm2 = match_keys(stats.key, sorted(who_set), threshold=94, min_len=7)
    stats["in_who"] = stats.key.map(lambda k: wm2[k][0] is not None)
    stats.to_csv(f"{out}/molecules_registry.csv", index=False)

    # ---- category snapshot (essential-list sections) ----
    cat = g.groupby("category").agg(
        essential_molecules=("molecule", "count"), registered=("registrations", lambda s: int((s > 0).sum())),
        registrations=("registrations", "sum"), avg_saturation=("S", "mean"),
        open_gaps=("S", lambda s: int((s <= 0.25).sum()))).reset_index()
    cat["avg_saturation"] = cat.avg_saturation.round(3)
    cat.to_csv(f"{out}/category_snapshot.csv", index=False)

    # ---- companies ----
    roles = pd.concat([
        h[["registrant_cluster", "Registrant", "Registrant Country", "key"]].rename(
            columns={"registrant_cluster": "cluster", "Registrant": "name", "Registrant Country": "country"}).assign(role="registrant"),
        h[["ltr_cluster", "LTR", "key"]].rename(columns={"ltr_cluster": "cluster", "LTR": "name"}).assign(role="ltr", country="TANZANIA"),
        h[["manufacturer_cluster", "Manufacturer", "Manufacturing Country", "key"]].rename(
            columns={"manufacturer_cluster": "cluster", "Manufacturer": "name", "Manufacturing Country": "country"}).assign(role="manufacturer"),
    ])
    roles = roles[roles.cluster.notna()]
    rows = []
    for cl, grp in roles.groupby("cluster"):
        ltr = h[h.ltr_cluster == cl]
        manu = h[h.manufacturer_cluster == cl]
        as_ltr = grp[grp.role == "ltr"]
        country = "TANZANIA" if len(as_ltr) else (grp.country.dropna().mode().iat[0] if grp.country.notna().any() else "")
        names = sorted(set(grp.name.dropna()))
        rows.append({
            "cluster": cl, "display_name": display.get(cl, names[0] if names else cl), "aliases": " | ".join(names),
            "country": country, "acts_as_ltr": len(as_ltr) > 0, "is_registrant": (grp.role == "registrant").any(),
            "is_manufacturer": (grp.role == "manufacturer").any(),
            "ltr_registrations": len(ltr), "manufactured_registrations": len(manu),
            "total_registrations": int(((h.ltr_cluster == cl) | (h.registrant_cluster == cl) | (h.manufacturer_cluster == cl)).sum()),
            "molecules": grp.key.nunique(), "manufacturers_represented": ltr.manufacturer_cluster.nunique()})
    comp = pd.DataFrame(rows).sort_values(["ltr_registrations", "total_registrations"], ascending=False)
    comp.to_csv(f"{out}/companies.csv", index=False)
    dist = comp[comp.acts_as_ltr | (comp.is_registrant & (comp.country == "TANZANIA"))]
    dist.to_csv(f"{out}/distributors.csv", index=False)
    dups = pd.DataFrame(possible_duplicates(comp.cluster), columns=["cluster_a", "cluster_b", "similarity"])
    dups.to_csv(f"{out}/review_queue_companies.csv", index=False)

    for c in ["registrant_cluster", "ltr_cluster", "manufacturer_cluster"]:
        h_all[c] = h[c].reindex(h_all.index)
    inactive = ~h_all.active
    h_all.loc[inactive, "registrant_cluster"] = h_all.loc[inactive, "Registrant"].map(name_to_cluster)
    h_all.loc[inactive, "manufacturer_cluster"] = h_all.loc[inactive, "Manufacturer"].map(name_to_cluster)
    h_all.loc[inactive, "ltr_cluster"] = h_all.loc[inactive, "LTR"].map(name_to_cluster).fillna(h_all.loc[inactive, "registrant_cluster"])
    keep = ["fingerprint", "active", "certificate_no", "Brand Name", "Generic Name", "Dosage Form", "Product Strength", "Active Pharmaceutical Ingredients",
            "Classification", "Registrant", "Registrant Country", "LTR", "Manufacturer", "Manufacturing Country",
            "Registration Status", "key", "form", "reg_year", "registrant_cluster", "ltr_cluster", "manufacturer_cluster"]
    h_all[keep].to_csv(f"{out}/registrations_clean.csv", index=False)
    em.drop(columns=["line"]).to_csv(f"{out}/nemlit_parsed.csv", index=False)
    review = em[em.reg_key.isna()][["molecule", "category", "level", "key", "match_score", "in_combinations"]]
    review.to_csv(f"{out}/review_queue_unmatched.csv", index=False)
    summary = {"registry_rows": len(reg), "human_active": len(h), "nemlit_molecules": len(em),
               "nemlit_unregistered": int(g.unregistered_essential.sum()), "companies": len(comp),
               "distributor_clusters": len(dist), "ltr_clusters": int(comp.acts_as_ltr.sum()),
               "who_matches": int(em.in_who.sum()), "nemlit_level_blank": int((em.level == "").sum()),
               "possible_duplicate_companies": len(dups), "who_list_names": len(who_set)}
    json.dump(summary, open(f"{out}/summary.json", "w"), indent=1)
    print(json.dumps(summary))
    return summary


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--registry", required=True); a.add_argument("--nemlit", required=True)
    a.add_argument("--who", required=True); a.add_argument("--out", default="out")
    x = a.parse_args()
    build(x.registry, x.nemlit, x.who, x.out)
