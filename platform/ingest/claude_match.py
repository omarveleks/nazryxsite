#!/usr/bin/env python3
"""Suggest registry matches for essential molecules that the rules could not match, using the Claude API.

Suggestions go to the admin review queue (molecule_suggestions, source 'claude'). Nothing is applied until a team
member accepts it, so a wrong suggestion never changes scores. Runs only when ANTHROPIC_API_KEY (or another
Anthropic credential) is configured:

  python claude_match.py            # all open unmatched essential molecules
  python claude_match.py --limit 20
"""
import argparse
import json
import logging
import os
import sys

from rapidfuzz import fuzz, process

from db import connect

log = logging.getLogger("claude_match")
MODEL = os.environ.get("CLAUDE_MATCH_MODEL", "claude-opus-5-5")
BATCH = 25
CANDIDATES = 12

SCHEMA = {
    "type": "object",
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "match": {"type": ["string", "null"]},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["id", "match", "confidence", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["matches"],
    "additionalProperties": False,
}

SYSTEM = (
    "You match medicines from a national essential medicines list to products in a national medicines registry. "
    "Each essential medicine comes with candidate registry names. A match means the same active ingredient(s): "
    "salts, esters, spelling variants (British/US, INN vs common name) and OCR typos count as the same; a different "
    "combination, a different ingredient or a veterinary product does not. If no candidate is the same medicine, "
    "return null. Only pick names from the candidate list. Confidence is 0 to 1."
)


def build_prompt(items):
    lines = []
    for it in items:
        lines.append(f"id {it['id']}: {it['name']} ({it['category'] or 'no class'})")
        lines.append("  candidates: " + " | ".join(it["candidates"]))
    return "Match each essential medicine to one candidate, or null.\n\n" + "\n".join(lines)


def parse_matches(text, items):
    """Validate the model's JSON against the candidate lists; drop anything not offered as a candidate."""
    data = json.loads(text)
    allowed = {it["id"]: set(it["candidates"]) for it in items}
    out = []
    for m in data.get("matches", []):
        if m.get("match") and m["id"] in allowed and m["match"] in allowed[m["id"]]:
            out.append({"id": m["id"], "match": m["match"], "confidence": max(0.0, min(1.0, float(m["confidence"]))),
                        "reason": str(m.get("reason", ""))[:300]})
    return out


def ask_claude(client, items):
    import anthropic
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM,
        messages=[{"role": "user", "content": build_prompt(items)}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],   # on a refusal the API retries on a fallback model
        fallbacks="default",
    )
    if response.stop_reason == "refusal":
        log.warning("request declined (%s)", getattr(response.stop_details, "category", None))
        return []
    if response.stop_reason == "max_tokens":
        log.warning("response cut off; try a smaller batch")
        return []
    text = next((b.text for b in response.content if b.type == "text"), "")
    return parse_matches(text, items)


def run(limit=None, client=None):
    if client is None:
        import anthropic
        try:
            client = anthropic.Anthropic()
        except anthropic.AnthropicError as e:
            log.info("no Anthropic credentials, skipping Claude matching (%s)", e)
            return 0
    with connect() as conn:
        cur = conn.cursor()
        reg = cur.execute("""select m.inn, m.id from molecules m join country_molecules cm on cm.molecule_id = m.id
                             where cm.country = 'TZ' and cm.registrations > 0""").fetchall()
        names = {n: i for n, i in reg}
        todo = cur.execute("""select m.id, m.inn, m.category from country_molecules cm join molecules m on m.id = cm.molecule_id
                              where cm.country = 'TZ' and cm.on_national_list and cm.registrations = 0 and cm.rankable
                                and not exists (select 1 from molecule_suggestions s where s.molecule_id = m.id)
                              order by m.id""").fetchall()
        if limit:
            todo = todo[:limit]
        items = [{"id": i, "name": n, "category": c,
                  "candidates": [x[0] for x in process.extract(n, list(names), scorer=fuzz.token_set_ratio, limit=CANDIDATES)]}
                 for i, n, c in todo]
        saved = 0
        for k in range(0, len(items), BATCH):
            for m in ask_claude(client, items[k:k + BATCH]):
                cur.execute("""insert into molecule_suggestions (country, molecule_id, suggested_molecule_id, confidence, source, reason)
                               values ('TZ', %s, %s, %s, 'claude', %s) on conflict do nothing""",
                            (m["id"], names[m["match"]], round(100 * m["confidence"], 1), m["reason"]))
                saved += 1
            conn.commit()
    log.info("saved %s Claude suggestions for %s molecules", saved, len(items))
    return saved


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    a = argparse.ArgumentParser()
    a.add_argument("--limit", type=int)
    x = a.parse_args()
    sys.exit(0 if run(x.limit) >= 0 else 1)
