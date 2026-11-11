#!/usr/bin/env python3
"""Generate the static pages in site/ from shared header/footer templates.

Run: python3 tools/build.py   (output is committed; Cloudflare serves site/ as-is, no build step)
Facts used here must come from section 1 of docs/NAZRYX_SITE_BRIEF.md.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
BASE = "https://nazryx.com"
CAL = "https://calendly.com/nazryx/meeting-with-omar"
WA = "https://wa.me/447466253544"
EMAIL = "contact@nazryx.com"
PHONES = [
    ("+447466253544", "+44 7466 253544", "UK · WhatsApp"),
    ("+77086922409", "+7 708 692 2409", "Kazakhstan · WhatsApp"),
    ("+923254307967", "+92 325 4307967", "Pakistan"),
]
LOGO = '<svg viewBox="0 0 837 346" aria-hidden="true"><path d="M171 0 L403 0 L613 210 L613 0 L837 0 L837 198 L689 346 L461 346 L295 179 L131 346 L0 346 L0 174 Z" fill="#1259E6"/></svg>'
NAV = [("/manufacturers", "For manufacturers"), ("/kazakhstan", "Kazakhstan"), ("/partners", "For distributors")]

# Outline icons, 1.5px stroke (drawn in the Lucide style, kept inline so nothing extra loads)
ICONS = {
    "list": '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    "file": '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14l2 2 4-4"/>',
    "shield": '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    "truck": '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    "users": '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.2 3.5 5"/>',
    "chart": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    "layers": '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    "tag": '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    "bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    "inbox": '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    "calendar": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
}
WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>'


def icon(name):
    return f'<span class="ic" aria-hidden="true"><svg viewBox="0 0 24 24">{ICONS[name]}</svg></span>'


def header(path):
    links = "".join(
        f'<a href="{h}"{" aria-current=page" if h == path else ""} data-track="nav:{h.strip("/")}">{t}</a>' for h, t in NAV
    )
    phones = "".join(f'<a href="tel:{t}" data-track="phone:{t}">{d}</a>' for t, d, _ in PHONES)
    return f"""<a class="skip" href="#main">Skip to content</a>
<header class="hdr">
  <div class="hdr-in">
    <a class="logo" href="/" aria-label="Nazryx home" data-track="nav:home">{LOGO}<b>Nazryx</b></a>
    <nav class="nav" aria-label="Main">{links}<a class="btn btn-blue" href="#contact" data-track="nav:talk">Talk to us</a></nav>
    <button class="menu-btn" type="button" aria-controls="menu" aria-expanded="false" aria-label="Open menu"><span></span></button>
  </div>
</header>
<div class="panel" id="menu" role="dialog" aria-modal="true" aria-label="Menu">
  <div class="panel-top"><a class="logo" href="/">{LOGO}<b>Nazryx</b></a><button class="panel-close" type="button" aria-label="Close menu">&times;</button></div>
  <nav aria-label="Mobile">{links}</nav>
  <a class="btn btn-blue" href="#contact" data-track="nav:talk">Talk to us</a>
  <div class="panel-contact">{phones}<a href="mailto:{EMAIL}" data-track="email">{EMAIL}</a></div>
</div>"""


def footer():
    links = '<a href="/">Home</a><a href="/manufacturers">Manufacturers</a><a href="/kazakhstan">Kazakhstan</a><a href="/partners">Distributors</a><a href="#contact">Contact</a>'
    phones = "".join(f'<a href="tel:{t}" data-track="phone:{t}">{d}</a>' for t, d, _ in PHONES)
    # TODO Omar: confirm the LinkedIn company URL, then add it here.
    return f"""<footer class="ftr">
  <div class="ftr-in">
    <span>&copy; 2026 Nazryx</span>
    <nav aria-label="Footer">{links}</nav>
    <div class="c">{phones}<a href="mailto:{EMAIL}" data-track="email">{EMAIL}</a><!-- TODO Omar: LinkedIn company link --></div>
    <small>Anonymous analytics. No cookies. No IP addresses stored.</small>
  </div>
</footer>
<a class="wa" href="{WA}" target="_blank" rel="noopener" data-track="whatsapp:float">{WA_ICON}WhatsApp</a>"""


def contact(h2="Talk to us.", lede="Send your product list, or book twenty minutes."):
    rows = "".join(f'<div><dt>{c}</dt><dd><a href="tel:{t}" data-track="phone:{t}">{d}</a></dd></div>' for t, d, c in PHONES)
    return f"""<section class="wrap" id="contact">
  <div class="contact">
    <div class="rv">
      <div class="eyebrow">Contact</div>
      <h2>{h2}</h2>
      <p class="lede">{lede}</p>
      <div class="btns">
        <a class="btn btn-blue" href="/call" data-track="calendly">Book a call</a>
        <a class="btn btn-line" href="{WA}" target="_blank" rel="noopener" data-track="whatsapp">Message on WhatsApp</a>
      </div>
      <p class="note">Teams in Lahore, Pakistan and on the ground in Almaty, Kazakhstan.</p>
    </div>
    <div class="kv rv">
      <h3>Reach us directly</h3>
      <p class="sub">Email in plain text: {EMAIL}</p>
      <dl>{rows}<div><dt>Email</dt><dd><a href="mailto:{EMAIL}" data-track="email">{EMAIL}</a></dd></div></dl>
    </div>
  </div>
</section>"""


def page(path, title, desc, body, scripts=()):
    url = BASE + (path if path != "/" else "/")
    extra = "".join(f'\n<script src="{s}" defer></script>' for s in scripts)
    org = {
        "@context": "https://schema.org", "@type": "Organization", "name": "Nazryx", "url": BASE + "/",
        "logo": BASE + "/assets/icons/icon-512.png", "email": EMAIL,
        "description": "Export team for pharmaceutical manufacturers in frontier markets.",
        "contactPoint": [{"@type": "ContactPoint", "telephone": d, "contactType": "sales"} for _, d, _ in PHONES],
    }
    ld = f'\n<script type="application/ld+json">{json.dumps(org)}</script>' if path == "/" else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<link rel="preload" href="/assets/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/site.css">
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
<meta name="twitter:image" content="{BASE}/assets/og.png">{ld}
</head>
<body>
{header(path)}
<main id="main">
{body}
</main>
{footer()}
<script src="/assets/js/site.js" defer></script>{extra}
<script src="/assets/a.js" defer></script>
</body>
</html>
"""


