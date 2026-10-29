'use server';
import { cookies } from 'next/headers';
import { LANG_COOKIE } from '@/lib/i18n';
import { teamCan } from '@/lib/team';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { dbMessage, one, rows, withUser } from '@/lib/db';
import { back, int, isEmail, str } from '@/lib/forms';
import { hashPassword } from '@/lib/password';
import { saveUpload } from '@/lib/uploads';
import { findMolecule } from '@/lib/match';
import { FOCUS_GOALS, SUPPLIER_COUNTRIES } from '@/lib/format';

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
        const id = await findMolecule(db, n);
        if (!id) { missed.push(n); continue; }
        const r = await db.query('insert into portfolio_items (user_id, molecule_id, source) values ($1, $2, $3) on conflict do nothing',
          [u.id, id, 'list']);
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

/** Add a molecule to the sourcing list, or take it off. */
export async function toggleList(f: FormData) {
  const u = await requireUser();
  const id = int(f, 'molecule_id');
  const to = ret(f, '/requests/list');
  try {
    await withUser(u.id, async (db) => {
      const r = await db.query('delete from sourcing_list where user_id = $1 and molecule_id = $2', [u.id, id]);
      if (!r.rowCount) {
        const n = Number((await one(db, 'select count(*)::int as n from sourcing_list where user_id = $1', [u.id]))?.n ?? 0);
        if (n >= 50) throw new Error('Your sourcing list holds up to 50 molecules. Send it first.');
        await db.query('insert into sourcing_list (user_id, molecule_id) values ($1, $2)', [u.id, id]);
      }
    });
  } catch (e) {
    back(to, { error: e instanceof Error && e.message.startsWith('Your sourcing') ? e.message : dbMessage(e) });
  }
  revalidatePath('/', 'layout');
  redirect(to);
}

/** Send the whole sourcing list: one request per molecule, sharing the notes and dates, in one transaction. */
export async function sendList(f: FormData) {
  const u = await requireUser();
  const notes = str(f, 'notes', 4000), target = str(f, 'target_price', 60), deliver = str(f, 'deliver_by', 10);
  let sent = 0;
  try {
    sent = await withUser(u.id, async (db) => {
      const items = await rows(db, `select l.molecule_id, m.inn from sourcing_list l join molecules m on m.id = l.molecule_id
                                    where l.user_id = $1 order by l.added_at`, [u.id]);
      if (!items.length) throw new Error('Your sourcing list is empty.');
      for (const it of items) {
        const qty = str(f, `qty_${it.molecule_id}`, 60);
        const r = await one(db, `insert into requests (user_id, molecule_id, quantity, unit, target_price, deliver_by, notes)
                                 values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [u.id, it.molecule_id, qty || null, qty ? 'packs' : null, target || null, deliver || null,
           [notes, `Sent as part of a list of ${items.length}.`].filter(Boolean).join('\n')]);
        await db.query("insert into request_stage_history (request_id, stage, changed_by) values ($1, 'Product request', $2)", [r!.id, u.id]);
      }
      await db.query('delete from sourcing_list where user_id = $1', [u.id]);
      await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', 'New sourcing list', $1)`,
        [`${u.email} sent ${items.length} molecules: ${items.map((i) => i.inn).join(', ')}.`]);
      return items.length;
    });
  } catch (e) {
    back('/requests/list', { error: e instanceof Error && e.message.startsWith('Your sourcing') ? e.message : dbMessage(e) });
  }
  revalidatePath('/', 'layout');
  redirect(`/requests?sent=${sent}`);
}

/** Save the customer's focus (onboarding step 3, or from Settings). */
export async function saveFocus(f: FormData) {
  const u = await requireUser();
  const nextRaw = str(f, 'next', 200);
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/home';
  const pick = (k: string, allowed?: readonly string[]) =>
    [...new Set(f.getAll(k).map(String))].filter((v) => v.length <= 120 && (!allowed || allowed.includes(v))).slice(0, 60);
  try {
    await withUser(u.id, (db) => db.query(`insert into user_focus (user_id, classes, goals, supplier_countries, levels, updated_at)
        values ($1, $2, $3, $4, $5, now())
        on conflict (user_id) do update set classes = excluded.classes, goals = excluded.goals,
          supplier_countries = excluded.supplier_countries, levels = excluded.levels, updated_at = now()`,
      [u.id, pick('classes'), pick('goals', FOCUS_GOALS.map((g) => g[0])), pick('supplier_countries', SUPPLIER_COUNTRIES),
       pick('levels', ['A', 'B', 'C', 'D', 'S'])]));
  } catch (e) {
    back(`/onboarding/focus?next=${encodeURIComponent(next)}`, { error: dbMessage(e) });
  }
  redirect(next);
}

/** Ask the Nazryx team a short question, optionally about one molecule. */
export async function askExpert(f: FormData) {
  const u = await requireUser({ shared: true });
  const body = str(f, 'body', 2000), molText = str(f, 'molecule', 200);
  if (!body) back('/expert', { error: 'Write your question.' });
  try {
    await withUser(u.id, async (db) => {
      const m = molText ? await one(db, `select id from molecules where lower(inn) = lower($1)
                                         union all select molecule_id from molecule_aliases where alias = lower($1) limit 1`, [molText]) : null;
      await db.query('insert into expert_questions (user_id, molecule_id, body) values ($1, $2, $3)', [u.id, m?.id ?? null, body]);
      await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', 'New expert question', $1)`,
        [`${u.email}${molText ? ` about ${molText}` : ''}: ${body.slice(0, 300)}`]);
    });
  } catch (e) {
    back('/expert', { error: dbMessage(e) });
  }
  redirect('/expert?sent=1');
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
      await db.query("insert into request_stage_history (request_id, stage, changed_by) values ($1, 'Product request', $2)", [r!.id, u.id]);
      for (const fl of files) {
        await db.query('insert into request_files (request_id, path, file_name, kind, uploaded_by) values ($1, $2, $3, $4, $5)',
          [r!.id, fl.path, fl.name, fl.kind, u.id]);
      }
      await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', 'New sourcing request', $1)`,
        [`Request #${r!.id} from ${u.email}: ${moleculeText || 'molecule ' + moleculeId}, quantity ${quantity || 'not given'}. Start the regulatory check.`]);
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
  if (u.role === 'team' && !teamCan(u, 'requests')) notFound();
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
  const u = await requireUser({ shared: true });
  const wanted = str(f, 'wanted', 20) || 'paid';
  await withUser(u.id, async (db) => {
    await db.query('insert into plan_requests (user_id, wanted, note) values ($1, $2, $3)', [u.id, wanted, str(f, 'note', 1000) || null]);
    await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', 'Upgrade request', $1)`,
      [`${u.email} asked for: ${wanted}.`]);
  });
  redirect('/settings?upgrade=1#plan');
}

