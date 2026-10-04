import { esc, page, contactCard } from './layout.js';

const tone = ['s1', 's2', 's3', 's4'];

export function renderMarket(m) {
  const stats = m.stats.map(([b, s], i) => `<div class="stat ${tone[i % 4]}"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');
  const tiles = m.market.tiles.map(([b, s]) => `<div class="tile"><b>${esc(b)}</b><p>${esc(s)}</p></div>`).join('');
  const cards = m.market.cards.map(([b, p]) => `<div class="mk-card"><b>${esc(b)}</b><p>${esc(p)}</p></div>`).join('');
  const r = m.region;
  const table = `<div class="mk-table" role="region" aria-label="${esc(r.eyebrow)}" tabindex="0"><table>
<thead><tr>${r.head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${r.rows.map((row, i) => `<tr${i === 0 ? ' class="ref"' : ''}>${row.map((c, j) => (j === 0 ? `<th scope="row">${esc(c)}</th>` : `<td data-l="${esc(r.head[j])}">${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
  const side = `<div class="mk-kv"><b>${esc(r.side.title)}</b>${r.side.rows.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>`;
  const run = m.run.items.map(([b, p], i) => `<li><em>${String(i + 1).padStart(2, '0')}</em><div><b>${esc(b)}</b><p>${esc(p)}</p></div></li>`).join('');
  const steps = m.timeline.steps.map(([when, b, p], i, a) => `<div class="step${i === a.length - 1 ? ' step-dark' : ''}"><em>${String(i + 1).padStart(2, '0')}</em><div><small>${esc(when)}</small><b>${esc(b)}</b><p>${esc(p)}</p></div></div>`).join('');

  const body = `
<div class="wrap hero">
  <div class="hero-grid">
    <div>
      <div class="eyebrow">${esc(m.hero.eyebrow)}</div>
      <h1>${esc(m.hero.h1[0])}<br><span class="blue">${esc(m.hero.h1[1])}</span></h1>
      <p>${esc(m.hero.lede)}</p>
      <div class="hero-cta">
        <a class="btn btn-blue" href="#contact" data-track="cta:hero-confirm">Confirm your interest</a>
        <a class="btn btn-ghost" href="/markets" data-track="nav:all-markets">All markets</a>
      </div>
    </div>
    <div class="locard">
      <div class="locard-top">
        <div class="locard-chip"><svg viewBox="0 0 837 346" aria-hidden="true"><path d="M171 0 L403 0 L613 210 L613 0 L837 0 L837 198 L689 346 L461 346 L295 179 L131 346 L0 346 L0 174 Z" fill="#fff"/></svg></div>
        <div class="r"><b>Team on the ground</b><span>Almaty</span></div>
      </div>
      <div>
        <div class="locs"><div class="loc"><b>LHE</b><span>Lahore</span></div><div class="loc"><b>LON</b><span>London</span></div><div class="loc" style="text-align:right"><b>ALA</b><span>Almaty</span></div></div>
        <div class="locline"><i style="left:0"></i><i style="left:50%"></i><i style="right:0"></i></div>
      </div>
    </div>
  </div>
</div>

<div class="wrap stats">${stats}</div>

<section class="wrap mk-market">
  <div class="mk-split">
    <div>
      <div class="eyebrow">${esc(m.market.eyebrow)}</div>
      <h2>${esc(m.market.h2)}</h2>
      <p class="lede" style="margin-top:18px">${esc(m.market.lede)}</p>
    </div>
    <div class="score">${tiles}</div>
  </div>
  <div class="mk-cards">${cards}</div>
</section>

<section class="wrap">
  <div class="svc-head">
    <div><div class="eyebrow">${esc(r.eyebrow)}</div><h2>${esc(r.h2)}</h2></div>
    <p class="lede">${esc(r.lede)}</p>
  </div>
  <div class="mk-region">${table}${side}</div>
  <div class="flow mk-route" aria-hidden="true">${r.rows.map((row, i) => `<div class="flow-step"><em>${String(i + 1).padStart(2, '0')}</em><b>${esc(row[0])}</b><span>${esc(row[3])}</span></div>`).join('<svg class="mk-arr" width="24" height="14" viewBox="0 0 24 14"><path d="M0 7h20M15 2l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2"/></svg>')}</div>
  <p class="mk-note">${esc(r.foot)}</p>
</section>

<section class="wrap">
  <div class="mk-run">
    <div><div class="eyebrow">${esc(m.run.eyebrow)}</div><h2>${esc(m.run.h2)}</h2></div>
    <ol class="mk-list">${run}</ol>
  </div>
</section>

<section class="wrap" style="padding-top:0">
  <div class="eyebrow">${esc(m.timeline.eyebrow)}</div>
  <h2 style="max-width:22ch">${esc(m.timeline.h2)}</h2>
  <div class="mk-steps">${steps}</div>
  <p class="mk-note">${esc(m.timeline.note)}</p>
</section>

${contactCard(m.cta.h2, m.cta.subject)}
`;
  return page({ title: m.title, description: m.description, path: '/markets/' + m.slug, body });
}

export function renderIndex(markets) {
  const fn = [
    ['Regulatory approval', 'The EAEU route, dossier, filing and authority liaison.'],
    ['Partner network', 'The right local partner, shortlisted from 100+ relationships and agreed with you where needed.'],
    ['Tenders and channels', 'State, hospital and pharmacy-chain strategy.'],
    ['Pricing and landed cost', 'Every pack modelled against local price rules.'],
    ['Physician outreach', 'Direct detailing through our 1,000+ physician network.'],
    ['Orders, supply and accounts', 'From first order to reorder, handled locally.'],
    ['Portfolio selection', 'Which of your lines to launch first.']
  ];
  const phases = [
    ['Phase 1', 'Market-fit brief', 'Your portfolio read line by line against the market, ending in a launch order.', 'One week'],
    ['Phase 2', 'Launch programme', 'Registration, partners and tender positioning, run by one team.', 'Dossier filed in months'],
    ['Phase 3', 'Commercial scale-up', 'Orders, accounts and reorders against agreed milestones.', 'Orders from approval day one']
  ];
  const picker = markets.map((m) => `<a class="door door-m" href="/markets/${m.slug}" data-track="market:${m.slug}">
      <span class="door-eye">${esc(m.card.eyebrow)}</span><h3>${esc(m.card.title)}</h3><p>${esc(m.card.text)}</p>
      <span class="door-go">Open ${esc(m.name)} <em>&rarr;</em></span></a>`).join('');
  const body = `
<div class="wrap hero">
  <div class="hero-grid">
    <div class="mk-hero">
      <div class="eyebrow">Market expansion</div>
      <h1>You make medicines.<br><span class="blue">We run your markets.</span></h1>
      <p>Registration, partners, tenders, pricing and physicians, run by one team on the ground. Not a report to act on. A function you don't have to build.</p>
      <div class="hero-cta"><a class="btn btn-blue" href="#pick" data-track="cta:pick">Pick your market</a></div>
    </div>
    <div class="consol mk-vis" aria-hidden="true">
      <div class="fan">
        <div class="fan-col"><span class="pill">Regulator</span><span class="pill">State buyer</span><span class="pill">Distributors</span><span class="pill">Physicians</span></div>
        <svg class="arrow" width="28" height="16" viewBox="0 0 28 16"><path d="M0 8h24M18 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        <div class="winner">One team<span>on the ground, for you</span></div>
      </div>
      <p class="consol-note">Four counterparts. One function you don't have to build.</p>
    </div>
  </div>
</div>

<div class="wrap stats" aria-hidden="true">
  <div class="stat s1"><b>7</b><span>functions we run</span></div>
  <div class="stat s2"><b>3</b><span>phases, one partnership</span></div>
  <div class="stat s3"><b>100+</b><span>distributor relationships</span></div>
  <div class="stat s4"><b>1,000+</b><span>physicians in our network</span></div>
</div>

<section class="wrap" style="padding-top:0">
  <div class="svc-panel">
    <div><div class="eyebrow">What we run</div><h2 style="font-size:clamp(28px,3.4vw,38px)">Seven functions, one team.</h2></div>
    <ol class="mk-list mk-list-tight">${fn.map(([b, p], i) => `<li><em>${String(i + 1).padStart(2, '0')}</em><div><b>${b}</b><p>${p}</p></div></li>`).join('')}</ol>
  </div>
</section>

<section class="wrap" style="padding-top:0">
  <div class="thesis mk-phases">
    <div>
      <div class="eyebrow" style="color:rgba(255,255,255,.74)">How it works</div>
      <h2>One partnership, three phases.</h2>
      <p class="mk-ph-note">The authority sets the review time. We plan everything else around it.</p>
    </div>
    <div class="ask">${phases.map(([n, b, p, t], i) => `<div${i === 0 ? ' class="now"' : ''}><small>${n} · ${t}</small><b class="mk-ph-b">${b}</b><p class="mk-ph-p">${p}</p></div>`).join('')}</div>
  </div>
</section>

<section class="wrap mk-flowsec" aria-hidden="true">
  <div class="flow">
    <div class="flow-step"><em>01</em><b>Brief</b><span>Your lines, read against the market</span></div>
    <div class="flow-step"><em>02</em><b>Register</b><span>Dossier, filing, authority</span></div>
    <div class="flow-step"><em>03</em><b>Partner</b><span>Distributors, tenders, physicians</span></div>
    <div class="flow-step"><em>04</em><b>Sell</b><span>Orders and reorders</span></div>
  </div>
</section>

<section class="wrap" id="pick" style="padding-top:0">
  <div class="eyebrow">Pick your market</div>
  <h2 style="max-width:20ch">Where do you want to sell?</h2>
  <div class="doors mk-pick">${picker}<div class="door mk-soon" aria-hidden="true"><span class="door-eye">Next</span><div class="dims"><span class="dim">Registration</span><span class="dim">Partners</span><span class="dim">Tenders</span><span class="dim">Pricing</span><span class="dim">Physicians</span><span class="dim">Orders</span><span class="dim">Portfolio</span></div><p>The same seven functions, in every market we open.</p></div></div>
  <p class="mk-more">More markets opening. <a href="/#contact" data-track="cta:more-markets">Tell us where you want to go.</a></p>
</section>
`;
  return page({ title: 'Markets · Nazryx', description: 'You make medicines. We run your markets: registration, partners, tenders, pricing and physicians, run by one team on the ground.', path: '/markets', body });
}
