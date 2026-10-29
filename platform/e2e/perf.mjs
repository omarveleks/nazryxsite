import { chromium } from 'playwright';
const B = 'http://localhost:3003';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function signin(c, email, pw) { const p = await c.newPage(); await p.goto(B + '/signup?mode=signin'); await p.fill('#email', email); await p.fill('#password', pw);
  await Promise.all([p.waitForURL(/\/m|\/d|admin/), p.click('button[type=submit]')]); await p.close(); }
// overflow culprits on admin at 375
const c375 = await browser.newContext({ viewport: { width: 375, height: 740 } }); await signin(c375, process.env.SEED_TEAM_EMAIL || 'team@nazryx.test', process.env.SEED_TEAM_PASSWORD);
for (const path of ['/admin?tab=billing', '/admin?tab=accounts']) {
  const p = await c375.newPage(); await p.goto(B + path, { waitUntil: 'load' });
  const bad = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { if (e.getBoundingClientRect().right <= window.innerWidth + 1 || getComputedStyle(e).position === 'fixed') return false;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; } return true; })
    .slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} right=${Math.round(e.getBoundingClientRect().right)} "${(e.textContent || '').trim().slice(0, 40)}"`));
  console.log(path, bad); await p.close();
}
await c375.close();
await browser.close(); process.exit(0);
// timing, maker pages at 1280
const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await signin(c, 'demo-maker@nazryx.test', process.env.DEMO_PASSWORD);
const p = await c.newPage();
for (const path of ['/m', '/m/inbox', '/m/market', '/m/finder', '/m/products', '/m/products/1', '/m/regulatory', '/m/partners', '/m/tenders', '/m/projects/12', '/m/molecules/1', '/m/simulator', '/m/calendar', '/m/plan']) {
  const ts = []; for (let i = 0; i < 2; i++) { const t0 = Date.now(); const r = await p.goto(B + path, { waitUntil: 'load' }); const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { ttfb: Math.round(n.responseStart - n.requestStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), bytes: Math.round(n.transferSize / 1024) }; }); ts.push(nav); }
  const n = ts[1]; console.log(`${path.padEnd(18)} ttfb ${String(n.ttfb).padStart(5)} ms  dcl ${String(n.dcl).padStart(5)}  load ${String(n.load).padStart(5)}  html ${n.bytes} KB   (1st: ttfb ${ts[0].ttfb})`);
}
const res = await p.evaluate(() => performance.getEntriesByType('resource').map((r) => ({ n: r.name.replace(location.origin, ''), kb: Math.round(r.transferSize / 1024), ms: Math.round(r.duration) })).sort((a, b) => b.kb - a.kb).slice(0, 8));
console.log('heaviest resources on /m/plan:', res);
await browser.close();
