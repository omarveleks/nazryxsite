// The marketplace: a distributor signs up free, posts a need; the demo manufacturer sees it on the board and raises a hand;
// the distributor gets the lead, replies; the manufacturer sees the message; the service marketplace books onto a project;
// the admin verifies the distributor.
// Run against a started web app, with the team account's two-step sign-in reset (delete from user_totp, as the smoke fixture does):
// BASE=http://localhost:3003 DEMO_PASSWORD=... SEED_TEAM_PASSWORD=... node market_check.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:3003';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const stamp = Date.now().toString(36);
const distEmail = `dist-${stamp}@example.com`;
const molecule = `Amoxicillin`;

// --- distributor signs up, fills the profile, posts a need
const d = await br.newPage({ viewport: { width: 1280, height: 900 } });
await d.goto(B + '/signup?as=distributor');
const page1 = await d.locator('body').innerText();
ok(page1.includes('Distributor or importer') && page1.includes('Meet the manufacturers'), 'sign-up offers the distributor account and its own pitch');
await d.fill('#name', 'Dist Tester'); await d.fill('#email', distEmail); await d.fill('#password', 'distributor-pass-1');
await Promise.all([d.waitForURL(/\/d\/onboarding/), d.click('button[type=submit]')]);
await d.fill('#company_name', `Testco Pharma ${stamp}`); await d.selectOption('#country', 'KE'); await d.check('input[name=markets][value=KE]'); await d.check('input[name=markets][value=TZ]');
await Promise.all([d.waitForURL(/\/d\/needs\?welcome=1/), d.click('button[type=submit]')]);
ok(true, 'distributor onboarding lands on the needs page');
await d.fill('#molecule_text', molecule); await d.selectOption('#country', 'KE'); await d.fill('#quantity', '100,000 tablets'); await d.fill('#note', 'Blister packs, registered in Kenya.');
await Promise.all([d.waitForURL(/\/d\/needs\/\d+\?saved=1/), d.click('#new button[type=submit]')]);
const needId = Number(d.url().match(/needs\/(\d+)/)[1]);
ok(needId > 0, 'a need is posted');
await d.goto(B + '/d');
const home = await d.locator('body').innerText();
ok(home.includes(`Testco Pharma ${stamp}`) && home.includes(molecule) && home.includes('Free account'), 'the distributor home shows the company and the need');
ok(!home.includes('Opportunities') && home.includes('Manufacturers'), 'the distributor sees its own navigation, not the manufacturer one');
const r403 = await d.goto(B + '/m/market');
ok(d.url().startsWith(B + '/d'), 'a manufacturer page sends the distributor to its own home');

// --- manufacturer sees the need and raises a hand
const m = await br.newPage({ viewport: { width: 1280, height: 900 } });
await m.goto(B + '/signup?mode=signin'); await m.fill('#email', 'demo-maker@nazryx.test'); await m.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([m.waitForURL(/\/m/), m.click('button[type=submit]')]);
await m.goto(B + '/m/rfq');
const card = m.locator(`#need-${needId}`);
ok((await card.count()) === 1, 'the need is on the manufacturer request board');
const cardText = await card.innerText();
ok(cardText.includes('Kenya') && cardText.includes('100,000 tablets') && cardText.includes('Distributor') && !cardText.includes(distEmail), 'the card shows market and quantity, never the distributor email');
await card.locator('textarea').fill('We make Amoxicillin 500 mg capsules, registered in Kenya, 6 weeks lead time.');
await Promise.all([m.waitForURL(/\/m\/threads\/\d+/), card.locator('button[type=submit]').click()]);
const threadId = Number(m.url().match(/threads\/(\d+)/)[1]);
const mt = await m.locator('main').innerText();
ok(threadId > 0 && mt.includes('6 weeks lead time') && mt.includes(`Testco Pharma ${stamp}`), 'raising a hand opens a conversation showing the distributor company');
await m.goto(B + '/m/rfq');
ok((await m.locator(`#need-${needId}`).innerText()).includes('Open the conversation'), 'the board remembers the hand raised');

