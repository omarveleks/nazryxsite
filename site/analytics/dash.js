(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { r: '7', from: null, to: null, cmp: true, metric: 'visitors', data: null };
  var DAY = 86400000;
  var iso = function (t) { return new Date(t).toISOString().slice(0, 10); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var fmt = function (n) { return n == null ? '–' : Number(n).toLocaleString('en-GB'); };
  var secs = function (n) { if (n == null) return '–'; n = Math.round(n); return n < 60 ? n + 's' : Math.floor(n / 60) + 'm ' + (n % 60) + 's'; };
  var when = function (t) { return new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  function range() {
    var today = iso(Date.now());
    if (state.r === 'c' && state.from && state.to) return [state.from, state.to];
    var n = Number(state.r) || 1;
    return [iso(Date.now() - (n - 1) * DAY), today];
  }
  function delta(c, p) {
    if (!state.cmp) return '';
    c = Number(c) || 0; p = Number(p) || 0;
    if (!p) return '<small class="flat">' + (c ? 'new' : 'no change') + ' vs previous</small>';
    var d = Math.round((c - p) / p * 1000) / 10;
    return '<small class="' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat') + '">' + (d > 0 ? '+' : '') + d + '% vs previous</small>';
  }
  function table(cols, rows, empty) {
    if (!rows.length) return '<p class="empty">' + (empty || 'No data in this range yet.') + '</p>';
    return '<table><thead><tr>' + cols.map(function (c) { return '<th' + (c[2] ? ' class="n"' : '') + '>' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td' + (c[2] ? ' class="n"' : '') + '>' + c[1](r) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
  }
  function bars(title, rows, label) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([1]));
    return '<div class="an-card"><h3>' + title + '</h3>' + (rows.length ? '<div class="bars">' + rows.map(function (r) {
      return '<div class="bar"><em>' + esc(label ? label(r.k) : r.k) + '</em><b>' + fmt(r.n) + '</b><i><span data-w="' + Math.round(r.n / max * 100) + '"></span></i></div>';
    }).join('') + '</div>' : '<p class="empty">No data yet.</p>') + '</div>';
  }
  function widths() { document.querySelectorAll('[data-w]').forEach(function (el) { el.style.width = el.getAttribute('data-w') + '%'; }); }

  function chart() {
    var d = state.data, m = state.metric, rg = range(), days = [];
    for (var t = Date.parse(rg[0]); t <= Date.parse(rg[1]); t += DAY) days.push(iso(t));
    var by = {}; d.series.forEach(function (r) { by[r.day] = r[m]; });
    var prev = d.prevSeries.map(function (r) { return r[m]; });
    var vals = days.map(function (k) { return by[k] || 0; });
    var W = 800, H = 240, P = 30, max = Math.max.apply(null, vals.concat(state.cmp ? prev : []).concat([1]));
    var x = function (i) { return P + (days.length < 2 ? (W - 2 * P) / 2 : i * (W - 2 * P) / (days.length - 1)); };
    var y = function (v) { return H - P - v / max * (H - 2 * P); };
    var line = function (arr) { return arr.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' '); };
    var g = '';
    [0, .5, 1].forEach(function (f) { var v = Math.round(max * f); g += '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#E2E0D9"/><text x="0" y="' + (y(v) + 4) + '">' + v + '</text>'; });
    var lab = days.length > 1 ? [0, days.length - 1] : [0];
    lab.forEach(function (i) { g += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (i ? 'end' : 'start') + '">' + days[i].slice(5) + '</text>'; });
    if (state.cmp && prev.length) g += '<path d="' + line(prev.slice(0, days.length)) + '" fill="none" stroke="#9CC2FF" stroke-width="2" stroke-dasharray="4 4"/>';
    g += '<path d="' + line(vals) + '" fill="none" stroke="#0066FF" stroke-width="2.5"/>';
    if (days.length <= 31) vals.forEach(function (v, i) { g += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="3" fill="#0066FF"><title>' + days[i] + ': ' + v + '</title></circle>'; });
    $('chart').innerHTML = (vals.some(Boolean) ? '' : '<p class="empty">No traffic in this range yet.</p>') + '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily ' + m + '">' + g + '</svg>';
  }

  function render() {
    var d = state.data, c = d.cur || {}, p = d.prev || {};
    var k = [['Visitors', 'visitors', fmt, 's1'], ['Sessions', 'sessions', fmt, 's2'], ['Pageviews', 'pageviews', fmt, 's3'], ['Avg time on page', 'avg_time', secs, 's4'], ['Engaged visits', 'engaged', function (v) { return v == null ? '–' : v + '%'; }, 's1'], ['Conversion actions', 'conversions', fmt, 's2']];
    $('kpis').innerHTML = k.map(function (x) { return '<div class="stat ' + x[3] + '"><b>' + x[2](c[x[1]]) + '</b><span>' + x[0] + '</span>' + delta(c[x[1]], p[x[1]]) + '</div>'; }).join('');
    chart();
    var f = d.funnel || {}, pf = d.prevFunnel || {}, st = [['Manufacturers page', 's1'], ['/markets', 's2'], ['/markets/kazakhstan', 's3'], ['CTA click', 's4']];
    $('funnel').innerHTML = st.map(function (s, i) {
      var n = f[s[1]] || 0, prevN = i ? (f[st[i - 1][1]] || 0) : null;
      var drop = i ? (prevN ? Math.round((1 - n / prevN) * 100) + '% drop-off' : '–') : 'sessions';
      return '<div class="step' + (i === 3 ? ' step-dark' : '') + '"><small>' + String(i + 1).padStart(2, '0') + ' · ' + s[0] + '</small><b>' + fmt(n) + '</b><small>' + drop + '</small> ' + delta(n, pf[s[1]]) + '</div>';
    }).join('');
    $('pages').innerHTML = table([['Page', function (r) { return esc(r.path); }], ['Views', function (r) { return fmt(r.views); }, 1], ['Unique', function (r) { return fmt(r.uniques); }, 1], ['Avg time', function (r) { return secs(r.avg_time); }, 1], ['Avg scroll', function (r) { return (r.avg_scroll || 0) + '%'; }, 1], ['Exit rate', function (r) { return (r.exit_rate || 0) + '%'; }, 1]], d.pages);
    $('sources').innerHTML = '<h3>Channels</h3>' + bars('', d.sources.map(function (r) { return { k: r.k, n: r.sessions }; })).replace('<div class="an-card"><h3></h3>', '').replace(/<\/div>$/, '');
    $('referrers').innerHTML = '<h3>Top referrers</h3>' + table([['Referrer', function (r) { return esc(r.k); }], ['Sessions', function (r) { return fmt(r.sessions); }, 1]], d.referrers, 'No referrers yet.');
    $('utms').innerHTML = '<h3>UTM campaigns</h3>' + table([['Source', function (r) { return esc(r.s); }], ['Medium', function (r) { return esc(r.m); }], ['Campaign', function (r) { return esc(r.c); }], ['Sessions', function (r) { return fmt(r.sessions); }, 1], ['Pageviews', function (r) { return fmt(r.pageviews); }, 1]], d.utms, 'No tagged visits yet. Use the link builder below.');
    $('leads').innerHTML = table([['Ref', function (r) { return '<b>' + esc(r.ref) + '</b>'; }], ['First visit', function (r) { return when(r.first); }], ['Last visit', function (r) { return when(r.last); }], ['Pages', function (r) { return fmt(r.pages); }, 1], ['Time', function (r) { return secs(r.secs); }, 1], ['Kazakhstan', function (r) { return r.kz ? '<span class="yes">Yes</span>' : 'No'; }], ['CTA click', function (r) { return r.cta ? '<span class="yes">Yes</span>' : 'No'; }], ['Country', function (r) { return esc(r.country || ''); }]], d.leads, 'No ref links opened yet.');
    var a = d.audience;
    $('audience').innerHTML = bars('Countries', a.countries) + bars('Cities', a.cities) + bars('Devices', a.devices) + bars('Browsers', a.browsers) + bars('Operating systems', a.oses) + bars('Languages', a.langs) + bars('New vs returning (approximate)', a.newret);
    $('actions').innerHTML = table([['Action', function (r) { return esc(r.target); }], ['Page', function (r) { return esc(r.path); }], ['Clicks', function (r) { return fmt(r.n); }, 1]], d.actions, 'No tracked clicks yet.');
    $('recent').innerHTML = table([['Time', function (r) { return when(r.ts); }], ['Event', function (r) { return esc(r.type) + (r.target ? ' · ' + esc(r.target) : ''); }], ['Page', function (r) { return esc(r.path); }], ['Source', function (r) { return esc(r.source); }], ['Country', function (r) { return esc(r.country || ''); }]], d.recent, 'No events yet.');
    widths();
  }

  function load() {
    var rg = range(), q = 'from=' + rg[0] + '&to=' + rg[1];
    $('csv').href = '/api/stats?' + q + '&format=csv';
    $('status').textContent = 'Loading ' + rg[0] + ' to ' + rg[1] + '…';
    fetch('/api/stats?' + q, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { location.href = '/analytics/login'; throw 0; }
      return r.json();
    }).then(function (d) {
      if (d.error) throw new Error(d.error);
      state.data = d; $('status').textContent = 'Showing ' + d.from + ' to ' + d.to + (state.cmp ? ', compared with the previous ' + ((Date.parse(d.to) - Date.parse(d.from)) / DAY + 1) + ' days.' : '.');
      render();
    }).catch(function (e) { if (e) $('status').textContent = 'Could not load data: ' + (e.message || e); });
  }

  document.querySelectorAll('.an-range button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.an-range button').forEach(function (x) { x.classList.toggle('on', x === b); });
      state.r = b.getAttribute('data-r');
      document.querySelector('.an-custom').hidden = state.r !== 'c';
      if (state.r !== 'c') load();
    });
  });
  $('go').addEventListener('click', function () { state.from = $('f').value; state.to = $('t').value; if (state.from && state.to) load(); });
  $('cmp').addEventListener('change', function (e) { state.cmp = e.target.checked; if (state.data) render(); });
  document.querySelectorAll('.an-metric button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.an-metric button').forEach(function (x) { x.classList.toggle('on', x === b); });
      state.metric = b.getAttribute('data-m'); if (state.data) chart();
    });
  });
  function build() {
    var u = new URL('https://nazryx.com' + $('lb-p').value), s = $('lb-s').value.trim(), c = $('lb-c').value.trim(), r = $('lb-r').value.trim();
    if (s) u.searchParams.set('utm_source', s); if (s) u.searchParams.set('utm_medium', 'outreach');
    if (c) u.searchParams.set('utm_campaign', c); if (r) u.searchParams.set('ref', r);
    $('lb-out').textContent = u.toString();
  }
  ['lb-p', 'lb-s', 'lb-c', 'lb-r'].forEach(function (id) { $(id).addEventListener('input', build); });
  $('lb-copy').addEventListener('click', function () {
    var t = $('lb-out').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { $('lb-copy').textContent = 'Copied'; setTimeout(function () { $('lb-copy').textContent = 'Copy'; }, 1500); }, function () {});
  });
  load();
})();
