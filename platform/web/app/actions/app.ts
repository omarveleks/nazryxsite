'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, isEmail, str } from '@/lib/forms';
import { hashPassword } from '@/lib/password';
import { saveUpload } from '@/lib/uploads';

const ret = (f: FormData, fallback: string) => {
  const r = str(f, 'return', 300);
  return r.startsWith('/') && !r.startsWith('//') ? r : fallback;
};

// ---------------------------------------------------------------- molecules
export async function enrich(f: FormData) {
  const u = await requireUser();
  const id = int(f, 'molecule_id');
  if (!id) redirect('/search');
  try {
    await withUser(u.id, (db) => db.query('select enrich_molecule($1)', [id]));
  } catch (e) {
    back(`/molecule/${id}`, { error: dbMessage(e) });
  }
  redirect(`/molecule/${id}`);
}

export async function togglePortfolio(f: FormData) {
  const u = await requireUser();
  const id = int(f, 'molecule_id');
  await withUser(u.id, async (db) => {
    const r = await db.query('delete from portfolio_items where user_id = $1 and molecule_id = $2', [u.id, id]);
    if (!r.rowCount) await db.query("insert into portfolio_items (user_id, molecule_id, source) values ($1, $2, 'manual')", [u.id, id]);
  });
  revalidatePath('/', 'layout');
  redirect(ret(f, `/molecule/${id}`));
}

export async function toggleWatch(f: FormData) {
  const u = await requireUser();
  const id = int(f, 'molecule_id');
  const to = ret(f, `/molecule/${id}`);
  try {
    await withUser(u.id, async (db) => {
      const r = await db.query('delete from watches where user_id = $1 and molecule_id = $2', [u.id, id]);
      if (!r.rowCount) await db.query('insert into watches (user_id, molecule_id) values ($1, $2)', [u.id, id]);
    });
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  redirect(to);
}

// Same idea as the pipeline's molecule key: lower case, no strengths, forms or pharmacopoeia marks, sorted tokens.
const FORM_WORDS = new Set(['tablet', 'tablets', 'tab', 'tabs', 'capsule', 'capsules', 'cap', 'caps', 'injection', 'inj', 'syrup',
  'suspension', 'cream', 'ointment', 'gel', 'drops', 'eye', 'ear', 'oral', 'solution', 'powder', 'for', 'infusion', 'bp', 'usp', 'ip',
  'and', 'with', 'film', 'coated', 'dispersible', 'sr', 'er', 'mr', 'forte', 'plus', 'sachet', 'sachets', 'lotion', 'vial', 'ampoule']);
function moleculeKeyish(name: string) {
  const t = name.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b[\d.,]+\s*(mg|mcg|µg|g|ml|iu|%|units?)\b/g, ' ').replace(/[^a-z\- ]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 1 && !FORM_WORDS.has(w));
  return [...new Set(t)].sort().join(' ');
}

