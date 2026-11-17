"""Builds profile/nazryx-profile.html (16:9 slides). PDF: node render (see README note in commit)."""
import pathlib
HERE = pathlib.Path(__file__).parent
LOGO = '<div class="logo"><svg viewBox="0 0 837 346"><path d="M171 0 L403 0 L613 210 L613 0 L837 0 L837 198 L689 346 L461 346 L295 179 L131 346 L0 346 L0 174 Z" fill="#1259E6"/></svg>Nazryx</div>'
N = [0]
def top(label): return f'<div class="top">{LOGO}<span>{label}</span></div>'
def foot():
    N[0] += 1
    return f'<div class="foot"><span>Nazryx · Company profile</span><span>{N[0]+1:02d}</span></div>'
R = [("Central Asia and the Caucasus", "Kazakhstan · Uzbekistan · Azerbaijan", "One dossier can reach five EAEU markets."),
     ("East Africa", "Kenya · Uganda · Tanzania · Rwanda", "A shared dossier format opens the region."),
     ("West Africa", "Nigeria · Ghana · Senegal · Francophone West and Central Africa", "Import-led, with central state buyers."),
     ("North Africa and the Horn", "Sudan · Libya", "National buyers rebuilding supply."),
     ("Middle East", "Iraq", "One state importer sets the volume."),
     ("South America", "Peru", "A price-led market with a central state buyer.")]
ms = "".join(f'<div><span>{a}</span><p>{b}</p></div>' for a, b, c in R)
rg = "".join(f'<div class="card"><span>{a}</span><h3>{b}</h3><p>{c}</p></div>' for a, b, c in R)
Y = '<span class="y">✓</span>'; X = '<span class="n">–</span>'
rows = [("Reads the market for you before you commit", X, X), ("Registers your products", Y, "sometimes"), ("Registration held in your name", Y, "sometimes"),
        ("Finds partners and buyers", X, "they are the buyer"), ("Stays on the account after launch", X, Y), ("Rewarded for your sales", X, "margin on stock")]
tb = "".join(f'<tr><td>{a}</td><td>{b}</td><td>{c}</td><td class="us">{Y}</td></tr>' for a, b, c in rows)
PH = [("Read", "We read your portfolio against each market: what's open, thin or crowded, and in what order to launch."),
      ("Register", "We choose the route, complete the local dossier and follow the filing through, in your name."),
      ("Launch", "We vet and appoint the importer, secure pharmacy chain listings and prepare state bids."),
      ("Grow", "We stay on the account: doctors, prices, state rounds, reorders, and a written report every week.")]
