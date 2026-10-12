#!/usr/bin/env python3
"""Read the regulatory documents the team uploads (guidelines, circulars, checklists) and draft the requirements in them.

Each requirement applies to every product in the country, or to a therapeutic class, an ATC code prefix, a dosage form or
one molecule. Drafts appear in Admin > Regulatory; nothing reaches customers until a team member publishes it. Runs only
when an Anthropic credential is configured; without one, documents wait and the team can add requirements by hand.

  python reg_extract.py            # every queued document
"""
import base64
import io
import json
import logging
import re
import zipfile

from db import connect

log = logging.getLogger("reg_extract")
MODEL_ENV = "CLAUDE_REG_MODEL"
TOPICS = ["Route", "Dossier", "Site and GMP", "Labelling", "Marking", "Samples", "Local representative", "Import", "Fees",
          "Timeline", "After approval", "Other"]

SCHEMA = {
    "type": "object",
    "properties": {
        "requirements": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "enum": TOPICS},
                    "applies": {"type": "string", "enum": ["all", "class", "atc", "form", "molecule"]},
                    "match": {"type": ["string", "null"]},
                    "title": {"type": "string"},
                    "body": {"type": "string"},
                },
                "required": ["topic", "applies", "match", "title", "body"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["requirements"],
    "additionalProperties": False,
}

SYSTEM = (
    "You read medicines-regulation documents (guidelines, circulars, checklists) for one country and list what a foreign "
    "manufacturer must do to register and keep a medicine on that market. One requirement per item, in plain English: a "
    "short title (under 8 words) and a body of one or two short sentences a busy export manager understands. Use "
    "applies='all' for requirements on every product (match null); 'class' for a therapeutic class (match: the class name); "
    "'atc' for an ATC code group (match: the code prefix, e.g. J01); 'form' for a dosage form (match: one lowercase word "
    "such as tablet, capsule, inject, infusion, syrup, cream); 'molecule' for one active ingredient (match: its INN in "
    "lowercase). Leave out fee amounts, names of people, companies or officials, and anything not stated in the document. "
    "Do not invent requirements."
)


def clean(items):
    """Keep well-formed items only: a known topic, a match only where one belongs, short text."""
    out = []
    for it in items:
        applies = it.get("applies")
        match = (it.get("match") or "").strip().lower() or None
        if it.get("topic") not in TOPICS or applies not in ("all", "class", "atc", "form", "molecule"):
            continue
        if applies == "all":
            match = None
        elif not match:
            continue
        if applies == "atc":
            match = match.upper()
        title, body = str(it.get("title", "")).strip()[:120], str(it.get("body", "")).strip()[:600]
        if title and body:
            out.append({"topic": it["topic"], "applies": applies, "match": match, "title": title, "body": body})
    return out


def docx_text(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read("word/document.xml").decode("utf-8", "ignore")
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", xml.replace("</w:p>", "\n"))).strip()


def content_for(name, data):
    """The document as Claude content blocks, or None for a type we cannot read (the team adds those by hand)."""
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    if ext == "pdf":
        return [{"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                 "data": base64.b64encode(data).decode()}}]
    if ext in ("png", "jpg", "jpeg"):
        return [{"type": "image", "source": {"type": "base64", "media_type": "image/png" if ext == "png" else "image/jpeg",
                                              "data": base64.b64encode(data).decode()}}]
    if ext == "docx":
        return [{"type": "text", "text": docx_text(data)[:400000]}]
    if ext in ("txt", "csv"):
        return [{"type": "text", "text": data.decode("utf-8", "ignore")[:400000]}]
    return None


def ask_claude(client, country_name, title, blocks):
    import os
    response = client.beta.messages.create(
        model=os.environ.get(MODEL_ENV, "claude-opus-5-5"),
        max_tokens=16000,
        system=SYSTEM,
        messages=[{"role": "user", "content": blocks + [{"type": "text", "text":
                   f"Country: {country_name}. Document: {title}. List the requirements it sets."}]}],
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError("The document could not be read in full. Add its requirements by hand.")
    text = next((b.text for b in response.content if b.type == "text"), "")
    return clean(json.loads(text).get("requirements", []))


def run(client=None):
    with connect() as conn:
        cur = conn.cursor()
        docs = cur.execute("""select d.id, d.country, k.name, d.title, d.file_name, d.file_path from reg_documents d
                              join countries k on k.code = d.country where d.status = 'queued' order by d.id limit 5""").fetchall()
        if not docs:
            return 0
        if client is None:
            import anthropic
            try:
                client = anthropic.Anthropic()
            except anthropic.AnthropicError as e:
                log.info("no Anthropic credentials; regulatory documents wait (%s)", e)
                return 0
        done = 0
        for did, country, country_name, title, file_name, file_path in docs:
            m = re.match(r"^db:([0-9a-f-]{36})$", file_path or "")
            row = cur.execute("select data from stored_files where id = %s", (m.group(1),)).fetchone() if m else None
            blocks = content_for(file_name, bytes(row[0])) if row else None
            if blocks is None:
                cur.execute("""update reg_documents set status = 'manual', read_at = now(),
                               error = 'This file type is not read automatically. Add its requirements by hand.' where id = %s""", (did,))
                conn.commit()
                continue
            cur.execute("update reg_documents set status = 'reading' where id = %s", (did,))
            conn.commit()
            try:
                items = ask_claude(client, country_name, title, blocks)
                for it in items:
                    cur.execute("""insert into reg_requirements (country, topic, applies, match, title, body, status, document_id)
                                   values (%s, %s, %s, %s, %s, %s, 'draft', %s)""",
                                (country, it["topic"], it["applies"], it["match"], it["title"], it["body"], did))
                cur.execute("update reg_documents set status = 'done', found = %s, read_at = now(), error = null where id = %s",
                            (len(items), did))
                done += 1
            except Exception as e:
                conn.rollback()
                cur.execute("update reg_documents set status = 'failed', error = %s, read_at = now() where id = %s", (str(e)[:300], did))
                log.exception("regulatory document %s failed", did)
            conn.commit()
    return done


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    print(run())
