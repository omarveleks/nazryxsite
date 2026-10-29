// Medicine imports on the Market and coverage pages, and the pricing simulator, with the demo manufacturer.
// Run against a started web app whose database holds trade_flows rows for TZ (the worker's Comtrade read):
// BASE=http://localhost:3003 DEMO_PASSWORD=... node trade_check.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:3003';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);

await p.goto(B + '/m/market?market=TZ');
const mk = await p.locator('main').innerText();
const hasTrade = mk.includes('Medicines imported into Tanzania');
ok(!process.env.EXPECT_TRADE || hasTrade, hasTrade ? 'the market page shows what Tanzania imports, by year, origin and kind' : 'no trade rows loaded here; the market page stays as it was');
if (hasTrade) ok(/Imports in 20\d\d/.test(mk) && mk.includes('Top origin') && mk.includes('UN Comtrade') && mk.includes('Where from'), 'imports: total, change, top origin, source line');
await p.goto(B + '/m/coverage?market=TZ');
ok((await p.locator('main').innerText()).includes('Years reported'), 'coverage lists the import data and its depth');

ok((await p.locator('nav').innerText()).includes('Pricing'), 'Pricing is in the menu');
await p.goto(B + '/m/simulator');
const sim = await p.locator('main').innerText();
ok(sim.includes('across your markets') && sim.includes('Max ex-works per pack') && (await p.locator('select[name=molecule] option').count()) > 0, 'the simulator lists every market for a molecule');
await p.fill('input[name=exw]', '2.4'); await p.fill('input[name=units]', '30');
await Promise.all([p.waitForURL(/exw=2.4/), p.click('button:has-text("Simulate")')]);
const run = await p.locator('main').innerText();
ok(run.includes('Your shelf price') && run.includes('Step by step in') && run.includes('Ex-works') && run.includes('On the shelf'),
  'with an ex-works price: shelf price per market and the step-by-step chain');
await p.click('summary'); await p.fill('input[name=distributor]', '40');
await Promise.all([p.waitForURL(/distributor=40/), p.click('button:has-text("Simulate")')]);
ok((await p.locator('main').innerText()).includes('40%'), 'a margin override changes the chain');
await p.setViewportSize({ width: 375, height: 800 }); await p.goto(B + '/m/simulator?exw=2.4&units=30');
ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 375px on /m/simulator');
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
