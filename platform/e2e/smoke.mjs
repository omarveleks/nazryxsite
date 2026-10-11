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
  await p.goto(B + '/signup?mode=signin&as=distributor'); await p.fill('#email', email); await p.fill('#password', pw);
  await Promise.all([p.waitForURL(/home|verify|onboarding/), p.click('button[type=submit]')]);
  if (p.url().includes('/signin/verify')) {
    await p.fill('#code', totp(secret));
    await Promise.all([p.waitForURL(/home/), p.click('button[type=submit]')]);
  }
}

// 1. a new customer signs up, claims a company, enriches a molecule, sends a request
const c = await page();
const email = `smoke${Date.now()}@alphapharma.co.tz`;
await c.goto(B + '/signup');
check((await c.locator('a.tile').count()) === 2, 'sign-up starts with two big choices');
await Promise.all([c.waitForURL(/as=distributor/), c.click('a.tile:has-text("distributor")')]);
await c.fill('#name', 'Smoke Test'); await c.fill('#email', email); await c.fill('#password', 'smoke-password-123');
await Promise.all([c.waitForURL(/onboarding/), c.click('button[type=submit]')]);
await c.fill('#q', 'alpha'); await Promise.all([c.waitForURL(/q=alpha/), c.click('form[method=get] button')]);
await c.locator('input[name=company_id]').first().check();
await Promise.all([c.waitForURL(/onboarding\/focus/), c.click('text=Continue')]);
check(true, 'sign up and claim a company');
await c.locator('input[name=goals][value=new_molecules]').check();
await c.locator('input[name=classes]').first().check();
await c.locator('input[name=supplier_countries][value=India]').check();
await Promise.all([c.waitForURL(/\/home/), c.click('text=Save and continue')]);
check((await c.locator('main').innerText()).includes('Your focus'), 'set your focus during onboarding');
await c.goto(B + '/search?q=doxy');
await Promise.all([c.waitForURL(/molecule\/\d+/), c.locator('a .nm').first().click()]);
await c.locator('button:has-text("Enrich, 1 credit")').first().click();
await c.locator('.tabs').waitFor();
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
await c.goto(B + '/search?q=cipro');
await c.locator('button:has-text("+ List")').first().click();
await c.locator('a:has-text("Sourcing list · 1")').waitFor();
await c.goto(B + '/requests/list');
await Promise.all([c.waitForURL(/sent=1/), c.locator('button:has-text("Request 1 molecule")').click()]);
check((await c.content()).includes('Product request'), 'sourcing list sends its molecules as requests');
check((await c.goto(B + '/admin')).status() === 404, 'admin is hidden from customers');
await c.goto(B + '/compare?an=Amoxicillin&bn=Doxycycline');
const cmp = await c.locator('main').innerText();
check(cmp.includes('Amoxicillin') && cmp.includes('Doxycycline') && cmp.includes('Registered forms'), 'compare two molecules');
await c.goto(B + '/export/open');
check(c.url().includes('/settings'), 'export sends free plans to the plans page');
await c.goto(B + '/expert'); await c.fill('#body', 'Can Doxycycline go through the abridged route?');
await Promise.all([c.waitForURL(/sent=1/), c.click('text=Send question')]);
check(true, 'ask the expert');

