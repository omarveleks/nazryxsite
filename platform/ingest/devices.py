"""Medical device registers (Kenya PPB, Tanzania TMDA), read weekly into `devices`, and the use groups that keep eye
lubricants, eye-surgery viscoelastics, joint injections and nasal saline apart even when they share an ingredient."""
import datetime as dt
import html
import logging
import re

log = logging.getLogger("devices")

# Use groups, from a product's name, generic name or intended use. Order matters: a viscoelastic is not an eye drop.
GROUPS = [
    ("eye_surgery", r"viscoelast|visco-?surg|\bovd\b|provisc|healon|viscoat|discovisc|amvisc|hydroxy ?propyl ?methyl ?cellulose 2|"
                    r"hpmc 2|appavisc|adgevisk|kogevisk|ophthalmic (?:surgical|viscosurgical)"),
    ("joint", r"intra-?articular|viscosupplement|synvisc|durolane|ostenil|fermathron|hyalgan|orthovisc|armaviscon|hyorth|hyal forte|"
              r"\bhylan\b|(?:hyaluron\w*).*(?:knee|joint|articul|osteoarth)|(?:knee|joint|osteoarth).*hyaluron"),
    ("nasal", r"saline nasal|nasal saline|(?:nasal|nose).*(?:saline|sea ?water|isotonic|hypertonic|wash|rinse|spray|drops)|"
              r"sea ?water|sinus rinse|nasal wash|neti pot|sterimar|neilmed|nasamist|pediamist|linaqua|aquaease|physiomer|marimer|synolin"),
    ("eye_drops", r"eye ?drop|eye gel|lubricat\w* eye|eye lubricant|dry eye|artificial tear|\btears\b|hylo-?(?:comod|gel|care|dual|fresh)|"
                  r"systane|hyfresh|maxmoist|hayazol|hyazol|gylan|refresh (?:liquigel|tears|plus)|optive|thealoz|eye (?:mist|spray)"),
]
# Hardware and diagnostics that share words with the groups above (knee prostheses, oxygen cannulas, intraocular lenses)
NOT_GROUPED = (r"cannula|oxygen|mask|prosthe|arthroplast|brace|immobili|implant|\blens|\biol\b|blade|\btest|assay|tube|airway|cpap|"
               r"ventilat|aspirat|suction|prong|knife|catheter|swab|kit for|analy[sz]er|scanner|system$|hinge|nail|screw|plate")
GROUP_LABEL = {"eye_drops": "Eye lubricants (dry eye)", "eye_surgery": "Eye-surgery viscoelastics",
               "joint": "Joint injections (hyaluronic acid)", "nasal": "Nasal saline"}


def use_group(*texts):
    t = " ".join(x for x in texts if x).lower()
    if re.search(NOT_GROUPED, t):
        return None
    return next((g for g, rx in GROUPS if re.search(rx, t)), None)


def _year(v):
    m = re.search(r"(19|20)\d{2}", str(v or ""))
    return int(m.group(0)) if m else None


def _date(v):
    try:
        return dt.date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def read_KE(s):
    page = "https://products.pharmacyboardkenya.org/ppb_admin/pages/public_view_md_retained.php"
    form = dict(re.findall(r'class="xcrud-data" name="(\w+)" value="([^"]*)"', s.get(page, timeout=120).text))
    form.update(start=0, limit=50000)
    r = s.post("https://products.pharmacyboardkenya.org/ppb_admin/xcrud/xcrud_ajax.php",
               data={f"xcrud[{k}]": v for k, v in form.items()}, timeout=600)
    r.raise_for_status()
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S):
        c = [html.unescape(re.sub(r"<[^>]+>", "", x)).strip().rstrip("…") for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(c) < 8 or not c[2]:
            continue
        # #, device id, trade name, manufacturer, local representative, year, registration no., licence status, retention year
        out.append(dict(ref=c[1], certificate_no=c[6], brand=c[2], description=None, intended_use=None, risk_class=None,
                        manufacturer=c[3], manufacturing_country=None, holder=None, ltr=c[4] or None, reg_year=_year(c[5]),
                        expires=None, active=(c[7] or "").upper().startswith("VALID")))
    return out


def read_TZ(s):
    url, rows, skip = "https://imis2.tmda.go.tz/publicaccess/onSearchPublicRegisteredproducts", [], 0
    while True:
        d = s.get(url, params={"skip": skip, "take": 1000, "section_id": 4, "sub_modulesin": "7,8,9,20", "extra_paramsdata": "{}"},
                  timeout=180).json()
        rows += d.get("data") or []
        skip += 1000
        if skip >= (d.get("totalCount") or 0) or not d.get("data"):
            break
    out = []
    for x in rows:
        exp = _date(x.get("app_expiry_Date"))
        out.append(dict(ref=str(x.get("reg_product_id") or x.get("certificate_no") or x.get("id")), certificate_no=x.get("certificate_no"),
                        brand=(x.get("brand_name") or "").strip(), description=x.get("generic_name") or x.get("gmdn_term"),
                        intended_use=x.get("intended_use"), risk_class=x.get("classification_name"),
                        manufacturer=x.get("manufacturer"), manufacturing_country=(x.get("manufacturer_country") or "").title() or None,
                        holder=x.get("registrant"), ltr=re.sub(r"\s*\(\d+\)\s*$", "", x.get("localtechnical_representative") or "") or None,
                        reg_year=_year(x.get("certificate_issue_date")), expires=exp,
                        active=(exp is None or exp >= dt.date.today()) and "valid" in str(x.get("registration_status") or "valid").lower()))
    return [r for r in out if r["brand"]]


READERS = {"KE": read_KE, "TZ": read_TZ}


def collect(cur, s, country):
    rows = READERS[country](s)
    if not rows:
        raise ValueError("The register returned no devices; nothing was changed.")
    for r in rows:
        r["use_group"] = use_group(r["brand"], r["description"], r["intended_use"])
        cur.execute("""insert into devices (country, ref, certificate_no, brand, description, intended_use, risk_class, manufacturer,
                         manufacturing_country, holder, ltr, reg_year, expires, active, use_group, seen)
                       values (%(c)s, %(ref)s, %(certificate_no)s, %(brand)s, %(description)s, %(intended_use)s, %(risk_class)s,
                         %(manufacturer)s, %(manufacturing_country)s, %(holder)s, %(ltr)s, %(reg_year)s, %(expires)s, %(active)s,
                         %(use_group)s, current_date)
                       on conflict (country, ref) do update set certificate_no = excluded.certificate_no, brand = excluded.brand,
                         description = excluded.description, intended_use = excluded.intended_use, risk_class = excluded.risk_class,
                         manufacturer = excluded.manufacturer, manufacturing_country = excluded.manufacturing_country,
                         holder = excluded.holder, ltr = excluded.ltr, reg_year = excluded.reg_year, expires = excluded.expires,
                         active = excluded.active, use_group = excluded.use_group, seen = current_date""", {**r, "c": country})
    # a device that left the register is no longer registered
    cur.execute("update devices set active = false where country = %s and seen < current_date", (country,))
    tag_products(cur)
    return len(rows)


def tag_products(cur):
    """Use groups for manufacturers' products that have none yet (they can change it on the product page)."""
    for pid, name, form, inn in cur.execute("""select p.id, p.name, p.dosage_form, m.inn from mfr_products p
                                               left join molecules m on m.id = p.molecule_id where p.use_group is null""").fetchall():
        g = use_group(name, form, inn)
        if g:
            cur.execute("update mfr_products set use_group = %s where id = %s", (g, pid))
