"""Nigeria's public data: NAFDAC's Greenbook (the register of approved medicines, vaccines and medical devices) and the
Bureau of Public Procurement's open contracting data (through the Open Contracting Data Registry). Both allow these
reads in robots.txt.

The Greenbook list leaves out the manufacturer: each product page names it and its country, so each manufacturer is
looked up once, on one of its products, and remembered (source_items 'ng_maker')."""
import datetime as dt
import gzip
import io
import json
import re
import time

GREENBOOK = "https://greenbook.nafdac.gov.ng/"
COLS = ["product_name", "ingredient.ingredient_name", "product_category.name", "product_category_id", "ingredient.synonym",
        "NAFDAC", "form.name", "route.name", "strength", "applicant.name", "approval_date", "status"]
MEDICINES, DEVICES = (1, 2), (5,)            # Greenbook categories: drugs, vaccines and biologics; medical devices
MAKERS_PER_RUN = 900                         # product pages a run, to learn new manufacturers (about one a second)
NONE = {"", "na", "n/a", "nil", "none", "-"}


def _page(s, category, start, length=1000):
    p = {"draw": 1, "start": start, "length": length, "search[value]": "", "search[regex]": "false", "search_ingredient": "",
         "order[0][column]": 0, "order[0][dir]": "asc"}
    for i, c in enumerate(COLS):
        p.update({f"columns[{i}][data]": c, f"columns[{i}][name]": c, f"columns[{i}][searchable]": "true",
                  f"columns[{i}][orderable]": "false" if i == 2 else "true",
                  f"columns[{i}][search][value]": str(category) if i == 3 else "", f"columns[{i}][search][regex]": "false"})
    r = s.get(GREENBOOK, params=p, headers={"X-Requested-With": "XMLHttpRequest", "Accept": "application/json"}, timeout=300)
    r.raise_for_status()
    return r.json()


def greenbook(s, categories):
    """Every Greenbook row in these categories."""
    rows = []
    for cat in categories:
        start = 0
        while True:
            d = _page(s, cat, start)
            rows += d.get("data") or []
            start += 1000
            if start >= (d.get("recordsFiltered") or 0) or not d.get("data"):
                break
            time.sleep(1)
    return rows


def makers(s, cur, rows):
    """{manufacturer_id: (name, country)}, learning the ones we have not seen from one of their product pages."""
    import html as htmllib
    known = {int(ref): tuple(json.loads(state)) for ref, state in cur.execute(
        "select ref, state from source_items where source = 'ng_maker' and state is not null").fetchall()}
    todo = {}
    for r in rows:
        mid = r.get("manufacturer_id")
        if mid and mid not in known:
            todo[mid] = r["product_id"]                # a maker's latest product (an older page may be broken)
    for mid, pid in list(todo.items())[:MAKERS_PER_RUN]:
        try:
            page = s.get(f"{GREENBOOK}products/details/{pid}", timeout=60)
        except Exception:                          # one broken product page: try another of the maker's products next run
            time.sleep(1)
            continue
        text = htmllib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", page.text if page.ok else "")))
        name = re.search(r"Manufacturer Name \|[ |]*([^|]+?)\s*\|", text)
        ctry = re.search(r"Manufacturer Country \|[ |]*([^|]+?)\s*\|", text)
        if name:
            known[mid] = (name.group(1).strip(), ctry.group(1).strip() if ctry else None)
            cur.execute("""insert into source_items (source, ref, checked_at, state) values ('ng_maker', %s, now(), %s)
                           on conflict (source, ref) do update set checked_at = now(), state = excluded.state""",
                        (str(mid), json.dumps(known[mid])))
        time.sleep(1)
    return known


def _clean(v):
    v = re.sub(r"\s*\$\s*$", "", str(v or "")).strip().strip('"').strip()       # the register marks some names with '$'
    return None if v.lower() in NONE else v


