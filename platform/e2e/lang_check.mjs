// The interface in French and Russian: the language switch, the setting, the menu, a data page and the sign-in page.
// Run against a started web app: BASE=http://localhost:3003 DEMO_PASSWORD=... node lang_check.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:3003';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });

await p.goto(B + '/lang/fr?next=/signup');
ok((await p.locator('body').innerText()).includes('Se connecter') && (await p.getAttribute('html', 'lang')) === 'fr', 'signed out: the language switch puts the sign-in page in French');
await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);
let nav = await p.locator('nav').innerText();
ok(nav.includes('Accueil') && nav.includes('Opportunités') && nav.includes('Mes produits'), 'after sign-in the menu is in French');
await p.goto(B + '/m/finder?market=TZ');
const fr = await p.locator('main').innerText();
ok(fr.includes('Toutes les classes thérapeutiques') && fr.includes('Recherches enregistrées') && fr.includes('Tanzanie'), 'the finder is in French, data labels and country names included');
await p.goto(B + '/m/market?market=TZ');
ok((await p.locator('main').innerText()).includes('Médicaments importés en Tanzanie'), 'the imports section is in French');

await p.goto(B + '/settings');
await p.selectOption('#language', 'ru');
await Promise.all([p.waitForURL(/saved=1/), p.click('form:has(#language) button[type=submit]')]);
nav = await p.locator('nav').innerText();
ok(nav.includes('Главная') && nav.includes('Входящие') && (await p.getAttribute('html', 'lang')) === 'ru', 'saving Russian in Settings switches the whole interface');
await p.goto(B + '/m/partners?market=TZ&tab=pipeline');
const ru = await p.locator('main').innerText();
ok(ru.includes('воронк') && ru.includes('Танзания'), 'the pipeline is in Russian');
await p.goto(B + '/m');
ok((await p.locator('main').innerText()).includes('Регистрируйте сначала эти'), 'Home is in Russian');

await p.goto(B + '/settings');
await p.selectOption('#language', 'en');
await Promise.all([p.waitForURL(/saved=1/), p.click('form:has(#language) button[type=submit]')]);
ok((await p.locator('nav').innerText()).includes('Home'), 'and back to English');
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
