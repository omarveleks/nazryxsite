"""Collects public data for the five markets by itself, on a schedule (data_sources): registries, medicine tenders and
regulated prices. Registries go through the same upload jobs as a file the team uploads, so matching, history and
alerts are unchanged. A pull much smaller than what is loaded is held for the team instead of applied.

Sources and why they were chosen: reports/Pharma data sources to automate.md (kept out of git).
"""
import csv
import datetime as dt
import html
import json
import logging
import os
import re
import tempfile

import requests

import storage

log = logging.getLogger("collect")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 NazryxCollector/1.0"}
HOLD_RATIO = 0.9          # a registry pull under 90% of the active products loaded waits for the team
TIMEOUT = 120
HERE = os.path.dirname(os.path.abspath(__file__))


def session():
    """Polite by default: retries with growing pauses when a site says it is busy (429) or fails (5xx)."""
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry
    s = requests.Session()
    s.headers.update(UA)
    s.mount("https://", HTTPAdapter(max_retries=Retry(total=5, backoff_factor=10, status_forcelist=[429, 500, 502, 503, 504],
                                                      allowed_methods=None, respect_retry_after_header=True)))
    return s


def ca_bundle():
    """Public CAs plus the intermediate one server (fms.ecc.kz) leaves out of its chain. Verification stays on."""
    import certifi
    parts = [certifi.where(), os.path.join(HERE, "certs", "gogetssl-rsa-dv-ca2.pem"), os.environ.get("REQUESTS_CA_BUNDLE") or ""]
    path = os.path.join(tempfile.gettempdir(), "nazryx-ca.pem")
    with open(path, "w") as out:
        for p in parts:
            if p and os.path.exists(p):
                out.write(open(p).read() + "\n")
    return path


def num(v):
    try:
        t = re.sub(r",(?=\d{3}(\D|$))", "", str(v).replace("\xa0", "").replace(" ", ""))   # 91,000 -> 91000; 2,5 -> 2.5
        return float(t.replace(",", ".")) if v not in (None, "") else None
    except ValueError:
        return None


# ------------------------------------------------------------------ registries: each returns (file path, active products)
def reg_KZ(s, tmp):
    import country_load
    path = os.path.join(tmp, "kz-register.xlsx")
    r = s.post("https://register.ndda.kz/register/api/v1/Excel/GetExcelReportByFilter", json={}, timeout=600)
    r.raise_for_status()
    open(path, "wb").write(r.content)
    return path, sum(x["active"] for x in country_load.read_kz(path))


def reg_KE(s, tmp):
    import country_load
    page = "https://products.pharmacyboardkenya.org/ppb_admin/pages/public_view_retention_products.php"
    form = dict(re.findall(r'class="xcrud-data" name="(\w+)" value="([^"]*)"', s.get(page, timeout=TIMEOUT).text))
    form.update(start=0, limit=20000)
    r = s.post("https://products.pharmacyboardkenya.org/ppb_admin/xcrud/xcrud_ajax.php",
               data={f"xcrud[{k}]": v for k, v in form.items()}, timeout=600)
    r.raise_for_status()
    path = os.path.join(tmp, "ke-register.html")
    open(path, "w", encoding="utf-8").write(r.text)
    return path, sum(x["active"] for x in country_load.read_ke(path))


def _json_rows(rows, tmp, name):
    path = os.path.join(tmp, name)
    json.dump(rows, open(path, "w", encoding="utf-8"), ensure_ascii=False)
    return path, sum(bool(r["active"]) for r in rows)


def reg_UZ(s, tmp):
    """The Pharmaceutical Agency catalogue: one row per pack; one product per certificate, name, form and strength."""
    from country_load import country_en
    out, page = {}, 0
    while True:
        d = s.get("https://api.pharmagency.uz/drug-catalog-api/v1/drugs/search", params={"page": page, "size": 1000}, timeout=TIMEOUT).json()
        for x in d.get("content", []):
            key = (x.get("registrationCode"), x.get("shortName"), x.get("dosageForm"), x.get("strength"))
            if key[0] and key not in out:
                out[key] = dict(certificate_no=x["registrationCode"], brand=(x.get("shortName") or "").title(), generic=x.get("mnn"),
                                atc=x.get("atxCode"), dosage_form=x.get("dosageForm"), strength=x.get("strength"),
                                manufacturer=x.get("manufacturer"), manufacturing_country=country_en(x.get("country")),
                                holder=None, ltr=None, reg_year=None, status="Registered", active=True)
        if d.get("last", True):
            break
        page += 1
    return _json_rows(list(out.values()), tmp, "uz-register.json")


