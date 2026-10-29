"""Registers of the later markets, read into the one registry shape (country_load.FIELDS):
  GH  Ghana's FDA public product registry (a DataTables JSON endpoint behind verifypermit.fdaghana.gov.gh),
  AZ  Azerbaijan's state register of medicines, published as CSV on the government open-data portal,
  BY  Belarus's state register at the Center for Expertise and Testing (rceth.by), 100 rows a page,
  AM  Armenia's database of registered medicines at the Scientific Centre (pharm.cals.am), one text answer.
Ethiopia's eRIS needs a login and Uganda's register sits behind a bot challenge: no reader, those markets stay thin.
Each site is read once a week, one request a second."""
import csv
import datetime as dt
import functools
import io
import os
import re
import time

import requests

TODAY = dt.date.today()
PAUSE = 1.0
UA = {"User-Agent": "Mozilla/5.0 (compatible; NazryxBot/1.0; +https://nazryx.com)"}


def _date(v, fmts=("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y")):
    v = (v or "").strip()[:10]
    for f in fmts:
        try:
            return dt.datetime.strptime(v, f).date()
        except ValueError:
            pass
    return None


def _clean(v):
    v = re.sub(r"\s+", " ", str(v or "").replace("\x00", " ")).strip(" -—,.;")
    return v or None


PHARMACOPOEIA = re.compile(r"\b(?:B\.?P\.?|U\.?S\.?P\.?|I\.?P\.?|Ph\.?\s*Eur\.?|E\.?P\.?|J\.?P\.?|N\.?F\.?)\b\.?", re.I)


def gh_generic(v):
    """'Sodium Citrate Dihydrate B.P. Diphenhydramine Hydrochloride B.P.' -> 'sodium citrate dihydrate + diphenhydramine hydrochloride'."""
    v = PHARMACOPOEIA.sub(" / ", str(v or ""))
    v = re.sub(r"\(.*?\)|\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|%)[^/,+&]*", " ", v, flags=re.I)
    parts = [re.sub(r"\s+", " ", p).strip(" .,-").lower() for p in re.split(r"\s*(?:/|,|\+|&| and )\s*", v)]
    parts = [p for p in parts if len(p) > 2 and not re.fullmatch(r"[\d\s.]+", p)]
    seen, out = set(), []
    for p in parts:
        if p not in seen:
            seen.add(p); out.append(p)
    return " + ".join(out[:5]) or None


# ------------------------------------------------------------------ Ghana
GH = "https://verifypermit.fdaghana.gov.gh/publicsearch"
GH_PARAMS = {"draw": 1, "start": 0, "length": -1, "search[value]": "",
             "columns[0][data]": "DT_RowIndex", "columns[1][data]": "client_name", "columns[1][name]": "tbl_client_details.client_name",
             "columns[2][data]": "product_name", "columns[3][data]": "product_category", "columns[3][search][value]": "Drug",
             "columns[4][data]": "expiry_date", "columns[5][data]": "status", "columns[5][name]": "tbl_products_details.status",
             "columns[6][data]": "action"}
VET = re.compile(r"^(POM-V|VMG[A-Z]?|VET)", re.I)


def gh_rows(payload):
    """Human medicines from the registry's JSON: drugs, not veterinary classes, not the food and cosmetics the same registry holds."""
    out = []
    for r in payload.get("data", []):
        cat = (r.get("product_category") or "")
        if not cat.lower().startswith("drug"):
            continue
        if VET.match(r.get("classification") or ""):
            continue
        out.append(gh_row(r))
    return out


def gh_row(r):
    exp = _date(r.get("expiry_date"))
    got = _date(r.get("registration_date"))
    status = (r.get("status") or "").lower()
    active = exp is None or exp >= TODAY
    if "expired" in status or "suspend" in status or "cancel" in status:
        active = False
    maker = _clean((r.get("manufacturer") or "").split(",")[0])
    agent = _clean((r.get("representative_company_local_agent_applicant") or r.get("client_name") or "").split(",")[0])
    generic = gh_generic(r.get("generic_name")) or gh_generic_from_name(r.get("product_name"), catalogue_names())
    form = _clean(r.get("dosage_form_indication"))
    if form and (form.lower() == (r.get("generic_name") or "").strip().lower() or (generic and form.lower() == generic)):
        form = None
    return dict(certificate_no=_clean(r.get("registration_number")) or _clean(r.get("product_id")), brand=_clean(r.get("product_name")),
                generic=generic, atc=None, dosage_form=form, strength=_clean(r.get("strength")), manufacturer=maker,
                manufacturing_country=_clean(r.get("country_origin")), holder=agent, ltr=agent, reg_year=got.year if got else None,
                status="Registered" if active else "Expired", active=active)


