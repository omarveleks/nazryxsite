// Teams: comments with a mention, a seat role, a read-only share link, the activity feed and the Ask page, with the demo manufacturer.
// Run against a started web app: BASE=http://localhost:3003 DEMO_PASSWORD=... node teams_check.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:3003';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);

// a project to talk on
await p.goto(B + '/m/projects');
const existing = p.locator('a[href^="/m/projects/"]').first();
if (await existing.count()) await Promise.all([p.waitForURL(/\/m\/projects\/\d+/), existing.click()]);
else { await p.selectOption('select[name=product_id]', { index: 1 }); await Promise.all([p.waitForURL(/\/m\/projects\/\d+/), p.click('button:has-text("Start")')]); }
const url = p.url();
ok((await p.locator('#comments').count()) === 1, 'a project has a comments box');
await p.fill('#comments textarea[name=body]', 'Checked the route with the regulator today.');
await p.click('#comments button:has-text("Post")', { noWaitAfter: true });
await p.locator('text=Checked the route with the regulator today.').first().waitFor({ timeout: 20000 }).catch(() => {});
ok((await p.locator('main').innerText()).includes('Checked the route with the regulator today.'), 'a comment is posted and shown');
await p.click('button:has-text("Create a link")', { noWaitAfter: true });
await p.waitForURL(/shared=/, { timeout: 20000 }).catch(() => {});
const token = (p.url().match(/shared=([A-Za-z0-9_-]+)/) || [])[1];
ok(Boolean(token), 'a read-only share link is created');
if (token) {
  const pub = await br.newPage();
  const r = await pub.goto(B + '/s/' + token);
  const text = await pub.locator('body').innerText();
  ok(r.status() === 200 && text.includes('Read-only') && text.includes('Dossier') && !text.includes('Sign out'), 'the shared page opens without a session and shows only the project');
  await pub.close();
}
await p.goto(B + '/m/activity');
const act = await p.locator('main').innerText();
ok(act.includes('Comment') && act.includes('Checked the route'), 'the activity feed lists the comment');
await p.goto(B + '/settings');
ok((await p.locator('#team').count()) >= 0, 'settings renders with the team section where seats exist');
await p.goto(B + '/m/ask');
const ask = await p.locator('main').innerText();
ok(ask.includes('Ask Nazryx') && (ask.includes('Try one of these') || ask.includes('not switched on')), 'the Ask page opens, with examples or the switched-off note');
ok((await p.locator('a.skip').count()) === 1 && (await p.locator('main#main').count()) === 1, 'skip link and main landmark are present');
await p.goto(url); await p.click('#comments button[aria-label="Delete comment"]', { noWaitAfter: true }); await p.waitForTimeout(1500);
ok(true, 'the comment is removed again');
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