def reg_KG(s, tmp):
    from country_load import split_country, year_of
    out, skip = [], 0
    while True:
        d = s.post("https://ndb.med.kg/api/drug/getregistrydrugeditlistpaged",
                   json={"loadOptions": {"skip": skip, "take": 1000, "requireTotalCount": True}, "ownDrugsOnly": False}, timeout=TIMEOUT).json()
        d = d.get("actionResult") or d
        for x in d.get("data", []):
            man, ctry = split_country(x.get("manufacturerCompany"))
            status = x.get("status") or ""
            lic = x.get("licenseNumber") or ""
            out.append(dict(certificate_no=lic, brand=x.get("brandName"), generic=x.get("inn"), atc=None, dosage_form=x.get("drugForm"),
                            strength=None, manufacturer=man, manufacturing_country=ctry, holder=None, ltr=None,
                            reg_year=year_of((re.findall(r"(?:19|20)\d{2}", lic) or [""])[-1]), status=status,
                            active=status.lower().startswith(("действ", "activ"))))
        skip += 1000
        if skip >= d.get("totalCount", 0) or not d.get("data"):
            break
    return _json_rows(out, tmp, "kg-register.json")


TZ_COLS = [("Certificate Number", "certificate_no"), ("Brand Name", "brand_name"), ("Classification", "classification_name"),
           ("Generic Name", "generic_name"), ("Active Pharmaceutical Ingredients", "active_ingredient"), ("Product Strength", "product_strength"),
           ("Dosage Form", "dosage_form"), ("Registrant", "registrant"), ("Registrant Country", "registrant_country"),
           ("LTR", "localtechnical_representative"), ("Manufacturer", "manufacturer"), ("Manufacturing Country", "manufacturer_country"),
           ("Registration Status", "registration_status")]


def reg_TZ(s, tmp):
    """TMDA's public list, written as the same table as TMDA's own export so the Tanzania pipeline reads it unchanged."""
    url = "https://imis2.tmda.go.tz/publicaccess/onSearchPublicRegisteredproducts"
    rows, skip = [], 0
    while True:
        d = s.get(url, params={"skip": skip, "take": 500, "section_id": 2, "sub_modulesin": "7,8,9,20", "extra_paramsdata": "{}"}, timeout=TIMEOUT).json()
        rows += d.get("data") or []
        skip += 500
        if skip >= (d.get("totalCount") or 0) or not d.get("data"):
            break
    def cell(v):
        return "<td>" + html.escape(re.sub(r"\s+", " ", str(v or "")).strip()) + "</td>"
    body = ["<tr>" + cell("No") + "".join(cell(h) for h, _ in TZ_COLS) + "</tr>"]
    for i, r in enumerate(rows, 1):
        r["localtechnical_representative"] = re.sub(r"\s*\(\d+\)\s*$", "", r.get("localtechnical_representative") or "")
        body.append("<tr>" + cell(i) + "".join(cell(r.get(k)) for _, k in TZ_COLS) + "</tr>")
    path = os.path.join(tmp, "tz-register.html")
    open(path, "w", encoding="utf-8").write("<table>" + "".join(body) + "</table>")
    return path, len(rows)


REGISTRIES = {"KZ": reg_KZ, "KE": reg_KE, "UZ": reg_UZ, "KG": reg_KG, "TZ": reg_TZ}


def carry_forward(cur, country, path):
    """Sources without the certificate holder (Uzbekistan, Kyrgyzstan): keep the holder and local representative already
    known for each certificate, so a collected update does not erase the distributors a team upload brought in."""
    known = {c: (h, l) for c, h, l in cur.execute("""
        select r.certificate_no, h.display_name, l.display_name from registrations r
        left join companies h on h.id = r.registrant_id left join companies l on l.id = r.ltr_id
        where r.country = %s and r.certificate_no is not null and (r.ltr_id is not null or r.registrant_id <> r.manufacturer_id)""",
        (country,)).fetchall()}
    if not known:
        return
    rows = json.load(open(path, encoding="utf-8"))
    for r in rows:
        h, l = known.get(r.get("certificate_no"), (None, None))
        r["holder"] = r.get("holder") or h
        r["ltr"] = r.get("ltr") or l
    json.dump(rows, open(path, "w", encoding="utf-8"), ensure_ascii=False)


