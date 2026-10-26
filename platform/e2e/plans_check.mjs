// Plans: Basic one market, Access four; markets Access still includes are added free, the fifth is priced.
import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3003', SHOTS = process.env.SHOTS;
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ok = (c, m) => { if (!c) { console.log('✗ ' + m); process.exitCode = 1; } else console.log('✓ ' + m); };
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);
await p.goto(B + '/m/plan');
const t = await p.locator('main').innerText();
ok(t.includes('$499') && t.includes('$1,999'), 'plan prices: $499 and $1,999 a month');
ok(/includes 4 markets: add 3 more at no extra cost/.test(t), 'Access with one market: three more included');
if (SHOTS) await p.screenshot({ path: `${SHOTS}/plans.png`, fullPage: true });
for (const m of ['TZ', 'KZ', 'UZ']) {
  await p.goto(B + `/m/add-market?market=${m}`);
  ok((await p.locator('main').innerText()).includes('Included in your plan'), `${m}: offered as included`);
  await Promise.all([p.waitForURL(/\/m\/market/), p.locator('main form button[type=submit]').click()]);
}
await p.goto(B + '/m/add-market?market=KG');
const kg = await p.locator('main').innerText();
ok(kg.includes('$499') && !kg.includes('Included in your plan'), 'the fifth market is priced at $499 a month');
await br.close();
