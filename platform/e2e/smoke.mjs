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
const adm = await t.goto(B + '/admin');
check(adm.status() === 200 && t.url().endsWith('/admin'), 'team opens Admin without two-step sign-in');
await t.goto(B + '/settings/security');   // two-step sign-in stays available as an option
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
// the owner adds a team member who can only work on sourcing requests
const memberMail = `member${Date.now()}@nazryx.test`;
await t.goto(B + '/admin?tab=team');
await t.fill('input[name=name]', 'Smoke Member'); await t.fill('input[name=email]', memberMail); await t.fill('input[name=password]', 'member-password-123');
await t.locator('form:has(input[name=password]) input[name=perm][value=requests]').check();
await Promise.all([t.waitForURL(/saved=1/), t.click('button:has-text("Add team member")')]);
const mb = await page();
await mb.goto(B + '/signup?mode=signin&as=distributor'); await mb.fill('#email', memberMail); await mb.fill('#password', 'member-password-123');
await Promise.all([mb.waitForURL(/home/), mb.click('button[type=submit]')]);
await mb.goto(B + '/admin');
const mtabs = await mb.locator('.tabs').innerText();
check(mtabs.includes('Requests') && !mtabs.includes('Accounts') && !mtabs.includes('Team'), 'a team member sees only the areas they were given');
check((await mb.goto(B + '/admin?tab=accounts')) && !(await mb.locator('.tabs').innerText()).includes('Accounts'), 'other areas stay closed');
const acc404 = await mb.goto(B + `/admin/requests/${reqId}`);
check(acc404.status() === 200, 'the member works on requests');
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
check((await k.locator('body').innerText()).includes('Step 1 of 8'), 'sign-up asks one question per screen');
await Promise.all([k.waitForURL(/q=markets/), k.click('button:has-text("Continue")')]);
await k.locator('input[name=target_countries][value=KE]').check();
await Promise.all([k.waitForURL(/q=goals/), k.click('button:has-text("Continue")')]);
await k.locator('input[name=goals][value=launch]').check();
await Promise.all([k.waitForURL(/q=help/), k.click('button:has-text("Continue")')]);
await k.locator('input[name=services][value=register]').check(); await k.locator('input[name=services][value=sales]').check();
await Promise.all([k.waitForURL(/q=timeline/), k.click('button:has-text("Continue")')]);
await Promise.all([k.waitForURL(/q=scope/), k.click('button[name=choice][value=now]')]);
await Promise.all([k.waitForURL(/q=products/), k.click('button[name=choice][value="1_3"]')]);
await k.fill('textarea[name=list]', 'Doxycycline 100mg capsules\nAmoxicillin 500mg capsules\nNot A Real Product');
await k.setInputFiles('input[name=catalogue]', { name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from('name\nDoxycycline 100mg capsules') });
await Promise.all([k.waitForURL(/q=plan/), k.click('button:has-text("Continue")')]);
const planText = await k.locator('body').innerText();
check(planText.includes('3 products added, 2 matched'), 'catalogue is matched to the market during sign-up');
check(planText.includes('Suggested') && planText.includes('Complete Market Entry') && planText.includes('you want registration and sales handled for you'), 'sign-up ends with a suggested plan');
await Promise.all([k.waitForURL(/\/m\/products/), k.locator('form:has(.pill:has-text("Suggested")) button[type=submit]').click()]);
await k.locator('[role=dialog]:has-text("Tour · 1 of 8")').waitFor({ state: 'attached', timeout: 15000 });
const tour = await k.locator('[role=dialog]').innerText();
check(tour.includes('Add your products') && (await k.locator('[data-tour="add-products"]').count()) === 1, 'the guided tour starts after sign-up, spotlighting the feature');
await k.click('button:has-text("Next: Your portfolio at a glance")');
check(await k.locator('text=Tour · 2 of 8').waitFor({ timeout: 15000 }).then(() => true, () => false), 'tour: next takes them to the next feature');
await Promise.all([k.waitForURL(/\/m$/), k.click('button:has-text("End tour")')]);
check((await k.locator('[role=dialog]:has-text("Tour ·")').count()) === 0 && (await k.locator('main').innerText()).includes('Get set up'), 'tour ends; Home shows the set-up checklist');
await k.goto(B + '/m');
check((await k.locator('main').innerText()).includes('Register these first'), 'manufacturer lands on its own home');
await k.goto(B + '/home'); check(k.url().endsWith('/m'), 'manufacturers are kept out of the distributor area');
// without an active plan: the free screens work, the rest is locked with a way to unlock it
await k.goto(B + '/m/services');
const svc = await k.locator('main').innerText();
check(svc.includes('What do you want?') && svc.includes('Dossier and regulatory review') && svc.includes('Renewals and compliance')
  && !svc.includes('East African') && !svc.includes('Send to our team'), 'services: three services, forms open per service');
