/* 6B "From your catalogue to a plan": sticky dot grid driven by which step is in view. Illustrative numbers only. */
(function () {
  var root = document.getElementById('story');
  if (!root) return;
  var dotsEl = root.querySelector('.dots'), waves = root.querySelector('.waves'), countEl = root.querySelector('.story-count b'), labelEl = root.querySelector('.story-count span');
  var steps = [].slice.call(root.querySelectorAll('.story-step'));
  var N = 120, html = '';
  for (var i = 0; i < N; i++) html += '<i></i>';
  dotsEl.innerHTML = html;
  var dots = [].slice.call(dotsEl.children);
  // fixed pseudo-random order so the same dots drop out each time
  var order = dots.map(function (_, i) { return i; }).sort(function (a, b) { return ((a * 37) % 101) - ((b * 37) % 101); });
  var cur = -1, shown = N;

  function setCount(n) {
    if (window.nzxReduce) { countEl.textContent = n; shown = n; return; }
    var from = shown, t0 = null;
    function f(t) { if (!t0) t0 = t; var p = Math.min((t - t0) / 600, 1); countEl.textContent = Math.round(from + (n - from) * p); if (p < 1) requestAnimationFrame(f); }
    requestAnimationFrame(f); shown = n;
  }
  function go(k) {
    if (k === cur) return;
    cur = k;
    steps.forEach(function (s, i) { s.classList.toggle('cur', i === k); });
    var keep = +steps[k].getAttribute('data-keep'), isWave = steps[k].hasAttribute('data-waves');
    dotsEl.hidden = isWave; waves.classList.toggle('on', isWave);
    order.forEach(function (idx, rank) { dots[idx].classList.toggle('off', rank >= keep); });
    setCount(keep);
    labelEl.textContent = steps[k].getAttribute('data-label');
  }
  go(0);
  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) go(steps.indexOf(e.target)); });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach(function (s) { io.observe(s); });
})();