GH_FORMS = re.compile(r"\b(?:tablets?|tabs?|caplets?|capsules?|caps?|injection|injections|inj|syrup|suspension|solution|oral|cream|gel|ointment|lotion|"
                      r"drops?|inhaler|inhalation|powder|infusion|sachets?|lozenges?|spray|eye|ear|nasal|vaginal|rectal|pessar(?:y|ies)|suppositor(?:y|ies)|"
                      r"ophthalmic|opthalmic|dispersible|effervescent|chewable|soluble|film[- ]coated|coated|sr|xr|er|mr|cr|la|forte|plus|iv|im|bp|usp|ip|ep|"
                      r"for|in|with|and|kit|vial|vials|ampoules?|amps?|bottle|strip|blister|pack|co|dt)\b", re.I)
GH_STRENGTH = re.compile(r"\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|ml|iu|%|w/w|w/v|v/v)*(?:\s*/\s*(?:\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ml|g|iu|%|w/w|w/v|v/v)*|(?:mg|mcg|µg|ml|g|iu|%)))*", re.I)
GH_SALTS = re.compile(r"\b(?:hydrochloride|hcl|dihydrochloride|hydrobromide|sodium|disodium|potassium|calcium|magnesium|besylate|besilate|maleate|mesylate|"
                      r"fumarate|succinate|tartrate|citrate|hyclate|monohydrate|dihydrate|trihydrate|anhydrous|acetate|phosphate|sulfate|sulphate|"
                      r"propionate|dipropionate|valerate|xinafoate|diethylamine|base)\b", re.I)


