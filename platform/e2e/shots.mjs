// Screenshots of a few pages at several widths. Usage: BASE=... DEMO_PASSWORD=... SEED_TEAM_PASSWORD=... OUT=dir node shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const B = process.env.BASE || 'http://localhost:3003', OUT = process.env.OUT || '/tmp/shots'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
async function shoot(email, pw, pages, widths, tag) {
  for (const width of widths) {
    const c = await browser.newContext({ viewport: { width, height: width < 600 ? 740 : 900 } });
    if (process.env.COLLAPSED) await c.addCookies([{ name: 'nzx_nav', value: 'collapsed', url: B }]);
    const p = await c.newPage(); await p.goto(B + '/signup?mode=signin'); await p.fill('#email', email); await p.fill('#password', pw);
    await Promise.all([p.waitForURL(/\/m|\/d|admin/), p.click('button[type=submit]')]);
    for (const path of pages) {
      await p.goto(B + path, { waitUntil: 'load' }); await p.waitForTimeout(400);
      if (process.env.DRAWER && width < 900) { await p.click('#menu-button'); await p.waitForTimeout(350); }
      await p.screenshot({ path: `${OUT}/${tag}_${path.replace(/[^a-z0-9]+/gi, '_')}_${width}${process.env.COLLAPSED ? '_rail' : ''}${process.env.DRAWER ? '_drawer' : ''}.png`, fullPage: !process.env.FOLD });
    }
    await c.close();
  }
}
await shoot('demo-maker@nazryx.test', process.env.DEMO_PASSWORD, (process.env.PAGES || '/m,/m/projects,/m/market').split(','), (process.env.WIDTHS || '1280,1024,375').split(',').map(Number), 'maker');
if (process.env.TEAM_PAGES) await shoot(process.env.SEED_TEAM_EMAIL || 'team@nazryx.test', process.env.SEED_TEAM_PASSWORD, process.env.TEAM_PAGES.split(','), (process.env.WIDTHS || '1280,375').split(',').map(Number), 'team');
await browser.close();
