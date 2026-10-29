'use server';
import { redirect } from 'next/navigation';
import { requireTeam, requireUser } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { MFR_COUNTRIES, SERVICES } from '@/lib/mfr';

// The marketplace: a distributor's profile and needs, raising a hand on a need, the threads both sides and the team
// write in, and booking a catalogue service onto a project.
const codes = MFR_COUNTRIES.map((c) => c.code);
const safeNext = (v: string, fallback: string) => (v.startsWith('/') && !v.startsWith('//') ? v : fallback);
const list = (f: FormData, k: string, allowed?: string[]) => [...new Set(f.getAll(k).map(String))].filter((x) => !allowed || allowed.includes(x)).slice(0, 20);

export async function saveDistributorProfile(f: FormData) {
  const u = await requireUser({ allowOnboarding: true, distributor: true });
  const company = str(f, 'company_name', 160), country = str(f, 'country', 2);
  if (!company) back('/d/onboarding', { error: 'Enter your company name.' });
  if (!codes.includes(country)) back('/d/onboarding', { error: 'Pick your home market.' });
  const markets = list(f, 'markets', codes);
  try {
    await withUser(u.id, async (db) => {
      await db.query(`insert into distributor_profiles (user_id, company_name, country, markets, categories, about) values ($1, $2, $3, $4, $5, $6)
        on conflict (user_id) do update set company_name = excluded.company_name, country = excluded.country, markets = excluded.markets, categories = excluded.categories, about = excluded.about`,
        [u.id, company, country, markets.length ? markets : [country], list(f, 'categories'), str(f, 'about', 1000) || null]);
      await db.query('update users set onboarded = true, country = $2 where id = $1', [u.id, country]);
    });
  } catch (e) {
    back('/d/onboarding', { error: dbMessage(e) });
  }
  redirect(u.onboarded ? '/d/onboarding?saved=1' : '/d/needs?welcome=1');
}

export async function postNeed(f: FormData) {
  const u = await requireUser({ distributor: true });
  const country = str(f, 'country', 2), molecule = int(f, 'molecule_id'), text = str(f, 'molecule_text', 200);
  if (!codes.includes(country)) back('/d/needs', { error: 'Pick the market.' });
  if (!molecule && !text) back('/d/needs', { error: 'Name the molecule or product.' });
  const due = str(f, 'deliver_by', 10);
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      // a typed molecule name that matches the catalogue gets linked, so manufacturers of that molecule see the need
      const mol = molecule || (text ? (await one(db, 'select id from molecules where lower(inn) = lower($1) limit 1', [text]))?.id ?? null : null);
      const r = await one(db, `insert into needs (user_id, country, molecule_id, molecule_text, dosage_form, quantity, target_price, deliver_by, note)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [u.id, country, mol, text || null, str(f, 'dosage_form', 60) || null, str(f, 'quantity', 120) || null, str(f, 'target_price', 120) || null,
         /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null, str(f, 'note', 2000) || null]);
      await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', 'New need on the board', $1)`,
        [`A distributor posted a need in ${country}: ${text || 'molecule ' + molecule}. Need #${r!.id}.`]);
      return r!.id as number;
    });
  } catch (e) {
    back('/d/needs', { error: dbMessage(e) });
  }
  redirect(`/d/needs/${id}?saved=1`);
}

export async function setNeedStatus(f: FormData) {
  const u = await requireUser({ distributor: true });
  const id = int(f, 'id'), status = str(f, 'status', 10);
  if (!id || !['open', 'matched', 'closed'].includes(status)) back('/d/needs', { error: 'Pick a status.' });
  await withUser(u.id, (db) => db.query('update needs set status = $2, updated_at = now() where id = $1 and user_id = $3', [id, status, u.id]));
  redirect(`/d/needs/${id}?saved=1`);
}

/** A manufacturer raises a hand on a need: a lead, a thread and the first message. */
export async function raiseHand(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const id = int(f, 'need_id'), body = str(f, 'body', 2000);
  const ret = safeNext(str(f, 'return', 200), '/m/rfq');
  if (!id || !body) back(ret, { error: 'Say what you can supply, in a line or two.' });
  if (u.seat_role === 'viewer') back(ret, { error: 'Viewers cannot write. Ask your account owner for a sales seat.' });
  let thread = 0;
  try {
    thread = await withUser(u.id, async (db) => (await one(db, 'select raise_hand($1, $2) as id', [id, body]))!.id as number);
  } catch (e) {
    back(ret, { error: dbMessage(e) });
  }
  redirect(`/m/threads/${thread}?saved=1`);
}

