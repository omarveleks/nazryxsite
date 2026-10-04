// Site-wide visit + scroll-depth beacon. Separate from the per-company offer-page
// tracking (which already fires its own richer events) - this one just answers
// "who's visiting the general site, from where, which pages, how far did they read."
// Fails silently if the API isn't deployed; records no names, emails or IPs.
(function () {
  function vid() {
    try {
      var v = localStorage.getItem('nzx-v');
      if (!v) { v = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('nzx-v', v); }
      return v;
    } catch (e) { return 'anon'; }
  }
  function send(ev, detail) {
    try {
      var path = location.pathname.replace(/\/+$/, '') || '/';
      var body = JSON.stringify({ c: path.slice(0, 32), co: '', e: ev, d: detail || '', v: vid(), r: document.referrer || '' });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/t', new Blob([body], { type: 'application/json' }));
      else fetch('/api/t', { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'application/json' } });
    } catch (e) { /* never surfaces to the visitor */ }
  }

  send('pageview');

  // scroll-depth milestones, each sent once per page load
  var milestones = [25, 50, 75, 100], sent = {};
  function depth() {
    var doc = document.documentElement, body = document.body;
    var scrollTop = window.pageYOffset || doc.scrollTop || body.scrollTop;
    var height = Math.max(doc.scrollHeight, body.scrollHeight) - window.innerHeight;
    if (height <= 0) return 100;
    return Math.min(100, Math.round((scrollTop / height) * 100));
  }
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var d = depth();
      milestones.forEach(function (m) {
        if (d >= m && !sent[m]) { sent[m] = 1; send('scroll', String(m)); }
      });
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('beforeunload', onScroll);
  document.addEventListener('DOMContentLoaded', onScroll);
})();
