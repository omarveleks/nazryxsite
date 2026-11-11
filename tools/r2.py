#!/usr/bin/env python3
"""Round-2 build: take the original pages in tools/src/ and apply the brief's corrections and additions.

Run: python3 tools/r2.py   (writes site/*.html and site/markets/*.html; output is committed)
Facts: docs/NAZRYX_SITE_BRIEF_v2.md + docs/NAZRYX_SITE_FACTS.md (round-1 brief section 1 for Kazakhstan).
"""
import json
import math
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, SITE = ROOT / "tools" / "src", ROOT / "site"
BASE, EMAIL, WA = "https://nazryx.com", "contact@nazryx.com", "https://wa.me/447466253544"
PHONES = [("+447466253544", "+44 7466 253544", "UK · WhatsApp"), ("+77086922409", "+7 708 692 2409", "Kazakhstan · WhatsApp"),
          ("+923254307967", "+92 325 4307967", "Pakistan")]
LOGO_PATH = 'M171 0 L403 0 L613 210 L613 0 L837 0 L837 198 L689 346 L461 346 L295 179 L131 346 L0 346 L0 174 Z'
NAV = [("/manufacturers", "For manufacturers"), ("/markets", "Markets"), ("/partners", "For distributors")]

# ------------------------------------------------------------------ market data (facts file, sections B and B2)
REGIONS = [
    ("Central Asia and the Caucasus", "Team on the ground in Almaty. National and EAEU routes.", [
        ("Kazakhstan", 20.3, ["USD 2.5bn medicines market (2025)", "85% of value imported", "9,659 pharmacies"], "full"),
        ("Uzbekistan", 38.2, ["38.2m people (2026)", "Imports about USD 2bn (2025)", "Review 60–120 days since Nov 2025"], ""),
        ("Azerbaijan", None, ["Imports USD 259m in H1 2025", "Up 4.6% on the year before", "Import-led market"], ""),
    ]),
    ("East Africa", "Register-led and tender-heavy. One dossier format across the region.", [
        ("Kenya", 52.2, ["About 70% of medicines imported", "Imports about USD 705m (2024)", "State buyer: KEMSA"], ""),
        ("Uganda", 45.9, ["At least 70% imported", "Imports about USD 700m (2025)", "State buyer: National Medical Stores"], ""),
        ("Tanzania", 68, ["More than 80% imported", "MSD buys about USD 491m a year", "9,270+ register records read by Nazryx"], ""),
        ("Rwanda", None, ["Home of the African Medicines Agency", "Member of the East African registration network", "Regulator: Rwanda FDA"], ""),
    ]),
    ("West Africa", "Import-led markets with central state buyers.", [
        ("Nigeria", 200, ["About 60% of medicines imported", "2 WHO-prequalified local makers", "Regulator: NAFDAC"], ""),
        ("Ghana", None, ["About 70% of medicines imported", "Five-year roadmap for local manufacturing", "Regulator: FDA Ghana"], ""),
        ("Senegal", None, ["95% of pharmaceutical products imported", "Regulator: ARP", "State buyer: SEN-PNA"], ""),
        ("Francophone West and Central Africa", None, ["Dossiers in French, regional regulators", "Côte d'Ivoire: more than 90% imported", "Central state buyers, e.g. NPSP"], "regional"),
    ]),
    ("North Africa and the Horn", "Supply rebuilding through national buyers.", [
        ("Sudan", 51, ["USD 274m+ imported in H1 2026", "13 factories back in production", "Buys through one national fund"], ""),
        ("Libya", None, ["Almost all medicines imported", "State buyer: Medical Supply Organization", "First national import tender in a decade (2024)"], ""),
    ]),
    ("Middle East", "One state importer.", [
        ("Iraq", 46.1, ["About USD 3bn of medicines imported a year", "More than 40% made locally", "Single state importer: Kimadia"], ""),
    ]),
    ("South America", "A central state buyer and an import-led market.", [
        ("Peru", None, ["Imports USD 715m (2025), up 9%", "Regulator: DIGEMID", "Central state buyer: CENARES"], ""),
    ]),
]
SOURCES = ["Pakistan", "Bangladesh", "Turkey", "Egypt", "Europe", "Korea"]
MARKET_NAMES = [m[0] for _, _, ms in REGIONS for m in ms if m[3] != "regional"]  # 14 markets

IMPORTS = [  # C1
    ("Senegal", 95, "95%"), ("Francophone West Africa, e.g. Côte d'Ivoire", 90, "90%+"), ("Kazakhstan", 85, "85%"),
    ("Tanzania", 80, "80%+"), ("Uganda", 70, "70%+"), ("Kenya", 70, "~70%"), ("Ghana", 70, "~70%"),
    ("Nigeria", 60, "~60%"), ("Iraq", 58, "under 60%"),
]
IMPORT_VALUES = [("Uzbekistan", "Imports about USD 2bn (2025)"), ("Sudan", "USD 274m+ imported, H1 2026"),
                 ("Peru", "USD 715m imported (2025)"), ("Azerbaijan", "USD 259m imported, H1 2025"),
                 ("Libya", "Almost all medicines imported"), ("Rwanda", "Import-led")]
CLOCKS = [  # C2: (label, start, end, kind, text)
    ("Uzbekistan", 60, 120, "law", "60–120 days by category"),
    ("Kenya and Uganda, verification", 0, 90, "target", "90 days"),
    ("Kazakhstan, national", 0, 100, "law", "up to 100 working days"),
    ("Kazakhstan, EAEU", 0, 140, "law", "140 working days + clock stops"),
    ("Tanzania, full review", 0, 180, "target", "180 days"),
    ("Uganda, full review", 0, 261, "target", "261 days"),
    ("Kenya, full review", 0, 262, "target", "262 days"),
]
PRICES = [("Russia", .75), ("Kazakhstan", .97), ("Pakistan", .98), ("India", 1.00), ("Slovenia", 1.18), ("Turkey", 1.34), ("Western Europe", 1.41), ("Germany", 1.43)]
DOCTORS = [("Therapists", 6908), ("Gynaecologists", 5279), ("Paediatricians", 4893), ("Neurologists", 2649), ("Cardiologists", 1995), ("Endocrinologists", 1073), ("Dermatovenereologists", 926), ("Urologists", 870)]

WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>'


# ------------------------------------------------------------------ shared chrome
def nav(path, dark):
    links = "".join(f'<a href="{h}"{" aria-current=page" if path.startswith(h) else ""} data-track="nav:{h.strip("/")}">{t}</a>' for h, t in NAV)
    phones = "".join(f'<a href="tel:{t}" data-track="phone:{t}">{d}</a>' for t, d, _ in PHONES)
    return f"""<nav class="nav" aria-label="Main">
  <div class="nav-in">
    <a class="brand" href="/" aria-label="Nazryx home" data-track="nav:home">
      <svg viewBox="0 0 837 346" aria-hidden="true"><path d="{LOGO_PATH}" fill="#1259E6"/></svg>
      <b>Nazryx</b>
    </a>
    <div class="nav-links">{links}</div>
    <a class="btn btn-blue" href="#contact" data-track="nav:talk">Talk to us</a>
    <button class="menu-btn" type="button" aria-controls="menu" aria-expanded="false" aria-label="Open menu"><span></span></button>
  </div>
</nav>
<div class="panel" id="menu" role="dialog" aria-modal="true" aria-label="Menu">
  <div class="panel-top"><a class="brand" href="/"><svg viewBox="0 0 837 346" aria-hidden="true" width="30"><path d="{LOGO_PATH}" fill="#1259E6"/></svg></a><button class="panel-close" type="button" aria-label="Close menu">&times;</button></div>
  <nav aria-label="Mobile"><a href="/">Home</a>{links}</nav>
  <a class="btn btn-blue" href="#contact" data-track="nav:talk">Talk to us</a>
  <div class="panel-contact">{phones}<a href="mailto:{EMAIL}" data-track="email">{EMAIL}</a></div>
</div>"""


def footer():
    phones = "".join(f'<a href="tel:{t}" data-track="phone:{t}">{d}</a>' for t, d, _ in PHONES)
    # TODO Omar: confirm the LinkedIn company URL, then add it to the footer.
    return f"""<footer class="pfoot">
  <div class="pfoot-in">
    <span>&copy; 2026 Nazryx · Part of the Nazir Group</span>
    <nav aria-label="Footer"><a href="/">Home</a><a href="/manufacturers">Manufacturers</a><a href="/markets">Markets</a><a href="/partners">Distributors</a><a href="#contact">Contact</a></nav>
    <div class="c">{phones}<a href="mailto:{EMAIL}" data-track="email">{EMAIL}</a></div>
    <small>Anonymous analytics. No cookies. No IP addresses stored.</small>
  </div>
</footer>
<a class="wa" href="{WA}" target="_blank" rel="noopener" data-track="whatsapp:float">{WA_ICON}WhatsApp</a>"""


def head_meta(path, title, desc):
    url = BASE + path
    return f"""<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<link rel="preload" href="/assets/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/intertight-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/icons/icon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/assets/icons/icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#1259E6">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nazryx">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{BASE}/assets/og.png">"""


SCRIPTS = '<script src="/assets/js/site.js" defer></script>\n<script src="/assets/a.js" defer></script>'


# ------------------------------------------------------------------ components
def mrun_card():
    rows = "".join(f'<div><dt>{r}</dt><dd>{", ".join(m[0] if m[3] != "regional" else "francophone W. & C. Africa" for m in ms)}. {role}</dd></div>' for r, role, ms in REGIONS)
    return f"""<div class="mrun">
      <div class="mrun-top"><b>Markets we run</b><span>14 markets · 3 continents</span></div>
      <dl>{rows}</dl>
      <a class="mrun-foot" href="/markets" style="color:#fff" data-track="hero:markets">See every market &rarr;</a>
    </div>"""