// 2. the demo customer accepts an anonymous quote and the supplier is revealed
const d = await page();
await signin(d, 'demo-free@nazryx.test', process.env.DEMO_PASSWORD);
await d.goto(B + '/requests'); await d.click('.col:has-text("Pricing and logistics") .rcard'); await d.waitForURL(/requests\/\d+/);
check(!(await d.content()).includes('Demo Supplier'), 'supplier hidden before accepting');
check((await d.content()).includes('Shelf life on arrival'), 'quotes show payment terms, shelf life and GMP before accepting');
await Promise.all([d.waitForURL(/accepted=1/), d.locator('button:has-text("Accept")').first().click()]);
check((await d.content()).includes('Demo Supplier'), 'supplier revealed after accepting');
await d.goto(B + '/portfolio?tab=sourced');
const sup = await d.locator('main').innerText();
check(sup.includes('Documents ready') && sup.includes('items ready'), 'portfolio shows supply and shipments');

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
for (const tab of ['', '?tab=review', '?tab=claims', '?tab=requests', '?tab=documents', '?tab=manufacturers', '?tab=accounts', '?tab=content', '?tab=activity']) {
  const r = await t.goto(B + '/admin' + tab); check(r.status() === 200, `admin ${tab || 'data updates'}`);
}
await t.goto(B + '/admin?tab=claims');
await Promise.all([t.waitForLoadState('networkidle'), t.locator(`tr:has-text("${email}") button:has-text("Approve")`).click()]);
await t.goto(B + '/admin?tab=questions');
await t.locator('textarea[name=answer]').first().fill('Yes, if the reference product is WHO-prequalified.');
await Promise.all([t.waitForURL(/saved=1/), t.locator('button:has-text("Send answer")').first().click()]);
await c.goto(B + '/expert');
check((await c.locator('main').innerText()).includes('Yes, if the reference product is WHO-prequalified.'), 'customer sees the expert answer');
const exp = await t.request.get(B + '/export/open');
check(exp.status() === 200 && (exp.headers()['content-type'] || '').includes('text/csv'), 'export to Excel for paid plans and the team');
await t.goto(B + '/admin?tab=activity');
check((await t.content()).includes('company claims'), 'claim approval is in the activity log');
await t.goto(B + `/admin/requests/${reqId}`);
await t.selectOption('#verdict', 'go'); await t.fill('#summary', 'Few competitors and supply is ready.');
await t.fill('#price_range', 'USD 1.00-1.20 per pack');
await t.fill('#regulatory_check', 'Nobody holds an active registration.');
await Promise.all([t.waitForURL(/saved=1/), t.click('text=Send assessment to the customer')]);
await t.goto(B + `/admin/requests/${reqId}`);
await t.selectOption('select[name=item_gmp]', 'have'); await t.selectOption('select[name=item_stability]', 'missing');
await Promise.all([t.waitForURL(/saved=1/), t.click('text=Save dossier readiness')]);
await c.goto(B + `/requests/${reqId}`);
const evalPage = await c.content();
check((await c.locator('main').innerText()).includes('1 of 10 items ready'), 'customer sees dossier readiness');
check(evalPage.includes('Few competitors and supply is ready.') && evalPage.includes('USD 1.00-1.20') && evalPage.includes('Nobody holds an active registration.'),
  'customer sees the assessment, step by step, in the request');
// the team uploads documents on the request: a dossier document marks its item ready; an internal one stays hidden
await t.goto(B + `/admin/requests/${reqId}`);
await t.selectOption('#documents select[name=kind]', 'dossier'); await t.selectOption('#documents select[name=item]', 'stability');
await t.setInputFiles('#documents input[name=file]', { name: 'stability.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 s') });
await Promise.all([t.waitForURL(/saved=1/), t.click('#documents button:has-text("Upload")')]);
await t.selectOption('#documents select[name=kind]', 'other'); await t.check('#documents input[name=internal]');
await t.setInputFiles('#documents input[name=file]', { name: 'margin-notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 m') });
await Promise.all([t.waitForURL(/saved=1/), t.click('#documents button:has-text("Upload")')]);
await c.goto(B + `/requests/${reqId}`);
const docPage = await c.locator('main').innerText();
check(docPage.includes('stability.pdf') && docPage.includes('2 of 10 items ready'), 'team dossier upload reaches the customer and marks the item ready');
check(!docPage.includes('margin-notes.pdf'), 'internal documents stay with the team');
await t.goto(B + '/admin?tab=documents');
await t.fill('input[name=supplier_name]', 'Smoke Supplier'); await t.selectOption('form:has(input[name=supplier_name]) select[name=kind]', 'gmp');
await t.fill('input[name=expires_on]', new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10));
await t.setInputFiles('form:has(input[name=supplier_name]) input[name=file]', { name: 'smoke-gmp.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 g') });
await Promise.all([t.waitForURL(/saved=1/), t.click('button:has-text("Upload supplier document")')]);
const dtab = await t.locator('main').innerText();
check(dtab.includes('smoke-gmp.pdf') && dtab.includes('stability.pdf'), 'supplier documents and all documents in Admin');
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

