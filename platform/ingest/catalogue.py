#!/usr/bin/env python3
"""Read manufacturers' catalogues (Excel, Word, PDF) into their product list, so products appear without waiting for the team.

CSV and text catalogues are added by the web app the moment they are uploaded; this handles the rest. With an Anthropic
credential, Claude reads the file and lists each product (generic name, strength, form); without one, Excel and Word are
read by their columns and lines, and a PDF is left for the team ('manual'). Every product is matched to a molecule the
same way the app matches a typed name.
"""
import base64
import csv
import io
import json
import logging
import os
import re
import unicodedata
import zipfile

from rapidfuzz import fuzz, process

from pipeline.norm import SYNONYMS, molecule_key, molecule_parts

log = logging.getLogger("catalogue")
MAX_PRODUCTS = 500
FORM_WORDS = {"tablet", "tablets", "tab", "tabs", "capsule", "capsules", "cap", "caps", "injection", "inj", "syrup", "suspension",
              "cream", "ointment", "gel", "drops", "eye", "ear", "oral", "solution", "powder", "for", "infusion", "bp", "usp", "ip",
              "and", "with", "film", "coated", "dispersible", "sr", "er", "mr", "forte", "plus", "sachet", "sachets", "lotion", "vial",
              "ampoule"}
STRENGTH = re.compile(r"[\d.,]+\s*(mg|mcg|µg|g|ml|iu|%)(\s*/\s*[\d.,]*\s*(ml|g))?", re.I)
FORM = re.compile(r"tablets?|capsules?|injection|infusion|syrup|suspension|cream|ointment|gel|drops|inhaler|powder|solution|suppositor(y|ies)", re.I)
# Column headers: the generic name (DCI is French and Spanish for INN) and the product or brand name
GENERIC_HEADERS = ("dci", "inn", "generic", "molecule", "active", "substance", "composition", "principe", "wirkstoff")
NAME_HEADERS = ("trade", "brand", "product", "name", "description", "item", "designation", "libell", "nom")
# French, Spanish and German salt and descriptor words the shared molecule key does not know
EXTRA_SALTS = {"chlorhydrate", "hydrochlorure", "fulmarate", "fumarato", "maleato", "micronise", "micronisee", "trihydrate",
               "sodique", "potassique", "calcique", "base"}
# French spellings and vitamin names the shared synonyms do not cover
LOCAL_NAMES = [(r"\bvitamine\b", "vitamin"), (r"\bvitamin d3?\b", "cholecalciferol"), (r"\bvitamin d2\b", "ergocalciferol"),
               (r"\bvitamin ([a-z])\b", r"vitamin-\1"),
               (r"\bacide\s+([a-z]+)", r"\1 acid"), (r"\bacido\s+([a-z]+)", r"\1 acid")]
INN_LIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog", "atc_names.csv")

SCHEMA = {
    "type": "object",
    "properties": {"products": {"type": "array", "items": {
        "type": "object",
        "properties": {"generic": {"type": "string"}, "strength": {"type": ["string", "null"]}, "form": {"type": ["string", "null"]},
                       "line": {"type": "string"}},
        "required": ["generic", "strength", "form", "line"], "additionalProperties": False}}},
    "required": ["products"], "additionalProperties": False,
}
SYSTEM = ("You read a pharmaceutical manufacturer's product catalogue and list every finished medicine in it, once each. For each: "
          "the generic name (INN; for a combination, the INNs joined with ' + '), the strength as written, the dosage form in "
          "English, and a short line as the manufacturer would write it (generic name, strength, form). Skip headings, "
          "company details, prices, packaging-only rows, devices and anything that is not a medicine.")


def molecule_keyish(name):
    """The same key as the web app's moleculeKeyish (lib/match.ts)."""
    t = re.sub(r"\(.*?\)|\[.*?\]", " ", name.lower())
    t = re.sub(r"\b[\d.,]+\s*(mg|mcg|µg|g|ml|iu|%|units?)\b", " ", t)
    t = re.sub(r"[^a-z\- ]", " ", t)
    return " ".join(sorted({w for w in t.split() if len(w) > 1 and w not in FORM_WORDS}))


