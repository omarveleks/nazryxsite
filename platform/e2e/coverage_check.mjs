// Coverage page and confidence chips.
import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ok = (c, m) => { if (!c) { console.log('✗ ' + m); process.exitCode = 1; } else console.log('✓ ' + m); };
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);
const r = await p.goto(B + '/m/coverage?market=TZ'); ok(r.status() === 200, 'coverage page opens');
const t = await p.locator('main').innerText();
ok(/Register/.test(t) && /Prices/.test(t) && /Tenders/.test(t) && /Regulatory/.test(t), 'coverage page has every section');
ok(/Deep|Fair|Thin/.test(t), 'depth chips shown');
await p.goto(B + '/m/market?market=TZ'); ok(/How we read Tanzania/.test(await p.locator('main').innerText()), 'market page links to coverage');
await p.goto(B + '/m/partners?market=TZ'); const pt = await p.locator('main').innerText();
ok(!/Distributor [A-F0-9]{8}/.test(pt) || /Complete Market Access/.test(pt), 'partners: names or an explanation of codes');
await br.close();