def bridge():
    W, H = 1200, 520
    srcs, out, back = [], [], []
    hub = (560, H / 2)
    for i, s in enumerate(SOURCES):
        y = 70 + i * 70
        srcs.append(f'<g class="src"><circle cx="150" cy="{y}" r="7"/><text x="136" y="{y + 4}" text-anchor="end">{s}</text></g>')
        out.append(f'<path class="flow" d="M157 {y} C 360 {y}, 400 {hub[1]}, {hub[0] - 70} {hub[1]}"/>')
    y, nodes = 22, []
    for region, _, ms in REGIONS:
        nodes.append(f'<text class="rg" x="925" y="{y + 6}">{region}</text>')
        y += 22
        for name, pop, facts, kind in ms:
            r = 5 + (math.sqrt(pop) * 0.9 if pop else 1.5)
            label = "Francophone W. & C. Africa" if kind == "regional" else name
            f = " · ".join(facts)
            nodes.append(f'<g class="mk" tabindex="0" role="button" aria-label="{label}: {f}" data-name="{label}" data-facts="{f}"><circle cx="915" cy="{y}" r="{r:.1f}"/><text x="{930 + r:.0f}" y="{y + 4}">{label}</text></g>')
            out.append(f'<path class="flow" d="M{hub[0] + 70} {hub[1]} C 720 {hub[1]}, 760 {y}, {915 - r - 2:.0f} {y}"/>')
            back.append(f'<path class="back" d="M{915 - r - 2:.0f} {y + 3} C 760 {y + 3}, 720 {hub[1] + 8}, {hub[0] + 70} {hub[1] + 8}"/>')
            y += 23
        y += 6
    H = y + 10
    hubg = f'<g class="hub"><rect x="{hub[0] - 70}" y="{hub[1] - 26}" width="140" height="52" rx="26"/><text x="{hub[0]}" y="{hub[1] + 5}" text-anchor="middle">Nazryx</text></g>'
    return f"""<div class="bridge" aria-label="How Nazryx bridges supply and demand">
  <div class="bridge-scroll"><svg viewBox="0 0 {W} {H}" role="img" aria-label="Medicines flow from Pakistan, Bangladesh, Turkey, Egypt, Europe and Korea through Nazryx to 14 markets on 3 continents; demand data flows back.">
    <text class="rg" x="150" y="30" text-anchor="end">Made in</text>
    {"".join(back)}{"".join(out)}{"".join(srcs)}{hubg}{"".join(nodes)}
  </svg></div>
  <div class="bridge-foot">
    <div class="bridge-total"><b>USD 10bn+</b> imported a year · <b>650m+</b> people · <b>14</b> markets</div>
    <div class="bridge-key"><span><i></i>Products</span><span><i class="d"></i>Demand data</span></div>
  </div>
  <p class="bridge-card" aria-live="polite">Hover or tap a market to see three facts.</p>
  <p class="pnote">Nazryx estimate from national and UN data, 2024–26.</p>
</div>"""


def journey():
    st = [
        ("01", "Manufacturer's plant", "We check own-plant manufacture, GMP and dossier readiness.", "Pakistan's pharmaceutical exports reached a 20-year high of USD 457m (FY2025)."),
        ("02", "Registration", "We choose the route and file in the maker's name.", "Uzbekistan 60–120 days · Kazakhstan EAEU 140 working days."),
        ("03", "Importer and distributor", "We appoint and vet them. Reports run every week.", "100+ distributor relationships in Kazakhstan."),
        ("04", "State buyer or pharmacy", "We read every state lot and shelf.", "Tanzania's MSD buys about USD 491m a year for 8,800+ facilities · 1,340 pharmacies tracked in Kazakhstan."),
        ("05", "Patient in a village", "The medicine reaches the shelf near them.", "650m+ people in our 14 markets. Imported: 60% in Nigeria, 85% in Kazakhstan, 95% in Senegal."),
    ]
    stops = "".join(f'<div class="jny-stop"><small>{n} · {t}</small><b>{t}</b><p>{p}</p><p class="fact">{f}</p></div>' for n, t, p, f in st)
    pill = '<svg viewBox="0 0 56 28" aria-hidden="true"><rect x="1" y="1" width="54" height="26" rx="13" fill="#1259E6"/><rect x="28" y="1" width="27" height="26" rx="13" fill="#9DB9F2"/><rect x="28" y="1" width="13" height="26" fill="#9DB9F2"/></svg>'
    return f"""<section class="wrap jny" id="journey" style="padding-top:24px">
  <div class="svc-head" style="margin-bottom:20px">
    <div><div class="eyebrow">The journey of a tablet</div><h2>Every tablet has a journey. <span class="blue">We make it work.</span></h2></div>
    <p class="lede">From the plant to the patient, five stations. At each one, a real figure and the work we do there.</p>
  </div>
  <div class="jny-track" aria-hidden="true"><div class="jny-line"></div><div class="jny-fill"></div><div class="jny-pill">{pill}</div></div>
  <div class="jny-stops">{stops}</div>
  <div class="jny-end"><b>Frictionless, from the plant to the patient.</b>
    <div class="hero-cta" style="margin:0"><a class="btn btn-blue" href="/manufacturers" data-track="journey:makers">For makers</a><a class="btn btn-ghost" href="/partners" data-track="journey:distributors">For distributors and buyers</a></div></div>
</section>"""


def imports_chart(values=True):
    asia = {"Kazakhstan", "Iraq"}
    bars = "".join(f'<div class="hbar {"c-asia" if n in asia else "c-africa"}"><span>{n}</span><div class="t"><i style="width:{v}%"></i></div><b>{lbl}</b></div>' for n, v, lbl in IMPORTS)
    vals = "".join(f'<div class="hbar val"><span>{n}</span><div class="t"><span>{t}</span></div><b></b></div>' for n, t in IMPORT_VALUES)
    aria = "; ".join(f"{n} {lbl}" for n, _, lbl in IMPORTS)
    return f"""<div class="pcard">
    <div class="hbars" role="img" aria-label="Share of medicines imported: {aria}">{bars}</div>
    {f'<div class="hbars" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">{vals}</div>' if values else '<p class="pnote" style="margin-top:12px">Uzbekistan, Sudan, Peru, Azerbaijan, Libya and Rwanda are import-led too; see <a href="/markets" style="color:var(--a)">all markets</a>.</p>'}
    <p class="keyx"><span><i style="background:#2E9E6B"></i>Africa</span><span><i style="background:#1259E6"></i>Asia and the Middle East</span></p>
    <p class="pnote">Share of medicines imported. National data, 2024–26.</p>
  </div>"""


def clocks():
    mx = 270
    rows = ""
    for label, a, b, kind, txt in CLOCKS:
        cls = ' class="rng"' if a else ""
        rows += f'<div class="clock"><span>{label}<em>{kind}</em><small>{txt}</small></span><div class="t"><i{cls} style="left:{a / mx * 100:.1f}%;width:{(b - a) / mx * 100:.1f}%"></i></div></div>'
    aria = "; ".join(f"{l}: {t} ({k})" for l, _, _, k, t in CLOCKS)
    return f"""<div class="pcard">
    <div class="clock-axis"><span></span><div><span>0</span><span>90</span><span>180</span><span>270 days</span></div></div>
    <div class="clocks" role="img" aria-label="Official review clocks: {aria}" style="margin-top:8px">{rows}</div>
    <p class="pnote">Official review clocks. Real timelines add questions and the plant inspection. We plan them per product.</p>
  </div>"""


def scan(dark=False):
    mol = json.loads((SITE / "assets/data/kz_demo_molecules.json").read_text())["molecules"]
    chips = "".join(f'<button class="chip" type="button" data-inn="{m["inn"]}" data-track="scan:chip">{m["inn"]}</button>' for m in mol)
    sw = '<button type="button" aria-pressed="true" data-live data-track="scan:market">Kazakhstan</button>' + "".join(
        f'<button type="button" aria-pressed="false" data-track="scan:market">{m}</button>' for m in MARKET_NAMES if m != "Kazakhstan")
    return f"""<div class="scanx" id="scan" data-autorun="Apixaban">
    <div class="pcard scan-pick">
      <div class="eyebrow" style="margin-bottom:10px">Example: Kazakhstan</div>
      <div class="mswitch" role="group" aria-label="Market">{sw}</div>
      <p class="mswitch-note" hidden aria-live="polite"></p>
      <div class="scan-live">
        <p class="scan-lbl" id="scan-lbl">Pick a molecule</p>
        <div class="chips" role="group" aria-labelledby="scan-lbl">{chips}</div>
        <p class="scan-miss">Not in the list? We have this read for every molecule. <a href="mailto:{EMAIL}?subject=Molecule%20check" data-track="scan:email">Email it to us</a> or <a href="{WA}?text=Please%20check%20this%20molecule%20for%20me%3A%20" target="_blank" rel="noopener" data-track="scan:whatsapp">send it on WhatsApp</a>.</p>
      </div>
    </div>
    <div class="pcard scan-card" aria-live="polite">
      <div class="scan-grid" aria-hidden="true">{"<i></i>" * 24}</div>
      <div class="scan-line" aria-hidden="true"></div>
      <div class="scan-res"></div>
      <div class="scan-foot">
        <p>This is one molecule. We run this for every product in your catalogue, against the register, 1,340 pharmacy shelves and the state purchase list.</p>
        <a class="btn btn-blue" href="mailto:{EMAIL}?subject=Product%20list" data-track="scan:send-list">Send your product list</a>
      </div>
    </div>
  </div>
  <p class="pnote">We run the same read in every market we serve: register, shelves or tenders, and the state buyer. Kazakhstan national register (live) and shelves of 1,340 pharmacies, November 2026.</p>"""


def gl():
    return '<i class="gl" style="left:25%"></i><i class="gl" style="left:50%"></i><i class="gl" style="left:75%"></i>'


def gbar(left, width, label, soft=False):
    return f'<div class="g-bar{" soft" if soft else ""}{" in" if width >= 30 else ""}" style="left:{left}%;width:{width}%"><em>{label}</em></div>'


