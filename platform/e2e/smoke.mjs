// Browser smoke test: the manufacturer and team flows (the distributor side is paused: web/distributor/e2e keeps its checks) on a freshly bootstrapped stack (synthetic data from
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
  await Promise.all([p.waitForURL(/\/m|\/help|verify|onboarding/), p.click('button[type=submit]')]);
  if (p.url().includes('/signin/verify')) {
    await p.fill('#code', totp(secret));
    await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);
  }
}

// 1. the portal is the manufacturer side: sign-up has no distributor choice and the distributor pages are not deployed
const c = await page();
await c.goto(B + '/signup');
const su = (await c.locator('body').innerText()).toLowerCase();
check((await c.locator('a.tile').count()) === 0 && su.includes('take your products further') && !su.includes('distributor'), 'sign-up is for manufacturers only');
for (const path of ['/home', '/search', '/market', '/competitors', '/portfolio', '/requests', '/expert', '/molecule/1', '/export/open']) {
  check((await c.goto(B + path)).status() === 404, `distributor page ${path} is not deployed`);
}
// an existing distributor account is told the distributor portal is closed, and stays out of the manufacturer area
const d = await page();
await signin(d, 'demo-free@nazryx.test', process.env.DEMO_PASSWORD);
check(d.url().includes('/help') && (await d.locator('body').innerText()).includes('distributor portal is closed'), 'a distributor account is told the distributor portal is closed');
await d.goto(B + '/m'); check(d.url().includes('/help'), 'and cannot open the manufacturer area');
check((await d.goto(B + '/admin')).status() === 404, 'admin is hidden from customers');

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
await t.goto(B + '/m'); await t.waitForLoadState('networkidle');
const tm = await t.locator('nav').innerText();
check(tm.includes('My products') && tm.includes('Regulatory') && tm.includes('Admin') && !tm.includes('Search')
  && (await t.locator('main').innerText()).includes('Register these first'), 'the team works on the manufacturer side, with Admin');
