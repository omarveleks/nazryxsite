// Inbox, watches, exports.
import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3003';
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ok = (c, m) => { if (!c) { console.log('✗ ' + m); process.exitCode = 1; } else console.log('✓ ' + m); };
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);
ok((await p.locator('nav').innerText()).includes('Inbox'), 'Inbox is in the menu');
await p.goto(B + '/m/inbox'); ok((await p.locator('main').innerText()).includes('Watches'), 'inbox page opens with watches');
await p.fill('input[name=term]', 'insulin'); await Promise.all([p.waitForURL(/saved=1/), p.click('button:has-text("Watch")')]);
ok((await p.locator('main').innerText()).includes('insulin'), 'a tender keyword is watched');
await p.locator('button[aria-label="Stop watching insulin"]').click();
await p.locator('button[aria-label="Stop watching insulin"]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
ok(!(await p.locator('#watches').innerText()).includes('insulin'), 'and unwatched');
for (const w of ['products', 'grid', 'tenders']) {
  const r = await p.request.get(B + `/m/export?what=${w}&market=TZ`);
  const t = await r.text();
  ok(r.status() === 200 && r.headers()['content-type'].includes('text/csv') && t.startsWith('\uFEFF') && t.split('\n').length >= 1, `${w} export is a CSV (${r.status()}, ${t.split('\n').length} lines)`);
}
const pr = await p.request.get(B + '/m/export?what=partners&market=TZ');
ok(pr.status() === 200 || pr.status() === 403, `partners export answers by plan (${pr.status()})`);
await br.close();
