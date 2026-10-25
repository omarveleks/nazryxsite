// Admin > Usage: a customer's pages show up for the team, day by day; the team viewing an account (View as) does not count.
import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3003', SHOTS = process.env.SHOTS;
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ok = (c, m) => { if (!c) { console.log('✗ ' + m); process.exitCode = 1; } else console.log('✓ ' + m); };
const signIn = async (email, pw) => {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  await p.goto(B + '/signup?mode=signin'); await p.fill('#email', email); await p.fill('#password', pw);
  await Promise.all([p.waitForURL(/\/(m|admin)/), p.click('button[type=submit]')]);
  return p;
};
const counts = async (page, email) => {           // the numbers in an account's row of the Usage table
  const html = await (await page.request.get(B + '/admin?tab=usage')).text();
  const row = html.match(new RegExp(`${email.replace(/[.@]/g, '\\$&')}[\\s\\S]*?</tr>`))?.[0] ?? '';
  return (row.match(/<td class="r num">([^<]*)<\/td>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, ''));
};

const c = await signIn('demo-maker@nazryx.test', process.env.DEMO_PASSWORD);
for (const path of ['/m', '/m/products', '/m/market']) { await c.goto(B + path); await c.waitForTimeout(300); }

const t = await signIn('team@nazryx.test', process.env.SEED_TEAM_PASSWORD);
await t.goto(B + '/admin?tab=usage');
ok(await t.locator('h2', { hasText: 'Customers here each day' }).count() === 1, 'Usage page opens');
const row = t.locator('tr', { hasText: 'demo-maker@nazryx.test' });
ok(await row.count() === 1, 'the customer is listed');
const cells = await row.locator('td').allTextContents();
ok(Number(cells[5]) >= 3, `its pages are counted (${cells[5]})`);
ok(/My products|Market|Home/.test(cells[6]), `its most used pages are named (${cells[6]})`);
ok(/ago|now/.test(await t.locator('.tile', { hasText: 'Last customer here' }).textContent()), 'the last customer here is shown with when');
if (SHOTS) await t.screenshot({ path: `${SHOTS}/usage-tab.png`, fullPage: true });

await row.locator('a').first().click(); await t.waitForURL(/\/admin\/accounts\//);
ok(await t.locator('#usage h3', { hasText: 'Day by day' }).count() === 1, 'the account page shows day by day');
ok(await t.locator('#usage td', { hasText: 'My products' }).count() > 0, 'the day row names the pages used');
if (SHOTS) await t.locator('#usage').screenshot({ path: `${SHOTS}/usage-account.png` });

// View as: the team's pages are not the customer's
const before = await counts(t, 'demo-maker@nazryx.test');
await t.goto(B + '/admin?tab=accounts'); await t.locator('tr', { hasText: 'demo-maker@nazryx.test' }).locator('a').first().click();
await Promise.all([t.waitForURL(/\/m/), t.locator('button', { hasText: 'View as' }).click()]);
for (const path of ['/m/products', '/m/market']) await t.goto(B + path);
await t.goto(B + '/view-as/exit'); await t.waitForURL(/\/admin/);
const after = await counts(t, 'demo-maker@nazryx.test');
ok(before.length > 0 && JSON.stringify(before) === JSON.stringify(after), `viewing an account does not count as its use (${before} → ${after})`);

await t.setViewportSize({ width: 375, height: 800 }); await t.goto(B + '/admin?tab=usage');
const sw = await t.evaluate(() => document.documentElement.scrollWidth);
ok(sw <= 375, `no sideways scroll at 375px (${sw})`);
if (SHOTS) await t.screenshot({ path: `${SHOTS}/usage-375.png`, fullPage: true });
await br.close();
