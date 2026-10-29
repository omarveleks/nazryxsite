// The dossier builder, a company page and the tender desk, with the demo manufacturer (Complete Market Access).
// Run against a started web app: BASE=http://localhost:3003 DEMO_PASSWORD=... node dossier_check.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:3003';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);

await p.goto(B + '/m/products');
await p.locator('a b', { hasText: 'Amoxicillin' }).first().click(); await p.waitForURL(/\/m\/products\/\d+/);
const pid = p.url().match(/products\/(\d+)/)[1];
await p.goto(B + `/m/products/${pid}/dossier?market=TZ`);
const dos = await p.locator('main').innerText();
ok(dos.includes('Readiness') && dos.includes('Checklist for Tanzania') && dos.includes('What is missing') && dos.includes('Pre-fill from your CTD'), 'the dossier builder shows readiness, the checklist and what is missing');
await p.fill('textarea[name=text]', '1.0 Cover letter\n1.2 Application form\n2.3 QOS\n3.2.S Drug substance\n5.3.1 BE study report');
await p.click('button:has-text("Tick what matches")', { noWaitAfter: true });
await p.waitForURL(/ticked=/, { timeout: 20000 }).catch(() => {});
const after = await p.locator('main').innerText();
ok(/\d+ items ticked/.test(after) && /[1-9]\d* of \d+ documents ready/.test(after), 'a pasted CTD list ticks the matching documents');
const first = p.locator('details').first();
await first.locator('summary').click();
await first.locator('input[type=file]').setInputFiles({ name: 'cover-letter.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 x') });
await first.locator('button:has-text("Upload")').click({ noWaitAfter: true });
await p.locator('a[href^="/files/dossier/"]').first().waitFor({ timeout: 20000 }).catch(() => {});
ok((await p.locator('a[href^="/files/dossier/"]').count()) >= 1, 'a file is uploaded against a checklist line');
const f = await p.request.get(B + (await p.locator('a[href^="/files/dossier/"]').first().getAttribute('href')));
ok(f.status() === 200, 'the file is served back');

await p.goto(B + '/m/partners?market=TZ');
const codeText = (await p.locator('main').innerText()).match(/\b([0-9A-F]{8})\b/);
ok(Boolean(codeText), 'a distributor code is on the partners page');
await p.goto(B + `/m/companies/${codeText[1]}?market=TZ`);
const co = await p.locator('main').innerText();
ok(co.includes('Portfolio in Tanzania') && co.includes('Registered products') && co.includes('In the market since'), 'a company page shows the portfolio, size and entry year');
ok(/ALPHA PHARMA|Beta Distributors|Delta Medics|GAMMA HEALTHCARE/i.test(co) || co.includes('Distributor ' + codeText[1]), 'the name shows on the plan');

await p.goto(B + '/m/tenders?market=TZ&show=desk');
ok((await p.locator('main').innerText()).includes('Open tenders on your molecules'), 'the tender desk opens');
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