await k.click('a.choice:has-text("Enter a new market")'); await k.waitForURL(/goal=enter/);
await k.click('a.pill:has-text("Tanzania")'); await k.waitForURL(/market=TZ/);
await k.click('a.choice:has-text("Take it over completely")'); await k.waitForURL(/depth=full/);
check((await k.locator('#want').innerText()).includes('Complete Market Entry'), 'what do you want: answers lead to the plan that fits');
check(await k.locator('a.card:has(h2:text-is("Market entry")) .pill:has-text("Complete Market Entry")').count() === 1, 'services outside the plan are locked');
await k.goto(B + '/m/partners');
const free = await k.locator('main').innerText();
check(/Distributor [0-9A-F]{8}/.test(free) && !free.includes('Reaches EML') && !free.includes('manufacture locally') && (await k.locator('a.pill:has-text("Introduction")').count()) > 0
  && (await k.locator('.nm').count()) <= 5, 'partners opens on every distributor, five free, introductions locked');
await k.goto(B + '/m/products');
const prodFree = await k.locator('main').innerText();
check(prodFree.includes('In high demand') && prodFree.includes('Your portfolio analysis'), 'products dashboard with the analysis locked');
await k.fill('#med-q', 'amlodip');
await k.locator('#med-hits button', { hasText: /amlodipine/i }).first().click();
await k.fill('input[name=strength]', '5 mg'); await k.selectOption('select[name=form]', 'Tablets');
await Promise.all([k.waitForURL(/\/m\/products\/\d+\?added=1/), k.click('button:has-text("Add to my products")')]);
check((await k.locator('main').innerText()).includes('Added.'), 'add a product from the medicine search');
await k.goto(B + '/m/products');
await k.locator('a b', { hasText: 'Doxycycline' }).first().click(); await k.waitForURL(/\/m\/products\/\d+/);
const kp = await k.locator('main').innerText();
check(kp.includes('Why Tanzania') && kp.includes('Route and timeline') && kp.includes('Unlock with Complete Market Access'), 'product page with paid parts locked');
await k.goto(B + '/m');
check((await k.locator('main').innerText()).includes('Market watch'), 'market watch on the home page');
await k.goto(B + '/m/plan?want=access');
check((await k.locator('main').innerText()).includes('To unlock that') && (await k.locator('main').innerText()).includes('Compare the plans'), 'upgrade flow names the plan that unlocks it');

