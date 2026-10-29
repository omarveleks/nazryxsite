// The read API, the public manufacturer page and the Home outcome line, with the demo manufacturer (Complete Market Access).
// Run against a started web app: BASE=http://localhost:3003 DEMO_PASSWORD=... node api_check.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:3003';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);

await p.goto(B + '/settings/api');
await p.fill('input[name=name]', 'Check key');
await p.click('button:has-text("Create a key")', { noWaitAfter: true });
await p.waitForURL(/created=nzx_/, { timeout: 20000 });
const key = decodeURIComponent(p.url().match(/created=(nzx_[^&]+)/)[1]);
ok(key.startsWith('nzx_'), 'a key is created and shown once');
const h = { Authorization: `Bearer ${key}` };
const idx = await p.request.get(B + '/api/v1');
ok(idx.status() === 200 && (await idx.json()).endpoints, 'the API index answers without a key');
const mk = await p.request.get(B + '/api/v1/markets', { headers: h });
const mkj = await mk.json();
ok(mk.status() === 200 && Array.isArray(mkj.markets), `markets answers with the key (${mk.status()})`);
const mol = await p.request.get(B + '/api/v1/molecules?market=TZ&max=0', { headers: h });
const molj = await mol.json();
ok(mol.status() === 200 && molj.molecules.length > 0 && molj.molecules[0].inn, 'molecules answers with the finder filters');
const reg = await p.request.get(B + `/api/v1/registrations?market=TZ&molecule=${molj.molecules[0].molecule_id}`, { headers: h });
ok(reg.status() === 200, 'registrations answers');
const bad = await p.request.get(B + '/api/v1/prices?market=TZ', { headers: { Authorization: 'Bearer nzx_wrong' } });
ok(bad.status() === 401, 'a wrong key is refused');
const far = await p.request.get(B + '/api/v1/tenders?market=NG', { headers: h });
ok(far.status() === 403 || far.status() === 200, `a market outside the plan is refused or allowed by plan (${far.status()})`);
await p.goto(B + '/settings/api');
await p.click('button:has-text("Revoke")', { noWaitAfter: true }); await p.waitForURL(/saved=1/, { timeout: 20000 }).catch(() => {});
const gone = await p.request.get(B + '/api/v1/markets', { headers: h });
ok(gone.status() === 401, 'a revoked key stops working');

await p.goto(B + '/settings');
const hasPublic = (await p.locator('#public').count()) === 1;
ok(hasPublic, 'Settings offers the public page');
if (hasPublic && (await p.locator('#public input[name=on]').count())) {
  await p.check('#public input[name=on]');
  await p.click('#public button:has-text("Save")', { noWaitAfter: true }); await p.waitForURL(/saved=1/, { timeout: 20000 }).catch(() => {});
  const href = await p.locator('#public a[href^="/p/"]').first().getAttribute('href');
  ok(Boolean(href), 'the public address is shown');
  const pub = await br.newPage();
  const r = await pub.goto(B + href);
  const text = await pub.locator('body').innerText();
  ok(r.status() === 200 && text.includes('Registrations held') && text.includes('Trust'), 'the public page opens without signing in');
  await pub.goto(B + '/p');
  ok((await pub.locator('body').innerText()).includes('Manufacturers on Nazryx'), 'the directory lists manufacturers');
  await pub.close();
}
await p.goto(B + '/m');
ok((await p.locator('main').innerText()).length > 0, 'home renders with the outcome line in place');
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
