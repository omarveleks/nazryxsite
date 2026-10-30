// Visual and accessibility audit: every route, two widths, axe-core, console and network errors, overflow, tiny tap targets.
// Usage: BASE=http://localhost:3003 DEMO_PASSWORD=... SEED_TEAM_PASSWORD=... OUT=/tmp/audit node audit.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const B = process.env.BASE || 'http://localhost:3003';
const OUT = process.env.OUT || '/tmp/audit';
mkdirSync(OUT, { recursive: true });
const AXE = readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const WIDTHS = [1280, 375];
const results = [];

async function ctx(width) {
  const c = await browser.newContext({ viewport: { width, height: width < 600 ? 740 : 900 }, deviceScaleFactor: 1 });
  return c;
}
async function signin(c, email, pw) {
  const p = await c.newPage();
  await p.goto(B + '/signup?mode=signin'); await p.fill('#email', email); await p.fill('#password', pw);
  await Promise.all([p.waitForURL(/\/m|\/d|\/help|verify|onboarding|admin/), p.click('button[type=submit]')]);
  await p.close();
}
const slug = (s) => s.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'root';

async function audit(c, who, path, width) {
  const p = await c.newPage();
  const errors = [], failed = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
  p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/_next/')) failed.push(`${r.status()} ${r.url().replace(B, '')}`); });
  let status = 0, finalUrl = '';
  try {
    const r = await p.goto(B + path, { waitUntil: 'load', timeout: 25000 });
    await p.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    status = r?.status() ?? 0; finalUrl = p.url().replace(B, '');
  } catch (e) { errors.push('nav: ' + e.message.slice(0, 120)); }
  let axe = [], overflow = false, tiny = [], h1 = 0, title = '', landmarks = {}, lowContrastText = 0;
  try {
    await p.addScriptTag({ content: AXE });
    const res = await p.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => x.target.join(' ') + ' :: ' + (x.html || '').slice(0, 140)) }));
    });
    axe = res;
    const info = await p.evaluate(() => {
      const de = document.documentElement;
      const overflow = de.scrollWidth > window.innerWidth + 1;
      const tiny = [];
      for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary')) {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (r.height < 24 || r.width < 24) tiny.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
      }
      return { overflow, tiny: [...new Set(tiny)].slice(0, 12), tinyN: tiny.length, h1: document.querySelectorAll('h1').length, title: document.title,
        landmarks: { main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length, h2: document.querySelectorAll('h2').length } };
    });
    overflow = info.overflow; tiny = info.tiny; h1 = info.h1; title = info.title; landmarks = info.landmarks; lowContrastText = info.tinyN;
    await p.screenshot({ path: `${OUT}/${who}_${slug(path)}_${width}.png`, fullPage: true });
  } catch (e) { errors.push('audit: ' + e.message.slice(0, 120)); }
  results.push({ who, path, width, status, finalUrl, title, h1, landmarks, overflow, tiny, tinyN: lowContrastText, errors, failed, axe });
  const bad = axe.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`${who.padEnd(5)} ${String(width).padEnd(4)} ${String(status).padEnd(3)} ${path.padEnd(44)} h1=${h1} ${overflow ? 'OVERFLOW ' : ''}${tiny.length ? 'tiny=' + lowContrastText + ' ' : ''}${errors.length ? 'errors=' + errors.length + ' ' : ''}${failed.length ? 'failed=' + failed.length + ' ' : ''}${bad.length ? 'axe=' + bad.map((v) => v.id + 'x' + v.n).join(',') : ''}`);
  await p.close();
}

async function firstHref(c, path, prefix) {
  const p = await c.newPage(); await p.goto(B + path, { waitUntil: 'load', timeout: 25000 }).catch(() => {});
  const href = await p.evaluate((pre) => { const a = [...document.querySelectorAll('a[href]')].find((x) => x.getAttribute('href').startsWith(pre)); return a ? a.getAttribute('href') : null; }, prefix);
  await p.close(); return href;
}

const ANON = ['/', '/signup', '/signup?mode=signin', '/help', '/p', '/p/demo-generics-manufacturing', '/this-page-does-not-exist'];
const MAKER = ['/m', '/m/inbox', '/m/projects', '/m/projects/12', '/m/calendar', '/m/market', '/m/market?market=TZ', '/m/finder', '/m/simulator', '/m/products', '/m/products/1',
  '/m/products/1/dossier', '/m/regulatory', '/m/partners', '/m/partners/intro', '/m/tenders', '/m/ask', '/m/services', '/m/plan', '/m/marketplace',
  '/m/molecules/1', '/m/coverage', '/m/activity', '/m/report', '/m/call', '/m/add-market', '/m/engagements/1', '/settings', '/settings/security', '/settings/api'];
const TEAM = ['/admin', ...['data', 'review', 'claims', 'manufacturers', 'documents', 'questions', 'accounts', 'content', 'billing', 'activity', 'regulatory', 'calls', 'team', 'requests', 'usage'].map((t) => '/admin?tab=' + t),
  '/admin/marketplace', '/admin/invoice-maker', '/admin/engagements/1', '/admin/accounts/' + (process.env.MAKER_ID || '')];

for (const width of WIDTHS) {
  const a = await ctx(width);
  for (const path of ANON) await audit(a, 'anon', path, width);
  await a.close();

  const m = await ctx(width); await signin(m, 'demo-maker@nazryx.test', process.env.DEMO_PASSWORD);
  const extra = [];
  const co = await firstHref(m, '/m/partners', '/m/companies/'); if (co) extra.push(co);
  const svc = await firstHref(m, '/m/services', '/m/services/'); if (svc) extra.push(svc);
  for (const path of [...MAKER, ...extra]) await audit(m, 'maker', path, width);
  await m.close();

  const t = await ctx(width); await signin(t, process.env.SEED_TEAM_EMAIL || 'team@nazryx.test', process.env.SEED_TEAM_PASSWORD);
  for (const path of TEAM) await audit(t, 'team', path, width);
  await t.close();
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));

// summary by rule
const byRule = {};
for (const r of results) for (const v of r.axe) { const k = `${v.impact} ${v.id}`; byRule[k] ??= { pages: 0, nodes: 0, help: v.help, sample: v.sample[0] }; byRule[k].pages++; byRule[k].nodes += v.n; }
console.log('\n== axe violations by rule ==');
for (const [k, v] of Object.entries(byRule).sort((a, b) => b[1].pages - a[1].pages)) console.log(`${k}: ${v.pages} pages, ${v.nodes} nodes. ${v.help}\n    e.g. ${v.sample}`);
console.log('\n== pages with overflow at 375 ==', results.filter((r) => r.width === 375 && r.overflow).map((r) => r.who + ' ' + r.path));
console.log('== pages with errors ==', results.filter((r) => r.errors.length).map((r) => `${r.who} ${r.path}@${r.width}: ${r.errors[0]}`));
console.log('== failed requests ==', [...new Set(results.flatMap((r) => r.failed))]);
console.log('== bad status ==', results.filter((r) => r.status !== 200 && !r.path.includes('does-not-exist')).map((r) => `${r.who} ${r.path} -> ${r.status} ${r.finalUrl}`));
console.log('== h1 count != 1 ==', results.filter((r) => r.h1 !== 1 && r.width === 1280).map((r) => `${r.who} ${r.path}: ${r.h1}`));
await browser.close();