def route():
    return f"""<div class="pcard">
    <div class="ptabs" role="tablist" aria-label="Registration route">
      <button role="tab" id="t-nat" aria-controls="p-nat" aria-selected="true" data-track="route:national">National route</button>
      <button role="tab" id="t-eaeu" aria-controls="p-eaeu" aria-selected="false" tabindex="-1" data-track="route:eaeu">EAEU route</button>
    </div>
    <div class="route-panel" id="p-nat" role="tabpanel" aria-labelledby="t-nat">
      <div class="gantt" role="img" aria-label="National route: file in Q2 2027, expertise up to 100 working days, first sales 2028. The national window closes on 31 December 2027.">
        <div class="g-axis"><span>2027</span><span>2028</span><span>2029</span><span>2030</span></div>
        <div class="g-row"><span>File</span><div class="g-track">{gl()}{gbar(6.25, 6.25, "Q2 2027")}<div class="g-mark" style="left:25%"><em>National window closes 31 Dec 2027</em></div></div></div>
        <div class="g-row"><span>Expertise</span><div class="g-track">{gl()}{gbar(12.5, 11, "Up to 100 working days", True)}</div></div>
        <div class="g-row"><span>First sales</span><div class="g-track">{gl()}{gbar(25, 75, "From 2028")}</div></div>
      </div>
      <p class="g-side">Valid in Kazakhstan only. Open until 31 December 2027.</p>
    </div>
    <div class="route-panel" id="p-eaeu" role="tabpanel" aria-labelledby="t-eaeu" hidden>
      <div class="gantt" role="img" aria-label="EAEU route: file 2027 to 2028, 140 working days plus answers, 12 to 18 months in total, first sales 2029. Extendable to Russia, Belarus, Armenia and Kyrgyzstan.">
        <div class="g-axis"><span>2027</span><span>2028</span><span>2029</span><span>2030</span></div>
        <div class="g-row"><span>File</span><div class="g-track">{gl()}{gbar(6.25, 31.25, "2027–28")}</div></div>
        <div class="g-row"><span>Review</span><div class="g-track">{gl()}{gbar(12.5, 37.5, "140 working days + answers (12–18 months)", True)}</div></div>
        <div class="g-row"><span>First sales</span><div class="g-track">{gl()}{gbar(50, 50, "From 2029")}</div></div>
      </div>
      <p class="g-side">Kazakhstan as reference state. Extendable to Russia, Belarus, Armenia and Kyrgyzstan.</p>
    </div>
    <p class="pnote">We choose the route per product. Quick products go national for 2028 sales; products that need a bioequivalence study go EAEU.</p>
  </div>"""


def funnel():
    def dots(n):
        return "<i></i>" * n
    st = [(120, "products in an illustrative catalogue"), (96, "made in your own plant"), (40, "checked against the national register"),
          (18, "checked against 1,340 pharmacy shelves and the state purchase list")]
    cells = "".join(f'<div class="fstep rv"><b>{n}</b><p>{t}</p><div class="fdots" aria-hidden="true">{dots(min(n, 60))}</div></div>' for n, t in st)
    cells += '<div class="fstep last rv"><b>15</b><p>ready to file or worth a bioequivalence study, in 4 filing waves. First sales 2028–2030.</p><div class="fwaves" aria-hidden="true"><span>1A</span><span>1B</span><span>2A</span><span>2B</span></div></div>'
    return f"""<section class="wrap" style="padding-top:0">
  <div class="head2"><div><div class="eyebrow">From your catalogue to a plan</div><h2>120 products in. <span class="blue">15 worth filing.</span></h2></div>
  <p class="lede">15 products · 4 filing waves · registrations in your name.</p></div>
  <div class="fsteps">{cells}</div>
  <p class="pnote">Illustrative, based on a 2026 screen.</p>
</section>"""


PROFILE = [("Page 1 · Market", [("w3", "Competitors", "Who already sells this molecule, and from which countries."), ("w3", "Packs on sale", "Every pack and strength on the shelf, and its price."),
                                ("w2", "Market structure", "How sales split between pharmacies, chains and the state buyer."), ("w4", "Volume", "How many packs move a year.")]),
           ("Page 2 · Plan", [("w3", "Registration", "Which route, how long, and what the dossier still needs."), ("w3", "Promotion", "Which doctors prescribe it, and how we reach them."),
                              ("w6", "Launch plan", "Importer, pricing and filing wave, one line per step.")])]


def profile(px):
    tabs, pages = [], []
    for i, (name, blocks) in enumerate(PROFILE):
        tabs.append(f'<button role="tab" id="{px}-t{i}" aria-controls="{px}-p{i}" aria-selected="{"true" if i == 0 else "false"}"{"" if i == 0 else " tabindex=-1"}>{name}</button>')
        b = "".join(f'<div class="blk {w}"><b>{t}</b><span class="sk"></span><span class="sk"></span><span class="sk"></span><button class="hot" type="button" aria-expanded="false" aria-label="What {t.lower()} tells you">{n}</button><span class="hot-tip" role="note">{note}</span></div>'
                    for n, (w, t, note) in enumerate(blocks, 1))
        pages.append(f'<div id="{px}-p{i}" role="tabpanel" aria-labelledby="{px}-t{i}"{"" if i == 0 else " hidden"}><div class="prof">{b}</div></div>')
    # TODO Omar: replace the skeleton with the approved anonymised profile page.
    return f"""<div class="pcard">
    <div class="ptabs" role="tablist" aria-label="Profile pages">{"".join(tabs)}</div>
    {"".join(pages)}
    <div class="jny-end" style="margin-top:16px"><p class="pnote" style="margin:0">Layout of a real two-page product profile. Sample available on request.</p>
    <a class="btn btn-ghost" href="mailto:{EMAIL}?subject=Sample%20product%20profile" data-track="sample:request">Request a sample</a></div>
  </div>"""


def mockups():
    """Stylised mock-ups of the Nazryx platform. Demo data only: molecules from the approved demo file, generic product names."""
    mol = json.loads((SITE / "assets/data/kz_demo_molecules.json").read_text())["molecules"]
    pick = {m["inn"]: m for m in mol}
    rows = ""
    for inn in ["Atorvastatin + ezetimibe", "Bisoprolol + amlodipine", "Apixaban", "Dapagliflozin", "Amlodipine"]:
        m = pick[inn]
        c = {"Open": "c-open", "Thin": "c-thin", "Crowded": "c-crowd"}[m["verdict"]]
        rows += f'<tr><td>{inn}</td><td>{m["brands_registered"]}</td><td>{m["brands_on_shelf"]}</td><td><span class="chipx {c}">{m["verdict"]}</span></td></tr>'
    lots = "".join(f'<tr><td>Lot {n}</td><td>{p}</td><td><span class="chipx {c}">{s}</span></td></tr>' for n, p, s, c in [
        ("0412", "Product A, 5 mg tablets", "Open", "c-open"), ("0587", "Product B, 1 g injection", "No bids", "c-thin"),
        ("0733", "Product C, 10 mg tablets", "Awarded", "c-crowd"), ("0914", "Product D, oral solution", "Open", "c-open")])
    short = "".join(f'<tr><td><span class="blur">{n}</span></td><td>{cat}</td><td>{fit}</td></tr>' for n, cat, fit in [
        ("Northgate Pharma Dist.", "Cardio, diabetes", "92"), ("Meridian Medical LLP", "Hospital, injectables", "87"), ("Steppe Health Trading", "Chains, OTC", "81")])
    spark = "".join(f'<i style="height:{h}%"></i>' for h in [30, 42, 38, 55, 61, 58, 72, 80])
    return f"""<div class="mock-grid">
    <div class="mock-stack">
      <div class="mock"><div class="mock-bar"><i></i><i></i><i></i><b>Market read · Kazakhstan</b></div><div class="mock-body">
        <table><thead><tr><th>Molecule</th><th>Registered</th><th>On shelf</th><th>Verdict</th></tr></thead><tbody>{rows}</tbody></table></div></div>
      <div class="mock"><div class="mock-bar"><i></i><i></i><i></i><b>State lots · 2027 round</b></div><div class="mock-body">
        <table><thead><tr><th>Lot</th><th>Product</th><th>Status</th></tr></thead><tbody>{lots}</tbody></table></div></div>
    </div>
    <div class="mock-stack">
      <div class="mock"><div class="mock-bar"><i></i><i></i><i></i><b>Weekly report · week 46</b></div><div class="mock-body">
        <div class="mock-kpis"><div><b>18</b><span>orders</span></div><div><b>142</b><span>listings</span></div><div><b>34</b><span>stock days</span></div></div>
        <div class="spark" aria-hidden="true">{spark}</div></div></div>
      <div class="mock"><div class="mock-bar"><i></i><i></i><i></i><b>Distributor shortlist</b></div><div class="mock-body">
        <table><thead><tr><th>Distributor</th><th>Strength</th><th>Fit</th></tr></thead><tbody>{short}</tbody></table></div></div>
    </div>
  </div>
  <p class="mock-cap">Our own platform, built for these markets. Demo data; names hidden.</p>"""


def region_strip():
    tiles = "".join(f'<div class="rtile r{i % 3 + 1}"><small>{r}</small><b>{", ".join("Francophone W. & C. Africa" if m[3] == "regional" else m[0] for m in ms)}</b></div>' for i, (r, _, ms) in enumerate(REGIONS))
    return f'<div class="rtiles">{tiles}</div><p style="margin-top:14px"><a class="go-a" href="/markets" data-track="home:all-markets">See all 14 markets &rarr;</a></p>'


def market_cards():
    out = ""
    for region, role, ms in REGIONS:
        for name, _, facts, kind in ms:
            title = "Francophone West and Central Africa" if kind == "regional" else name
            link = '<a class="go" href="/markets/kazakhstan" data-track="markets:kazakhstan">Full market file &rarr;</a>' if kind == "full" else f'<a class="go req" href="mailto:{EMAIL}?subject={title.replace(" ", "%20")}%20market%20file" data-track="markets:request">Market file on request</a>'
            out += f'<div class="mcard{" full" if kind == "full" else ""}"><small>{region}</small><h3>{title}</h3><p>{role}</p><ul>{"".join(f"<li>{f}</li>" for f in facts[:2])}</ul>{link}</div>'
    return f'<div class="mcards">{out}</div>'


def region_tabs(px):
    tabs, panels = [], []
    for i, (region, role, ms) in enumerate(REGIONS):
        tabs.append(f'<button role="tab" id="{px}t{i}" aria-controls="{px}p{i}" aria-selected="{"true" if i == 0 else "false"}"{"" if i == 0 else " tabindex=-1"}>{region}</button>')
        cards = ""
        for name, _, facts, kind in ms:
            title = "Francophone West and Central Africa" if kind == "regional" else name
            go = '<a class="go" href="/markets/kazakhstan">Full market file &rarr;</a>' if kind == "full" else '<span class="go req">Market file on request</span>'
            cards += f'<div class="mcard{" full" if kind == "full" else ""}"><h3>{title}</h3><ul>{"".join(f"<li>{f}</li>" for f in facts)}</ul>{go}</div>'
        panels.append(f'<div id="{px}p{i}" role="tabpanel" aria-labelledby="{px}t{i}"{"" if i == 0 else " hidden"}><p class="plede" style="margin-top:18px">{role}</p><div class="mcards" style="margin-top:12px">{cards}</div></div>')
    return f'<div class="ptabs" role="tablist" aria-label="Regions">{"".join(tabs)}</div>{"".join(panels)}'