def run_registry(cur, src, s, tmp):
    country = src["country"]
    path, active = REGISTRIES[country](s, tmp)
    if path.endswith(".json"):
        carry_forward(cur, country, path)
    loaded = cur.execute("select count(*) from registrations where country = %s and active", (country,)).fetchone()[0]
    stored = storage.store(cur, path, os.path.basename(path))
    if loaded and active < HOLD_RATIO * loaded and not src["release_held"]:
        cur.execute("update data_sources set held_path = %s, held_rows = %s where key = %s", (stored, active, src["key"]))
        return active, f"Held: {active:,} active products collected against {loaded:,} loaded. Use it from Admin > Sources if it is right."
    queue_registry(cur, src, stored, os.path.basename(path))
    return active, None


def queue_registry(cur, src, stored, name):
    # the first collected pull of a source is a baseline: no "new competitor" alerts from a change of file shape
    kind = "upload" if src["last_ok"] else "initial"
    cur.execute("""insert into registry_uploads (country, kind, file_name, file_path) values (%s, %s, %s, %s)""",
                (src["country"], kind, f"collected: {name}", stored))
    cur.execute("update data_sources set held_path = null, held_rows = null, release_held = false where key = %s", (src["key"],))
    cur.execute("select pg_notify('ingest', 'registry')")


# ------------------------------------------------------------------ tenders: molecule matching and storage
PHARMA = re.compile(r"pharma|medicin|drugs?\b|vaccin|antibiot|tablet|capsul|inject|syrup|infusion|лекарств|препарат|медикамент|фарма|"
                    r"вакцин|таблет|капсул|инъекц|раствор|лиофилизат|суспенз|порошок|мазь|сироп|ампул|dori|vaksin|tibbiy|preparat|дори|дармон|тиббий", re.I)


class MoleculeIndex:
    """Words in a tender (English, or Russian through the shared name list) to the molecules we track."""

    def __init__(self, cur):
        import country_load
        self.by_word = {}
        for mid, key in cur.execute("select id, canonical_key from molecules").fetchall():
            if key and " " not in key and len(key) >= 6:
                self.by_word.setdefault(key, mid)
        for ru, en in country_load.load_ru().items():
            k = (en or "").lower().strip()
            if " " not in ru and k in self.by_word:
                self.by_word.setdefault(ru.replace("ё", "е"), self.by_word[k])

    def find(self, *texts):
        words = re.findall(r"[a-zа-яё]{6,}", " ".join(t or "" for t in texts).lower().replace("ё", "е"))
        return sorted({self.by_word[w] for w in words if w in self.by_word})


OCDS_PHARMA = re.compile(r"pharmac|medicines?\b|\bdrugs?\b|vaccin|antibiotic|antiretrovir|antimalari|medical (supplies|consumables)|"
                         r"essential medicine|reagents? and drugs", re.I)


def save_tenders(cur, rows, index):
    n = 0
    for t in rows:
        mols = index.find(t["title"], t.pop("text", ""))
        if not mols and not PHARMA.search(t["title"]):
            continue
        t.setdefault("buyer", None)
        if t["stage"] == "open" and t.get("closing") and t["closing"] < dt.date.today():
            t["stage"] = "closed"                 # past its deadline
        cols = ["country", "source", "ref", "title", "buyer", "stage", "published", "closing", "awarded", "value", "currency",
                "quantity", "unit_price", "bidders", "url"]
        vals = [t.get(c) for c in cols]
        cur.execute(f"""insert into tenders ({', '.join(cols)}, molecule_ids) values ({', '.join(['%s'] * len(cols))}, %s)
                        on conflict (source, ref) do update set {', '.join(f'{c} = excluded.{c}' for c in cols[3:])},
                        molecule_ids = excluded.molecule_ids, updated_at = now()""", vals + [mols])
        n += 1
    return n


