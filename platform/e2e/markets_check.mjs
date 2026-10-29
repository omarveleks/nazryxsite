// The francophone markets: the regulatory page shows the UEMOA and Cameroon routes, the coverage page is honest about a
// market with no data yet, and the market screens open. Needs the demo manufacturer to target SN, CI and CM:
//   update manufacturer_profiles set target_countries = array_cat(target_countries, '{SN,CI,CM}') where user_id = (select id from users where email = 'demo-maker@nazryx.test')
// Run against a started web app: BASE=http://localhost:3003 DEMO_PASSWORD=... node markets_check.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:3003';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);

let r = await p.goto(B + '/m/regulatory?market=SN');
let text = await p.locator('main').innerText();
ok(r.status() === 200 && text.includes('Senegal'), 'the regulatory page opens for Senegal');
ok(text.includes('UEMOA') && text.includes('Full review'), 'it shows the UEMOA full review route with its months');
ok(/1,?700|1 700/.test(text) || text.includes('2,550'), 'the fee from the 2025 decree is on the page');
r = await p.goto(B + '/m/regulatory?market=CI');
text = await p.locator('main').innerText();
ok(r.status() === 200 && text.includes('AIRP'), 'the regulatory page for Côte d’Ivoire names the AIRP');
r = await p.goto(B + '/m/regulatory?market=CM');
text = await p.locator('main').innerText();
ok(r.status() === 200 && text.includes('pharmacien interlocuteur') && text.includes('CNM'), 'the Cameroon page explains the local pharmacist and the commission');
r = await p.goto(B + '/m/coverage?market=SN');
text = await p.locator('main').innerText();
ok(r.status() === 200 && /Senegal/.test(text) && /managed by our team|Thin|thin/.test(text), 'the coverage page for Senegal is honest about depth');
for (const path of ['/m/market?market=SN', '/m/finder?market=CM', '/m/tenders?market=CI']) {
  r = await p.goto(B + path);
  ok(r.status() === 200 && !(await p.locator('main').innerText()).includes('Application error'), `${path} opens without error`);
}
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
