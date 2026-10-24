import { chromium } from 'playwright';
const B = process.env.BASE || 'http://localhost:3003', SHOTS = process.env.SHOTS;
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
const ok = (c, m) => { if (!c) { console.log('✗ ' + m); process.exitCode = 1; } else console.log('✓ ' + m); };
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'team@nazryx.test'); await p.fill('#password', process.env.SEED_TEAM_PASSWORD);
await Promise.all([p.waitForURL(/\/(m|admin)/), p.click('button[type=submit]')]);
const ID = process.env.ACCOUNT_ID;
const href = '/admin/accounts/' + ID;
await p.goto(B + href);
ok(await p.locator('button', { hasText: 'View as' }).count() === 1, 'account page has a View as button');
await Promise.all([p.waitForURL(/\/m/), p.locator('button', { hasText: 'View as' }).click()]);
ok(await p.locator('text=Read-only: nothing here can be changed').count() === 1, 'banner shows while viewing');
const email = await p.locator('[role=status] b').first().textContent();
ok(email && !email.includes('team@'), `viewing the member (${email}), not the team account`);
if (SHOTS) await p.screenshot({ path: `${SHOTS}/viewas-m.png` });
await p.goto(B + '/m/products'); ok((await p.title()) && (await p.locator('text=Read-only').count()) === 1, 'member pages load in the view');
// any change is refused: a form post, a server action
const post = await p.request.post(B + '/m/products', { form: { x: '1' } });
ok(post.status() === 403, `a change while viewing is refused (${post.status()})`);
const forms = await p.locator('form button[type=submit]').count();
if (forms) {
  const [resp] = await Promise.all([p.waitForResponse((r) => r.request().method() === 'POST', { timeout: 10000 }).catch(() => null),
    p.locator('form button[type=submit]').first().click().catch(() => null)]);
  ok(!resp || resp.status() === 403, `a button press while viewing is refused (${resp ? resp.status() : 'no request'})`);
}
const adm = await p.goto(B + '/admin'); ok(adm.status() === 404, 'Admin is not reachable while viewing (as the member)');
await p.goto(B + '/m');
await Promise.all([p.waitForURL(/\/admin\/accounts\//), p.locator('a', { hasText: 'Exit view' }).click()]);
ok(p.url().includes(href), 'Exit goes back to the account in Admin');
ok(await p.locator('text=Read-only: nothing here can be changed').count() === 0, 'banner gone after exit');
const back = await p.goto(B + '/admin?tab=activity'); ok(back.status() === 200, 'Admin works again after exit');
ok(await p.locator('text=Viewed the portal of').count() > 0, 'the view is in the activity log');
await br.close();