/** A distributor writes to a manufacturer with a public page. */
export async function contactMaker(f: FormData) {
  const u = await requireUser({ distributor: true });
  const slug = str(f, 'slug', 80), body = str(f, 'body', 2000);
  if (!slug || !body) back(`/d/makers/${slug}`, { error: 'Write a message first.' });
  let thread = 0;
  try {
    thread = await withUser(u.id, async (db) => (await one(db, 'select contact_maker($1, $2) as id', [slug, body]))!.id as number);
  } catch (e) {
    back(`/d/makers/${slug}`, { error: dbMessage(e) });
  }
  redirect(`/d/threads/${thread}?saved=1`);
}

export async function postMessage(f: FormData) {
  const u = await requireUser({ shared: true });
  const id = int(f, 'thread_id'), body = str(f, 'body', 4000);
  const side = u.account_type === 'distributor' && u.role !== 'team' ? 'd' : 'm';
  if (!id || !body) back(`/${side}/threads/${id}`, { error: 'Write a message first.' });
  if (u.seat_role === 'viewer') back(`/${side}/threads/${id}`, { error: 'Viewers cannot write. Ask your account owner for a sales seat.' });
  try {
    await withUser(u.id, (db) => db.query('select thread_post($1, $2)', [id, body]));
  } catch (e) {
    back(`/${side}/threads/${id}`, { error: dbMessage(e) });
  }
  redirect(`/${side}/threads/${id}#end`);
}

/** Books a catalogue service: an engagement of the service's kind, on a project when one is given. */
export async function bookService(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const code = str(f, 'code', 40), project = int(f, 'project_id'), country = str(f, 'country', 2);
  const ret = safeNext(str(f, 'return', 200), '/m/marketplace');
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      const s = await one(db, 'select * from service_catalog where code = $1 and active', [code]);
      if (!s) back(ret, { error: 'Pick a service.' });
      const pr = project ? await one(db, 'select id, country, product_id from projects where id = $1', [project]) : null;
      const r = await one(db, `insert into engagements (user_id, kind, country, product_id, detail, project_id, report_type) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [u.owner_id ?? u.id, s!.engagement_kind, pr?.country ?? (codes.includes(country) ? country : null), pr?.product_id ?? int(f, 'product_id'),
         `${s!.title}${s!.price_usd ? ` (fixed price $${Number(s!.price_usd).toLocaleString('en')})` : ''}${str(f, 'detail', 2000) ? `: ${str(f, 'detail', 2000)}` : ''}`,
         pr?.id ?? null, s!.engagement_kind === 'report' ? 'market_read' : null]);
      await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', $1, $2)`,
        [`Booked: ${s!.title}`, `${u.email} booked ${s!.title} (${SERVICES[s!.engagement_kind]?.label ?? s!.engagement_kind})${pr ? ` on project #${pr.id}` : ''}. Engagement #${r!.id}.`]);
      return r!.id as number;
    });
  } catch (e) {
    back(ret, { error: dbMessage(e) });
  }
  redirect(`/m/engagements/${id}?new=1`);
}

// ---- team
export async function setDistributorVerified(f: FormData) {
  const u = await requireTeam('manufacturers');
  await withUser(u.id, (db) => db.query('select set_distributor_verified($1, $2)', [str(f, 'user_id', 40), f.get('on') === '1']));
  redirect('/admin/marketplace?saved=1');
}

export async function saveService(f: FormData) {
  const u = await requireTeam('content');
  const code = str(f, 'code', 40), price = str(f, 'price_usd', 12), days = str(f, 'days', 5);
  await withUser(u.id, (db) => db.query(`update service_catalog set title = coalesce(nullif($2, ''), title), what = coalesce(nullif($3, ''), what),
      price_usd = $4, days = $5, provider = coalesce(nullif($6, ''), provider), active = $7 where code = $1`,
    [code, str(f, 'title', 120), str(f, 'what', 600), price && Number.isFinite(Number(price)) ? Number(price) : null,
     days && Number.isFinite(Number(days)) ? Math.round(Number(days)) : null, str(f, 'provider', 60), f.get('active') === '1']));
  redirect('/admin/marketplace?saved=1#services');
}