# ---------------------------------------------------------------- shared blocks

SCAN = f"""<section class="wrap" id="scan-demo">
  <div class="head">
    <div><div class="eyebrow">Try it</div><h2>Is your molecule open <span class="b">in Kazakhstan?</span></h2></div>
    <p class="lede">Pick a molecule. We scan the national register and the shelves of 1,340 pharmacies, then tell you how crowded it is.</p>
  </div>
  <div class="scan" id="scan">
    <div class="scan-pick card">
      <label for="scan-q">Molecule</label>
      <input class="scan-input" id="scan-q" type="text" autocomplete="off" placeholder="Start typing, e.g. Apixaban" role="combobox" aria-expanded="false" aria-controls="scan-list" aria-autocomplete="list">
      <ul class="scan-list" id="scan-list" role="listbox" aria-label="Molecules" hidden></ul>
      <p class="scan-miss" hidden aria-live="polite"></p>
      <div class="chips" aria-label="Quick picks">
        <button class="chip" type="button" data-inn="Amlodipine" data-track="scan:chip">Amlodipine</button>
        <button class="chip" type="button" data-inn="Apixaban" data-track="scan:chip">Apixaban</button>
        <button class="chip" type="button" data-inn="Dapagliflozin" data-track="scan:chip">Dapagliflozin</button>
        <button class="chip" type="button" data-inn="Atorvastatin + ezetimibe" data-track="scan:chip">Atorvastatin + ezetimibe</button>
      </div>
    </div>
    <div class="card scan-card" aria-live="polite">
      <div class="scan-grid" aria-hidden="true">{"<i></i>" * 26}</div>
      <div class="scan-line" aria-hidden="true"></div>
      <div class="scan-empty"><b>Choose a molecule to start the scan.</b><span>Brands registered, makers by origin, shelf presence and a verdict.</span></div>
      <div class="scan-res"></div>
      <div class="scan-foot">
        <p>This is one molecule. We run this for every product in your catalogue, against the register, 1,340 pharmacy shelves and the state purchase list.</p>
        <a class="btn btn-blue" href="mailto:{EMAIL}?subject=Product%20list%20for%20Kazakhstan" data-track="scan:send-list">Send your product list</a>
      </div>
    </div>
  </div>
  <p class="note">Kazakhstan national register (live) and shelves of 1,340 pharmacies, November 2026.</p>
</section>"""


def gl():
    return '<i class="gl" style="left:25%"></i><i class="gl" style="left:50%"></i><i class="gl" style="left:75%"></i>'


def bar(left, width, label, soft=False):
    return f'<div class="g-bar{" soft" if soft else ""}" style="left:{left}%;width:{width}%"><em>{label}</em></div>'


ROUTE = f"""<section class="wrap" id="route">
  <div class="head">
    <div><div class="eyebrow">Registration route</div><h2>Two routes into Kazakhstan. <span class="b">We pick one per product.</span></h2></div>
    <p class="lede">Quick products go national for 2028 sales. Products that need a bioequivalence study go EAEU.</p>
  </div>
  <div class="card">
    <div class="tabs" role="tablist" aria-label="Registration route">
      <button role="tab" id="t-nat" aria-controls="p-nat" aria-selected="true" data-track="route:national">National route</button>
      <button role="tab" id="t-eaeu" aria-controls="p-eaeu" aria-selected="false" tabindex="-1" data-track="route:eaeu">EAEU route</button>
    </div>
    <div class="route-panel" id="p-nat" role="tabpanel" aria-labelledby="t-nat">
      <div class="gantt" role="img" aria-label="National route: file in Q2 2027, expertise up to 100 working days, first sales 2028. The national window closes on 31 December 2027.">
        <div class="g-axis"><span>2027</span><span>2028</span><span>2029</span><span>2030</span></div>
        <div class="g-row"><span>File</span><div class="g-track">{gl()}{bar(6.25, 6.25, "Q2 2027")}<div class="g-mark" style="left:25%"><em>National window closes 31 Dec 2027</em></div></div></div>
        <div class="g-row"><span>Expertise</span><div class="g-track">{gl()}{bar(12.5, 11, "Up to 100 working days", True)}</div></div>
        <div class="g-row"><span>First sales</span><div class="g-track">{gl()}{bar(25, 75, "From 2028")}</div></div>
      </div>
      <p class="g-side">Valid in Kazakhstan only. The national route is open until 31 December 2027.</p>
    </div>
    <div class="route-panel" id="p-eaeu" role="tabpanel" aria-labelledby="t-eaeu" hidden>
      <div class="gantt" role="img" aria-label="EAEU route: file 2027 to 2028, 140 working days plus answers, 12 to 18 months in total, first sales 2029. Extendable to Russia, Belarus, Armenia and Kyrgyzstan.">
        <div class="g-axis"><span>2027</span><span>2028</span><span>2029</span><span>2030</span></div>
        <div class="g-row"><span>File</span><div class="g-track">{gl()}{bar(6.25, 31.25, "2027–28")}</div></div>
        <div class="g-row"><span>Review</span><div class="g-track">{gl()}{bar(12.5, 37.5, "140 working days + answers (12–18 months)", True)}</div></div>
        <div class="g-row"><span>First sales</span><div class="g-track">{gl()}{bar(50, 50, "From 2029")}</div></div>
      </div>
      <p class="g-side">Kazakhstan as reference state. Extendable to Russia, Belarus, Armenia and Kyrgyzstan.</p>
    </div>
  </div>
</section>"""

