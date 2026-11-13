#!/usr/bin/env python3
"""Render the Nazryx site from structured content.

    content/site.json          shared data (company, contact, stats, regions, markets, commitments, FAQ)
    content/pages/*.json       one file per page: path, meta, theme, and an ordered list of typed sections

Run: python3 tools/build.py      Output goes to site/ and is committed; Cloudflare serves it as-is.
Every page must have at least 6 sections (checked below).
"""
import html
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE, CONTENT = ROOT / "site", ROOT / "content"
BASE = "https://nazryx.com"
D = json.loads((CONTENT / "site.json").read_text())
LOGO = '<svg viewBox="0 0 837 346" aria-hidden="true"><path d="M171 0 L403 0 L613 210 L613 0 L837 0 L837 198 L689 346 L461 346 L295 179 L131 346 L0 346 L0 174 Z" fill="#1259E6"/></svg>'
WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>'
e = lambda s: html.escape(str(s), quote=True)


def slug(s):
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-")


# ------------------------------------------------------------------ building blocks
def title(sec, tag="h2"):
    t = e(sec.get("title", ""))
    if sec.get("accent"):
        t += f' <span class="ac">{e(sec["accent"])}</span>'
    return f"<{tag}>{t}</{tag}>"


def head(sec):
    eb = f'<div class="eyebrow">{e(sec["eyebrow"])}</div>' if sec.get("eyebrow") else ""
    lede = f'<p class="lede">{e(sec["lede"])}</p>' if sec.get("lede") else "<div></div>"
    return f'<div class="head rv"><div>{eb}{title(sec)}</div>{lede}</div>'


def btn(c, cls="btn-blue"):
    if c == "primary":
        c, cls = D["primaryCta"], "btn-blue"
    elif c == "secondary":
        c, cls = D["secondaryCta"], "btn-line"
    return f'<a class="btn {cls}" href="{e(c["href"])}" data-track="cta:{slug(c["label"])}">{e(c["label"])}</a>'


def stat(item):
    s = D["stats"][item] if isinstance(item, str) else item
    return s["value"], s["label"]


def side(sd):
    sub = "<span>" + e(sd["sub"]) + "</span>" if sd.get("sub") else ""
    top = f'<div class="side-top"><b>{e(sd["title"])}</b>{sub}</div>'
    if sd["kind"] == "regions":
        rows = "".join(f'<div><dt>{e(r["name"])}</dt><dd>{e(", ".join(D["markets"][m].get("short", D["markets"][m]["name"]) for m in r["markets"]))}</dd></div>' for r in D["regions"])
        return f'<div class="side rv">{top}<dl>{rows}</dl></div>'
    if sd["kind"] == "kv":
        rows = "".join(f"<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>" for k, v in sd["rows"])
        return f'<div class="side rv">{top}<dl>{rows}</dl></div>'
    figs = "".join(f"<div><b>{e(v)}</b><span>{e(l)}</span></div>" for v, l in map(stat, sd["items"]))
    return f'<div class="side rv">{top}<div class="figs">{figs}</div></div>'


def market_names(r):
    return ", ".join(D["markets"][m].get("short", D["markets"][m]["name"]) for m in r["markets"])


def contact_dl():
    rows = "".join(f'<div><dt>{e(p["label"])}</dt><dd><a href="tel:{p["tel"]}" data-track="phone:{p["tel"]}">{e(p["display"])}</a></dd></div>' for p in D["contact"]["phones"])
    rows += f'<div><dt>Email</dt><dd><a href="mailto:{D["contact"]["email"]}" data-track="email">{D["contact"]["email"]}</a></dd></div>'
    return f"<dl>{rows}</dl>"