/** Paste a product list (one per line, or comma separated): each name is matched to a molecule and added. */
export async function addPortfolioList(f: FormData) {
  const u = await requireUser();
  const to = ret(f, '/home');
  const names = str(f, 'list', 20000).split(/[\n;]+|,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean).slice(0, 300);
  if (!names.length) back(to, { error: 'Paste at least one product name.' });
  let added = 0;
  const missed: string[] = [];
  try {
    await withUser(u.id, async (db) => {
      for (const n of names) {
        const m = await one(db, `select id from molecules where lower(inn) = lower($1)
                                 union all select molecule_id from molecule_aliases where alias = $2
                                 union all (select molecule_id from molecule_aliases where alias like $2 || ' %' order by length(alias) limit 1)
                                 limit 1`, [n, moleculeKeyish(n)]);
        if (!m) { missed.push(n); continue; }
        const r = await db.query('insert into portfolio_items (user_id, molecule_id, source) values ($1, $2, $3) on conflict do nothing',
          [u.id, m.id ?? m.molecule_id, 'list']);
        added += r.rowCount ?? 0;
      }
    });
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  const q = new URLSearchParams({ added: String(added) });
  if (missed.length) q.set('missed', missed.slice(0, 15).join(' | '));
  redirect(`${to}${to.includes('?') ? '&' : '?'}${q}`);
}

/** Hide a molecule from "Picked for you". */
export async function hideMolecule(f: FormData) {
  const u = await requireUser();
  const id = int(f, 'molecule_id');
  const to = ret(f, '/home');
  try {
    await withUser(u.id, (db) => db.query('insert into hidden_molecules (user_id, molecule_id) values ($1, $2) on conflict do nothing', [u.id, id]));
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  redirect(to);
}

export async function toggleFollow(f: FormData) {
  const u = await requireUser();
  const id = int(f, 'company_id');
  const to = ret(f, `/company/${id}`);
  try {
    await withUser(u.id, async (db) => {
      const r = await db.query('delete from follows where user_id = $1 and company_id = $2', [u.id, id]);
      if (!r.rowCount) await db.query('insert into follows (user_id, company_id) values ($1, $2)', [u.id, id]);
    });
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  redirect(to);
}

// ---------------------------------------------------------------- requests
export async function createRequest(f: FormData) {
  const u = await requireUser();
  let moleculeId = int(f, 'molecule_id');
  const moleculeText = str(f, 'molecule', 200);
  const quantity = str(f, 'quantity', 60), unit = str(f, 'unit', 40), target = str(f, 'target_price', 60);
  const deliver = str(f, 'deliver_by', 10), notes = str(f, 'notes', 4000);
  if (!moleculeId && !moleculeText) back('/requests/new', { error: 'Tell us which molecule you need.' });
  let files: { path: string; name: string; kind: string }[] = [];
  try {
    for (const entry of f.getAll('attachments')) {
      const s = await saveUpload(entry, u.id);
      if (s) files.push({ ...s, kind: 'attachment' });
    }
    const bulk = await saveUpload(f.get('requirement_list'), u.id);
    if (bulk) files.push({ ...bulk, kind: 'requirement_list' });
  } catch (e) {
    back('/requests/new', { error: (e as Error).message });
  }
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      if (!moleculeId && moleculeText) {
        const m = await one(db, `select molecule_id from molecule_aliases where alias = lower($1)
                                 union all select id from molecules where lower(inn) = lower($1) limit 1`, [moleculeText]);
        moleculeId = m?.molecule_id ?? null;
      }
      const r = await one(db, `insert into requests (user_id, molecule_id, molecule_text, quantity, unit, target_price, deliver_by, notes)
                               values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [u.id, moleculeId, moleculeId ? null : moleculeText, quantity || null, quantity ? unit || null : null, target || null, deliver || null, notes || null]);
      await db.query("insert into request_stage_history (request_id, stage, changed_by) values ($1, 'Submitted', $2)", [r!.id, u.id]);
      for (const fl of files) {
        await db.query('insert into request_files (request_id, path, file_name, kind, uploaded_by) values ($1, $2, $3, $4, $5)',
          [r!.id, fl.path, fl.name, fl.kind, u.id]);
      }
      await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', 'New sourcing request', $1)`,
        [`Request #${r!.id} from ${u.email}: ${moleculeText || 'molecule ' + moleculeId}, quantity ${quantity || 'not given'}. Evaluate it first.`]);
      return r!.id as number;
    });
  } catch (e) {
    back('/requests/new', { error: dbMessage(e) });
  }
  redirect(`/requests/new?sent=${id}`);
}

export async function postMessage(f: FormData) {
  const u = await requireUser();
  const id = int(f, 'request_id'), body = str(f, 'body', 4000);
  const to = ret(f, `/requests/${id}`);
  if (!body) redirect(to);
  await withUser(u.id, async (db) => {
    await db.query('insert into request_messages (request_id, from_team, author_id, body) values ($1, $2, $3, $4)',
      [id, u.role === 'team', u.id, body]);
    if (u.role === 'team') {
      const r = await one(db, 'select user_id from requests where id = $1', [id]);
      await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', 'New message from Nazryx', $2),
                      ($1, 'whatsapp', null, $2)`, [r!.user_id, `Request #${id}: ${body.slice(0, 300)}`]);
    } else {
      await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', 'Customer message', $1)`,
        [`Request #${id} (${u.email}): ${body.slice(0, 300)}`]);
    }
  });
  redirect(to);
}