PROFILE_PAGES = [
    ("Page 1 · Market", [
        ("w3", "Competitors", "Who already sells this molecule, and from which countries."),
        ("w3", "Packs on sale", "Every pack and strength on the shelf, with the price it sells at."),
        ("w2", "Market structure", "How sales split between pharmacies, chains and the state buyer."),
        ("w4", "Volume", "How many packs move a year, so you can size the opportunity."),
    ]),
    ("Page 2 · Plan", [
        ("w3", "Registration", "Which route, how long, and what your dossier still needs."),
        ("w3", "Promotion", "Which doctors prescribe it, and how we reach them."),
        ("w6", "Launch plan", "Importer, pricing and filing wave, in one line per step."),
    ]),
]


def profile(prefix="pv"):
    tabs, pages = [], []
    for i, (name, blocks) in enumerate(PROFILE_PAGES):
        sel = "true" if i == 0 else "false"
        tabs.append(f'<button role="tab" id="{prefix}-t{i}" aria-controls="{prefix}-p{i}" aria-selected="{sel}"{"" if i == 0 else " tabindex=-1"}>{name}</button>')
        blks = ""
        for n, (w, b, note) in enumerate(blocks, 1):
            blks += f'<div class="blk {w}"><b>{b}</b><span class="sk"></span><span class="sk"></span><span class="sk"></span><button class="hot" type="button" aria-expanded="false" aria-label="What {b.lower()} tells you">{n}</button><span class="hot-tip" role="note">{note}</span></div>'
        pages.append(f'<div class="prof-page" id="{prefix}-p{i}" role="tabpanel" aria-labelledby="{prefix}-t{i}"{"" if i == 0 else " hidden"}><div class="prof">{blks}</div></div>')
    return f"""<div class="card">
    <div class="tabs prof-tabs" role="tablist" aria-label="Profile pages">{"".join(tabs)}</div>
    {"".join(pages)}
    <div class="prof-req"><p class="note">Layout of a real two-page profile. The content belongs to the manufacturer it was written for. Sample available on request.</p>
    <a class="btn btn-line" href="mailto:{EMAIL}?subject=Sample%20product%20profile" data-track="sample:request">Request a sample</a></div>
  </div>"""


# ---------------------------------------------------------------- pages

def home():
    body = f"""<section class="wrap hero">
  <div class="hero-grid">
    <div class="rv">
      <div class="eyebrow">Bridging the gap in medical trade across frontier markets</div>
      <h1>Your export team <span class="b">for frontier markets.</span></h1>
      <p class="lede">We read each market's register, shelves and state purchases, show you where your products fit, and run the launch in your name: registration, importers, doctors and state bids.</p>
      <div class="btns">
        <a class="btn btn-blue" href="#scan-demo" data-track="cta:see-open">See what's open</a>
        <a class="btn btn-line" href="#contact" data-track="cta:talk">Talk to us</a>
      </div>
    </div>
    <div class="kv rv" aria-label="Kazakhstan now">
      <h3>Kazakhstan now</h3>
      <p class="sub">Our lead market. Team on the ground in Almaty.</p>
      <dl>
        <div><dt>Medicines market, 2025</dt><dd>$2.5bn</dd></div>
        <div><dt>Pharmacies</dt><dd>9,659</dd></div>
        <div><dt>Imported share of value</dt><dd>85%</dd></div>
        <div><dt>EAEU route</dt><dd>Reference state</dd></div>
      </dl>
    </div>
  </div>
</section>

<section class="wrap tight" aria-label="Proof">
  <div class="kpis">
    <div class="kpi rv"><b>3 · 10</b><span>manufacturers represented: 3 in Kazakhstan, 10 worldwide</span></div>
    <div class="kpi g rv"><b data-count="1,340">1,340</b><span>pharmacies tracked, SKU by SKU</span></div>
    <div class="kpi p rv"><b data-count="1,000" data-suf="+">1,000+</b><span>physicians in our Kazakhstan network</span></div>
    <div class="kpi w rv"><b data-count="7">7</b><span>markets: Kazakhstan, Kenya, Uganda, Tanzania, Sudan, Iraq, Uzbekistan</span></div>
  </div>
</section>

{SCAN}

<section class="wrap">
  <div class="doors">
    <a class="door blue rv" href="/manufacturers" data-track="door:manufacturers">
      <span class="eyebrow">For manufacturers</span>
      <h3>Launch into new markets. Keep the registrations in your name.</h3>
      <p>We choose what to launch, register it, appoint the importer and run doctors and state bids. Paid on results.</p>
      <span class="go">How it works &rarr;</span>
    </a>
    <a class="door rv" href="/partners" data-track="door:partners">
      <span class="eyebrow">For distributors</span>
      <h3>We run your sourcing and market intelligence.</h3>
      <p>Suppliers found and vetted, quotes compared, registrations watched. Reported weekly, not sold as a login.</p>
      <span class="go">How it works &rarr;</span>
    </a>
  </div>
</section>

{contact()}"""
    return page("/", "Pharmaceutical export team for frontier markets | Nazryx",
                "Nazryx is the export team for pharmaceutical manufacturers in frontier markets: registration, importers, doctors and state bids, run in your name. Lead market: Kazakhstan.",
                body, ["/assets/js/scan.js"])


RUN = [
    ("list", "Choose what to launch", ["Your catalogue read against the register and shelves.", "A ranked list of what is open, thin or crowded."]),
    ("file", "Register", ["Route, dossier and translation into Kazakh and Russian.", "Filed and followed through in your name."]),
    ("shield", "Pass quality checks", ["GMP and certification pack checked before filing.", "Questions from the regulator answered locally."]),
    ("truck", "Importer and chains", ["Importer appointed from 100+ local relationships.", "Listings with the pharmacy chains that hold most sales."]),
    ("users", "Doctors and promotion", ["Direct outreach to 1,000+ physicians.", "Promotion planned by specialty and region."]),
    ("chart", "State bids and reporting", ["The national purchase round, lot by lot.", "A written report every week."]),
]