# ------------------------------------------------------------------ section renderers
def r_hero(s, p):
    btns = "".join(btn(c) for c in s.get("ctas", []))
    trust = f'<p class="trust">{e(s["trust"])}</p>' if s.get("trust") else ""
    eb = f'<div class="eyebrow">{e(s["eyebrow"])}</div>' if s.get("eyebrow") else ""
    sd = side(s["side"]) if s.get("side") else ""
    return f'<section class="wrap hero"><div class="hero-grid"><div class="rv">{eb}{title(s, "h1")}<p class="lede">{e(s["lede"])}</p><div class="btns">{btns}</div>{trust}</div>{sd}</div></section>'


def r_stats(s, p):
    tiles = "".join(f'<div class="stat rv"><b>{e(v)}</b><span>{e(l)}</span></div>' for v, l in map(stat, s["items"]))
    return f'<section class="wrap stats-sec" aria-label="Key figures"><div class="stats">{tiles}</div></section>'


def r_cards(s, p):
    out = ""
    for i, it in enumerate(s["items"], 1):
        n = f'<span class="n">{i:02d}</span>' if s.get("style") == "numbered" else ""
        lbl = f'<span class="lbl">{e(it["label"])}</span>' if it.get("label") else ""
        go = '<span class="go">Learn more &rarr;</span>' if it.get("href") else ""
        tag, href = ("a", f' href="{e(it["href"])}"') if it.get("href") else ("div", "")
        out += f'<{tag} class="card rv{" featured" if it.get("featured") else ""}"{href}>{n}{lbl}<h3>{e(it["title"])}</h3><p>{e(it["text"])}</p>{go}</{tag}>'
    return f'<section class="wrap" id="{s.get("id", "")}">{head(s)}<div class="grid c{s.get("cols", 3)} {s.get("style", "")}">{out}</div></section>'


def r_offers(s, p):
    out = ""
    for it in s["items"]:
        pts = "".join(f"<li>{e(x)}</li>" for x in it["points"])
        b = btn({"label": it["cta"], "href": it["href"]}, "btn-white" if it.get("featured") else "btn-blue")
        out += f'<div class="offer rv{" featured" if it.get("featured") else ""}"><span class="card-lbl">{e(it["label"])}</span><h3>{e(it["title"])}</h3><p>{e(it["text"])}</p><ul>{pts}</ul>{b}</div>'
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="offers">{out}</div></section>'


def r_steps(s, p):
    n = len(s["items"])
    out = "".join(f'<div class="rv{" last" if it.get("dark") else ""}"><small>{e(it["when"])}</small><b>{e(it["title"])}</b><p>{e(it["text"])}</p></div>' for it in s["items"])
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="steps c{min(n, 4)}">{out}</div></section>'


def r_regions(s, p):
    out = ""
    for r in D["regions"]:
        names = []
        for m in r["markets"]:
            mk = D["markets"][m]
            nm = e(mk.get("short", mk["name"]))
            names.append(f'<a href="{mk["file"]}">{nm}</a>' if mk.get("file") else nm)
        out += f'<div class="region rv"><small>{e(r["name"])}</small><b>{", ".join(names)}</b><p>{e(r["role"])}</p></div>'
    link = f'<a class="more" href="{s["link"]["href"]}">{e(s["link"]["label"])} &rarr;</a>' if s.get("link") else ""
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="regions">{out}</div>{link}</section>'


def r_marketCards(s, p):
    out = ""
    for r in D["regions"]:
        for m in r["markets"]:
            mk = D["markets"][m]
            facts = "".join(f"<li>{e(f)}</li>" for f in mk["facts"][:2])
            go = (f'<a class="go" href="{mk["file"]}">{"Full market file" if m == "kz" else "Market overview"} &rarr;</a>' if mk.get("file")
                  else f'<a class="go req" href="mailto:{D["contact"]["email"]}?subject={e(mk["name"])}%20market%20file" data-track="markets:request">Market file on request</a>')
            out += f'<div class="mcard rv{" full" if mk.get("file") else ""}"><small>{e(r["name"])}</small><h3>{e(mk["name"])}</h3><ul>{facts}</ul>{go}</div>'
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="mcards">{out}</div></section>'