ph = "".join(f'<div class="pr"><b>{i}. {a}</b><p>{t}</p></div>' for i, (a, t) in enumerate(PH, 1))
S = []
S.append(f'''<section class="s dark">{top("Company profile · 2026")}
<div class="mid"><div class="eb">Market data and market entry for pharmaceutical manufacturers</div>
<h1>The bridge between medicine makers <span class="ac">and frontier markets.</span></h1>
<p class="lede" style="margin-top:22px">14 markets on 3 continents. From Almaty to Cape Town.</p></div>
<div class="ms">{ms}</div></section>''')
S.append(f'''<section class="s">{top("01 · At a glance")}
<div class="grid" style="grid-template-columns:1.25fr 1fr;gap:64px;align-items:start;margin-top:10px">
<div><div class="eb">Who we are</div><h2>You make medicines. <span class="ac">We open the markets that need them.</span></h2>
<p class="lede" style="font-size:19px">Nazryx is a market data and market entry agency for pharmaceutical manufacturers. We know frontier markets line by line, and we take manufacturers into them, with the registrations in their name.</p>
<p class="lede" style="font-size:19px;margin-top:14px">We work along the whole supply chain: with manufacturers of finished medicines and devices, with suppliers and distributors, and with institutional buyers.</p></div>
<dl class="facts" style="margin-top:34px">
<div><dt>What we do</dt><dd>Market data · Market entry management</dd></div>
<div><dt>Who we serve</dt><dd>Pharmaceutical manufacturers</dd></div>
<div><dt>Reach</dt><dd>14 markets on 3 continents</dd></div>
<div><dt>Regions</dt><dd>Central Asia · Africa · Middle East · South America</dd></div>
<div><dt>Teams</dt><dd>Lahore · on the ground in Almaty</dd></div>
<div><dt>How we work</dt><dd>Our own people and our own software</dd></div>
<div><dt>Languages in-house</dt><dd>English · Russian · Kazakh</dd></div></dl></div>
{foot()}</section>''')
S.append(f'''<section class="s dark">{top("02 · Our story")}
<div class="grid" style="grid-template-columns:.8fr 1.2fr;gap:64px;margin:auto 0;align-items:center">
<div><div class="eb">Our story</div><h2 style="font-size:60px">Every tablet has a journey. <span class="ac">We make it work.</span></h2></div>
<div class="prose"><p>A single tablet in a patient's hands in a village has a journey worth telling. It starts in a plant, crosses borders, passes a regulator, an importer and a pharmacy shelf, and only then reaches the person who needs it.</p>
<p>Frontier markets import most of their medicines, yet their data is scattered and every country has its own rules. Manufacturers can't see where they fit. Buyers can't find reliable supply.</p>
<p>Nazryx exists to close that gap.</p></div></div>
{foot()}</section>''')
S.append(f'''<section class="s">{top("03 · Nazryx in numbers")}
<div class="eb">Nazryx in numbers</div><h2>A track record <span class="ac">across three continents.</span></h2>
<div class="scale" style="margin-top:14px">
<div class="sc"><b class="ac">USD 13m+</b><span>of pharmaceutical trade facilitated</span></div>
<div class="sc"><b>14</b><span>markets on 3 continents</span></div>
<div class="sc"><b>10</b><span>manufacturers represented, in selected partnerships</span></div>
<div class="sc"><b class="ac">300+</b><span>distributors profiled</span></div>
<div class="sc"><b>1,000+</b><span>physicians in our Kazakhstan network</span></div>
<div class="sc"><b>100+</b><span>distributor relationships in Kazakhstan</span></div></div>
{foot()}</section>''')
S.append(f'''<section class="s">{top("04 · Why frontier markets")}
<div class="eb">The opportunity</div><h2>Our markets import most of their medicines. <span class="ac">The gap is supply.</span></h2>
<div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
<div class="tile" style="background:var(--dk);color:#F2F1EC"><b class="big" style="font-size:84px">650m+</b><p style="color:var(--dktext);font-size:17px;margin-top:10px">people across the 14 markets we serve</p></div>
<div class="tile" style="background:var(--dk);color:#F2F1EC"><b class="big ac" style="font-size:84px;color:var(--sky)">USD 10bn+</b><p style="color:var(--dktext);font-size:17px;margin-top:10px">of medicines imported a year into our markets (Nazryx estimate from national data, 2024–26)</p></div></div>
<div class="imp">
<div class="tile b"><b>85%</b><p>of medicines imported in Kazakhstan</p></div>
<div class="tile m"><b>60%</b><p>of medicines imported in Nigeria</p></div>
<div class="tile p"><b>95%</b><p>of medicines imported in Senegal</p></div></div>
{foot()}</section>''')
S.append(f'''<section class="s">{top("05 · What we do")}
<div class="eb">What we do</div><h2>Two disciplines. <span class="ac">One team on the ground.</span></h2>
<div class="grid g2" style="margin-top:12px">
<div class="tile b"><div class="eb">Market data</div><h3 style="font-size:32px">Know what's open before you commit.</h3><p style="font-size:17px">We read each market against a manufacturer's portfolio: where products can win, where they can't, and where the price lands. So every decision starts from evidence.</p></div>
<div class="tile m"><div class="eb">Market entry management</div><h3 style="font-size:32px">We take you there, in your name.</h3><p style="font-size:17px">We open markets in the maker's name and run them: registration, partners, pharmacy chains, state buyers and growth, with a written report every week.</p></div></div>
{foot()}</section>''')
S.append(f'''<section class="s">{top("06 · How we work")}
<div class="eb">How we work</div><h2>From the first read <span class="ac">to steady reorders.</span></h2>
<div class="grid g4" style="gap:28px;margin-top:18px">{ph}</div>
<div class="grid g3" style="margin-top:34px">
<div class="card"><span class="num">You</span><h3>Product, dossier, plant, brand, registrations</h3><p>Yours throughout, in every market.</p></div>
<div class="card" style="border:2px solid var(--blue)"><span class="num">Nazryx</span><h3>Your local representative</h3><p>We act for you in the market. Never the holder; we never take title to stock.</p></div>
<div class="card"><span class="num">The importer</span><h3>Stocks and sells</h3><p>Appointed with you, and replaceable without losing anything.</p></div></div>
{foot()}</section>''')
S.append(f'''<section class="s">{top("07 · How we're different")}
<div class="eb">How we're different</div><h2>Not a consultancy. <span class="ac">Not a distributor.</span></h2>
<div class="card" style="padding:10px 26px"><table><thead><tr><th></th><th>Typical regulatory consultancy</th><th>Typical distributor</th><th class="us">Nazryx</th></tr></thead><tbody>{tb}</tbody></table></div>
{foot()}</section>''')
S.append(f'''<section class="s">{top("08 · What we stand for")}
<div class="eb">What we stand for</div><h2>Four principles, <span class="ac">in every market.</span></h2>
<div class="grid g4" style="gap:28px;margin-top:20px">
<div class="pr"><b>Evidence first</b><p style="font-size:16px">We decide from data, and show the evidence before anything is signed.</p></div>
<div class="pr"><b>The market stays yours</b><p style="font-size:16px">Registrations in the maker's name, partners that can be replaced.</p></div>
<div class="pr"><b>On the ground</b><p style="font-size:16px">Local teams and networks, not advice from a distance.</p></div>
<div class="pr"><b>Straight answers</b><p style="font-size:16px">If a market won't work, you hear it from us early.</p></div></div>
<div class="tile b" style="margin-top:auto;margin-bottom:6px;display:flex;gap:40px;align-items:center"><b style="font:700 24px 'Inter Tight',sans-serif;white-space:nowrap">Written into every agreement</b><p style="font-size:16px">The registration is always yours. We tell you when not to enter. Your documents stay yours.</p></div>
{foot()}</section>''')
S.append(f'''<section class="s">{top("09 · Where we work")}
<div class="eb">Where we work</div><h2>14 markets on 3 continents. <span class="ac">From Almaty to Cape Town.</span></h2>
<div class="rg">{rg}</div>{foot()}</section>''')
S.append(f'''<section class="s dark">{top("10 · On the ground")}
<div class="eb">Our teams</div><h2>On the ground, <span class="ac">where it matters.</span></h2>
<div class="grid g3" style="gap:36px;margin-top:20px">
<div class="team" style="border-color:var(--blue)"><b>Lahore</b><p style="color:var(--dktext)">Our team in Pakistan: market data, research and the work behind every account.</p></div>
<div class="team" style="border-color:#2E9E6B"><b>Almaty</b><p style="color:var(--dktext)">Our team on the ground in Kazakhstan, with Kazakh and Russian done in-house.</p></div>
<div class="team" style="border-color:#E08A2E"><b>Local networks</b><p style="color:var(--dktext)">In every market we serve: importers, chains and the people who know the buyers.</p></div></div>
<div class="grid g3" style="margin-top:auto;margin-bottom:6px">
<div><b class="big" style="font-size:64px">1,000+</b><p style="color:var(--dktext)">physicians in our Kazakhstan network</p></div>
<div><b class="big" style="font-size:64px">100+</b><p style="color:var(--dktext)">distributor relationships in Kazakhstan</p></div>
<div><b class="big" style="font-size:64px">3</b><p style="color:var(--dktext)">manufacturers represented in Kazakhstan</p></div></div>
{foot()}</section>''')
S.append(f'''<section class="s dark">{top("Contact")}
<div class="mid"><div class="eb">Talk to us</div><h1 style="font-size:68px">Let's open your <span class="ac">next market.</span></h1>
<p class="lede" style="margin-top:20px">Tell us what you want, in one line. We reply within one working day.</p></div>
<div class="grid g3 cont" style="border-top:1px solid var(--dkline);padding-top:26px">
<div><i>Online</i><p>nazryx.com<br>contact@nazryx.com</p></div>
<div><i>Phone and WhatsApp</i><p>+44 7466 253544 <small>UK</small><br>+7 708 692 2409 <small>Kazakhstan</small><br>+92 325 4307967 <small>Pakistan</small></p></div>
<div><i>Our teams</i><p>Lahore<br>On the ground in Almaty</p><small>Part of the Nazir Group</small></div></div></section>''')
css = (HERE / "profile.css").read_text()
(HERE / "nazryx-profile.html").write_text(f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Nazryx company profile</title>\n<style>{css}</style>\n</head>\n<body>\n' + "\n".join(S) + "\n</body>\n</html>\n")