def manufacturers():
    cards = "".join(
        f'<div class="card rv">{icon(i)}<h3>{t}</h3><ul>{"".join(f"<li>{x}</li>" for x in b)}</ul></div>' for i, t, b in RUN
    )
    story_steps = [
        (96, "Made in your own plant", "Step 1", "We start from what you already make, in your own plant."),
        (40, "Checked against the national register", "Step 2", "Products already crowded on the register drop out."),
        (18, "Checked against 1,340 pharmacy shelves and the state purchase list", "Step 3", "We keep what sells, or what the state buys, with room for one more source."),
        (15, "Ready to file or worth a bioequivalence study", "Step 4", "What is left is worth filing now, or worth a study first."),
    ]
    steps_html = '<div class="story-step cur" data-keep="120" data-label="products in the catalogue"><small>Start</small><h3>Your catalogue: 120 products.</h3><p>Each dot is one product. Scroll to see how we narrow it down.</p></div>'
    for keep, label, k, p in story_steps:
        steps_html += f'<div class="story-step" data-keep="{keep}" data-label="{label.lower()}"><small>{k} · {keep}</small><h3>{label}</h3><p>{p}</p></div>'
    steps_html += '<div class="story-step" data-keep="15" data-waves data-label="products, in 4 filing waves"><small>The plan</small><h3>15 products · 4 filing waves · registrations in your name.</h3><p>First sales 2028–2030.</p></div>'
    wave = lambda n, c: f'<div class="wave"><b>Wave {n}</b><div>{"<i></i>" * c}</div></div>'
    faq = [
        ("Are you an agent, a consultant or a distributor?", "<p>An agent. We never take title to stock. We register your products, appoint the importer, run promotion and state bids, and report weekly.</p>"),
        ("How are you paid?", "<p>On results: commission on sales, agreed per market before anything starts. There is no fee for introductions.</p>"),
        ("Whose name is on the registration?", "<p>Yours. Registrations are always held in the manufacturer's name. We act as your local representative and are never the holder. You keep the product, dossier, plant and brand.</p>"),
        # TODO Omar: confirm the EAEU GMP requirements to state here.
        ("Do we need an EAEU GMP certificate?", "<p>It depends on the route. We check your plant's position for the national and the EAEU route on the first call, before you spend anything on a dossier.</p>"),
        ("We already have a distributor in that market.", "<p>Then we look at whether they are the right one. Often the distributor is fine and the gap is pricing, promotion or a state bid. The importer can always be replaced, because the registration is in your name.</p>"),
        ("How long until first sales?", "<p>12–24 months after filing, depending on the route. The national route can bring sales in 2028; the EAEU route in 2029.</p>"),
        ("What do you need from us to start?", "<p>Your product list with dosage forms and strengths, and your certification pack. Dossiers come later, and only for the products you take forward.</p>"),
    ]
    faq_html = "".join(f'<details><summary>{q}</summary><div class="a">{a}</div></details>' for q, a in faq)
    body = f"""<section class="wrap hero">
  <div class="hero-grid">
    <div class="rv">
      <div class="eyebrow">For manufacturers</div>
      <h1>Launch into new markets. <span class="b">Keep the registrations in your name.</span></h1>
      <p class="lede">We are your export team: we choose what to launch, register it, appoint the importer, and run doctors and state bids. Paid on results.</p>
      <div class="btns"><a class="btn btn-blue" href="#contact" data-track="cta:talk">Talk to us</a><a class="btn btn-line" href="#story" data-track="cta:plan">See how we plan</a></div>
    </div>
    <div class="kv rv">
      <h3>How we work</h3>
      <dl>
        <div><dt>Model</dt><dd>Agent, never the distributor</dd></div>
        <div><dt>Registrations</dt><dd>In your name</dd></div>
        <div><dt>Paid</dt><dd>Commission on sales</dd></div>
        <div><dt>Reporting</dt><dd>Weekly</dd></div>
      </dl>
    </div>
  </div>
</section>

<section class="wrap tight" aria-label="Proof">
  <div class="kpis">
    <div class="kpi rv"><b data-count="10">10</b><span>manufacturers represented worldwide, 3 in Kazakhstan</span></div>
    <div class="kpi g rv"><b data-count="1,340">1,340</b><span>pharmacies tracked in Kazakhstan</span></div>
    <div class="kpi p rv"><b data-count="1,000" data-suf="+">1,000+</b><span>physicians in our Kazakhstan network</span></div>
    <div class="kpi w rv"><b data-count="7">7</b><span>markets</span></div>
  </div>
</section>

<section class="wrap" id="run">
  <div class="head"><div><div class="eyebrow">What we run</div><h2>Six jobs, <span class="b">one team.</span></h2></div>
  <p class="lede">Everything a market launch needs, run by us in your name.</p></div>
  <div class="grid3">{cards}</div>
</section>

<section class="wrap" id="story">
  <div class="eyebrow">From your catalogue to a plan</div>
  <h2>120 products in. <span class="b">15 worth filing.</span></h2>
  <div class="story" style="margin-top:40px">
    <div class="story-stick">
      <div class="card" style="padding:0">
        <div class="dots" role="img" aria-label="Illustrative catalogue: 120 products narrowed to 96, 40, 18 and 15, then split into four filing waves."></div>
        <div class="waves" aria-hidden="true">{wave("1A", 4)}{wave("1B", 4)}{wave("2A", 4)}{wave("2B", 3)}</div>
        <div class="story-count"><span>products in the catalogue</span><b>120</b></div>
      </div>
      <p class="note">Illustrative, based on a 2026 screen.</p>
    </div>
    <div class="story-steps">{steps_html}</div>
  </div>
</section>

{ROUTE}

<section class="wrap">
  <div class="head"><div><div class="eyebrow">Who holds what</div><h2>You keep the registrations. <span class="b">We do the work.</span></h2></div></div>
  <div class="grid3">
    <div class="card rv"><span class="k">You</span><h3>Product, dossier, plant, brand and registrations</h3><p>Everything stays yours, in your name, in every market.</p></div>
    <div class="card rv"><span class="k">Nazryx</span><h3>Your local representative</h3><p>We act for you on the ground. We never hold the registration or the stock.</p></div>
    <div class="card rv"><span class="k">The importer</span><h3>Stocks and sells it</h3><p>Appointed with you, and replaceable if they stop performing.</p></div>
  </div>
</section>

<section class="wrap">
  <div class="head"><div><div class="eyebrow">What you get</div><h2>A two-page profile <span class="b">for every product.</span></h2></div>
  <p class="lede">Page one shows the market. Page two shows the plan. Tap a number to see what each block tells you.</p></div>
  {profile()}
</section>

<section class="wrap tight">
  <div class="card">
    <div class="eyebrow">Kazakhstan</div>
    <h2>Our lead market, <span class="b">in three figures.</span></h2>
    <div class="kpis" style="margin-top:28px">
      <div class="kpi"><b>$2.5bn</b><span>medicines market, 2025</span></div>
      <div class="kpi g"><b>85%</b><span>of value imported</span></div>
      <div class="kpi p"><b>9,659</b><span>pharmacies</span></div>
      <div class="kpi w" style="justify-content:center"><a class="btn btn-blue" href="/kazakhstan" data-track="cta:kazakhstan">See Kazakhstan</a></div>
    </div>
  </div>
</section>

<section class="wrap">
  <div class="head"><div><div class="eyebrow">What we put in writing</div><h2>Four commitments, <span class="b">on paper before you start.</span></h2></div></div>
  <div class="grid2">
    <div class="card rv"><h3>No competing line in your category</h3><p>We do not represent a directly competing product in the same category in the same market.</p></div>
    <div class="card rv"><h3>The registration never goes in our name</h3><p>It is always held in yours. We are your local representative, never the holder.</p></div>
    <div class="card rv"><h3>We tell you when not to enter</h3><p>If a market is crowded or the numbers do not work, you hear it before you pay for a dossier.</p></div>
    <div class="card rv"><h3>Your documentation stays yours</h3><p>Portfolio, pricing and certification pack stay confidential. If we part ways, nothing of yours stays with us.</p></div>
  </div>
  <p class="note" style="font-size:15px;color:var(--ink)"><b>Omar Nazir</b>, Director, International Business</p>
</section>

<section class="wrap">
  <div class="head"><div><div class="eyebrow">How it starts</div><h2>A short call. <span class="b">Then the evidence.</span></h2></div></div>
  <div class="steps">
    <div class="step rv"><small>Day 1</small><b>20-minute call</b><p>Your portfolio, certifications and target markets.</p></div>
    <div class="step rv"><small>2–3 weeks</small><b>Market read</b><p>What is open, thin or crowded for your products.</p></div>
    <div class="step rv"><small>Then</small><b>Proposal</b><p>Products, route, waves and terms, in writing.</p></div>
    <div class="step rv"><small>Next</small><b>Filing</b><p>Dossiers filed in your name.</p></div>
    <div class="step last rv"><small>12–24 months after filing</small><b>First sales</b><p>Depending on the route.</p></div>
  </div>
</section>

<section class="wrap">
  <div class="head"><div><div class="eyebrow">Fit</div><h2>We would rather <span class="b">say no early.</span></h2></div>
  <p class="lede">We take on a few manufacturers at a time, in exclusive partnerships.</p></div>
  <div class="grid2">
    <div class="card"><h3>A good fit if you</h3><ul class="ticks">
      <li>Make finished medicines to a recognised GMP standard</li>
      <li>Want to enter or grow in frontier markets</li>
      <li>Have enough lines that choosing which to push matters</li>
      <li>Can support registration with a dossier</li></ul></div>
    <div class="card"><h3>Not a fit if you</h3><ul class="ticks no">
      <li>Want a distributor to buy your stock outright</li>
      <li>Need a one-off report rather than a launch</li>
      <li>Cannot share a product list and certification pack</li></ul></div>
  </div>
</section>

<section class="wrap">
  <div class="eyebrow">Questions</div>
  <h2 style="margin-bottom:32px">What manufacturers <span class="b">ask first.</span></h2>
  <div class="faq">{faq_html}</div>
</section>

{contact("Send your product list.", "We will show you what is open, and whether it is worth filing. Or book twenty minutes.")}"""
    return page("/manufacturers", "Market entry for pharmaceutical manufacturers | Nazryx",
                "Launch into new markets and keep the registrations in your name. Nazryx chooses what to launch, registers it, appoints the importer and runs doctors and state bids. Paid on results.",
                body, ["/assets/js/story.js"])