/** The public manufacturer page: on or off; the address comes from the company name. */
export async function setPublicProfile(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const on = str(f, 'on', 1) === '1';
  await withUser(u.id, async (db) => {
    const p = await one(db, 'select company_name, public_slug, status from manufacturer_profiles where user_id = $1', [u.owner_id ?? u.id]);
    if (!p || p.status !== 'approved') return;
    let slug = p.public_slug as string | null;
    if (!slug) {
      const base = ((await one(db, 'select mfr_slug($1) as s', [p.company_name]))?.s as string) || 'manufacturer';
      slug = base;
      for (let i = 2; await one(db, 'select 1 as x from manufacturer_profiles where public_slug = $1 and user_id <> $2', [slug, u.owner_id ?? u.id]); i++) slug = `${base}-${i}`;
    }
    await db.query('update manufacturer_profiles set public_profile = $2, public_slug = $3 where user_id = $1', [u.owner_id ?? u.id, on, slug]);
  });
  redirect('/settings?saved=1#public');
}

export async function updateSettings(f: FormData) {
  const u = await requireUser({ shared: true });
  const channel = str(f, 'channel', 20);
  const whatsapp = str(f, 'whatsapp', 30).replace(/[^\d+ ]/g, '');
  const language = ['en', 'fr', 'ru'].includes(str(f, 'language', 2)) ? str(f, 'language', 2) : 'en';
  await withUser(u.id, (db) => db.query(
    `update users set name = $2, whatsapp = $3, notify_email = $4, notify_whatsapp = $5, language = $6 where id = $1`,
    [u.id, str(f, 'name', 120) || u.name, whatsapp || null, channel === 'email' || channel === 'both', channel === 'whatsapp' || channel === 'both', language]));
  (await cookies()).set(LANG_COOKIE, language, { path: '/', maxAge: 365 * 86400, sameSite: 'lax' });
  redirect('/settings?saved=1');
}

export async function changePassword(f: FormData) {
  const u = await requireUser({ shared: true });
  const pw = String(f.get('password') ?? '');
  if (pw.length < 10) back('/settings', { error: 'Use a password of at least 10 characters.' });
  await withUser(u.id, (db) => db.query('select auth_set_password($1, $2)', [u.id, hashPassword(pw)]));
  redirect('/settings?saved=1');
}

export async function addSeat(f: FormData) {
  const u = await requireUser({ shared: true });
  const email = str(f, 'email', 200).toLowerCase(), name = str(f, 'name', 120), pw = String(f.get('password') ?? '');
  if (!isEmail(email) || pw.length < 10) back('/settings', { error: 'Add a valid email and a password of 10+ characters for the teammate.' });
  try {
    await withUser(u.id, (db) => db.query('select add_seat($1, $2, $3)', [email, name, hashPassword(pw)]));
  } catch (e) {
    back('/settings', { error: dbMessage(e) });
  }
  redirect('/settings?saved=1#team');
}