// the team approves the company and switches the plan on; everything opens
await t.goto(B + '/admin?tab=manufacturers');
await Promise.all([t.waitForURL(/saved=1/), t.locator(`tr:has-text("${kmail}") button:has-text("Approve")`).click()]);
await t.locator('a:has-text("Smoke Generics")').first().click(); await t.waitForURL(/admin\/accounts\//);
const acct = await t.locator('main').innerText();
check(acct.includes('Launch in new markets') && acct.includes('chose Complete Market Entry') && acct.includes('catalogue.csv'), 'team sees every onboarding answer');
await t.selectOption('#plan select[name=plan]', 'entry');
await Promise.all([t.waitForURL(/saved=1/), t.click('#plan button:has-text("Save")')]);
const acctUrl = t.url().split('?')[0];
await t.goto(acctUrl);
await t.selectOption('#documents select[name=kind]', 'agreement'); await t.fill('#documents input[name=title]', 'Smoke services agreement');
await t.setInputFiles('#documents input[name=file]', { name: 'agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a') });
await Promise.all([t.waitForURL(/saved=1/), t.click('#documents button:has-text("Upload")')]);
let invoiced = false;
for (let i = 0; i < 15 && !invoiced; i++) { await k.waitForTimeout(1000); await k.goto(B + '/settings'); invoiced = (await k.locator('main').innerText()).includes('Invoice NZX-'); }
const settingsText = await k.locator('main').innerText();
check(settingsText.includes('Smoke services agreement'), 'customer finds account documents in Settings');
check(invoiced && settingsText.includes('Order confirmation'), 'switching a plan on issues the order confirmation and invoice');
await k.goto(B + '/m/products');
check((await k.locator('main').innerText()).includes('By therapeutic class'), 'active plan unlocks the portfolio analysis');
await k.goto(B + '/m/products');
await k.locator('a b', { hasText: 'Doxycycline' }).first().click(); await k.waitForURL(/\/m\/products\/\d+/);
await Promise.all([k.waitForURL(/saved=1/), k.click('button:has-text("Add to the tracker")')]);
await k.goto(B + '/m/products?tab=launches');
check((await k.locator('main').innerText()).includes('Doxycycline'), 'launch tracker');
await k.goto(B + '/m/report?market=TZ');
check((await k.locator('body').innerText()).includes('Your portfolio against it'), 'market read to download');
await k.goto(B + '/m/market?market=TZ');
check((await k.locator('main').innerText()).includes('Where registered products are made'), 'market page for the manufacturer');
await k.goto(B + '/m/market?market=KE');
check((await k.locator('main').innerText()).includes('Talk to our team'), 'markets without data point to our team');
await k.goto(B + '/m/partners?class=' + encodeURIComponent('Anti-infective Medicines'));
const kpart = await k.locator('main').innerText();
check(/Distributor [0-9A-F]{8}/.test(kpart) && /Open to \d+ of your \d+ molecules/.test(kpart) && !kpart.includes('Alpha Pharma'), 'partners show codes and how open each is to you');
await Promise.all([k.waitForURL(/\/m\/engagements\/\d+\?new=1/), k.locator('button:has-text("Request introduction")').first().click()]);
check(true, 'manufacturer requests an introduction');
await k.goto(B + '/m/services/market_entry');
await Promise.all([k.waitForURL(/\/m\/engagements\/\d+\?new=1/), k.click('button:has-text("Send to our team")')]);
const engId = k.url().match(/engagements\/(\d+)/)[1];
await k.selectOption('select[name=item]', 'gmp');
await k.setInputFiles('input[name=file]', { name: 'gmp.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 gmp') });
await Promise.all([k.waitForURL(/uploaded=1/), k.click('button:has-text("Upload")')]);
check((await k.locator('main').innerText()).includes('gmp.pdf'), 'manufacturer uploads to the dossier room');
await t.goto(B + `/admin/engagements/${engId}`);
await t.selectOption('select[name=stage]', 'Market assessment');
await Promise.all([t.waitForURL(/saved=1/), t.click('button:has-text("Update")')]);
await t.goto(B + `/admin/engagements/${engId}`);
await t.selectOption('select[name=review]', 'accepted');
await Promise.all([t.waitForURL(/saved=1/), t.locator('form:has(select[name=review]) button:has-text("Save")').click()]);
await k.goto(B + `/m/engagements/${engId}`);
const ke = await k.locator('main').innerText();
check(ke.includes('Accepted') && ke.includes('1 of 1 accepted'), 'team review shows in the dossier room');
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