def world_map():
    # schematic: positions on a 1000x460 equirectangular crop (not to scale)
    pts = {"Peru": (215, 330), "Senegal": (395, 245), "Francophone W. & C. Africa": (440, 270), "Ghana": (448, 282), "Nigeria": (478, 272),
           "Libya": (515, 175), "Sudan": (570, 240), "Kenya": (600, 300), "Uganda": (585, 292), "Tanzania": (595, 320), "Rwanda": (575, 305),
           "Iraq": (625, 160), "Azerbaijan": (650, 128), "Uzbekistan": (705, 120), "Kazakhstan": (720, 98)}
    src = {"Pakistan": (725, 170), "Bangladesh": (790, 185), "Turkey": (590, 130), "Egypt": (565, 180), "Europe": (510, 85), "Korea": (885, 135)}
    land = ('<path class="land" d="M120 80 L330 70 L340 160 L260 200 L230 240 L250 300 L280 360 L240 420 L200 380 L180 300 L150 200 Z"/>'
            '<path class="land" d="M380 180 L560 160 L640 220 L620 320 L580 380 L520 400 L480 330 L420 280 L380 250 Z"/>'
            '<path class="land" d="M460 60 L940 50 L960 160 L880 210 L780 220 L700 200 L620 190 L560 150 L470 120 Z"/>')
    arcs = "".join(f'<path class="arc" d="M{src[s][0]} {src[s][1]} Q {(src[s][0] + pts[m][0]) / 2} {min(src[s][1], pts[m][1]) - 50} {pts[m][0]} {pts[m][1]}"/>'
                   for s, m in [("Pakistan", "Kazakhstan"), ("Turkey", "Iraq"), ("Pakistan", "Kenya"), ("Bangladesh", "Tanzania"), ("Egypt", "Sudan"),
                                ("Europe", "Senegal"), ("Turkey", "Uzbekistan"), ("Korea", "Peru"), ("Egypt", "Nigeria"), ("Pakistan", "Uganda")])
    mk = "".join(f'<circle class="mk" cx="{x}" cy="{y}" r="6"><title>{n}</title></circle>' for n, (x, y) in pts.items())
    sc = "".join(f'<rect class="src" x="{x - 4}" y="{y - 4}" width="8" height="8" rx="2"><title>{n}</title></rect><text x="{x + 8}" y="{y + 4}">{n}</text>' for n, (x, y) in src.items())
    lab = "".join(f'<text x="{pts[n][0] + 9}" y="{pts[n][1] + 4}">{n}</text>' for n in ["Peru", "Senegal", "Nigeria", "Sudan", "Kenya", "Tanzania", "Iraq", "Kazakhstan", "Uzbekistan"])
    lab += "".join(f'<text x="{pts[n][0] - 9}" y="{pts[n][1] + 4 + dy}" text-anchor="end">{t}</text>' for n, t, dy in [
        ("Libya", "Libya", 0), ("Azerbaijan", "Azerbaijan", 0), ("Uganda", "Uganda", -4), ("Rwanda", "Rwanda", 6),
        ("Francophone W. & C. Africa", "Francophone W. & C. Africa", -8), ("Ghana", "Ghana", 8)])
    return f"""<div class="wmap pcard"><svg viewBox="100 40 880 400" role="img" aria-label="Schematic map: our 14 markets in Africa, Asia and South America, supplied from Pakistan, Bangladesh, Turkey, Egypt, Europe and Korea.">{land}{arcs}{mk}{sc}{lab}</svg>
    <p class="pnote">Schematic, not to scale. Circles: the markets we serve. Squares: source countries.</p></div>"""


def tide():
    return """<div class="tide">
    <div><b>Africa</b><p>The African Medicines Agency became operational in October 2025. East Africa shares assessments across 7 regulators, with the CTD format mandatory. A good dossier now travels.</p></div>
    <div><b>Eurasia</b><p>National registrations not aligned to EAEU rules are being annulled in several member states, and Kazakhstan's national route closes on 31 Dec 2027. One dossier now opens five markets.</p></div>
    <div><b>Supply</b><p>Pakistan's pharmaceutical exports reached a 20-year high of USD 457m in FY2025. Bangladesh exported USD 238.5m in FY2025-26 to more than 130 countries.</p></div>
  </div>"""


def contact_block(dark):
    rows = "".join(f'<div><span>{c}</span><b><a href="tel:{t}" data-track="phone:{t}">{d}</a></b></div>' for t, d, c in PHONES)
    return rows


# ------------------------------------------------------------------ CSS refits on the original inline styles
def refit_css(html, dark):
    style_a = html.index("<style>")
    style_b = html.index("</style>", style_a)
    css = html[style_a:style_b]
    # brand blue
    css = css.replace("#0066FF", "#1259E6").replace("#0052D6", "#0E47B8").replace("#5AA2FF", "#82A4F2").replace("#4D9BFF", "#82A4F2")
    css = css.replace("#0B4BC7", "#1259E6").replace("#0C63F5", "#1259E6")
    # remove gradient backgrounds (balanced parentheses) and leave the flat colour underneath
    out, i = [], 0
    pat = re.compile(r"background-image:\s*(?:linear|radial|repeating-linear)-gradient\(")
    while True:
        m = pat.search(css, i)
        if not m:
            out.append(css[i:]); break
        out.append(css[i:m.start()])
        j, depth = m.end(), 1
        while depth:
            depth += {"(": 1, ")": -1}.get(css[j], 0); j += 1
        while css[j] in " ;":
            j += 1
            if css[j - 1] == ";": break
        i = j
    css = "".join(out)
    css = re.sub(r"background:\s*linear-gradient\([^;}]*?\)\s*([;}])", r"background:var(--line)\1", css)
    css = re.sub(r"box-shadow:[^;}]*;?", "", css)
    css = re.sub(r"backdrop-filter:[^;}]*;?", "", css)
    # no pink or purple
    if dark:
        css = css.replace("--t4:#191233; --t4i:#9B8CFF;", "--t4:#0F1B33; --t4i:#82A4F2;").replace("--t1i:#82A4F2", "--t1i:#82A4F2")
    else:
        css = css.replace("--pastel-lav:#E7E1FB;    --pastel-lav-ink:#3B00FF;", "--pastel-lav:#DAF2E4;    --pastel-lav-ink:#0E6B3F;")
        css = css.replace("--pink:#FBE1EC;          --pink-ink:#D6006C;", "--pink:#FCE7D6;          --pink-ink:#9A4200;")
    css = css.replace("transform:translateY(-3px)", "transform:none")
    return html[:style_a] + css + html[style_b:]


def common(html, path, title, desc, dark):
    html = refit_css(html, dark)
    # fonts: self-hosted (parts.css), no Google Fonts
    html = re.sub(r'<link rel="preconnect"[^>]*>\n?', "", html)
    html = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>\n?', "", html)
    html = re.sub(r'<link rel="icon"[^\n]*\n', "", html)
    html = re.sub(r'<link rel="apple-touch-icon"[^>]*>\n?', "", html)
    for pat in [r'<title>.*?</title>\n?', r'<meta name="description"[^>]*>\n?', r'<link rel="canonical"[^>]*>\n?', r'<meta property="og:[^>]*>\n?',
                r'<meta name="twitter:[^>]*>\n?', r'<meta name="theme-color"[^>]*>\n?', r'<script type="application/ld\+json">.*?</script>\n?']:
        html = re.sub(pat, "", html, flags=re.S)
    html = html.replace("<style>", head_meta(path, title, desc) + '\n<link rel="stylesheet" href="/assets/css/parts.css">\n<style>', 1)
    html = re.sub(r'<nav class="nav">.*?</nav>', nav(path, dark), html, count=1, flags=re.S)
    html = re.sub(r'<script>\s*document\.getElementById\(\'yr\'\)[^<]*</script>', "", html)
    html = html.replace('<script src="/assets/a.js" defer></script>', SCRIPTS)
    return html


def replace_footer(html):
    a = html.index("</main>") + len("</main>")
    b = html.index('<script src="/assets/js/site.js"')
    return html[:a] + "\n" + footer() + "\n" + html[b:]


def must(html, old, new, count=1):
    if old not in html:
        raise SystemExit(f"anchor not found: {old[:90]!r}")
    return html.replace(old, new, count)


# ------------------------------------------------------------------ round 2c: representative, not detailed
def drop_sections(h, names):
    """Remove each top-level block that starts with a <!-- NAME --> comment, up to the next top-level comment or </main>."""
    for n in names:
        a = h.find(f"\n<!-- {n}")
        if a < 0:
            raise SystemExit(f"section not found: {n}")
        nxt = [i for i in (h.find("\n<!-- ", a + 5), h.find("\n</main>", a + 5)) if i > 0]
        h = h[:a] + h[min(nxt):]
    return h


def strip_feature_detail(h):
    h = re.sub(r"\s*<ul>\s*(?:<li>.*?</li>\s*)+</ul>", "", h, flags=re.S)
    h = re.sub(r'\s*<div class="portal-ui".*?</div>\s*</div>', "", h, count=1, flags=re.S)
    return h