def r_chips(s, p):
    items = D[s["items"]] if isinstance(s["items"], str) else s["items"]
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="chipset rv">{"".join(f"<span>{e(x)}</span>" for x in items)}</div></section>'


def r_proof(s, p):
    out = ""
    for it in s["items"]:
        figs = "".join(f"<div><b>{e(v)}</b><span>{e(k)}</span></div>" for k, v in it["figures"])
        out += f'<div class="card rv"><h3>{e(it["title"])}</h3><p>{e(it["text"])}</p><div class="figs-row">{figs}</div></div>'
    eb = f'<div class="eyebrow">{e(s["eyebrow"])}</div>'
    return f'<section class="wrap" id="{s["id"]}"><div class="band">{eb}{title(s)}<div class="grid c2">{out}</div></div></section>'


def r_commitments(s, p):
    c = D["commitments"]
    out = "".join(f'<div class="card rv"><span class="tick" aria-hidden="true"></span><div><h3>{e(x["title"])}</h3><p>{e(x["text"])}</p></div></div>' for x in c[s["audience"]])
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="grid c2 commit">{out}</div><p class="sign">Written into every agreement.</p></section>'


def r_faq(s, p):
    items = [f for f in D["faq"] if s["for"] in f["for"]]
    out = "".join(f'<details><summary>{e(f["q"])}</summary><div class="a"><p>{e(f["a"])}</p></div></details>' for f in items)
    eb = f'<div class="eyebrow">{e(s["eyebrow"])}</div>'
    return f'<section class="wrap" id="{s["id"]}">{eb}<div style="margin-bottom:32px">{title(s)}</div><div class="faq">{out}</div></section>'


def r_cta(s, p):
    c = D["contact"]
    btns = (f'<a class="btn btn-white" href="{D["primaryCta"]["href"]}" data-track="cta:request">{e(D["primaryCta"]["label"])}</a>'
            f'<a class="btn btn-ghostw" href="{c["booking"]}" data-track="calendly">Book a call</a>'
            f'<a class="btn btn-ghostw" href="{c["whatsapp"]}" target="_blank" rel="noopener" data-track="whatsapp">WhatsApp</a>')
    if p["path"] == "/start":
        btns = btns.split("</a>", 1)[1]
    text = s["text"] if "one working day" in s["text"] else s["text"] + " " + D["contact"]["reply"]
    return f'<section class="wrap" id="{s["id"]}"><div class="cta rv"><div><h2>{e(s["title"])}</h2><p>{e(text)}</p><div class="btns">{btns}</div></div>{contact_dl()}</div></section>'


def r_bars(s, p):
    out = ""
    for g in s["groups"]:
        rows = ""
        for label, parts in g["rows"]:
            segs = "".join(f'<i style="width:{v}%">{e(n)} {v}%</i>' if v >= 25 else f'<i style="width:{v}%">{v}%</i>' for n, v in parts)
            aria = ", ".join(f"{n} {v}%" for n, v in parts)
            rows += f'<div class="brow"><span>{e(label)}</span><div class="stack" role="img" aria-label="{e(label)}: {e(aria)}">{segs}</div></div>'
        out += f'<div class="card rv"><h3>{e(g["title"])}</h3>{rows}<p class="note">{e(g["note"])}</p></div>'
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="bars">{out}</div></section>'


def r_table(s, p):
    th = "".join(f'<th scope="col">{e(h)}</th>' for h in s["head"])
    body = ""
    for row in s["rows"]:
        cells = "".join(f'<td data-l="{e(s["head"][i + 1])}">{e(v) or "&mdash;"}</td>' for i, v in enumerate(row[1:]))
        body += f'<tr><th scope="row">{e(row[0])}</th>{cells}</tr>'
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="card tbl rv"><table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table><p class="note">{e(s.get("note", ""))}</p></div></section>'


