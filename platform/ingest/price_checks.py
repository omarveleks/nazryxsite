"""Checks run after every price rebuild (pricing.rebuild), stored in price_checks for Admin > Data.

Accuracy (a backtest): for every market and medicine with real shelf prices, the price we would have estimated had
we known nothing in that market (its neighbours carried over by the price gaps), against the real one. Summed up per
market and product type: the typical error, the share within 50%, and the bias (estimates high or low on the whole).

Alerts: a market's shelf price far from what its neighbours say (one of them is wrong, or the market really differs),
a very wide range (mixed packs or forms), a unit price no medicine has, an estimate resting on one source or on no
price gap at all, portfolio products with no price for their form, and exchange rates gone stale."""
import json
import math
import re
import statistics

INHALER = re.compile(r"inhal|aerosol|evohaler|accuhaler|turbuhaler|\bmdi\b", re.I)
TABLET = re.compile(r"tablet|capsule|caplet|lozenge|pastille|softgel|\bcaps?\b|\btabs?\b", re.I)
VIAL = re.compile(r"inject|ampoule|ampule|vial|infusion|intraven|syringe", re.I)
LIQUID = re.compile(r"drop|syrup|solution|suspension|spray|gel|cream|ointment|liquid|inhal|aerosol|emulsion|lotion|powder", re.I)
# a unit price outside these (USD) is no medicine's: a pack read as one unit, a unit read as a pack, a wrong currency
PLAUSIBLE = {"tablet or capsule": (0.0005, 40), "ampoule or vial": (0.01, 800), "ml": (0.0005, 60), "g": (0.0005, 60),
             "inhaler": (0.3, 150)}
OUTLIER = 3.0            # a shelf price more than 3x off its neighbours' estimate
WIDE = 15.0              # a market's highest price over 15x its lowest for one form and strength
MIN_SHELF = 3            # shelf prices before a market's own price is tested against the estimate


def form_unit(form):
    """The unit a product is sold by, from its form (as the web app's formUnit)."""
    f = form or ""
    return ("inhaler" if INHALER.search(f) and not re.search(r"solution|nebul", f, re.I) else "tablet or capsule" if TABLET.search(f)
            else "ampoule or vial" if VIAL.search(f) else "ml" if LIQUID.search(f) else None)


def fits(v, unit):
    if not unit:
        return True
    have = {v["unit"], *(v.get("forms") or {})}
    return bool(have & ({"ml", "g"} if unit == "ml" else {unit}))


def run(cur, direct, out, estimate, gap_used, fx, markets, members):
    rows = []
    add = lambda kind, c=None, m=None, t=None, value=None, n=None, product=None, **detail: rows.append(
        (kind, c, m, product, t, value, n, json.dumps(detail, ensure_ascii=False, default=str) if detail else None))
    first = lambda k: (members.get(k) or [None])[0] if isinstance(k, str) else k     # a family's first molecule

    # accuracy: estimate as if we knew nothing in the market, against its real shelf price
    tested = {}
    for (c, k), v in direct.items():
        if c not in markets or v["n"] < MIN_SHELF or v["basis"] != "listings":
            continue
        e = estimate(c, k, own_shelf=False)
        if not e or e["unit"] != v["unit"] or (e["strength"] and v["strength"] and e["strength"] != v["strength"]):
            continue
        r = e["unit_usd"] / v["unit_usd"]
        t = v.get("ftype") or "other"
        tested.setdefault((c, t), []).append(r)
        tested.setdefault((c, "all"), []).append(r)
        if not 1 / OUTLIER <= r <= OUTLIER:
            add("outlier", c, first(k), t, round(r, 3), v["n"], shelf=round(v["unit_price"], 4), estimate=round(e["unit_price"], 4),
                unit=v["unit"], strength=v["strength"], estimate_from=e.get("from_country"))
    for (c, t), rs in tested.items():
        logs = [abs(math.log(r)) for r in rs]
        add("accuracy", c, None, t, round(math.exp(statistics.median(logs)) - 1, 4), len(rs),
            within_50=round(sum(1 for r in rs if 1 / 1.5 <= r <= 1.5) / len(rs), 3),
            bias=round(statistics.median(rs), 3))

    for (c, k), v in out.items():
        if c not in markets:
            continue
        m, t = first(k), v.get("ftype") or "other"
        lo_hi = PLAUSIBLE.get(v["unit"])
        if lo_hi and v.get("unit_usd") and not lo_hi[0] <= v["unit_usd"] <= lo_hi[1]:
            add("implausible", c, m, t, round(v["unit_usd"], 6), v["n"], unit=v["unit"], strength=v["strength"], basis=v["basis"])
        if v["basis"] == "listings" and v.get("lo") and v.get("hi") and v["lo"] > 0 and v["hi"] / v["lo"] > WIDE:
            add("wide_range", c, m, t, round(v["hi"] / v["lo"], 1), v["n"], lo=round(v["lo"], 4), hi=round(v["hi"], 4), unit=v["unit"])
        if v["basis"] == "estimate" and v.get("voices") == 1:
            add("single_source", c, m, t, None, v["n"], source=v.get("from_country"))
        if v["basis"] == "estimate" and 3 in (v.get("gap_tiers") or []):
            add("no_gap", c, m, t, None, v["n"], source=v.get("from_country"))

    # portfolio products with no price for their own form, per market
    fam_of = {mid: k for k, ids in members.items() for mid in ids}
    missing = {}
    for mid, form, n in cur.execute("""select molecule_id, dosage_form, count(*) from mfr_products
                                       where molecule_id is not null and coalesce(kind, 'medicine') <> 'device'
                                       group by 1, 2""").fetchall():
        k, u = fam_of.get(mid, mid), form_unit(form)
        for c in markets:
            v = out.get((c, k))
            if not v or not fits(v, u):
                missing.setdefault((c, mid), [0, set()])
                missing[(c, mid)][0] += n
                missing[(c, mid)][1].add(u or "any")
    for (c, mid), (n, units) in missing.items():
        add("no_price", c, mid, None, None, n, forms=sorted(units))

    # the price gaps in use for each market, source and product type (measured on 10 or more medicines, else set)
    for (c, s, t), (ratio, n, basis) in gap_used.items():
        add("gap", c, None, t, round(ratio, 3), n, source=s, basis=basis)

    for ccy, age in cur.execute("select currency, extract(epoch from now() - updated_at) / 86400 from fx_rates").fetchall():
        if age and age > 3:
            add("fx_stale", None, None, None, round(float(age), 1), None, currency=ccy)
    for (c, k), v in out.items():                     # priced only per pack of unknown size: not shown on the pages
        if c in markets and v["unit"] == "pack":
            add("pack_only", c, first(k), v.get("ftype"), None, v["n"], basis=v["basis"])

    cur.execute("delete from price_checks where kind not like 'class\\_%'")
    with cur.copy("copy price_checks (kind, country, molecule_id, product_id, form_type, value, n, detail) from stdin") as cp:
        for r in rows:
            cp.write_row(r)
    return len(rows)


