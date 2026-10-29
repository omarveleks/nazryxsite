// Sign in by email link: the form queues a link for the demo manufacturer, the link signs them in once, a second use fails.
// Reads the queued email from the local database (needs PSQL, e.g. "sudo -u postgres psql -d nazryx_e2e").
// Run against a started web app: BASE=http://localhost:3003 PSQL="sudo -u postgres psql -d nazryx_e2e" node signin_link_check.mjs
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
const B = process.env.BASE ?? 'http://localhost:3003';
const PSQL = process.env.PSQL ?? 'sudo -u postgres psql -d nazryx_e2e';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const sql = (q) => execSync(`${PSQL} -Atc "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' }).trim();
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
sql("delete from notifications where subject like '%sign-in link%' or subject like '%lien de connexion%'");
await p.goto(B + '/signup?mode=signin');
await p.fill('#email', 'demo-maker@nazryx.test');
await Promise.all([p.waitForURL(/sent=1/), p.click('button:has-text("Email me a sign-in link")')]);
await p.locator('.ok').waitFor({ timeout: 15000 }).catch(() => {});
ok((await p.locator('body').innerText()).includes('a sign-in link is on its way'), 'the form confirms without revealing whether the account exists');
const body = sql("select body from notifications n join users u on u.id = n.user_id where u.email = 'demo-maker@nazryx.test' and n.subject like '%sign-in link%' order by n.id desc limit 1");
const link = (body.match(/https?:\/\/\S+\/signin\/link\?t=[A-Za-z0-9_-]+/) || [])[0];
ok(Boolean(link), 'a one-time link was queued for the account');
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'nobody-' + Date.now() + '@example.com');
await Promise.all([p.waitForURL(/sent=1/), p.click('button:has-text("Email me a sign-in link")')]);
ok(sql("select count(*) from notifications where body like '%nobody-%'") === '0', 'an unknown email gets the same answer and no mail');
const local = link.replace(/^https?:\/\/[^/]+/, B);
await p.goto(local);
ok(p.url().startsWith(B + '/m'), 'the link signs the manufacturer in');
const fresh = await br.newPage();
await fresh.goto(local);
ok(fresh.url().includes('error=') && (await fresh.locator('body').innerText()).includes('expired or was already used'), 'the link works only once');
await fresh.goto(B + '/signin/link?t=short');
ok(fresh.url().includes('error='), 'a malformed token is refused');
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