def r_teams(s, p):
    out = "".join(f'<div class="team rv"><b>{e(t["city"])}</b><span>{e(t["role"])}</span></div>' for t in D["contact"]["teams"])
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="teams">{out}</div><p class="note">Local networks in every market we serve.</p></section>'


def r_form(s, p):
    mk = "".join(f'<option>{e(D["markets"][m]["name"])}</option>' for r in D["regions"] for m in r["markets"])
    return f"""<section class="wrap" id="{s["id"]}">{head(s)}
<form class="form rv" method="post" action="/api/lead" data-lead>
  <label>Your name<input name="name" autocomplete="name" required maxlength="120"></label>
  <label>Company<input name="company" autocomplete="organization" required maxlength="160"></label>
  <label>Work email<input name="email" type="email" autocomplete="email" required maxlength="160"></label>
  <label>Phone or WhatsApp <small>(optional)</small><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>
  <label class="full">Markets of interest<select name="market"><option value="">Choose one, or tell us below</option>{mk}<option>Several markets</option></select></label>
  <label class="full">Your products <small>(optional: paste a list now, or send it later)</small><textarea name="products" maxlength="8000"></textarea></label>
  <label class="hp" aria-hidden="true">Leave empty<input name="website" tabindex="-1" autocomplete="off"></label>
  <button class="btn btn-blue" type="submit" data-track="form:submit">Send request</button>
  <p class="form-msg" role="status" hidden></p>
  <p class="note full" style="margin:0">We reply within one working day. Your details are confidential and used only to respond to you; see our <a class="ac" href="/privacy">privacy notice</a>.</p>
</form></section>"""


def r_figures(s, p):
    out = "".join(f'<div class="fig rv"><b>{e(v)}</b><span>{e(l)}</span></div>' for v, l in s["items"])
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="figs-grid">{out}</div><p class="note">{e(s.get("note", ""))}</p></section>'


def r_compare(s, p):
    mark = {"yes": '<span class="cm y" aria-label="Yes">&#10003;</span>', "no": '<span class="cm n" aria-label="No">&ndash;</span>'}
    th = "".join(f'<th scope="col"{" class=us" if i == len(s["head"]) - 1 else ""}>{e(h)}</th>' for i, h in enumerate(s["head"]))
    body = ""
    for label, vals in s["rows"]:
        cells = "".join(f'<td data-l="{e(s["head"][i + 1])}"{" class=us" if i == len(vals) - 1 else ""}>{mark.get(v, f"<span class=cm-t>{e(v)}</span>")}</td>' for i, v in enumerate(vals))
        body += f'<tr><th scope="row">{e(label)}</th>{cells}</tr>'
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="card tbl cmp rv"><table><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div></section>'


def r_hbars(s, p):
    rows = "".join(f'<div class="hb"><span>{e(n)}</span><div class="t"><i style="width:{v}%"></i></div><b>{e(l)}</b></div>' for n, v, l in s["items"])
    aria = "; ".join(f"{n} {l}" for n, _, l in s["items"])
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="card rv"><div class="hbs" role="img" aria-label="{e(aria)}">{rows}</div><p class="note">{e(s.get("note", ""))}</p></div></section>'