await t.goto(B + '/m/market?market=TZ'); await t.waitForLoadState('networkidle');
const mkt = await t.locator('main').innerText();
check(!mkt.includes('Uganda') && mkt.includes('Add your products'), 'manufacturer market has one market switch and no empty catalogue line');
for (const tab of ['', '?tab=review', '?tab=documents', '?tab=manufacturers', '?tab=accounts', '?tab=content', '?tab=billing', '?tab=activity', '?tab=regulatory', '?tab=calls', '?tab=team']) {
  const r = await t.goto(B + '/admin' + tab); check(r.status() === 200, `admin ${tab || 'data updates'}`);
}
await t.goto(B + '/admin'); await t.waitForLoadState('networkidle');
await Promise.all([t.waitForURL(/partners\?names=1/), t.click('a:has-text("Distributors with names")')]);
const named = await t.locator('main').innerText();
check(/Ltd|Limited|Pharm/i.test(named) && named.includes('Hide names'), 'admin sees distributor names with one click');
await t.goto(B + '/admin?tab=data');
const src = await t.locator('#sources').textContent();
check(src.includes('Kazakhstan medicine register') && src.includes('Tanzania public tenders') && src.includes('Run now'), 'Admin lists the data sources with their health');
await t.goto(B + '/admin?tab=team');
const atabs = await t.locator('.tabs').allInnerTexts().then((x) => x.join(' '));
check(!atabs.includes('Claims') && !atabs.includes('Requests') && !atabs.includes('Questions'), 'Admin has no distributor tabs');
const teamTab = await t.locator('main').innerText();
check(teamTab.includes('Last sign-in') && !teamTab.includes('Last sign-in never') && teamTab.includes('last active') && teamTab.includes('changes this week'), 'Admin > Team shows last sign-in, last active and changes');
await t.goto(B + '/admin?tab=activity');
check((await t.locator('main').innerText()).includes('Everyone'), 'activity can be filtered by team member');
await t.goto(B + '/admin?tab=documents');
await t.fill('input[name=supplier_name]', 'Smoke Supplier'); await t.selectOption('form:has(input[name=supplier_name]) select[name=kind]', 'gmp');
await t.fill('input[name=expires_on]', new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10));
await t.setInputFiles('form:has(input[name=supplier_name]) input[name=file]', { name: 'smoke-gmp.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 g') });
await Promise.all([t.waitForURL(/saved=1/), t.click('button:has-text("Upload supplier document")')]);
const dtab = await t.locator('main').innerText();
check(dtab.includes('smoke-gmp.pdf'), 'supplier documents in Admin');
// the owner adds a team member who can only work on manufacturers
const memberMail = `member${Date.now()}@nazryx.test`;
await t.goto(B + '/admin?tab=team');
await t.fill('input[name=name]', 'Smoke Member'); await t.fill('input[name=email]', memberMail); await t.fill('input[name=password]', 'member-password-123');
await t.locator('form:has(input[name=password]) input[name=perm][value=manufacturers]').check();
await Promise.all([t.waitForURL(/saved=1/), t.click('button:has-text("Add team member")')]);
const mb = await page();
await mb.goto(B + '/signup?mode=signin'); await mb.fill('#email', memberMail); await mb.fill('#password', 'member-password-123');
await Promise.all([mb.waitForURL(/\/m/), mb.click('button[type=submit]')]);
await mb.goto(B + '/admin');
const mtabs = await mb.locator('.tabs').allInnerTexts().then((x) => x.join(' '));
check(mtabs.includes('Manufacturers') && !mtabs.includes('Accounts') && !mtabs.includes('Team'), 'a team member sees only the areas they were given');
check((await mb.goto(B + '/admin?tab=accounts')) && !(await mb.locator('.tabs').allInnerTexts()).join(' ').includes('Accounts'), 'other areas stay closed');
check((await mb.goto(B + '/admin?tab=manufacturers')).status() === 200 && (await mb.locator('main').innerText()).includes('Manufacturers'), 'the member works on manufacturers');
const t2 = await page();
await signin(t2, process.env.SEED_TEAM_EMAIL || 'team@nazryx.test', process.env.SEED_TEAM_PASSWORD, secret);
check(t2.url().includes('/m'), 'team signs in with a two-step code');
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
await k.setInputFiles('input[name=catalogue]', { name: 'catalogue.csv', mimeType: 'text/csv', buffer: Buffer.from('Product name,Strength\nDoxycycline,100mg capsules\nCiprofloxacin,250mg tablets') });
await Promise.all([k.waitForURL(/q=plan/), k.click('button:has-text("Continue")')]);
const planText = await k.locator('body').innerText();
check(planText.includes('3 products added, 2 matched') && planText.includes('1 product added from catalogue.csv'), 'pasted list and catalogue file are both added during sign-up');
check(planText.includes('Suggested') && planText.includes('Complete Market Entry') && planText.includes('you want registration and sales handled for you'), 'sign-up ends with a suggested plan');
await Promise.all([k.waitForURL(/\/m\?welcome/), k.locator('form:has(.pill:has-text("Suggested")) button[type=submit]').click()]);
await k.locator('button:has-text("Take the tour")').waitFor({ timeout: 15000 });   // offered after a short pause
check(true, 'after sign-up, Home offers the tour or skip');
await Promise.all([k.waitForURL(/\/m\/products/), k.click('button:has-text("Take the tour")')]);
await k.locator('[role=dialog]:has-text("Tour · 1 of 8")').waitFor({ state: 'attached', timeout: 15000 });
const tour = await k.locator('[role=dialog]').innerText();
check(tour.includes('Add your products') && (await k.locator('[data-tour="add-products"]').count()) === 1, 'the guided tour starts after sign-up, spotlighting the feature');
await k.click('button:has-text("Next: Your portfolio at a glance")');
check(await k.locator('text=Tour · 2 of 8').waitFor({ timeout: 15000 }).then(() => true, () => false), 'tour: next takes them to the next feature');
await Promise.all([k.waitForURL(/\/m$/), k.click('button:has-text("End tour")')]);
check((await k.locator('[role=dialog]:has-text("Tour ·")').count()) === 0 && (await k.locator('main').innerText()).includes('Get set up'), 'tour ends; Home shows the set-up checklist');
await k.goto(B + '/m');
check((await k.locator('main').innerText()).includes('Register these first'), 'manufacturer lands on its own home');
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
await k.fill('#competitors input[name=brands]', 'Systane, Hylo-Comod');
await k.click('#competitors button:has-text("Add")'); await k.locator('#competitors td:has-text("Systane")').waitFor({ timeout: 15000 }).catch(() => {});
check((await k.locator('#competitors').innerText()).includes('Systane') && (await k.locator('#competitors select[name=use_group]').count()) === 1,
  'a manufacturer names competitor brands for a product and picks what it competes as');
