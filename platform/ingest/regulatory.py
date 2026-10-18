"""Researched regulatory detail per market (regulatory_data/XX.json): requirements with their source and the date they
were checked, registration routes with realistic timelines and official fees, the documents each market asks for, and
the regulators' news pages. Loaded at start-up when a file changed; low-confidence findings stay drafts for the team.
Researched requirements replace the generic starter rules; rules the team wrote themselves are kept."""
import datetime as dt
import hashlib
import json
import logging
import os

log = logging.getLogger("regulatory")
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "regulatory_data")
TOPICS = ["Route", "Timeline", "Fees", "Local representative", "Site and GMP", "Dossier", "Bioequivalence", "Stability",
          "Samples", "Labelling", "Marking", "Pricing", "Import", "After approval"]
ELIGIBLE = {"full": "all", "eaeu": "eaeu", "eac": "eac"}       # everything else needs an SRA approval or WHO PQ


def checked_on(text):
    try:
        return dt.date.fromisoformat((text or "")[:7] + "-01")
    except ValueError:
        return dt.date.today()


def load(cur, folder=HERE):
    loaded = 0
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        if not name.endswith(".json"):
            continue
        raw = open(os.path.join(folder, name), "rb").read()
        digest = hashlib.sha256(raw).hexdigest()
        d = json.loads(raw)
        c = d["country"]
        done = cur.execute("select state from source_items where source = 'regulatory' and ref = %s", (c,)).fetchone()
        if done and done[0] == digest:
            continue
        on = checked_on(d.get("checked"))
        if d.get("facts"):
            cur.execute("delete from reg_requirements where country = %s and origin in ('seed', 'research')", (c,))
            for f in d["facts"]:
                topic = f["topic"] if f.get("topic") in TOPICS else "Dossier"
                applies = f.get("applies") if f.get("applies") in ("all", "class", "atc", "form", "molecule") else "all"
                match = (f.get("match") or None) if applies != "all" else None
                if applies != "all" and not match:
                    applies = "all"
                cur.execute("""insert into reg_requirements (country, topic, applies, match, title, body, status, sort, source,
                               checked, confidence, origin) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'research')""",
                            (c, topic, applies, match, f["title"][:120], f["body"],
                             "draft" if f.get("confidence") == "low" else "published", (TOPICS.index(topic) + 1) * 10,
                             f.get("source"), on, f.get("confidence")))
        if d.get("routes"):
            cur.execute("delete from country_routes where country = %s", (c,))
            for i, r in enumerate(d["routes"]):
                cur.execute("""insert into country_routes (country, key, label, description, months_low, months_high, fee_usd_low,
                               fee_usd_high, eligibility, source, checked, sort) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                               on conflict (country, key) do nothing""",
                            (c, r["key"], r["label"], r.get("description"), r.get("months_low"), r.get("months_high"),
                             r.get("fee_usd_low"), r.get("fee_usd_high"), ELIGIBLE.get(r["key"], "sra_or_pq"), r.get("source"), on, i))
        if d.get("documents"):
            cur.execute("delete from reg_checklist where country = %s", (c,))
            for i, doc in enumerate(d["documents"]):
                applies = doc.get("applies") if doc.get("applies") in ("all", "class", "atc", "form", "molecule") else "all"
                cur.execute("""insert into reg_checklist (country, name, applies, match, note, source, sort)
                               values (%s, %s, %s, %s, %s, %s, %s)""",
                            (c, doc["name"][:160], applies, (doc.get("match") or None) if applies != "all" else None,
                             doc.get("note"), doc.get("source"), i))
        for i, nw in enumerate(d.get("news", [])):
            if nw.get("url", "").startswith("http") and "#" not in nw["url"]:     # app pages (#/...) are not news pages
                cur.execute("""insert into data_sources (key, country, kind, label, url, every_hours) values (%s, %s, 'news', %s, %s, 24)
                               on conflict (key) do update set label = excluded.label, url = excluded.url""",
                            (f"news_{c}_{i}", c, f"{nw.get('name', 'Regulator news')[:80]}", nw["url"]))
        cur.execute("""insert into source_items (source, ref, checked_at, state) values ('regulatory', %s, now(), %s)
                       on conflict (source, ref) do update set checked_at = now(), state = excluded.state""", (c, digest))
        loaded += 1
        log.info("regulatory detail loaded for %s", c)
    return loaded