# ------------------------------------------------------------------ home (light)
def home():
    h = (SRC / "index.html").read_text()
    h = common(h, "/", "Bridging the gap in medical trade across frontier markets | Nazryx",
               "Nazryx connects medicine makers with the frontier markets that need them, and runs the trade in between. 14 markets on 3 continents, from Almaty to Cape Town.", False)
    # hero
    h = must(h, '<h1>Enabling trade in <span class="blue">frontier markets.</span></h1>\n      <p>Nazryx works with dozens of manufacturers and distributors to streamline sourcing, registration and market entry across 7 markets in Africa and Asia.</p>',
             '<h1>Bridging the gap in medical trade <span class="blue">across frontier markets.</span></h1>\n      <p>Nazryx connects medicine makers with the frontier markets that need them, and runs the trade in between: market reads, registration in the maker\'s name, partners, promotion and state bids. 14 markets on 3 continents.</p>')
    h = must(h, '<a class="btn btn-blue" href="/#who">See what we do</a>', '<a class="btn btn-blue" href="/#layers" data-track="cta:what-we-do">See what we do</a>')
    h = re.sub(r'<div class="locard">.*?</div>\s*</div>\s*</div>\s*</div>\s*</div>', mrun_card() + "\n  </div>\n</div>", h, count=1, flags=re.S)
    # bridge under hero, then journey
    # stats: 6 confirmed tiles
    h = re.sub(r'<div class="wrap stats">.*?</div>\n</div>', """<div class="wrap stats stats6">
  <div class="stat s1"><b>14 · 3</b><span>markets on 3 continents</span></div>
  <div class="stat s2"><b>3 · 10</b><span>manufacturers represented: 3 in Kazakhstan, 10 worldwide</span></div>
  <div class="stat s3"><b data-count="14,000" data-suf="+">14,000+</b><span>register records read</span></div>
  <div class="stat s4"><b data-count="300" data-suf="+">300+</b><span>distributors profiled</span></div>
</div>""", h, count=1, flags=re.S)
    # problem + three layers, before the doors
    layers = f"""<!-- INTELLIGENCE, ACCESS, TRADE -->
<section class="wrap" id="layers" style="padding-top:0">
  <div class="svc-head">
    <div><div class="eyebrow">What Nazryx is</div><h2>One company between both sides. <span class="blue">Three layers.</span></h2></div>
    <p class="lede">We work with manufacturers of finished medicines and devices, suppliers and distributors, and state and hospital buyers.</p>
  </div>
  <div class="layers">
    <a class="layer l1" href="/manufacturers"><small>Intelligence</small><b>We know these markets line by line.</b><p>Registers, shelves, tenders and state buyers, read and kept current.</p><span>For manufacturers &rarr;</span></a>
    <a class="layer l2" href="/manufacturers"><small>Access</small><b>We open markets.</b><p>Registration, local representation and partners, all in the maker's name.</p><span>For manufacturers &rarr;</span></a>
    <a class="layer l3" href="#markets"><small>Trade</small><b>We keep products moving.</b><p>Sourcing, supply, promotion and state bids, run by our teams.</p><span>See our markets &darr;</span></a>
  </div>
</section>

<!-- TWO DOORS -->"""
    h = must(h, "<!-- TWO DOORS -->", layers)
    # doors: buyers too
    h = must(h, '<div class="door-eye">For distributors</div>', '<div class="door-eye">For distributors and buyers</div>')
    # services: keep the six; fix the mock-up's colours (already via tokens) and label it
    h = must(h, '<div class="tile t-score"><b>86/100</b><p>Final score for this product for Tanzania.</p></div>', '<div class="tile t-score"><b>86/100</b><p>Example score for one product in Tanzania.</p></div>')
    # catalogue: corrected facts
    h = must(h, 'We build our portfolio from analytical data drawn from hundreds of sources, used to verify demand, feasibility, market fit and other factors before we even begin pitching our SKUs to potential distributors.',
             'We check demand, feasibility and market fit for every product against national registers, shelves and state purchases before we pitch it to anyone.')
    h = must(h, '<span class="cat-tag">500+ sources used to compile data</span>', '<span class="cat-tag">14,000+ register records read</span>')
    h = must(h, 'Across target countries including Kenya, Iraq, Cambodia, Uganda, Rwanda and other frontier emerging markets.', 'Across our 14 markets in Africa, Asia and South America, from Kenya and Iraq to Kazakhstan and Peru.')
    h = must(h, 'From Pakistani manufacturers across hundreds of SKUs in several verticals.', 'From manufacturers in Pakistan, Bangladesh, Turkey, Egypt, Europe and Korea, product by product.')
    # in-house: drop unbacked 80%/5x/3x, use the four "why Nazryx" points
    h = re.sub(r'<div class="gains">.*?</div>\n    </div>', """<div class="gains">
      <div class="gain"><b style="font-size:22px">Both sides of the trade</b><span>We work with makers and buyers, so we see supply and demand at once.</span></div>
      <div class="gain"><b style="font-size:22px">Data no one else assembles</b><span>Registers, shelves and state purchases, read market by market.</span></div>
      <div class="gain"><b style="font-size:22px">People on the ground</b><span>Teams in Lahore and Almaty, and local networks in every market we serve.</span></div>
      <div class="gain"><b style="font-size:22px">Aligned incentives</b><span>Paid on results. The market stays in the maker's name.</span></div>
    </div>""", h, count=1, flags=re.S)
    # why it works: neutral market reference
    h = must(h, 'An entire clinical category with nothing registered against it in a market of sixty million\n          people', 'An entire clinical category with nothing registered against it in one of our markets')
    # markets block before contact
    kz = """<div class="mcard full" style="margin-top:14px"><small>One market in full</small><h3>Kazakhstan</h3>
      <div class="mock-kpis kpi4"><div><b>$2.5bn</b><span>market, 2025</span></div><div><b>85%</b><span>imported</span></div><div><b>9,659</b><span>pharmacies</span></div><div><b>1,340</b><span>tracked by us</span></div></div>
      <a class="go" href="/markets/kazakhstan" data-track="home:kazakhstan">Open the Kazakhstan market file &rarr;</a></div>"""
    mk = f"""<!-- MARKETS -->
<section class="wrap" id="markets" style="padding-top:0">
  <div class="svc-head"><div><div class="eyebrow">Trade</div><h2>14 markets on 3 continents. <span class="blue">From Almaty to Cape Town.</span></h2></div>
  <p class="lede">Frontier markets import most of their medicines. We connect them with the makers who can supply them, and run the trade in between.</p></div>
  {region_strip()}
</section>

<!-- CONTACT -->"""
    h = must(h, "<!-- CONTACT -->", mk)
    # contact: 14 markets, no addresses, teams not offices
    h = must(h, '<section id="contact" class="wrap" style="padding-top:0">\n  <div id="markets" class="contact">', '<section id="contact" class="wrap" style="padding-top:0">\n  <div class="contact">')
    h = must(h, "<i>Kenya</i><i>Sudan</i><i>Uganda</i><i>Tanzania</i><i>Iraq</i><i>Uzbekistan</i><i>Kazakhstan</i>", "".join(f"<i>{m}</i>" for m in ["Kazakhstan"] + [x for x in MARKET_NAMES if x != "Kazakhstan"]) + "<i>Francophone West and Central Africa</i>")
    h = must(h, "<b>Want to export to</b>", "<b>Markets we serve</b>")
    h = re.sub(r'<div class="offices">.*?</div>\n    </div>', f"""<div class="offices">
        <div class="office"><b>Lahore</b><span>Team in Pakistan</span></div>
        <div class="office"><b>Almaty</b><span>Team on the ground in Kazakhstan</span></div>
        <div class="office"><b>Email</b><span><a href="mailto:{EMAIL}" data-track="email" style="color:#fff">{EMAIL}</a></span></div>
      </div>
    </div>""", h, count=1, flags=re.S)
    h = must(h, '<a href="tel:+447466253544" data-track="phone:+447466253544">+44 7466 253544</a>\n        <a href="tel:+923254307967"', '<a href="tel:+447466253544" data-track="phone:+447466253544">+44 7466 253544</a>\n        <a href="tel:+77086922409" data-track="phone:+77086922409">+7 708 692 2409</a>\n        <a href="tel:+923254307967"')
    h = must(h, '\n        <a href="tel:+77086922409" data-track="phone:+77086922409">+7 708 692 2409</a>\n        </div>', "\n        </div>")
    h = replace_footer(h)
    h = drop_sections(h, ["SERVICES", "PLATFORM", "CATALOGUE", "THESIS", "PARTNER", "WHY IT WORKS"])
    org = {"@context": "https://schema.org", "@type": "Organization", "name": "Nazryx", "url": BASE + "/", "logo": BASE + "/assets/icons/icon-512.png", "email": EMAIL,
           "description": "Nazryx connects medicine makers with the frontier markets that need them, and runs the trade in between.",
           "contactPoint": [{"@type": "ContactPoint", "telephone": d, "contactType": "sales"} for _, d, _ in PHONES]}
    h = must(h, '<link rel="stylesheet" href="/assets/css/parts.css">', f'<script type="application/ld+json">{json.dumps(org)}</script>\n<link rel="stylesheet" href="/assets/css/parts.css">')
    return h