await k.goto(B + '/m');
check((await k.locator('main').innerText()).includes('Market watch'), 'market watch on the home page');
await k.goto(B + '/m/plan?want=access');
check((await k.locator('main').innerText()).includes('To unlock that') && (await k.locator('main').innerText()).includes('Compare the plans'), 'upgrade flow names the plan that unlocks it');
await k.goto(B + '/m/plan?billing=year');
const yearText = await k.locator('main').innerText();
check(yearText.includes('$1,990') && yearText.includes('/ year') && /included · each extra market \$490 a year/.test(yearText), 'plans: yearly billing at ten months, one market included, extra markets priced');
check((await k.goto(B + '/m/tenders')).status() === 200 && (await k.locator('nav').innerText()).includes('Tenders')
  && (await k.locator('main').innerText()).includes('Unlock with Basic Market Data'), 'tenders page in the menu, locked without a plan');
await k.goto(B + '/m/regulatory');
const regFree = await k.locator('main').innerText();
check(regFree.includes('Routes to registration') && regFree.includes('Local representative') && regFree.includes('Unlock with Complete Market Access'),
  'regulatory page: routes, every requirement for the market, per-product requirements locked');
await k.goto(B + '/m/products?tab=watch');
check((await k.locator('main').innerText()).includes('Unlock with Basic Market Data'), 'competitor watch is locked without a plan');
await k.goto(B + '/m/products'); await k.waitForLoadState('networkidle');
await k.setInputFiles('#add input[name=file]', { name: 'our-catalogue.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 cat') });
await Promise.all([k.waitForURL(/reading=1/), k.click('#add button:has-text("Upload")')]);
check(await k.locator('text=Our team is adding its products').waitFor({ timeout: 20000 }).then(() => true, () => false)
  && (await k.locator('#files').innerText()).includes('our-catalogue.pdf'), 'add a product: a PDF catalogue is read in the background (team fallback without a reader key)');
await k.setInputFiles('#add input[name=file]', { name: 'more.csv', mimeType: 'text/csv', buffer: Buffer.from('Generic name;Form\nAtenolol 50mg;tablets\nMetformin 500mg;tablets') });
await Promise.all([k.waitForURL(/added=2/), k.click('#add button:has-text("Upload")')]);
check((await k.locator('main').innerText()).includes('Added 2 products'), 'a CSV catalogue adds its products at once');
await k.selectOption('#files select[name=kind]', 'gmp');
await k.setInputFiles('#files input[name=file]', { name: 'site-gmp.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 gmp') });
await Promise.all([k.waitForURL(/uploaded=gmp/), k.click('#files button:has-text("Upload")')]);
await k.goto(B + '/m');
check((await k.locator('main').innerText()).includes('We are checking your GMP certificate'), 'GMP upload starts the Verified badge check');

