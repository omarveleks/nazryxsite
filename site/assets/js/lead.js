/* /start form: send without leaving the page; falls back to a normal POST without JS. */
(function () {
  var f = document.querySelector('form[data-lead]');
  if (!f || !window.fetch) return;
  var msg = f.querySelector('.form-msg'), btn = f.querySelector('button[type=submit]');
  // arriving from the quiz or the market explorer: preselect the region
  try {
    var reg = new URLSearchParams(location.search).get('region'), sel = f.querySelector('select[name=market]');
    if (reg && sel && !sel.value) { var o = document.createElement('option'); o.textContent = reg.slice(0, 60); sel.appendChild(o); sel.value = o.textContent; }
  } catch (e) {}
  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/lead', { method: 'POST', body: new FormData(f), headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        msg.hidden = false; msg.classList.toggle('err', !x.ok);
        msg.textContent = x.ok ? 'Thank you. We have your request and will come back to you.' : (x.j.error || 'Something went wrong. Please email contact@nazryx.com.');
        if (x.ok) { f.reset(); btn.textContent = 'Sent'; } else { btn.disabled = false; btn.textContent = 'Send request'; }
      })
      .catch(function () { msg.hidden = false; msg.classList.add('err'); msg.textContent = 'Could not send. Please email contact@nazryx.com.'; btn.disabled = false; btn.textContent = 'Send request'; });
  });
})();