# ------------------------------------------------------------------ manufacturers (dark)
def manufacturers():
    h = (SRC / "manufacturers.html").read_text()
    h = common(h, "/manufacturers", "Your export team for frontier markets | Nazryx",
               "Launch into new markets without the hassle. Nazryx reads each market line by line and runs the launch in your name: registration, importers, doctors and state buyers. 14 markets on 3 continents.", True)
    h = must(h, '<div><span>Markets</span><b>Africa, Asia, Central Asia</b></div>\n        <div><span>Offices</span><b>Lahore, London, Almaty</b></div>',
             '<div><span>Markets</span><b>14 on 3 continents</b></div>\n        <div><span>Teams</span><b>Lahore · on the ground in Almaty</b></div>')
    h = must(h, '<div class="r"><b>Your export team</b><span>Not an introduction service</span></div>', '<div class="r"><b>Your export team</b><span>Registrations in your name</span></div>')
    # stats: confirmed numbers only
    h = re.sub(r'<div class="wrap stats">.*?</div>\n</div>', """<div class="wrap stats">
  <div class="stat s1"><b data-count="14,000" data-suf="+">14,000+</b><span>Register records read line by line across our markets</span></div>
  <div class="stat s2"><b data-count="300" data-suf="+">300+</b><span>Distributors and agents profiled, with their real portfolios</span></div>
  <div class="stat s3"><b data-count="88,000" data-suf="+">88,000+</b><span>State tender lots read</span></div>
  <div class="stat s4"><b>14 · 3</b><span>Markets on 3 continents</span></div>
</div>""", h, count=1, flags=re.S)
    # after "Eight things we run": route toggle + clocks
    h = must(h, "<!-- PROOF -->", f"""<!-- REGISTRATION ROUTE -->
<section class="wrap" id="route" style="padding-top:0">
  <div class="head2"><div><div class="eyebrow">Registration route</div><h2>We choose the route <span class="blue">per product.</span></h2></div>
  <p class="lede">In Kazakhstan there are two routes, and the national one closes on 31 December 2027.</p></div>
  {route()}
</section>

<!-- PROOF -->""")
    # eye-care case: example from another market; drop the unconfirmed 664 row
    h = must(h, '<div class="eyebrow">What this looks like</div>', '<div class="eyebrow">Example from another market</div>')
    h = re.sub(r'\s*<div class="pf"><span>Essential medicines cross-referenced</span><b>664</b></div>', "", h)
    h = must(h, "<!-- MARKETS -->", funnel() + "\n\n<!-- MARKETS -->")
    # markets section: 14 markets with region tabs
    h = must(h, '<h2>Seven markets. We work each one ourselves.</h2>', '<h2>14 markets. We work each one ourselves.</h2>')
    h = must(h, 'Offices in Lahore, London and Almaty. If we don&rsquo;t cover your market, we&rsquo;ll tell you on the first call.',
             'Teams in Lahore and on the ground in Almaty, and local networks in every market. If we don&rsquo;t cover yours, we&rsquo;ll tell you on the first call.')
    h = re.sub(r'<div class="mkts">.*?</div>\n</section>', f'<div style="margin-top:8px">{region_tabs("rg")}</div>\n</section>', h, count=1, flags=re.S)
    # Kazakhstan spotlight
    h = must(h, '<div class="kz-count"><b>1<span>/7</span></b><small>markets we serve</small></div>', '<div class="kz-count"><b>1<span>/14</span></b><small>markets we serve</small></div>')
    h = re.sub(r'<div class="kz-regions">.*?</div>', '<div class="kz-regions"><span>Central Asia and the Caucasus</span><span>East Africa</span><span>West Africa</span><span>North Africa and the Horn</span><span>Middle East</span><span>South America</span><span class="on">Shown in full · <b>Kazakhstan</b></span></div>', h, count=1, flags=re.S)
    h = must(h, '<div class="kz-dots" aria-hidden="true"><i></i><i></i><i></i><i class="on"></i><i></i><i></i><i></i></div>', '<div class="kz-dots" aria-hidden="true">' + '<i class="on"></i>' + '<i></i>' * 13 + '</div>')
    h = must(h, 'aria-label="Kazakhstan is one of seven markets we serve."', 'aria-label="Kazakhstan is one of 14 markets we serve."')
    h = must(h, "One of our seven markets &middot; Kazakhstan", "One of our 14 markets &middot; Kazakhstan")
    h = must(h, 'One of our seven markets, shown in full.', 'One of our 14 markets, shown in full.')
    h = must(h, '<div class="stat s2"><b>+16%</b><span>Forecast growth, 2026</span></div>', '<div class="stat s2"><b>9,659</b><span>Pharmacies</span></div>')
    h = must(h, 'One distributor buys about $1.1bn a year for free and insured care, and publishes every lot. We have read 88,000+ of them.',
             'One national buyer, one round a year. The 2027 round: 976 lots, about $860m. Local and EAEU producers have priority.')
    h = must(h, 'About 9,000 outlets. Chains hold three-quarters of retail, so a few listings reach most of the country.',
             '9,659 pharmacies. Chains hold 76&ndash;77% of pharmacy turnover; the top 15 run 2,507 pharmacies.')
    h = re.sub(r'<b>What a manufacturer has to know in Kazakhstan\.</b>.*?</div>', """<b>What a manufacturer has to know in Kazakhstan.</b> The national route is open until 31 December 2027 and is valid in Kazakhstan only.
    The EAEU route takes 140 working days plus clock stops, with Kazakhstan as reference state. Kazakh and Russian on every pack, Data Matrix on every pack since 1 July 2024.
    VAT on medicines is 5% in 2026 and 10% from 1 January 2027. Registrations are always in your name.
  </div>
  <div class="pgrid2" style="margin-top:16px">
    <div class="pcard"><b style="color:var(--ink)">Retail and hospital, 2025</b>
      <div class="stack-wrap"><div class="stack-row"><span>Value</span><div class="stack" role="img" aria-label="Retail 57% of value, hospital 43%"><i style="width:57%;background:#1259E6">Retail 57%</i><i class="l" style="width:43%">Hospital 43%</i></div></div>
      <div class="stack-row"><span>Packs</span><div class="stack" role="img" aria-label="Retail 83% of packs, hospital 17%"><i style="width:83%;background:#1259E6">Retail 83%</i><i class="l" style="width:17%">17%</i></div></div></div>
      <p class="pnote">Retail KZT 754.7bn, 448.1m packs. Hospital KZT 561.8bn, 89.0m packs. Total KZT 1.3trn, about USD 2.5bn, 537m packs.</p></div>
    <div class="pcard"><b style="color:var(--ink)">Imported share</b>
      <div class="stack-wrap"><div class="stack-row"><span>Value</span><div class="stack" role="img" aria-label="85% of value imported"><i style="width:85%;background:#1259E6">Imported 85%</i><i class="l" style="width:15%">15%</i></div></div>
      <div class="stack-row"><span>Packs</span><div class="stack" role="img" aria-label="68% of packs imported"><i style="width:68%;background:#1259E6">Imported 68%</i><i class="l" style="width:32%">32%</i></div></div></div>
      <p class="pnote">Imports carry the value; local producers carry more of the volume.</p><a class="link-a" href="/markets/kazakhstan" style="color:var(--acc);font-weight:600;font-size:14px">Open the full Kazakhstan market file &rarr;</a></div>
  </div>""", h, count=1, flags=re.S)
    # EAEU section: only confirmed figures
    h = re.sub(r'<tbody>\s*<tr><th scope="row">Kazakhstan</th>.*?</tbody>', """<tbody>
            <tr><th scope="row">Kazakhstan</th><td>about 20.3M</td><td>$2.5bn (2025)</td><td class="hi">Reference state</td></tr>
            <tr><th scope="row">Russia</th><td>&nbsp;</td><td>&nbsp;</td><td>Extension</td></tr>
            <tr><th scope="row">Belarus</th><td>&nbsp;</td><td>&nbsp;</td><td>Extension</td></tr>
            <tr><th scope="row">Armenia</th><td>&nbsp;</td><td>&nbsp;</td><td>Extension</td></tr>
            <tr><th scope="row">Kyrgyzstan</th><td>&nbsp;</td><td>&nbsp;</td><td>Extension</td></tr>
            <!-- TODO Omar: confirm population and market figures for the four extension states before adding them. -->
          </tbody>""", h, count=1, flags=re.S)
    h = must(h, 'Kazakhstan can act as the EAEU reference state, so Belarus, Kyrgyzstan and Armenia can recognise the same dossier. We run every step.',
             'With Kazakhstan as EAEU reference state, the registration can be extended to Russia, Belarus, Armenia and Kyrgyzstan. 140 working days plus clock stops; valid 5 years, then permanent. We run every step.')
    h = must(h, '<h2>One dossier. Four markets.</h2>', '<h2>One dossier. Five markets.</h2>')
    h = must(h, '<div class="pf"><span>Recognition states</span><b>3</b></div>', '<div class="pf"><span>Extension states</span><b>4</b></div>')
    h = re.sub(r'\s*<div class="pf hi"><span>People across the four</span><b>~40M</b></div>', '\n        <div class="pf hi"><span>Validity</span><b class="kz-sm">5 yrs, then permanent</b></div>', h)
    h = re.sub(r'<p class="kz-note">.*?</p>', '<p class="kz-note">EAEU route: 140 working days plus clock stops. GMP inspection of the plant by the Kazakh inspectorate.</p>', h, count=1, flags=re.S)
    # exporting from
    h = must(h, '<h2>Making medicines in Bangladesh, Turkey, Pakistan or Egypt?</h2>', '<h2>Making medicines in Pakistan, Bangladesh, Turkey, Egypt, Europe or Korea?</h2>')
    h = must(h, "<i>Bangladesh</i><i>Turkey</i><i>Pakistan</i><i>Egypt</i>", "<i>Pakistan</i><i>Bangladesh</i><i>Turkey</i><i>Egypt</i><i>Europe</i><i>Korea</i>")
    # who holds what: corrected to the facts
    h = must(h, 'It decides who controls your product in each market. We settle it with you before any paperwork.', 'The answer is simple: you. Registrations are always held in your name.')
    h = re.sub(r'<div class="reg-step key">.*?</div>\n    <div class="reg-step">\s*<em>Replaceable</em>.*?</div>', """<div class="reg-step key">
      <em>Your local representative</em>
      <b>Nazryx</b>
      <p>We act for you in the market: filing, follow-up and the regulator. We are never the holder, and we never take title to stock.</p>
    </div>
    <div class="reg-step">
      <em>Replaceable</em>
      <b>The importer</b>
      <p>Stocks it, sells it, details it. Because the registration is yours, the importer can be replaced without losing anything.</p>
    </div>""", h, count=1, flags=re.S)
    h = must(h, 'The product, the dossier, the plant and the brand are yours throughout. Nothing in how we work\n        changes that, in any market.', 'The product, the dossier, the plant, the brand and the registrations. Yours throughout, in every market.')
    h = re.sub(r'<div class="reg-note">.*?</div>', '<div class="reg-note"><b>Registrations are always held in the manufacturer&rsquo;s name.</b> Nazryx acts as your local representative and is never the holder.</div>', h, count=1, flags=re.S)
    # commitments
    h = must(h, '<b>The registration never goes in our name</b><p>We are your agent, not a party holding your product. Who should hold the certificate in each market is settled with you before anything is filed.</p>',
             '<b>The registration never goes in our name</b><p>It is always held in yours. We are your local representative, never the holder.</p>')
    h = must(h, "Principal Director, Nazryx &mdash; these are commitments, not preferences.", "Director, International Business &mdash; these are commitments, not preferences.")
    # how it starts: four steps from the facts file
    h = re.sub(r'<div class="tl">.*?</div>\n  </div>\n</section>', """<div class="tl">
    <div class="tl-item"><div class="tl-when">Day 1</div><div><b>A 20-minute call</b><p>About your portfolio, certificates and target markets.</p></div></div>
    <div class="tl-item"><div class="tl-when">2&ndash;3 weeks</div><div><b>The market read</b><p>Your catalogue against the register, shelves and state buyers of each target market.</p></div></div>
    <div class="tl-item"><div class="tl-when">Then</div><div><b>The proposal</b><p>Products, filing waves, registration route, launch plan and volumes by year.</p></div></div>
    <div class="tl-item"><div class="tl-when">12&ndash;24 months</div><div><b>Filing and launch</b><p>First sales typically 12&ndash;24 months after filing, depending on the market and route.</p></div></div>
  </div>
</section>""", h, count=1, flags=re.S)
    # sample viewer before the FAQ
    h = must(h, "<!-- FAQ -->", f"""<!-- SAMPLE PROFILE -->
<section class="wrap" style="padding-top:0">
  <div class="head2"><div><div class="eyebrow">What you get</div><h2>A two-page profile <span class="blue">for every product.</span></h2></div>
  <p class="lede">Page one shows the market, page two the plan. Tap a number to see what each block tells you.</p></div>
  {profile("pv")}
</section>

<!-- FAQ -->""")
    # FAQ additions (first answer of the original list stays)
    faq_add = """<details class="q"><summary>Whose name is on the registration?<svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="q-body"><p>Yours. Registrations are always held in the manufacturer&rsquo;s name. Nazryx acts as your local representative and is never the holder.</p></div></details>
    <details class="q"><summary>Do we need an EAEU GMP certificate?<svg class="chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="q-body"><p>For the EAEU route, the plant is inspected by the Kazakh inspectorate. We check your plant&rsquo;s position for each route on the first call, before you spend anything on a dossier.</p></div></details>
    """
    h = re.sub(r'(<div class="faq">\s*)', r"\1" + faq_add.replace("\\", "\\\\"), h, count=1)
    h = h.replace("Nazryx &mdash; a company of Nazir &amp; Company International (PVT) Limited", "Teams in Lahore and on the ground in Almaty")
    h = must(h, "Where you hold leverage and where you would be undercut", "Where you have the edge, and where you would be undercut")
    h = drop_sections(h, ["PROBLEM", "REGISTRATION ROUTE", "PROOF", "MARKET IN FOCUS", "EAEU ROUTE", "OUTPUT", "FIT", "SAMPLE PROFILE"])
    h = strip_feature_detail(h)
    h = re.sub(r'<div style="margin-top:8px"><div class="ptabs" role="tablist" aria-label="Regions">.*?</div>\n</section>', f'<div style="margin-top:8px">{region_strip()}</div>\n</section>', h, count=1, flags=re.S)
    h = must(h, "</style>", ".kz-regions span{font-size:12.5px}\n@media(max-width:560px){.kz-table th,.kz-table td{white-space:normal}}\n</style>")
    h = replace_footer(h)
    return h