def day(v):
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(v or ""))
    return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def ten_KZ(s, src):
    """SK-Pharmacy lots: the medicine, form, quantity, budget unit price, status and number of bids, page by page."""
    import pandas as pd
    from io import StringIO
    ca, out = ca_bundle(), []
    pages = [({}, p) for p in range(1, 61)] + [({"statuses": 360}, p) for p in range(1, 31 if src["last_ok"] else 1501)]
    for extra, page in pages:      # open lots, then completed lots (10 a page, newest first; a deeper first pull)
        h = s.get("https://fms.ecc.kz/ru/subpriceoffer", params={**extra, "page": page}, verify=ca, timeout=TIMEOUT).text
        links = {}                                # lot number -> its notice page on the portal
        for row in h.split("<tr")[1:]:
            lot, ann = re.search(r">\s*(\d{5,}-[^<\s]+)\s*<", row), re.search(r"/ru/announce/index/(\d+)", row)
            if lot and ann:
                links[lot.group(1)] = f"https://fms.ecc.kz/ru/announce/index/{ann.group(1)}"
        tables = pd.read_html(StringIO(h))
        if not tables:
            break
        t = max(tables, key=len)
        if t.empty:
            break
        for r in t.astype(str).values.tolist():   # lot, buyer, notice (with dates), medicine, form, method, month, qty, price, sum, status, bids
            if len(r) < 12 or not re.match(r"\d+-", r[0] or ""):
                continue
            status, when = r[10].lower(), re.findall(r"\d{4}-\d{2}-\d{2}", r[2])
            out.append(dict(country="KZ", source="kz_skpharm", ref=r[0], title=f"{r[3]}, {r[4]}"[:500], buyer=r[1],
                            stage="awarded" if "состоял" in status and "не " not in status else
                                  "open" if "опублик" in status or "прием" in status else "closed",
                            published=day(when[0]) if when else None, closing=day(when[-1]) if when else None,
                            quantity=num(r[7]), unit_price=num(r[8]), value=num(r[9]), currency="KZT",
                            bidders=int(num(r[11]) or 0), url=links.get(r[0], "https://fms.ecc.kz/ru/subpriceoffer")))
    return out


def ten_KZ_hosp(s, src):
    """Public hospitals' own purchases (med.ecc.kz): open and finished announcements; medicine ones are kept."""
    import pandas as pd
    from io import StringIO
    ca, out = ca_bundle(), []
    for page in range(1, 51 if src["last_ok"] else 301):
        h = s.get("https://med.ecc.kz/ru/searchanno", params={"page": page}, verify=ca, timeout=TIMEOUT).text
        links = {}
        for row in h.split("<tr")[1:]:
            no, ann = re.search(r">\s*(\d{5,}-\d+)\s*<", row), re.search(r"/ru/announce/index/(\d+)", row)
            if no and ann:
                links[no.group(1)] = f"https://med.ecc.kz/ru/announce/index/{ann.group(1)}"
        tables = pd.read_html(StringIO(h))
        t = max(tables, key=len) if tables else None
        if t is None or t.empty:
            break
        for r in t.astype(str).values.tolist():    # no, organiser, name, method, subject, start, end, lots, amount, status
            if len(r) < 10 or not re.match(r"\d+-", r[0] or ""):
                continue
            status = r[9].lower()
            out.append(dict(country="KZ", source="kz_hospitals", ref=r[0], title=r[2][:500], buyer=r[1],
                            stage="open" if "опублик" in status or "прием" in status else "awarded" if "состоял" in status and "не " not in status else "closed",
                            published=day(r[5]), closing=day(r[6]), value=num(r[8]), currency="KZT",
                            url=links.get(r[0], "https://med.ecc.kz/ru/searchanno")))
    return out


def ten_UZ(s, src):
    """Open UZEX e-tenders (lot name, buyer, start price); medicine lots are picked out by name."""
    out = []
    for typeid in (1, 2):
        d = s.post("https://apietender.uzex.uz/api/common/TradeList", json={"from": 1, "to": 1000, "typeid": typeid, "System_Id": 0},
                   timeout=TIMEOUT).json()
        for x in d if isinstance(d, list) else d.get("data", []):
            out.append(dict(country="UZ", source="uz_etender", ref=str(x.get("id")), title=x.get("name") or "", buyer=x.get("seller_name"),
                            stage="open", published=day(x.get("start_date")), closing=day(x.get("end_date")),
                            value=num(x.get("cost")), currency=x.get("currency") or "UZS",
                            url=f"https://etender.uzex.uz/lot/{x.get('id')}"))
    return out


