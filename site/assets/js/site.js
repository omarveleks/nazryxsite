/* Nazryx shared behaviour: menu, reveal, counters, route toggle (6C), price bars (6D), EAEU map (6E), profile viewer (6G), markets map (6H). */
(function () {
  var d = document, w = window;
  d.documentElement.classList.add('js');
  var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // run fn once when el scrolls into view (immediately with reduced motion or no IO)
  function onView(el, fn, margin) {
    if (!el) return;
    if (reduce || !('IntersectionObserver' in w)) { fn(el); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); fn(e.target); } });
    }, { rootMargin: margin || '0px 0px -12% 0px' });
    io.observe(el);
  }
  w.nzxOnView = onView;
  w.nzxReduce = reduce;

  // count a number up (900 ms); keeps prefix/suffix and thousands separators
  function count(el) {
    var raw = el.getAttribute('data-count'), to = parseFloat(raw.replace(/,/g, ''));
    var dec = (raw.split('.')[1] || '').length, pre = el.getAttribute('data-pre') || '', suf = el.getAttribute('data-suf') || '';
    var fmt = function (v) { return pre + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; };
    if (reduce) { el.textContent = fmt(to); return; }
    var t0 = null;
    function step(t) {
      if (!t0) t0 = t;
      var p = Math.min((t - t0) / 900, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(dec ? to * e : Math.round(to * e));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  w.nzxCount = count;

  // mobile menu
  var btn = d.querySelector('.menu-btn'), panel = d.getElementById('menu');
  if (btn && panel) {
    var close = panel.querySelector('.panel-close');
    var open = function (o) {
      panel.classList.toggle('open', o);
      btn.setAttribute('aria-expanded', o ? 'true' : 'false');
      d.body.style.overflow = o ? 'hidden' : '';
      (o ? close : btn).focus();
    };
    btn.addEventListener('click', function () { open(true); });
    close.addEventListener('click', function () { open(false); });
    panel.addEventListener('click', function (e) { if (e.target.tagName === 'A') open(false); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) open(false); });
  }

  d.querySelectorAll('.rv').forEach(function (el) { onView(el, function (x) { x.classList.add('in'); }); });
  d.querySelectorAll('[data-count]').forEach(function (el) { onView(el, count); });

  // generic tabs: [role=tablist] with buttons[aria-controls]
  d.querySelectorAll('[role=tablist]').forEach(function (tl) {
    var tabs = [].slice.call(tl.querySelectorAll('[role=tab]'));
    function sel(t) {
      tabs.forEach(function (x) {
        var on = x === t, p = d.getElementById(x.getAttribute('aria-controls'));
        x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1;
        if (p) { p.hidden = !on; if (on) animate(p); }
      });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { sel(t); });
      t.addEventListener('keydown', function (e) {
        var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (k) { e.preventDefault(); var n = tabs[(i + k + tabs.length) % tabs.length]; sel(n); n.focus(); }
      });
    });
  });

  // 6C gantt bars: stagger in when visible / when tab shown
  function animate(p) {
    var bars = p.querySelectorAll('.g-bar');
    bars.forEach(function (b) { b.classList.remove('on'); });
    bars.forEach(function (b, i) { setTimeout(function () { b.classList.add('on'); }, reduce ? 0 : 120 + i * 200); });
  }
  d.querySelectorAll('.route-panel:not([hidden])').forEach(function (p) { onView(p, animate); });

  // 6D price bars
  var bars = d.querySelector('.bars');
  if (bars) {
    bars.querySelectorAll('.t i').forEach(function (i, n) { i.style.transitionDelay = reduce ? '0ms' : (n * 60) + 'ms'; });
    onView(bars, function (b) { b.classList.add('on'); });
    var sel = d.getElementById('your-country');
    if (sel) sel.addEventListener('change', function () {
      bars.querySelectorAll('.bar').forEach(function (b) { b.classList.toggle('hl', b.getAttribute('data-c') === sel.value); });
    });
  }

  // 6E EAEU map: reference state, then lines, then recognition states
  var map = d.querySelector('.map');
  if (map) onView(map, function (m) {
    var ref = m.querySelector('.land.kz'), arcs = m.querySelectorAll('.arc'), rec = m.querySelectorAll('[data-rec]');
    var t = reduce ? 0 : 300;
    setTimeout(function () { ref.classList.add('ref'); }, 0);
    arcs.forEach(function (a, i) { setTimeout(function () { a.classList.add('on'); }, t * (2 + i)); });
    rec.forEach(function (r, i) { setTimeout(function () { r.classList.add('rec'); }, t * (2 + i) + (reduce ? 0 : 200)); });
  });

  // 6G profile hotspots: hover, focus or tap shows the note
  d.querySelectorAll('.hot').forEach(function (h) {
    var blk = h.closest('.blk');
    var show = function (o) { blk.classList.toggle('show', o); h.setAttribute('aria-expanded', o); };
    h.addEventListener('click', function () { show(!blk.classList.contains('show')); });
    h.addEventListener('mouseenter', function () { show(true); });
    blk.addEventListener('mouseleave', function () { show(false); });
    h.addEventListener('blur', function () { show(false); });
  });

  // 6H markets map
  var wm = d.querySelector('.wmap');
  if (wm) {
    wm.querySelectorAll('.arc').forEach(function (a, i) {
      var len = Math.ceil(a.getTotalLength ? a.getTotalLength() : 600);
      a.style.setProperty('--len', len);
      a.style.transitionDelay = reduce ? '0ms' : (i * 140) + 'ms';
    });
    onView(wm, function (m) { m.classList.add('on'); });
    var card = d.getElementById('mcard');
    var pick = function (mk) {
      card.innerHTML = '<b>' + mk.getAttribute('data-name') + '</b> <span class="note">' + mk.getAttribute('data-note') + '</span>' +
        (mk.getAttribute('data-href') ? ' <a class="link" href="' + mk.getAttribute('data-href') + '">Open the Kazakhstan page</a>' : '');
    };
    wm.querySelectorAll('.mk').forEach(function (mk) {
      mk.addEventListener('click', function () { pick(mk); });
      mk.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(mk); } });
    });
  }
})();