// the team approves the company and switches the plan on; everything opens
await t.goto(B + '/admin?tab=manufacturers'); await t.waitForLoadState('networkidle');
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
await t.goto(B + '/admin?tab=billing');
await t.fill('textarea[name=payment_details]', 'Smoke Bank, account 123');
await Promise.all([t.waitForURL(/saved=1/), t.click('button:has-text("Save details")')]);
await t.fill('input[name=account]', kmail); await t.fill('input[name=text_0]', 'Smoke dossier review'); await t.fill('input[name=unit_0]', '250');
await Promise.all([t.waitForURL(/queued=1/), t.click('button:has-text("Create and send invoice")')]);
let billed = false;
for (let i = 0; i < 15 && !billed; i++) { await t.waitForTimeout(1000); await t.goto(B + '/admin?tab=billing'); billed = (await t.locator('main').innerText()).includes('USD 250.00'); }
const invHref = await t.locator('a:has-text("NZX-")').first().getAttribute('href');
const invDoc = await (await t.request.get(B + invHref)).text();
check(billed && invDoc.includes('Smoke dossier review') && invDoc.includes('Smoke Bank, account 123'), 'Admin > Billing writes an invoice with our details');
await t.goto(B + '/admin/invoice-maker'); await t.waitForLoadState('networkidle');
await t.getByLabel('Company').first().fill('Outside Buyer LLC');
await t.getByLabel('Item 1').fill('Market study, Kenya'); await t.getByLabel('Price').first().fill('1200');
await t.getByLabel('Tax % (all lines)').fill('10');
check((await t.locator('main').innerText()).includes('USD 1,320.00'), 'invoice maker totals as you type');
await t.click('button:has-text("Save")');
await t.locator('text=Saved as').waitFor({ timeout: 15000 });
const made = (await t.locator('[role=status]').innerText()).match(/Saved as (\S+?)\./)[1];
const page4 = await (await t.request.get(B + '/admin/invoice/' + encodeURIComponent(made))).text();
check(page4.includes('Outside Buyer LLC') && page4.includes('size:A4') && page4.includes('USD 1,320.00'), 'invoice maker saves an A4 invoice for a customer outside the portal');
await k.goto(B + '/m/products');
check((await k.locator('main').innerText()).includes('By therapeutic class'), 'active plan unlocks the portfolio analysis');
await k.goto(B + '/m/products');
await k.locator('a b', { hasText: 'Doxycycline' }).first().click(); await k.waitForURL(/\/m\/products\/\d+/);
await Promise.all([k.waitForURL(/saved=1/), k.click('button:has-text("Add to the tracker")')]);
check((await k.goto(B + '/m/tenders?market=TZ&show=all')).status() === 200, 'tenders page opens with a plan');
await k.goto(B + '/m/products?tab=launches');
check((await k.locator('main').innerText()).includes('Doxycycline'), 'launch tracker');
await k.goto(B + '/m/products?tab=watch'); await k.waitForLoadState('networkidle');
await Promise.all([k.waitForURL(/saved=1/), k.click('button:has-text("Watch all my products")')]);
const watchTab = await k.locator('main').innerText();
check(watchTab.includes('Molecules you watch') && watchTab.includes('Doxycycline') && !watchTab.includes('Alpha Pharma'), 'competitor watch: follow your molecules, companies stay anonymous');
await t.goto(B + '/admin?tab=regulatory&rc=TZ'); await t.waitForLoadState('networkidle');
await t.setInputFiles('form:has(input[name=file][multiple]) input[name=file]', { name: 'tz-guideline.txt', mimeType: 'text/plain', buffer: Buffer.from('Labels in English.') });
await Promise.all([t.waitForURL(/saved=1/), t.click('button:has-text("Upload to Tanzania")')]);
check((await t.locator('main').innerText()).includes('tz-guideline'), 'team uploads regulatory documents for a country');
const addReq = t.locator('form:has(button:has-text("Add to Tanzania"))');
await addReq.locator('select[name=applies]').selectOption('molecule'); await addReq.locator('input[name=match]').fill('doxycycline');
await addReq.locator('input[name=title]').fill('Smoke molecule rule'); await addReq.locator('textarea[name=body]').fill('A rule only for this molecule.');
await Promise.all([t.waitForURL(/saved=1/), addReq.locator('button').click()]);
await k.goto(B + '/m/regulatory?market=TZ');
const regPaid = await k.locator('main').innerText();
check(regPaid.includes('Smoke molecule rule') && regPaid.includes('Bioequivalence'), 'regulatory page: requirements for each product, set by the team');
await t.goto(acctUrl); await t.waitForLoadState('networkidle');
check((await t.locator('#mfiles').innerText()).includes('site-gmp.pdf'), 'team sees the manufacturer GMP upload');
await Promise.all([t.waitForURL(/saved=1/), t.click('button:has-text("Mark verified")')]);
await k.goto(B + '/m/report?market=TZ');
check((await k.locator('body').innerText()).includes('Verified manufacturer'), 'verified badge on the market read');
await k.goto(B + '/m/report?market=TZ');
check((await k.locator('body').innerText()).includes('Your portfolio against it'), 'market read to download');
await k.goto(B + '/m/market?market=TZ');
check((await k.locator('main').innerText()).includes('Where registered products are made'), 'market page for the manufacturer');
await k.goto(B + '/m/market?market=KE');
check((await k.locator('main').innerText()).includes('Managed by Nazryx'), 'markets without data show as managed by Nazryx');
await k.goto(B + '/m/products');
await Promise.all([k.waitForLoadState('networkidle'), k.click('form[aria-label=Market] button:has-text("Kenya")')]);
check((await k.locator('main').innerText()).includes('Your catalogue against Kenya'), 'the market switch changes the market across the portal');
await k.goto(B + '/m/market');
check((await k.locator('main').innerText()).includes('Kenya'), 'the chosen market carries over to other pages');
await k.click('form[aria-label=Market] button:has-text("Tanzania")'); await k.waitForLoadState('networkidle');
await k.goto(B + '/m/partners?class=' + encodeURIComponent('Anti-infective Medicines'));
const kpart = await k.locator('main').innerText();
check(/Distributor [0-9A-F]{8}/.test(kpart) && /Open to \d+ of your \d+ molecules/.test(kpart) && !kpart.includes('Alpha Pharma'), 'partners show codes and how open each is to you');
await Promise.all([k.waitForURL(/\/m\/partners\/intro\?code=/), k.locator('a:has-text("Request introduction")').first().click()]);
await k.locator('input[name=scope][value=all]').check(); await k.selectOption('#partner', 'exclusive');
await Promise.all([k.waitForURL(/\/m\/engagements\/\d+\?new=1/), k.click('button:has-text("Send to our team")')]);
check((await k.locator('main').innerText()).includes('the entire portfolio'), 'introduction form: whole portfolio, specific products or our choice');
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
await k.goto(B + '/m/call'); await k.waitForLoadState('networkidle');
await k.selectOption('#topic', 'plan'); await k.fill('#note', 'Smoke: adding Kazakhstan');
await Promise.all([k.waitForURL(/booked=1/), k.locator('button[name=starts_at]').first().click()]);
check((await k.locator('main').innerText()).includes('Your calls'), 'book a call: pick a time, it shows under your calls');
await t.goto(B + '/admin?tab=calls');
check((await t.locator('main').innerText()).includes('Smoke Generics'), 'the team sees the booked call in Admin');
await k.goto(B + '/m');
check((await k.locator('main').innerText()).includes('Your call:'), 'the next call shows on Home');

// 4. phone width: no sideways scrolling
const mk = await page(375);
await mk.goto(B + '/signup?mode=signin'); await mk.fill('#email', kmail); await mk.fill('#password', 'smoke-password-123');
await Promise.all([mk.waitForURL(/\/m(\?|$)/), mk.click('button[type=submit]')]);
for (const path of ['/m', '/m/products', '/m/products?tab=watch', '/m/regulatory', '/m/market', '/m/partners', '/m/call', '/m/plan', '/settings', '/help']) {
  await mk.goto(B + path);
  check(await mk.evaluate(() => document.documentElement.scrollWidth) <= 380, `no sideways scroll at 375px on ${path}`);
}

const m2 = await page(375);
for (const path of ['/signup', '/signup?mode=signin']) {
  await m2.goto(B + path);
  check(await m2.evaluate(() => document.documentElement.scrollWidth) <= 380, `no sideways scroll at 375px on ${path}`);
}

await browser.close();
if (failures.length) { console.log('\nFAILED:\n' + failures.join('\n')); process.exit(1); }
console.log('\nall smoke checks passed');