PRICES = [("Russia", .75), ("Kazakhstan", .97), ("Pakistan", .98), ("India", 1.00), ("Slovenia", 1.18), ("Turkey", 1.34), ("Western Europe", 1.41), ("Germany", 1.43)]
DOCTORS = [("Therapists", 6908), ("Gynaecologists", 5279), ("Paediatricians", 4893), ("Neurologists", 2649), ("Cardiologists", 1995), ("Endocrinologists", 1073), ("Dermatovenereologists", 926), ("Urologists", 870)]


def kazakhstan():
    kz_contact = contact('Send your product list. <span class="b">We\'ll show you what\'s open.</span>', "We check every product against the register, 1,340 pharmacy shelves and the state purchase list.")
    mx = max(v for _, v in PRICES)
    pbars = "".join(
        f'<div class="bar{" ref" if c == "India" else ""}" data-c="{c}"><span>{c}</span><div class="t"><i style="width:{v / mx * 100:.1f}%"></i></div><b>{v:.2f}</b></div>' for c, v in PRICES
    )
    opts = "".join(f"<option>{c}</option>" for c, _ in PRICES)
    dmx = DOCTORS[0][1]
    dbars = "".join(
        f'<div class="bar"><span>{s}</span><div class="t"><i style="width:{n / dmx * 100:.1f}%"></i></div><b>{n:,}</b></div>' for s, n in DOCTORS
    )
    body = f"""<section class="wrap hero">
  <div class="hero-grid">
    <div class="rv">
      <div class="eyebrow">Kazakhstan · lead market</div>
      <h1>Kazakhstan: <span class="b">an import market of $2.5bn.</span></h1>
      <p class="lede">85% of the value is imported. About 20.3 million people, 9,659 pharmacies and one national state buyer. Our team is on the ground in Almaty.</p>
      <div class="btns"><a class="btn btn-blue" href="#contact" data-track="cta:send-list">Send your product list</a><a class="btn btn-line" href="/#scan-demo" data-track="cta:scan">Check a molecule</a></div>
    </div>
    <div class="kv rv">
      <h3>At a glance</h3>
      <dl>
        <div><dt>Population</dt><dd>about 20.3 million</dd></div>
        <div><dt>Medicines market 2025 (retail and hospital)</dt><dd>$2.5bn (KZT 1.3 trn)</dd></div>
        <div><dt>Imported share of value</dt><dd>85%</dd></div>
        <div><dt>Pharmacy share of value</dt><dd>57%</dd></div>
      </dl>
    </div>
  </div>
</section>

<section class="wrap tight">
  <div class="kpis">
    <div class="kpi rv"><b data-count="9,659">9,659</b><span>pharmacies</span></div>
    <div class="kpi g rv"><b>~&frac34;</b><span>of pharmacy sales go through chains</span></div>
    <div class="kpi p rv"><b data-count="2,507">2,507</b><span>pharmacies run by the top 15 chains, holding half of sales</span></div>
    <div class="kpi w rv"><b data-count="1,340">1,340</b><span>pharmacies we track, SKU by SKU, in 17 cities</span></div>
  </div>
</section>

<section class="wrap">
  <div class="grid2">
    <div class="rv">
      <div class="eyebrow">The state buyer</div>
      <h2>One national round <span class="b">a year.</span></h2>
      <p class="lede">SK-Pharmacy buys for free and insured care in one national round. We read it lot by lot and position your products where there is a way in.</p>
    </div>
    <div class="kpis rv" style="grid-template-columns:1fr 1fr;align-content:center">
      <div class="kpi"><b data-count="976">976</b><span>lots in the 2027 round</span></div>
      <div class="kpi g"><b data-count="860" data-pre="$" data-suf="m">$860m</b><span>approximate value of the 2027 round</span></div>
    </div>
  </div>
</section>

<section class="wrap" id="prices">
  <div class="head"><div><div class="eyebrow">Price position</div><h2>Where your price lands <span class="b">on the shelf.</span></h2></div>
  <p class="lede">Shelf price of the same medicine and dose, by producer country. India = 1.00.</p></div>
  <div class="card">
    <div class="bars" role="img" aria-label="{"; ".join(f"{c} {v:.2f}" for c, v in PRICES)}">{pbars}</div>
    <div class="price-ctl"><label for="your-country">Your country</label><select id="your-country"><option value="">Choose…</option>{opts}</select></div>
    <p class="note">Shelf price of the same medicine and dose, by producer country. India = 1.00. Kazakh pharmacies, November 2026.</p>
  </div>
</section>

<section class="wrap">
  <div class="head"><div><div class="eyebrow">Doctors</div><h2>Who prescribes, <span class="b">by specialty.</span></h2></div>
  <p class="lede">Doctors in Kazakhstan, 2025. We reach them directly through our network of 1,000+ physicians.</p></div>
  <div class="card"><div class="bars on" role="img" aria-label="{"; ".join(f"{s} {n}" for s, n in DOCTORS)}">{dbars}</div></div>
</section>

{ROUTE}

<section class="wrap" id="eaeu">
  <div class="head"><div><div class="eyebrow">One dossier, more markets</div><h2>Kazakhstan as reference state. <span class="b">Four more markets.</span></h2></div>
  <p class="lede">An EAEU registration with Kazakhstan as reference state can be extended to Russia, Belarus, Armenia and Kyrgyzstan.</p></div>
  <div class="eaeu">
    <div class="card map">
      <svg viewBox="0 0 600 380" role="img" aria-label="Schematic map: Kazakhstan is the reference state; the registration can be extended to Russia, Belarus, Armenia and Kyrgyzstan.">
        <path class="land" data-rec d="M120 40 L560 30 L580 150 L470 150 L420 120 L300 125 L250 150 L170 150 L130 110 Z"/>
        <path class="land" data-rec d="M40 105 L105 100 L115 150 L50 158 Z"/>
        <path class="land kz" d="M250 160 L300 135 L420 130 L470 160 L455 245 L380 262 L300 250 L240 220 Z"/>
        <path class="land" data-rec d="M120 255 L160 250 L168 285 L128 292 Z"/>
        <path class="land" data-rec d="M390 272 L455 262 L462 300 L398 306 Z"/>
        <path class="arc" d="M350 195 Q360 120 380 90"/>
        <path class="arc" d="M300 195 Q180 130 80 128"/>
        <path class="arc" d="M290 215 Q200 250 145 270"/>
        <path class="arc" d="M370 230 Q410 260 425 285"/>
        <text x="330" y="190" class="w">Kazakhstan</text><text x="318" y="208" class="w" style="font-weight:500;font-size:11px">Reference state</text>
        <text x="390" y="80">Russia</text><text x="40" y="92">Belarus</text><text x="112" y="315">Armenia</text><text x="388" y="328">Kyrgyzstan</text>
      </svg>
    </div>
    <div class="card tbl stack">
      <table>
        <thead><tr><th>Country</th><th>Route</th></tr></thead>
        <tbody>
          <tr><th scope="row">Kazakhstan</th><td data-l="Route"><b class="b">Reference state</b></td></tr>
          <tr><th scope="row">Russia</th><td data-l="Route">Extension</td></tr>
          <tr><th scope="row">Belarus</th><td data-l="Route">Extension</td></tr>
          <tr><th scope="row">Armenia</th><td data-l="Route">Extension</td></tr>
          <tr><th scope="row">Kyrgyzstan</th><td data-l="Route">Extension</td></tr>
          <!-- TODO Omar: confirm population figures for the other four before adding a People column. -->
        </tbody>
      </table>
      <p class="note">EAEU route: 140 working days plus clock stops. Schematic map, not to scale.</p>
    </div>
  </div>
</section>

<section class="wrap">
  <div class="head"><div><div class="eyebrow">On every pack</div><h2>Labels, marking <span class="b">and VAT.</span></h2></div></div>
  <div class="grid3">
    <div class="card rv">{icon("tag")}<h3>Kazakh and Russian</h3><p>Both languages on every pack. We translate products and documents in-house.</p></div>
    <div class="card rv">{icon("layers")}<h3>Data Matrix code</h3><p>On every pack since 1 July 2024.</p></div>
    <div class="card rv">{icon("chart")}<h3>VAT on medicines</h3><p>5% in 2026. 10% from 1 January 2027.</p></div>
  </div>
</section>

<section class="wrap">
  <div class="head"><div><div class="eyebrow">On the ground in Almaty</div><h2>What our team <span class="b">runs for you.</span></h2></div></div>
  <div class="grid3">
    <div class="card rv">{icon("truck")}<h3>100+ distributor relationships</h3><p>The importer and chain listings chosen with you.</p></div>
    <div class="card rv">{icon("users")}<h3>1,000+ physicians</h3><p>Direct physician outreach, by specialty and region.</p></div>
    <div class="card rv">{icon("file")}<h3>Regulatory and government services</h3><p>Filing, follow-up and translation, done locally and in-house.</p></div>
  </div>
</section>

{kz_contact}"""
    return page("/kazakhstan", "Kazakhstan market entry for pharmaceutical manufacturers | Nazryx",
                "Kazakhstan: a $2.5bn medicines market, 85% imported. Registration routes, state purchases, prices by producer country and doctors by specialty, with a Nazryx team on the ground in Almaty.",
                body)