def find_molecule(cur, name):
    key = molecule_keyish(name)
    r = cur.execute("""select id from molecules where lower(inn) = lower(%s)
                       union all select molecule_id from molecule_aliases where alias = %s
                       union all (select molecule_id from molecule_aliases where length(%s) >= 8 and alias like %s || ' %%'
                                  order by length(alias) limit 1)
                       limit 1""", (name, key, key, key)).fetchone()
    return r[0] if r else None


def _cell(c):
    return re.sub(r"\s+", " ", ("" if c is None else str(c)).replace("\xa0", " ")).strip()


def _header_col(header, keys, skip=None):
    return next((i for key in keys for i, h in enumerate(header) if i != skip and key in h and len(h) < 40), None)


def _table(rows):
    """(rows, header row index, header, generic column, name column, extra columns); index None without a header."""
    rows = [[_cell(c) for c in r] for r in rows]
    rows = [r for r in rows if any(r)]
    for k, r in enumerate(rows[:15]):
        h = [c.lower() for c in r]
        if sum(bool(c) for c in r) >= 2 and (_header_col(h, GENERIC_HEADERS) is not None or _header_col(h, NAME_HEADERS) is not None):
            gen_col = _header_col(h, GENERIC_HEADERS)
            name_col = _header_col(h, NAME_HEADERS, skip=gen_col)
            if name_col is None:
                name_col, gen_col = gen_col, None
            extra = [i for i, x in enumerate(h) if i not in (name_col, gen_col)
                     and any(w in x for w in ("strength", "dose", "dosage", "form", "presentation"))]
            return rows, k, h, gen_col, name_col, extra
    return rows, None, None, None, None, None


def header_line(rows):
    """The header as an earlier reader saved it by mistake (e.g. 'TRADE NAME FORM'), to tidy away."""
    rows, at, h, _g, name_col, extra = _table(rows)
    return None if at is None else " ".join(c for c in [rows[at][name_col]] + [rows[at][i] for i in extra] if c).lower()


def from_rows(rows):
    """Products from one table: [(line, generic, form)]. The line is the product as the catalogue names it (brand, strength,
    form); the generic is the generic-name column when there is one, else the line itself. Titles above the header and
    section headings inside the table (one filled cell) are skipped."""
    rows, at, header, gen_col, name_col, extra = _table(rows)
    if not rows:
        return []
    if at is None:   # no header: the column with text in most rows
        width = max(len(r) for r in rows)
        col = max(range(width), key=lambda i: sum(bool(re.search(r"[A-Za-z]{3}", r[i] if i < len(r) else "")) for r in rows))
        return [(r[col][:200], r[col], None) for r in rows if col < len(r) and re.search(r"[A-Za-z]{3}", r[col])]
    form_col = next((i for i in extra if "form" in header[i]), None)
    type_col = next((i for i, x in enumerate(header) if x in ("type", "kind", "product type") and i not in (name_col, gen_col)), None)
    group_col = next((i for i, x in enumerate(header) if x in ("use_group", "use group")), None)
    out = []
    for r in rows[at + 1:]:
        if sum(bool(c) for c in r) < 2 or [c.lower() for c in r] == header:
            continue
        get = lambda i: r[i] if i is not None and i < len(r) else ""
        generic = get(gen_col)
        parts = [p for p in [get(name_col) or generic] + [get(i) for i in extra] if p]
        line = parts[0] if parts else ""
        for p in parts[1:]:          # the form once: 'AIRGIX 10 mg Coated Tablets', not '... Coated Tablets Coated Tablets'
            if p.lower() not in line.lower():
                line += " " + p
        if re.search(r"[A-Za-z]{3}", line):
            out.append((line[:200], generic or line, get(form_col) or None))
            LEGACY[line[:200]] = " ".join(parts)[:200]
            kind, group = KINDS.get(get(type_col).lower()), get(group_col).lower()
            if kind or group in GROUPS:
                EXTRA[line[:200]] = (kind, group if group in GROUPS else None)
    return out


def excel_sheets(data):
    """Every sheet of a workbook as rows (each sheet is its own table)."""
    import pandas as pd
    try:
        sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, header=None, dtype=str)
    except Exception:          # an "xls" that is really an HTML table
        sheets = {"t": t for t in pd.read_html(io.BytesIO(data))}
    return [[[None if pd.isna(c) else c for c in r] for r in df.values.tolist()] for df in sheets.values()]