// 5. a manufacturer signs up, adds products, asks for market entry and uploads a dossier document; the team works it
const k = await page();
const kmail = `maker${Date.now()}@example.com`;
await k.goto(B + '/signup');
await Promise.all([k.waitForURL(/as=manufacturer/), k.click('a.tile:has-text("manufacturer")')]);
await k.fill('#name', 'Maker Test'); await k.fill('#email', kmail); await k.fill('#password', 'smoke-password-123');
await Promise.all([k.waitForURL(/\/m\/onboarding/), k.click('button[type=submit]')]);
await k.fill('#company_name', 'Smoke Generics'); await k.fill('#hq_country', 'India');
await k.selectOption('#company_size', '250-1,000 people');
await Promise.all([k.waitForURL(/step=2/), k.click('button:has-text("Continue")')]);
await k.locator('input[name=certifications][value="WHO prequalification"]').check();
await k.locator('input[name=dosage_forms][value=Capsules]').check();
await k.locator('input[name=therapeutic_areas][value=Anti-infectives]').check();
await Promise.all([k.waitForURL(/step=3/), k.click('button:has-text("Continue")')]);
await k.locator('input[name=target_countries][value=KE]').check();
await k.locator('input[name=timeline][value=now]').check(); await k.locator('input[name=approach][value=own]').check();
await Promise.all([k.waitForURL(/step=4/), k.click('button:has-text("Continue")')]);
await k.fill('textarea[name=list]', 'Doxycycline 100mg capsules\nAmoxicillin 500mg capsules\nNot A Real Product');
await k.setInputFiles('input[name=catalogue]', { name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from('name\nDoxycycline 100mg capsules') });
await Promise.all([k.waitForURL(/step=5/), k.click('button:has-text("Continue")')]);
check((await k.locator('main, body').first().innerText()).includes('3 products added, 2 matched'), 'catalogue is matched to the market during onboarding');
await k.locator('input[name=goals][value=launch]').check();
await k.locator('input[name=services][value=register]').check(); await k.locator('input[name=services][value=sales]').check();
await k.locator('input[name=launch_scope][value="1_3"]').check();
await Promise.all([k.waitForURL(/step=6/), k.click('button:has-text("Continue")')]);
const planText = await k.locator('body').innerText();
check(planText.includes('Suggested') && planText.includes('Complete Market Entry') && planText.includes('you want registration and sales handled for you') && !planText.includes('joint assessment'), 'onboarding ends with a suggested plan and add-ons');
await Promise.all([k.waitForURL(/\/m\/plan\?requested=1/), k.locator('form:has(.pill:has-text("Suggested")) button[type=submit]').click()]);
check((await k.locator('main').innerText()).includes('Requested'), 'manufacturer requests the suggested plan');
await k.goto(B + '/m');
check((await k.locator('main').innerText()).includes('Register these first'), 'manufacturer lands on its own home');
await k.goto(B + '/home'); check(k.url().endsWith('/m'), 'manufacturers are kept out of the distributor area');
await k.goto(B + '/m/services');
const svc = await k.locator('main').innerText();
check(svc.includes('Recommended for you') && svc.includes('Market entry') && svc.includes('Because you want us to take your products into the market'),
  'services offers what the manufacturer needs first');