# ------------------------------------------------------------------ distributors (dark)
def partners():
    h = (SRC / "partners.html").read_text()
    h = common(h, "/partners", "Sourcing and market intelligence for distributors and buyers | Nazryx",
               "Nazryx runs sourcing and market intelligence for pharmaceutical distributors and institutional buyers: suppliers found and vetted, quotes compared, registrations watched, a weekly report. 14 markets on 3 continents.", True)
    h = re.sub(r'<div class="wrap stats">.*?</div>\n</div>', """<div class="wrap stats">
  <div class="stat s1"><b data-count="14,000" data-suf="+">14,000+</b><span>Register records read across our markets</span></div>
  <div class="stat s2"><b data-count="300" data-suf="+">300+</b><span>Distributors and agents profiled</span></div>
  <div class="stat s3"><b data-count="88,000" data-suf="+">88,000+</b><span>State tender lots read</span></div>
  <div class="stat s4"><b>14 · 3</b><span>Markets on 3 continents</span></div>
</div>""", h, count=1, flags=re.S)
    # replace "The platform" self-serve section with the private portal mock-ups
    a = h.index("The platform")
    sec_a = h.rfind("<section", 0, a)
    sec_b = h.index("</section>", a) + len("</section>")
    h = h[:sec_a] + f"""<section class="wrap" id="portal" style="padding-top:0">
  <div class="head2"><div><div class="eyebrow">Your private portal</div><h2>Everything we find, <span class="blue">in one place.</span></h2></div>
  <p class="lede">We do the work; the portal shows it. Market reads, state lots, a weekly report and vetted shortlists, shared with your whole team.</p></div>
  {mockups()}
</section>""" + h[sec_b:]
    h = h.replace("Principal Director, Nazryx", "Director, International Business")
    h = re.sub(r"We work across seven distribution markets in Africa and Asia today, with partner offices in Lahore, London and Almaty\..*?</p>",
               "We work across 14 markets on 3 continents: Kazakhstan, Uzbekistan, Azerbaijan, Kenya, Uganda, Tanzania, Rwanda, Nigeria, Ghana, Senegal, francophone West and Central Africa, Sudan, Libya, Iraq and Peru. Teams in Lahore and on the ground in Almaty. Sourcing runs through Pakistan, Bangladesh, Turkey, Egypt, Europe and Korea.</p>", h, count=1, flags=re.S)
    h = h.replace("Distribute, manufacture or source pharmaceuticals in Africa, Asia or the Middle East", "Distribute, source or buy medicines in Africa, Asia, the Middle East or South America")
    h = h.replace("Nazryx &mdash; a company of Nazir &amp; Company International (PVT) Limited", "Teams in Lahore and on the ground in Almaty")
    h = drop_sections(h, ["PROBLEM", "MOVED FROM HOME: the platform", "MOVED FROM HOME: the objective", "PROOF", "OUTPUT", "FIT"])
    h = strip_feature_detail(h)
    h = replace_footer(h)
    return h


# ------------------------------------------------------------------ light pages built from the home page shell
def light_page(path, title, desc, body, extra_js=""):
    h = home()
    a = h.index('<main id="main">') + len('<main id="main">')
    b = h.index("</main>")
    h = h[:a] + "\n" + body + "\n" + h[b:]
    h = re.sub(r"<title>.*?</title>.*?<meta name=\"twitter:image\"[^>]*>", head_meta(path, title, desc), h, count=1, flags=re.S)
    h = re.sub(r'<script type="application/ld\+json">.*?</script>\n', "", h, flags=re.S)
    h = h.replace('<script src="/assets/js/scan.js" defer></script>\n', extra_js)
    for h_, t in NAV:
        h = h.replace(f'<a href="{h_}" aria-current=page', f'<a href="{h_}"')
    for h_, t in NAV:
        if path.startswith(h_):
            h = h.replace(f'<a href="{h_}" data-track', f'<a href="{h_}" aria-current=page data-track')
    return h


def contact_light(h2, lede):
    rows = "".join(f'<a href="tel:{t}" data-track="phone:{t}">{d}</a>' for t, d, _ in PHONES)
    return f"""<section id="contact" class="wrap" style="padding-top:0">
  <div class="cta">
    <div class="cta-top">
      <div style="max-width:34ch"><h2>{h2}</h2><p style="margin-top:12px;color:rgba(255,255,255,.88)">{lede}</p></div>
      <div class="cta-call"><small>Call or WhatsApp</small>{rows}</div>
    </div>
    <div class="hero-cta" style="margin:0"><a class="btn btn-white" href="/call" data-track="calendly">Book a call</a><a class="btn btn-white" style="background:rgba(255,255,255,.16);color:#fff" href="{WA}" target="_blank" rel="noopener" data-track="whatsapp">Message on WhatsApp</a><a class="btn btn-white" style="background:rgba(255,255,255,.16);color:#fff" href="mailto:{EMAIL}" data-track="email">{EMAIL}</a></div>
  </div>
</section>"""


def markets_page():
    body = f"""<div class="wrap hero">
  <div class="hero-grid">
    <div>
      <div class="eyebrow">Markets</div>
      <h1>14 markets on <span class="blue">3 continents.</span></h1>
      <p>Asia, Africa and South America. USD 10bn+ of medicines imported a year and 650m+ people. Kazakhstan is the market we show in full; every market gets the same work.</p>
      <div class="hero-cta"><a class="btn btn-blue" href="/markets/kazakhstan" data-track="markets:kazakhstan">Kazakhstan, in full</a><a class="btn btn-ghost" href="#contact">Ask for a market file</a></div>
    </div>
    {mrun_card()}
  </div>
</div>
<section class="wrap" style="padding-top:0">{market_cards()}</section>
{contact_light("Ask for a market file.", "Tell us which market and send your product list. We will show you what is open there.")}"""
    return light_page("/markets", "Markets we serve: 14 markets on 3 continents | Nazryx",
                      "Nazryx serves 14 pharmaceutical markets on 3 continents: Central Asia, East and West Africa, North Africa, the Middle East and South America. Kazakhstan shown in full.", body)


