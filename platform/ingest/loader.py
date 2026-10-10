"""Load pipeline output (out/*.csv) into Postgres: upsert molecules, companies and registrations, diff against the
live data, keep history, merge duplicate companies and recompute gap scores.

Everything runs on the caller's connection inside ONE transaction. The caller commits on success and rolls back on
any exception, so a failed upload never changes live data.
"""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "pipeline"))

from companies import same_company  # noqa: E402
from gap import score_molecule  # noqa: E402

COUNTRY = "TZ"


def _s(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    return s or None


def _nice(name):
    """Registry names are often in capitals: 'AMOXICILLIN TRIHYDRATE' -> 'Amoxicillin Trihydrate'."""
    name = _s(name) or ""
    return name.title() if name.isupper() or name.islower() else name


def read_out(out):
    r = lambda f, **k: pd.read_csv(os.path.join(out, f), low_memory=False, keep_default_na=True, **k)
    return {
        "gap": r("molecules_gap.csv"),
        "regm": r("molecules_registry.csv"),
        "companies": r("companies.csv"),
        "regs": r("registrations_clean.csv", dtype={"certificate_no": str, "Product Strength": str}).rename(columns={
            "Brand Name": "brand", "Generic Name": "generic_name", "Dosage Form": "dosage_form",
            "Product Strength": "strength", "Active Pharmaceutical Ingredients": "api_text",
            "Manufacturing Country": "manufacturing_country", "Registration Status": "status"}),
        "dups": r("review_queue_companies.csv"),
    }


# ------------------------------------------------------------------ molecules
def upsert_molecules(cur, data):
    alias = dict(cur.execute("select alias, molecule_id from molecule_aliases").fetchall())
    by_key = dict(cur.execute("select canonical_key, id from molecules").fetchall())

    def mol_id(key, inn, category=None, prefer_name=False):
        mid = alias.get(key) or by_key.get(key)
        if mid is None:
            mid = cur.execute("insert into molecules (canonical_key, inn, category) values (%s, %s, %s) returning id",
                              (key, inn, category)).fetchone()[0]
            by_key[key] = mid
        elif prefer_name:
            cur.execute("update molecules set inn = %s, category = coalesce(%s, category) where id = %s", (inn, category, mid))
        if key not in alias:
            cur.execute("insert into molecule_aliases (alias, molecule_id, source) values (%s, %s, 'auto') "
                        "on conflict (alias) do nothing", (key, mid))
            alias[key] = mid
        return mid

    key_to_id = {}
    for r in data["regm"].itertuples(index=False):
        key_to_id[r.key] = mol_id(r.key, _nice(r.display))
    ess = {}
    for r in data["gap"].itertuples(index=False):
        target = _s(r.reg_key) or r.key
        mid = mol_id(target, r.molecule, r.category, prefer_name=True)
        if r.key != target:
            cur.execute("insert into molecule_aliases (alias, molecule_id, source) values (%s, %s, 'auto') "
                        "on conflict (alias) do nothing", (r.key, mid))
        key_to_id.setdefault(r.key, mid)
        ess[mid] = r
    return key_to_id, ess


def load_country_molecules(cur, data, key_to_id, ess, country):
    rows = {}
    for r in data["regm"].itertuples(index=False):
        mid = key_to_id[r.key]
        rows[mid] = dict(list_name=None, on_national_list=False, on_who_eml=bool(r.in_who), facility_level=None,
                         channel_flag=None, note=None, rankable=True, registrations=int(r.registrations),
                         registrants=int(r.registrants), ltrs=int(r.ltrs), manufacturers=int(r.manufacturers),
                         local_made=int(r.local_made), in_combinations=0, forms=_s(r.forms))
    for mid, r in ess.items():
        base = rows.get(mid, dict(registrations=0, registrants=0, ltrs=0, manufacturers=0, local_made=0, forms=None,
                                  on_who_eml=False))
        base.update(list_name=r.molecule, on_national_list=True, on_who_eml=bool(r.in_who) or base.get("on_who_eml", False),
                    facility_level=_s(r.level), channel_flag=_s(r.channel_flag), note=_s(r.note),
                    rankable=bool(r.rankable), in_combinations=int(r.in_combinations))
        rows[mid] = base
    cur.execute("delete from country_molecules where country = %s", (country,))
    cols = ["list_name", "on_national_list", "on_who_eml", "facility_level", "channel_flag", "note", "rankable",
            "registrations", "registrants", "ltrs", "manufacturers", "local_made", "in_combinations", "forms"]
    with cur.copy(f"copy country_molecules (country, molecule_id, {', '.join(cols)}) from stdin") as cp:
        for mid, v in rows.items():
            cp.write_row([country, mid] + [v[c] for c in cols])
    return rows


# ------------------------------------------------------------------ companies
def upsert_companies(cur, data, upload_id):
    comp = data["companies"]
    existing = {k: (i, m) for k, i, m in cur.execute("select cluster_key, id, merged_into from companies").fetchall()}
    new_clusters = set(comp.cluster)
    cluster_to_id, added = {}, 0
    for r in comp.itertuples(index=False):
        if r.cluster in existing:
            cid = existing[r.cluster][0]
            cur.execute("""update companies set display_name = %s, country = %s, is_ltr = %s, is_registrant = %s,
                           is_manufacturer = %s, merged_into = null where id = %s""",
                        (r.display_name, _s(r.country), bool(r.acts_as_ltr), bool(r.is_registrant), bool(r.is_manufacturer), cid))
        else:
            cid = cur.execute("""insert into companies (display_name, cluster_key, country, is_ltr, is_registrant, is_manufacturer)
                                 values (%s, %s, %s, %s, %s, %s) returning id""",
                              (r.display_name, r.cluster, _s(r.country), bool(r.acts_as_ltr), bool(r.is_registrant),
                               bool(r.is_manufacturer))).fetchone()[0]
            if r.acts_as_ltr:
                added += 1
        cluster_to_id[r.cluster] = cid
        for name in {r.cluster, *[a.strip() for a in str(r.aliases).split(" | ") if a.strip()]}:
            cur.execute("""insert into company_aliases (alias, company_id) values (%s, %s)
                           on conflict (alias) do update set company_id = excluded.company_id
                           where company_aliases.source = 'auto'""", (name, cid))
    # companies that disappeared because their names now belong to another cluster: merge them
    merged = 0
    gone = [(k, i) for k, (i, m) in existing.items() if k not in new_clusters and m is None]
    team_alias = dict(cur.execute("select alias, company_id from company_aliases where source = 'team'").fetchall())
    for key, cid in gone:
        into = team_alias.get(key)
        if into is None:
            into = next((cluster_to_id[c] for c in new_clusters if same_company(key, c)), None)
        if into is None or into == cid:
            continue
        merge_company(cur, cid, into, upload_id, "duplicate spelling merged on ingest")
        merged += 1
    return cluster_to_id, added, merged


def merge_company(cur, from_id, into_id, upload_id=None, reason=None, by=None):
    for col in ("registrant_id", "ltr_id", "manufacturer_id"):
        cur.execute(f"update registrations set {col} = %s where {col} = %s", (into_id, from_id))
    cur.execute("update company_aliases set company_id = %s where company_id = %s", (into_id, from_id))
    cur.execute("insert into follows (user_id, company_id) select user_id, %s from follows where company_id = %s "
                "on conflict do nothing", (into_id, from_id))
    cur.execute("delete from follows where company_id = %s", (from_id,))
    cur.execute("update company_claims set company_id = %s where company_id = %s", (into_id, from_id))
    cur.execute("update users set company_id = %s where company_id = %s", (into_id, from_id))
    cur.execute("update companies set merged_into = %s where id = %s", (into_id, from_id))
    cur.execute("insert into company_merges (from_company, into_company, upload_id, decided_by, reason) values (%s, %s, %s, %s, %s)",
                (from_id, into_id, upload_id, by, reason))


# ------------------------------------------------------------------ registrations (diff + upsert + history)
REG_COLS = ["fingerprint", "certificate_no", "molecule_id", "brand", "generic_name", "dosage_form", "form", "strength",
            "api_text", "registrant_id", "ltr_id", "manufacturer_id", "manufacturing_country", "status", "active", "reg_year"]


def load_registrations(cur, data, key_to_id, cluster_to_id, upload_id, country, record_history=True):
    regs = data["regs"]
    cur.execute("create temp table stage_reg (like registrations including defaults) on commit drop")
    cid = lambda c: cluster_to_id.get(c) if isinstance(c, str) else None
    with cur.copy(f"copy stage_reg (country, {', '.join(REG_COLS)}) from stdin") as cp:
        for r in regs.itertuples(index=False):
            yr = r.reg_year
            cp.write_row([country, r.fingerprint, _s(r.certificate_no), key_to_id.get(r.key), _s(r.brand),
                          _s(r.generic_name), _s(r.dosage_form), _s(r.form), _s(r.strength), _s(r.api_text),
                          cid(r.registrant_cluster), cid(r.ltr_cluster), cid(r.manufacturer_cluster),
                          _s(r.manufacturing_country), _s(r.status), bool(r.active), None if pd.isna(yr) else int(yr)])
    params = dict(c=country, u=upload_id)
    # removed: live and active before, absent from this file
    removed = cur.execute("""
        with gone as (
          update registrations r set active = false, removed_upload_id = %(u)s, last_upload_id = %(u)s
          where r.country = %(c)s and r.active and r.removed_upload_id is null
            and not exists (select 1 from stage_reg s where s.fingerprint = r.fingerprint)
          returning r.id, r.status)
        insert into registration_history (upload_id, registration_id, change, before)
        select %(u)s, id, 'removed', jsonb_build_object('status', status) from gone
        where %(h)s returning 1""", dict(params, h=record_history)).rowcount
    if not record_history:
        removed = 0
    # status changes (cancelled / suspended / re-activated) on products we already have
    status_changed = cur.execute("""
        insert into registration_history (upload_id, registration_id, change, before, after)
        select %(u)s, r.id, case when s.active and not r.active then 'reactivated' else 'status' end,
               jsonb_build_object('status', r.status, 'active', r.active), jsonb_build_object('status', s.status, 'active', s.active)
        from registrations r join stage_reg s on s.fingerprint = r.fingerprint and r.country = %(c)s
        where (r.active, coalesce(r.status, '')) is distinct from (s.active, coalesce(s.status, ''))""", params).rowcount
    cancelled = cur.execute("""
        select count(*) from registrations r join stage_reg s on s.fingerprint = r.fingerprint and r.country = %(c)s
        where r.active and not s.active""", params).fetchone()[0]
    cols = [c for c in REG_COLS if c != "fingerprint"]
    cur.execute(f"""update registrations r set {', '.join(f'{c} = s.{c}' for c in cols)}, last_upload_id = %(u)s,
                    removed_upload_id = null
                    from stage_reg s where s.fingerprint = r.fingerprint and r.country = %(c)s""", params)
    added = cur.execute(f"""
        with ins as (
          insert into registrations (country, {', '.join(REG_COLS)}, first_upload_id, last_upload_id)
          select %(c)s, {', '.join('s.' + c for c in REG_COLS)}, %(u)s, %(u)s from stage_reg s
          where not exists (select 1 from registrations r where r.country = %(c)s and r.fingerprint = s.fingerprint)
          returning id, active)
        insert into registration_history (upload_id, registration_id, change)
        select %(u)s, id, 'added' from ins where %(h)s returning 1""", dict(params, h=record_history)).rowcount
    total_new = cur.execute("select count(*) from registrations where first_upload_id = %s", (upload_id,)).fetchone()[0]
    return {"new_registrations": total_new if record_history else 0, "removed_or_cancelled": removed + cancelled,
            "status_changes": status_changed, "loaded_rows": len(regs), "history_rows_added": added}


# ------------------------------------------------------------------ gap scores
def recompute_gaps(cur, country, upload_id=None):
    """Recompute D, S, A and the gap score for every molecule with a demand signal. Returns how many moved >= 1 point."""
    rows = cur.execute("""
        select cm.molecule_id, cm.on_national_list, cm.on_who_eml, cm.facility_level, cm.registrants,
               exists (select 1 from supplier_offers o where o.molecule_id = cm.molecule_id and o.confirmed),
               g.score
        from country_molecules cm left join gap_scores g on g.country = cm.country and g.molecule_id = cm.molecule_id
        where cm.country = %s""", (country,)).fetchall()
    moved, keep = 0, []
    for mid, nat, who, lvl, regs, supply, old in rows:
        sc = score_molecule(nat, who, lvl or "", regs, has_confirmed_supply=supply)
        if sc["D"] <= 0:
            continue
        keep.append(mid)
        cur.execute("""insert into gap_scores (country, molecule_id, demand, saturation, actionability, score, computed_at, upload_id)
                       values (%s, %s, %s, %s, %s, %s, now(), %s)
                       on conflict (country, molecule_id) do update set demand = excluded.demand, saturation = excluded.saturation,
                       actionability = excluded.actionability, score = excluded.score, computed_at = now(), upload_id = excluded.upload_id""",
                    (country, mid, sc["D"], sc["S"], sc["A"], sc["gap_score"], upload_id))
        if old is None or abs(float(old) - sc["gap_score"]) >= 0.05:
            cur.execute("insert into gap_score_history (country, molecule_id, previous_score, score, upload_id) values (%s, %s, %s, %s, %s)",
                        (country, mid, old, sc["gap_score"], upload_id))
            if old is not None and abs(float(old) - sc["gap_score"]) >= 1.0:
                moved += 1
    cur.execute("delete from gap_scores where country = %s and not (molecule_id = any(%s))", (country, keep))
    return moved


def recompute_company_stats(cur, country):
    cur.execute("delete from company_stats where country = %s", (country,))
    cur.execute("""
        insert into company_stats (country, company_id, registrations, molecules, categories, new_recent, manufacturers)
        select %(c)s, x.company_id, count(distinct x.id), count(distinct x.molecule_id), count(distinct m.category),
               count(distinct x.id) filter (where x.reg_year >= extract(year from now())::int - 1),
               count(distinct x.manufacturer_id) filter (where x.manufacturer_id <> x.company_id)
        from (
          select r.id, r.molecule_id, r.reg_year, r.manufacturer_id, c.company_id
          from registrations r
          cross join lateral (values (r.ltr_id), (r.registrant_id), (r.manufacturer_id)) as c(company_id)
          where r.country = %(c)s and r.active and c.company_id is not null
        ) x left join molecules m on m.id = x.molecule_id
        group by x.company_id""", dict(c=country))


def load_review_queues(cur, data, upload_id, country):
    cur.execute("delete from company_review_queue where status = 'open'")
    for r in data["dups"].itertuples(index=False):
        cur.execute("""insert into company_review_queue (a_key, b_key, similarity, upload_id) values (%s, %s, %s, %s)
                       on conflict (a_key, b_key) do nothing""", (r.cluster_a, r.cluster_b, float(r.similarity), upload_id))
    # fuzzy suggestions for essential molecules with no registry match (team accepts or rejects)
    cur.execute("delete from molecule_suggestions where country = %s and status = 'open'", (country,))
    unmatched = data["gap"][data["gap"].reg_key.isna()]
    regm = data["regm"]
    if len(unmatched) and len(regm):
        from rapidfuzz import fuzz, process
        keys = list(regm.key)
        for r in unmatched.itertuples(index=False):
            mine = set(r.key.split())
            # same ingredients spelled differently, not a combination that merely contains this molecule
            options = [k for k in keys if not (mine < set(k.split()))]
            best = process.extractOne(r.key, options, scorer=fuzz.token_sort_ratio)
            if not best or best[1] < 80:
                continue
            src = cur.execute("select molecule_id from molecule_aliases where alias = %s", (r.key,)).fetchone()
            dst = cur.execute("select molecule_id from molecule_aliases where alias = %s", (best[0],)).fetchone()
            if src and dst and src[0] != dst[0]:
                cur.execute("""insert into molecule_suggestions (country, molecule_id, suggested_molecule_id, confidence, source, reason)
                               values (%s, %s, %s, %s, 'fuzzy', %s) on conflict do nothing""",
                            (country, src[0], dst[0], round(best[1], 1), f"name similarity {best[1]:.0f}%"))


def feed_for_new_registrations(cur, upload_id, country, limit=300):
    cur.execute("""
        insert into feed_items (country, kind, title, link, molecule_id, company_id)
        select %s, 'registration', coalesce(m.inn, r.generic_name) || ' registered by ' || coalesce(c.display_name, 'a company'),
               '/molecule/' || r.molecule_id, r.molecule_id, r.ltr_id
        from registrations r left join molecules m on m.id = r.molecule_id left join companies c on c.id = r.ltr_id
        where r.first_upload_id = %s and r.active order by r.id limit %s""", (country, upload_id, limit))
    # paid plans: an alert for every new registration by a followed company or of a watched molecule
    cur.execute("""
        insert into notifications (user_id, channel, subject, body)
        select distinct u.id, 'email', 'New registration',
               coalesce(c.display_name, 'A company') || ' registered ' || coalesce(m.inn, r.generic_name) || ' (' || coalesce(r.brand, '') || ')'
        from registrations r
        left join molecules m on m.id = r.molecule_id left join companies c on c.id = r.ltr_id
        join users u on (exists (select 1 from follows f where f.user_id = u.id and f.company_id = r.ltr_id)
                         or exists (select 1 from watches w where w.user_id = u.id and w.molecule_id = r.molecule_id))
        left join users o on o.id = u.owner_id
        where r.first_upload_id = %s and r.active and coalesce(o.plan, u.plan) = 'paid'""", (upload_id,))


def apply_out(conn, out, upload_id, country=COUNTRY, initial=False):
    """Apply one pipeline output to the database. Caller owns the transaction."""
    data = read_out(out)
    cur = conn.cursor()
    key_to_id, ess = upsert_molecules(cur, data)
    load_country_molecules(cur, data, key_to_id, ess, country)
    cluster_to_id, new_distributors, merged = upsert_companies(cur, data, upload_id)
    reg = load_registrations(cur, data, key_to_id, cluster_to_id, upload_id, country, record_history=not initial)
    moved = recompute_gaps(cur, country, upload_id)
    recompute_company_stats(cur, country)
    load_review_queues(cur, data, upload_id, country)
    if not initial:
        feed_for_new_registrations(cur, upload_id, country)
    comp = data["companies"]
    spellings = sum(len(str(a).split(" | ")) for a in comp.aliases) - len(comp)
    unmatched = int(data["gap"].reg_key.isna().sum())
    return {
        **reg,
        "new_distributors": 0 if initial else new_distributors,
        "gap_scores_moved": 0 if initial else moved,
        "duplicate_spellings_merged": int(spellings),
        "companies_merged": merged,
        "essential_unmatched": unmatched,
        "possible_duplicate_companies": len(data["dups"]),
    }