def ten_UZ_deals(s, src):
    """Completed UZEX deals: the lot description, buyer, start and final price, number of participants."""
    out = []
    for start in range(1, (2000 if src["last_ok"] else 20000) + 1, 500):
        d = s.post("https://apietender.uzex.uz/api/common/DealsList", json={"from": start, "to": start + 499, "System_Id": 0}, timeout=TIMEOUT).json()
        if not d:
            break
        for x in d:
            out.append(dict(country="UZ", source="uz_deals", ref=str(x.get("deal_id")), title=(x.get("category_name") or "")[:500],
                            buyer=x.get("customer_name"), stage="awarded", awarded=day(x.get("deal_date")),
                            value=num(x.get("deal_cost")), currency="UZS", bidders=x.get("participants_count"),
                            url="https://etender.uzex.uz"))
    return out


def _kg_rows(s, page, limit):
    """Rows of a table on the Kyrgyz procurement portal (PrimeFaces), 100 at a time, as label/value lists."""
    h = s.get(page, timeout=TIMEOUT).text
    table = re.search(r'PrimeFaces\.cw\("DataTable","[^"]+",\{id:"([^"]+)"', h).group(1)
    form = re.search(r'<form id="([^"]+)"[^>]*>(?:(?!</form>).)*' + re.escape(table), h, re.S).group(1)
    state = re.search(r'name="javax\.faces\.ViewState"[^>]*value="([^"]+)"', h).group(1)
    for first in range(0, limit, 100):
        r = s.post(page, timeout=TIMEOUT, headers={"Faces-Request": "partial/ajax", "X-Requested-With": "XMLHttpRequest"}, data={
            "javax.faces.partial.ajax": "true", "javax.faces.source": table, "javax.faces.partial.execute": table,
            "javax.faces.partial.render": table, f"{table}_pagination": "true", f"{table}_first": str(first), f"{table}_rows": "100",
            f"{table}_encodeFeature": "true", form: form, "javax.faces.ViewState": state})
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S)
        if not rows:
            break
        for row in rows:
            t = [x.strip() for x in re.sub(r"<[^>]+>", "|", html.unescape(row)).split("|") if x.strip()]
            yield lambda label, t=t: [t[i + 1] for i, x in enumerate(t[:-1]) if x == label]


def kg_day(v):
    m = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", v or "")
    return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else day(v)


def ten_KG(s, src):
    """Kyrgyz state procurement: open announcements (buyer, planned amount, deadline) and results (lots, contract
    amounts, signing date). No winner names are kept."""
    out = []
    for get in _kg_rows(s, "https://zakupki.gov.kg/popp/view/order/list.xhtml", 1000 if src["last_ok"] else 3000):
        ad = (get("number") or [None])[0]
        if ad and get("purchase Name"):
            out.append(dict(country="KG", source="kg_zakupki_open", ref=ad, title=get("purchase Name")[0][:500],
                            buyer=(get("Name of company") or [None])[0], stage="open", published=kg_day((get("Date published") or [""])[0]),
                            closing=kg_day((get("Bids Submission Deadline") or [""])[0]), value=num((get("Planned amount") or [""])[0]),
                            currency="KGS", url="https://zakupki.gov.kg/popp/view/order/list.xhtml"))
    for get in _kg_rows(s, "https://zakupki.gov.kg/popp/view/order/winners.xhtml", 1000 if src["last_ok"] else 10000):
        ad = (get("Number of ads") or [None])[0]
        if not ad:
            continue
        lots = [re.sub(r"^L\d+-\d+:\s*", "", x) for x in get("lotNumber")]
        out.append(dict(country="KG", source="kg_zakupki", ref=f"{ad}-{(get('Contract number') or [''])[0]}",
                        title=(get("purchase Name") or [""])[0][:500], text=" ".join(lots), stage="awarded",
                        awarded=kg_day((get("Date of signing the contract") or [""])[0]),
                        value=sum(num(v) or 0 for v in get("The price of the contract")) or None, currency="KGS",
                        url="https://zakupki.gov.kg/popp/view/order/winners.xhtml"))
    return out