await k.goto(B + '/m/products');
await k.locator('a .nm', { hasText: 'Doxycycline' }).first().click(); await k.waitForURL(/\/m\/products\/\d+/);
const kp = await k.locator('main').innerText();
check(kp.includes('Why Tanzania') && kp.includes('Route and timeline'), 'product opportunity page');
await Promise.all([k.waitForURL(/\/m\/engagements\/\d+\?new=1/), k.locator('form:has(input[name=kind][value=market_entry]) button').click()]);
const engId = k.url().match(/engagements\/(\d+)/)[1];
await k.selectOption('select[name=item]', 'gmp');
await k.setInputFiles('input[name=file]', { name: 'gmp.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 gmp') });
await Promise.all([k.waitForURL(/uploaded=1/), k.click('button:has-text("Upload")')]);
check((await k.locator('main').innerText()).includes('gmp.pdf'), 'manufacturer uploads to the dossier room');
await t.goto(B + '/admin?tab=manufacturers');
await Promise.all([t.waitForURL(/saved=1/), t.locator(`tr:has-text("${kmail}") button:has-text("Approve")`).click()]);
await t.locator('a:has-text("Smoke Generics")').first().click(); await t.waitForURL(/admin\/accounts\//);
const acct = await t.locator('main').innerText();
check(acct.includes('Anti-infectives') && acct.includes('chose Complete Market Entry') && acct.includes('catalogue.csv'), 'team sees every onboarding answer');
await t.selectOption('#documents select[name=kind]', 'agreement'); await t.fill('#documents input[name=title]', 'Smoke services agreement');
await t.setInputFiles('#documents input[name=file]', { name: 'agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a') });
await Promise.all([t.waitForURL(/saved=1/), t.click('#documents button:has-text("Upload")')]);
await k.goto(B + '/settings');
check((await k.locator('main').innerText()).includes('Smoke services agreement'), 'customer finds account documents in Settings');
await t.goto(B + `/admin/engagements/${engId}`);
await t.selectOption('select[name=stage]', 'Market assessment');
await Promise.all([t.waitForURL(/saved=1/), t.click('button:has-text("Update")')]);
await t.goto(B + `/admin/engagements/${engId}`);
await t.selectOption('select[name=review]', 'accepted');
await Promise.all([t.waitForURL(/saved=1/), t.locator('form:has(select[name=review]) button:has-text("Save")').click()]);
await k.goto(B + `/m/engagements/${engId}`);
const ke = await k.locator('main').innerText();
check(ke.includes('Accepted') && ke.includes('1 of 1 accepted'), 'team review shows in the dossier room');
await k.goto(B + '/m/partners?class=' + encodeURIComponent('Anti-infective Medicines'));
const kpart = await k.locator('main').innerText();
check(/Distributor [0-9A-F]{8}/.test(kpart) && !kpart.includes('Alpha Pharma'), 'partner finder shows codes, not names');
await Promise.all([k.waitForURL(/\/m\/engagements\/\d+\?new=1/), k.locator('button:has-text("Request introduction")').first().click()]);
check(true, 'manufacturer requests an introduction');
await c.goto(B + '/m'); check(c.url().includes('/home'), 'distributors are kept out of the manufacturer area');

// 4. phone width: no sideways scrolling
const m = await page(375);
await signin(m, 'demo-free@nazryx.test', process.env.DEMO_PASSWORD);
for (const path of ['/home', '/search?q=amox', '/market', '/market/whitespace', '/requests', '/portfolio', '/help']) {
  await m.goto(B + path);
  const w = await m.evaluate(() => document.documentElement.scrollWidth);
  check(w <= 380, `no sideways scroll at 375px on ${path}`);
}

const m2 = await page(375);
for (const path of ['/signup', '/signup?as=manufacturer', '/signup?mode=signin']) {
  await m2.goto(B + path);
  check(await m2.evaluate(() => document.documentElement.scrollWidth) <= 380, `no sideways scroll at 375px on ${path}`);
}

await browser.close();
if (failures.length) { console.log('\nFAILED:\n' + failures.join('\n')); process.exit(1); }
console.log('\nall smoke checks passed');