def csv_rows(data):
    text = data.decode("utf-8-sig", "ignore")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    sep = next((d for d in ("\t", ";", ",") if lines and all(d in ln for ln in lines[:5])), None)
    return list(csv.reader(lines, delimiter=sep)) if sep else [[ln] for ln in lines]


def docx_lines(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read("word/document.xml").decode("utf-8", "ignore")
    text = re.sub(r"<[^>]+>", " ", xml.replace("</w:p>", "\n").replace("</w:tc>", "\t"))
    return [re.sub(r"\s+", " ", ln).strip() for ln in text.split("\n") if re.search(r"[A-Za-z]{3}", ln)]


def ask_claude(client, blocks):
    response = client.beta.messages.create(
        model=os.environ.get("CLAUDE_CATALOGUE_MODEL", "claude-opus-5-5"),
        max_tokens=32000,
        system=SYSTEM,
        messages=[{"role": "user", "content": blocks + [{"type": "text", "text": "List every medicine in this catalogue."}]}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError("The catalogue could not be read in full.")
    text = next((b.text for b in response.content if b.type == "text"), "")
    return [p for p in json.loads(text).get("products", []) if p.get("generic", "").strip()]


LEGACY = {}   # product line -> the same product as the earlier reader named it (form repeated), to find it again
EXTRA = {}    # product line -> what a curated list says beyond the name: medicine, device or supplement, and its use group
KINDS = {"md": "device", "device": "device", "medical device": "device", "drug": "medicine", "medicine": "medicine",
         "ds": "supplement", "supplement": "supplement", "dietary supplement": "supplement"}
GROUPS = ("eye_drops", "eye_surgery", "joint", "nasal")


class Products(list):
    headers = ()


def _with_parts(line, generic, strength=None, form=None):
    s, f = STRENGTH.search(line), FORM.search(line)
    return (line[:200], generic, strength or (s.group(0) if s else None), form or (f.group(0) if f else None))


def products_from(name, data, client):
    """[(line, generic, strength, form)] from one file, or None when only the team can read it. A table with a
    generic-name column is read by its columns (exact and free); anything else goes to Claude when there is a key."""
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    text = None
    if ext in ("xlsx", "xls", "csv", "txt"):
        sheets = excel_sheets(data) if ext in ("xlsx", "xls") else [csv_rows(data)]
        found = [p for rows in sheets for p in from_rows(rows)]
        if any(line != generic for line, generic, _f in found) or client is None:
            out = Products(_with_parts(line, generic, form=form) for line, generic, form in found)
            out.headers = {h for h in map(header_line, sheets) if h}
            return out
        text = "\n\n".join("\n".join("\t".join(_cell(c) for c in r) for r in rows) for rows in sheets)
        fallback = [line for line, _g, _f in found]
    elif ext == "docx":
        lines = docx_lines(data)
        text, fallback = "\n".join(lines), lines
    elif ext in ("pdf", "png", "jpg", "jpeg"):
        fallback = None
    else:
        return None
    if client is not None:
        if text is not None:
            blocks = [{"type": "text", "text": text[:300000]}]
        else:
            kind = "document" if ext == "pdf" else "image"
            media = "application/pdf" if ext == "pdf" else ("image/png" if ext == "png" else "image/jpeg")
            blocks = [{"type": kind, "source": {"type": "base64", "media_type": media, "data": base64.b64encode(data).decode()}}]
        found = ask_claude(client, blocks)
        return [((p.get("line") or p["generic"])[:200], p["generic"], p.get("strength"), p.get("form")) for p in found]
    if fallback is None:
        return None
    return [_with_parts(line, line) for line in fallback]


class Generics:
    """Generic names as catalogues write them (French, Spanish, German spellings, salts, small typos) to our molecules.
    Each ingredient is corrected against the molecules we track and the WHO INN list; a corrected name that is a real
    INN but not yet on any market becomes a molecule, so the product shows as an opening instead of 'not matched'."""

    def __init__(self, cur):
        self.by_key = dict(cur.execute("select canonical_key, id from molecules").fetchall())
        self.by_key.update(cur.execute("select alias, molecule_id from molecule_aliases").fetchall())
        self.inn = {}
        if os.path.exists(INN_LIST):
            for row in csv.DictReader(open(INN_LIST, encoding="utf-8")):
                k = molecule_key(row["en"])
                if k and k not in self.inn:
                    self.inn[k] = (row["en"], row["atc"])
        self.vocab = sorted({t for k in [*self.by_key, *self.inn, *(x for x in SYNONYMS if " " not in x)] for t in k.split()})
        self.words = set(self.vocab)
        self.memo = {}

    @staticmethod
    def clean(name):
        s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
        for pat, rep in LOCAL_NAMES:
            s = re.sub(pat, rep, s)
        return " ".join(w for w in re.split(r"(\s+|\+|/|&)", s) if w.strip() not in EXTRA_SALTS)

    def token(self, t):
        """One word corrected to a known ingredient word: a missing or extra final 'e' (French, German), else a close
        spelling that starts the same way (Clarytromicin, Pentoxyfyllin). Unknown words stay as they are."""
        if t in self.memo:
            return self.memo[t]
        out = t
        if t not in self.words:
            for c in (t + "e", t[:-1] if t.endswith("e") else None):
                if c and c in self.words:
                    out = c
                    break
            else:
                if len(t) >= 6 and "-" not in t:   # 'vitamin-e' is not a misspelt 'vitamin'
                    hits = [h for c in {t, t + "e"} for h in [process.extractOne(c, self.vocab, scorer=fuzz.ratio, score_cutoff=80)] if h]
                    hits = [h for h in hits if h[0][:3] == t[:3] and abs(len(h[0]) - len(t)) <= 2]
                    if hits:
                        out = max(hits, key=lambda h: h[1])[0]
        self.memo[t] = out
        return out

    def molecule(self, cur, name):
        s = self.clean(name)
        k = molecule_key(s)
        if not k:
            return None
        if k in self.by_key:
            return self.by_key[k]
        parts = [molecule_key(" ".join(self.token(t) for t in p.split())) for p in molecule_parts(s)]
        fixed = " ".join(sorted({t for p in parts for t in p.split()}))
        if fixed in self.by_key:
            return self.by_key[fixed]
        if fixed in self.inn:     # a real INN nobody has registered in our markets yet
            from country_load import atc_class
            inn, atc = self.inn[fixed]
            mid = cur.execute("""insert into molecules (canonical_key, inn, category) values (%s, %s, %s)
                                 on conflict (canonical_key) do update set canonical_key = excluded.canonical_key returning id""",
                              (fixed, inn[:1].upper() + inn[1:], atc_class(atc))).fetchone()[0]
            self.by_key[fixed] = mid
            return mid
        return None


def new_molecule(cur, generic):
    """A medicine on a manufacturer's list that no market registers yet: kept as a molecule, so it shows as an opening."""
    key = molecule_key(generic)
    if not key:
        return None
    hit = cur.execute("select molecule_id from molecule_aliases where alias = %s union all select id from molecules where canonical_key = %s",
                      (key, key)).fetchone()
    if hit:
        return hit[0]
    name = " + ".join(p.strip()[:1].upper() + p.strip()[1:] for p in re.split(r"\s*\+\s*", generic.strip()))
    return cur.execute("insert into molecules (canonical_key, inn) values (%s, %s) returning id", (key, name[:200])).fetchone()[0]


def add_products(cur, user_id, products, generics=None, refresh_only=False):
    """Adds the products not yet in the list; a product already there but not matched (an earlier read) gets its
    molecule now, and one already matched gets any missing form and strength. With refresh_only nothing is added.
    Returns (products in the file, matched)."""
    added = matched = 0
    norm = lambda x: re.sub(r"\s+", " ", x).strip().lower()
    have = {norm(n): (pid, mol) for pid, n, mol in cur.execute("select id, name, molecule_id from mfr_products where user_id = %s",
                                                                (user_id,)).fetchall()}
    seen = set()
    for line, generic, strength, form in products[:MAX_PRODUCTS]:
        if norm(line) in seen:
            continue
        seen.add(norm(line))
        old = have.get(norm(line)) or have.get(norm(LEGACY.get(line, line)))
        if old and old[1]:
            cur.execute("update mfr_products set strength = coalesce(strength, %s), dosage_form = coalesce(dosage_form, %s) where id = %s",
                        ((strength or None) and strength[:40], (form or None) and form[:40], old[0]))
            continue
        if not old and refresh_only:
            continue
        kind, group = EXTRA.get(line, (None, None))
        exact = cur.execute("""select coalesce(a.molecule_id, m.id) from molecules m left join molecule_aliases a on a.alias = m.canonical_key
                               where lower(m.inn) = lower(%s) limit 1""", (generic,)).fetchone() if generic != line else None
        if exact:
            mol = exact[0]
        elif generics:
            mol = generics.molecule(cur, generic) or (generics.molecule(cur, line) if generic == line else None)
        else:
            mol = find_molecule(cur, generic) or find_molecule(cur, line)
        if not mol and kind in ("medicine", "supplement") and generic != line:
            mol = new_molecule(cur, generic)
        atc = cur.execute("select atc from medicine_catalog where lower(name) = lower(%s) limit 1", (generic,)).fetchone()
        if old:
            cur.execute("""update mfr_products set name = %s, molecule_id = %s, atc = coalesce(atc, %s), strength = coalesce(strength, %s),
                           dosage_form = coalesce(dosage_form, %s), kind = coalesce(%s, kind), use_group = coalesce(%s, use_group) where id = %s""",
                        (line, mol, atc[0] if atc else None, (strength or None) and strength[:40], (form or None) and form[:40], kind, group, old[0]))
        else:
            cur.execute("""insert into mfr_products (user_id, name, molecule_id, strength, dosage_form, atc, kind, use_group)
                           values (%s, %s, %s, %s, %s, %s, %s, %s)""",
                        (user_id, line, mol, (strength or None) and strength[:40], (form or None) and form[:40], atc[0] if atc else None,
                         kind, group))
        added += 1
        matched += bool(mol)
    return added, matched


def run(cur, client="auto"):
    """Read every queued catalogue. Returns how many were read."""
    files = cur.execute("""select id, user_id, file_name, file_path, refresh_only from mfr_files
                           where kind = 'catalogue' and status = 'queued' order by id limit 5""").fetchall()
    if not files:
        return 0
    if client == "auto":
        client = None
        if os.environ.get("ANTHROPIC_API_KEY"):
            import anthropic
            try:
                client = anthropic.Anthropic()
            except anthropic.AnthropicError:
                client = None
    done = 0
    generics = Generics(cur)
    for fid, user_id, name, path, refresh_only in files:
        cur.execute("savepoint cat")
        try:
            m = re.match(r"^db:([0-9a-f-]{36})$", path or "")
            row = cur.execute("select data from stored_files where id = %s", (m.group(1),)).fetchone() if m else None
            products = products_from(name, bytes(row[0]), client) if row else None
            if products is None:
                cur.execute("update mfr_files set status = 'manual' where id = %s", (fid,))
                cur.execute("insert into notifications (user_id, channel, subject, body) values (null, 'email', %s, %s)",
                            ("Catalogue to load by hand", f"{name}: this file needs the team to add its products."))
            else:
                added, matched = add_products(cur, user_id, products, generics, refresh_only)
                if getattr(products, "headers", None):   # a header row an earlier reader took for a product
                    cur.execute("delete from mfr_products where user_id = %s and molecule_id is null and lower(name) = any(%s)",
                                (user_id, list(products.headers)))
                cur.execute("""update mfr_files set status = 'done', refresh_only = false, error = null,
                               added = case when %s then added else %s end, matched = case when %s then matched else %s end where id = %s""",
                            (refresh_only, added, refresh_only, matched, fid))
                if added > matched and not refresh_only:
                    cur.execute("insert into notifications (user_id, channel, subject, body) values (null, 'email', %s, %s)",
                                ("Catalogue loaded: products to match", f"{name}: {added} products added, {added - matched} to match by hand."))
                done += 1
            cur.execute("release savepoint cat")
        except Exception as e:
            cur.execute("rollback to savepoint cat")
            cur.execute("update mfr_files set status = 'failed', error = %s where id = %s",
                        ("We could not read this file. Our team will add the products.", fid))
            cur.execute("insert into notifications (user_id, channel, subject, body) values (null, 'email', %s, %s)",
                        ("Catalogue could not be read", f"{name}: {str(e)[:200]}"))
            log.exception("catalogue %s failed", fid)
    return done