def r_checklist(s, p):
    items = "".join(f'<li><b>{e(t)}</b><span>{e(x)}</span></li>' for t, x in s["items"])
    return f"""<section class="wrap" id="{s["id"]}">{head(s)}
<form class="form rv" method="post" action="/api/lead" data-lead data-reveal="checklist-body" data-ok="Thank you. Your checklist is below.">
  <input type="hidden" name="kind" value="checklist">
  <label>Your name<input name="name" autocomplete="name" required maxlength="120"></label>
  <label>Company<input name="company" autocomplete="organization" required maxlength="160"></label>
  <label class="full">Work email<input name="email" type="email" autocomplete="email" required maxlength="160"></label>
  <label class="hp" aria-hidden="true">Leave empty<input name="website" tabindex="-1" autocomplete="off"></label>
  <button class="btn btn-blue" type="submit" data-track="checklist:submit">Get the checklist</button>
  <p class="form-msg" role="status" hidden></p>
  <p class="note full" style="margin:0">We use your email to send you the checklist and, occasionally, our view on new markets. See our <a class="ac" href="/privacy">privacy notice</a>.</p>
</form>
<div class="card cl rv" id="checklist-body" hidden><span class="card-lbl">The checklist</span><h3>{e(s["listTitle"])}</h3><ol class="cl-list">{items}</ol>
<a class="btn btn-blue" href="/start" data-track="checklist:request" style="align-self:flex-start;margin-top:12px">Request a market read</a></div>
</section>"""


# ------------------------------------------------------------------ flagship sections (home) and detailed explainers
def bleed(s, inner, tone="dark"):
    return f'<section class="bleed {tone}" id="{s.get("id", "")}"><div class="wrap">{inner}</div></section>'


def bridge_svg():
    W, H = 1200, 470
    hub = (560, 235)
    flows, back, nodes = [], [], []
    for i in range(7):
        y = 70 + i * 55
        nodes.append(f'<circle class="mkr" cx="120" cy="{y}" r="7"/>')
        flows.append(f'<path class="flow" d="M127 {y} C 330 {y}, 380 {hub[1]}, {hub[0] - 72} {hub[1]}"/>')
    nodes.append('<text class="lbl" x="120" y="40" text-anchor="middle">Manufacturers</text>')
    y = 30
    for r in D["regions"]:
        nodes.append(f'<text class="rg" x="905" y="{y + 4}">{e(r["name"])}</text>')
        y += 20
        for m in r["markets"]:
            mk = D["markets"][m]
            nm = mk.get("short", mk["name"])
            facts = " · ".join(mk["facts"][:2])
            nodes.append(f'<g class="mk" tabindex="0" role="button" aria-label="{e(nm)}: {e(facts)}" data-name="{e(nm)}" data-facts="{e(facts)}"><circle cx="895" cy="{y}" r="6"/><text x="910" y="{y + 4}">{e(nm)}</text></g>')
            flows.append(f'<path class="flow" d="M{hub[0] + 72} {hub[1]} C 720 {hub[1]}, 760 {y}, 887 {y}"/>')
            back.append(f'<path class="back" d="M887 {y + 3} C 760 {y + 3}, 720 {hub[1] + 9}, {hub[0] + 72} {hub[1] + 9}"/>')
            y += 21
        y += 8
    H = max(H, y)
    hubg = f'<g class="hub"><rect x="{hub[0] - 72}" y="{hub[1] - 28}" width="144" height="56" rx="28"/><text x="{hub[0]}" y="{hub[1] + 6}" text-anchor="middle">Nazryx</text></g>'
    return f'''<div class="bridge"><div class="bridge-scroll"><svg viewBox="0 0 {W} {H}" role="img" aria-label="Products flow from manufacturers through Nazryx into 14 markets in six regions; market data flows back.">{"".join(back)}{"".join(flows)}{"".join(nodes)}{hubg}</svg></div>
<p class="bridge-card" aria-live="polite">Hover or tap a market.</p></div>'''


def r_flagship(s, p):
    btns = "".join(btn(c) if c != "secondary" else btn({"label": D["secondaryCta"]["label"], "href": D["secondaryCta"]["href"]}, "btn-ghostw") for c in s.get("ctas", []))
    inner = f'<div class="flag rv"><div class="eyebrow">{e(s["eyebrow"])}</div>{title(s, "h1")}<p class="lede">{e(s["lede"])}</p><div class="btns">{btns}</div></div>{bridge_svg()}'
    return bleed(s, inner).replace('class="bleed dark"', 'class="bleed dark flagship"')


