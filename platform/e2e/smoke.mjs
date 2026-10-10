// Browser smoke test: the main customer and team flows on a freshly bootstrapped stack (synthetic data from
// make_fixture.py). Usage: BASE=http://localhost:3000 DEMO_PASSWORD=... SEED_TEAM_PASSWORD=... node smoke.mjs
import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';

const B = process.env.BASE || 'http://localhost:3000';
const XLS = process.env.XLS;   // optional: a registry export to upload through Admin
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const failures = [];
const check = (ok, msg) => { if (ok) console.log('✓', msg); else { console.log('✗', msg); failures.push(msg); } };

function totp(secret) {   // RFC 6238, same as the app
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const c of secret) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', key).update(ctr).digest(); const o = h[19] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}

async function page(width = 1280) {
  const p = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
  p.on('response', (r) => { if (r.status() >= 500) failures.push(`${r.status()} ${r.url()}`); });
  p.on('pageerror', (e) => failures.push(`page error on ${p.url()}: ${e.message}`));
  return p;
}
async function signin(p, email, pw, secret) {
  await p.goto(B + '/signup?mode=signin'); await p.fill('#email', email); await p.fill('#password', pw);
  await Promise.all([p.waitForURL(/home|verify|onboarding/), p.click('button[type=submit]')]);
  if (p.url().includes('/signin/verify')) {
    await p.fill('#code', totp(secret));
    await Promise.all([p.waitForURL(/home/), p.click('button[type=submit]')]);
  }
}