FUNCS = [
    ("search", "Market and demand intelligence", "Demand, competition and registrations, per molecule and per market. Products enter where the evidence supports them."),
    ("users", "Manufacturer discovery and vetting", "Manufacturers searched by molecule, dosage form and certification. Only credible ones reach you."),
    ("layers", "Portfolio consolidation", "The fewest manufacturers that cover the most of your lines. Fewer audits, simpler shipments."),
    ("file", "Registration tracking", "Registration position per molecule and market. Lapses and new entrants flagged as they happen."),
    ("tag", "Pricing and RFQs", "Quotation rounds run for you. Quotes compared like for like."),
    ("chart", "Buyer analytics", "Your own customers as data: what to offer whom, and which accounts are slowing."),
    ("inbox", "Your private portal", "Everything above in one place, for your whole team."),
    ("calendar", "Quarterly reviews", "What moved, what did not and why. Targets reset with our team."),
]


def partners():
    cards = "".join(f'<div class="card rv">{icon(i)}<span class="k">{n:02d}</span><h3>{t}</h3><p>{p}</p></div>' for n, (i, t, p) in enumerate(FUNCS, 1))
    faq = [
        ("Is this software, or people?", "<p>People, using our own software. You are not buying a login: our team does the work and you get the result, weekly.</p>"),
        ("What do you need from us?", "<p>One person for about a week at the start: your catalogue, supplier list, markets and priorities. After that, a weekly read and a call when a decision is needed.</p>"),
        ("What happens to our data?", "<p>It is used for your partnership only. Not pooled, not resold, not used for anyone else. This is written into the agreement.</p>"),
        ("Which markets do you cover?", "<p>Kazakhstan, Kenya, Uganda, Tanzania, Sudan, Iraq and Uzbekistan, sourcing from Pakistan, Bangladesh, Turkey, Egypt, Europe and South Korea.</p>"),
    ]
    faq_html = "".join(f'<details><summary>{q}</summary><div class="a">{a}</div></details>' for q, a in faq)
    body = f"""<section class="wrap hero">
  <div class="hero-grid">
    <div class="rv">
      <div class="eyebrow">For distributors</div>
      <h1>We don't sell you data. <span class="b">We run the function.</span></h1>
      <p class="lede">Sourcing, market intelligence, registration tracking and pricing, run by our team on your catalogue, every week.</p>
      <div class="btns"><a class="btn btn-blue" href="#contact" data-track="cta:talk">Talk to us</a><a class="btn btn-line" href="#run" data-track="cta:run">See what we run</a></div>
    </div>
    <div class="kv rv">
      <h3>How it works</h3>
      <dl>
        <div><dt>Built around</dt><dd>Your catalogue</dd></div>
        <div><dt>Onboarding</dt><dd>About a week</dd></div>
        <div><dt>Reporting</dt><dd>Weekly</dd></div>
        <div><dt>Intake</dt><dd>A few partners at a time</dd></div>
      </dl>
    </div>
  </div>
</section>

<section class="wrap tight" aria-label="What you get">
  <!-- TODO Omar: confirm counts for suppliers vetted and RFQs run before showing numbers. -->
  <div class="kpis">
    <div class="kpi rv"><b data-count="7">7</b><span>markets covered</span></div>
    <div class="kpi g rv"><b>Weekly</b><span>written reports</span></div>
    <div class="kpi p rv"><b>Per category</b><span>suppliers vetted</span></div>
    <div class="kpi w rv"><b>RFQs</b><span>run and compared for you</span></div>
  </div>
</section>

<section class="wrap" id="run">
  <div class="head"><div><div class="eyebrow">What we run</div><h2>Eight functions, <span class="b">run every week.</span></h2></div>
  <p class="lede">Most companies do these in the gaps between other work. We take them over as a set.</p></div>
  <div class="grid4">{cards}</div>
</section>

<section class="wrap">
  <div class="grid2" style="align-items:center">
    <div class="rv">
      <div class="eyebrow">Your private portal</div>
      <h2>Everything we find, <span class="b">in one place.</span></h2>
      <p class="lede">Openings, lapses, overlaps and quotes as we find them, shared with your whole team. We do the work; the portal shows it.</p>
    </div>
    <div class="card portal rv" aria-label="Portal example">
      <div><i>Opening</i><b>Injectable, 1 mg/ml</b><span>No registration in market</span></div>
      <div><i>Lapse</i><b>Your line, tablets</b><span>Registration expired</span></div>
      <div><i>Overlap</i><b>4 lines, one manufacturer</b><span>Consolidation available</span></div>
      <div><i>RFQ</i><b>6 quotes compared</b><span>Ready to review</span></div>
    </div>
  </div>
</section>

<section class="wrap">
  <div class="grid2" style="align-items:center">
    <div class="rv">
      <div class="eyebrow">What this looks like</div>
      <h2>53 registrations. <span class="b">Not one of them usable.</span></h2>
      <p class="lede">We checked a widely used antiparasitic against a national register: 53 active registrations, a crowded molecule on paper. All 53 were veterinary. For human medicine, the market was open.</p>
    </div>
    <div class="kv rv"><h3>The register check</h3><dl>
      <div><dt>Registrations found</dt><dd>53</dd></div><div><dt>Veterinary</dt><dd>53</dd></div><div><dt>Human medicine</dt><dd>0</dd></div></dl></div>
  </div>
</section>

<section class="wrap">
  <div class="head"><div><div class="eyebrow">What we put in writing</div><h2>Four commitments.</h2></div></div>
  <div class="grid2">
    <div class="card rv"><h3>Your data stays yours</h3><p>Not sold, not pooled, not shown to another company.</p></div>
    <div class="card rv"><h3>No two of you in one category</h3><p>We do not run the same work for a direct competitor in the same city and category.</p></div>
    <div class="card rv"><h3>We tell you when to walk away</h3><p>If a line is not worth chasing, you hear it before you spend on it.</p></div>
    <div class="card rv"><h3>What we build goes with you</h3><p>If we part ways, the catalogue work and supplier mapping are yours.</p></div>
  </div>
  <p class="note" style="font-size:15px;color:var(--ink)"><b>Omar Nazir</b>, Director, International Business</p>
</section>

<section class="wrap">
  <div class="head"><div><div class="eyebrow">Onboarding</div><h2>About a week. <span class="b">One person from your side.</span></h2></div></div>
  <div class="steps steps4">
    <div class="step rv"><small>Before we start</small><b>A 20-minute call</b><p>Your categories, markets and where the friction is.</p></div>
    <div class="step rv"><small>Days 1–3</small><b>We load your business</b><p>Catalogue, suppliers, buyers and goals.</p></div>
    <div class="step rv"><small>Days 4–7</small><b>We set up your portal</b><p>Scoring weighted to your economics.</p></div>
    <div class="step last rv"><small>Week 2 onward</small><b>The function runs</b><p>Weekly reports, alerts and RFQs.</p></div>
  </div>
</section>

<section class="wrap">
  <div class="grid2">
    <div class="card"><h3>A good fit if you</h3><ul class="ticks"><li>Distribute or source medicines in frontier markets</li><li>Carry enough lines that portfolio choices matter</li><li>Can give one person for a week at the start</li></ul></div>
    <div class="card"><h3>Not a fit if you</h3><ul class="ticks no"><li>Want a database login to run yourself</li><li>Need a one-off report</li><li>Cannot share catalogue and supplier data</li></ul></div>
  </div>
</section>

<section class="wrap">
  <div class="eyebrow">Questions</div>
  <h2 style="margin-bottom:32px">What distributors <span class="b">ask first.</span></h2>
  <div class="faq">{faq_html}</div>
</section>

{contact("Start with twenty minutes.", "Tell us what you carry and where you sell it. We will tell you what we would look at first.")}"""
    return page("/partners", "Sourcing and market intelligence for pharmaceutical distributors | Nazryx",
                "Nazryx runs sourcing, market intelligence, registration tracking and pricing for pharmaceutical distributors, on your catalogue, every week.",
                body)