def kz_page():
    mx = max(v for _, v in PRICES)
    pb = "".join(f'<div class="hbar" data-c="{c}"><span>{c}</span><div class="t"><i style="width:{v / mx * 100:.1f}%"></i></div><b>{v:.2f}</b></div>' for c, v in PRICES)
    opts = "".join(f"<option>{c}</option>" for c, _ in PRICES)
    db = "".join(f'<div class="hbar soft"><span>{s}</span><div class="t"><i style="width:{n / DOCTORS[0][1] * 100:.1f}%"></i></div><b>{n:,}</b></div>' for s, n in DOCTORS)
    chain_dash = f"{2 * math.pi * 52 * 0.765:.1f} 400"
    top_dash = f"{2 * math.pi * 52 * 0.505:.1f} 400"
    body = f"""<div class="wrap hero">
  <div class="hero-grid">
    <div>
      <div class="eyebrow">One of our 14 markets, shown in full</div>
      <h1>Kazakhstan: <span class="blue">an import market of $2.5bn.</span></h1>
      <p>85% of the value is imported. About 20.3 million people, 9,659 pharmacies and one national state buyer. Our team is on the ground in Almaty.</p>
      <div class="hero-cta"><a class="btn btn-blue" href="#contact" data-track="cta:send-list">Send your product list</a><a class="btn btn-ghost" href="/markets">All 14 markets</a></div>
    </div>
    <div class="mrun"><div class="mrun-top"><b>At a glance</b><span>2025</span></div><dl>
      <div><dt>Population</dt><dd>about 20.3 million</dd></div>
      <div><dt>Medicines market</dt><dd>KZT 1.3trn, about USD 2.5bn, 537m packs</dd></div>
      <div><dt>Imported</dt><dd>85% of value, 68% of packs</dd></div>
      <div><dt>Doctors</dt><dd>83,994 (excluding dentists)</dd></div>
      <div><dt>Import duty (HS 3004)</dt><dd>0%</dd></div></dl></div>
  </div>
</div>
<div class="wrap stats">
  <div class="stat s1"><b data-count="9,659">9,659</b><span>pharmacies</span></div>
  <div class="stat s2"><b>76&ndash;77%</b><span>of pharmacy turnover held by chains</span></div>
  <div class="stat s3"><b data-count="1,340">1,340</b><span>pharmacies we track, SKU by SKU, in 17 cities</span></div>
  <div class="stat s4"><b data-count="1,000" data-suf="+">1,000+</b><span>physicians in our network</span></div>
</div>
<section class="wrap" style="padding-top:56px">
  <div class="svc-head"><div><div class="eyebrow">The market</div><h2>Where the money goes.</h2></div><p class="lede">Retail carries most of the value and almost all of the packs. Imports carry the value; local producers carry more of the volume.</p></div>
  <div class="pgrid2">
    <div class="pcard"><b>Retail and hospital, 2025</b><div class="stack-wrap">
      <div class="stack-row"><span>Value</span><div class="stack" role="img" aria-label="Retail 57% of value, hospital 43%"><i style="width:57%;background:#1259E6">Retail 57%</i><i class="l" style="width:43%">Hospital 43%</i></div></div>
      <div class="stack-row"><span>Packs</span><div class="stack" role="img" aria-label="Retail 83% of packs, hospital 17%"><i style="width:83%;background:#1259E6">Retail 83%</i><i class="l" style="width:17%">17%</i></div></div></div>
      <p class="pnote">Retail KZT 754.7bn, 448.1m packs. Hospital KZT 561.8bn, 89.0m packs.</p></div>
    <div class="pcard"><b>Imported share</b><div class="stack-wrap">
      <div class="stack-row"><span>Value</span><div class="stack" role="img" aria-label="85% of value imported"><i style="width:85%;background:#1259E6">Imported 85%</i><i class="l" style="width:15%">15%</i></div></div>
      <div class="stack-row"><span>Packs</span><div class="stack" role="img" aria-label="68% of packs imported"><i style="width:68%;background:#1259E6">Imported 68%</i><i class="l" style="width:32%">32%</i></div></div></div>
      <p class="pnote">National data, 2025.</p></div>
  </div>
</section>
<section class="wrap" style="padding-top:0">
  <div class="pgrid2">
    <div class="pcard"><b>Pharmacies and chains</b>
      <div class="donut" style="margin-top:14px"><svg viewBox="0 0 120 120" role="img" aria-label="Chains hold 76 to 77% of pharmacy turnover"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" cx="60" cy="60" r="52" data-dash="{chain_dash}"/></svg>
      <div><p class="plede"><b style="color:var(--ink)">76&ndash;77%</b> of pharmacy turnover goes through chains. The top 15 chains run 2,507 pharmacies and hold 50.5%.</p></div></div></div>
    <div class="pcard"><b>The state buyer</b>
      <div class="donut" style="margin-top:14px"><svg viewBox="0 0 120 120" role="img" aria-label="Top 15 chains hold 50.5% of turnover"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" cx="60" cy="60" r="52" data-dash="{top_dash}" style="stroke:#9DB9F2"/></svg>
      <div><p class="plede">SK-Pharmacy buys for free and insured care in one national round a year. <b style="color:var(--ink)">2027 round: 976 lots, about USD 860m.</b> Local and EAEU producers have priority.</p></div></div></div>
  </div>
</section>
<section class="wrap" style="padding-top:0">
  <div class="svc-head"><div><div class="eyebrow">Price position</div><h2>Where your price lands <span class="blue">on the shelf.</span></h2></div>
  <p class="lede">Shelf price of the same medicine and dose, by producer country. India = 1.00.</p></div>
  <div class="pcard"><div class="hbars" id="price-bars" role="img" aria-label="{"; ".join(f"{c} {v:.2f}" for c, v in PRICES)}">{pb}</div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:16px;font-size:14px"><label for="your-country">Your country</label><select id="your-country" style="font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card)"><option value="">Choose…</option>{opts}</select></div>
    <p class="pnote">Kazakh pharmacies, November 2026.</p></div>
</section>
<section class="wrap" style="padding-top:0">
  <div class="svc-head"><div><div class="eyebrow">Doctors</div><h2>83,994 doctors. <span class="blue">By specialty.</span></h2></div>
  <p class="lede">Doctors in Kazakhstan, 2025, excluding dentists. We reach them directly through our network of 1,000+ physicians.</p></div>
  <div class="pcard"><div class="hbars" role="img" aria-label="{"; ".join(f"{s} {n}" for s, n in DOCTORS)}">{db}</div></div>
</section>
<section class="wrap" style="padding-top:0">
  <div class="svc-head"><div><div class="eyebrow">Registration</div><h2>Two routes. <span class="blue">We pick one per product.</span></h2></div>
  <p class="lede">EAEU registrations are valid 5 years, then permanent. GMP inspection of the plant by the Kazakh inspectorate. Registrations always in your name.</p></div>
  <div class="pgrid2">{route()}<div class="pcard"><b>One dossier, five markets</b>
    <div class="hbars" style="margin-top:14px"><div class="hbar"><span>Kazakhstan</span><div class="t"><i style="width:100%"></i></div><b>Reference</b></div>
    {"".join(f'<div class="hbar soft"><span>{c}</span><div class="t"><i style="width:100%"></i></div><b>Extension</b></div>' for c in ["Russia", "Belarus", "Armenia", "Kyrgyzstan"])}</div>
    <p class="pnote">EAEU route: 140 working days plus clock stops, Kazakhstan as reference state.</p></div></div>
</section>
<section class="wrap" style="padding-top:0">
  <div class="svc-head"><div><div class="eyebrow">On every pack</div><h2>Labels, marking <span class="blue">and tax.</span></h2></div></div>
  <div class="pcard"><div class="ptl">
    <div><b>1 Jul 2024</b>Data Matrix code on every pack.</div>
    <div><b>2026</b>VAT on medicines 5%.</div>
    <div><b>31 Dec 2027</b>National registration route closes.</div>
    <div><b>1 Jan 2027</b>VAT on medicines rises to 10%.</div></div>
    <p class="pnote">Kazakh and Russian on every pack. Import duty on finished medicines (HS 3004): 0%.</p></div>
</section>
<section class="wrap" style="padding-top:0">
  <div class="svc-head"><div><div class="eyebrow">Try it</div><h2>Is your molecule open <span class="blue">in Kazakhstan?</span></h2></div></div>
  {scan()}
</section>
<section class="wrap" style="padding-top:0">
  <div class="svc-head"><div><div class="eyebrow">On the ground in Almaty</div><h2>What our team <span class="blue">runs for you.</span></h2></div></div>
  <div class="pgrid3">
    <div class="pcard"><b>100+ distributor relationships</b><p class="plede" style="margin-top:8px">The importer and chain listings, chosen with you.</p></div>
    <div class="pcard"><b>1,000+ physicians</b><p class="plede" style="margin-top:8px">Direct physician outreach, by specialty and region.</p></div>
    <div class="pcard"><b>Regulatory and government services</b><p class="plede" style="margin-top:8px">Filing, follow-up, and Kazakh and Russian translation in-house.</p></div>
  </div>
</section>
{contact_light("Send your product list. We'll show you what's open.", "We check every product against the register, 1,340 pharmacy shelves and the state purchase list.")}"""
    body = body.replace('<div><b>2026</b>VAT on medicines 5%.</div>\n    <div><b>31 Dec 2027</b>National registration route closes.</div>\n    <div><b>1 Jan 2027</b>VAT on medicines rises to 10%.</div>',
                        '<div><b>2026</b>VAT on medicines 5%.</div>\n    <div><b>1 Jan 2027</b>VAT on medicines rises to 10%.</div>\n    <div><b>31 Dec 2027</b>National registration route closes.</div>')
    return light_page("/markets/kazakhstan", "Kazakhstan market file for pharmaceutical manufacturers | Nazryx",
                      "Kazakhstan, one of Nazryx's 14 markets, shown in full: a $2.5bn medicines market, 85% imported. Channels, chains, state buyer, prices by producer country, doctors, registration routes, labelling and tax.",
                      body, '<script src="/assets/js/scan.js" defer></script>\n')


def sample_page():
    body = f"""<div class="wrap hero" style="padding-bottom:24px"><div style="max-width:760px"><div class="eyebrow">Sample</div>
<h1>One product. <span class="blue">Two pages.</span></h1><p>The profile we write for every product we screen: the market on page one, the plan on page two.</p></div></div>
<section class="wrap" style="padding-top:0">{profile("sp")}</section>
{contact_light("Want to see a real one?", "Sample available on request. Send us one product and we will show you its profile.")}"""
    return light_page("/sample", "Sample product profile | Nazryx", "The two-page product profile Nazryx writes for every product: the market on page one, the plan on page two.", body)


def notfound():
    body = '<div class="wrap hero"><div class="eyebrow">404</div><h1>Page not found.</h1><p>Try the <a href="/" style="color:var(--blue)">home page</a>, <a href="/manufacturers" style="color:var(--blue)">manufacturers</a> or <a href="/markets" style="color:var(--blue)">markets</a>.</p></div>'
    h = light_page("/404", "Page not found | Nazryx", "This page does not exist.", body)
    return h.replace('<link rel="canonical" href="https://nazryx.com/404">', '<meta name="robots" content="noindex">')


if __name__ == "__main__":
    (SITE / "markets").mkdir(exist_ok=True)
    out = {"index.html": home(), "manufacturers.html": manufacturers(), "partners.html": partners(), "markets.html": markets_page(),
           "markets/kazakhstan.html": kz_page(), "sample.html": sample_page(), "404.html": notfound()}
    for name, html in out.items():
        (SITE / name).write_text(html, encoding="utf-8")
        print("wrote", name, len(html))