def _date(v):
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def registry_rows(s, cur):
    """The medicines register in the shape the country loader reads (country_load.apply, collected .json)."""
    from country_load import country_en
    rows = greenbook(s, MEDICINES)
    who = makers(s, cur, rows)
    out = []
    for r in rows:
        exp = _date(r.get("expiry_date"))
        man, ctry = who.get(r.get("manufacturer_id"), (None, None))
        ctry = country_en(ctry) if ctry else None
        applicant = _clean((r.get("applicant") or {}).get("name"))
        ingredient = _clean((r.get("ingredient") or {}).get("ingredient_name"))
        active = r.get("status") == "Active" and not (exp and exp < dt.date.today())
        out.append(dict(certificate_no=_clean(r.get("NAFDAC")), brand=_clean(r.get("product_name")), generic=ingredient,
                        atc=_clean(r.get("atc")), dosage_form=_clean((r.get("form") or {}).get("name")), strength=_clean(r.get("strength")),
                        manufacturer=man, manufacturing_country=ctry, holder=applicant,
                        # the applicant is the Nigerian company holding the approval; for an imported product it is the local agent
                        ltr=applicant if ctry and ctry != "NIGERIA" else None,
                        reg_year=(_date(r.get("approval_date")) or dt.date(1900, 1, 1)).year if r.get("approval_date") else None,
                        status="Registered" if active else "Expired", active=active))
    return out


def device_rows(s, cur):
    """The medical device register in the shape devices.collect reads."""
    from country_load import country_en
    rows = greenbook(s, DEVICES)
    who = makers(s, cur, rows)
    out = []
    for r in rows:
        exp = _date(r.get("expiry_date"))
        man, ctry = who.get(r.get("manufacturer_id"), (None, None))
        applicant = _clean((r.get("applicant") or {}).get("name"))
        approved = _date(r.get("approval_date"))
        out.append(dict(ref=str(r.get("product_id")), certificate_no=_clean(r.get("NAFDAC")), brand=_clean(r.get("product_name")) or "",
                        description=_clean(r.get("product_description")) or _clean(r.get("composition")), intended_use=None,
                        risk_class=None, manufacturer=man, manufacturing_country=(country_en(ctry) or "").title() or None,
                        holder=applicant, ltr=applicant, reg_year=approved.year if approved else None, expires=exp,
                        active=r.get("status") == "Active" and not (exp and exp < dt.date.today())))
    return [r for r in out if r["brand"]]


# ------------------------------------------------------------------ public tenders
OCDR = "https://data.open-contracting.org/en/publication/64/download?name={year}.jsonl.gz"
# plans name a project, not items: medicines for people, not a drug-law agency, a building or animal health
PLANNED = re.compile(r"\bdrugs?\b|\bmedicines\b|pharmac|vaccin|antiretrovir|antimalari|medical supplies|medical consumables", re.I)
NOT_MEDICINES = re.compile(r"non[- ]?pharm|animal|veterinar|livestock|drug law|ndlea|weapon|security|construct|building|renovat|"
                           r"rehabilitat|development of|furnish|vehicle|installation|pharmacology", re.I)


def tenders(s, src):
    """Federal procurement plans and tenders for medicines (BPP's NOCOPO, compiled yearly by the Open Contracting Data
    Registry). Most records are plans: the project, the buyer and the budget."""
    from collect import _ocds, day
    out, year = [], dt.date.today().year
    for y in (year, year - 1):
        r = s.get(OCDR.format(year=y), timeout=600)
        if r.status_code != 200:
            continue
        for line in gzip.open(io.BytesIO(r.content), "rt", encoding="utf-8"):
            rel = json.loads(line)
            if "TEST MINISTRY" in str((rel.get("buyer") or {}).get("name", "")).upper():
                continue
            if rel.get("tender"):
                t = _ocds(rel, "NG", "ng_nocopo", "http://nocopo.bpp.gov.ng")
                if t and not NOT_MEDICINES.search(t["title"]):
                    out.append(t)
                continue
            budget = (rel.get("planning") or {}).get("budget") or {}
            title = budget.get("project") or budget.get("description") or ""
            if not PLANNED.search(title) or NOT_MEDICINES.search(title):
                continue
            steps = (rel.get("planning") or {}).get("milestones") or []
            amount = (budget.get("amount") or {})
            out.append(dict(country="NG", source="ng_nocopo", ref=rel.get("ocid") or rel.get("id"), title=title,
                            text=budget.get("description") or "", buyer=(rel.get("buyer") or {}).get("name"),
                            stage="open" if any(m.get("status") != "met" for m in steps) else "closed",
                            published=day(rel.get("date")), closing=None, awarded=None, value=amount.get("amount"),
                            currency=amount.get("currency"), quantity=None, unit_price=None, bidders=None,
                            url="http://nocopo.bpp.gov.ng"))
    return out
