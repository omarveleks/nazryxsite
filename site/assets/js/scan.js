/* 6A Register scan: "Is your molecule open in Kazakhstan?" Data: /assets/data/kz_demo_molecules.json */
(function () {
  var root = document.getElementById('scan');
  if (!root) return;
  var input = root.querySelector('.scan-input'), list = root.querySelector('.scan-list'), miss = root.querySelector('.scan-miss');
  var card = root.querySelector('.scan-card'), res = root.querySelector('.scan-res'), empty = root.querySelector('.scan-empty') || document.createElement('div');
  var reduce = window.nzxReduce, data = [], active = -1, shown = [];
  var ORIGINS = ['Kazakhstan and EAEU', 'India', 'Pakistan', 'Western Europe and US', 'Central Europe', 'Turkey', 'Other'];
  var COLORS = ['#1259E6', '#0E47B8', '#141414', '#9DB9F2', '#DCE8FD', '#8C8A84', '#E3E0DA'];
  var SENT = {
    Crowded: 'Seven or more brands, or two or more South Asian makers. Hard to win on price.',
    Thin: 'A few brands. Room for a well-priced second source.',
    Open: 'One brand or none registered. Worth a closer look.'
  };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  fetch('/assets/data/kz_demo_molecules.json').then(function (r) { return r.json(); }).then(function (j) {
    data = j.molecules;
    root.querySelectorAll('.chip').forEach(function (c) {
      c.addEventListener('click', function () { var m = find(c.getAttribute('data-inn')); if (m) run(m, c); });
    });
    // first view: run a real example straight away, so the demo never opens empty
    var first = find(root.getAttribute('data-autorun') || 'Apixaban');
    if (first) window.nzxOnView(root, function () { if (!res.classList.contains('on')) run(first, root.querySelector('.chip[data-inn="' + first.inn + '"]')); }, '0px 0px -20% 0px');
  });

  // market switch: Kazakhstan is live; the other markets explain that we run the same read there
  var sw = root.querySelectorAll('.mswitch button'), note = root.querySelector('.mswitch-note'), live = root.querySelector('.scan-live');
  sw.forEach(function (b) {
    b.addEventListener('click', function () {
      sw.forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      var isLive = b.hasAttribute('data-live');
      if (note) {
        note.hidden = isLive;
        if (!isLive) note.innerHTML = 'We run this read in <b>' + esc(b.textContent) + '</b> too: register, shelves or tenders, and the state buyer. <a href="mailto:contact@nazryx.com?subject=' +
          encodeURIComponent('Product list for ' + b.textContent) + '" data-track="scan:other-market">Send your product list</a>.';
      }
      if (live) live.hidden = !isLive;
    });
  });

  function find(q) {
    q = (q || '').trim().toLowerCase();
    for (var i = 0; i < data.length; i++) if (data[i].inn.toLowerCase() === q) return data[i];
    return null;
  }
  function renderList() {
    var q = input.value.trim().toLowerCase();
    shown = data.filter(function (m) { return !q || m.inn.toLowerCase().indexOf(q) > -1 || m.area.toLowerCase().indexOf(q) > -1; });
    active = shown.length ? 0 : -1;
    list.innerHTML = shown.map(function (m, i) {
      return '<li role="option" id="opt-' + i + '" aria-selected="' + (i === active) + '" data-i="' + i + '">' + esc(m.inn) + ' <small>' + esc(m.area) + '</small></li>';
    }).join('');
    list.hidden = !shown.length;
    input.setAttribute('aria-expanded', shown.length ? 'true' : 'false');
    input.setAttribute('aria-activedescendant', active > -1 ? 'opt-' + active : '');
    if (q && !shown.length) showMiss(input.value.trim()); else miss.hidden = true;
  }
  function move(k) {
    if (!shown.length) return;
    active = (active + k + shown.length) % shown.length;
    list.querySelectorAll('li').forEach(function (li, i) { li.setAttribute('aria-selected', i === active); if (i === active) li.scrollIntoView({ block: 'nearest' }); });
    input.setAttribute('aria-activedescendant', 'opt-' + active);
  }
  function choose(m) { input.value = m.inn; list.hidden = true; input.setAttribute('aria-expanded', 'false'); miss.hidden = true; run(m); }
  function showMiss(q) {
    var msg = 'Is ' + q + ' open in Kazakhstan? Please check it for us.';
    miss.innerHTML = 'We have this for every molecule. Send it to us: <a class="link" href="mailto:contact@nazryx.com?subject=' +
      encodeURIComponent('Molecule check: ' + q) + '&body=' + encodeURIComponent(msg) + '" data-track="scan:email">email</a> or <a class="link" href="https://wa.me/447466253544?text=' +
      encodeURIComponent(msg) + '" target="_blank" rel="noopener" data-track="scan:whatsapp">WhatsApp</a>.';
    miss.hidden = false;
  }

  if (input) {
  input.addEventListener('input', renderList);
  input.addEventListener('focus', renderList);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) renderList(); else move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      var exact = find(input.value);
      if (exact) choose(exact); else if (active > -1 && !list.hidden) choose(shown[active]); else if (input.value.trim()) showMiss(input.value.trim());
    } else if (e.key === 'Escape') { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  });
  list.addEventListener('mousedown', function (e) { var li = e.target.closest('li'); if (li) { e.preventDefault(); choose(shown[+li.getAttribute('data-i')]); } });
  document.addEventListener('click', function (e) { if (!root.contains(e.target)) list.hidden = true; });
  }

  var timers = [];
  function later(fn, ms) { timers.push(setTimeout(fn, reduce ? 0 : ms)); }

  function run(m, chip) {
    timers.forEach(clearTimeout); timers = [];
    root.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', c === chip); });
    if (chip && input) input.value = m.inn;
    if (miss && input) miss.hidden = true;
    if (list) list.hidden = true;
    if (window.nzxTrack) window.nzxTrack('scan:' + m.inn);
    empty.hidden = true;
    var o = m.makers_by_origin, total = ORIGINS.reduce(function (a, k) { return a + (o[k] || 0); }, 0) || 1;
    res.innerHTML =
      '<h3>' + esc(m.inn) + '</h3><p class="meta">' + esc(m.area) + ' · ATC ' + esc(m.atc) + '</p>' +
      '<div class="scan-k">' +
      '<div><b data-to="' + m.brands_registered + '">0</b><span>brands registered</span></div>' +
      '<div><b data-to="' + m.makers_registered + '">0</b><span>manufacturers registered</span></div>' +
      '<div><b data-to="' + m.brands_on_shelf + '">0</b><span>brands on the shelf</span></div>' +
      '<div><b data-to="' + m.leader_pharmacies_of_1340 + '">0</b><span>pharmacies stocking the leader, of 1,340</span></div></div>' +
      '<div class="orig"><b class="sr">Registered manufacturers by origin</b><div class="orig-bar" role="img" aria-label="' +
      esc(ORIGINS.map(function (k) { return k + ' ' + (o[k] || 0); }).join(', ')) + '">' +
      ORIGINS.map(function (k, i) { return o[k] ? '<i style="width:' + (o[k] / total * 100) + '%;background:' + COLORS[i] + '"></i>' : ''; }).join('') +
      '</div><div class="orig-key">' +
      ORIGINS.map(function (k, i) { return o[k] ? '<span><i style="background:' + COLORS[i] + '"></i>' + esc(k) + ' ' + o[k] + '</span>' : ''; }).join('') +
      '</div></div>' +
      '<div class="verdict" role="status"><span class="vchip ' + m.verdict + '">' + m.verdict + '</span><p>' + SENT[m.verdict] + '</p></div>';
    res.classList.remove('on');
    card.classList.remove('scanning'); void card.offsetWidth;
    if (!reduce) card.classList.add('scanning');
    later(function () {
      card.classList.remove('scanning');
      res.classList.add('on');
      res.querySelectorAll('[data-to]').forEach(function (b) { b.setAttribute('data-count', b.getAttribute('data-to')); window.nzxCount(b); });
    }, 1200);
    later(function () { var ob = res.querySelector('.orig-bar'); if (ob) ob.classList.add('on'); }, 1500);
    later(function () { res.querySelector('.verdict').classList.add('on'); }, 2200);
  }
})();
