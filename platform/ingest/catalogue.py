#!/usr/bin/env python3
"""Read manufacturers' catalogues (Excel, Word, PDF) into their product list, so products appear without waiting for the team.

CSV and text catalogues are added by the web app the moment they are uploaded; this handles the rest. With an Anthropic
credential, Claude reads the file and lists each product (generic name, strength, form); without one, Excel and Word are
read by their columns and lines, and a PDF is left for the team ('manual'). Every product is matched to a molecule the
same way the app matches a typed name.
"""
import base64
import io
import json
import logging
import os
import re
import zipfile

log = logging.getLogger("catalogue")
MAX_PRODUCTS = 500
FORM_WORDS = {"tablet", "tablets", "tab", "tabs", "capsule", "capsules", "cap", "caps", "injection", "inj", "syrup", "suspension",
              "cream", "ointment", "gel", "drops", "eye", "ear", "oral", "solution", "powder", "for", "infusion", "bp", "usp", "ip",
              "and", "with", "film", "coated", "dispersible", "sr", "er", "mr", "forte", "plus", "sachet", "sachets", "lotion", "vial",
              "ampoule"}
STRENGTH = re.compile(r"[\d.,]+\s*(mg|mcg|µg|g|ml|iu|%)(\s*/\s*[\d.,]*\s*(ml|g))?", re.I)
FORM = re.compile(r"tablets?|capsules?|injection|infusion|syrup|suspension|cream|ointment|gel|drops|inhaler|powder|solution|suppositor(y|ies)", re.I)
NAME_HEADERS = ("generic", "inn", "molecule", "active", "product", "name", "description", "item")

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
                       union all (select molecule_id from molecule_aliases where alias like %s || ' %%' order by length(alias) limit 1)
                       limit 1""", (name, key, key)).fetchone()
    return r[0] if r else None


def from_rows(rows):
    """Product lines from a table: the name-like column, with strength and form columns when there are any."""
    rows = [[("" if c is None else str(c)).strip() for c in r] for r in rows if any(c not in (None, "") for c in r)]
    if not rows:
        return []
    # the header row: within the first rows, the one naming a product or generic-name column (titles above it are skipped)
    at, name_col = next(((k, i) for k, r in enumerate(rows[:10]) if sum(bool(c) for c in r) >= 2
                         for key in NAME_HEADERS for i, h in enumerate(r) if key in h.lower() and len(h) < 40), (None, None))
    header = [h.lower() for h in rows[at]] if at is not None else []
    if name_col is None:   # no header: the column with text in most rows
        width = max(len(r) for r in rows)
        name_col = max(range(width), key=lambda i: sum(bool(re.search(r"[A-Za-z]{3}", r[i] if i < len(r) else "")) for r in rows))
        body = rows
    else:
        body = rows[at + 1:]
    extra = [i for i, h in enumerate(header) if i != name_col and any(k in h for k in ("strength", "dose", "form", "presentation"))]
    lines = []
    for r in body:
        parts = [r[name_col] if name_col < len(r) else ""] + [r[i] for i in extra if i < len(r)]
        line = " ".join(p for p in parts if p)
        if re.search(r"[A-Za-z]{3}", line):
            lines.append(line[:200])
    return lines


def excel_rows(data, name):
    import pandas as pd
    try:
        sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, header=None, dtype=str)
    except Exception:          # an "xls" that is really an HTML table
        sheets = {"t": t for t in pd.read_html(io.BytesIO(data))}
    out = []
    for df in sheets.values():
        out += [[None if pd.isna(c) else c for c in r] for r in df.values.tolist()]
    return out


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


def products_from(name, data, client):
    """[(line, generic, strength, form)] from one file, or None when only the team can read it."""
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    text = None
    if ext in ("xlsx", "xls"):
        rows = excel_rows(data, name)
        text = "\n".join("\t".join("" if c is None else str(c) for c in r) for r in rows)
        fallback = from_rows(rows)
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
    out = []
    for line in fallback:
        s, f = STRENGTH.search(line), FORM.search(line)
        out.append((line[:200], line, s.group(0) if s else None, f.group(0) if f else None))
    return out


def add_products(cur, user_id, products):
    added = matched = 0
    seen = {r[0].lower() for r in cur.execute("select name from mfr_products where user_id = %s", (user_id,)).fetchall()}
    for line, generic, strength, form in products[:MAX_PRODUCTS]:
        if line.lower() in seen:
            continue
        seen.add(line.lower())
        mol = find_molecule(cur, generic) or find_molecule(cur, line)
        atc = cur.execute("select atc from medicine_catalog where lower(name) = lower(%s) limit 1", (generic,)).fetchone()
        cur.execute("insert into mfr_products (user_id, name, molecule_id, strength, dosage_form, atc) values (%s, %s, %s, %s, %s, %s)",
                    (user_id, line, mol, (strength or None) and strength[:40], (form or None) and form[:40], atc[0] if atc else None))
        added += 1
        matched += bool(mol)
    return added, matched


def run(cur, client="auto"):
    """Read every queued catalogue. Returns how many were read."""
    files = cur.execute("""select id, user_id, file_name, file_path from mfr_files
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
    for fid, user_id, name, path in files:
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
                added, matched = add_products(cur, user_id, products)
                cur.execute("update mfr_files set status = 'done', added = %s, matched = %s, error = null where id = %s",
                            (added, matched, fid))
                if added > matched:
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