# ------------------------------------------------------------------ classes: medicine, device or supplement, and what for
SUPPLEMENT = re.compile(r"dietary supplement|food supplement|nutraceutical|nutritional supplement|compl[eé]ment alimentaire|"
                        r"\bбад\b|биологически активн", re.I)
DEVICE_GROUPS = {"contact_lens", "dermal_filler", "eye_surgery", "joint", "nasal", "inhaled_saline", "eye_drops"}
VITAMINS = "Vitamins and Minerals"


def class_checks(cur):
    """Products filed in the wrong kind or with no class, for the team to look at (kinds class_*):
    a device whose ingredient is a medicine; a medicine sold as a device in most markets (lubricant eye drops, nasal
    saline, fillers, lens care); a medicine whose name says it is a supplement, or a supplement whose ingredient is a
    prescription medicine; a matched medicine with no therapeutic class."""
    import devices
    rows = []
    add = lambda kind, pid, mid, **detail: rows.append((kind, None, mid, pid, None, None, None, json.dumps(detail, ensure_ascii=False)))
    for pid, name, form, kind, group, mid, inn, cat in cur.execute(
            """select p.id, p.name, p.dosage_form, coalesce(p.kind, 'medicine'), p.use_group, m.id, m.inn, m.category
               from mfr_products p left join molecules m on m.id = p.molecule_id""").fetchall():
        text = f"{name} {form or ''}"
        soft = bool(inn and re.search(devices.LUBRICANTS, inn, re.I))      # lubricants, saline, hyaluronate: device-like
        if kind == "device" and mid and cat and not soft and group not in DEVICE_GROUPS:
            add("class_device_is_medicine", pid, mid, name=name, ingredient=inn, cls=cat,
                why=f"Filed as a device, but {inn} is a medicine ({cat})")
        if kind == "medicine" and group in DEVICE_GROUPS and (group not in ("eye_drops", "nasal") or soft or not mid):
            add("class_sold_as_device", pid, mid, name=name, ingredient=inn, group=group,
                why="Filed as a medicine; most markets register this as a medical device: check how it is registered")
        if kind != "supplement" and SUPPLEMENT.search(text):
            add("class_says_supplement", pid, mid, name=name, why="Its name says it is a dietary supplement")
        if kind == "supplement" and mid and cat and cat != VITAMINS and not soft and not SUPPLEMENT.search(text):   # its label says so
            add("class_supplement_is_medicine", pid, mid, name=name, ingredient=inn, cls=cat,
                why=f"Filed as a supplement, but {inn} is a medicine ({cat})")
        if kind == "medicine" and mid and not cat and not group:
            add("class_missing", pid, mid, name=name, ingredient=inn, why=f"{inn} has no therapeutic class yet")
    cur.execute("delete from price_checks where kind like 'class\\_%'")
    with cur.copy("copy price_checks (kind, country, molecule_id, product_id, form_type, value, n, detail) from stdin") as cp:
        for r in rows:
            cp.write_row(r)
    return len(rows)