def r_scale(s, p):
    out = ""
    for it in s["items"]:
        out += f'<div class="sc rv"><b data-count="{it["n"]}" data-pre="{e(it.get("pre", ""))}" data-suf="{e(it.get("suf", ""))}">{e(it.get("pre", ""))}{it["n"]}{e(it.get("suf", ""))}</b><span>{e(it["label"])}</span></div>'
    eb = f'<div class="eyebrow">{e(s["eyebrow"])}</div>' if s.get("eyebrow") else ""
    return f'<section class="wrap scale-sec" id="{s.get("id", "")}">{eb}<div class="scale">{out}</div></section>'


def r_manifesto(s, p):
    lines = "".join(f'<div class="mf rv"><b>{e(t)}</b><p>{e(x)}</p></div>' for t, x in s["items"])
    inner = f'<div class="eyebrow">{e(s["eyebrow"])}</div><h2 class="mf-h">{e(s["title"])} <span class="ac">{e(s.get("accent", ""))}</span></h2><div class="mf-grid">{lines}</div>'
    return bleed(s, inner)


def r_panels(s, p):
    out = ""
    for i, it in enumerate(s["items"]):
        pts = "".join(f"<li>{e(x)}</li>" for x in it["points"])
        out += f'<a class="panelx p{i + 1} rv" href="{it["href"]}" data-track="panel:{slug(it["label"])}"><span class="card-lbl">{e(it["label"])}</span><h3>{e(it["title"])}</h3><p>{e(it["text"])}</p><ul>{pts}</ul><span class="go">{e(it["cta"])} &rarr;</span></a>'
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="panels">{out}</div></section>'


def r_phases(s, p):
    out = ""
    for i, ph in enumerate(s["items"], 1):
        cols = "".join(f'<div><span class="card-lbl">{e(k)}</span><p>{e(v)}</p></div>' for k, v in ph["cols"])
        out += f'<div class="phase rv"><div class="ph-h"><span class="ph-n">{i:02d}</span><div><h3>{e(ph["title"])}</h3><p>{e(ph["text"])}</p></div><span class="ph-t">{e(ph["time"])}</span></div><div class="ph-cols">{cols}</div></div>'
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="phases">{out}</div></section>'


def r_prose(s, p):
    paras = "".join(f"<p>{e(x)}</p>" for x in s["paras"])
    return f'<section class="wrap" id="{s["id"]}"><div class="prose-grid"><div><div class="eyebrow">{e(s["eyebrow"])}</div>{title(s)}</div><div class="prose rv">{paras}</div></div></section>'


def r_closing(s, p):
    c = D["contact"]
    btns = (btn("primary") + f'<a class="btn btn-ghostw" href="{c["booking"]}" data-track="calendly">Book a call</a>'
            f'<a class="btn btn-ghostw" href="{c["whatsapp"]}" target="_blank" rel="noopener" data-track="whatsapp">WhatsApp</a>')
    inner = f'<div class="closing rv"><h2>{e(s["title"])} <span class="ac">{e(s.get("accent", ""))}</span></h2><p class="lede">{e(s["text"])} {e(c["reply"])}</p><div class="btns">{btns}</div>{contact_dl()}</div>'
    return bleed(s, inner)


QUIZ = [
    {"id": "make", "q": "What do you make?", "a": ["Finished medicines", "Medical devices", "Both"]},
    {"id": "from", "q": "Where do you manufacture?", "a": ["Middle East and Turkey", "Asia", "Europe", "Africa", "The Americas", "Elsewhere"]},
    {"id": "region", "q": "Which region interests you most?", "a": [r["name"] for r in D["regions"]] + ["Not sure yet"]},
    {"id": "dossier", "q": "Is your dossier in CTD format?", "a": ["Yes", "Partly", "Not yet"]},
    {"id": "stage", "q": "How do you sell abroad today?", "a": ["Not exporting yet", "Through distributors", "Our own presence"]},
]


