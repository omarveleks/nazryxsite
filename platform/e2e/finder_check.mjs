// The opportunity finder, a molecule's page in a market and the distributor pipeline, with the demo manufacturer.
// Run against a started web app: BASE=http://localhost:3003 DEMO_PASSWORD=... node finder_check.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:3003';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);
ok((await p.locator('nav').innerText()).includes('Opportunities'), 'Opportunities is in the menu');

await p.goto(B + '/m/finder?market=TZ');
const list = await p.locator('main').innerText();
ok(/\d+ of \d+ molecules/.test(list) && list.includes('Saved searches'), 'the finder lists the market\'s molecules');
await p.selectOption('select[name=max]', '0'); await p.check('input[name=essential]');
await Promise.all([p.waitForURL(/max=0/), p.click('button:has-text("Find")')]);
const filtered = await p.locator('main').innerText();
ok(filtered.includes('match') && (await p.locator('table.tbl tbody tr').count()) > 0, 'filters narrow the list to open essential molecules');
const canSave = (await p.locator('button:has-text("Save and alert me")').count()) === 1;
if (canSave) {
  await p.fill('input[name=name]', 'Open essentials');
  await Promise.all([p.waitForURL(/saved=1/), p.click('button:has-text("Save and alert me")')]);
  ok((await p.locator('#saved').innerText()).includes('Open essentials'), 'a search is saved for hourly alerts');
  await p.locator('button[aria-label="Remove Open essentials"]').click();
  await p.locator('button[aria-label="Remove Open essentials"]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  ok(!(await p.locator('#saved').innerText()).includes('Open essentials'), 'and removed');
} else ok(filtered.includes('Basic Market Data'), 'without a plan, saving is offered with the plan');
const csv = await p.request.get(B + '/m/export?what=finder&market=TZ&max=0');
ok([200, 403].includes(csv.status()), `finder export answers by plan (${csv.status()})`);

await p.locator('table.tbl tbody tr a').first().click(); await p.waitForURL(/\/m\/molecules\/\d+/);
const mol = await p.locator('main').innerText();
ok(mol.includes('Companies selling it') && mol.includes('Across your markets') && mol.includes('Registered products') && mol.includes('Distributors'),
  'the molecule page shows competition, price, products, tenders, distributors and the other markets');
ok((await p.locator('button:has-text("Watch")').count()) + (await p.locator('button:has-text("Watching")').count()) === 1, 'watch from the molecule page');

await p.goto(B + '/m/partners?market=TZ');
ok((await p.locator('[role=tab]:has-text("Your pipeline")').count()) === 1, 'partners has a pipeline tab');
const shortlist = p.locator('button:has-text("Shortlist")').first();
if (await shortlist.count()) {
  await Promise.all([p.waitForURL(/saved=1/), shortlist.click()]);
  await p.goto(B + '/m/partners?market=TZ&tab=pipeline');
  const pipe = await p.locator('main').innerText();
  ok(pipe.includes('Shortlisted') && pipe.includes('Open to yours'), 'a shortlisted distributor appears in the pipeline, compared on size and openness');
  await p.selectOption('select[name=stage]', 'in_talks'); await p.fill('input[name=note]', 'Call booked');
  await Promise.all([p.waitForURL(/saved=1/), p.click('button:has-text("Move")')]);
  const moved = await p.locator('main').innerText();
  ok(moved.includes('In talks') && moved.includes('Call booked'), 'moved to a stage with a note');
  await p.locator('button[aria-label^="Remove"]').first().click();
  await p.locator('text=Nobody shortlisted yet').waitFor({ timeout: 15000 }).catch(() => {});
  ok((await p.locator('main').innerText()).includes('Nobody shortlisted yet'), 'and removed from the pipeline');
} else ok((await p.locator('main').innerText()).includes('Basic Market Data'), 'without a plan, the pipeline is offered with the plan');
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
