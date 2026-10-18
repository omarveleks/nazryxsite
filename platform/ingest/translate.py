"""Puts tender titles and buyer names into English. Each distinct text is translated once (translations table) and
copied onto every tender that uses it. Without ANTHROPIC_API_KEY nothing happens and pages show the original text."""
import json
import logging
import os

log = logging.getLogger("translate")
BATCH = 60            # texts per request
MAX_BATCHES = 20      # per run, so a large backlog drains over a few runs
LOCAL_LATIN = ("UZ",)   # markets whose Latin-script text is not English (Uzbek)

SYSTEM = ("You translate public procurement text from Kazakhstan, Kyrgyzstan and Uzbekistan (Russian, Kazakh, Kyrgyz, "
          "Uzbek in Cyrillic or Latin) into short, plain English. Keep medicine names as international non-proprietary "
          "names in English, keep doses, units, lot numbers and codes as written. For organisations, translate the type "
          "and place (e.g. 'Naryn Regional Joint Hospital', 'SK-Pharmacy LLP') and transliterate proper names. "
          "Text that is in two languages: translate once. Text already in English: return it unchanged.")
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["items"],
          "properties": {"items": {"type": "array", "items": {
              "type": "object", "additionalProperties": False, "required": ["i", "en"],
              "properties": {"i": {"type": "integer"}, "en": {"type": "string"}}}}}}


def client_from_env():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None
    import anthropic
    try:
        return anthropic.Anthropic()
    except anthropic.AnthropicError:
        return None


def ask(client, texts):
    numbered = "\n".join(json.dumps({"i": i, "text": t}, ensure_ascii=False) for i, t in enumerate(texts))
    response = client.beta.messages.create(
        model=os.environ.get("CLAUDE_TRANSLATE_MODEL", "claude-opus-5-5"),
        max_tokens=16000,
        system=SYSTEM,
        messages=[{"role": "user", "content": f"Translate each text to English. Return one item per i.\n{numbered}"}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"translation stopped: {response.stop_reason}")
    text = next((b.text for b in response.content if b.type == "text"), "")
    return {it["i"]: it["en"].strip() for it in json.loads(text).get("items", []) if 0 <= it["i"] < len(texts) and it["en"].strip()}


def apply(cur):
    """Copy known translations onto every tender and regulator notice that uses the same text."""
    for col in ("title", "buyer"):
        cur.execute(f"""update tenders t set {col}_en = tr.en from translations tr
                        where t.{col}_en is null and tr.src = t.{col}""")
    cur.execute("""update reg_news n set title_en = tr.en from translations tr where n.title_en is null and tr.src = n.title""")


def pending(cur, limit):
    rows = cur.execute("""select distinct x from (select title as x, country from tenders where title_en is null
                            union all select buyer, country from tenders where buyer is not null and buyer_en is null
                            union all select title, country from reg_news where title_en is null and not baseline) s
                          where (x ~ '[Ѐ-ӿ]' or country = any(%s))
                            and not exists (select 1 from translations tr where tr.src = s.x)
                          limit %s""", (list(LOCAL_LATIN), limit)).fetchall()
    return [r[0] for r in rows]


def run(cur, client="auto"):
    """Translate what is missing. Returns how many new texts were translated."""
    apply(cur)
    if client == "auto":
        client = client_from_env()
    if client is None:
        return 0
    done = 0
    for _ in range(MAX_BATCHES):
        texts = pending(cur, BATCH)
        if not texts:
            break
        try:
            got = ask(client, texts)
        except Exception:
            log.exception("translation failed")
            break
        for i, en in got.items():
            cur.execute("insert into translations (src, en) values (%s, %s) on conflict (src) do nothing", (texts[i], en))
        done += len(got)
        if not got:
            break
    apply(cur)
    return done
