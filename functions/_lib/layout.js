// Shared page shell for function-rendered pages. Uses site/assets/nzx.css (the home page's own stylesheet).
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LOGO = '<path d="M171 0 L403 0 L613 210 L613 0 L837 0 L837 198 L689 346 L461 346 L295 179 L131 346 L0 346 L0 174 Z"';
export const CAL = 'https://calendly.com/nazryx/meeting-with-omar';
export const PHONES = [['+447466253544', '+44 7466 253544', 'London'], ['+923254307967', '+92 325 4307967', 'Lahore'], ['+77086922409', '+7 708 692 2409', 'Almaty']];

export function page({ title, description, path, body }) {
  const url = 'https://nazryx.com' + path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nazryx">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://nazryx.com/favicon.png">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/png" sizes="180x180" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/assets/nzx.css">
<link rel="stylesheet" href="/assets/markets.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<nav class="nav">
  <div class="nav-in">
    <a class="brand" href="/" data-track="nav:home"><svg viewBox="0 0 837 346" aria-hidden="true">${LOGO} fill="#0066FF"/></svg><b>Nazryx</b></a>
    <span class="aud">
      <a href="/partners" data-track="nav:partners">For distributors</a>
      <a href="/manufacturers" data-track="nav:manufacturers">For manufacturers</a>
    </span>
    <a class="nav-mk on" href="/markets" data-track="nav:markets">Markets</a>
  </div>
</nav>
<main id="main">
${body}
</main>
<div class="wrap">
  <div class="legal">
    <span>&copy; <span id="yr">2026</span> Nazryx &mdash; a company of Nazir &amp; Company.</span>
    <span class="mk-foot"><a href="/">Home</a> <a href="/manufacturers">For manufacturers</a> <a href="/partners">For distributors</a> <a href="/markets">Markets</a></span>
    <span class="anon">Anonymous analytics. No cookies. No IP addresses stored.</span>
  </div>
</div>
<script>document.getElementById('yr').textContent=new Date().getFullYear();</script>
<script src="/assets/a.js" defer></script>
</body>
</html>`;
}

export function contactCard(h2, subject, lede) {
  const phones = PHONES.map(([t, d, c]) => `<div class="cta-call"><small>${c}</small><a href="tel:${t}" data-track="phone:${t}">${d}</a></div>`).join('');
  return `<section class="wrap" id="contact">
  <div class="cta">
    <div class="cta-top">
      <div style="max-width:30ch"><h2>${esc(h2)}</h2>${lede ? `<p class="mk-cta-p">${esc(lede)}</p>` : ''}</div>
      <div class="mk-cta-btns">
        <a class="btn btn-white" data-track="cta:confirm" href="mailto:omar@nazryx.com?subject=${encodeURIComponent(subject)}">Reply to confirm</a>
        <a class="btn btn-white mk-alt" data-track="whatsapp" href="https://wa.me/447466253544" target="_blank" rel="noopener noreferrer">Message us on WhatsApp</a>
        <a class="btn btn-white mk-alt" data-track="calendly" href="${CAL}" target="_blank" rel="noopener noreferrer">Book a call</a>
      </div>
    </div>
    <div class="mk-phones">${phones}</div>
    <div class="offices">
      <div class="office"><b>Lahore</b><span>Pakistan</span></div>
      <div class="office"><b>London</b><span>United Kingdom</span></div>
      <div class="office"><b>Almaty</b><span>Kazakhstan</span></div>
    </div>
  </div>
</section>`;
}
