/* "Where should you start?" — five questions, then Nazryx's view on which region to enter first. Data comes from content/site.json. */
(function () {
  var root = document.querySelector('[data-quiz]');
  if (!root) return;
  var data = JSON.parse(root.querySelector('.quiz-data').textContent);
  var Q = data.questions, R = data.regions, body = root.querySelector('.quiz-body'), bar = root.querySelector('.quiz-bar i');
  var ans = {}, step = 0;
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function ask() {
    var q = Q[step];
    bar.style.transform = 'scaleX(' + (step / Q.length) + ')';
    body.innerHTML = '<p class="quiz-step">Question ' + (step + 1) + ' of ' + Q.length + '</p><h3 class="quiz-q">' + esc(q.q) + '</h3><div class="quiz-opts">' +
      q.a.map(function (a, i) { return '<button type="button" class="quiz-opt" data-i="' + i + '" data-track="quiz:' + q.id + '">' + esc(a) + '</button>'; }).join('') + '</div>' +
      (step ? '<button type="button" class="quiz-back">&larr; Back</button>' : '');
    body.querySelectorAll('.quiz-opt').forEach(function (b) {
      b.addEventListener('click', function () { ans[q.id] = q.a[+b.getAttribute('data-i')]; step++; step < Q.length ? ask() : result(); });
    });
    var back = body.querySelector('.quiz-back');
    if (back) back.addEventListener('click', function () { step--; ask(); });
    if (document.activeElement && root.contains(document.activeElement)) { var f = body.querySelector('.quiz-opt'); if (f) f.focus(); }
  }

  function pick() {
    var named = R.filter(function (r) { return r.name === ans.region; })[0];
    if (named) return { r: named, why: 'You named it. Here is how we would approach it.' };
    if (ans.dossier === 'Yes') return { r: R[1], why: 'Your CTD dossier is ready, and East Africa is where a good dossier travels furthest.' };
    if (['Pakistan', 'Bangladesh', 'Turkey'].indexOf(ans.from) > -1) return { r: R[0], why: 'Our team is on the ground in Almaty, and one EAEU dossier can open five markets.' };
    return { r: R[1], why: 'One dossier format across the region makes it the most efficient first step.' };
  }

  function result() {
    bar.style.transform = 'scaleX(1)';
    var p = pick(), r = p.r;
    var dossier = ans.dossier === 'Yes' ? 'Your CTD dossier is a head start: it is the format East Africa requires and the EAEU route builds on.'
      : 'Before completing a dossier, we would show you which products are worth it. That saves money on lines that will not win.';
    var stage = ans.stage === 'Not exporting yet' ? 'We would act as your export team from day one.'
      : ans.stage === 'Through distributors' ? 'We would also check whether your current partners are the right ones. Registrations stay in your name either way.'
      : 'We would add markets alongside the presence you already have.';
    body.innerHTML = '<p class="quiz-step">Our view</p><h3 class="quiz-q">Start in ' + esc(r.name) + '.</h3>' +
      '<p class="quiz-why">' + esc(p.why) + '</p>' +
      '<div class="quiz-res"><div><span class="card-lbl">The angle</span><b>' + esc(r.angle) + '</b><p>' + esc(r.insight) + '</p></div>' +
      '<div><span class="card-lbl">Markets</span><b>' + esc(r.markets) + '</b><ul>' + r.facts.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div></div>' +
      '<ul class="quiz-notes"><li>' + esc(dossier) + '</li><li>' + esc(stage) + '</li></ul>' +
      '<div class="btns"><a class="btn btn-blue" href="/start?region=' + encodeURIComponent(r.name) + '" data-track="quiz:request">Request a market read for ' + esc(r.name) + '</a>' +
      '<button type="button" class="btn btn-line quiz-again" data-track="quiz:again">Start again</button></div>' +
      '<p class="note">A starting view based on your answers, not a recommendation for any specific product. The market read is where we prove it.</p>';
    body.querySelector('.quiz-again').addEventListener('click', function () { ans = {}; step = 0; ask(); body.querySelector('.quiz-opt').focus(); });
  }
  ask();
})();
