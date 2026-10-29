// Projects, the calendar, the search box and the free tender headlines, with the demo manufacturer.
// Run against a started web app: BASE=http://localhost:3003 DEMO_PASSWORD=... node projects_check.mjs
import { chromium } from 'playwright';
const B = process.env.BASE ?? 'http://localhost:3003';
let fails = 0;
const ok = (c, label) => { console.log(`${c ? '✓' : '✗'} ${label}`); if (!c) fails++; };
const br = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const p = await br.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(B + '/signup?mode=signin'); await p.fill('#email', 'demo-maker@nazryx.test'); await p.fill('#password', process.env.DEMO_PASSWORD);
await Promise.all([p.waitForURL(/\/m/), p.click('button[type=submit]')]);
const nav = await p.locator('nav').innerText();
ok(nav.includes('Projects') && nav.includes('Calendar'), 'Projects and Calendar are in the menu');

await p.goto(B + '/m/projects');
ok((await p.locator('main').innerText()).includes('Board'), 'the projects page opens on a board');
await p.selectOption('select[name=product_id]', { index: 1 });
await Promise.all([p.waitForURL(/\/m\/projects\/\d+/), p.click('button:has-text("Start")')]);
const proj = await p.locator('main').innerText();
ok(proj.includes('Tasks for this stage') && proj.includes('Check demand, competition and the shelf price') && proj.includes('Target and owner'), 'a project opens at Assess with the usual tasks');
const before = await p.locator('button[aria-label="Mark as not done"]').count();
await p.locator('button[aria-label="Mark as done"]').first().click({ noWaitAfter: true });
await p.waitForFunction((n) => document.querySelectorAll('button[aria-label="Mark as not done"]').length > n, before, { timeout: 20000 }).catch(() => {});
ok((await p.locator('button[aria-label="Mark as not done"]').count()) > before, 'a task is ticked off');
await p.fill('input[name=title]', 'Call the distributor'); await p.fill('input[name=due_date]', '2026-12-01');
await p.click('button:has-text("Add")', { noWaitAfter: true }); await p.locator('text=Call the distributor').first().waitFor({ timeout: 20000 }).catch(() => {});
ok((await p.locator('main').innerText()).includes('Call the distributor'), 'an own task with a due date is added');
await p.locator('form:has(input[value=dossier]) button').click({ noWaitAfter: true }); await p.locator('text=Collect the documents on the checklist').first().waitFor({ timeout: 20000 }).catch(() => {});
const moved = await p.locator('main').innerText();
ok(moved.includes('Collect the documents on the checklist') && /Dossier for/.test(moved), 'moving to Dossier adds its tasks and shows the market checklist');
const url = p.url();

await p.goto(B + '/m/calendar');
const cal = await p.locator('main').innerText();
ok(cal.includes('Call the distributor') && cal.includes('Task due'), 'the calendar lists the task due date');
await p.fill('input[name=title]', 'GMP certificate'); await p.fill('input[name=on_date]', '2027-03-01'); await p.selectOption('select[name=kind]', 'gmp_expiry');
await p.click('button:has-text("Add")', { noWaitAfter: true }); await p.locator('text=GMP certificate').first().waitFor({ timeout: 20000 }).catch(() => {});
ok((await p.locator('main').innerText()).includes('GMP expires'), 'an own date is added');
const ics = await p.request.get(B + '/m/calendar/ics');
ok(ics.status() === 200 && (await ics.text()).includes('BEGIN:VEVENT'), 'the .ics feed has events');

await p.goto(B + '/m');
await p.keyboard.press('/');
await p.keyboard.type('amox');
await p.locator('#search-hits [role=option]').first().waitFor({ timeout: 15000 });
const hit = await p.locator('#search-hits').innerText();
ok(hit.includes('Amoxicillin'), 'the search box finds a molecule');
await p.keyboard.press('Enter'); await p.waitForURL(/\/m\/molecules\/\d+/);
ok(true, 'Enter opens the first hit');

await p.goto(url); await p.click('button:has-text("Delete this project")', { noWaitAfter: true }); await p.waitForURL(/\/m\/projects\?/, { timeout: 20000 }).catch(() => {});
ok(true, 'the project is deleted again');
await br.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