def r_quiz(s, p):
    regions = [{"name": r["name"], "angle": r["angle"], "insight": r["insight"], "facts": r["keyFacts"], "markets": market_names(r)} for r in D["regions"]]
    data = json.dumps({"questions": QUIZ, "regions": regions}).replace("</", "<\\/")
    return f"""<section class="wrap" id="{s["id"]}">{head(s)}
<div class="quiz rv" data-quiz>
  <div class="quiz-bar" aria-hidden="true"><i></i></div>
  <div class="quiz-body" aria-live="polite"><noscript><p class="lede">This check needs JavaScript. <a class="ac" href="/start">Tell us about your products</a> and we will give you our view directly.</p></noscript></div>
  <script type="application/json" class="quiz-data">{data}</script>
</div></section>"""


def r_explorer(s, p):
    tabs, panels = "", ""
    for i, r in enumerate(D["regions"]):
        sel = i == 0
        tabs += f'<button role="tab" id="x-t{i}" aria-controls="x-p{i}" aria-selected="{str(sel).lower()}"{"" if sel else " tabindex=-1"} data-track="explore:{r["id"]}"><small>{len(r["markets"])} market{"s" if len(r["markets"]) > 1 else ""}</small>{e(r["name"])}</button>'
        names = []
        for m in r["markets"]:
            mk = D["markets"][m]
            nm = e(mk.get("short", mk["name"]))
            names.append(f'<a href="{mk["file"]}">{nm} &rarr;</a>' if mk.get("file") else f"<span>{nm}</span>")
        facts = "".join(f"<li>{e(f)}</li>" for f in r["keyFacts"])
        panels += f"""<div class="xp" id="x-p{i}" role="tabpanel" aria-labelledby="x-t{i}"{"" if sel else " hidden"}>
  <span class="card-lbl">Our view</span><h3>{e(r["angle"])}</h3><p class="xp-ins">{e(r["insight"])}</p>
  <ul class="xp-facts">{facts}</ul>
  <div class="xp-mk">{"".join(names)}</div>
  <a class="btn btn-blue" href="/start?region={e(r["name"])}" data-track="explore:request">Request a market read for {e(r["name"])}</a>
</div>"""
    return f'<section class="wrap" id="{s["id"]}">{head(s)}<div class="explorer rv"><div class="xtabs" role="tablist" aria-label="Regions" aria-orientation="vertical">{tabs}</div><div class="xpanels">{panels}</div></div></section>'


RENDER = {k[2:]: v for k, v in globals().items() if k.startswith("r_")}


# ------------------------------------------------------------------ page shell
def shell(p, body):
    url = BASE + p["path"]
    links = "".join(f'<a href="{n["href"]}"{" aria-current=page" if p["path"].startswith(n["href"]) else ""} data-track="nav:{slug(n["label"])}">{e(n["label"])}</a>' for n in D["nav"])
    phones = "".join(f'<a href="tel:{x["tel"]}" data-track="phone:{x["tel"]}">{e(x["display"])}</a>' for x in D["contact"]["phones"])
    fnav = "".join(f'<a href="{n["href"]}">{e(n["label"])}</a>' for n in D["footerNav"])
    org = {"@context": "https://schema.org", "@type": "Organization", "name": "Nazryx", "url": BASE + "/", "logo": BASE + "/assets/icons/icon-512.png",
           "email": D["contact"]["email"], "description": D["company"]["oneLiner"],
           "contactPoint": [{"@type": "ContactPoint", "telephone": x["display"], "contactType": "sales"} for x in D["contact"]["phones"]]}
    ld = f'<script type="application/ld+json">{json.dumps(org)}</script>\n' if p["path"] == "/" else ""
    types = {x["type"] for x in p.get("sections", [])}
    scripts = '<script src="/assets/js/site.js" defer></script>\n' + ('<script src="/assets/js/lead.js" defer></script>\n' if types & {"form", "checklist"} else "") + ('<script src="/assets/js/quiz.js" defer></script>\n' if "quiz" in types else "") + '<script src="/assets/a.js" defer></script>'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(p["title"])}</title>