export async function addRequestFile(f: FormData) {
  const u = await requireUser();
  const id = int(f, 'request_id');
  const to = ret(f, `/requests/${id}`);
  let saved;
  try {
    saved = await saveUpload(f.get('file'), u.id);
  } catch (e) {
    back(to, { error: (e as Error).message });
  }
  if (!saved) redirect(to);
  try {
    await withUser(u.id, (db) => db.query('insert into request_files (request_id, path, file_name, uploaded_by) values ($1, $2, $3, $4)',
      [id, saved!.path, saved!.name, u.id]));
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  redirect(to);
}

export async function acceptQuote(f: FormData) {
  const u = await requireUser();
  const id = int(f, 'request_id'), quote = int(f, 'quote_id');
  try {
    await withUser(u.id, (db) => db.query('select accept_quote($1)', [quote]));
  } catch (e) {
    back(`/requests/${id}`, { error: dbMessage(e) });
  }
  redirect(`/requests/${id}?accepted=1`);
}

// ---------------------------------------------------------------- portfolio: the customer's own supplier list
export async function addCustomerSupplier(f: FormData) {
  const u = await requireUser();
  const name = str(f, 'name', 160);
  const ids = f.getAll('molecule_ids').map((v) => parseInt(String(v), 10)).filter(Number.isFinite);
  if (!name) back('/portfolio?tab=suppliers', { error: 'Add the supplier name.' });
  await withUser(u.id, (db) => db.query('insert into customer_suppliers (user_id, name, molecule_ids) values ($1, $2, $3)', [u.id, name, ids]));
  redirect('/portfolio?tab=suppliers');
}

export async function deleteCustomerSupplier(f: FormData) {
  const u = await requireUser();
  await withUser(u.id, (db) => db.query('delete from customer_suppliers where id = $1', [int(f, 'id')]));
  redirect('/portfolio?tab=suppliers');
}

// ---------------------------------------------------------------- settings and plan
export async function requestUpgrade(f: FormData) {
  const u = await requireUser();
  const wanted = str(f, 'wanted', 20) || 'paid';
  await withUser(u.id, async (db) => {
    await db.query('insert into plan_requests (user_id, wanted, note) values ($1, $2, $3)', [u.id, wanted, str(f, 'note', 1000) || null]);
    await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', 'Upgrade request', $1)`,
      [`${u.email} asked for: ${wanted}.`]);
  });
  redirect('/settings?upgrade=1#plan');
}

export async function updateSettings(f: FormData) {
  const u = await requireUser();
  const channel = str(f, 'channel', 20);
  const whatsapp = str(f, 'whatsapp', 30).replace(/[^\d+ ]/g, '');
  const language = ['en', 'fr', 'ru'].includes(str(f, 'language', 2)) ? str(f, 'language', 2) : 'en';
  await withUser(u.id, (db) => db.query(
    `update users set name = $2, whatsapp = $3, notify_email = $4, notify_whatsapp = $5, language = $6 where id = $1`,
    [u.id, str(f, 'name', 120) || u.name, whatsapp || null, channel === 'email' || channel === 'both', channel === 'whatsapp' || channel === 'both', language]));
  redirect('/settings?saved=1');
}

export async function changePassword(f: FormData) {
  const u = await requireUser();
  const pw = String(f.get('password') ?? '');
  if (pw.length < 10) back('/settings', { error: 'Use a password of at least 10 characters.' });
  await withUser(u.id, (db) => db.query('select auth_set_password($1, $2)', [u.id, hashPassword(pw)]));
  redirect('/settings?saved=1');
}

export async function addSeat(f: FormData) {
  const u = await requireUser();
  const email = str(f, 'email', 200).toLowerCase(), name = str(f, 'name', 120), pw = String(f.get('password') ?? '');
  if (!isEmail(email) || pw.length < 10) back('/settings', { error: 'Add a valid email and a password of 10+ characters for the teammate.' });
  try {
    await withUser(u.id, (db) => db.query('select add_seat($1, $2, $3)', [email, name, hashPassword(pw)]));
  } catch (e) {
    back('/settings', { error: dbMessage(e) });
  }
  redirect('/settings?saved=1#team');
}