@functools.lru_cache(maxsize=1)
def catalogue_names():
    """Lower-case names of the medicines catalogue shipped with the worker: the only generics a brand name is allowed to become."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog", "medicines.csv")
    with open(path, encoding="utf-8") as f:
        return frozenset(r["name"].strip().lower() for r in csv.DictReader(f) if r.get("name"))


def gh_generic_from_name(name, known):
    """The generic for a product the registry lists without one: the INN in brackets after the brand
    ('TAZY 250 TABLETS ( Azithromycin 250mg)' -> 'azithromycin'), or a product named after its molecules
    ('ATORVASTATIN 20 TABLETS', 'AMLODIPINE/ TELMISARTAN TABLETS'). A brand that is not a catalogue molecule stays nameless."""
    name = str(name or "")
    m = re.search(r"\(([^()]{4,})\)", name)
    if m:
        g = gh_generic(GH_STRENGTH.sub(" ", m.group(1)))
        parts = [re.sub(r"\s+", " ", GH_SALTS.sub(" ", p)).strip() for p in (g or "").split(" + ") if p]
        if parts and all(p in known for p in parts):
            return " + ".join(dict.fromkeys(parts))
    base = GH_STRENGTH.sub(" ", re.sub(r"\(.*?\)", " ", name))
    base = GH_FORMS.sub(" ", GH_SALTS.sub(" ", base))
    parts = [re.sub(r"[^a-z ]+", " ", p.lower()).strip() for p in re.split(r"\s*(?:/|\+|&)\s*", base)]
    parts = [re.sub(r"\s+", " ", p) for p in parts if p.strip()]
    if 1 <= len(parts) <= 4 and all(p in known for p in parts):
        return " + ".join(dict.fromkeys(parts))
    return None


def gh_registry(s, log=None):
    hdr = {**UA, "X-Requested-With": "XMLHttpRequest", "Accept": "application/json"}
    try:
        r = s.get(GH, params=GH_PARAMS, headers=hdr, timeout=600)
    except requests.exceptions.SSLError as e:
        if "certificate has expired" not in str(e):
            raise
        # the FDA lets its 90-day certificate lapse now and then; the register is public data, so read on and say so
        if log:
            log.warning("fdaghana: the site's TLS certificate has expired; read without verification until the FDA renews it")
        r = s.get(GH, params=GH_PARAMS, headers=hdr, timeout=600, verify=False)
    r.raise_for_status()
    rows = gh_rows(r.json())
    if log:
        log.info("fdaghana: %d human medicines, %d active", len(rows), sum(x["active"] for x in rows))
    return rows


# ------------------------------------------------------------------ Azerbaijan
AZ_CSV = ("https://admin.opendata.az/dataset/5502efca-092b-4d5a-99bd-4b1ea316ed85/resource/7e57bfd3-953b-455a-9022-3345fb7426b7/"
          "download/derman_vasitelerinin_dovlet_reyestri.csv")
DOSE = re.compile(r"\s*[-–]\s*[\d.,]+\s*(?:mg|mcg|µg|g|ml|IU|ME|%|mq|ТЕ)[^;+]*", re.I)


def az_generic(bpa):
    """'Ibuprofen - 200 mg/5 ml' -> 'ibuprofen'; 'Amoxicillin - 500 mg; Clavulanic acid - 125 mg' -> 'amoxicillin + clavulanic acid'."""
    parts = []
    for p in re.split(r"[;\n]+", str(bpa or "")):
        p = DOSE.sub("", p)
        p = re.sub(r"\(.*?\)|\b(?:milled|micronized|trihydrate|sodium|potassium|hydrochloride|dihydrate|monohydrate)\b", " ", p, flags=re.I)
        p = re.sub(r"[^A-Za-z+ ]+", " ", p)
        p = re.sub(r"\s+", " ", p).strip().lower()
        if p and p not in parts and len(p) > 2:
            parts.append(p)
    return " + ".join(parts[:4]) or None


def az_rows(text):
    rdr = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    rdr.fieldnames = [f.strip() for f in rdr.fieldnames]
    out = []
    for r in rdr:
        r = {k.strip(): (v or "") for k, v in r.items() if k}
        name = _clean(r.get("Dərmanın adı"))
        if not name:
            continue
        exp = _date(r.get("Qeydiyyat müddətinin bitmə tarixi"))
        got = _date(r.get("Qeydiyyat vəsiqəsinin verilmə tarixi"))
        maker_raw = r.get("İstehsalçı firma") or ""
        maker, country = maker_raw.split(",")[0], None
        m = re.search(r",\s*([^,;]+?)\s*(?:;|$)", maker_raw.replace("\n", " "))
        if m:
            country = _clean(m.group(1))
        active = exp is None or exp >= TODAY
        out.append(dict(certificate_no=_clean(r.get("Qeydiyyat vəsiqəsinin nömrəsi")), brand=name, generic=az_generic(r.get("BPA")),
                        atc=_clean((r.get("ATC") or "").split(";")[0]), dosage_form=_clean((r.get("Buraxılış forması və qablaşdırma") or "").split(",")[0]),
                        strength=_clean(DOSE.search(r.get("BPA") or "") and DOSE.search(r.get("BPA") or "").group(0).strip(" -–")),
                        manufacturer=_clean(maker), manufacturing_country=country, holder=_clean(r.get("Ərizəçi firma")), ltr=None,
                        reg_year=got.year if got else None, status="Registered" if active else "Expired", active=active,
                        product_type=_clean(r.get("Dərmanın tipi"))))
    return out


def az_registry(s, log=None):
    r = s.get(AZ_CSV, headers=UA, timeout=600)
    r.raise_for_status()
    rows = az_rows(r.content.decode("utf-8", "replace"))
    if log:
        log.info("opendata.az: %d medicines, %d active", len(rows), sum(x["active"] for x in rows))
    return rows


# ------------------------------------------------------------------ Belarus
BY = "https://www.rceth.by/Refbank/reestr_lekarstvennih_sredstv/results"


def by_form(page, size=100):
    return [("IsPostBack", "true"), ("FProps[0].IsText", "True"), ("FProps[0].Name", "N_LP"), ("FProps[0].CritElems[0].Num", "1"),
            ("FProps[0].CritElems[0].Val", "а"), ("FProps[0].CritElems[0].Crit", "0"), ("FOpt.PageC", str(size)), ("FOpt.PageN", str(page))]


def by_count(html):
    text = re.sub(r"<[^>]+>", " ", html).replace("&nbsp;", " ")
    m = re.search(r"Найдено\s*(\d+)\s*записей\s*-\s*(\d+)\s*страниц", text)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def by_rows(html):
    """(n, trade name, INN, forms, manufacturer, holder, certificate, registered, valid until, EAEU date) rows."""
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"</td>\s*$", "", c) for c in re.split(r"<td[^>]*>", tr)[1:]]      # a cell can go unclosed
        if len(cells) != 10:
            continue
        txt = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).replace("&nbsp;", " ").replace("&#171;", "«").replace("&#187;", "»").strip() for c in cells]
        txt[1] = re.sub(r"\s*инструкция (?:пациента|специалиста)", "", txt[1]).strip()
        if txt[3].lower().startswith("субстанция"):
            continue                                   # pharmaceutical substances are registered too; they are not products on a shelf
        out.append(by_row(txt))
    return out


def by_row(c):
    _, brand, inn, forms, maker, holder, cert, got, until, _eaeu = c
    exp = None if "бессрочно" in until.lower() else _date(until)
    active = exp is None or exp >= TODAY
    man, country = maker, None
    m = re.match(r"^(.*?),\s*([^,]+)$", maker)
    if m and len(m.group(2)) < 40:
        man, country = m.group(1), m.group(2)
    g = _date(got)
    return dict(certificate_no=_clean(cert), brand=_clean(brand), generic=_clean(inn) and _clean(inn).lower(), atc=None,
                dosage_form=_clean(forms.split(",")[0]) if forms else None, strength=None, manufacturer=_clean(man),
                manufacturing_country=_clean(country), holder=_clean(holder), ltr=None, reg_year=g.year if g else None,
                status="Registered" if active else "Expired", active=active)


def by_registry(s, log=None):
    first = s.post(BY, data=by_form(1), headers=UA, timeout=300)
    first.raise_for_status()
    total, pages = by_count(first.text)
    rows = by_rows(first.text)
    for page in range(2, pages + 1):
        time.sleep(PAUSE)
        r = s.post(BY, data=by_form(page), headers=UA, timeout=300)
        if r.status_code != 200:
            if log:
                log.warning("rceth.by page %s: HTTP %s", page, r.status_code)
            continue
        rows += by_rows(r.text)
    seen, out = set(), []
    for x in rows:
        if x["certificate_no"] and x["certificate_no"] in seen:
            continue
        seen.add(x["certificate_no"])
        out.append(x)
    if log:
        log.info("rceth.by: %d of %d records read, %d active", len(out), total, sum(x["active"] for x in out))
    return out


# ------------------------------------------------------------------ Armenia
AM = "http://pharm.cals.am/pharm/drug_images/drug_search_view.php"


def am_rows(text):
    """Records separated by **** and fields by #$: trade name, INN, form, strength and pack, country, manufacturer, six Armenian
    copies, registration number, status, registered, ..., ATC and type, GMP standard, ..., valid until."""
    out = []
    for rec in text.replace("\x00", " ").split("****"):
        f = [x.strip() for x in rec.split("#$")]
        if len(f) < 15 or not f[0]:
            continue
        status = f[13]
        exp = _date(f[-1]) or _date(f[-2])
        active = status.lower().startswith("regist") and (exp is None or exp >= TODAY)
        got = _date(f[14])
        atc = (re.match(r"[A-Z]\d{2}[A-Z]{2}\d{2}", f[21]) if len(f) > 21 else None)
        out.append(dict(certificate_no=_clean(f[12]), brand=_clean(f[0]), generic=_clean(re.sub(r"\(.*?\)", "", f[1])) and re.sub(r"\(.*?\)", "", f[1]).strip().lower(),
                        atc=atc.group(0) if atc else None, dosage_form=_clean(f[2]), strength=_clean(f[3].split(";")[0]),
                        manufacturer=_clean(f[5].split(",")[0]), manufacturing_country=_clean(f[4]), holder=None, ltr=None,
                        reg_year=got.year if got else None, status="Registered" if active else "Expired", active=active))
    return out


def am_registry(s, log=None):
    r = s.get(AM, params={"search_text": "a", "search_in": 1, "lgg": "eng"}, headers=UA, timeout=600)
    r.raise_for_status()
    rows = am_rows(r.content.decode("utf-8", "replace"))
    if log:
        log.info("pharm.cals.am: %d medicines, %d active", len(rows), sum(x["active"] for x in rows))
    return rows