// 1. a new customer signs up, claims a company, enriches a molecule, sends a request
const c = await page();
const email = `smoke${Date.now()}@alphapharma.co.tz`;
await c.goto(B + '/signup'); await c.fill('#name', 'Smoke Test'); await c.fill('#email', email); await c.fill('#password', 'smoke-password-123');
await Promise.all([c.waitForURL(/onboarding/), c.click('button[type=submit]')]);
await c.fill('#q', 'alpha'); await Promise.all([c.waitForURL(/q=alpha/), c.click('form[method=get] button')]);
await c.locator('input[name=company_id]').first().check();
await c.setInputFiles('#licence', { name: 'licence.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
await Promise.all([c.waitForURL(/home/), c.click('text=Continue')]);
check(true, 'sign up and claim a company');
await c.goto(B + '/search?q=doxy');
await Promise.all([c.waitForURL(/molecule\/\d+/), c.locator('text=Enrich, 1 credit').first().click()]);
check((await c.locator('.plan-box').innerText()).includes('19'), 'enrich spends one credit');
const molPage = await c.content();
check(!/Gap score|Demand strength/.test(molPage) && molPage.includes('Registered in Tanzania'), 'molecule page shows registrations, no score');
for (const path of ['/market', '/market/whitespace', '/competitors', '/competitors?tab=compare', '/portfolio', '/portfolio?tab=benchmark', '/requests', '/settings', '/settings/security', '/help']) {
  const r = await c.goto(B + path); check(r.status() === 200, `customer page ${path}`);
}
await c.goto(B + '/home');
const homeHtml = await c.content();
check(['Market intelligence', 'Quick sourcing', 'Portfolio analysis'].every((t) => homeHtml.includes(t)), 'home shows the three services');
await c.fill('#list', 'Amoxicillin 500mg capsules\nCiprofloxacin\nNot A Real Medicine');
await Promise.all([c.waitForURL(/added=/), c.click('text=Analyse my portfolio')]);
check(Number(new URL(c.url()).searchParams.get('added')) >= 2 && (await c.content()).includes('Full analysis'), 'paste a product list to build the portfolio');
await c.goto(B + '/requests/new'); await c.fill('#molecule', 'Amoxicillin');   // quantity is optional
await Promise.all([c.waitForURL(/sent=/), c.click('text=Send request')]);
const reqId = new URL(c.url()).searchParams.get('sent');
check(Boolean(reqId), 'send a sourcing request');
check((await c.goto(B + '/admin')).status() === 404, 'admin is hidden from customers');

// 2. the demo customer accepts an anonymous quote and the supplier is revealed
const d = await page();
await signin(d, 'demo-free@nazryx.test', process.env.DEMO_PASSWORD);
await d.goto(B + '/requests'); await d.click('.col:has-text("Quote ready") .rcard'); await d.waitForURL(/requests\/\d+/);
check(!(await d.content()).includes('Demo Supplier'), 'supplier hidden before accepting');
await Promise.all([d.waitForURL(/accepted=1/), d.locator('button:has-text("Accept")').first().click()]);
check((await d.content()).includes('Demo Supplier'), 'supplier revealed after accepting');

// 3. the team account must set up two-step sign-in before Admin opens, then works the admin pages
const t = await page();
await signin(t, process.env.SEED_TEAM_EMAIL || 'team@nazryx.test', process.env.SEED_TEAM_PASSWORD);
await t.goto(B + '/admin');
check(t.url().includes('/settings/security'), 'team is sent to two-step set-up');
await Promise.all([t.waitForLoadState('networkidle'), t.click('text=Set up two-step sign-in')]);
const secret = (await t.locator('code').first().innerText()).replace(/\s+/g, '');
await t.fill('input[name=code]', totp(secret));
await Promise.all([t.waitForURL(/on=1/), t.click('button:has-text("Turn on")')]);
check(true, 'team turns on two-step sign-in');
for (const tab of ['', '?tab=review', '?tab=claims', '?tab=requests', '?tab=accounts', '?tab=content', '?tab=activity']) {
  const r = await t.goto(B + '/admin' + tab); check(r.status() === 200, `admin ${tab || 'data updates'}`);
}
await t.goto(B + '/admin?tab=claims');
await Promise.all([t.waitForLoadState('networkidle'), t.locator(`tr:has-text("${email}") button:has-text("Approve")`).click()]);
await t.goto(B + '/admin?tab=activity');
check((await t.content()).includes('company claims'), 'claim approval is in the activity log');
await t.goto(B + `/admin/requests/${reqId}`);
await t.selectOption('#verdict', 'go'); await t.fill('#summary', 'Few competitors and supply is ready.');
await t.fill('#price_range', 'USD 1.00-1.20 per pack');
await Promise.all([t.waitForURL(/saved=1/), t.click('text=Send evaluation to the customer')]);
await c.goto(B + `/requests/${reqId}`);
const evalPage = await c.content();
check(evalPage.includes('Few competitors and supply is ready.') && evalPage.includes('USD 1.00-1.20'), 'customer sees the evaluation in the request');
const t2 = await page();
await signin(t2, process.env.SEED_TEAM_EMAIL || 'team@nazryx.test', process.env.SEED_TEAM_PASSWORD, secret);
check(t2.url().includes('/home'), 'team signs in with a two-step code');
if (XLS) {
  await t.goto(B + '/admin'); await t.setInputFiles('#file', XLS);
  await Promise.all([t.waitForURL(/queued=1/), t.click('text=Upload registration list')]);
  let applied = false;
  for (let i = 0; i < 30 && !applied; i++) { await t.waitForTimeout(2000); await t.goto(B + '/admin'); applied = (await t.locator('.pill:has-text("Applied")').count()) > 1; }
  check(applied, 'registry upload is processed by the worker');
}

// 4. phone width: no sideways scrolling
const m = await page(375);
await signin(m, 'demo-free@nazryx.test', process.env.DEMO_PASSWORD);
for (const path of ['/home', '/search?q=amox', '/market', '/market/whitespace', '/requests', '/portfolio', '/help']) {
  await m.goto(B + path);
  const w = await m.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 380, `no sideways scroll at 375px on ${path}`);
}

await browser.close();
if (failures.length) { console.log('\nFAILED:\n' + failures.join('\n')); process.exit(1); }
console.log('\nall smoke checks passed');