// --- distributor gets the lead and replies
await d.goto(B + '/d');
const home2 = await d.locator('body').innerText();
ok(home2.includes('can supply this'), 'the distributor home shows the hand up');
await d.goto(B + `/d/threads/${threadId}`);
const dt = await d.locator('main').innerText();
ok(dt.includes('6 weeks lead time') && !dt.includes('demo-maker@'), 'the distributor reads the message without seeing an email');
await d.fill('textarea[name=body]', 'Please send the CPP and a sample.');
await d.click('button:has-text("Send")', { noWaitAfter: true });
await d.locator('text=Please send the CPP').first().waitFor({ timeout: 20000 }).catch(() => {});
ok((await d.locator('main').innerText()).includes('Please send the CPP'), 'the distributor reply is posted');
await m.goto(B + '/m/threads');
const ml = await m.locator('main').innerText();
ok(ml.includes(`Testco Pharma ${stamp}`) && ml.includes('New'), 'the manufacturer sees the conversation as new');
await m.goto(B + '/m/inbox');
ok((await m.locator('main').innerText()).includes(`Testco Pharma ${stamp}`), 'the manufacturer inbox carries the message');

// --- manufacturer directory and contact
await d.goto(B + '/d/makers');
const makers = await d.locator('main').innerText();
ok(makers.includes('Manufacturers') && (makers.includes('Verified') || makers.includes('No public manufacturer page')), 'the manufacturer directory opens');
const first = d.locator('a[href^="/d/makers/"]').first();
if (await first.count()) {
  await Promise.all([d.waitForURL(/\/d\/makers\/[^/]+$/), first.click()]);
  await d.fill('textarea[name=body]', 'We are looking for antibiotics for Kenya.');
  await Promise.all([d.waitForURL(/\/d\/threads\/\d+\?saved=1/), d.click('button:has-text("Send")')]);
  ok(true, 'a distributor can write to a manufacturer with a public page');
}

// --- service marketplace books onto a project
await m.goto(B + '/m/projects');
const pl = m.locator('a[href^="/m/projects/"]').first();
if (await pl.count()) await Promise.all([m.waitForURL(/\/m\/projects\/\d+/), pl.click()]);
else { await m.selectOption('select[name=product_id]', { index: 1 }); await Promise.all([m.waitForURL(/\/m\/projects\/\d+/), m.click('button:has-text("Start")')]); }
{
  const pid = Number(m.url().match(/projects\/(\d+)/)[1]);
  await m.goto(B + `/m/marketplace?project=${pid}`);
  const mk = await m.locator('main').innerText();
  ok(mk.includes('Market read') && mk.includes('Dossier gap check') && mk.includes('Current stage'), 'the marketplace lists services by stage and marks the project stage');
  const form = m.locator('form:has(input[name=code][value=market_read])');
  if (await form.count()) {
    await form.locator('button').click({ noWaitAfter: true });
    await m.waitForURL(/\/m\/engagements\/\d+/, { timeout: 30000 }).catch(() => {});
    ok(/\/m\/engagements\/\d+/.test(m.url()), 'booking a service opens an engagement on the project');
  } else ok(mk.includes('Booked'), 'the market read is already booked on this project');
  await m.goto(B + `/m/marketplace?project=${pid}`);
  ok((await m.locator('main').innerText()).includes('Booked'), 'the marketplace shows the booking');
}

// --- admin verifies the distributor
{
  const a = await br.newPage();
  await a.goto(B + '/signup?mode=signin'); await a.fill('#email', process.env.SEED_TEAM_EMAIL || 'team@nazryx.test'); await a.fill('#password', process.env.SEED_TEAM_PASSWORD);
  await Promise.all([a.waitForURL(/\/(m|admin)/), a.click('button[type=submit]')]);
  await a.goto(B + '/admin/marketplace');
  const at = await a.locator('main').innerText();
  ok(at.includes(`Testco Pharma ${stamp}`) && at.includes(molecule) && at.includes('Service catalogue'), 'the admin marketplace lists the distributor, the need and the catalogue');
  const row = a.locator(`tr:has-text("Testco Pharma ${stamp}")`);
  await Promise.all([a.waitForURL(/saved=1/), row.locator('button:has-text("Verify")').click()]);
  await m.goto(B + '/m/rfq');
  ok((await m.locator(`#need-${needId}`).innerText()).includes('Verified distributor'), 'a verified distributor is marked on the board');
  await a.goto(B + `/m/threads/${threadId}`);
  await a.fill('textarea[name=body]', 'Nazryx here: we can arrange the sample shipment.');
  await a.click('button:has-text("Send")', { noWaitAfter: true });
  await a.locator('text=Nazryx here').first().waitFor({ timeout: 20000 }).catch(() => {});
  await d.goto(B + `/d/threads/${threadId}`);
  ok((await d.locator('main').innerText()).includes('Nazryx here'), 'the team can step into the conversation and the distributor sees it');
  await a.close();
}
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