def sample():
    body = f"""<section class="wrap hero">
  <div class="rv" style="max-width:760px">
    <div class="eyebrow">Sample</div>
    <h1>One product. <span class="b">Two pages.</span></h1>
    <p class="lede">This is the layout of the profile we write for every product we screen: the market on page one, the plan on page two.</p>
  </div>
</section>
<section class="wrap" style="padding-top:0">
  <!-- TODO Omar: replace the skeleton with the approved anonymised profile content. -->
  {profile("sp")}
</section>
{contact("Want to see a real one?", "Sample available on request. Send us one product and we will show you its profile.")}"""
    return page("/sample", "Sample product profile | Nazryx",
                "The two-page product profile Nazryx writes for every product: the market on page one, the plan on page two.", body)


def notfound():
    body = """<section class="wrap hero"><div class="eyebrow">404</div><h1>Page not found.</h1>
<p class="lede">Try the <a class="link" href="/">home page</a>, <a class="link" href="/manufacturers">manufacturers</a> or <a class="link" href="/kazakhstan">Kazakhstan</a>.</p></section>"""
    return page("/404", "Page not found | Nazryx", "This page does not exist.", body).replace(
        '<link rel="canonical" href="https://nazryx.com/404">', '<meta name="robots" content="noindex">')


if __name__ == "__main__":
    out = {
        "index.html": home(), "manufacturers.html": manufacturers(), "kazakhstan.html": kazakhstan(),
        "partners.html": partners(), "sample.html": sample(), "404.html": notfound(),
    }
    for name, html in out.items():
        (SITE / name).write_text(html, encoding="utf-8")
        print("wrote", name, len(html))