def ten_KE_live(s, src):
    """Kenya's open tenders (PPIP), all procuring entities. Only tender fields are kept: the feed also carries the
    names and contacts of the officers who posted them, which are dropped here."""
    out, page = [], 1
    while page <= 60:
        d = s.get("https://tenders.go.ke/api/active-tenders", params={"page": page, "perpage": 100}, timeout=TIMEOUT).json()
        for x in d.get("data", []):
            pe = ((x.get("created_by") or {}).get("pe") or {}).get("name") or (x.get("pe") or {}).get("name")
            out.append(dict(country="KE", source="ke_ppip", ref=x.get("ocid") or str(x.get("id")), title=x.get("title") or "",
                            buyer=pe, stage="open", published=day(x.get("published_at")), closing=day(x.get("close_at")),
                            url="https://tenders.go.ke"))
        if page >= (d.get("last_page") or 1):
            break
        page += 1
    return [t for t in out if OCDS_PHARMA.search(t["title"]) and not re.search(r"non[- ]?pharm", t["title"], re.I)]


def _ocds(rel, country, source, url):
    tender, awards = rel.get("tender") or {}, rel.get("awards") or []
    items = tender.get("items") or []
    drugs = [i for i in items if str((i.get("classification") or {}).get("id", "")).startswith("51")]   # UNSPSC 51: drugs
    title = tender.get("title") or tender.get("description") or ""
    if not drugs and (not OCDS_PHARMA.search(title) or re.search(r"non[- ]?pharm", title, re.I)):
        return None                       # lab, building and other supplies that only mention a chemical
    text = " ".join((i.get("description") or "") + " " + ((i.get("classification") or {}).get("description") or "") for i in drugs)
    first = (drugs or items or [{}])[0]
    won = [a for a in awards if (a.get("status") or "active") != "cancelled"]
    value = sum(num((a.get("value") or {}).get("amount")) or 0 for a in won) or num((tender.get("value") or {}).get("amount"))
    return dict(country=country, source=source, ref=rel.get("ocid") or rel.get("id"), title=title,
                text=text + (" pharmaceutical" if drugs else ""), buyer=(rel.get("buyer") or {}).get("name"),
                stage="awarded" if won else "open" if (tender.get("status") or "") in ("active", "planned") else "closed",
                published=day((tender.get("tenderPeriod") or {}).get("startDate") or rel.get("date")),
                closing=day((tender.get("tenderPeriod") or {}).get("endDate")), awarded=day(won[0].get("date")) if won else None,
                value=value, currency=((won[0].get("value") if won else tender.get("value")) or {}).get("currency"),
                quantity=num(first.get("quantity")), unit_price=num(((first.get("unit") or {}).get("value") or {}).get("amount")),
                bidders=((rel.get("bids") or {}).get("statistics") or [{}])[0].get("value") if isinstance((rel.get("bids") or {}).get("statistics"), list) else None,
                url=url)


def _releases(doc):
    if isinstance(doc, dict) and "records" in doc:
        return [r.get("compiledRelease") or (r.get("releases") or [{}])[-1] for r in doc["records"]]
    if isinstance(doc, dict) and "releases" in doc:
        return doc["releases"]
    return doc if isinstance(doc, list) else []


def ten_TZ(s, src):
    """NeST daily OCDS record files (published by PPRA; commercial use agreed with PPRA)."""
    out = []
    days = 2 if src["last_ok"] else 7
    for back in range(1, days + 1):
        d = dt.date.today() - dt.timedelta(days=back)
        r = s.get(f"https://nest.go.tz/gateway/nest-data-portal-api/api/packages/download/record_{d:%Y_%m_%d}.json", timeout=600)
        if r.status_code != 200:
            continue
        for rel in _releases(r.json()):
            out.append(_ocds(rel, "TZ", "tz_nest", "https://nest.go.tz"))
    return [t for t in out if t]


def ten_KE(s, src):
    """PPIP open data: the current financial year's OCDS file (tenders and awards, totals only)."""
    idx = sorted(s.get("https://tenders.go.ke/api/ocds/index", timeout=TIMEOUT).json().get("data", []), key=lambda x: -x["id"])
    out = []
    for f in idx[:1 if src["last_ok"] else 2]:            # this financial year; the first run adds last year
        doc = s.get("https://tenders.go.ke/api/ocds/tenders", params={"download": "true", "ocds_id": f["id"]}, timeout=900).json()
        out += [t for t in (_ocds(rel, "KE", "ke_ppip", "https://tenders.go.ke") for rel in _releases(doc)) if t]
    return out


