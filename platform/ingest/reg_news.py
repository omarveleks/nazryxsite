"""Regulator news: each news or legal-acts page (data_sources kind 'news') is read daily; new items are stored with an
English title and the molecules they name, so the Regulatory page and the weekly summary can point to what changed.
What a page already shows on its first read is kept as background, not news."""
import html
import re
from urllib.parse import urljoin, urlparse

SKIP = re.compile(r"^(главная|home|контакты|contacts|about|о нас|новости|news|подробнее|read more|далее|ещё|more|login|войти)$", re.I)


def items(page, url):
    """(title, link, date) from an RSS feed or from a page's article links."""
    if "<rss" in page[:500] or "<feed" in page[:500]:
        out = []
        for block in re.findall(r"<(?:item|entry)\b.*?</(?:item|entry)>", page, re.S):
            t = re.search(r"<title[^>]*>(.*?)</title>", block, re.S)
            ln = re.search(r"<link[^>]*>(.*?)</link>|<link[^>]*href=\"([^\"]+)\"", block, re.S)
            d = re.search(r"<(?:pubDate|published|updated)>(.*?)</", block, re.S)
            if t and ln:
                out.append((clean(t.group(1)), (ln.group(1) or ln.group(2)).strip(), d.group(1)[:30] if d else None))
        return out
    host, out, seen = urlparse(url).netloc, [], set()
    for href, text in re.findall(r"<a\b[^>]*href=\"([^\"#]+)\"[^>]*>(.*?)</a>", page, re.S | re.I):
        title = clean(text)
        link = urljoin(url, html.unescape(href))
        path = urlparse(link).path + "?" + urlparse(link).query
        if len(title) < 25 or SKIP.match(title) or urlparse(link).netloc != host or link in seen or link.rstrip("/") == url.rstrip("/"):
            continue
        if not re.search(r"\d", path):
            continue                       # menu links carry no id or date; articles and documents do
        seen.add(link)
        out.append((title, link, None))
    return out[:60]


def clean(text):
    text = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", text, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()[:400]


def collect(cur, s, key, country, url):
    import collect as c
    index = c.MoleculeIndex(cur)
    first = not cur.execute("select 1 from reg_news where source = %s limit 1", (key,)).fetchone()
    r = s.get(url, timeout=60, verify=c.ca_bundle())
    r.raise_for_status()
    new = 0
    for title, link, _ in items(r.text, url):
        cur.execute("""insert into reg_news (country, source, url, title, baseline, molecule_ids) values (%s, %s, %s, %s, %s, %s)
                       on conflict (url) do nothing""", (country, key, link[:1000], title, first, index.find(title)))
        new += cur.rowcount
    return new