<meta name="description" content="{e(p["description"])}">
<link rel="canonical" href="{url}">
<link rel="preload" href="/assets/fonts/intertight-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/icons/icon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/icons/icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#1259E6">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nazryx">
<meta property="og:title" content="{e(p["title"])}">
<meta property="og:description" content="{e(p["description"])}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(p["title"])}">
<meta name="twitter:description" content="{e(p["description"])}">
<meta name="twitter:image" content="{BASE}/assets/og.png">
{ld}</head>
<body class="{p.get("theme", "light")}{" has-flag" if p.get("sections") and p["sections"][0]["type"] == "flagship" else ""}">
<a class="skip" href="#main">Skip to content</a>
<header class="hdr">
  <div class="hdr-in">
    <a class="logo" href="/" aria-label="Nazryx home" data-track="nav:home">{LOGO}<b>Nazryx</b></a>
    <nav class="nav" aria-label="Main">{links}</nav>
    {btn("primary")}
    <button class="menu-btn" type="button" aria-controls="menu" aria-expanded="false" aria-label="Open menu"><span></span></button>
  </div>
</header>
<div class="panel" id="menu" role="dialog" aria-modal="true" aria-label="Menu">
  <div class="panel-top"><a class="logo" href="/">{LOGO}<b>Nazryx</b></a><button class="panel-close" type="button" aria-label="Close menu">&times;</button></div>
  <nav aria-label="Mobile"><a href="/">Home</a>{links}<a href="/distributors">For distributors and buyers</a></nav>
  {btn("primary")}
  <div class="panel-contact">{phones}<a href="mailto:{D["contact"]["email"]}" data-track="email">{D["contact"]["email"]}</a></div>
</div>
<main id="main">
{body}
</main>
<footer class="ftr">
  <div class="ftr-in">
    <span>&copy; 2026 Nazryx · {e(D["company"]["group"])}</span>
    <nav aria-label="Footer">{fnav}</nav>
    <div class="c">{phones}<a href="mailto:{D["contact"]["email"]}" data-track="email">{D["contact"]["email"]}</a></div>
    <small>Anonymous analytics. No cookies. No IP addresses stored.</small>
  </div>
</footer>
<a class="wa" href="{D["contact"]["whatsapp"]}" target="_blank" rel="noopener" data-track="whatsapp:float">{WA_ICON}WhatsApp</a>
{scripts}
</body>
</html>
"""


def out_path(path):
    return SITE / ("index.html" if path == "/" else path.strip("/") + ".html")


if __name__ == "__main__":
    for f in sorted((CONTENT / "pages").glob("*.json")):
        p = json.loads(f.read_text())
        secs = p["sections"]
        if len(secs) < 6:
            raise SystemExit(f"{f.name}: {len(secs)} sections; every page needs at least 6")
        body = "\n\n".join(RENDER[s["type"]](s, p) for s in secs)
        o = out_path(p["path"])
        o.parent.mkdir(parents=True, exist_ok=True)
        o.write_text(shell(p, body), encoding="utf-8")
        print(f"{p['path']:<22} {len(secs):>2} sections  {', '.join(s['type'] for s in secs)}")
    nf = {"path": "/404", "title": "Page not found | Nazryx", "description": "This page does not exist.", "theme": "light"}
    (SITE / "404.html").write_text(shell(nf, '<section class="wrap hero"><div class="eyebrow">404</div><h1>Page not found.</h1><p class="lede" style="margin-top:20px">Try the <a class="ac" href="/">home page</a>, <a class="ac" href="/market-entry">market entry</a> or <a class="ac" href="/markets">markets</a>.</p></section>').replace(
        '<link rel="canonical" href="https://nazryx.com/404">', '<meta name="robots" content="noindex">'))