TENDERS = {"KZ": lambda s, src: ten_KZ(s, src) + ten_KZ_hosp(s, src), "UZ": lambda s, src: ten_UZ(s, src) + ten_UZ_deals(s, src), "TZ": ten_TZ, "KE": lambda s, src: ten_KE_live(s, src) + ten_KE(s, src), "KG": ten_KG}


# ------------------------------------------------------------------ prices
def prices_UZ(cur, s):
    """Registered reference and maximum prices for prescription medicines (Pharmaceutical Agency, open), in UZS."""
    from catalogue import Generics
    from country_load import load_ru
    g, ru, n, page = Generics(cur), load_ru(), 0, 0
    by_cert = dict(cur.execute("""select certificate_no, min(molecule_id) from registrations where country = 'UZ'
                                  and molecule_id is not null group by 1""").fetchall())
    while True:
        d = s.get("https://api.pharmagency.uz/drug-catalog-api/v1/referent-price/all", params={"page": page, "size": 1000}, timeout=TIMEOUT).json()
        d = d.get("result") or d
        for x in d.get("content", []):
            cert = x.get("registrationNumber")
            if not cert:
                continue
            inn = (x.get("innName") or "").strip().lower()
            mol = by_cert.get(cert) or (g.molecule(cur, ru.get(inn) or inn) if inn else None)
            cur.execute("""insert into reference_prices (country, certificate_no, name, pack, molecule_id, currency, reference_price,
                           max_wholesale, max_retail) values ('UZ', %s, %s, %s, %s, 'UZS', %s, %s, %s)
                           on conflict (country, certificate_no, pack) do update set reference_price = excluded.reference_price,
                           max_wholesale = excluded.max_wholesale, max_retail = excluded.max_retail, molecule_id = excluded.molecule_id,
                           updated_at = now()""",
                        (cert, x.get("trademark"), (x.get("medicinalProductIncludingPackaging") or "")[:300], mol,
                         num(x.get("price")), num(x.get("wholesalePrice")), num(x.get("retailPrice"))))
            n += 1
        if d.get("last", True) or not d.get("content"):
            break
        page += 1
    return n


# ------------------------------------------------------------------ the schedule
def due(cur):
    return cur.execute("""select key, country, kind, last_ok, release_held, held_path from data_sources
                          where enabled and (run_now or release_held or last_run is null
                                or last_run < now() - make_interval(hours => every_hours))
                          order by last_run nulls first limit 1""").fetchall()


def run(conn, only=None):
    """Run the next due source (or the one named). One per call, so a slow source never blocks the worker for long."""
    cur = conn.cursor()
    rows = cur.execute("select key, country, kind, last_ok, release_held, held_path from data_sources where key = %s", (only,)).fetchall() \
        if only else due(cur)
    if not rows:
        return None
    key, country, kind, last_ok, release, held = rows[0]
    src = dict(key=key, country=country, kind=kind, last_ok=last_ok, release_held=release)
    cur.execute("update data_sources set last_run = now(), run_now = false where key = %s", (key,))
    conn.commit()
    s, n, warning = session(), None, None
    try:
        with tempfile.TemporaryDirectory(prefix="collect-") as tmp:
            if kind == "registry" and release and held:          # the team chose to use a held pull
                queue_registry(cur, src, held, f"{key} (held)")
                n = cur.execute("select held_rows from data_sources where key = %s", (key,)).fetchone()[0]
            elif kind == "registry":
                n, warning = run_registry(cur, src, s, tmp)
            elif kind == "tenders":
                n = save_tenders(cur, TENDERS[country](s, src), MoleculeIndex(cur))
                cur.execute("update tenders set stage = 'closed' where country = %s and stage = 'open' and closing < current_date", (country,))
            elif kind == "prices":
                n = prices_UZ(cur, s)
        cur.execute("""update data_sources set last_rows = %s, last_error = %s, last_ok = case when %s then last_ok else now() end
                       where key = %s""", (n, warning, warning is not None, key))
        conn.commit()
        log.info("collected %s: %s%s", key, n, f" ({warning})" if warning else "")
    except Exception as e:
        conn.rollback()
        cur.execute("update data_sources set last_error = %s where key = %s", (f"{type(e).__name__}: {str(e)[:300]}", key))
        conn.commit()
        log.exception("collector %s failed", key)
    return key


if __name__ == "__main__":
    import sys
    from db import connect
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    with connect() as c:
        print(run(c, sys.argv[1] if len(sys.argv) > 1 else None))
