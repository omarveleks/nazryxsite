/* Nazryx shared behaviour: menu, reveal, counters, tabs + route bars, data bars, clocks, stacks, donut,
   bridge animation, tablet journey, markets map, profile hotspots. Every chart starts with data showing. */
(function () {
  var d = document, w = window;
  d.documentElement.classList.add('js');
  var reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  w.nzxReduce = reduce;

  function onView(el, fn, margin) {
    if (!el) return;
    if (reduce || !('IntersectionObserver' in w)) { fn(el); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); fn(e.target); } });
    }, { rootMargin: margin || '0px 0px -10% 0px' });
    io.observe(el);
  }
  w.nzxOnView = onView;

  function count(el) {
    var raw = el.getAttribute('data-count'), to = parseFloat(raw.replace(/,/g, ''));
    var dec = (raw.split('.')[1] || '').length, pre = el.getAttribute('data-pre') || '', suf = el.getAttribute('data-suf') || '';
    var fmt = function (v) { return pre + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; };
    if (reduce) { el.textContent = fmt(to); return; }
    var t0 = null;
    (function step(t) {
      if (!t0) t0 = t;
      var p = Math.min((t - t0) / 900, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(dec ? to * e : Math.round(to * e));
      if (p < 1) requestAnimationFrame(step);
    })(performance.now());
  }
  w.nzxCount = count;

  // menu
  var btn = d.querySelector('.menu-btn'), panel = d.getElementById('menu');
  if (btn && panel) {
    var close = panel.querySelector('.panel-close');
    var open = function (o) {
      panel.classList.toggle('open', o); btn.setAttribute('aria-expanded', o ? 'true' : 'false');
      d.body.style.overflow = o ? 'hidden' : ''; (o ? close : btn).focus();
    };
    btn.addEventListener('click', function () { open(true); });
    close.addEventListener('click', function () { open(false); });
    panel.addEventListener('click', function (e) { if (e.target.closest('a')) open(false); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) open(false); });
  }

  // compact header after scrolling
  var hdr = d.querySelector('.hdr');
  if (hdr) { var hs = function () { hdr.classList.toggle('small', w.scrollY > 24); }; w.addEventListener('scroll', hs, { passive: true }); hs(); }

  d.querySelectorAll('.rv').forEach(function (el) { onView(el, function (x) { x.classList.add('in'); }); });
  d.querySelectorAll('[data-count]').forEach(function (el) { onView(el, count); });

  // bars, clocks, stacks, donuts: grow in when seen (they start at a visible sliver, never empty)
  d.querySelectorAll('.hbars,.clocks,.stack-wrap').forEach(function (g) {
    g.querySelectorAll('.t i,.stack i').forEach(function (i, n) { i.style.transitionDelay = reduce ? '0ms' : (n * 70) + 'ms'; });
    onView(g, function (x) { x.classList.add('on'); });
  });
  d.querySelectorAll('.donut').forEach(function (dn) {
    onView(dn, function (x) { var c = x.querySelector('.fg'); c.style.strokeDasharray = c.getAttribute('data-dash'); });
  });
  var pick = d.getElementById('your-country');
  if (pick) pick.addEventListener('change', function () {
    var g = d.getElementById('price-bars');
    g.classList.toggle('pick', !!pick.value);
    g.querySelectorAll('.hbar').forEach(function (b) { b.classList.toggle('hl', b.getAttribute('data-c') === pick.value); });
  });

  // tabs (route toggle, profile pages, region tabs)
  function animate(p) {
    var bars = p.querySelectorAll('.g-bar');
    bars.forEach(function (b) { b.classList.remove('on'); });
    bars.forEach(function (b, i) { setTimeout(function () { b.classList.add('on'); }, reduce ? 0 : 100 + i * 180); });
  }
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
        var k = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
        if (k) { e.preventDefault(); var n = tabs[(i + k + tabs.length) % tabs.length]; sel(n); n.focus(); }
      });
    });
  });
  d.querySelectorAll('.route-panel:not([hidden])').forEach(function (p) { onView(p, animate); });

  // profile hotspots
  d.querySelectorAll('.hot').forEach(function (h) {
    var blk = h.closest('.blk');
    var show = function (o) { blk.classList.toggle('show', o); h.setAttribute('aria-expanded', o); };
    h.addEventListener('click', function () { show(!blk.classList.contains('show')); });
    h.addEventListener('mouseenter', function () { show(true); });
    blk.addEventListener('mouseleave', function () { show(false); });
    h.addEventListener('blur', function () { show(false); });
  });

  // line-drawing helper for SVG paths
  function prep(paths, step) {
    paths.forEach(function (a, i) {
      var len = Math.ceil(a.getTotalLength ? a.getTotalLength() : 800);
      a.style.setProperty('--len', len);
      a.style.transitionDelay = reduce ? '0ms' : (i * step) + 'ms';
    });
  }

  // bridge animation (hero): products out, demand data back
  var br = d.querySelector('.bridge');
  if (br) {
    prep([].slice.call(br.querySelectorAll('.flow')), 90);
    onView(br, function (x) { x.classList.add('on'); }, '0px');
    var card = br.querySelector('.bridge-card');
    var show = function (mk) {
      br.querySelectorAll('.mk').forEach(function (m) { m.classList.toggle('on', m === mk); });
      card.innerHTML = '<b>' + mk.getAttribute('data-name') + '</b> · ' + mk.getAttribute('data-facts');
    };
    br.querySelectorAll('.mk').forEach(function (mk) {
      mk.addEventListener('mouseenter', function () { show(mk); });
      mk.addEventListener('focus', function () { show(mk); });
      mk.addEventListener('click', function () { show(mk); });
    });
  }

  // hero market strip: line draws, markets appear in sequence
  d.querySelectorAll('.mstrip').forEach(function (m) { onView(m, function (x) { requestAnimationFrame(function () { x.classList.add('on'); }); }, '0px'); });

  // markets map
  d.querySelectorAll('.wmap').forEach(function (m) {
    prep([].slice.call(m.querySelectorAll('.arc')), 120);
    onView(m, function (x) { x.classList.add('on'); });
  });

  // journey of a tablet: progress follows the section through the viewport (no sticky, no blank screens)
  var j = d.querySelector('.jny');
  if (j) {
    var track = j.querySelector('.jny-track'), stops = [].slice.call(j.querySelectorAll('.jny-stop'));
    var set = function (p) {
      track.style.setProperty('--p', p.toFixed(3));
      track.style.setProperty('--w', track.clientWidth + 'px');
      var k = Math.min(stops.length - 1, Math.floor(p * stops.length + 0.001));
      stops.forEach(function (s, i) { s.classList.toggle('on', i <= k); });
    };
    if (reduce) set(1);
    else {
      var tick = function () {
        var r = j.getBoundingClientRect(), vh = w.innerHeight;
        var p = (vh * 0.85 - r.top) / (r.height + vh * 0.25);
        set(Math.max(0, Math.min(1, p)));
      };
      w.addEventListener('scroll', tick, { passive: true }); w.addEventListener('resize', tick); tick();
    }
  }
})();
